import type { SceneNode } from '../core/scene/types'
import { SCREEN_H, SCREEN_W } from '../core/constants'

export type Rect = { left: number; top: number; right: number; bottom: number }

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const r of rects) {
    left = Math.min(left, r.left)
    top = Math.min(top, r.top)
    right = Math.max(right, r.right)
    bottom = Math.max(bottom, r.bottom)
  }
  return { left, top, right, bottom }
}

export function nodeRect(node: SceneNode): Rect {
  const left = node.x - node.anchor.x * node.w
  const top = node.y - node.anchor.y * node.h
  return { left, top, right: left + node.w, bottom: top + node.h }
}

export function pointInRect(r: Rect, x: number, y: number): boolean {
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom
}

/**
 * Hit stack under a point, top-most first (reverse paint / flatten order).
 * Skips groups; caller filters visibility.
 */
export function hitStackAt(
  nodes: SceneNode[],
  x: number,
  y: number,
  isHit: (n: SceneNode) => boolean = () => true,
): SceneNode[] {
  const out: SceneNode[] = []
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!
    if (n.type === 'group') continue
    if (!isHit(n)) continue
    if (pointInRect(nodeRect(n), x, y)) out.push(n)
  }
  return out
}

/** Next id in a top→bottom stack after `currentId` (cycles). */
export function cycleHitId(
  stack: SceneNode[],
  currentId: string | null,
): string | null {
  if (stack.length === 0) return null
  const i = currentId ? stack.findIndex((n) => n.id === currentId) : -1
  return stack[(i + 1) % stack.length]!.id
}

export function rectToNodePatch(
  rect: Rect,
  anchor: { x: number; y: number },
): { x: number; y: number; w: number; h: number } {
  const w = Math.max(1, Math.round(rect.right - rect.left))
  const h = Math.max(1, Math.round(rect.bottom - rect.top))
  const left = Math.round(rect.left)
  const top = Math.round(rect.top)
  return {
    w,
    h,
    x: left + anchor.x * w,
    y: top + anchor.y * h,
  }
}

export type Guide = { axis: 'x' | 'y'; pos: number; kind: 'grid' | 'edge' | 'center' | 'node' }

export type SnapSettings = {
  enabled: boolean
  grid: number
  threshold: number
  toGrid: boolean
  toScreen: boolean
  toNodes: boolean
}

export const DEFAULT_SNAP: SnapSettings = {
  enabled: true,
  grid: 8,
  threshold: 6,
  toGrid: true,
  toScreen: true,
  toNodes: true,
}

type SnapTarget = { pos: number; kind: Guide['kind'] }

function collectTargets(
  axis: 'x' | 'y',
  settings: SnapSettings,
  others: Rect[],
): SnapTarget[] {
  const targets: SnapTarget[] = []
  const size = axis === 'x' ? SCREEN_W : SCREEN_H

  if (settings.toScreen) {
    targets.push({ pos: 0, kind: 'edge' })
    targets.push({ pos: size, kind: 'edge' })
    targets.push({ pos: size / 2, kind: 'center' })
  }

  if (settings.toGrid && settings.grid > 0) {
    for (let p = 0; p <= size; p += settings.grid) {
      targets.push({ pos: p, kind: 'grid' })
    }
  }

  if (settings.toNodes) {
    for (const r of others) {
      if (axis === 'x') {
        targets.push({ pos: r.left, kind: 'node' })
        targets.push({ pos: r.right, kind: 'node' })
        targets.push({ pos: (r.left + r.right) / 2, kind: 'node' })
      } else {
        targets.push({ pos: r.top, kind: 'node' })
        targets.push({ pos: r.bottom, kind: 'node' })
        targets.push({ pos: (r.top + r.bottom) / 2, kind: 'node' })
      }
    }
  }

  return targets
}

function nearestSnap(
  value: number,
  targets: SnapTarget[],
  threshold: number,
  prefer: 'any' | 'strong' = 'any',
): { value: number; guide: Guide | null } {
  let best: SnapTarget | null = null
  let bestScore = Infinity
  for (const t of targets) {
    if (prefer === 'strong' && t.kind === 'grid') continue
    const d = Math.abs(t.pos - value)
    if (d > threshold) continue
    // Prefer structural snaps over dense grid when distances are close.
    const score = d + (t.kind === 'grid' ? threshold * 0.35 : 0)
    if (score < bestScore) {
      bestScore = score
      best = t
    }
  }
  if (!best) return { value, guide: null }
  return {
    value: best.pos,
    guide: {
      axis: 'x',
      pos: best.pos,
      kind: best.kind,
    },
  }
}

