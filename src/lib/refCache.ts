// ---------------------------------------------------------------------------
// B6 Stage 2 — reference-data cache (read side of offline).
// A tiny, fail-safe key/value cache in IndexedDB so read-only reference data
// (the SKU master, sampling settings, and later the opened PO's items) survives
// going offline. Kept in a SEPARATE database from the Stage 1 draft store so the
// two never fight over schema versions.
//
// Every op is wrapped so any failure resolves to null / no-op and NEVER disrupts
// the app. If IndexedDB is unavailable, the whole layer quietly does nothing and
// online behaviour is exactly as before.
//
// Usage pattern (read-through): try the live Supabase fetch; on success refresh
// the cache; on offline/empty, fall back to the cached copy.
// ---------------------------------------------------------------------------

import { supabase } from './supabase'
import { isOffline } from './connectivity'
import { computeStages, sumLoadedByPart, type PoStages } from './poStatus'

const DB_NAME = 'nitra-qc-cache'
const STORE = 'ref'
const VERSION = 1

interface CacheRec { key: string; value: unknown; savedAt: string }

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return }
      const req = indexedDB.open(DB_NAME, VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
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

// Store (or refresh) a cached value. Still fail-safe (never throws), but RETURNS
// whether the write actually landed — this previously swallowed failures
// silently, which made a cache problem impossible to diagnose on a device.
export async function cacheSet(key: string, value: unknown): Promise<boolean> {
  const rec: CacheRec = { key, value, savedAt: new Date().toISOString() }
  return (await run('readwrite', (s) => s.put(rec))) !== null
}

// Read a cached value, or null if absent/unavailable.
export async function cacheGet<T>(key: string): Promise<T | null> {
  const rec = await run<CacheRec>('readonly', (s) => s.get(key))
  return rec ? (rec.value as T) : null
}

// Same as cacheGet, but also returns WHEN the value was cached, so a screen
// showing offline data can tell the user how old it is instead of silently
// passing stale data off as live. (savedAt was always stored; cacheGet just
// discards it.)
export async function cacheGetWithMeta<T>(key: string): Promise<{ value: T; savedAt: string } | null> {
  const rec = await run<CacheRec>('readonly', (s) => s.get(key))
  return rec ? { value: rec.value as T, savedAt: rec.savedAt } : null
}

// Proactively download + store the reference data the offline screens need, so
// it's available no matter which screen the user opens first. Called on login and
// whenever connectivity returns. Fully fail-safe — never throws, no-ops offline.
// This is what makes the New Inspection SKU list work offline WITHOUT having had
// to open the New Inspection screen while online beforehand.
export async function warmRefCache(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    const skus = await supabase.from('skus').select('*').eq('active', true).order('part_no')
    if (skus.data && !skus.error) {
      await cacheSet('skus', skus.data)  // full rows — New Inspection form
      await cacheSet('skus_lite', (skus.data as Array<Record<string, unknown>>).map((s) => ({
        part_no: s.part_no, model: s.model, size: s.size, finish: s.finish,
      })))                                // 4-col subset — PartPicker
    }
    const settings = await supabase.from('settings').select('value').eq('key', 'sampling').single()
    if (settings.data && !settings.error) await cacheSet('sampling', (settings.data as { value: unknown }).value)
  } catch { /* ignore — warming is best-effort */ }
}

// ---------------------------------------------------------------------------
// v87 — PO-page offline cache (finishes the offline READ side).
//
// WHY THE KEYS ARE NAMESPACED BY USER ID: unlike the SKU master and sampling
// settings above (identical for everyone), PO data is scoped per user by RLS —
// an inspector only sees their OWN inspections/container loadings. IndexedDB
// survives sign-out, so on a SHARED iPad an un-namespaced cache would show user
// A's POs to user B. Namespacing means a different user gets a cache MISS rather
// than someone else's data: it fails closed.
//
// WHY THE WARM IS BULK, NOT PER-PO: v83 cached lazily per-screen and that failed
// because users never opened the screen online first (v85 fixed it by warming
// proactively). The identical trap is here — an inspector who only warms the PO
// LIST at the office would still hit an empty PO DETAIL page onsite. So one bulk
// pass (5 queries) fans out to every PO's detail cache. Every query runs under
// the caller's own RLS, so the cache holds exactly what that user could see live.
// ---------------------------------------------------------------------------

