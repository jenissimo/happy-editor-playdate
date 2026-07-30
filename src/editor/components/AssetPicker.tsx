import { useMemo, useState } from 'react'
import type { AssetKind } from '../../core/assets/parseAssetName'
import { describeAsset } from '../../core/assets/parseAssetName'
import { useEditorContext } from '../state/EditorContext'

type Props = {
  value: string
  kinds?: AssetKind[]
  disabled?: boolean
  onChange: (basePath: string) => void
}

export function AssetPicker({
  value,
  kinds = ['image', 'slice'],
  disabled = false,
  onChange,
}: Props) {
  const { assets } = useEditorContext()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    let list = assets.filter((a) => kinds.includes(a.kind))
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (a) =>
          a.basePath.toLowerCase().includes(q) ||
          a.relativePath.toLowerCase().includes(q),
      )
    }
    return list
  }, [assets, kinds, query])

  const selected = assets.find((a) => a.basePath === value)

  return (
    <div className="asset-picker">
      <button
        type="button"
        className="asset-picker__current"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="asset-picker__thumb checker">
          {selected && selected.extension !== 'fnt' ? (
            <img src={selected.previewUrl} alt="" />
          ) : (
            '—'
          )}
        </span>
        <span className="asset-picker__meta">
          <span className="asset-picker__name">
            {selected?.relativePath.split('/').pop() ?? (value || 'None')}
          </span>
          <span className="hint">
            {selected ? describeAsset(selected) : 'Pick asset'}
          </span>
        </span>
      </button>
      {open && (
        <div className="asset-picker__pop">
          <input
            className="search-input"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="asset-picker__grid">
            {filtered.map((a) => (
              <button
                key={a.relativePath}
                type="button"
                className={`asset-picker__item${a.basePath === value ? ' is-active' : ''}`}
                onClick={() => {
                  onChange(a.basePath)
                  setOpen(false)
                }}
                title={a.relativePath}
              >
                <span className="asset-picker__thumb checker">
                  {a.extension !== 'fnt' ? (
                    <img src={a.previewUrl} alt="" />
                  ) : (
                    'Aa'
                  )}
                </span>
                <span className="asset-picker__item-name">
                  {a.relativePath.split('/').pop()}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
