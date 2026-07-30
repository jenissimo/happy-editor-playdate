import type {
  DitherPattern,
  Ink,
  ShapeFill,
  ShapeNode,
  ShapeStroke,
} from '../../core/scene/types'
import { defaultShapeFill, defaultShapeStroke } from '../../core/scene/types'

/** Bayer 2×2 threshold matrix, normalized 0..1. */
const BAYER2 = [
  [0 / 4, 2 / 4],
  [3 / 4, 1 / 4],
]

/** Bayer 4×4 */
const BAYER4 = [
  [0 / 16, 8 / 16, 2 / 16, 10 / 16],
  [12 / 16, 4 / 16, 14 / 16, 6 / 16],
  [3 / 16, 11 / 16, 1 / 16, 9 / 16],
  [15 / 16, 7 / 16, 13 / 16, 5 / 16],
]

/** Standard Bayer 8×8 thresholds (same table as ui.lua). */
const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
]

function bayer8(x: number, y: number): number {
  return BAYER8[y & 7]![x & 7]! / 64
}

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.min(1, Math.max(0, n))
}

export function inkRgb(color: Ink): [number, number, number] {
  // Match Playdate framebuffer: pure 1-bit black/white (not cream UI chrome).
  return color === 'white' ? [255, 255, 255] : [0, 0, 0]
}

/**
 * Whether pixel (sx,sy) should be inked for a given density 0..1 and pattern.
 * Coordinates are screen-space (same as Playdate patterns).
 * density 0 → never, 1 → always (for Bayer); hatch patterns use density as gate.
 */
export function ditherHit(
  pattern: DitherPattern,
  density: number,
  sx: number,
  sy: number,
): boolean {
  const d = clamp01(density)
  if (d <= 0) return false
  if (d >= 1) return true

  switch (pattern) {
    case 'bayer2': {
      const t = BAYER2[sy & 1]![sx & 1]!
      return d > t
    }
    case 'bayer4': {
      const t = BAYER4[sy & 3]![sx & 3]!
      return d > t
    }
    case 'bayer8':
      return d > bayer8(sx, sy)
    case 'horizontal':
      return (sy & 1) === 0 && d >= 0.25
    case 'vertical':
      return (sx & 1) === 0 && d >= 0.25
    case 'diagonal':
      // Playdate-ish kDitherTypeDiagonalLine
      return ((sx + sy) & 1) === 0 && d >= 0.25
    case 'screen':
      // Wire-screen mesh (SDK kDitherTypeScreen stand-in)
      return ((sx & 3) === 0 || (sy & 3) === 0) && d >= 0.25
    case 'checker':
      return ((sx ^ sy) & 1) === 0 && d >= 0.25
    case 'dots':
      return (sx & 3) === 0 && (sy & 3) === 0 && d >= 0.2
    default:
      return d > 0.5
  }
}

/** Density along a gradient axis at pixel offset `i` in `size` pixels. */
export function gradientDensity(
  from: number,
  to: number,
  i: number,
  size: number,
): number {
  if (size <= 1) return clamp01(to)
  const t = i / (size - 1)
  return clamp01(from + (to - from) * t)
}

/** Round-rect inclusion — matches playdate/Source/ui.lua inRoundRect. */
export function inRoundRect(
  px: number,
  py: number,
  w: number,
  h: number,
  radius: number,
): boolean {
  if (px < 0 || py < 0 || px >= w || py >= h) return false
  let r = radius
  if (r > w / 2) r = Math.floor(w / 2)
  if (r > h / 2) r = Math.floor(h / 2)
  if (r <= 0) return true
  if (px >= r && px < w - r) return true
  if (py >= r && py < h - r) return true
  const dx = px < r ? r - px - 1 : px - (w - r)
  const dy = py < r ? r - py - 1 : py - (h - r)
  return dx * dx + dy * dy <= r * r
}