export interface CachedPoGroup {
  po: string; inspCount: number; contCount: number; latest: string
  customer?: string; destination?: string
}
export interface CachedHubInsp {
  id: string; part_no: string; status: string; updated_at: string
  inspector_id: string; off_po?: boolean
}
export interface CachedHubCont {
  id: string; container_no: string; seal_no: string; status: string
  insp_status: string; updated_at: string; inspector_id: string
}
export interface CachedPoHub { insps: CachedHubInsp[]; conts: CachedHubCont[] }
export interface CachedPoRow {
  id: string; po_no: string; customer_name: string | null
  po_date: string | null; destination: string | null
}
export interface CachedPoItem { id?: string; part_no: string; qty_ordered: number }
export interface CachedPoInfo {
  row: CachedPoRow | null; items: CachedPoItem[]; loadedQty: Record<string, number>
}

export const poListKey = (uid: string) => `po_list:${uid}`
export const poHubKey = (uid: string, po: string) => `po_hub:${uid}:${po}`
export const poInfoKey = (uid: string, po: string) => `po_info:${uid}:${po}`
export const poStagesKey = (uid: string, po: string) => `po_stages:${uid}:${po}`

// Row shapes as they come back from the bulk queries below.
interface RawInsp { id: string; po_no: string | null; part_no: string; status: string; updated_at: string; inspector_id: string }
interface RawCont { id: string; po_no: string | null; container_no: string; seal_no: string; status: string; insp_status: string; updated_at: string; inspector_id: string; data: unknown }
interface RawPo { id: string; po_no: string; customer_name: string | null; po_date: string | null; destination: string | null; created_at: string }
interface RawItem { id: string; po_id: string; part_no: string; qty_ordered: number }
interface RawLink { inspection_id: string; po_no: string; off_po: boolean }

