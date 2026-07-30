import type { ImageTint } from '../../core/scene/types'

/**
 * Approximate Playdate `kDrawModeFillWhite` / `FillBlack` on a rect that was
 * just blitted: opaque ink → solid tint color; transparency stays clear.
 * CSS `filter: brightness() invert()` is NOT equivalent — it floods the
 * element's paint bounds and turns sparse stamps into solid rectangles.
 */
export function applyImageTint(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tint: ImageTint | undefined,
): void {
  if (!tint || tint === 'none' || w < 1 || h < 1) return
  const id = ctx.getImageData(x, y, w, h)
  const px = id.data
  const ink = tint === 'white' ? 255 : 0
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3]! < 16) continue
    px[i] = ink
    px[i + 1] = ink
    px[i + 2] = ink
  }
  ctx.putImageData(id, x, y)
}
