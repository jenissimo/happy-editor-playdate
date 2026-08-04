import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildAssetCatalog, catalogLua, CATALOG_SCHEMA_REVISION, MEMORY_FORMULA_REVISION } from '../assets/catalog.ts'
import { compileScene, COMPILER_REVISION, SCHEMA_REVISION } from './compiler.ts'
import { exportSceneLua } from './export.ts'
import type { Scene } from './types.ts'

export type PublicationScene = { name: string; scene: Scene; content: string }
export type PreparedGeneration = { id: string; catalog: ReturnType<typeof buildAssetCatalog>; layouts: Map<string, string>; compiled: Map<string, ReturnType<typeof compileScene>>; catalogText: string }

function controllerFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) controllerFiles(path, out)
    else if (name.endsWith('.lua')) out.push(path)
  }
  return out
}
function globalName(name: string) { return `${name.replace(/(^|[_-])(\w)/g, (_, __, c) => c.toUpperCase()).replace(/[^A-Za-z0-9_]/g, '')}Scene` }
function controllerAssets(files: string[], global: string, catalog: ReturnType<typeof buildAssetCatalog>) {
  const found = new Set<string>()
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    if (!new RegExp(`Ui\\.load\\s*\\(\\s*${global}\\s*\\)`).test(text)) continue
    for (const m of text.matchAll(/["'](images\/[A-Za-z0-9_./ -]+|fonts\/[A-Za-z0-9_./ -]+)["']/g)) if (catalog.entries[m[1]]?.trusted) found.add(m[1])
  }
  return [...found].sort()
}

export function prepareGeneration(sourceDir: string, scenes: PublicationScene[], options?: { validate?: (scene: unknown) => Array<{ severity: string; message: string }> }): PreparedGeneration {
  const ordered = [...scenes].sort((a, b) => a.name.localeCompare(b.name))
  for (const s of ordered) {
    const errors = (options?.validate?.(s.scene) ?? []).filter((x) => x.severity === 'error')
    if (errors.length) throw new Error(`invalid scene ${s.name}: ${errors.map((x) => x.message).join('; ')}`)
  }
  const catalog = buildAssetCatalog(sourceDir)
  const controllers = controllerFiles(join(sourceDir, 'scenes'))
  const dynamic = new Map(ordered.map((s) => [s.name, controllerAssets(controllers, globalName(s.name), catalog)]))
  const id = `g${createHash('sha256').update(ordered.map((s) => s.content).join('\n')).update(ordered.map((s) => `${s.name}:${dynamic.get(s.name)!.join(',')}`).join('\n')).update(catalog.revision).digest('hex').slice(0, 16)}`
  const layouts = new Map<string, string>(), compiled = new Map<string, ReturnType<typeof compileScene>>()
  for (const s of ordered) { const c = compileScene(s.scene, catalog, id, dynamic.get(s.name)!); compiled.set(s.name, c); layouts.set(s.name, exportSceneLua(c)) }
  return { id, catalog, layouts, compiled, catalogText: catalogLua(catalog, id) }
}

function metadata(text: string) {
  const get = (name: string) => text.match(new RegExp(`${name} = "([^"]+)"`))?.[1]
  const number = (name: string) => Number(text.match(new RegExp(`${name} = (\\d+)`))?.[1])
  return { generationId: get('generationId'), catalogRevision: get('catalogRevision') ?? get('revision'), compilerRevision: get('compilerRevision'), schemaRevision: get('schemaRevision'), memoryFormulaRevision: get('memoryFormulaRevision'), maxUiBytes: number('maxUiBytes'), maxUiBitmaps: number('maxUiBitmaps') }
}

export function validatePublishedGeneration(layoutDir: string, catalogPath: string, expected: readonly string[]): { id: string } {
  if (!existsSync(catalogPath)) throw new Error('missing catalog')
  const catalog = metadata(readFileSync(catalogPath, 'utf8'))
  if (!catalog.generationId || !catalog.catalogRevision || !catalog.schemaRevision || !catalog.memoryFormulaRevision) throw new Error('invalid catalog metadata')
  if (catalog.schemaRevision !== CATALOG_SCHEMA_REVISION) throw new Error('catalog schema revision mismatch')
  if (catalog.memoryFormulaRevision !== MEMORY_FORMULA_REVISION) throw new Error('catalog memory formula revision mismatch')
  if (!existsSync(layoutDir)) throw new Error('missing layouts')
  const actual = readdirSync(layoutDir).filter((x) => x.endsWith('.lua')).map((x) => x.slice(0, -4)).sort()
  const wanted = [...expected].sort()
  if (actual.join('\0') !== wanted.join('\0')) throw new Error('layout set mismatch')
  for (const name of wanted) {
    const data = metadata(readFileSync(join(layoutDir, `${name}.lua`), 'utf8'))
    if (!data.generationId || !data.catalogRevision || !data.compilerRevision || !data.schemaRevision || !data.memoryFormulaRevision || !Number.isFinite(data.maxUiBytes) || !Number.isFinite(data.maxUiBitmaps)) throw new Error(`invalid layout metadata: ${name}`)
    if (data.schemaRevision !== SCHEMA_REVISION) throw new Error(`layout schema revision mismatch: ${name}`)
    if (data.compilerRevision !== COMPILER_REVISION) throw new Error(`layout compiler revision mismatch: ${name}`)
    if (data.memoryFormulaRevision !== MEMORY_FORMULA_REVISION) throw new Error(`layout memory formula revision mismatch: ${name}`)
    if (data.generationId !== catalog.generationId || data.catalogRevision !== catalog.catalogRevision || data.schemaRevision !== catalog.schemaRevision || data.memoryFormulaRevision !== catalog.memoryFormulaRevision) throw new Error(`generation mismatch: ${name}`)
  }
  return { id: catalog.generationId }
}

export function publishGeneration(prepared: PreparedGeneration, layoutDir: string, catalogPath: string | string[], injectAfter?: (published: number) => void) {
  const stage = mkdtempSync(join(tmpdir(), 'happy-editor-publication-'))
  try {
    const staged = new Map<string, string>()
    for (const [name, text] of prepared.layouts) { const p = join(stage, `${name}.lua`); writeFileSync(p, text); staged.set(name, p) }
    const stagedCatalog = join(stage, 'ui_asset_catalog.lua'); writeFileSync(stagedCatalog, prepared.catalogText)
    // Validate staged data through the same parser, without touching outputs.
    const stagedLayouts = join(stage, 'layouts'); mkdirSync(stagedLayouts); for (const [name, p] of staged) renameSync(p, join(stagedLayouts, `${name}.lua`))
    validatePublishedGeneration(stagedLayouts, stagedCatalog, [...prepared.layouts.keys()])
    mkdirSync(layoutDir, { recursive: true })
    let count = 0
    for (const name of [...prepared.layouts.keys()].sort()) {
      const pending = join(layoutDir, `.${name}.${process.pid}.pending`)
      writeFileSync(pending, readFileSync(join(stagedLayouts, `${name}.lua`)))
      renameSync(pending, join(layoutDir, `${name}.lua`)); count++
      if (injectAfter) injectAfter(count)
    }
    const catalogs = (Array.isArray(catalogPath) ? catalogPath : [catalogPath])
    for (const target of catalogs) {
      if (injectAfter) injectAfter(count + 1) // after each secondary / before authoritative last catalog
      mkdirSync(dirname(target), { recursive: true }); const pending = `${target}.${process.pid}.pending`
      writeFileSync(pending, prepared.catalogText); renameSync(pending, target); count = count + 1
    }
  } finally { rmSync(stage, { recursive: true, force: true }) }
}