function onRoundRectStroke(
  px: number,
  py: number,
  w: number,
  h: number,
  r: number,
  thickness: number,
): boolean {
  if (!inRoundRect(px, py, w, h, r)) return false
  const inset = thickness
  if (inset <= 0) return false
  const iw = w - inset * 2
  const ih = h - inset * 2
  if (iw <= 0 || ih <= 0) return true
  const ir = Math.max(0, r - inset)
  return !inRoundRect(px - inset, py - inset, iw, ih, ir)
}

/** Dashed outline along the (optional) round-rect stroke ring. */
function strokeDashedHit(
  px: number,
  py: number,
  w: number,
  h: number,
  thickness: number,
  dash: number,
  gap: number,
  cornerRadius: number,
): boolean {
  const t = Math.max(1, thickness)
  if (!onRoundRectStroke(px, py, w, h, cornerRadius, t)) return false
  const period = Math.max(1, dash + gap)
  const dlen = dash
  const onHoriz = py < t || py >= h - t
  if (onHoriz) {
    const i0 = Math.floor(px / period) * period
    return px - i0 < dlen
  }
  const i0 = Math.floor(py / period) * period
  return py - i0 < dlen
}

function strokeTicksHit(
  px: number,
  py: number,
  w: number,
  h: number,
  thickness: number,
  step: number,
  cornerRadius: number,
): boolean {
  const t = Math.max(1, thickness)
  if (!onRoundRectStroke(px, py, w, h, cornerRadius, t)) return false
  const st = Math.max(2, step)
  // Match ui.lua drawTicksRect: corners are drawn by both edge loops (OR).
  let hit = false
  if (py < t || py >= h - t) {
    for (let i = 0; i < w; i += st * 2) {
      const x2 = Math.min(i + st, w - 1)
      if (px >= i && px <= x2) {
        hit = true
        break
      }
    }
  }
  if (px < t || px >= w - t) {
    for (let i = 0; i < h; i += st * 2) {
      const y2 = Math.min(i + st, h - 1)
      if (py >= i && py <= y2) {
        hit = true
        break
      }
    }
  }
  return hit
}

function fillHit(
  fill: ShapeFill,
  px: number,
  py: number,
  w: number,
  h: number,
  cornerRadius: number,
  ox: number,
  oy: number,
): boolean {
  if (fill.kind === 'none') return false
  if (fill.kind === 'gradient') {
    if (px < 0 || py < 0 || px >= w || py >= h) return false
    if (cornerRadius > 0 && !inRoundRect(px, py, w, h, cornerRadius)) {
      return false
    }
    const dens =
      fill.axis === 'h'
        ? gradientDensity(fill.from, fill.to, px, w)
        : gradientDensity(fill.from, fill.to, py, h)
    return ditherHit('bayer8', dens, ox + px, oy + py)
  }
  if (!inRoundRect(px, py, w, h, cornerRadius)) return false
  if (fill.kind === 'solid') return true
  if (fill.kind === 'dither') {
    return ditherHit(fill.pattern, 0.5, ox + px, oy + py)
  }
  return false
}

function strokeHit(
  stroke: ShapeStroke,
  px: number,
  py: number,
  w: number,
  h: number,
  cornerRadius: number,
): boolean {
  if (stroke.kind === 'none') return false
  if (stroke.kind === 'solid') {
    return onRoundRectStroke(px, py, w, h, cornerRadius, stroke.thickness)
  }
  if (stroke.kind === 'double') {
    const outer = onRoundRectStroke(px, py, w, h, cornerRadius, stroke.thickness)
    const inset = stroke.thickness + stroke.gap
    const iw = w - inset * 2
    const ih = h - inset * 2
    if (iw <= 0 || ih <= 0) return outer
    const ir = Math.max(0, cornerRadius - inset)
    const inner = onRoundRectStroke(
      px - inset,
      py - inset,
      iw,
      ih,
      ir,
      stroke.thickness,
    )
    return outer || inner
  }
  if (stroke.kind === 'dashed') {
    return strokeDashedHit(
      px,
      py,
      w,
      h,
      stroke.thickness,
      stroke.dash,
      stroke.gap,
      cornerRadius,
    )
  }
  if (stroke.kind === 'ticks') {
    return strokeTicksHit(
      px,
      py,
      w,
      h,
      stroke.thickness,
      stroke.step,
      cornerRadius,
    )
  }
  return false
}

