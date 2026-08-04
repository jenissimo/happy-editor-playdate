import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareGeneration, publishGeneration } from '../src/core/scene/publication.ts'
import type { Scene } from '../src/core/scene/types.ts'
import { buildFromSnapshot, type PdcIdentity } from './build-playdate.ts'

const identity: PdcIdentity = {
  resolvedPath: 'C:/fake-sdk/bin/pdc', sdkRoot: 'C:/fake-sdk', version: 'pdc 2.6.0', binaryDigest: 'fake-pdc-sha256',
}

function png(path: string) {
  const bytes = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.write('IHDR', 12); bytes.writeUInt32BE(22, 16); bytes.writeUInt32BE(22, 20)
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes)
}
function scene(name: string): Scene { return { version: 1, id: name, name, width: 400, height: 240, states: ['default'], defaultState: 'default', nodes: [] } }
function candidate(path: string) { mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'bundle'), 'candidate') }
function sceneInputs(dir: string, tag: string) {
  const inputs = ['one', 'two'].map((name) => ({ name, scene: scene(name), content: `${JSON.stringify({ ...scene(name), id: `${tag}-${name}` })}\n` }))
  mkdirSync(dir, { recursive: true })
  for (const input of inputs) writeFileSync(join(dir, `${input.name}.scene.json`), input.content)
  return inputs
}
function makeProject(root: string, tag = 'source') {
  const source = join(root, 'Source'), layouts = join(source, 'layouts'), scenesDir = join(root, 'scenes')
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'pdxinfo'), 'name=Snapshot Test\n')
  writeFileSync(join(source, 'main.lua'), `-- ${tag}\n`)
  png(join(source, 'fonts/Roobert-11-Medium-table-22-22.png'))
  writeFileSync(join(source, 'fonts/Roobert-11-Medium.fnt'), 'glyph=65')
  const scenes = sceneInputs(scenesDir, tag).map((input) => ({ ...input, scene: JSON.parse(input.content) as Scene }))
  const prepared = prepareGeneration(source, scenes)
  publishGeneration(prepared, layouts, join(source, 'ui_asset_catalog.lua'))
  return { source, layouts, scenesDir, sourceDir: source, layoutsDir: layouts }
}

