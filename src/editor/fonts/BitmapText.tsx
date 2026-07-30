import { useEffect, useRef } from 'react'
import type { IndexedAsset } from '../../core/assets/types'
import type {
  Ink,
  TextAlign,
  TextOutline,
  TextShadow,
  TextVAlign,
} from '../../core/scene/types'
import {
  drawBitmapText,
  loadPlaydateFont,
  resolveFontAssets,
  resolveFontPath,
} from './playdateFont'

type Props = {
  text: string
  fontPath: string
  align?: TextAlign
  valign?: TextVAlign
  width: number
  height: number
  assets: IndexedAsset[]
  className?: string
  color?: Ink
  outline?: TextOutline | null
  shadow?: TextShadow | null
}

/** Scene/Game text rendered from a Playdate .fnt + glyph atlas. */
export function BitmapText({
  text,
  fontPath,
  align = 'left',
  valign = 'top',
  width,
  height,
  assets,
  className,
  color = 'black',
  outline = null,
  shadow = null,
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

    let cancelled = false
    ctx.clearRect(0, 0, w, h)

    const resolved = resolveFontPath(fontPath)
    const refs = resolveFontAssets(resolved, assets)
    if (!refs) {
      // No OS/monospace fallback — empty box if bundled font cannot resolve.
      console.warn('[BitmapText] font unresolved:', resolved)
      return
    }

    void loadPlaydateFont(refs).then((font) => {
      if (cancelled || !font || !ref.current) return
      const c = ref.current
      const cctx = c.getContext('2d')
      if (!cctx) return
      cctx.clearRect(0, 0, w, h)
      drawBitmapText(cctx, font, {
        text,
        align,
        valign,
        width: w,
        height: h,
        color,
        outline,
        shadow,
      })
    })

    return () => {
      cancelled = true
    }
  }, [text, fontPath, align, valign, width, height, assets, color, outline, shadow])

  return (
    <canvas
      ref={ref}
      className={className}
      width={Math.max(1, Math.round(width))}
      height={Math.max(1, Math.round(height))}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        imageRendering: 'pixelated',
        pointerEvents: 'none',
      }}
    />
  )
}
