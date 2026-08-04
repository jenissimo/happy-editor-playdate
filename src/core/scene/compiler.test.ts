import { describe, expect, test } from 'bun:test'
import { buildAssetCatalog } from '../assets/catalog.ts'
import { bitmapBytes, DEFAULT_RUNTIME_FONT } from '../assets/catalog.ts'
import { compileScene } from './compiler.ts'
import { SOURCE_DIR } from './io.ts'
import type { Scene } from './types.ts'

describe('scene compiler', () => {
  test('emits stable island and catalog metadata without changing source scene', () => {
    const scene: Scene = { version: 1, id: 'x', name: 'x', width: 400, height: 240, states: ['default'], defaultState: 'default', nodes: [
      { id: 'shape', name: 'shape', type: 'shape', x: 0, y: 0, w: 10, h: 8, anchor: { x: 0, y: 0 }, states: [], visible: true, locked: false, cornerRadius: 0, fill: { kind: 'none' }, stroke: { kind: 'none' } },
    ] }
    const catalog = buildAssetCatalog(SOURCE_DIR)
    const a = compileScene(scene, catalog, 'gtest')
    const b = compileScene(scene, catalog, 'gtest')
    expect(a._compiled.sceneRevision).toBe(b._compiled.sceneRevision)
    expect(a._compiled.maxIslandBitmaps).toBe(1)
    expect(a._compiled.maxUiBytes).toBe(bitmapBytes(10, 8) * 2)
    expect(a._compiled.maxUiBitmaps).toBe(2)
    expect(scene).not.toHaveProperty('_compiled')
  })

  test('preloads the default font only for missing text fonts', () => {
    const catalog = buildAssetCatalog(SOURCE_DIR)
    const text = (id: string, font: string) => ({ id, name: id, type: 'text' as const, x: 0, y: 0, w: 40, h: 20, anchor: { x: 0, y: 0 }, states: [], visible: true, locked: false, text: 'x', font, align: 'left' as const })
    const explicit: Scene = { version: 1, id: 'explicit', name: 'explicit', width: 400, height: 240, states: ['default'], defaultState: 'default', nodes: [text('explicit', 'fonts/PixelOperatorSC-Bold-13/PixelOperatorSC-Bold-13')] }
    const implicit: Scene = { ...explicit, id: 'implicit', name: 'implicit', nodes: [text('implicit', '')] }
    const explicitPlan = compileScene(explicit, catalog, 'gfont')
    const implicitPlan = compileScene(implicit, catalog, 'gfont')
    expect(explicitPlan._compiled.allowlist).not.toContain(DEFAULT_RUNTIME_FONT)
    expect(implicitPlan._compiled.allowlist).toContain(DEFAULT_RUNTIME_FONT)
  })

  test('coalesces contiguous render-safe nodes into one executable island', () => {
    const catalog = buildAssetCatalog(SOURCE_DIR)
    const node = (id: string, x: number) => ({ id, name: id, type: 'shape' as const, x, y: 0, w: 10, h: 8, anchor: { x: 0, y: 0 }, states: [], visible: true, locked: false, cornerRadius: 0, fill: { kind: 'none' as const }, stroke: { kind: 'none' as const } })
    const scene: Scene = { version: 1, id: 'islands', name: 'islands', width: 400, height: 240, states: ['default'], defaultState: 'default', nodes: [node('a', 0), node('b', 12), node('c', 24)] }
    const compiled = compileScene(scene, catalog, 'gtest')
    expect(compiled._compiled.islands).toHaveLength(1)
    expect(compiled._compiled.islands[0].members).toEqual(['a', 'b', 'c'])
  })

  // An `image` node's asset draws at its own intrinsic size (img:draw ignores
  // the node's w/h) -- an island sized from the declared box alone would clip
  // it once rasterized into a raster cache buffer (the bug this compiler
  // revision fixes; see source/ui/cache.lua). "images/heart_full" is a real
  // catalog asset (20x16) picked because it's wider AND taller than the
  // undersized box below.
  test('a singleton image island grows to cover an asset larger than its declared box', () => {
    const catalog = buildAssetCatalog(SOURCE_DIR)
    const assetEntry = catalog.entries['images/heart_full']
    expect(assetEntry).toBeDefined()
    expect(assetEntry.width).toBeGreaterThan(10)
    expect(assetEntry.height).toBeGreaterThan(8)
    const image = { id: 'oversized', name: 'oversized', type: 'image' as const, x: 5, y: 5, w: 10, h: 8, anchor: { x: 0, y: 0 }, states: [], visible: true, locked: false, asset: 'images/heart_full' }
    const scene: Scene = { version: 1, id: 'oversized-image', name: 'oversized-image', width: 400, height: 240, states: ['default'], defaultState: 'default', nodes: [image] }
    const compiled = compileScene(scene, catalog, 'gtest')
    expect(compiled._compiled.islands).toHaveLength(1)
    const island = compiled._compiled.islands[0]
    // Declared position (topLeft, no anchor offset here) is untouched --
    // only the covered size grows, rightward/downward from that origin.
    expect(island.x).toBe(5)
    expect(island.y).toBe(5)
    expect(island.w).toBe(assetEntry.width)
    expect(island.h).toBe(assetEntry.height)
    // The scene node itself is never mutated -- only the compiled plan grows.
    expect(image.w).toBe(10)
    expect(image.h).toBe(8)
    // The declared budget must cover the grown raster, or Cache.preallocateIslands
    // would need more ledger credit than the plan promised.
    expect(compiled._compiled.maxUiBytes).toBeGreaterThanOrEqual(bitmapBytes(assetEntry.width, assetEntry.height))
  })

  test('an image island does not shrink or grow when its asset fits its declared box', () => {
    const catalog = buildAssetCatalog(SOURCE_DIR)
    const assetEntry = catalog.entries['images/heart_full']
    expect(assetEntry).toBeDefined()
    const image = { id: 'fits', name: 'fits', type: 'image' as const, x: 0, y: 0, w: assetEntry.width + 4, h: assetEntry.height + 4, anchor: { x: 0, y: 0 }, states: [], visible: true, locked: false, asset: 'images/heart_full' }
    const scene: Scene = { version: 1, id: 'fitting-image', name: 'fitting-image', width: 400, height: 240, states: ['default'], defaultState: 'default', nodes: [image] }
    const compiled = compileScene(scene, catalog, 'gtest')
    const island = compiled._compiled.islands[0]
    expect(island.w).toBe(assetEntry.width + 4)
    expect(island.h).toBe(assetEntry.height + 4)
  })
})
