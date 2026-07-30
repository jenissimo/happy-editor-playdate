import type { IndexedAsset } from '../../core/assets/types'
import type { ImageNode } from '../../core/scene/types'

export type ImagetableRef =
  | {
      kind: 'matrix'
      sheetUrl: string
      cellW: number
      cellH: number
    }
  | {
      kind: 'sequential'
      /** Sorted by frame index; Playdate 1-based index = array index + 1 if contiguous. */
      frames: Array<{ index: number; url: string }>
    }

/** Resolve Playdate imagetable assets for a logical basePath. */
export function resolveImagetable(
  basePath: string,
  assets: IndexedAsset[],
): ImagetableRef | null {
  const norm = basePath.replace(/\\/g, '/').replace(/\.png$/i, '')
  const matrix = assets.find(
    (a) => a.kind === 'table' && a.basePath === norm && a.cell,
  )
  if (matrix?.cell) {
    return {
      kind: 'matrix',
      sheetUrl: matrix.previewUrl,
      cellW: matrix.cell.w,
      cellH: matrix.cell.h,
    }
  }
  const seq = assets
    .filter(
      (a) =>
        a.kind === 'table' && a.basePath === norm && a.frameIndex != null,
    )
    .sort((a, b) => (a.frameIndex ?? 0) - (b.frameIndex ?? 0))
  if (seq.length === 0) return null
  return {
    kind: 'sequential',
    frames: seq.map((a) => ({
      index: a.frameIndex!,
      url: a.previewUrl,
    })),
  }
}

export function animFrameIndex(opts: {
  timeSec: number
  fps: number
  loop: boolean
  frameStart: number
  frameEnd: number
  /** Used when fps <= 0 */
  staticFrame?: number
}): number {
  const start = Math.max(1, Math.floor(opts.frameStart))
  const stop = Math.max(start, Math.floor(opts.frameEnd))
  if (opts.fps <= 0) {
    const f = opts.staticFrame ?? start
    return Math.min(stop, Math.max(start, Math.floor(f)))
  }
  const n = stop - start + 1
  const ticks = Math.floor(opts.timeSec * opts.fps)
  if (opts.loop) {
    return start + ((ticks % n) + n) % n
  }
  return Math.min(stop, start + ticks)
}

export function imageAnimParams(node: ImageNode, tableLen: number) {
  const frameStart = node.frameStart ?? 1
  const frameEnd = node.frameEnd ?? tableLen
  const fps = node.fps ?? 0
  const loop = node.loop !== false
  return { frameStart, frameEnd, fps, loop, staticFrame: node.frame }
}

type CanvasLike = {
  width: number
  height: number
  getContext(type: '2d'): CanvasRenderingContext2D | null
}

export type FrameBitmap = HTMLCanvasElement | OffscreenCanvas

/** Slice a matrix sheet into 1-based Playdate frame bitmaps (row-major). */
export function sliceMatrixFrames(
  sheet: CanvasImageSource & { width: number; height: number },
  cellW: number,
  cellH: number,
  makeCanvas: (w: number, h: number) => CanvasLike,
): FrameBitmap[] {
  const cols = Math.max(1, Math.floor(sheet.width / cellW))
  const rows = Math.max(1, Math.floor(sheet.height / cellH))
  const out: FrameBitmap[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = makeCanvas(cellW, cellH)
      const ctx = c.getContext('2d')
      if (!ctx) continue
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, cellW, cellH)
      ctx.drawImage(
        sheet,
        col * cellW,
        row * cellH,
        cellW,
        cellH,
        0,
        0,
        cellW,
        cellH,
      )
      out.push(c as FrameBitmap)
    }
  }
  return out
}
