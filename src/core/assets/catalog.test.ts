import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { bitmapBytes, buildAssetCatalog, DEFAULT_RUNTIME_FONT } from './catalog.ts'
import { SOURCE_DIR } from '../scene/io.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'catalog-test-'))
  const png = (path: string, w: number, h: number, tail = 0) => {
    const full = join(root, path); mkdirSync(dirname(full), { recursive: true })
    const b = Buffer.alloc(25); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b)
    b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[24] = tail; writeFileSync(full, b)
  }
  const baseline = () => { png('fonts/Roobert-11-Medium-table-22-22.png', 44, 22); writeFileSync(join(root, `${DEFAULT_RUNTIME_FONT}.fnt`), 'glyph=65') }
  baseline()
  return { root, png, baseline, close: () => rmSync(root, { recursive: true, force: true }) }
}

describe('production asset catalog', () => {
  test('indexes dynamic game assets and font backing atlases deterministically', () => {
    const first = buildAssetCatalog(SOURCE_DIR)
    const second = buildAssetCatalog(SOURCE_DIR)
    expect(second.revision).toBe(first.revision)
    expect(first.entries['images/menu_hero_1_1']).toBeDefined()
    expect(first.entries['images/heart_full']).toBeDefined()
    expect(first.entries['images/heart_empty']).toBeDefined()
    expect(first.entries['fonts/PixelOperatorSC-Bold-17/PixelOperatorSC-Bold-17']?.kind).toBe('font')
    expect(first.entries['fonts/Roobert-11-Medium']?.kind).toBe('font')
  })

  test('uses aligned two-plane accounting and rejects malformed source assets', () => {
    const root = mkdtempSync(join(tmpdir(), 'catalog-test-'))
    const png = (path: string, w: number, h: number) => {
      const b = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b)
      b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); writeFileSync(join(root, path), b)
    }
    const font = () => { mkdirSync(join(root, 'fonts'), { recursive: true }); writeFileSync(join(root, `${DEFAULT_RUNTIME_FONT}.fnt`), 'glyph=65') }
    try {
      mkdirSync(join(root, 'fonts'), { recursive: true }); png('fonts/Roobert-11-Medium-table-22-22.png', 44, 22); font()
      mkdirSync(join(root, 'images'), { recursive: true }); png('images/grid-table-8-8.png', 16, 16); png('images/panel-slice-2-2-2-2.png', 8, 8)
      const catalog = buildAssetCatalog(root)
      expect(bitmapBytes(1, 1)).toBe(72) // 4-byte row * 2 planes + 64 object bytes
      expect(catalog.entries['images/grid'].bitmaps).toBe(4)
      expect(catalog.entries['images/grid'].bytes).toBe(bitmapBytes(8, 8) * 4 + 64)
      expect(catalog.entries['images/panel'].bytes).toBe(bitmapBytes(8, 8) + 128)
      writeFileSync(join(root, 'images', 'bad.gif'), Buffer.from('GIF89a'))
      expect(() => buildAssetCatalog(root)).toThrow('unsupported non-PNG')
      rmSync(join(root, 'images', 'bad.gif'))
      writeFileSync(join(root, 'images', 'broken.png'), Buffer.from('not png'))
      expect(() => buildAssetCatalog(root)).toThrow('invalid PNG bounds')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('validates table topology, slices, fonts, and deterministic bytes', () => {
    const f = fixture()
    try {
      f.png('images/run-table-001.png', 8, 8); f.png('images/run-table-002.png', 8, 8)
      const seq = buildAssetCatalog(f.root).entries['images/run']
      expect(seq.bitmaps).toBe(2); expect(seq.bytes).toBe(bitmapBytes(8, 8) * 2 + 64)
      const stable = buildAssetCatalog(f.root)
      expect(buildAssetCatalog(f.root).revision).toBe(stable.revision)
      f.png('images/run-table-004.png', 8, 8)
      expect(() => buildAssetCatalog(f.root)).toThrow('gapped sequential table')
      rmSync(join(f.root, 'images', 'run-table-004.png'))
      f.png('images/run-table-8-8.png', 8, 8)
      expect(() => buildAssetCatalog(f.root)).toThrow('ambiguous table topology')
      rmSync(join(f.root, 'images', 'run-table-8-8.png'))
      f.png('images/run-table-003.png', 9, 8)
      expect(() => buildAssetCatalog(f.root)).toThrow('uneven table frames')
    } finally { f.close() }
  })

  test('rejects matrix, slice, font/default, and collision failures', () => {
    const f = fixture()
    try {
      f.png('images/bad-table-8-8.png', 9, 8)
      expect(() => buildAssetCatalog(f.root)).toThrow('non-divisible table')
      rmSync(join(f.root, 'images', 'bad-table-8-8.png'))
      f.png('images/zero-table-0-8.png', 8, 8)
      expect(() => buildAssetCatalog(f.root)).toThrow('invalid matrix cell geometry')
      rmSync(join(f.root, 'images', 'zero-table-0-8.png'))
      f.png('images/panel-slice-4-4-2-2.png', 8, 8)
      expect(() => buildAssetCatalog(f.root)).toThrow('invalid nine-slice geometry')
      rmSync(join(f.root, 'images', 'panel-slice-4-4-2-2.png'))
      writeFileSync(join(f.root, 'fonts', 'Missing.fnt'), 'glyph=1')
      expect(() => buildAssetCatalog(f.root)).toThrow('font backing atlas missing')
      rmSync(join(f.root, 'fonts', 'Missing.fnt'))
      f.png('images/collide.png', 8, 8); f.png('images/collide-slice-1-1-1-1.png', 8, 8)
      expect(() => buildAssetCatalog(f.root)).toThrow('duplicate logical asset path')
    } finally { f.close() }
  })

  test('revision and Lua output change only with relevant bytes/topology', async () => {
    const f = fixture()
    try {
      f.png('images/a.png', 8, 8, 1)
      const { catalogLua } = await import('./catalog.ts')
      const a = buildAssetCatalog(f.root), lua = catalogLua(a, 'g')
      const same = buildAssetCatalog(f.root)
      expect(same.revision).toBe(a.revision); expect(catalogLua(same, 'g')).toBe(lua)
      f.png('images/a.png', 8, 8, 2)
      const changed = buildAssetCatalog(f.root)
      expect(changed.revision).not.toBe(a.revision); expect(catalogLua(changed, 'g')).not.toBe(lua)
    } finally { f.close() }
  })

  test('rejects every missing or malformed runtime default-font prerequisite', () => {
    const absent = mkdtempSync(join(tmpdir(), 'catalog-default-'))
    const missingBacking = mkdtempSync(join(tmpdir(), 'catalog-default-'))
    const malformedBacking = mkdtempSync(join(tmpdir(), 'catalog-default-'))
    try {
      expect(() => buildAssetCatalog(absent)).toThrow(`runtime default font missing or untrusted: ${DEFAULT_RUNTIME_FONT}`)
      mkdirSync(join(missingBacking, 'fonts'), { recursive: true })
      writeFileSync(join(missingBacking, `${DEFAULT_RUNTIME_FONT}.fnt`), 'glyph=65')
      expect(() => buildAssetCatalog(missingBacking)).toThrow('font backing atlas missing')
      mkdirSync(join(malformedBacking, 'fonts'), { recursive: true })
      writeFileSync(join(malformedBacking, `${DEFAULT_RUNTIME_FONT}.fnt`), 'glyph=65')
      writeFileSync(join(malformedBacking, 'fonts/Roobert-11-Medium-table-22-22.png'), 'bad')
      expect(() => buildAssetCatalog(malformedBacking)).toThrow('invalid PNG bounds')
    } finally {
      rmSync(absent, { recursive: true, force: true }); rmSync(missingBacking, { recursive: true, force: true }); rmSync(malformedBacking, { recursive: true, force: true })
    }
  })

  test('ignores creation order and mtime when serializing equivalent trees', async () => {
    const a = fixture(), b = fixture()
    try {
      a.png('images/a.png', 8, 8, 1); a.png('images/b.png', 8, 8, 2)
      b.png('images/b.png', 8, 8, 2); b.png('images/a.png', 8, 8, 1)
      utimesSync(join(a.root, 'images/a.png'), new Date(1000), new Date(1000))
      utimesSync(join(b.root, 'images/a.png'), new Date(2000000), new Date(2000000))
      const { catalogLua } = await import('./catalog.ts')
      const ca = buildAssetCatalog(a.root), cb = buildAssetCatalog(b.root)
      expect(cb.revision).toBe(ca.revision)
      expect(cb.entries).toEqual(ca.entries)
      expect(catalogLua(cb, 'fixed-generation')).toBe(catalogLua(ca, 'fixed-generation'))
    } finally { a.close(); b.close() }
  })
})
