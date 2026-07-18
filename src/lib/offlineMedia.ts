// ---------------------------------------------------------------------------
// B6 Stage 3 — offline photos & videos.
//
// Every photo today needs the network TWICE: upload the file to the qc-photos
// bucket, then insert a row in the `photos` table. Offline both fail and the
// photo was simply lost (MediaCapture retried 3× then alerted).
//
// THE TRICK (same one that made offline inspections work in v86): the storage
// path is CLIENT-MINTED before the upload — `crypto.randomUUID() + '.jpg'`. So
// offline we mint the path, stash the file under it locally, and queue a photos
// row that already points at that final path. On reconnect the blob uploads to
// exactly that path and the row inserts. No reconciliation, no rewriting ids.
//
// Kept in its OWN IndexedDB database so it can never fight with the draft store
// (nitra-qc), the ref cache (nitra-qc-cache) or the pending inspections store
// (nitra-qc-pending) over schema versions.
//
// Every op is fail-safe: any failure resolves to null/false and NEVER throws into
// the UI. The online path is untouched — local storage is only ever a FALLBACK
// after a real network failure.
// ---------------------------------------------------------------------------

import { supabase } from './supabase'

const DB_NAME = 'nitra-qc-media'
const BLOBS = 'blobs'
const ROWS = 'rows'
const VERSION = 1

export interface LocalMedia {
  path: string            // the future storage_path — key
  blob: Blob
  mediaType: 'photo' | 'video'
  size: number
  savedAt: string
}

// A `photos` table row waiting to be inserted. Mirrors the columns the app
// actually writes; anything else takes its DB default.
export interface PendingPhotoRow {
  id: string                        // client-minted row id (also the store key)
  inspection_id: string | null
  container_loading_id: string | null
  storage_path: string
  media_type: 'photo' | 'video'
  is_pass_photo: boolean
  item_key: string
  piece_no: number
  comment: string
  inspector_id: string              // scopes the queue to one user on a shared device
  savedAt: string
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
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: 'path' })
        if (!db.objectStoreNames.contains(ROWS)) db.createObjectStore(ROWS, { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
  return dbPromise
}

function run<T>(store: string, mode: IDBTransactionMode, make: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null
    return new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(store, mode)
        const req = make(tx.objectStore(store))
        req.onsuccess = () => resolve((req.result as T) ?? null)
        req.onerror = () => resolve(null)
        tx.onabort = () => resolve(null)
      } catch { resolve(null) }
    })
  }).catch(() => null)
}

// --- blobs -----------------------------------------------------------------

// Store the captured file under its future storage path. Returns false if the
// write was rejected (e.g. the device is out of storage) so the caller can TELL
// the user rather than silently losing their photo.
export async function saveLocalMedia(path: string, blob: Blob, mediaType: 'photo' | 'video'): Promise<boolean> {
  const rec: LocalMedia = { path, blob, mediaType, size: blob.size, savedAt: new Date().toISOString() }
  return (await run(BLOBS, 'readwrite', (s) => s.put(rec))) !== null
}

export async function getLocalMedia(path: string): Promise<LocalMedia | null> {
  return run<LocalMedia>(BLOBS, 'readonly', (s) => s.get(path))
}

async function removeLocalMedia(path: string): Promise<void> {
  await run(BLOBS, 'readwrite', (s) => s.delete(path))
}

// An object URL for a locally-held file, or null if we don't have it. Callers
// must revoke the URL when done (see revokeMediaUrl) to avoid leaking memory.
export async function localMediaUrl(path: string): Promise<string | null> {
  const rec = await getLocalMedia(path)
  if (!rec?.blob) return null
  try { return URL.createObjectURL(rec.blob) } catch { return null }
}

export function revokeMediaUrl(url: string): void {
  try { if (url.startsWith('blob:')) URL.revokeObjectURL(url) } catch { /* ignore */ }
}

// Resolve a display URL for any storage path: the local copy first (instant, and
// the ONLY option offline), otherwise a signed URL from storage.
export async function mediaUrlFor(path: string): Promise<string | null> {
  const local = await localMediaUrl(path)
  if (local) return local
  try {
    const { data } = await supabase.storage.from('qc-photos').createSignedUrl(path, 3600)
    return data?.signedUrl || null
  } catch { return null }
}

// --- queued photo rows ------------------------------------------------------

