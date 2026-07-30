import type { CSSProperties } from 'react'
import type { DitherPattern, FrameStyle, Ink, ShapeStroke } from '../../core/scene/types'

export function InkSwatch({ color }: { color: Ink }) {
  return (
    <span
      className={`ink-swatch ink-swatch--${color}`}
      aria-hidden
    />
  )
}

export function AlignPreview({ align }: { align: 'left' | 'center' | 'right' }) {
  return (
    <span className={`align-preview align-preview--${align}`} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  )
}

export function VAlignPreview({
  valign,
}: {
  valign: 'top' | 'middle' | 'bottom'
}) {
  return (
    <span className={`valign-preview valign-preview--${valign}`} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  )
}

export function FrameStylePreview({ style }: { style: FrameStyle }) {
  return <span className={`frame-style-preview frame-style-preview--${style}`} aria-hidden />
}

export function StrokeKindPreview({ kind }: { kind: ShapeStroke['kind'] }) {
  return <span className={`stroke-kind-preview stroke-kind-preview--${kind}`} aria-hidden />
}

export function FillKindPreview({
  kind,
}: {
  kind: 'none' | 'solid' | 'dither' | 'gradient'
}) {
  return <span className={`fill-kind-preview fill-kind-preview--${kind}`} aria-hidden />
}

export function DitherPatternPreview({ pattern }: { pattern: DitherPattern }) {
  const style: CSSProperties = {}
  switch (pattern) {
    case 'horizontal':
      style.backgroundImage =
        'repeating-linear-gradient(0deg,#0a0a0a 0 1px,transparent 1px 2px)'
      break
    case 'vertical':
      style.backgroundImage =
        'repeating-linear-gradient(90deg,#0a0a0a 0 1px,transparent 1px 2px)'
      break
    case 'diagonal':
      style.backgroundImage =
        'repeating-linear-gradient(45deg,#0a0a0a 0 1px,transparent 1px 2px)'
      break
    case 'screen':
      style.backgroundImage = `
        repeating-linear-gradient(0deg,#0a0a0a 0 1px,transparent 1px 4px),
        repeating-linear-gradient(90deg,#0a0a0a 0 1px,transparent 1px 4px)`
      break
    case 'checker':
      style.backgroundImage =
        'repeating-conic-gradient(#0a0a0a 0% 25%, #f2efe4 0% 50%)'
      style.backgroundSize = '6px 6px'
      break
    case 'dots':
      style.backgroundImage =
        'radial-gradient(#0a0a0a 1px, transparent 1px)'
      style.backgroundSize = '6px 6px'
      break
    case 'bayer2':
      style.backgroundImage =
        'repeating-conic-gradient(#0a0a0a 0% 25%, #f2efe4 0% 50%)'
      style.backgroundSize = '4px 4px'
      break
    case 'bayer4':
      style.backgroundImage =
        'repeating-conic-gradient(#0a0a0a 0% 25%, #f2efe4 0% 50%)'
      style.backgroundSize = '8px 8px'
      break
    default:
      // bayer8 and unknowns
      style.backgroundImage =
        'repeating-conic-gradient(#0a0a0a 0% 25%, #f2efe4 0% 50%)'
      style.backgroundSize = '3px 3px'
  }
  return (
    <span className="dither-pattern-preview" style={style} aria-hidden />
  )
}
