import { useEffect, useRef, type CSSProperties } from 'react'
import type { ImageTint } from '../../core/scene/types'
import { asPlaydateBitmap } from './playdateImage'
import { applyImageTint } from './imageTint'

type Props = {
  src: string
  width: number
  height: number
  tint?: ImageTint
  alt?: string
  className?: string
  draggable?: boolean
  style?: CSSProperties
}

/**
 * Scene-canvas image that matches Preview / device tinting.
 * Avoids CSS filters — those fill the whole node box for transparent stamps.
 */
export function TintedImage({
  src,
  width,
  height,
  tint,
  alt,
  className,
  draggable = false,
  style,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, w, h)

    let cancelled = false
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      if (cancelled || !ref.current) return
      const c = ref.current
      const cctx = c.getContext('2d')
      if (!cctx) return
      cctx.imageSmoothingEnabled = false
      cctx.clearRect(0, 0, w, h)
      const bit = asPlaydateBitmap(img) as CanvasImageSource & {
        width: number
        height: number
      }
      // Draw at native pixel size into the node box (Playdate: no stretch unless w/h differ).
      cctx.drawImage(bit, 0, 0)
      const tw = Math.min(w, Number(bit.width) || w)
      const th = Math.min(h, Number(bit.height) || h)
      applyImageTint(cctx, 0, 0, tw, th, tint)
    }
    img.onerror = () => {
      if (cancelled || !ref.current) return
      const cctx = ref.current.getContext('2d')
      if (!cctx) return
      cctx.strokeStyle = '#000'
      cctx.strokeRect(0.5, 0.5, w - 1, h - 1)
    }
    img.src = src

    return () => {
      cancelled = true
    }
  }, [src, width, height, tint])

  return (
    <canvas
      ref={ref}
      className={className}
      width={Math.max(1, Math.round(width))}
      height={Math.max(1, Math.round(height))}
      aria-label={alt}
      draggable={draggable}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        imageRendering: 'pixelated',
        ...style,
      }}
    />
  )
}