/** Snap a moving rect (translation). Returns new top-left and guides. */
export function snapTranslate(
  rect: Rect,
  settings: SnapSettings,
  others: Rect[],
): { rect: Rect; guides: Guide[] } {
  if (!settings.enabled) return { rect, guides: [] }

  const w = rect.right - rect.left
  const h = rect.bottom - rect.top
  const guides: Guide[] = []

  const xTargets = collectTargets('x', settings, others)
  const yTargets = collectTargets('y', settings, others)

  const candidatesX = [rect.left, rect.left + w / 2, rect.right]
  const candidatesY = [rect.top, rect.top + h / 2, rect.bottom]

  const pickAxis = (
    axis: 'x' | 'y',
    candidates: number[],
    targets: SnapTarget[],
  ): { delta: number; guide: Guide | null } => {
    let bestDelta = 0
    let bestScore = Infinity
    let bestGuide: Guide | null = null
    for (const prefer of ['strong', 'any'] as const) {
      for (const c of candidates) {
        const { value, guide } = nearestSnap(c, targets, settings.threshold, prefer)
        if (!guide) continue
        const d = Math.abs(value - c)
        const score = d + (guide.kind === 'grid' ? settings.threshold * 0.35 : 0)
        if (score < bestScore) {
          bestScore = score
          bestDelta = value - c
          bestGuide = { ...guide, axis, pos: value }
        }
      }
      if (bestGuide && bestGuide.kind !== 'grid') break
    }
    return { delta: bestDelta, guide: bestGuide }
  }

  const x = pickAxis('x', candidatesX, xTargets)
  const y = pickAxis('y', candidatesY, yTargets)
  if (x.guide) guides.push(x.guide)
  if (y.guide) guides.push(y.guide)

  return {
    rect: {
      left: rect.left + x.delta,
      right: rect.right + x.delta,
      top: rect.top + y.delta,
      bottom: rect.bottom + y.delta,
    },
    guides,
  }
}

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/** Apply resize from a handle, then snap the moving edges. */
export function snapResize(
  start: Rect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  settings: SnapSettings,
  others: Rect[],
  minSize = 8,
): { rect: Rect; guides: Guide[] } {
  let { left, top, right, bottom } = start

  if (handle.includes('w')) left = start.left + dx
  if (handle.includes('e')) right = start.right + dx
  if (handle.includes('n')) top = start.top + dy
  if (handle.includes('s')) bottom = start.bottom + dy

  // Enforce min size before snap
  if (right - left < minSize) {
    if (handle.includes('w')) left = right - minSize
    else right = left + minSize
  }
  if (bottom - top < minSize) {
    if (handle.includes('n')) top = bottom - minSize
    else bottom = top + minSize
  }

  if (!settings.enabled) {
    return { rect: { left, top, right, bottom }, guides: [] }
  }

  const guides: Guide[] = []
  const xTargets = collectTargets('x', settings, others)
  const yTargets = collectTargets('y', settings, others)

  if (handle.includes('w')) {
    const { value, guide } = nearestSnap(left, xTargets, settings.threshold)
    if (guide && right - value >= minSize) {
      left = value
      guides.push({ ...guide, axis: 'x', pos: value })
    }
  }
  if (handle.includes('e')) {
    const { value, guide } = nearestSnap(right, xTargets, settings.threshold)
    if (guide && value - left >= minSize) {
      right = value
      guides.push({ ...guide, axis: 'x', pos: value })
    }
  }
  if (handle.includes('n')) {
    const { value, guide } = nearestSnap(top, yTargets, settings.threshold)
    if (guide && bottom - value >= minSize) {
      top = value
      guides.push({ ...guide, axis: 'y', pos: value })
    }
  }
  if (handle.includes('s')) {
    const { value, guide } = nearestSnap(bottom, yTargets, settings.threshold)
    if (guide && value - top >= minSize) {
      bottom = value
      guides.push({ ...guide, axis: 'y', pos: value })
    }
  }

  return { rect: { left, top, right, bottom }, guides }
}

export function otherRects(nodes: SceneNode[], exceptId: string): Rect[] {
  return nodes.filter((n) => n.id !== exceptId).map(nodeRect)
}
