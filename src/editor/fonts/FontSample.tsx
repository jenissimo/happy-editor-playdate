import { useEffect, useRef } from 'react'
import type { IndexedAsset } from '../../core/assets/types'
import {
  drawBitmapText,
  loadPlaydateFont,
  measureGlyphRun,
  resolveFontAssets,
} from './playdateFont'

type Props = {
  font: IndexedAsset
  /** Sample string — Photoshop-style name/Aa preview. */
  sample?: string
  assets: IndexedAsset[]
  className?: string
  /** CSS pixel height of the preview strip. */
  height?: number
  scale?: number
}

/** Wide sample strip: glyphs rendered from the font atlas (not the raw sheet). */
export function FontSample({
  font,
  sample,
  assets,
  className,
  height = 28,
  scale = 2,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const label =
    sample ??
    (font.relativePath.split('/').pop()?.replace(/\.fnt$/i, '') ?? 'Aa')

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let cancelled = false

    const refs = resolveFontAssets(font.basePath, assets)
    if (!refs) {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width = 80
      canvas.height = height
      ctx.fillStyle = '#f2efe4'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      // No OS/monospace fallback — blank sample if atlas missing.
      return
    }

    void loadPlaydateFont(refs).then((loaded) => {
      if (cancelled || !loaded || !ref.current) return
      const text = label
      const naturalW = Math.max(8, measureGlyphRun(loaded, text) + 4)
      const naturalH = loaded.cellH + 4
      const s = Math.max(1, scale)
      const cw = naturalW * s
      const ch = naturalH * s
      const c = ref.current
      c.width = cw
      c.height = ch
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.imageSmoothingEnabled = false
      ctx.fillStyle = '#f2efe4'
      ctx.fillRect(0, 0, cw, ch)
      // Draw at 1× into an offscreen, then scale up for crisp pixels
      const off = document.createElement('canvas')
      off.width = naturalW
      off.height = naturalH
      const octx = off.getContext('2d')
      if (!octx) return
      octx.imageSmoothingEnabled = false
      octx.fillStyle = '#f2efe4'
      octx.fillRect(0, 0, naturalW, naturalH)
      drawBitmapText(octx, loaded, {
        text,
        align: 'left',
        x: 2,
        y: 2,
        width: naturalW - 2,
        height: naturalH - 2,
      })
      ctx.drawImage(off, 0, 0, cw, ch)
    })

    return () => {
      cancelled = true
    }
  }, [font, label, assets, height, scale])

  return (
    <canvas
      ref={ref}
      className={['font-sample-canvas', className].filter(Boolean).join(' ')}
      aria-hidden
      style={{
        display: 'block',
        height,
        width: 'auto',
        maxWidth: '100%',
        imageRendering: 'pixelated',
        background: '#f2efe4',
        borderRadius: 2,
      }}
    />
  )
}