describe('Playdate snapshot build', () => {
  test('invokes pdc with staged Source whose bytes cannot be changed by later live edits', () => {
    const root = mkdtempSync(join(tmpdir(), 'build-snapshot-test-'))
    try {
      const project = makeProject(root, 'before')
      const outputPath = join(root, 'out', 'Editor.pdx')
      let snapshotDir = '', stagedSource = '', consumedMain = ''
      const result = buildFromSnapshot({
        ...project,
        outputPath,
        pdc: identity,
        onStaged: (snapshot, staged) => { snapshotDir = snapshot; stagedSource = staged },
        spawn: (command, args) => {
          expect(command).toBe(identity.resolvedPath)
          expect(args[1]).not.toBe(project.source)
          expect(args[1]).toBe(stagedSource)
          writeFileSync(join(project.source, 'main.lua'), '-- changed after snapshot\n')
          consumedMain = readFileSync(join(args[1], 'main.lua'), 'utf8')
          candidate(args[2])
          return { status: 0 }
        },
      })
      expect(consumedMain).toBe('-- before\n')
      expect(readFileSync(join(project.source, 'main.lua'), 'utf8')).toBe('-- changed after snapshot\n')
      expect(existsSync(snapshotDir)).toBe(false)
      expect(result.manifest.pdc).toEqual(identity)
      expect(result.manifest.source.files.some((file) => file.path === 'main.lua')).toBe(true)
      expect(JSON.parse(readFileSync(result.manifestPath, 'utf8'))).toEqual(result.manifest)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('has deterministic source manifests for identical inputs and binds pdc identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'build-manifest-test-'))
    try {
      const project = makeProject(root, 'same')
      const run = (pdc = identity) => buildFromSnapshot({
        ...project,
        outputPath: join(root, 'out', `${pdc.version.replace(/[^0-9]/g, '')}.pdx`),
        pdc,
        spawn: (_, args) => { candidate(args[2]); return { status: 0 } },
      }).manifest
      const first = run(), second = run()
      expect(second).toEqual(first)
      const changedPdc = { ...identity, version: 'pdc 2.7.0', binaryDigest: 'new-fake-pdc-sha256' }
      const withChangedPdc = run(changedPdc)
      expect(withChangedPdc.source.digest).toBe(first.source.digest)
      expect(withChangedPdc).not.toEqual(first)
      expect(withChangedPdc.pdc.version).toBe('pdc 2.7.0')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('regenerates staged Lua from current JSON and controllers without changing stale live outputs', () => {
    const root = mkdtempSync(join(tmpdir(), 'build-regenerate-test-'))
    try {
      const project = makeProject(root)
      for (const name of ['old', 'current']) png(join(project.source, `images/${name}.png`))
      const controller = join(project.source, 'scenes', 'one.lua')
      mkdirSync(dirname(controller), { recursive: true })
      writeFileSync(controller, 'Ui.load(OneScene)\nlocal icon = "images/old"\n')
      const stale = prepareGeneration(project.source, sceneInputs(project.scenesDir, 'old').map((input) => ({ ...input, scene: JSON.parse(input.content) as Scene })))
      publishGeneration(stale, project.layouts, join(project.source, 'ui_asset_catalog.lua'))
      const liveLayout = readFileSync(join(project.layouts, 'one.lua'), 'utf8')
      const liveCatalog = readFileSync(join(project.source, 'ui_asset_catalog.lua'), 'utf8')
      writeFileSync(join(project.scenesDir, 'one.scene.json'), `${JSON.stringify({ ...scene('one'), id: 'current-one' })}\n`)
      writeFileSync(controller, 'Ui.load(OneScene)\nlocal icon = "images/current"\n')
      let stagedLayout = ''
      buildFromSnapshot({
        ...project,
        outputPath: join(root, 'out', 'Editor.pdx'), pdc: identity,
        spawn: (_, args) => {
          stagedLayout = readFileSync(join(args[1], 'layouts', 'one.lua'), 'utf8')
          candidate(args[2])
          return { status: 0 }
        },
      })
      expect(stagedLayout).toContain('images/current')
      expect(stagedLayout).toContain('current-one')
      expect(stagedLayout).not.toContain('images/old')
      expect(readFileSync(join(project.layouts, 'one.lua'), 'utf8')).toBe(liveLayout)
      expect(readFileSync(join(project.source, 'ui_asset_catalog.lua'), 'utf8')).toBe(liveCatalog)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('detects live Source and authoring drift during copy before pdc is invoked', () => {
    const root = mkdtempSync(join(tmpdir(), 'build-drift-test-'))
    try {
      const project = makeProject(root)
      let invoked = false
      expect(() => buildFromSnapshot({
        ...project,
        outputPath: join(root, 'out', 'Editor.pdx'), pdc: identity,
        afterCopy: () => writeFileSync(join(project.source, 'main.lua'), '-- drift\n'),
        spawn: () => { invoked = true; return { status: 0 } },
      })).toThrow('Source changed during snapshot capture')
      expect(invoked).toBe(false)
      const authoringProject = makeProject(join(root, 'authoring'))
      expect(() => buildFromSnapshot({
        ...authoringProject,
        outputPath: join(root, 'out', 'Editor.pdx'), pdc: identity,
        afterCopy: () => writeFileSync(join(authoringProject.scenesDir, 'one.scene.json'), `${JSON.stringify({ ...scene('one'), id: 'drifted' })}\n`),
        spawn: () => { invoked = true; return { status: 0 } },
      })).toThrow('authoring inputs changed during snapshot capture')
      expect(invoked).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('cleans only its private snapshot after injected pdc failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'build-cleanup-test-'))
    try {
      const project = makeProject(root)
      const oldTemp = join(root, 'happy-editor-pdc-snapshot-old.tmp')
      writeFileSync(oldTemp, 'pre-existing')
      let snapshotDir = ''
      expect(() => buildFromSnapshot({
        ...project,
        outputPath: join(root, 'out', 'Editor.pdx'), pdc: identity, tempParent: root,
        onStaged: (snapshot) => { snapshotDir = snapshot },
        spawn: () => { throw new Error('injected pdc failure') },
      })).toThrow('injected pdc failure')
      expect(existsSync(snapshotDir)).toBe(false)
      expect(readFileSync(oldTemp, 'utf8')).toBe('pre-existing')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('rolls back an existing bundle and sidecar when either publication step fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'build-publish-test-'))
    try {
      const project = makeProject(root), outputPath = join(root, 'out', 'Editor.pdx'), manifest = `${outputPath}.snapshot.json`
      mkdirSync(outputPath, { recursive: true }); writeFileSync(join(outputPath, 'bundle'), 'old-bundle')
      mkdirSync(dirname(manifest), { recursive: true }); writeFileSync(manifest, 'old-manifest')
      for (const point of ['bundle', 'manifest'] as const) {
        expect(() => buildFromSnapshot({
          ...project, outputPath, pdc: identity,
          spawn: (_, args) => { candidate(args[2]); return { status: 0 } },
          injectPublishFailure: (at) => { if (at === point) throw new Error(`fail-${point}`) },
        })).toThrow(`fail-${point}`)
        expect(readFileSync(join(outputPath, 'bundle'), 'utf8')).toBe('old-bundle')
        expect(readFileSync(manifest, 'utf8')).toBe('old-manifest')
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('leaves no first-time final artifacts when either publication step fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'build-first-publish-test-'))
    try {
      const project = makeProject(root), outputPath = join(root, 'out', 'Editor.pdx'), manifest = `${outputPath}.snapshot.json`
      for (const point of ['bundle', 'manifest'] as const) {
        expect(() => buildFromSnapshot({
          ...project, outputPath, pdc: identity,
          spawn: (_, args) => { candidate(args[2]); return { status: 0 } },
          injectPublishFailure: (at) => { if (at === point) throw new Error(`first-${point}`) },
        })).toThrow(`first-${point}`)
        expect(existsSync(outputPath)).toBe(false)
        expect(existsSync(manifest)).toBe(false)
      }
      expect(existsSync(join(root, 'out')) ? readdirSync(join(root, 'out')) : []).toEqual([])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('cleans a partial failed-pdc candidate and preserves prior outputs or absence', () => {
    const root = mkdtempSync(join(tmpdir(), 'build-partial-pdc-test-'))
    try {
      for (const existing of [false, true]) {
        const caseRoot = join(root, existing ? 'existing' : 'absent'), project = makeProject(caseRoot)
        const outputPath = join(caseRoot, 'out', 'Editor.pdx'), manifest = `${outputPath}.snapshot.json`
        if (existing) { mkdirSync(outputPath, { recursive: true }); writeFileSync(join(outputPath, 'bundle'), 'prior'); writeFileSync(manifest, 'prior-manifest') }
        let snapshot = ''
        expect(() => buildFromSnapshot({
          ...project, outputPath, pdc: identity,
          onStaged: (dir) => { snapshot = dir },
          spawn: (_, args) => { candidate(args[2]); writeFileSync(join(args[2], 'partial'), 'partial'); return { status: 1 } },
        })).toThrow('pdc failed with status 1')
        expect(existsSync(snapshot)).toBe(false)
        if (existing) {
          expect(readFileSync(join(outputPath, 'bundle'), 'utf8')).toBe('prior')
          expect(readFileSync(manifest, 'utf8')).toBe('prior-manifest')
        } else {
          expect(existsSync(outputPath)).toBe(false)
          expect(existsSync(manifest)).toBe(false)
        }
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('retains only recovery backups whose restoration is injected to fail', () => {
    const root = mkdtempSync(join(tmpdir(), 'build-restore-failure-test-'))
    try {
      for (const restore of [['restore-bundle'], ['restore-manifest'], ['restore-bundle', 'restore-manifest']]) {
        const caseRoot = join(root, restore.join('-')), project = makeProject(caseRoot)
        const outputPath = join(caseRoot, 'out', 'Editor.pdx'), manifest = `${outputPath}.snapshot.json`
        mkdirSync(outputPath, { recursive: true }); writeFileSync(join(outputPath, 'bundle'), 'prior')
        writeFileSync(manifest, 'prior-manifest')
        expect(() => buildFromSnapshot({
          ...project, outputPath, pdc: identity,
          spawn: (_, args) => { candidate(args[2]); return { status: 0 } },
          injectPublishFailure: (point) => {
            if (point === 'manifest' || (restore as string[]).includes(point)) throw new Error(`fail-${point}`)
          },
        })).toThrow('recovery backups retained:')
        const retained = readdirSync(dirname(outputPath)).filter((name) => name.includes('.backup'))
        expect(retained).toHaveLength(restore.length)
        for (const backup of retained) {
          const path = join(dirname(outputPath), backup)
          expect(backup.includes('bundle') ? readFileSync(join(path, 'bundle'), 'utf8') : readFileSync(path, 'utf8')).toContain('prior')
        }
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
