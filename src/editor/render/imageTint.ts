import type { ImageTint } from '../../core/scene/types'

/**
 * Approximate Playdate `kDrawModeFillWhite` / `FillBlack` on a clear bitmap:
 * opaque ink → solid tint color; transparency stays clear.
 *
 * MUST run on an offscreen image (or empty canvas), then blit the result.
 * Applying this to a scene framebuffer after drawImage recolors the
 * background showing through transparent holes — selected-row icons on a
 * black chip become solid white squares.
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
