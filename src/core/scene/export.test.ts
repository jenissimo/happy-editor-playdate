import { describe, expect, test } from 'bun:test'
import { exportSceneLua } from './export.ts'
import type { CompiledScene } from './compiler.ts'
import type { Scene } from './types.ts'

function scene(): Scene {
  return { version: 1, id: 'menu', name: 'menu-ui', width: 400, height: 240, states: ['default'], defaultState: 'default', nodes: [] }
}

describe('scene Lua export headers', () => {
  test('labels raw developer fallback and compiled production output deterministically', () => {
    const raw = scene()
    const rawLua = exportSceneLua(raw)
    expect(rawLua).toContain('-- Developer non-strict export; bounded fallback only (not production).')
    expect(exportSceneLua(raw)).toBe(rawLua)

    const compiled: CompiledScene = {
      ...raw,
      _compiled: {
        schemaRevision: '1', compilerRevision: 'test', catalogRevision: 'catalog', generationId: 'generation',
        memoryFormulaRevision: 'formula', sceneRevision: 'scene', maxIslandBytes: 0, maxIslandBitmaps: 0,
        islands: [], allowlist: [],
      },
    }
    const compiledLua = exportSceneLua(compiled)
    expect(compiledLua).toContain('-- Compiled production output; catalog and plan metadata are required.')
    expect(exportSceneLua(compiled)).toBe(compiledLua)
  })
})
