import { useEffect, useMemo, useRef, useState } from 'react'
import type { IndexedAsset } from '../../core/assets/types'
import { DEFAULT_FONT } from '../../core/scene/defaults'
import { FontSample } from '../fonts/FontSample'
import { resolveFontPath } from '../fonts/playdateFont'
import { useEditorContext } from '../state/EditorContext'

type Props = {
  value: string
  disabled?: boolean
  onChange: (fontBasePath: string) => void
  /** Compact dropdown for the options bar; full list for Inspector. */
  compact?: boolean
}

export function FontPicker({
  value,
  disabled = false,
  onChange,
  compact = false,
}: Props) {
  const { assets } = useEditorContext()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const resolvedValue = resolveFontPath(value)

  const fonts = useMemo(() => {
    const list = assets.filter((a) => a.kind === 'font')
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (a) =>
        a.basePath.toLowerCase().includes(q) ||
        a.relativePath.toLowerCase().includes(q),
    )
  }, [assets, query])

  const selected = fonts.find((f) => f.basePath === resolvedValue)
  const selectedName =
    selected?.relativePath.split('/').pop()?.replace(/\.fnt$/i, '') ??
    resolvedValue.split('/').pop() ??
    DEFAULT_FONT

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (compact) {
    return (
      <div className="font-picker font-picker--compact" ref={rootRef}>
        <button
          type="button"
          className="font-picker__trigger"
          disabled={disabled}
          title={resolvedValue}
          onClick={() => setOpen((v) => !v)}
        >
          {selected ? (
            <FontSample
              font={selected}
              assets={assets}
              sample="Aa"
              height={20}
              scale={1}
              className="font-picker__trigger-sample"
            />
          ) : (
            <span className="font-row__preview">Aa</span>
          )}
          <span className="font-picker__trigger-label">{selectedName}</span>
        </button>
        {open && (
          <div className="font-picker__pop">
            <input
              className="search-input"
              placeholder="Filter fonts…"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="font-picker__list font-picker__list--samples">
              {fonts.map((font) => (
                <li key={font.relativePath}>
                  <FontRow
                    font={font}
                    active={resolvedValue === font.basePath}
                    disabled={false}
                    assets={assets}
                    onSelect={() => {
                      onChange(font.basePath)
                      setOpen(false)
                    }}
                  />
                </li>
              ))}
              {fonts.length === 0 && <li className="empty">No fonts</li>}
            </ul>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="font-picker">
      <div className="font-picker__toolbar">
        <input
          className="search-input"
          placeholder="Filter fonts…"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <ul className="font-picker__list font-picker__list--samples">
        {fonts.map((font) => (
          <li key={font.relativePath}>
            <FontRow
              font={font}
              active={resolvedValue === font.basePath}
              disabled={disabled}
              assets={assets}
              onSelect={() => onChange(font.basePath)}
            />
          </li>
        ))}
        {fonts.length === 0 && <li className="empty">No fonts</li>}
      </ul>
    </div>
  )
}

function FontRow({
  font,
  active,
  disabled,
  assets,
  onSelect,
}: {
  font: IndexedAsset
  active: boolean
  disabled: boolean
  assets: IndexedAsset[]
  onSelect: () => void
}) {
  const name =
    font.relativePath.split('/').pop()?.replace(/\.fnt$/i, '') ?? font.basePath
  return (
    <button
      type="button"
      className={`font-row font-row--sample${active ? ' is-active' : ''}`}
      disabled={disabled}
      onClick={onSelect}
      title={font.basePath}
    >
      <FontSample
        font={font}
        assets={assets}
        sample={`${name} · Aa`}
        height={32}
        scale={2}
      />
      <span className="font-row__meta">
        <span className="font-row__name">{name}</span>
        <span className="font-row__path mono">{font.basePath}</span>
      </span>
    </button>
  )
}
