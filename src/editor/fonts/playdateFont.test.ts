import { describe, expect, test } from 'bun:test'
import {
  measureGlyphRun,
  normalizeTextScale,
  parsePlaydateFnt,
  type LoadedPlaydateFont,
} from './playdateFont'

const SAMPLE = `tracking=1
space	3
A	5
B	6
a	4
AB	-1
`

describe('parsePlaydateFnt', () => {
  test('parses glyphs, tracking, kerning', () => {
    const font = parsePlaydateFnt(SAMPLE, 8, 12, '/atlas.png')
    expect(font.tracking).toBe(1)
    expect(font.byChar.get(' ')?.width).toBe(3)
    expect(font.byChar.get('A')?.index).toBe(1)
    expect(font.byChar.get('B')?.index).toBe(2)
    expect(font.kerning.get('AB')).toBe(-1)
  })
})

describe('measureGlyphRun', () => {
  test('sums advances + tracking + kerning', () => {
    const data = parsePlaydateFnt(SAMPLE, 8, 12, '/atlas.png')
    const font = {
      ...data,
      atlas: {} as HTMLCanvasElement,
      cols: 4,
    } satisfies LoadedPlaydateFont
    // A(5) + tracking(1) + kern(-1) + B(6) = 11
    expect(measureGlyphRun(font, 'AB')).toBe(11)
  })
})

describe('normalizeTextScale', () => {
  test('defaults and clamps to integer 1..8', () => {
    expect(normalizeTextScale(undefined)).toBe(1)
    expect(normalizeTextScale(null)).toBe(1)
    expect(normalizeTextScale(2.9)).toBe(2)
    expect(normalizeTextScale(0)).toBe(1)
    expect(normalizeTextScale(99)).toBe(8)
  })
})
