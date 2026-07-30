import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  copyFileSync,
  watch,
  type FSWatcher,
} from 'node:fs'
import { join, relative } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'
import {
  EDITOR_DIR,
  PACKAGE_ROOT,
  PROJECT_CONFIG,
  PROJECT_ROOT_SOURCE,
  ROOT,
  SCENES_DIR,
  SCHEMA_PATH,
  SOURCE_DIR,
  atomicWrite,
  ensureEditorDirs,
  generateSceneLua,
  listScenes,
  loadProjectConfig,
  readSceneFile,
  revisionOf,
  validateSceneObject,
  writeSceneJson,
  type Diagnostic,
  type SceneFile,
} from '../src/core/scene/io.ts'
import { indexPlaydateAssets, readAssetBytes } from '../src/core/assets/indexAssets.ts'
import type { Scene } from '../src/core/scene/types.ts'
import { buildAndRunSimulator } from '../src/core/playdate/sdk.ts'
import {
  findProviderBinary,
  providerDisplayName,
  type AssistantMode,
} from '../src/core/assistant/providers.ts'
import {
  buildAssistantCliPrompt,
  buildAssistantInstructions,
  buildNodeInventory,
} from '../src/core/assistant/prompt.ts'
import { startAssistantRun } from '../src/core/assistant/run.ts'
import {
  DEFAULT_ASSISTANT_EFFORT,
  isAssistantEffort,
  isAssistantProvider,
  readProjectConfigFile,
  type AssistantEffort,
  type AssistantProvider,
} from '../src/core/project/paths.ts'

type WorkspaceFile = {
  version: number
  layout: unknown
  preferences: Record<string, unknown>
  pan?: { x: number; y: number }
  activeScene?: string
}

