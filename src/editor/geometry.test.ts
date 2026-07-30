import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_SNAP,
  nodeRect,
  rectsIntersect,
  rectToNodePatch,
  snapTranslate,
  snapResize,
  unionRects,
  hitStackAt,
  cycleHitId,
} from './geometry'
import { createShapeNode, createTextNode } from '../core/scene/types'

describe('geometry', () => {
  test('nodeRect respects anchor', () => {
    const n = createTextNode({ x: 100, y: 50, w: 40, h: 20, anchor: { x: 0.5, y: 0.5 } })
    expect(nodeRect(n)).toEqual({ left: 80, top: 40, right: 120, bottom: 60 })
  })

  test('hitStackAt is top-most first; cycleHitId walks deeper', () => {
    const bottom = createShapeNode({
      id: 'bottom',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    })
    const top = createTextNode({ id: 'top', x: 10, y: 10, w: 40, h: 20 })
    const stack = hitStackAt([bottom, top], 20, 15)
    expect(stack.map((n) => n.id)).toEqual(['top', 'bottom'])
    expect(cycleHitId(stack, 'top')).toBe('bottom')
    expect(cycleHitId(stack, 'bottom')).toBe('top')
    expect(cycleHitId(stack, null)).toBe('top')
  })

  test('rectToNodePatch round-trips', () => {
    const anchor = { x: 0.5, y: 0 }
    const patch = rectToNodePatch({ left: 10, top: 20, right: 50, bottom: 60 }, anchor)
    expect(patch).toEqual({ x: 30, y: 20, w: 40, h: 40 })
  })

  test('snapTranslate to screen edge', () => {
    const rect = { left: 3, top: 10, right: 23, bottom: 30 }
    const { rect: out, guides } = snapTranslate(rect, DEFAULT_SNAP, [])
    expect(out.left).toBe(0)
    expect(guides.some((g) => g.axis === 'x' && g.pos === 0)).toBe(true)
  })

  test('snapResize east edge to node', () => {
    const start = { left: 10, top: 10, right: 50, bottom: 40 }
    const others = [{ left: 100, top: 0, right: 140, bottom: 40 }]
    const { rect } = snapResize(start, 'e', 48, 0, DEFAULT_SNAP, others)
    expect(rect.right).toBe(100)
  })

  test('rectsIntersect and unionRects', () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 }
    const b = { left: 5, top: 5, right: 20, bottom: 20 }
    const c = { left: 30, top: 30, right: 40, bottom: 40 }
    expect(rectsIntersect(a, b)).toBe(true)
    expect(rectsIntersect(a, c)).toBe(false)
    expect(unionRects([a, b])).toEqual({
      left: 0,
      top: 0,
      right: 20,
      bottom: 20,
    })
    expect(unionRects([])).toBeNull()
  })
})
