/**
 * Nearest-neighbor image rotation matching Playdate
 * `image:drawRotated(x, y, angle)` — center of image at (x,y),
 * angle in degrees. Sampling matches Simulator (SDK 3.x):
 *
 * - C API takes integer x/y (floats are truncated)
 * - Dest sample phase is 0.5 on even axes, 1.0 on odd axes
 * - Inverse uses the clockwise y-down matrix (matches Simulator)
 * - Source X uses half-open (n-1, n] (exact integers map to n-1);
 *   source Y uses standard [n, n+1) via floor
 */
import type { CanvasFactory } from './playdateImage'

/** Tiny bias so values like -1e-16 floor to 0 like Playdate float math. */
const FLOOR_EPS = 1e-4

/** Playdate-like sample index for the X axis of the source bitmap. */
function sampleX(u: number): number {
  // Half-open (n-1, n]: exact integers belong to the previous pixel.
  if (Number.isInteger(u)) return u - 1
  return Math.floor(u)
}

/** Playdate-like sample index for the Y axis of the source bitmap. */
function sampleY(v: number): number {
  return Math.floor(v + FLOOR_EPS)
}

export function drawRotatedNearest(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  centerX: number,
  centerY: number,
  angleDeg: number,
  createCanvas?: CanvasFactory,
): void {
  const sw =
    'width' in source
      ? Number(
          (source as { naturalWidth?: number }).naturalWidth ||
            (source as { width: number }).width,
        )
      : 0
  const sh =
    'height' in source
      ? Number(
          (source as { naturalHeight?: number }).naturalHeight ||
            (source as { height: number }).height,
        )
      : 0
  if (sw <= 0 || sh <= 0) return

  const make =
    createCanvas ??
    ((w: number, h: number) => {
      if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      return c
    })

  const scratch = make(sw, sh)
  const sctx = scratch.getContext('2d')
  if (!sctx) return
  sctx.imageSmoothingEnabled = false
  sctx.clearRect(0, 0, sw, sh)
  sctx.drawImage(source, 0, 0)
  const src = sctx.getImageData(0, 0, sw, sh)

  // Match C API `drawRotatedBitmap(..., int x, int y, ...)`
  const cx = Math.trunc(centerX)
  const cy = Math.trunc(centerY)

  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const hw = sw / 2
  const hh = sh / 2
  // Empirically matches Simulator: odd size → phase 1 on that axis, else 0.5.
  const phaseX = sw % 2 !== 0 ? 1 : 0.5
  const phaseY = sh % 2 !== 0 ? 1 : 0.5

  const corners = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ] as const
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [lx, ly] of corners) {
    const rx = lx * cos - ly * sin
    const ry = lx * sin + ly * cos
    minX = Math.min(minX, rx)
    maxX = Math.max(maxX, rx)
    minY = Math.min(minY, ry)
    maxY = Math.max(maxY, ry)
  }
  const x0 = Math.floor(cx + minX) - 1
  const y0 = Math.floor(cy + minY) - 1
  const x1 = Math.ceil(cx + maxX) + 1
  const y1 = Math.ceil(cy + maxY) + 1
  const dw = Math.max(1, x1 - x0)
  const dh = Math.max(1, y1 - y0)

  const out = ctx.createImageData(dw, dh)
  const od = out.data
  const sd = src.data

  for (let py = 0; py < dh; py++) {
    for (let px = 0; px < dw; px++) {
      const dx = x0 + px + phaseX - cx
      const dy = y0 + py + phaseY - cy
      // Sample inverse that matches Playdate Simulator (clockwise y-down matrix).
      const lx = dx * cos + dy * sin
      const ly = -dx * sin + dy * cos
      const sx = sampleX(lx + hw)
      const sy = sampleY(ly + hh)
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue
      const si = (sy * sw + sx) * 4
      const a = sd[si + 3]!
      if (a < 16) continue
      const oi = (py * dw + px) * 4
      od[oi] = sd[si]!
      od[oi + 1] = sd[si + 1]!
      od[oi + 2] = sd[si + 2]!
      od[oi + 3] = a
    }
  }

  const tmp = make(dw, dh)
  const tctx = tmp.getContext('2d')
  if (!tctx) return
  tctx.putImageData(out, 0, 0)
  ctx.drawImage(tmp as CanvasImageSource, x0, y0)
}
