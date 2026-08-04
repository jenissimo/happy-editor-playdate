import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { prepareGeneration } from './publication.ts'
import { listScenes, SOURCE_DIR } from './io.ts'

const UI_BYTES = 700 * 1024
const UI_BITMAPS = 512

describe('production compiled UI budget', () => {
  test('reserves every real scene within the fixed ledger', () => {
    const prepared = prepareGeneration(SOURCE_DIR, listScenes().map((item) => ({
      name: item.scene.name,
      scene: item.scene,
      content: readFileSync(item.path, 'utf8'),
    })))
    for (const [name, compiled] of prepared.compiled) {
      expect(compiled._compiled.maxUiBytes, `${name} bytes`).toBeLessThanOrEqual(UI_BYTES)
      expect(compiled._compiled.maxUiBitmaps, `${name} bitmaps`).toBeLessThanOrEqual(UI_BITMAPS)
    }
  })
})
