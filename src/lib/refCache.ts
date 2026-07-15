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

// Store (or refresh) a cached value. Fire-and-forget safe.
export async function cacheSet(key: string, value: unknown): Promise<void> {
  const rec: CacheRec = { key, value, savedAt: new Date().toISOString() }
  await run('readwrite', (s) => s.put(rec))
}

// Read a cached value, or null if absent/unavailable.
export async function cacheGet<T>(key: string): Promise<T | null> {
  const rec = await run<CacheRec>('readonly', (s) => s.get(key))
  return rec ? (rec.value as T) : null
}
