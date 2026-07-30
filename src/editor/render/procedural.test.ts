import { describe, expect, test } from 'bun:test'
import {
  createShapeNode,
  defaultShapeFill,
  defaultShapeStroke,
} from '../../core/scene/types'
import {
  clamp01,
  createFillFromKind,
  createStrokeFromKind,
  ditherHit,
  gradientDensity,
} from './procedural'

describe('procedural defaults', () => {
  test('createShapeNode defaults to open stroke', () => {
    const n = createShapeNode()
    expect(n.type).toBe('shape')
    expect(n.cornerRadius).toBe(0)
    expect(n.fill).toEqual(defaultShapeFill())
    expect(n.stroke).toEqual(defaultShapeStroke())
  })

  test('createFillFromKind / createStrokeFromKind preserve ink', () => {
    expect(createFillFromKind('solid')).toEqual({
      kind: 'solid',
      color: 'black',
    })
    expect(
      createFillFromKind('dither', { kind: 'solid', color: 'white' }),
    ).toEqual({ kind: 'dither', pattern: 'checker', color: 'white' })
    expect(createStrokeFromKind('double').kind).toBe('double')
    expect(createStrokeFromKind('none')).toEqual({ kind: 'none' })
  })
})

describe('dither + gradient', () => {
  test('clamp01', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(2)).toBe(1)
    expect(clamp01(0.5)).toBe(0.5)
  })

  test('ditherHit density extremes', () => {
    expect(ditherHit('bayer4', 0, 0, 0)).toBe(false)
    expect(ditherHit('bayer4', 1, 3, 3)).toBe(true)
  })

  test('checker paints alternating cells at mid density', () => {
    expect(ditherHit('checker', 0.5, 0, 0)).toBe(true)
    expect(ditherHit('checker', 0.5, 1, 0)).toBe(false)
  })

  test('diagonal paints every other diagonal', () => {
    expect(ditherHit('diagonal', 0.5, 0, 0)).toBe(true)
    expect(ditherHit('diagonal', 0.5, 1, 0)).toBe(false)
    expect(ditherHit('diagonal', 0.5, 1, 1)).toBe(true)
  })

  test('screen paints a mesh every 4px', () => {
    expect(ditherHit('screen', 0.5, 0, 1)).toBe(true)
    expect(ditherHit('screen', 0.5, 1, 0)).toBe(true)
    expect(ditherHit('screen', 0.5, 1, 1)).toBe(false)
  })

  test('gradientDensity interpolates', () => {
    expect(gradientDensity(0, 1, 0, 5)).toBe(0)
    expect(gradientDensity(0, 1, 4, 5)).toBe(1)
    expect(gradientDensity(0, 1, 2, 5)).toBeCloseTo(0.5)
  })
})
