// ---------------------------------------------------------------------------
// B6 Stage 2 — offline inspection creation + sync (write side).
//
// When offline, a wheel inspection is created on the device with a client-minted
// UUID and stored here (a "pending" inspection). The Inspection screen loads it
// from this store, and edits are mirrored back in. When connectivity returns,
// syncPendingInspections() upserts each pending inspection to Supabase (the id is
// client-minted, so this inserts cleanly — verified against the live INSERT RLS)
// and rebuilds its defect rows from the recorded Pass/Fail results, then removes
// it from the pending store.
//
// Idempotent by design: the upsert keys on the client id (a double-flush can't
// duplicate the row), and defect rebuild checks-then-inserts (no duplicate
// defects). NOT covered here (later stages): offline photos, and the two-user
// shared-SKU conflict wall.
//
// Every op is fail-safe: failures leave the inspection pending to retry later and
// never throw into the UI.
// ---------------------------------------------------------------------------

import { supabase } from './supabase'
import { SECTIONS, MEAS_COLS } from './standard'

const DB_NAME = 'nitra-qc-pending'
const STORE = 'inspections'
const VERSION = 1

export interface PendingInspection {
  id: string
  part_no: string
  po_no: string
  batch: string
  lot_size: number
  app_sample: number
  fun_sample: number
  inspector_id: string
  status: string
  form_data: unknown
  summary: unknown
  pallet_data: unknown
  created_at: string
  updated_at: string
  pendingSince: string
}

let dbPromise: Promise<IDBDatabase | null> | null = null
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return }
      const req = indexedDB.open(DB_NAME, VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
  return dbPromise
}
function run<T>(mode: IDBTransactionMode, make: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null
    return new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(STORE, mode)
        const req = make(tx.objectStore(STORE))
        req.onsuccess = () => resolve((req.result as T) ?? null)
        req.onerror = () => resolve(null)
        tx.onabort = () => resolve(null)
      } catch { resolve(null) }
    })
  }).catch(() => null)
}

export async function savePendingInspection(row: PendingInspection): Promise<void> {
  await run('readwrite', (s) => s.put(row))
}
export async function getPendingInspection(id: string): Promise<PendingInspection | null> {
  return run<PendingInspection>('readonly', (s) => s.get(id))
}
export async function getAllPendingInspections(): Promise<PendingInspection[]> {
  return (await run<PendingInspection[]>('readonly', (s) => s.getAll())) || []
}
export async function pendingCount(): Promise<number> {
  return (await getAllPendingInspections()).length
}
async function removePendingInspection(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id))
}

// Keep a pending inspection's editable content current (called as the user edits
// offline). Self-guards: no-op if this id isn't a pending inspection.
export async function updatePendingInspection(insp: {
  id: string; form_data?: unknown; summary?: unknown; pallet_data?: unknown; status?: string
}): Promise<void> {
  const existing = await getPendingInspection(insp.id)
  if (!existing) return
  await savePendingInspection({
    ...existing,
    form_data: insp.form_data ?? existing.form_data,
    summary: insp.summary ?? existing.summary,
    pallet_data: insp.pallet_data ?? existing.pallet_data,
    status: insp.status ?? existing.status,
    updated_at: new Date().toISOString(),
  })
}

// The inspection currently open on the Inspection screen. The App-level batch sync
// skips it, because that screen syncs its own inspection (capturing in-flight edits)
// — avoiding a two-writer race on reconnect.
let openId: string | null = null
export function setOpenInspection(id: string | null): void { openId = id }

// item_key -> label(en) for rebuilding defect rows from Pass/Fail results.
const ITEM_LABEL: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const sec of SECTIONS) for (const it of sec.items) m[it.key] = it.label.en
  for (const c of MEAS_COLS) m[c.key] = c.label.en
  return m
})()

