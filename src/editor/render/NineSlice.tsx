import { useEffect, useRef } from 'react'

export type SliceInsets = {
  left: number
  right: number
  top: number
  bottom: number
}

type Props = {
  src: string
  slice: SliceInsets
  width: number
  height: number
  className?: string
}

/**
 * Playdate-style 9-slice: corners 1:1, edges/center tiled (not stretched).
 * Matches drawNineSlice in drawSceneToCanvas.ts / gfx.nineSlice:drawTiled.
 */
export function NineSlice({ src, slice, width, height, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let cancelled = false
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      if (cancelled || !ref.current) return
      const nw = img.naturalWidth
      const nh = img.naturalHeight
      const L = Math.max(0, Math.min(slice.left, nw))
      const R = Math.max(0, Math.min(slice.right, nw - L))
      const T = Math.max(0, Math.min(slice.top, nh))
      const B = Math.max(0, Math.min(slice.bottom, nh - T))
      const midW = Math.max(0, nw - L - R)
      const midH = Math.max(0, nh - T - B)

      let outW = Math.floor(width)
      let outH = Math.floor(height)
      const minW = L + R
      const minH = T + B
      if (outW < minW) outW = minW
      if (outH < minH) outH = minH
      const outMidW = Math.max(0, outW - L - R)
      const outMidH = Math.max(0, outH - T - B)

      canvas.width = outW
      canvas.height = outH
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, outW, outH)

      const blit = (
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        x: number,
        y: number,
      ) => {
        if (sw <= 0 || sh <= 0) return
        ctx.drawImage(img, sx, sy, sw, sh, x, y, sw, sh)
      }
      const tile = (
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        x: number,
        y: number,
        tw: number,
        th: number,
      ) => {
        if (sw <= 0 || sh <= 0 || tw <= 0 || th <= 0) return
        for (let oy = 0; oy < th; oy += sh) {
          for (let ox = 0; ox < tw; ox += sw) {
            const cw = Math.min(sw, tw - ox)
            const ch = Math.min(sh, th - oy)
            ctx.drawImage(img, sx, sy, cw, ch, x + ox, y + oy, cw, ch)
          }
        }
      }

      blit(0, 0, L, T, 0, 0)
      tile(L, 0, midW, T, L, 0, outMidW, T)
      blit(nw - R, 0, R, T, L + outMidW, 0)
      tile(0, T, L, midH, 0, T, L, outMidH)
      tile(L, T, midW, midH, L, T, outMidW, outMidH)
      tile(nw - R, T, R, midH, L + outMidW, T, R, outMidH)
      blit(0, nh - B, L, B, 0, T + outMidH)
      tile(L, nh - B, midW, B, L, T + outMidH, outMidW, B)
      blit(nw - R, nh - B, R, B, L + outMidW, T + outMidH)
    }
    img.onerror = () => {
      /* missing */
    }
    img.src = src
    return () => {
      cancelled = true
    }
  }, [src, slice.left, slice.right, slice.top, slice.bottom, width, height])

  return (
    <canvas
      ref={ref}
      className={['nine-slice', className].filter(Boolean).join(' ')}
      width={Math.max(1, Math.floor(width))}
      height={Math.max(1, Math.floor(height))}
      style={{
        width,
        height,
        display: 'block',
        imageRendering: 'pixelated',
      }}
    />
  )
}
