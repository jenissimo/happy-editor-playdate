import { describe, expect, test } from 'bun:test'
import { applyImageTint } from './imageTint'

function makeCtx(w: number, h: number, rgba: number[]) {
  const data = new Uint8ClampedArray(rgba)
  const imageData = { data, width: w, height: h } as ImageData
  const store = { data }
  return {
    getImageData: () => ({
      data: store.data,
      width: w,
      height: h,
    }),
    putImageData: (id: ImageData) => {
      store.data = id.data as Uint8ClampedArray
    },
    _data: () => store.data,
    _seed: imageData,
  } as unknown as CanvasRenderingContext2D & {
    _data: () => Uint8ClampedArray
  }
}

describe('applyImageTint', () => {
  test('white tint keeps transparency and flips opaque ink', () => {
    // 2px: opaque black, clear
    const ctx = makeCtx(2, 1, [0, 0, 0, 255, 0, 0, 0, 0])
    applyImageTint(ctx, 0, 0, 2, 1, 'white')
    const px = ctx._data()
    expect([...px.slice(0, 4)]).toEqual([255, 255, 255, 255])
    expect([...px.slice(4, 8)]).toEqual([0, 0, 0, 0])
  })

  test('none / omit leaves pixels alone', () => {
    const ctx = makeCtx(1, 1, [0, 0, 0, 255])
    applyImageTint(ctx, 0, 0, 1, 1, 'none')
    expect([...ctx._data()]).toEqual([0, 0, 0, 255])
    applyImageTint(ctx, 0, 0, 1, 1, undefined)
    expect([...ctx._data()]).toEqual([0, 0, 0, 255])
  })

  test('does not flood the whole rect like a CSS filter would', () => {
    // Sparse stamp: only center pixel opaque
    const rgba = new Array(3 * 3 * 4).fill(0)
    rgba[4 * 4 + 0] = 0
    rgba[4 * 4 + 1] = 0
    rgba[4 * 4 + 2] = 0
    rgba[4 * 4 + 3] = 255
    const ctx = makeCtx(3, 3, rgba)
    applyImageTint(ctx, 0, 0, 3, 3, 'white')
    const px = ctx._data()
    let opaque = 0
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3]! > 0) {
        opaque++
        expect(px[i]).toBe(255)
      }
    }
    expect(opaque).toBe(1)
  })

  test('post-composite tint on black bg would flood — documents the pitfall', () => {
    // What the scene framebuffer looks like after drawing a black stamp on a
    // black chip: every pixel is opaque black. Tint then fills the whole rect.
    const rgba = new Array(2 * 2 * 4)
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 0
      rgba[i + 1] = 0
      rgba[i + 2] = 0
      rgba[i + 3] = 255
    }
    const ctx = makeCtx(2, 2, rgba)
    applyImageTint(ctx, 0, 0, 2, 2, 'white')
    expect([...ctx._data()].every((v, i) => (i % 4 === 3 ? v === 255 : v === 255))).toBe(
      true,
    )
  })
})
