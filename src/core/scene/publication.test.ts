import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Scene } from './types.ts'
import { prepareGeneration, publishGeneration, validatePublishedGeneration } from './publication.ts'

function png(path: string) {
  const b = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b); b.write('IHDR', 12); b.writeUInt32BE(22, 16); b.writeUInt32BE(22, 20)
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, b)
}
function scene(name: string): Scene { return { version: 1, id: name, name, width: 400, height: 240, states: ['default'], defaultState: 'default', nodes: [] } }
function inputs(tag: string) { return ['one', 'two', 'three'].map((name) => ({ name, scene: scene(name), content: `${tag}:${name}` })) }
function hashes(dir: string, catalog: string) { return [...readdirSync(dir).sort().map((x) => join(dir, x)), catalog].map((p) => createHash('sha256').update(readFileSync(p)).digest('hex')) }
function replaceMetadata(path: string, key: string, value: string) {
  const text = readFileSync(path, 'utf8')
  const updated = text.replace(new RegExp(`${key} = "[^"]+"`), `${key} = "${value}"`)
  if (updated === text) throw new Error(`metadata ${key} not found in ${path}`)
  writeFileSync(path, updated)
}
function writeTestAssets(source: string) {
  png(join(source, 'fonts/Roobert-11-Medium-table-22-22.png'))
  writeFileSync(join(source, 'fonts/Roobert-11-Medium.fnt'), 'glyph=65')
}

