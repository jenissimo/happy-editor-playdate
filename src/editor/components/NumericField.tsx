import {
  useRef,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

type Props = {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
  disabled?: boolean
  className?: string
}

function clamp(n: number, min?: number, max?: number): number {
  let v = n
  if (min != null) v = Math.max(min, v)
  if (max != null) v = Math.min(max, v)
  return v
}

function stepScale(e: { shiftKey: boolean; altKey: boolean }): number {
  if (e.shiftKey) return 10
  if (e.altKey) return 0.1
  return 1
}

export function NumericField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  disabled = false,
  className,
}: Props) {
  const scrubRef = useRef<{
    startX: number
    startValue: number
    pointerId: number
  } | null>(null)

  const commit = (next: number) => {
    const rounded = Math.round(next * 1000) / 1000
    onChange(clamp(rounded, min, max))
  }

  const onLabelPointerDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (disabled || e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    scrubRef.current = {
      startX: e.clientX,
      startValue: value,
      pointerId: e.pointerId,
    }
  }

  const onLabelPointerMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const scrub = scrubRef.current
    if (!scrub || scrub.pointerId !== e.pointerId) return
    const dx = e.clientX - scrub.startX
    const scaled = step * stepScale(e)
    commit(scrub.startValue + Math.round(dx) * scaled)
  }

  const onLabelPointerUp = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (scrubRef.current?.pointerId === e.pointerId) {
      scrubRef.current = null
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
    }
  }

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    commit(n)
  }

  return (
    <label className={['numeric-field', className].filter(Boolean).join(' ')}>
      <span
        className="numeric-field__label"
        onPointerDown={onLabelPointerDown}
        onPointerMove={onLabelPointerMove}
        onPointerUp={onLabelPointerUp}
        onPointerCancel={onLabelPointerUp}
      >
        {label}
      </span>
      <input
        type="number"
        className="numeric-field__input"
        value={value}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={onInputChange}
      />
    </label>
  )
}
