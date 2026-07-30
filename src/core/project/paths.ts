/**
 * Resolve the host project root and content directories.
 *
 * Standalone (this repo): ROOT = package root, paths under playdate/.
 * Submodule: host game owns Source/ + scenes/; editor package is nested.
 *
 * Resolution order for ROOT:
 * 1. HAPPY_EDITOR_ROOT / PLAYDATE_EDITOR_ROOT (absolute or cwd-relative)
 * 2. process.cwd() when it has .playdate-editor/project.json or a Playdate Source/
 * 3. Parent of the editor package when it looks like a host game
 *    (Source/pdxinfo + scenes/ or .playdate-editor/)
 * 4. Editor package root (fixture layout under playdate/)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Always the happy-editor-playdate package (schema, Vite app, ui.lua fixture). */
export const PACKAGE_ROOT = normalize(
  join(fileURLToPath(new URL('../../..', import.meta.url))),
)

export type AssistantProvider = 'cursor' | 'claude' | 'codex'

export type AssistantEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const DEFAULT_ASSISTANT_EFFORT: AssistantEffort = 'medium'

export const ASSISTANT_EFFORTS: readonly AssistantEffort[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type AssistantConfig = {
  /** Headless CLI used by Nibble. Set at project install time. */
  provider: AssistantProvider
  /** Reasoning effort (default medium). Mapped per CLI. */
  effort?: AssistantEffort
  /** Optional provider model / alias. */
  model?: string
}

export type ProjectConfig = {
  version: 1
  /** Scene JSON directory, relative to project root. */
  sceneRoot: string
  /** Playdate Source directory (assets + runtime), relative to project root. */
  sourceRoot: string
  /** Generated scene Lua directory, relative to project root. */
  generatedLuaRoot: string
  /** Optional narrower asset roots (informational; indexer walks sourceRoot). */
  assetRoots?: string[]
  /** Scene opened when workspace has no activeScene. */
  defaultScene?: string
  /** pdc output path relative to project root. */
  pdxOut?: string
  /** Optional Nibble AI assistant settings. */
  assistant?: AssistantConfig
}

export type ProjectPaths = {
  /** Host project root (game or this fixture repo). */
  root: string
  /** Editor package root (always this repo). */
  packageRoot: string
  scenesDir: string
  sourceDir: string
  luaScenesDir: string
  editorDir: string
  schemaPath: string
  pdxOut: string
  config: ProjectConfig
  /** How ROOT was chosen — for API / diagnostics. */
  rootSource:
    | 'env'
    | 'cwd'
    | 'parent-host'
    | 'package'
}

const FIXTURE_DEFAULTS: ProjectConfig = {
  version: 1,
  sceneRoot: 'playdate/scenes',
  sourceRoot: 'playdate/Source',
  generatedLuaRoot: 'playdate/Source/scenes',
  assetRoots: ['playdate/Source/images', 'playdate/Source/fonts'],
  defaultScene: 'menu',
  pdxOut: 'playdate/Editor.pdx',
}

const HOST_DEFAULTS: ProjectConfig = {
  version: 1,
  sceneRoot: 'scenes',
  sourceRoot: 'Source',
  generatedLuaRoot: 'Source/scenes',
  assetRoots: ['Source/images', 'Source/fonts'],
  defaultScene: 'menu',
  pdxOut: 'Editor.pdx',
}

function isPlaydateSource(dir: string): boolean {
  return (
    existsSync(join(dir, 'pdxinfo')) ||
    existsSync(join(dir, 'main.lua'))
  )
}

function looksLikeHostGame(dir: string): boolean {
  const source = join(dir, 'Source')
  if (!isPlaydateSource(source)) return false
  return (
    existsSync(join(dir, 'scenes')) ||
    existsSync(join(dir, '.playdate-editor', 'project.json')) ||
    existsSync(join(dir, '.playdate-editor'))
  )
}

function hasProjectConfig(dir: string): boolean {
  return existsSync(join(dir, '.playdate-editor', 'project.json'))
}

function hasFixtureLayout(dir: string): boolean {
  return (
    existsSync(join(dir, 'playdate', 'Source')) &&
    existsSync(join(dir, 'playdate', 'scenes'))
  )
}

function envRoot(): string | null {
  const raw =
    process.env.HAPPY_EDITOR_ROOT?.trim() ||
    process.env.PLAYDATE_EDITOR_ROOT?.trim()
  if (!raw) return null
  return normalize(isAbsolute(raw) ? raw : resolve(process.cwd(), raw))
}

function resolveRoot(): { root: string; rootSource: ProjectPaths['rootSource'] } {
  const fromEnv = envRoot()
  if (fromEnv) return { root: fromEnv, rootSource: 'env' }

  const cwd = normalize(process.cwd())
  const pkg = normalize(PACKAGE_ROOT)
  const parent = dirname(pkg)

  // Submodule zero-config: `bun dev` inside the editor package, host game is parent.
  if (
    cwd === pkg &&
    parent !== pkg &&
    looksLikeHostGame(parent)
  ) {
    return { root: parent, rootSource: 'parent-host' }
  }

  if (hasProjectConfig(cwd) || looksLikeHostGame(cwd) || hasFixtureLayout(cwd)) {
    return { root: cwd, rootSource: 'cwd' }
  }

  if (parent !== pkg && looksLikeHostGame(parent)) {
    return { root: parent, rootSource: 'parent-host' }
  }

  return { root: PACKAGE_ROOT, rootSource: 'package' }
}

function defaultsFor(root: string): ProjectConfig {
  if (hasFixtureLayout(root) || root === PACKAGE_ROOT) {
    return { ...FIXTURE_DEFAULTS }
  }
  if (looksLikeHostGame(root) || isPlaydateSource(join(root, 'Source'))) {
    return { ...HOST_DEFAULTS }
  }
  return { ...FIXTURE_DEFAULTS }
}

function mergeConfig(
  base: ProjectConfig,
  raw: Partial<ProjectConfig> | null,
): ProjectConfig {
  if (!raw) return base
  const assistant = mergeAssistant(raw.assistant ?? base.assistant)
  return {
    version: 1,
    sceneRoot: raw.sceneRoot ?? base.sceneRoot,
    sourceRoot: raw.sourceRoot ?? base.sourceRoot,
    generatedLuaRoot: raw.generatedLuaRoot ?? base.generatedLuaRoot,
    assetRoots: raw.assetRoots ?? base.assetRoots,
    defaultScene: raw.defaultScene ?? base.defaultScene,
    pdxOut: raw.pdxOut ?? base.pdxOut,
    ...(assistant ? { assistant } : {}),
  }
}

const ASSISTANT_PROVIDERS: readonly AssistantProvider[] = [
  'cursor',
  'claude',
  'codex',
]

function mergeAssistant(
  raw: Partial<AssistantConfig> | AssistantConfig | undefined,
): AssistantConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const provider = raw.provider
  if (
    typeof provider !== 'string' ||
    !ASSISTANT_PROVIDERS.includes(provider as AssistantProvider)
  ) {
    return undefined
  }
  const cfg: AssistantConfig = { provider: provider as AssistantProvider }
  if (
    typeof raw.effort === 'string' &&
    ASSISTANT_EFFORTS.includes(raw.effort as AssistantEffort)
  ) {
    cfg.effort = raw.effort as AssistantEffort
  }
  if (typeof raw.model === 'string' && raw.model.trim()) {
    cfg.model = raw.model.trim()
  }
  return cfg
}

