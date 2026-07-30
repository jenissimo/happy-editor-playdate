type Props = {
  sceneStates: string[]
  /** Empty = all states. */
  value: string[]
  disabled?: boolean
  onChange: (next: string[]) => void
}

/**
 * Toggle chips: All (empty membership) + each scene state.
 */
export function StateMembership({
  sceneStates,
  value,
  disabled,
  onChange,
}: Props) {
  const isAll = value.length === 0

  const setAll = () => {
    if (disabled) return
    onChange([])
  }

  const toggle = (state: string) => {
    if (disabled) return
    if (isAll) {
      onChange([state])
      return
    }
    if (value.includes(state)) {
      const next = value.filter((s) => s !== state)
      onChange(next)
      return
    }
    onChange([...value, state])
  }

  return (
    <div className="state-membership" role="group" aria-label="Node states">
      <button
        type="button"
        className={`chip${isAll ? ' is-active' : ''}`}
        disabled={disabled}
        title="Visible in all states"
        onClick={setAll}
      >
        All
      </button>
      {sceneStates.map((s) => {
        const on = !isAll && value.includes(s)
        return (
          <button
            key={s}
            type="button"
            className={`chip${on ? ' is-active' : ''}`}
            disabled={disabled}
            title={`Visible in "${s}"`}
            onClick={() => toggle(s)}
          >
            {s}
          </button>
        )
      })}
    </div>
  )
}
