/**
 * Match Playdate `pdc` import of color/grayscale PNGs:
 * luminance threshold → 1-bit black/white, alpha → transparency mask.
 * No ordered dither (SDK does not dither at import).
 *
 * Editor framebuffer draws through this at runtime so color source assets
 * preview like the Simulator without rewriting files on disk.
 */

/** Minimal 2d surface — HTMLCanvasElement or OffscreenCanvas. */
export type BitmapCanvas = {
  width: number
  height: number
  getContext: (
    id: '2d',
  ) => CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
}

export type CanvasFactory = (w: number, h: number) => BitmapCanvas

/** Default threshold used by Playdate's simple greyscale→1-bit import. */
export const PLAYDATE_1BIT_THRESHOLD = 128

/** Opaque alpha cutoff for the transparency mask. */
export const PLAYDATE_ALPHA_CUTOFF = 128

function luminance(r: number, g: number, b: number): number {
  // Integer approx of Rec.601 — stable across Node/browser.
  return (r * 299 + g * 587 + b * 114) / 1000
}

/** Quantize RGBA buffer in place to Playdate 1-bit (+ mask). */
export function quantizeRgbaToPlaydate1Bit(
  data: Uint8ClampedArray,
  threshold = PLAYDATE_1BIT_THRESHOLD,
  alphaCutoff = PLAYDATE_ALPHA_CUTOFF,
): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!
    if (a < alphaCutoff) {
      data[i] = 0
      data[i + 1] = 0
      data[i + 2] = 0
      data[i + 3] = 0
      continue
    }
    const lum = luminance(data[i]!, data[i + 1]!, data[i + 2]!)
    if (lum < threshold) {
      data[i] = 0
      data[i + 1] = 0
      data[i + 2] = 0
      data[i + 3] = 255
    } else {
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = 255
    }
  }
}

export function quantizeImageDataToPlaydate1Bit(
  image: ImageData,
  threshold = PLAYDATE_1BIT_THRESHOLD,
): ImageData {
  const out = new ImageData(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height,
  )
  quantizeRgbaToPlaydate1Bit(out.data, threshold)
  return out
}

function sourceSize(source: CanvasImageSource): { w: number; h: number } {
  const any = source as {
    width?: number
    height?: number
    naturalWidth?: number
    naturalHeight?: number
  }
  return {
    w: (any.naturalWidth && any.naturalWidth > 0 ? any.naturalWidth : any.width) || 0,
    h: (any.naturalHeight && any.naturalHeight > 0 ? any.naturalHeight : any.height) || 0,
  }
}

const cache = new WeakMap<object, ReturnType<CanvasFactory>>()

function defaultCreateCanvas(w: number, h: number) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h)
  }
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/**
 * Return a cached 1-bit (+ mask) bitmap for drawing, matching Playdate import.
 * Already-1-bit assets pass through unchanged in appearance.
 */
export function asPlaydateBitmap(
  source: CanvasImageSource,
  createCanvas: CanvasFactory = defaultCreateCanvas,
): CanvasImageSource {
  const key = source as object
  const hit = cache.get(key)
  if (hit) return hit as CanvasImageSource

  const { w, h } = sourceSize(source)
  if (w <= 0 || h <= 0) return source

  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) return source
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(source, 0, 0)
  const img = ctx.getImageData(0, 0, w, h)
  quantizeRgbaToPlaydate1Bit(img.data)
  ctx.putImageData(img, 0, 0)
  cache.set(key, canvas)
  return canvas as CanvasImageSource
}

export function clearPlaydateBitmapCache() {
  // WeakMap has no clear; drop by replacing module or GC when sources die.
}