async function ensureDefectRow(id: string, item_key: string, piece: number, tab: string, labelSuffix = ''): Promise<void> {
  const { data: exists } = await supabase.from('defects').select('id')
    .eq('inspection_id', id).eq('item_key', item_key).eq('piece_no', piece).eq('tab', tab)
    .limit(1).maybeSingle()
  if (exists) return
  await supabase.from('defects').insert({
    inspection_id: id, piece_no: piece, tab,
    section: tab.toUpperCase(), item_key,
    item_label: (ITEM_LABEL[item_key] || item_key) + labelSuffix,
    defect_type: 'unspecified', severity: 'minor', measurement_value: null, measurement_unit: 'mm', comment: '',
  })
}

// After a pending inspection's row is live, recreate the defect rows for every
// recorded Fail — mirroring what tapping "Fail" does online (a minimal defect the
// inspector can flesh out later). Covers base pieces AND extra pieces. Each is
// check-then-insert so a retry can't duplicate.
async function rebuildDefects(id: string, formData: unknown): Promise<void> {
  const fd = (formData || {}) as {
    results?: Record<string, string>; meas_results?: Record<string, string>
    extra_results?: Record<string, string[]>; meas_extra_results?: Record<string, string[]>
  }
  for (const [rkey, val] of Object.entries(fd.results || {})) {
    if (val === 'F') { const [k, p] = rkey.split(':'); await ensureDefectRow(id, k, Number(p), 'form') }
  }
  for (const [rkey, val] of Object.entries(fd.meas_results || {})) {
    if (val === 'F') { const [k, p] = rkey.split(':'); await ensureDefectRow(id, k, Number(p), 'measure') }
  }
  // Extra pieces: online these are logged via ensureDefect(key, -idx, 'extra').
  for (const [k, arr] of Object.entries(fd.extra_results || {})) {
    for (let i = 0; i < (arr || []).length; i++) if (arr[i] === 'F') await ensureDefectRow(id, k, -(i + 1), 'extra', ' (extra)')
  }
  for (const [k, arr] of Object.entries(fd.meas_extra_results || {})) {
    for (let i = 0; i < (arr || []).length; i++) if (arr[i] === 'F') await ensureDefectRow(id, k, -(i + 1), 'extra', ' (extra)')
  }
}

async function pushRow(p: PendingInspection): Promise<boolean> {
  const { error } = await supabase.from('inspections').upsert({
    id: p.id, part_no: p.part_no, po_no: p.po_no, batch: p.batch,
    lot_size: p.lot_size, app_sample: p.app_sample, fun_sample: p.fun_sample,
    inspector_id: p.inspector_id, status: p.status,
    form_data: p.form_data, summary: p.summary, pallet_data: p.pallet_data,
    created_at: p.created_at,
  }, { onConflict: 'id' })
  if (error) return false               // leave pending, retry next time
  await rebuildDefects(p.id, p.form_data)
  await removePendingInspection(p.id)
  return true
}

// Push all pending inspections belonging to this user to the server. Returns how
// many synced. Skips the currently-open inspection (that screen syncs itself) and
// any inspection created by a different user (would fail the insert RLS).
let syncing = false
export async function syncPendingInspections(userId?: string): Promise<number> {
  if (syncing) return 0
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0
  syncing = true
  let synced = 0
  try {
    for (const p of await getAllPendingInspections()) {
      if (openId && p.id === openId) continue
      if (userId && p.inspector_id !== userId) continue
      if (await pushRow(p)) synced++
    }
  } catch { /* ignore — anything unsynced stays pending */ } finally { syncing = false }
  return synced
}

// Sync the one inspection open on screen, capturing its latest edits first. Called
// by the Inspection screen when connectivity returns. Returns true if it reached
// the server (so the screen can drop its "pending" state).
export async function syncOnePending(insp: {
  id: string; inspector_id: string; form_data?: unknown; summary?: unknown; pallet_data?: unknown; status?: string
}, userId?: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  if (userId && insp.inspector_id !== userId) return false
  await updatePendingInspection(insp)   // capture the latest edits before pushing
  const p = await getPendingInspection(insp.id)
  if (!p) return true                   // already synced/removed — nothing to do
  return pushRow(p)
}
