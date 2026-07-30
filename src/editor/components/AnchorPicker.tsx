type Props = {
  value: { x: number; y: number }
  disabled?: boolean
  onChange: (anchor: { x: number; y: number }) => void
}

const CELLS: Array<{ x: number; y: number; label: string }> = [
  { x: 0, y: 0, label: 'TL' },
  { x: 0.5, y: 0, label: 'TC' },
  { x: 1, y: 0, label: 'TR' },
  { x: 0, y: 0.5, label: 'ML' },
  { x: 0.5, y: 0.5, label: 'C' },
  { x: 1, y: 0.5, label: 'MR' },
  { x: 0, y: 1, label: 'BL' },
  { x: 0.5, y: 1, label: 'BC' },
  { x: 1, y: 1, label: 'BR' },
]

export function AnchorPicker({ value, disabled = false, onChange }: Props) {
  return (
    <div className="anchor-picker" role="group" aria-label="Anchor">
      {CELLS.map((c) => {
        const active = value.x === c.x && value.y === c.y
        return (
          <button
            key={c.label}
            type="button"
            className={`anchor-cell${active ? ' is-active' : ''}`}
            title={`Anchor ${c.label}`}
            disabled={disabled}
            onClick={() => onChange({ x: c.x, y: c.y })}
          />
        )
      })}
    </div>
  )
}
