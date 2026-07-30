import { describe, expect, test } from 'bun:test'
import {
  PLAYDATE_1BIT_THRESHOLD,
  quantizeRgbaToPlaydate1Bit,
} from './playdateImage'

describe('playdate 1-bit import match', () => {
  test('dark opaque → black', () => {
    const data = new Uint8ClampedArray([40, 40, 40, 255])
    quantizeRgbaToPlaydate1Bit(data)
    expect([...data]).toEqual([0, 0, 0, 255])
  })

  test('light opaque → white', () => {
    const data = new Uint8ClampedArray([200, 200, 200, 255])
    quantizeRgbaToPlaydate1Bit(data)
    expect([...data]).toEqual([255, 255, 255, 255])
  })

  test('transparent stays clear regardless of color', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 40])
    quantizeRgbaToPlaydate1Bit(data)
    expect(data[3]).toBe(0)
    expect(data[7]).toBe(0)
  })

  test('threshold boundary', () => {
    const below = new Uint8ClampedArray([
      PLAYDATE_1BIT_THRESHOLD - 1,
      PLAYDATE_1BIT_THRESHOLD - 1,
      PLAYDATE_1BIT_THRESHOLD - 1,
      255,
    ])
    const above = new Uint8ClampedArray([
      PLAYDATE_1BIT_THRESHOLD,
      PLAYDATE_1BIT_THRESHOLD,
      PLAYDATE_1BIT_THRESHOLD,
      255,
    ])
    quantizeRgbaToPlaydate1Bit(below)
    quantizeRgbaToPlaydate1Bit(above)
    expect(below[0]).toBe(0)
    expect(above[0]).toBe(255)
  })
})
