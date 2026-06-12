import { useRef } from 'react'
import { supabase } from '../lib/supabase'

/** Opens the device camera, uploads to storage, returns the storage path. */
export default function Camera({ onUploaded, label }: { onUploaded: (path: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const pick = () => ref.current?.click()
  const upload = async (f: File) => {
    const path = `${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage.from('qc-photos').upload(path, f, { contentType: f.type })
    if (!error) onUploaded(path)
  }
  return (
    <>
      <input ref={ref} type="file" accept="image/*" capture="environment" hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = '' }} />
      <button className="btn ghost" onClick={pick}>📷 {label}</button>
    </>
  )
}

export function photoUrl(path: string) {
  return supabase.storage.from('qc-photos').createSignedUrl(path, 3600).then(r => r.data?.signedUrl || '')
}
