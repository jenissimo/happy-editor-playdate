import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import Ajv2020Module from 'ajv/dist/2020.js'
import type { Scene } from './types.ts'
import { exportSceneLua } from './export.ts'
import {
  ensureProjectConfig,
  getProjectPaths,
  type ProjectConfig,
} from '../project/paths.ts'

const Ajv2020 = Ajv2020Module as unknown as new (options?: {
  allErrors?: boolean
  strict?: boolean
}) => {
  compile: (schema: object) => ((data: unknown) => boolean) & {
    errors: Array<{ instancePath?: string; message?: string }> | null
  }
}

const _paths = getProjectPaths()

/** Host project root (game repo or this fixture). See `src/core/project/paths.ts`. */
export const ROOT = _paths.root
export const PACKAGE_ROOT = _paths.packageRoot
export const SCENES_DIR = _paths.scenesDir
export const LUA_SCENES_DIR = _paths.luaScenesDir
export const SOURCE_DIR = _paths.sourceDir
export const SCHEMA_PATH = _paths.schemaPath
export const EDITOR_DIR = _paths.editorDir
export const PDX_OUT = _paths.pdxOut
export const PROJECT_CONFIG: ProjectConfig = _paths.config
export const PROJECT_ROOT_SOURCE = _paths.rootSource

export type Diagnostic = {
  id: string
  severity: 'error' | 'warning' | 'info'
  path?: string
  message: string
}

export type SceneFile = {
  id: string
  name: string
  path: string
  relativePath: string
  revision: string
  scene: Scene
  diagnostics: Diagnostic[]
}

function loadSchema() {
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as object
}

export function createSceneValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  return ajv.compile(loadSchema())
}

export function revisionOf(content: string): string {
  return createHash('sha1').update(content).digest('hex').slice(0, 12)
}

export function collectNodeIds(
  nodes: Scene['nodes'],
  seen = new Set<string>(),
  dupes: string[] = [],
): string[] {
  for (const n of nodes) {
    if (seen.has(n.id)) dupes.push(n.id)
    else seen.add(n.id)
    if (n.type === 'group') collectNodeIds(n.children, seen, dupes)
  }
  return dupes
}

export function validateSceneObject(
  scene: unknown,
  validate = createSceneValidator(),
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const ok = validate(scene)
  if (!ok && validate.errors) {
    for (const err of validate.errors) {
      diagnostics.push({
        id: `schema:${err.instancePath || '/'}`,
        severity: 'error',
        message: `${err.instancePath || '/'} ${err.message ?? 'invalid'}`,
      })
    }
  }
  if (scene && typeof scene === 'object' && Array.isArray((scene as Scene).nodes)) {
    const dupes = collectNodeIds((scene as Scene).nodes)
    for (const id of dupes) {
      diagnostics.push({
        id: `duplicate:${id}`,
        severity: 'error',
        message: `Duplicate node id: ${id}`,
      })
    }
    const s = scene as Scene
    if (s.defaultState && !s.states.includes(s.defaultState)) {
      diagnostics.push({
        id: 'defaultState',
        severity: 'error',
        message: `defaultState "${s.defaultState}" is not in states`,
      })
    }
  }
  return diagnostics
}

export function listScenePaths(): string[] {
  if (!existsSync(SCENES_DIR)) return []
  return readdirSync(SCENES_DIR)
    .filter((f) => f.endsWith('.scene.json'))
    .map((f) => join(SCENES_DIR, f))
    .sort()
}

export function readSceneFile(path: string): SceneFile {
  const raw = readFileSync(path, 'utf8')
  const relativePath = relative(ROOT, path).replace(/\\/g, '/')
  let scene: Scene
  const diagnostics: Diagnostic[] = []
  try {
    scene = JSON.parse(raw) as Scene
  } catch (e) {
    diagnostics.push({
      id: 'parse',
      severity: 'error',
      path: relativePath,
      message: e instanceof Error ? e.message : 'JSON parse failed',
    })
    scene = {
      version: 1,
      id: 'invalid',
      name: 'invalid',
      width: 400,
      height: 240,
      states: ['default'],
      defaultState: 'default',
      nodes: [],
    }
    return {
      id: scene.id,
      name: scene.name,
      path,
      relativePath,
      revision: revisionOf(raw),
      scene,
      diagnostics,
    }
  }
  diagnostics.push(
    ...validateSceneObject(scene).map((d) => ({ ...d, path: relativePath })),
  )
  return {
    id: scene.id,
    name: scene.name,
    path,
    relativePath,
    revision: revisionOf(raw),
    scene,
    diagnostics,
  }
}

export function listScenes(): SceneFile[] {
  return listScenePaths().map(readSceneFile)
}

export function atomicWrite(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, path)
}

export function writeSceneJson(scene: Scene, path?: string): { path: string; revision: string } {
  const out =
    path ??
    join(SCENES_DIR, `${scene.name}.scene.json`)
  const content = `${JSON.stringify(scene, null, 2)}\n`
  atomicWrite(out, content)
  return { path: out, revision: revisionOf(content) }
}

export function sceneLuaPath(sceneName: string): string {
  return join(LUA_SCENES_DIR, `${sceneName}.lua`)
}

export function generateSceneLua(scene: Scene): { path: string; content: string } {
  const content = exportSceneLua(scene)
  const path = sceneLuaPath(scene.name)
  atomicWrite(path, content)
  return { path, content }
}

export function ensureEditorDirs() {
  mkdirSync(EDITOR_DIR, { recursive: true })
  mkdirSync(join(EDITOR_DIR, 'layouts'), { recursive: true })
  mkdirSync(SCENES_DIR, { recursive: true })
  mkdirSync(LUA_SCENES_DIR, { recursive: true })
  ensureProjectConfig()
}

export function loadProjectConfig(): ProjectConfig {
  ensureEditorDirs()
  return getProjectPaths().config
}
