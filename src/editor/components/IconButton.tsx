import type { Icon } from '@phosphor-icons/react'

type Size = 14 | 16 | 18

type Props = {
  icon: Icon
  title: string
  active?: boolean
  disabled?: boolean
  danger?: boolean
  onClick?: () => void
  size?: Size
  className?: string
}

export function IconButton({
  icon: IconComp,
  title,
  active = false,
  disabled = false,
  danger = false,
  onClick,
  size = 16,
  className,
}: Props) {
  const classes = [
    'icon-btn',
    active ? 'icon-btn--active' : '',
    disabled ? 'icon-btn--disabled' : '',
    danger ? 'icon-btn--danger' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={classes}
      title={title}
      aria-label={title}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <IconComp size={size} weight="regular" aria-hidden />
    </button>
  )
}