// Proactively cache the PO list and EVERY PO's detail for this user, so both
// survive going offline no matter which screen was opened first. Called on login
// and whenever connectivity returns. Fully fail-safe — never throws, no-ops
// offline, and on any error simply leaves the previous cache in place.
export async function warmPoCache(userId: string): Promise<void> {
  try {
    if (!userId) return
    if (isOffline()) return

    const [posRes, inspRes, contRes, itemRes, linkRes] = await Promise.all([
      supabase.from('pos').select('id,po_no,customer_name,po_date,destination,created_at').order('created_at', { ascending: false }).limit(500),
      supabase.from('inspections').select('id,po_no,part_no,status,updated_at,inspector_id').order('updated_at', { ascending: false }).limit(500),
      supabase.from('container_loadings').select('id,po_no,container_no,seal_no,status,insp_status,updated_at,inspector_id,data').order('updated_at', { ascending: false }).limit(500),
      supabase.from('po_items').select('id,po_id,part_no,qty_ordered').order('part_no'),
      supabase.from('inspection_pos').select('inspection_id,po_no,off_po'),
    ])
    // Any failure => don't half-write a cache that screens would trust.
    if (posRes.error || inspRes.error || contRes.error || itemRes.error || linkRes.error) return

    const pos = (posRes.data as RawPo[]) || []
    const insps = (inspRes.data as RawInsp[]) || []
    const conts = (contRes.data as RawCont[]) || []
    const items = (itemRes.data as RawItem[]) || []
    const links = (linkRes.data as RawLink[]) || []

    // ---- PO list (mirrors Home.load's merge exactly) ----
    const map = new Map<string, CachedPoGroup>()
    const bump = (key: string, when: string, kind: 'insp' | 'cont') => {
      const g = map.get(key) || { po: key, inspCount: 0, contCount: 0, latest: when }
      if (kind === 'insp') g.inspCount++; else g.contCount++
      if (when > g.latest) g.latest = when
      map.set(key, g)
    }
    for (const r of insps) bump(r.po_no || '', r.updated_at, 'insp')
    for (const r of conts) bump(r.po_no || '', r.updated_at, 'cont')
    for (const m of pos) {
      const g = map.get(m.po_no) || { po: m.po_no, inspCount: 0, contCount: 0, latest: m.created_at }
      g.customer = m.customer_name || undefined
      g.destination = m.destination || undefined
      map.set(m.po_no, g)
    }
    const groups = [...map.values()].sort((a, b) => b.latest.localeCompare(a.latest))
    // If the list write is rejected, don't bother fanning out the per-PO writes.
    if (!await cacheSet(poListKey(userId), groups)) return

    // ---- Per-PO detail, fanned out from the same bulk rows ----
    const inspById = new Map(insps.map(i => [i.id, i]))
    const itemsByPoId = new Map<string, CachedPoItem[]>()
    for (const it of items) {
      const arr = itemsByPoId.get(it.po_id) || []
      arr.push({ id: it.id, part_no: it.part_no, qty_ordered: it.qty_ordered })
      itemsByPoId.set(it.po_id, arr)
    }
    const linksByPo = new Map<string, RawLink[]>()
    for (const l of links) {
      const arr = linksByPo.get(l.po_no) || []
      arr.push(l)
      linksByPo.set(l.po_no, arr)
    }
    // Cache every PO the user can reach: PO master rows plus any PO number that
    // only appears on an inspection/container (POs predating the pos table).
    const poNos = new Set<string>([...pos.map(p => p.po_no), ...map.keys()].filter(Boolean))

    for (const po of poNos) {
      // PoHub: inspections come via the junction (NOT inspections.po_no), matching PoHub.load.
      const poLinks = linksByPo.get(po) || []
      const hubInsps: CachedHubInsp[] = poLinks
        .map((l): CachedHubInsp | null => {
          const i = inspById.get(l.inspection_id)
          return i ? { id: i.id, part_no: i.part_no, status: i.status, updated_at: i.updated_at, inspector_id: i.inspector_id, off_po: l.off_po || false } : null
        })
        .filter((x): x is CachedHubInsp => x !== null)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      const poConts = conts.filter(c => (c.po_no || '') === po)
      const hubConts: CachedHubCont[] = poConts.map(c => ({
        id: c.id, container_no: c.container_no, seal_no: c.seal_no, status: c.status,
        insp_status: c.insp_status, updated_at: c.updated_at, inspector_id: c.inspector_id,
      }))
      await cacheSet(poHubKey(userId, po), { insps: hubInsps, conts: hubConts } satisfies CachedPoHub)

      // PoInfo
      const master = pos.find(p => p.po_no === po) || null
      const row: CachedPoRow | null = master
        ? { id: master.id, po_no: master.po_no, customer_name: master.customer_name, po_date: master.po_date, destination: master.destination }
        : null
      await cacheSet(poInfoKey(userId, po), {
        row,
        items: master ? (itemsByPoId.get(master.id) || []) : [],
        loadedQty: sumLoadedByPart(poConts),
      } satisfies CachedPoInfo)

      // PoStatusStrip — same inputs computeStages gets live.
      const stages: PoStages = computeStages({
        items: master ? (itemsByPoId.get(master.id) || []).map(i => ({ part_no: i.part_no, qty_ordered: i.qty_ordered })) : [],
        insps: hubInsps.map(i => ({ status: i.status, part_no: i.part_no })),
        conts: poConts.map(c => ({ insp_status: c.insp_status, data: c.data })),
      })
      await cacheSet(poStagesKey(userId, po), stages)
    }
  } catch { /* ignore — warming is best-effort */ }
}