export async function savePendingPhotoRow(row: PendingPhotoRow): Promise<boolean> {
  return (await run(ROWS, 'readwrite', (s) => s.put(row))) !== null
}

// The signed-in user's id, WITHOUT a network call: the Supabase client persists
// the session to localStorage (persistSession: true), so getSession() reads from
// disk and works offline. Saves threading a prop through every photo modal.
export async function currentUserId(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.user?.id || ''
  } catch { return '' }
}

async function getAllPendingRows(): Promise<PendingPhotoRow[]> {
  return (await run<PendingPhotoRow[]>(ROWS, 'readonly', (s) => s.getAll())) || []
}

async function removePendingRow(id: string): Promise<void> {
  await run(ROWS, 'readwrite', (s) => s.delete(id))
}

// Queued photos for one inspection, so the Inspection screen can show them
// immediately instead of appearing to have lost them. Scoped to the user.
export async function getPendingPhotosFor(inspectionId: string, userId: string): Promise<PendingPhotoRow[]> {
  if (!inspectionId || !userId) return []
  return (await getAllPendingRows()).filter(r => r.inspection_id === inspectionId && r.inspector_id === userId)
}

// Running tally for the "waiting to upload" indicator.
export async function pendingMediaStats(userId: string): Promise<{ count: number; bytes: number }> {
  if (!userId) return { count: 0, bytes: 0 }
  const rows = (await getAllPendingRows()).filter(r => r.inspector_id === userId)
  let bytes = 0
  for (const r of rows) {
    const m = await getLocalMedia(r.storage_path)
    if (m) bytes += m.size || 0
  }
  return { count: rows.length, bytes }
}

// --- sync -------------------------------------------------------------------

// Upload queued media and insert their photos rows.
//
// ORDER MATTERS: the parent inspection must already exist on the server, so
// App.tsx runs syncPendingInspections() BEFORE this. If a row's insert still
// fails (parent not there yet), it stays queued and retries next time rather
// than being dropped.
//
// Idempotent: the upload uses upsert (same client-minted path), and a row whose
// blob is already gone is treated as "file already uploaded, just insert".
let syncing = false
export async function syncPendingMedia(userId?: string): Promise<number> {
  if (syncing) return 0
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0
  syncing = true
  let done = 0
  try {
    for (const row of await getAllPendingRows()) {
      if (userId && row.inspector_id !== userId) continue
      try {
        const media = await getLocalMedia(row.storage_path)
        if (media?.blob) {
          const { error: upErr } = await supabase.storage.from('qc-photos')
            .upload(row.storage_path, media.blob, {
              upsert: true,
              contentType: media.mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
            })
          if (upErr) continue          // leave queued, retry next time
        }
        // Insert the row. If the parent inspection isn't on the server yet this
        // fails — leave it queued rather than losing the photo.
        const { error: insErr } = await supabase.from('photos').insert({
          inspection_id: row.inspection_id,
          container_loading_id: row.container_loading_id,
          storage_path: row.storage_path,
          media_type: row.media_type,
          is_pass_photo: row.is_pass_photo,
          item_key: row.item_key,
          piece_no: row.piece_no,
          comment: row.comment,
        })
        if (insErr) continue

        // A Fail photo taken offline could not be linked to a defect, because the
        // defect row didn't exist yet (offlineSync.rebuildDefects creates it at
        // sync time). Now that both exist, link them by item_key + piece_no —
        // the same pair the online flow uses.
        if (!row.is_pass_photo && row.inspection_id) {
          try {
            const { data: def } = await supabase.from('defects').select('id')
              .eq('inspection_id', row.inspection_id)
              .eq('item_key', row.item_key)
              .eq('piece_no', row.piece_no)
              .limit(1).maybeSingle()
            const defectId = (def as { id: string } | null)?.id
            if (defectId) {
              await supabase.from('photos').update({ defect_id: defectId })
                .eq('storage_path', row.storage_path).is('defect_id', null)
            }
          } catch { /* linking is a nicety — the photo is already saved */ }
        }

        await removeLocalMedia(row.storage_path)
        await removePendingRow(row.id)
        done++
      } catch { /* this one stays queued; carry on with the rest */ }
    }
  } catch { /* ignore — anything unsynced stays queued */ } finally { syncing = false }
  return done
}
