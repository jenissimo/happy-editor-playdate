import { describe, expect, test } from 'bun:test'
import {
  PACKAGE_ROOT,
  resetProjectPathsCache,
  resolveProjectPaths,
} from './paths.ts'

describe('resolveProjectPaths', () => {
  test('fixture package root uses playdate/ layout', () => {
    resetProjectPathsCache()
    const p = resolveProjectPaths(PACKAGE_ROOT)
    expect(p.root).toBe(PACKAGE_ROOT)
    expect(p.scenesDir.replace(/\\/g, '/')).toEndWith('playdate/scenes')
    expect(p.sourceDir.replace(/\\/g, '/')).toEndWith('playdate/Source')
    expect(p.config.sceneRoot).toBe('playdate/scenes')
    expect(p.schemaPath.replace(/\\/g, '/')).toEndWith(
      'schema/playdate-scene.schema.json',
    )
  })

  test('env override wins', () => {
    resetProjectPathsCache()
    const prev = process.env.HAPPY_EDITOR_ROOT
    process.env.HAPPY_EDITOR_ROOT = PACKAGE_ROOT
    try {
      const p = resolveProjectPaths()
      expect(p.rootSource).toBe('env')
      expect(p.root).toBe(PACKAGE_ROOT)
    } finally {
      if (prev === undefined) delete process.env.HAPPY_EDITOR_ROOT
      else process.env.HAPPY_EDITOR_ROOT = prev
      resetProjectPathsCache()
    }
  })

  test('fixture project.json loads assistant.provider', () => {
    resetProjectPathsCache()
    const p = resolveProjectPaths(PACKAGE_ROOT)
    expect(p.config.assistant?.provider).toBe('claude')
  })
})
