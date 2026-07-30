import { useEffect, useMemo, useRef, useState } from 'react'
import type { Command } from '../commands/registry'

type Props = {
  open: boolean
  commands: Command[]
  onClose: () => void
  onRun: (id: string) => void
}

export function CommandPalette({ open, commands, onClose, onRun }: Props) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = commands.filter((c) => c.enabled())
    if (!q) return list
    return list.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.shortcut?.toLowerCase().includes(q) ?? false),
    )
  }, [commands, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    const t = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [open])

  useEffect(() => {
    setIndex(0)
  }, [query])

  if (!open) return null

  const runAt = (i: number) => {
    const cmd = filtered[i]
    if (!cmd) return
    onRun(cmd.id)
    onClose()
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(filtered.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              runAt(index)
            }
          }}
        />
        <ul className="palette-list">
          {filtered.length === 0 && (
            <li className="palette-empty">No matching commands</li>
          )}
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                className={`palette-row${i === index ? ' is-active' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => runAt(i)}
              >
                <span className="palette-title">{c.title}</span>
                {c.shortcut && (
                  <kbd className="palette-shortcut">{c.shortcut}</kbd>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className="palette-hint">Enter to run · Esc to close</div>
      </div>
    </div>
  )
}
