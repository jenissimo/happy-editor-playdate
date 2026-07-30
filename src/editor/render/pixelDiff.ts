import { PNG } from 'pngjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type PixelDiffResult = {
  equal: boolean
  width: number
  height: number
  mismatched: number
  total: number
  maxChannelDelta: number
  /** Diff PNG path if written */
  diffPath?: string
}

/** Compare two PNGs; optionally write an RGB diff highlight. */
export function diffPngFiles(
  aPath: string,
  bPath: string,
  opts?: { diffOut?: string; threshold?: number },
): PixelDiffResult {
  const a = PNG.sync.read(readFileSync(aPath))
  const b = PNG.sync.read(readFileSync(bPath))
  const width = Math.min(a.width, b.width)
  const height = Math.min(a.height, b.height)
  const threshold = opts?.threshold ?? 0
  let mismatched = 0
  let maxChannelDelta = 0
  const diff = new PNG({ width, height })

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      // Map from source stride if sizes differ
      const ai = (y * a.width + x) * 4
      const bi = (y * b.width + x) * 4
      const dr = Math.abs((a.data[ai] ?? 0) - (b.data[bi] ?? 0))
      const dg = Math.abs((a.data[ai + 1] ?? 0) - (b.data[bi + 1] ?? 0))
      const db = Math.abs((a.data[ai + 2] ?? 0) - (b.data[bi + 2] ?? 0))
      const delta = Math.max(dr, dg, db)
      maxChannelDelta = Math.max(maxChannelDelta, delta)
      if (delta > threshold) {
        mismatched++
        diff.data[i] = 255
        diff.data[i + 1] = 0
        diff.data[i + 2] = 0
        diff.data[i + 3] = 255
      } else {
        // dim original for context
        const g = a.data[ai] ?? 0
        diff.data[i] = g
        diff.data[i + 1] = g
        diff.data[i + 2] = g
        diff.data[i + 3] = 255
      }
    }
  }

  const result: PixelDiffResult = {
    equal:
      mismatched === 0 && a.width === b.width && a.height === b.height,
    width,
    height,
    mismatched,
    total: width * height,
    maxChannelDelta,
  }

  if (opts?.diffOut) {
    mkdirSync(dirname(opts.diffOut), { recursive: true })
    writeFileSync(opts.diffOut, PNG.sync.write(diff))
    result.diffPath = opts.diffOut
  }

  return result
}

/** Quantize near-white/near-black to pure 1-bit (simulator sometimes uses gray). */
export function quantizePngTo1Bit(path: string, outPath: string) {
  const png = PNG.sync.read(readFileSync(path))
  for (let i = 0; i < png.data.length; i += 4) {
    const lum =
      ((png.data[i] ?? 0) + (png.data[i + 1] ?? 0) + (png.data[i + 2] ?? 0)) / 3
    const v = lum >= 128 ? 255 : 0
    png.data[i] = v
    png.data[i + 1] = v
    png.data[i + 2] = v
    png.data[i + 3] = 255
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, PNG.sync.write(png))
}
