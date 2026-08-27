import { useEffect, useState } from 'react'
import { fmtTime, parseTimeInput } from '../lib'

export default function TimeInput({
  value,
  onCommit,
  className
}: {
  value: number
  onCommit: (ms: number) => void
  className?: string
}) {
  const [text, setText] = useState(() => fmtTime(value))
  const [editing, setEditing] = useState(false)
  const invalid = editing && parseTimeInput(text) == null

  useEffect(() => {
    if (!editing) setText(fmtTime(value))
  }, [value, editing])

  return (
    <input
      className={`time-input ${invalid ? 'invalid' : ''} ${className ?? ''}`}
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false)
        const ms = parseTimeInput(text)
        if (ms != null && ms !== value) onCommit(ms)
        else setText(fmtTime(value))
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setText(fmtTime(value))
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}
