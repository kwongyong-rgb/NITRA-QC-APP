// ---------------------------------------------------------------------------
// B6 Stage 1 — offline safety net.
// Snapshots the currently-open wheel / container inspection to IndexedDB
// alongside the normal Supabase writes. This is PURE INSURANCE: every op is
// wrapped so any failure here resolves to null / no-op and NEVER disrupts the
// live inspection. If IndexedDB is unavailable, the whole layer quietly does
// nothing and the app behaves exactly as before.
// (Later stages build the write queue + offline photo blobs on this same store.)
// ---------------------------------------------------------------------------

const DB_NAME = 'nitra-qc'
const STORE = 'drafts'
const VERSION = 1

export type DraftKind = 'inspection' | 'container'

export interface LocalDraft {
  key: string                     // `${kind}:${id}`
  kind: DraftKind
  id: string
  updatedAt: string               // ISO — when this local snapshot was taken
  serverUpdatedAt: string | null  // server updated_at last seen (informational)
  data: unknown                   // snapshot payload (form_data / summary / pallet_data)
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

const keyOf = (kind: DraftKind, id: string) => `${kind}:${id}`

export async function saveLocalDraft(kind: DraftKind, id: string, data: unknown, serverUpdatedAt: string | null): Promise<void> {
  if (!id) return
  const draft: LocalDraft = {
    key: keyOf(kind, id), kind, id,
    updatedAt: new Date().toISOString(),
    serverUpdatedAt,
    data,
  }
  await run('readwrite', (s) => s.put(draft))
}

export async function getLocalDraft(kind: DraftKind, id: string): Promise<LocalDraft | null> {
  if (!id) return null
  return run<LocalDraft>('readonly', (s) => s.get(keyOf(kind, id)))
}

export async function clearLocalDraft(kind: DraftKind, id: string): Promise<void> {
  if (!id) return
  await run('readwrite', (s) => s.delete(keyOf(kind, id)))
}