describe('coordinated scene publication', () => {
  test('rejects stale compiler, scene schema, catalog schema, and memory formula revisions', () => {
    const root = mkdtempSync(join(tmpdir(), 'publication-stale-test-'))
    const source = join(root, 'Source'), layouts = join(root, 'layouts'), catalog = join(root, 'ui_asset_catalog.lua')
    const expected = ['one', 'two', 'three']
    try {
      writeTestAssets(source)
      const current = prepareGeneration(source, inputs('current'))
      const restore = () => publishGeneration(current, layouts, catalog)

      restore()
      replaceMetadata(join(layouts, 'one.lua'), 'compilerRevision', 'ui-islands-stale')
      expect(() => validatePublishedGeneration(layouts, catalog, expected)).toThrow('layout compiler revision mismatch: one')

      restore()
      for (const name of expected) replaceMetadata(join(layouts, `${name}.lua`), 'schemaRevision', 'scene-schema-stale')
      expect(() => validatePublishedGeneration(layouts, catalog, expected)).toThrow('layout schema revision mismatch: one')

      restore()
      // Keep catalog and layouts mutually consistent: only the current catalog schema gate rejects this generation.
      replaceMetadata(catalog, 'schemaRevision', 'catalog-schema-stale')
      for (const name of expected) replaceMetadata(join(layouts, `${name}.lua`), 'schemaRevision', 'catalog-schema-stale')
      expect(() => validatePublishedGeneration(layouts, catalog, expected)).toThrow('catalog schema revision mismatch')

      restore()
      // Likewise, a coordinated stale memory formula must not validate just because all files agree.
      replaceMetadata(catalog, 'memoryFormulaRevision', 'memory-formula-stale')
      for (const name of expected) replaceMetadata(join(layouts, `${name}.lua`), 'memoryFormulaRevision', 'memory-formula-stale')
      expect(() => validatePublishedGeneration(layouts, catalog, expected)).toThrow('catalog memory formula revision mismatch')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('associates trusted controller literals with only their generated scene', () => {
    const root = mkdtempSync(join(tmpdir(), 'publication-controller-test-'))
    const source = join(root, 'Source')
    try {
      writeTestAssets(source)
      for (const name of ['one', 'one-replacement', 'two', 'unrelated']) png(join(source, `images/${name}.png`))
      const controllers = join(source, 'scenes'); mkdirSync(controllers, { recursive: true })
      const oneController = join(controllers, 'one.lua')
      writeFileSync(oneController, 'Ui.load(OneScene)\nlocal icon = "images/one"\n')
      writeFileSync(join(controllers, 'two.lua'), 'Ui.load(TwoScene)\nlocal icon = "images/two"\n')
      writeFileSync(join(controllers, 'unrelated.lua'), 'Ui.load(UnrelatedScene)\nlocal icon = "images/unrelated"\n')

      const first = prepareGeneration(source, inputs('stable'))
      expect(first.catalog.entries['images/one']?.trusted).toBe(true)
      // ui-islands-3 only reserves the default font for text nodes that use it;
      // these empty fixtures prove controller literals without an implicit font.
      expect(first.compiled.get('one')!._compiled.allowlist).toEqual(['images/one'])
      expect(first.compiled.get('two')!._compiled.allowlist).toEqual(['images/two'])
      expect(first.compiled.get('three')!._compiled.allowlist).toEqual([])

      writeFileSync(oneController, 'Ui.load(OneScene)\nlocal icon = "images/one-replacement"\n')
      const second = prepareGeneration(source, inputs('stable'))
      expect(second.id).not.toBe(first.id)
      expect(second.compiled.get('one')!._compiled.allowlist).toEqual(['images/one-replacement'])
      expect(second.compiled.get('one')!._compiled.sceneRevision).not.toBe(first.compiled.get('one')!._compiled.sceneRevision)
      expect(second.compiled.get('two')!._compiled.allowlist).toEqual(first.compiled.get('two')!._compiled.allowlist)
      // sceneRevision includes coordinated generationId, so an unchanged scene's revision changes with the publication.
      expect(second.compiled.get('two')!._compiled.sceneRevision).not.toBe(first.compiled.get('two')!._compiled.sceneRevision)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('rejects every catalog-last interruption and keeps multi-target catalogs coherent', () => {
    const root = mkdtempSync(join(tmpdir(), 'publication-multitarget-test-'))
    const source = join(root, 'Source'), layouts = join(root, 'layouts')
    const secondary = join(root, 'fixture', 'ui_asset_catalog.lua'), authoritative = join(root, 'ui_asset_catalog.lua')
    const targets = [secondary, authoritative], expected = ['one', 'two', 'three']
    try {
      writeTestAssets(source)
      const old = prepareGeneration(source, inputs('old')), newer = prepareGeneration(source, inputs('new'))
      const restoreOld = () => {
        rmSync(layouts, { recursive: true, force: true }); rmSync(secondary, { force: true }); rmSync(authoritative, { force: true })
        publishGeneration(old, layouts, targets)
      }

      restoreOld()
      const beforeSecondary = expected.length + 1
      expect(() => publishGeneration(newer, layouts, targets, (position) => { if (position === beforeSecondary) throw new Error(`stop-${position}`) })).toThrow(`stop-${beforeSecondary}`)
      expect(() => validatePublishedGeneration(layouts, authoritative, expected)).toThrow()

      restoreOld()
      const beforeAuthoritative = expected.length + 2
      expect(() => publishGeneration(newer, layouts, targets, (position) => { if (position === beforeAuthoritative) throw new Error(`stop-${position}`) })).toThrow(`stop-${beforeAuthoritative}`)
      expect(() => validatePublishedGeneration(layouts, authoritative, expected)).toThrow()
      expect(readFileSync(secondary)).not.toEqual(readFileSync(authoritative))

      publishGeneration(newer, layouts, targets)
      expect(validatePublishedGeneration(layouts, authoritative, expected).id).toBe(newer.id)
      expect(readFileSync(secondary)).toEqual(readFileSync(authoritative))
      const first = hashes(layouts, authoritative)
      publishGeneration(newer, layouts, targets)
      expect(hashes(layouts, authoritative)).toEqual(first)
      writeFileSync(join(layouts, 'extra.lua'), 'x')
      expect(() => validatePublishedGeneration(layouts, authoritative, expected)).toThrow('layout set mismatch')
      rmSync(join(layouts, 'extra.lua'))
      const completeOne = readFileSync(join(layouts, 'one.lua'), 'utf8')
      writeFileSync(join(layouts, 'one.lua'), completeOne.replace(/\n\s*maxUiBytes = \d+,?/, ''))
      expect(() => validatePublishedGeneration(layouts, authoritative, expected)).toThrow('invalid layout metadata: one')
      writeFileSync(join(layouts, 'one.lua'), completeOne)
      writeFileSync(join(layouts, 'one.lua'), 'truncated')
      expect(() => validatePublishedGeneration(layouts, authoritative, expected)).toThrow('invalid layout metadata')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
