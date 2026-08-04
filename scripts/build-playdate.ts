/**
 * Build the Playdate project from an immutable Source snapshot.
 *
 * The manifest deliberately lives beside the output, never inside Source: that
 * avoids self-referential hashing while binding the produced bundle to the
 * exact files pdc consumed.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { findPdc, PDX_OUT } from '../src/core/playdate/sdk.ts'
import { LUA_SCENES_DIR, ROOT, SCENES_DIR, SOURCE_DIR, validateSceneObject } from '../src/core/scene/io.ts'
import { prepareGeneration, publishGeneration, validatePublishedGeneration, type PublicationScene } from '../src/core/scene/publication.ts'

export type PdcIdentity = {
  resolvedPath: string
  sdkRoot: string
  version: string
  binaryDigest: string
}

export type PdcSpawn = (command: string, args: string[]) => { status: number | null | undefined; error?: Error | null }

type StagedFile = { path: string; bytes: number; digest: string }
type GenerationMetadata = {
  catalog: { generationId: string; catalogRevision: string; schemaRevision: string; memoryFormulaRevision: string }
  layouts: Array<{ name: string; generationId: string; catalogRevision: string; schemaRevision: string; compilerRevision: string; memoryFormulaRevision: string; sceneRevision: string }>
}

export type BuildManifest = {
  version: 2
  source: { digest: string; files: StagedFile[] }
  authoring: { digest: string; files: StagedFile[] }
  generation: GenerationMetadata
  pdc: PdcIdentity
}

export type SnapshotBuildOptions = {
  sourceDir: string
  layoutsDir: string
  scenesDir: string
  /** Project config affects path resolution, so bind it when it exists. */
  projectConfigPath?: string
  outputPath: string
  pdc: PdcIdentity
  spawn: PdcSpawn
  /** Test-only parent for private snapshots. It must already exist. */
  tempParent?: string
  /** Test-only hooks; production callers never observe or retain the snapshot. */
  afterCopy?: () => void
  onStaged?: (snapshotDir: string, stagedSourceDir: string, manifest: BuildManifest) => void
  /** Test-only publication fault injection. */
  injectPublishFailure?: (point: 'bundle' | 'manifest' | 'restore-bundle' | 'restore-manifest') => void
  /**
   * Directory produced by `bun run bake:islands` (manifest.json + per-scene
   * PNGs). Optional and consumed read-only: build:playdate never spawns the
   * Simulator itself (slow, interactive-ish) and never fails the build over
   * a missing or stale bake, since a stale/absent bake is only ever slower on
   * device, never wrong -- source/ui/cache.lua's sceneRevision-keyed lookup
   * is the actual correctness guarantee. Omitted by every existing test, so
   * their staged output and manifest hashing are completely unaffected.
   */
  bakeDir?: string
}

export type SnapshotBuildResult = { manifest: BuildManifest; manifestPath: string }