const MIME: Record<string, string> = {
  png: 'image/png',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  fnt: 'text/plain; charset=utf-8',
  json: 'application/json',
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function loadWorkspace(): WorkspaceFile {
  ensureEditorDirs()
  const path = join(EDITOR_DIR, 'workspace.json')
  if (!existsSync(path)) {
    const empty: WorkspaceFile = {
      version: 1,
      layout: null,
      preferences: {},
      activeScene: PROJECT_CONFIG.defaultScene ?? 'menu',
    }
    atomicWrite(path, `${JSON.stringify(empty, null, 2)}\n`)
    return empty
  }
  return JSON.parse(readFileSync(path, 'utf8')) as WorkspaceFile
}

function loadProject() {
  return loadProjectConfig()
}

function broadcast(server: ViteDevServer, event: string, data: unknown) {
  server.ws.send({ type: 'custom', event, data })
}

function collectDiagnostics(): Diagnostic[] {
  return listScenes().flatMap((s: SceneFile) => s.diagnostics)
}

function resolveAssistantProvider(): {
  provider: AssistantProvider | null
  available: boolean
  binary: string | null
  displayName: string | null
  effort: AssistantEffort
  model?: string
} {
  const fromFile = readProjectConfigFile(EDITOR_DIR)
  const provider = fromFile?.assistant?.provider ?? null
  if (!provider || !isAssistantProvider(provider)) {
    return {
      provider: null,
      available: false,
      binary: null,
      displayName: null,
      effort: DEFAULT_ASSISTANT_EFFORT,
    }
  }
  const binary = findProviderBinary(provider)
  const effort = isAssistantEffort(fromFile?.assistant?.effort)
    ? fromFile!.assistant!.effort!
    : DEFAULT_ASSISTANT_EFFORT
  const model =
    typeof fromFile?.assistant?.model === 'string'
      ? fromFile.assistant.model.trim() || undefined
      : undefined
  return {
    provider,
    available: Boolean(binary),
    binary,
    displayName: providerDisplayName(provider),
    effort,
    ...(model ? { model } : {}),
  }
}

function relFromRoot(absPath: string): string {
  return relative(ROOT, absPath).replace(/\\/g, '/')
}

function prepareNibbleRunPack(input: {
  mode: AssistantMode
  message: string
  sceneFile: SceneFile
  schemaPath: string
  activeState: string
  selectedIds: string[]
  selectedSummary?: string
  previewPngBase64?: string
  effort: AssistantEffort
  provider: AssistantProvider
}): {
  prompt: string
  hasPreview: boolean
  instructionsRel: string
} {
  const runDir = join(EDITOR_DIR, 'nibble-run')
  mkdirSync(runDir, { recursive: true })

  const formatSrc = join(PACKAGE_ROOT, 'docs', 'SCENE_FORMAT.md')
  const formatDest = join(runDir, 'SCENE_FORMAT.md')
  if (existsSync(formatSrc)) {
    copyFileSync(formatSrc, formatDest)
  }

  let hasPreview = false
  const previewDest = join(runDir, 'preview.png')
  const b64 = input.previewPngBase64?.trim()
  if (b64) {
    try {
      writeFileSync(previewDest, Buffer.from(b64, 'base64'))
      hasPreview = true
    } catch {
      hasPreview = false
    }
  }

  const instructionsPath = join(runDir, 'INSTRUCTIONS.md')
  const instructionsRel = relFromRoot(instructionsPath)
  const formatRel = existsSync(formatDest)
    ? relFromRoot(formatDest)
    : relFromRoot(formatSrc)
  const previewRel = hasPreview ? relFromRoot(previewDest) : undefined
  const sceneRel = relFromRoot(input.sceneFile.path)
  const schemaRel = relFromRoot(input.schemaPath)

  const effortNote =
    input.provider === 'cursor'
      ? `${input.effort} (Cursor: use model id / suffix; see project assistant.model)`
      : input.effort

  const instructions = buildAssistantInstructions({
    mode: input.mode,
    userMessage: input.message,
    sceneName: input.sceneFile.name,
    scenePath: sceneRel,
    schemaPath: schemaRel,
    formatDocPath: formatRel,
    previewPath: previewRel,
    activeState: input.activeState,
    selectedIds: input.selectedIds,
    selectedSummary: input.selectedSummary,
    nodeInventory: buildNodeInventory(input.sceneFile.scene),
    effortNote,
  })
  writeFileSync(instructionsPath, `${instructions}\n`, 'utf8')

  return {
    prompt: buildAssistantCliPrompt({
      instructionsRel,
      hasPreview,
    }),
    hasPreview,
    instructionsRel,
  }
}

let activeAssistantKill: (() => void) | null = null

export function playdateProjectBridge(): Plugin {
  let watchers: FSWatcher[] = []
  let serverRef: ViteDevServer | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null

  const notify = (event: string, data: unknown) => {
    if (!serverRef) return
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      broadcast(serverRef!, event, data)
    }, 40)
  }

  const attachWatchers = () => {
    for (const w of watchers) w.close()
    watchers = []
    ensureEditorDirs()
    const dirs = [SCENES_DIR, SOURCE_DIR, EDITOR_DIR, join(PACKAGE_ROOT, 'schema')]
    for (const dir of dirs) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      try {
        const w = watch(dir, { recursive: true }, (_kind, filename) => {
          if (!filename) return
          const name = filename.toString().replace(/\\/g, '/')
          if (name.endsWith('.tmp')) return
          if (name.includes('.scene.json') || dir === SCENES_DIR) {
            // Handle both 'change' and 'rename' — Windows atomic writes are renames.
            if (name.endsWith('.scene.json')) {
              try {
                const base = name.includes('/') ? name.split('/').pop()! : name
                const full = join(SCENES_DIR, base)
                const path = existsSync(full)
                  ? full
                  : listScenes().find((s: SceneFile) =>
                      s.relativePath.endsWith(name) ||
                      s.relativePath.endsWith(base),
                    )?.path
                if (path) {
                  const file = readSceneFile(path)
                  if (!file.diagnostics.some((d) => d.severity === 'error')) {
                    generateSceneLua(file.scene)
                    notify('playdate:generated', {
                      scene: file.name,
                      revision: file.revision,
                    })
                  }
                  notify('playdate:scene-changed', {
                    id: file.id,
                    name: file.name,
                    revision: file.revision,
                    relativePath: file.relativePath,
                    diagnostics: file.diagnostics,
                  })
                } else {
                  // Strip extension so the client can fetch by scene name.
                  const sceneName = base.replace(/\.scene\.json$/i, '')
                  notify('playdate:scene-changed', { name: sceneName })
                }
              } catch {
                const base = name.includes('/') ? name.split('/').pop()! : name
                notify('playdate:scene-changed', {
                  error: true,
                  name: base.replace(/\.scene\.json$/i, ''),
                })
              }
            } else {
              notify('playdate:scene-changed', { name })
            }
          } else if (dir === SOURCE_DIR) {
            notify('playdate:assets-changed', { name })
          } else if (dir === EDITOR_DIR) {
            notify('playdate:workspace-changed', { name })
          }
        })
        watchers.push(w)
      } catch {
        /* watch may fail on some FS */
      }
    }
  }

  return {
    name: 'playdate-project-bridge',
    configureServer(server) {
      serverRef = server
      ensureEditorDirs()
      attachWatchers()

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/__playdate/')) return next()

        try {
          if (url.startsWith('/__playdate/assets/')) {
            const rel = decodeURIComponent(
              url.slice('/__playdate/assets/'.length).split('?')[0]!,
            )
            const buf = readAssetBytes(rel)
            if (!buf) return sendJson(res, 404, { error: 'not found' })
            const ext = rel.split('.').pop()?.toLowerCase() ?? ''
            res.statusCode = 200
            res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
            res.setHeader('Cache-Control', 'no-cache')
            res.end(buf)
            return
          }

          if (url === '/__playdate/api/project' && req.method === 'GET') {
            return sendJson(res, 200, {
              project: loadProject(),
              workspace: loadWorkspace(),
              scenes: listScenes().map((s: SceneFile) => ({
                id: s.id,
                name: s.name,
                relativePath: s.relativePath,
                revision: s.revision,
                diagnostics: s.diagnostics,
              })),
              assets: indexPlaydateAssets(),
              diagnostics: collectDiagnostics(),
              root: ROOT,
              packageRoot: PACKAGE_ROOT,
              rootSource: PROJECT_ROOT_SOURCE,
              paths: {
                scenes: SCENES_DIR,
                source: SOURCE_DIR,
                editor: EDITOR_DIR,
              },
            })
          }

          if (url === '/__playdate/api/assets' && req.method === 'GET') {
            return sendJson(res, 200, { assets: indexPlaydateAssets() })
          }

          if (url === '/__playdate/api/workspace' && req.method === 'GET') {
            return sendJson(res, 200, loadWorkspace())
          }

          if (url === '/__playdate/api/workspace' && req.method === 'PUT') {
            const body = JSON.parse(await readBody(req)) as WorkspaceFile
            const path = join(EDITOR_DIR, 'workspace.json')
            atomicWrite(path, `${JSON.stringify(body, null, 2)}\n`)
            return sendJson(res, 200, {
              ok: true,
              revision: revisionOf(JSON.stringify(body)),
            })
          }

          const sceneMatch = url.match(/^\/__playdate\/api\/scenes\/([^/?]+)(.*)$/)
          if (sceneMatch) {
            const key = decodeURIComponent(sceneMatch[1]!)
            const scenes = listScenes()
            const file =
              scenes.find((s: SceneFile) => s.name === key || s.id === key) ??
              (existsSync(join(SCENES_DIR, `${key}.scene.json`))
                ? readSceneFile(join(SCENES_DIR, `${key}.scene.json`))
                : null)

            if (req.method === 'GET') {
              if (!file) return sendJson(res, 404, { error: 'scene not found' })
              return sendJson(res, 200, {
                scene: file.scene,
                revision: file.revision,
                relativePath: file.relativePath,
                diagnostics: file.diagnostics,
              })
            }

            if (req.method === 'PUT') {
              const body = JSON.parse(await readBody(req)) as {
                scene: Scene
                expectedRevision?: string
              }
              const diagnostics = validateSceneObject(body.scene)
              if (diagnostics.some((d) => d.severity === 'error')) {
                return sendJson(res, 400, {
                  error: 'validation failed',
                  diagnostics,
                })
              }
              if (
                file &&
                body.expectedRevision &&
                body.expectedRevision !== file.revision
              ) {
                return sendJson(res, 409, {
                  error: 'revision conflict',
                  currentRevision: file.revision,
                  scene: file.scene,
                })
              }
              const { path, revision } = writeSceneJson(
                body.scene,
                file?.path ?? join(SCENES_DIR, `${body.scene.name}.scene.json`),
              )
              const gen = generateSceneLua(body.scene)
              notify('playdate:generated', {
                scene: body.scene.name,
                revision,
              })
              return sendJson(res, 200, {
                ok: true,
                revision,
                path: relative(ROOT, path).replace(/\\/g, '/'),
                luaPath: relative(ROOT, gen.path).replace(/\\/g, '/'),
              })
            }
          }

          if (url === '/__playdate/api/layouts' && req.method === 'GET') {
            const dir = join(EDITOR_DIR, 'layouts')
            mkdirSync(dir, { recursive: true })
            const presets = readdirSync(dir)
              .filter((f) => f.endsWith('.json'))
              .map((f) => f.replace(/\.json$/, ''))
            return sendJson(res, 200, { presets })
          }

          if (url.startsWith('/__playdate/api/layouts/') && req.method === 'PUT') {
            const name = decodeURIComponent(
              url.slice('/__playdate/api/layouts/'.length),
            )
            const safe = name.replace(/[^a-zA-Z0-9_-]/g, '')
            const body = JSON.parse(await readBody(req))
            const path = join(EDITOR_DIR, 'layouts', `${safe}.json`)
            atomicWrite(path, `${JSON.stringify(body, null, 2)}\n`)
            return sendJson(res, 200, { ok: true, name: safe })
          }

          if (url.startsWith('/__playdate/api/layouts/') && req.method === 'GET') {
            const name = decodeURIComponent(
              url.slice('/__playdate/api/layouts/'.length),
            )
            const path = join(
              EDITOR_DIR,
              'layouts',
              `${name.replace(/[^a-zA-Z0-9_-]/g, '')}.json`,
            )
            if (!existsSync(path)) return sendJson(res, 404, { error: 'not found' })
            return sendJson(res, 200, JSON.parse(readFileSync(path, 'utf8')))
          }

          if (url === '/__playdate/api/run-simulator' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req)) as {
              scene?: Scene
              sceneName?: string
            }
            let scene = body.scene
            if (!scene && body.sceneName) {
              const file =
                listScenes().find(
                  (s: SceneFile) =>
                    s.name === body.sceneName || s.id === body.sceneName,
                ) ?? null
              if (!file) {
                return sendJson(res, 404, { error: 'scene not found' })
              }
              scene = file.scene
            }
            if (!scene) {
              return sendJson(res, 400, { error: 'scene or sceneName required' })
            }
            const diagnostics = validateSceneObject(scene)
            if (diagnostics.some((d) => d.severity === 'error')) {
              return sendJson(res, 400, {
                error: 'validation failed',
                diagnostics,
              })
            }
            const result = buildAndRunSimulator(scene)
            if (!result.ok) {
              return sendJson(res, 500, result)
            }
            notify('playdate:generated', {
              scene: scene.name,
              simulator: true,
            })
            return sendJson(res, 200, result)
          }

          if (url === '/__playdate/api/assistant/status' && req.method === 'GET') {
            const status = resolveAssistantProvider()
            return sendJson(res, 200, {
              configured: Boolean(status.provider),
              provider: status.provider,
              available: status.available,
              displayName: status.displayName,
              docsPath: 'docs/NIBBLE.md',
            })
          }

          if (url === '/__playdate/api/assistant/run' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req)) as {
              message?: string
              mode?: AssistantMode
              sceneName?: string
              scenePath?: string
              activeState?: string
              selectedIds?: string[]
              selectedSummary?: string
              previewPngBase64?: string
            }
            const message = body.message?.trim()
            if (!message) {
              return sendJson(res, 400, { error: 'message required' })
            }
            const mode: AssistantMode =
              body.mode === 'edit' ? 'edit' : 'ask'
            const status = resolveAssistantProvider()
            if (!status.provider) {
              return sendJson(res, 400, {
                error: 'assistant not configured',
                code: 'unconfigured',
              })
            }
            if (!status.available) {
              return sendJson(res, 400, {
                error: `${status.displayName} CLI not found in PATH`,
                code: 'missing_binary',
                provider: status.provider,
              })
            }

            const sceneName = body.sceneName?.trim()
            if (!sceneName) {
              return sendJson(res, 400, { error: 'sceneName required' })
            }
            const sceneFile =
              listScenes().find(
                (s: SceneFile) =>
                  s.name === sceneName || s.id === sceneName,
              ) ?? null
            if (!sceneFile) {
              return sendJson(res, 404, { error: 'scene not found' })
            }

            const pack = prepareNibbleRunPack({
              mode,
              message,
              sceneFile,
              schemaPath: SCHEMA_PATH,
              activeState: body.activeState?.trim() || 'default',
              selectedIds: Array.isArray(body.selectedIds)
                ? body.selectedIds.filter((id) => typeof id === 'string')
                : [],
              selectedSummary:
                typeof body.selectedSummary === 'string'
                  ? body.selectedSummary
                  : undefined,
              previewPngBase64:
                typeof body.previewPngBase64 === 'string'
                  ? body.previewPngBase64
                  : undefined,
              effort: status.effort,
              provider: status.provider,
            })

            if (activeAssistantKill) {
              activeAssistantKill()
              activeAssistantKill = null
            }

            res.statusCode = 200
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
            res.setHeader('Cache-Control', 'no-cache, no-transform')
            res.setHeader('Connection', 'keep-alive')
            res.flushHeaders?.()

            const writeEvent = (event: string, data: unknown) => {
              if (res.writableEnded) return
              res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            }

            writeEvent('start', {
              provider: status.provider,
              mode,
              scene: sceneFile.name,
              hasPreview: pack.hasPreview,
              effort: status.effort,
            })

            const run = startAssistantRun(
              {
                provider: status.provider,
                mode,
                prompt: pack.prompt,
                cwd: ROOT,
                effort: status.effort,
                model: status.model,
              },
              (chunk) => {
                if (chunk.type === 'stdout') {
                  writeEvent('stdout', { text: chunk.text })
                } else if (chunk.type === 'stderr') {
                  writeEvent('stderr', { text: chunk.text })
                } else if (chunk.type === 'step') {
                  writeEvent('step', {
                    label: chunk.label,
                    tool: chunk.tool,
                  })
                } else if (chunk.type === 'error') {
                  writeEvent('error', { message: chunk.message })
                } else if (chunk.type === 'done') {
                  writeEvent('done', {
                    code: chunk.code,
                    signal: chunk.signal,
                  })
                  activeAssistantKill = null
                  if (!res.writableEnded) res.end()
                }
              },
            )
            activeAssistantKill = run.kill

            req.on('close', () => {
              if (activeAssistantKill === run.kill) {
                run.kill()
                activeAssistantKill = null
              }
            })
            return
          }

          if (
            url === '/__playdate/api/assistant/cancel' &&
            req.method === 'POST'
          ) {
            if (activeAssistantKill) {
              activeAssistantKill()
              activeAssistantKill = null
            }
            return sendJson(res, 200, { ok: true })
          }

          return sendJson(res, 404, { error: 'unknown api route' })
        } catch (e) {
          return sendJson(res, 500, {
            error: e instanceof Error ? e.message : 'internal error',
          })
        }
      })
    },
    buildStart() {
      ensureEditorDirs()
      for (const s of listScenes()) {
        if (!s.diagnostics.some((d) => d.severity === 'error')) {
          generateSceneLua(s.scene)
        }
      }
    },
    closeBundle() {
      for (const w of watchers) w.close()
      watchers = []
    },
  }
}
