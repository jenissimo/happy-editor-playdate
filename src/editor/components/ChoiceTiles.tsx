import type { ReactNode } from 'react'

type Option<T extends string> = {
  value: T
  label: string
  title?: string
  preview?: ReactNode
}

type Props<T extends string> = {
  label?: string
  value: T
  options: Option<T>[]
  disabled?: boolean
  columns?: number
  onChange: (value: T) => void
}

export function ChoiceTiles<T extends string>({
  label,
  value,
  options,
  disabled = false,
  columns,
  onChange,
}: Props<T>) {
  return (
    <div className="choice-tiles">
      {label && <span className="choice-tiles__label">{label}</span>}
      <div
        className="choice-tiles__grid"
        style={
          columns
            ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
            : undefined
        }
        role="listbox"
        aria-label={label}
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="option"
            aria-selected={value === opt.value}
            title={opt.title ?? opt.label}
            disabled={disabled}
            className={`choice-tile${value === opt.value ? ' is-active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.preview && (
              <span className="choice-tile__preview">{opt.preview}</span>
            )}
            <span className="choice-tile__label">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
