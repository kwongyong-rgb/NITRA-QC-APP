import { useEffect, useRef, useState } from 'react'

// A tiny, dependency-free rich-text editor (bold / italic / underline / bullet list).
// Stores its value as simple HTML. Uncontrolled internally to keep the caret stable:
// the parent's value is only pushed into the DOM when it changes AND the box is not
// focused (so external inserts like template buttons still appear).
export default function RichText({
  value, onChange, disabled, placeholder,
}: {
  value: string
  onChange: (html: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!focused && el.innerHTML !== (value || '')) el.innerHTML = value || ''
  }, [value, focused])

  const exec = (cmd: string) => {
    if (disabled) return
    const el = ref.current
    if (!el) return
    el.focus()
    document.execCommand(cmd, false)
    onChange(el.innerHTML)
  }

  const isEmpty = !value || value === '<br>' || value.replace(/<[^>]*>/g, '').trim() === ''

  const Btn = ({ cmd, label, style }: { cmd: string; label: string; style?: React.CSSProperties }) => (
    <button type="button" disabled={disabled} title={label}
      onMouseDown={e => { e.preventDefault(); exec(cmd) }}
      style={{
        minWidth: 32, height: 30, border: '1px solid var(--line)', background: '#fff',
        borderRadius: 6, cursor: disabled ? 'default' : 'pointer', fontSize: 14, color: 'var(--ink)',
        opacity: disabled ? .5 : 1, ...style,
      }}>{label}</button>
  )

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: disabled ? '#F5F7FA' : '#fff' }}>
      {!disabled && (
        <div style={{ display: 'flex', gap: 6, padding: 6, borderBottom: '1px solid var(--line)', background: '#F8FAFC' }}>
          <Btn cmd="bold" label="B" style={{ fontWeight: 800 }} />
          <Btn cmd="italic" label="I" style={{ fontStyle: 'italic' }} />
          <Btn cmd="underline" label="U" style={{ textDecoration: 'underline' }} />
          <span style={{ width: 1, background: 'var(--line)', margin: '2px 2px' }} />
          <Btn cmd="insertUnorderedList" label="• ⋮" />
          <Btn cmd="insertOrderedList" label="1." />
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <div
          ref={ref}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={e => onChange((e.target as HTMLDivElement).innerHTML)}
          onFocus={() => setFocused(true)}
          onBlur={e => { setFocused(false); onChange((e.target as HTMLDivElement).innerHTML) }}
          style={{
            minHeight: 96, padding: '10px 12px', outline: 'none', fontSize: 14, lineHeight: 1.5,
            color: 'var(--ink)', whiteSpace: 'pre-wrap',
          }}
        />
        {isEmpty && !focused && placeholder && (
          <div style={{ position: 'absolute', top: 10, left: 12, color: 'var(--ink-soft)', pointerEvents: 'none', fontSize: 14 }}>
            {placeholder}
          </div>
        )}
      </div>
    </div>
  )
}
