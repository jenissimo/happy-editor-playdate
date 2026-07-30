import { describe, expect, test } from 'bun:test'
import {
  describeAsset,
  parseAssetName,
} from './parseAssetName'

describe('parseAssetName', () => {
  test('plain image', () => {
    const a = parseAssetName('images/icon.png')
    expect(a).toMatchObject({
      kind: 'image',
      basePath: 'images/icon',
      extension: 'png',
    })
  })

  test('imagetable cell size (Playdate)', () => {
    const a = parseAssetName('sprites/player-table-32-32.png')
    expect(a).toMatchObject({
      kind: 'table',
      basePath: 'sprites/player',
      cell: { w: 32, h: 32 },
    })
  })

  test('sequential table frame (Playdate)', () => {
    const a = parseAssetName('fx/boom-table-003.png')
    expect(a).toMatchObject({
      kind: 'table',
      basePath: 'fx/boom',
      frameIndex: 3,
    })
  })

  test('9-slice L-R-T-B', () => {
    const a = parseAssetName('ui/panel-slice-8-8-8-8.png')
    expect(a).toMatchObject({
      kind: 'slice',
      basePath: 'ui/panel',
      slice: { left: 8, right: 8, top: 8, bottom: 8 },
    })
  })

  test('asymmetric slice', () => {
    const a = parseAssetName('ui/btn-slice-4-12-6-6.png')
    expect(a?.slice).toEqual({ left: 4, right: 12, top: 6, bottom: 6 })
    expect(a?.basePath).toBe('ui/btn')
  })

  test('font with size', () => {
    // basePath keeps the full stem so it matches Stem-table-W-H.png and
    // Playdate font.new("…/Stem"); fontSize is metadata only.
    const a = parseAssetName('fonts/Roobert-11.fnt')
    expect(a).toMatchObject({
      kind: 'font',
      basePath: 'fonts/Roobert-11',
      fontSize: 11,
      extension: 'fnt',
    })
  })

  test('slice wins over table-like numbers in path', () => {
    const a = parseAssetName('a-slice-1-2-3-4.png')
    expect(a?.kind).toBe('slice')
  })

  test('describeAsset', () => {
    const a = parseAssetName('ui/panel-slice-8-8-8-8.png')!
    expect(describeAsset(a)).toBe('9-slice · L8 R8 T8 B8')
  })
})