function inkOfFill(fill: ShapeFill): Ink {
  if (fill.kind === 'none') return 'black'
  return fill.color
}

function inkOfStroke(stroke: ShapeStroke): Ink {
  if (stroke.kind === 'none') return 'black'
  return stroke.color
}

export type RasterizeShapeOpts = {
  /** Screen-space origin for dither phase (node top-left). */
  originX?: number
  originY?: number
}

/** Rasterize a shape into ImageData (RGBA). Background is transparent. */
export function rasterizeShape(
  node: Pick<ShapeNode, 'w' | 'h' | 'cornerRadius' | 'fill' | 'stroke'>,
  opts?: RasterizeShapeOpts,
): ImageData {
  const w = Math.max(1, Math.round(node.w))
  const h = Math.max(1, Math.round(node.h))
  const data = new Uint8ClampedArray(w * h * 4)
  const fill = node.fill ?? defaultShapeFill()
  const stroke = node.stroke ?? defaultShapeStroke()
  const r = Math.max(0, Math.round(node.cornerRadius))
  const ox = opts?.originX ?? 0
  const oy = opts?.originY ?? 0

  const [fr, fg, fb] = inkRgb(inkOfFill(fill))
  const [sr, sg, sb] = inkRgb(inkOfStroke(stroke))

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4
      let painted = false
      if (fillHit(fill, px, py, w, h, r, ox, oy)) {
        data[i] = fr
        data[i + 1] = fg
        data[i + 2] = fb
        data[i + 3] = 255
        painted = true
      }
      if (strokeHit(stroke, px, py, w, h, r)) {
        data[i] = sr
        data[i + 1] = sg
        data[i + 2] = sb
        data[i + 3] = 255
        painted = true
      }
      if (!painted) {
        data[i + 3] = 0
      }
    }
  }
  return new ImageData(data, w, h)
}

export function createFillFromKind(
  kind: ShapeFill['kind'],
  prev?: ShapeFill,
): ShapeFill {
  switch (kind) {
    case 'none':
      return { kind: 'none' }
    case 'solid':
      return {
        kind: 'solid',
        color: prev && 'color' in prev ? prev.color : 'black',
      }
    case 'dither':
      return {
        kind: 'dither',
        pattern:
          prev && prev.kind === 'dither' ? prev.pattern : 'checker',
        color: prev && 'color' in prev ? prev.color : 'black',
      }
    case 'gradient':
      return {
        kind: 'gradient',
        axis: prev && prev.kind === 'gradient' ? prev.axis : 'h',
        from: prev && prev.kind === 'gradient' ? prev.from : 0,
        to: prev && prev.kind === 'gradient' ? prev.to : 1,
        color: prev && 'color' in prev ? prev.color : 'black',
      }
  }
}

export function createStrokeFromKind(
  kind: ShapeStroke['kind'],
  prev?: ShapeStroke,
): ShapeStroke {
  const color =
    prev && prev.kind !== 'none' ? prev.color : ('black' as Ink)
  const thickness =
    prev && prev.kind !== 'none' && 'thickness' in prev ? prev.thickness : 1
  switch (kind) {
    case 'none':
      return { kind: 'none' }
    case 'solid':
      return { kind: 'solid', thickness, color }
    case 'double':
      return {
        kind: 'double',
        thickness,
        gap: prev && prev.kind === 'double' ? prev.gap : 2,
        color,
      }
    case 'dashed':
      return {
        kind: 'dashed',
        thickness,
        dash: prev && prev.kind === 'dashed' ? prev.dash : 4,
        gap: prev && prev.kind === 'dashed' ? prev.gap : 3,
        color,
      }
    case 'ticks':
      return {
        kind: 'ticks',
        thickness,
        step: prev && prev.kind === 'ticks' ? prev.step : 6,
        color,
      }
  }
}
