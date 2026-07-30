import happyDog from '../../assets/happy_dog.gif'
import type { NibbleStatus } from './nibbleStatus'

/** Native pixel size of Nibble sprites (`happy_dog.gif` and future slots). */
export const NIBBLE_NATIVE_SIZE = 32

/**
 * Asset slots for Nibble moods. Until unique art exists, every status falls
 * back to happy_dog.gif and CSS modifiers carry the visual cue.
 */
const NIBBLE_ASSETS: Record<NibbleStatus, string> = {
  idle: happyDog,
  thinking: happyDog,
  success: happyDog,
  error: happyDog,
  unconfigured: happyDog,
}

/** Snap display size to an integer scale of the native sprite (…½×, 1×, 2×…). */
export function nibbleIntegerSize(requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return NIBBLE_NATIVE_SIZE
  const scale = requested / NIBBLE_NATIVE_SIZE
  if (scale >= 1) {
    return Math.max(1, Math.round(scale)) * NIBBLE_NATIVE_SIZE
  }
  // Downscale: only exact power-of-two divisions stay on the pixel grid.
  let size = NIBBLE_NATIVE_SIZE
  while (size / 2 >= 1 && Math.abs(size / 2 - requested) <= Math.abs(size - requested)) {
    size /= 2
  }
  return size
}

type Props = {
  status: NibbleStatus
  /** Desired CSS px; snapped to an integer scale of the 32×32 sprite. */
  size?: number
  className?: string
  title?: string
  onClick?: () => void
  interactive?: boolean
}

export function NibbleMascot({
  status,
  size = 16,
  className = '',
  title,
  onClick,
  interactive = false,
}: Props) {
  const px = nibbleIntegerSize(size)
  const src = NIBBLE_ASSETS[status]
  const classes = [
    'nibble-mascot',
    `nibble-mascot--${status}`,
    interactive ? 'nibble-mascot--interactive' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const img = (
    <img
      src={src}
      alt=""
      width={px}
      height={px}
      draggable={false}
      style={{ width: px, height: px }}
    />
  )

  if (interactive || onClick) {
    return (
      <button
        type="button"
        className={classes}
        title={title}
        onClick={onClick}
        aria-label={title ?? 'Nibble'}
      >
        {img}
      </button>
    )
  }

  return (
    <span className={classes} title={title}>
      {img}
    </span>
  )
}