function publishCandidate(candidate: string, output: string, manifestText: string, inject?: (point: 'bundle' | 'manifest' | 'restore-bundle' | 'restore-manifest') => void) {
  const parent = dirname(output), manifest = `${output}.snapshot.json`
  const stamp = `${process.pid}.${Date.now()}`
  const stagedBundle = join(parent, `.${stamp}.candidate.pdx`)
  const stagedManifest = join(parent, `.${stamp}.candidate.manifest.json`)
  const bundleBackup = join(parent, `.${stamp}.bundle.backup`)
  const manifestBackup = join(parent, `.${stamp}.manifest.backup`)
  mkdirSync(parent, { recursive: true })
  cpSync(candidate, stagedBundle, { recursive: true, dereference: true, errorOnExist: true })
  writeFileSync(stagedManifest, manifestText, 'utf8')
  let bundleMoved = false, manifestMoved = false
  const retained: string[] = []
  try {
    if (existsSync(output)) renameSync(output, bundleBackup)
    inject?.('bundle')
    renameSync(stagedBundle, output); bundleMoved = true
    if (existsSync(manifest)) renameSync(manifest, manifestBackup)
    inject?.('manifest')
    renameSync(stagedManifest, manifest); manifestMoved = true
  } catch (error) {
    if (bundleMoved) rmSync(output, { recursive: true, force: true })
    if (manifestMoved) rmSync(manifest, { force: true })
    if (existsSync(bundleBackup)) {
      try { inject?.('restore-bundle'); renameSync(bundleBackup, output) }
      catch { retained.push(bundleBackup) }
    }
    if (existsSync(manifestBackup)) {
      try { inject?.('restore-manifest'); renameSync(manifestBackup, manifest) }
      catch { retained.push(manifestBackup) }
    }
    if (retained.length) throw new Error(`${error instanceof Error ? error.message : String(error)}; recovery backups retained: ${retained.join(', ')}`)
    throw error
  } finally {
    rmSync(stagedBundle, { recursive: true, force: true })
    rmSync(stagedManifest, { force: true })
    if (!retained.includes(bundleBackup)) rmSync(bundleBackup, { recursive: true, force: true })
    if (!retained.includes(manifestBackup)) rmSync(manifestBackup, { force: true })
  }
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function stagedFiles(root: string, dir = root, out: StagedFile[] = [], prefix = ''): StagedFile[] {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) stagedFiles(root, path, out, prefix)
    else if (entry.isFile()) {
      const bytes = statSync(path).size
      out.push({ path: `${prefix}${relative(root, path).replace(/\\/g, '/')}`, bytes, digest: sha256(readFileSync(path)) })
    } else {
      // Symlink semantics vary between Node/Bun and Windows. Rejecting them is
      // safer than producing a manifest that hashes different bytes from pdc.
      throw new Error(`unsupported non-file Source entry: ${path}`)
    }
  }
  return out
}

function sourceDigest(files: readonly StagedFile[]): string {
  return sha256(files.map((file) => `${file.path}\0${file.bytes}\0${file.digest}`).join('\n'))
}

function snapshotTree(root: string) {
  const files = stagedFiles(root)
  return { files, digest: sourceDigest(files) }
}