export function isAssistantEffort(value: unknown): value is AssistantEffort {
  return (
    typeof value === 'string' &&
    ASSISTANT_EFFORTS.includes(value as AssistantEffort)
  )
}

export function isAssistantProvider(value: unknown): value is AssistantProvider {
  return (
    typeof value === 'string' &&
    ASSISTANT_PROVIDERS.includes(value as AssistantProvider)
  )
}

export function readProjectConfigFile(editorDir: string): Partial<ProjectConfig> | null {
  const path = join(editorDir, 'project.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Partial<ProjectConfig>
  } catch {
    return null
  }
}

export function writeProjectConfig(editorDir: string, config: ProjectConfig) {
  mkdirSync(editorDir, { recursive: true })
  const path = join(editorDir, 'project.json')
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

export function resolveProjectPaths(
  overrideRoot?: string,
): ProjectPaths {
  const { root: detected, rootSource } = overrideRoot
    ? {
        root: normalize(
          isAbsolute(overrideRoot)
            ? overrideRoot
            : resolve(process.cwd(), overrideRoot),
        ),
        rootSource: 'env' as const,
      }
    : resolveRoot()

  const editorDir = join(detected, '.playdate-editor')
  const base = defaultsFor(detected)
  const config = mergeConfig(base, readProjectConfigFile(editorDir))

  return {
    root: detected,
    packageRoot: PACKAGE_ROOT,
    scenesDir: join(detected, config.sceneRoot),
    sourceDir: join(detected, config.sourceRoot),
    luaScenesDir: join(detected, config.generatedLuaRoot),
    editorDir,
    schemaPath: join(PACKAGE_ROOT, 'schema', 'playdate-scene.schema.json'),
    pdxOut: join(detected, config.pdxOut ?? base.pdxOut ?? 'Editor.pdx'),
    config,
    rootSource,
  }
}

/** Cached paths for the process (Vite / scripts). */
let cached: ProjectPaths | null = null

export function getProjectPaths(): ProjectPaths {
  if (!cached) cached = resolveProjectPaths()
  return cached
}

/** Test helper — clear cache after changing env / cwd mocks. */
export function resetProjectPathsCache() {
  cached = null
}

export function ensureProjectConfig(): ProjectConfig {
  const paths = getProjectPaths()
  if (!existsSync(join(paths.editorDir, 'project.json'))) {
    writeProjectConfig(paths.editorDir, paths.config)
  }
  return paths.config
}
