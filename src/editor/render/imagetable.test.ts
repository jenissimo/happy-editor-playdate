import { describe, expect, test } from 'bun:test'
import { animFrameIndex } from './imagetable'

describe('animFrameIndex', () => {
  test('static fps uses staticFrame clamped to range', () => {
    expect(
      animFrameIndex({
        timeSec: 9,
        fps: 0,
        loop: true,
        frameStart: 2,
        frameEnd: 5,
        staticFrame: 4,
      }),
    ).toBe(4)
    expect(
      animFrameIndex({
        timeSec: 0,
        fps: 0,
        loop: true,
        frameStart: 2,
        frameEnd: 5,
        staticFrame: 99,
      }),
    ).toBe(5)
  })

  test('loops within range', () => {
    expect(
      animFrameIndex({
        timeSec: 0,
        fps: 10,
        loop: true,
        frameStart: 1,
        frameEnd: 3,
      }),
    ).toBe(1)
    expect(
      animFrameIndex({
        timeSec: 0.2,
        fps: 10,
        loop: true,
        frameStart: 1,
        frameEnd: 3,
      }),
    ).toBe(3)
    expect(
      animFrameIndex({
        timeSec: 0.3,
        fps: 10,
        loop: true,
        frameStart: 1,
        frameEnd: 3,
      }),
    ).toBe(1)
  })

  test('non-loop clamps at end', () => {
    expect(
      animFrameIndex({
        timeSec: 10,
        fps: 10,
        loop: false,
        frameStart: 1,
        frameEnd: 4,
      }),
    ).toBe(4)
  })
})