function authoringTree(scenesDir: string, projectConfigPath?: string) {
  if (!existsSync(scenesDir)) throw new Error(`missing scene directory: ${scenesDir}`)
  const files = stagedFiles(scenesDir, scenesDir, [], 'scenes/')
  if (projectConfigPath && existsSync(projectConfigPath)) {
    const bytes = readFileSync(projectConfigPath)
    files.push({ path: 'config/project.json', bytes: bytes.length, digest: sha256(bytes) })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { files, digest: sourceDigest(files) }
}

function capturedScenes(scenesDir: string): PublicationScene[] {
  const files = stagedFiles(scenesDir).filter((file) => file.path.endsWith('.scene.json'))
  if (!files.length) throw new Error(`no scene JSON files in ${scenesDir}`)
  const seen = new Set<string>()
  return files.map((file) => {
    const path = join(scenesDir, file.path)
    const content = readFileSync(path, 'utf8')
    let scene: PublicationScene['scene']
    try { scene = JSON.parse(content) as PublicationScene['scene'] }
    catch { throw new Error(`invalid scene JSON: ${file.path}`) }
    if (!scene.name || seen.has(scene.name)) throw new Error(`duplicate or missing scene name: ${file.path}`)
    seen.add(scene.name)
    return { name: scene.name, scene, content }
  })
}

function optionalField(text: string, name: string): string | undefined {
  return text.match(new RegExp(`${name} = "([^"]+)"`))?.[1]
}

function field(text: string, name: string): string {
  const value = optionalField(text, name)
  if (!value) throw new Error(`missing generated metadata: ${name}`)
  return value
}

function generationMetadata(stagedSourceDir: string, layoutsDir: string, expected: readonly string[]): GenerationMetadata {
  const catalog = readFileSync(join(stagedSourceDir, 'ui_asset_catalog.lua'), 'utf8')
  const catalogMetadata = {
    generationId: field(catalog, 'generationId'),
    catalogRevision: optionalField(catalog, 'catalogRevision') ?? field(catalog, 'revision'),
    schemaRevision: field(catalog, 'schemaRevision'),
    memoryFormulaRevision: field(catalog, 'memoryFormulaRevision'),
  }
  const layouts = [...expected].sort().map((name) => {
    const text = readFileSync(join(layoutsDir, `${name}.lua`), 'utf8')
    return {
      name,
      generationId: field(text, 'generationId'),
      catalogRevision: field(text, 'catalogRevision'),
      schemaRevision: field(text, 'schemaRevision'),
      compilerRevision: field(text, 'compilerRevision'),
      memoryFormulaRevision: field(text, 'memoryFormulaRevision'),
      sceneRevision: field(text, 'sceneRevision'),
    }
  })
  return { catalog: catalogMetadata, layouts }
}

type BakeManifestIsland = { id: string; baked: boolean; file?: string }
type BakeManifestScene = { name: string; sceneRevision: string; islands: BakeManifestIsland[] }
type BakeManifest = { scenes: BakeManifestScene[] }

function luaBakeCatalog(scenes: Record<string, Record<string, string>>): string {
  const revisionEntries = Object.keys(scenes).sort().map((revision) => {
    const islandEntries = Object.keys(scenes[revision]).sort()
      .map((islandId) => `[${JSON.stringify(islandId)}] = ${JSON.stringify(scenes[revision][islandId])}`)
      .join(', ')
    return `[${JSON.stringify(revision)}] = { ${islandEntries} }`
  }).join(', ')
  return [
    '-- Generated by editor/scripts/build-playdate.ts from bun run bake:islands output -- DO NOT EDIT',
    '-- This copy lives ONLY inside the immutable staged Source snapshot pdc',
    "-- compiled from; the live source/ui_bake_catalog.lua stays the checked-in",
    '-- empty default (see that file).',
    'UiBakeCatalog = {',
    '  schemaRevision = "1",',
    `  scenes = { ${revisionEntries} },`,
    '}',
    'return UiBakeCatalog',
    '',
  ].join('\n')
}

/**
 * Fold a previously-baked islands directory (`bun run bake:islands`) into the
 * staged Source snapshot: copy each still-fresh island's PNG in and rewrite
 * ui_bake_catalog.lua to point at it, keyed by the STAGED layout's current
 * sceneRevision (never the manifest's) -- pulling that revision fresh off the
 * just-regenerated layout, rather than trusting the manifest's copy of it, is
 * what makes a bake for a scene that has since changed a silent no-op instead
 * of a mismatched catalog entry. Never throws: a missing, unreadable, or
 * fully stale bake directory degrades to the checked-in empty catalog that
 * cpSync already staged, which is the same "rasterize on device" behavior
 * this project has always had.
 */
function applyBakedIslands(stagedSourceDir: string, stagedLayoutsDir: string, bakeDir: string | undefined) {
  const summary = { islandsBaked: 0, scenesBaked: 0, scenesStale: 0 }
  if (!bakeDir || !existsSync(join(bakeDir, 'manifest.json'))) return summary
  let manifest: BakeManifest
  try {
    manifest = JSON.parse(readFileSync(join(bakeDir, 'manifest.json'), 'utf8')) as BakeManifest
  } catch (error) {
    console.warn(`[build] ignoring unreadable bake manifest: ${error instanceof Error ? error.message : String(error)}`)
    return summary
  }
  const scenes: Record<string, Record<string, string>> = {}
  for (const scene of manifest.scenes ?? []) {
    const layoutPath = join(stagedLayoutsDir, `${scene.name}.lua`)
    if (!existsSync(layoutPath)) continue
    const currentRevision = optionalField(readFileSync(layoutPath, 'utf8'), 'sceneRevision')
    if (!currentRevision || currentRevision !== scene.sceneRevision) {
      console.warn(`[build] bake stale for ${scene.name} (baked ${scene.sceneRevision || '?'}, current ${currentRevision || '?'}) — skipping baked pixels for this scene`)
      summary.scenesStale++
      continue
    }
    let sceneBaked = 0
    for (const island of scene.islands ?? []) {
      if (!island.baked || !island.file) continue
      const src = join(bakeDir, island.file)
      if (!existsSync(src)) continue
      const destRelative = `images/_bake/${scene.name}/${island.id}.png`
      const dest = join(stagedSourceDir, destRelative)
      mkdirSync(dirname(dest), { recursive: true })
      cpSync(src, dest)
      // pdc compiles images/*.png to .pdi; Lua loads the stem without an
      // extension, same convention as ui_asset_catalog.lua's entries.
      scenes[currentRevision] ??= {}
      scenes[currentRevision][island.id] = destRelative.slice(0, -'.png'.length)
      sceneBaked++
    }
    if (sceneBaked > 0) { summary.scenesBaked++; summary.islandsBaked += sceneBaked }
  }
  if (summary.islandsBaked > 0) {
    writeFileSync(join(stagedSourceDir, 'ui_bake_catalog.lua'), luaBakeCatalog(scenes), 'utf8')
  }
  console.log(`[build] baked islands: ${summary.islandsBaked} loaded across ${summary.scenesBaked} scene(s)`
    + (summary.scenesStale ? `, ${summary.scenesStale} scene(s) stale (skipped, will rasterize on device)` : ''))
  return summary
}

/** Resolve the binary and its reported SDK version before making a snapshot. */
export function resolvePdcIdentity(pdc: string): PdcIdentity {
  const resolvedPath = realpathSync(pdc)
  const versionResult = spawnSync(resolvedPath, ['--version'], { encoding: 'utf8' })
  if (versionResult.error || versionResult.status !== 0) {
    throw new Error(`unable to determine pdc version: ${versionResult.error?.message ?? versionResult.status}`)
  }
  const version = `${versionResult.stdout ?? ''}\n${versionResult.stderr ?? ''}`.trim()
  if (!version) throw new Error('unable to determine pdc version: empty output')
  return {
    resolvedPath,
    sdkRoot: dirname(dirname(resolvedPath)),
    version,
    binaryDigest: sha256(readFileSync(resolvedPath)),
  }
}

/**
 * Capture Source plus artist JSON once, prove both copies are stable, publish
 * a fresh catalog-last generation only in the private Source, then compile it.
 */
export function buildFromSnapshot(options: SnapshotBuildOptions): SnapshotBuildResult {
  if (!existsSync(options.sourceDir)) throw new Error(`missing Source directory: ${options.sourceDir}`)
  const layoutRelative = relative(options.sourceDir, options.layoutsDir)
  if (!layoutRelative || layoutRelative === '..' || layoutRelative.startsWith('../') || layoutRelative.startsWith('..\\')) {
    throw new Error(`generated layouts must be inside Source: ${options.layoutsDir}`)
  }
  const snapshotDir = mkdtempSync(join(options.tempParent ?? tmpdir(), 'happy-editor-pdc-snapshot-'))
  try {
    const liveBefore = snapshotTree(options.sourceDir)
    const authoringBefore = authoringTree(options.scenesDir, options.projectConfigPath)
    // Capture authoring before accepting generated outputs. Rechecking the
    // authoring digest after parsing binds the layout names to this exact
    // input set; the existing after-copy check closes the remaining window.
    const scenes = capturedScenes(options.scenesDir)
    const authoringCaptured = authoringTree(options.scenesDir, options.projectConfigPath)
    if (authoringBefore.digest !== authoringCaptured.digest) {
      throw new Error('authoring inputs changed during snapshot capture')
    }
    const expectedLayouts = scenes.map((scene) => scene.name)
    const stagedSourceDir = join(snapshotDir, 'Source')
    const stagedScenesDir = join(snapshotDir, 'scenes')
    cpSync(options.sourceDir, stagedSourceDir, { recursive: true, dereference: true, errorOnExist: true })
    cpSync(options.scenesDir, stagedScenesDir, { recursive: true, dereference: true, errorOnExist: true })
    if (options.projectConfigPath && existsSync(options.projectConfigPath)) {
      const stagedConfig = join(snapshotDir, 'config', 'project.json')
      mkdirSync(dirname(stagedConfig), { recursive: true })
      writeFileSync(stagedConfig, readFileSync(options.projectConfigPath))
    }
    options.afterCopy?.()
    const liveAfter = snapshotTree(options.sourceDir)
    const authoringAfter = authoringTree(options.scenesDir, options.projectConfigPath)
    const stagedInputs = snapshotTree(stagedSourceDir)
    const stagedAuthoring = authoringTree(stagedScenesDir, join(snapshotDir, 'config', 'project.json'))
    if (liveBefore.digest !== liveAfter.digest || liveBefore.digest !== stagedInputs.digest) {
      throw new Error('Source changed during snapshot capture')
    }
    if (authoringBefore.digest !== authoringAfter.digest || authoringBefore.digest !== stagedAuthoring.digest) {
      throw new Error('authoring inputs changed during snapshot capture')
    }

    const stagedLayouts = join(stagedSourceDir, layoutRelative)
    // Stale live layouts/catalog are deliberately discarded only from private
    // staging; publishGeneration retains its layouts-first/catalog-last order.
    rmSync(stagedLayouts, { recursive: true, force: true })
    const prepared = prepareGeneration(stagedSourceDir, scenes, { validate: validateSceneObject })
    publishGeneration(prepared, stagedLayouts, join(stagedSourceDir, 'ui_asset_catalog.lua'))
    validatePublishedGeneration(stagedLayouts, join(stagedSourceDir, 'ui_asset_catalog.lua'), expectedLayouts)
    // Read-only fold of a previously-baked islands directory into staging,
    // after layouts/catalog are freshly regenerated so staleness is judged
    // against THIS build's sceneRevisions, not stale ones left over from an
    // earlier snapshot. See applyBakedIslands' doc comment for why this never
    // fails the build.
    applyBakedIslands(stagedSourceDir, stagedLayouts, options.bakeDir)
    const staged = snapshotTree(stagedSourceDir)
    const manifest: BuildManifest = {
      version: 2,
      source: staged,
      authoring: stagedAuthoring,
      generation: generationMetadata(stagedSourceDir, stagedLayouts, expectedLayouts),
      pdc: options.pdc,
    }
    options.onStaged?.(snapshotDir, stagedSourceDir, manifest)
    const candidateOutput = join(snapshotDir, 'candidate.pdx')
    const result = options.spawn(options.pdc.resolvedPath, ['--skip-unknown', stagedSourceDir, candidateOutput])
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`pdc failed with status ${result.status ?? 'unknown'}`)
    if (!existsSync(candidateOutput)) throw new Error('pdc completed without a candidate bundle')
    const manifestPath = `${options.outputPath}.snapshot.json`
    publishCandidate(candidateOutput, options.outputPath, `${JSON.stringify(manifest, null, 2)}\n`, options.injectPublishFailure)
    return { manifest, manifestPath }
  } finally {
    rmSync(snapshotDir, { recursive: true, force: true })
  }
}

function defaultSpawn(command: string, args: string[]) {
  return spawnSync(command, args, { stdio: 'inherit' })
}

export function main(): number {
  const pdc = findPdc()
  if (!pdc) {
    console.error('pdc not found вЂ” set PLAYDATE_SDK_PATH')
    return 1
  }
  try {
    const result = buildFromSnapshot({
      sourceDir: SOURCE_DIR,
      layoutsDir: LUA_SCENES_DIR,
      scenesDir: SCENES_DIR,
      projectConfigPath: join(ROOT, '.playdate-editor', 'project.json'),
      outputPath: PDX_OUT,
      pdc: resolvePdcIdentity(pdc),
      spawn: defaultSpawn,
      bakeDir: join(ROOT, '.playdate-editor', 'bake-islands'),
    })
    console.log(`pdc: ${result.manifest.pdc.resolvedPath}`)
    console.log(`snapshot digest: ${result.manifest.source.digest}`)
    console.log(`manifest: ${result.manifestPath}`)
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

if (import.meta.main) process.exit(main())
