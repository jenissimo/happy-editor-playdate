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

function isResponseWritable(res: ServerResponse): boolean {
  return !res.destroyed && !res.writableEnded && res.writable
}

export function createSseEventWriter(res: ServerResponse) {
  let writable = true
  return (event: string, data: unknown): boolean => {
    if (!writable || !isResponseWritable(res)) {
      writable = false
      return false
    }
    try {
      const accepted = res.write(
        `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
      )
      // Backpressure means future chunks would accumulate in ServerResponse's
      // buffer. Latch permanently and let the matching run terminate instead.
      if (!accepted) writable = false
      return accepted
    } catch {
      writable = false
      return false
    }
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  if (!isResponseWritable(res)) return
  try {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  } catch {
    // A client can close between the writable check and an HTTP write.
  }
}

function sendBytes(res: ServerResponse, contentType: string, body: Buffer) {
  if (!isResponseWritable(res)) return
  try {
    res.statusCode = 200
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'no-cache')
    res.end(body)
  } catch {
    // A client can close between the writable check and an HTTP write.
  }
}

const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024

class RequestBodyTooLargeError extends Error {
  constructor() {
    super(`Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`)
  }
}

class RequestAbortedError extends Error {
  constructor() {
    super('Request aborted by client')
  }
}

function readBody(
  req: IncomingMessage,
  limit = MAX_REQUEST_BODY_BYTES,
): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    req.on('error', (error) => {
      rejectOnce(error)
    })
    req.on('aborted', () => {
      rejectOnce(new RequestAbortedError())
    })
    const contentLength = Number(req.headers['content-length'])
    if (Number.isFinite(contentLength) && contentLength > limit) {
      req.resume()
      rejectOnce(new RequestBodyTooLargeError())
      return
    }
    req.on('data', (chunk: Buffer | string) => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > limit) {
        chunks.length = 0
        req.resume()
        rejectOnce(new RequestBodyTooLargeError())
        return
      }
      chunks.push(buffer)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolveBody(Buffer.concat(chunks).toString('utf8'))
    })
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

function stopActiveAssistant(expected?: () => void) {
  if (expected && activeAssistantKill !== expected) return
  if (!activeAssistantKill) return
  try {
    activeAssistantKill()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[happy-editor] Failed to stop assistant CLI: ${message}`)
  }
}

export function playdateProjectBridge(): Plugin {
  let watchers: FSWatcher[] = []
  let serverRef: ViteDevServer | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null
  let watcherRetry: ReturnType<typeof setTimeout> | null = null

  const closeWatchers = () => {
    const activeWatchers = watchers
    // Clear the collection first so errors from a watcher being closed cannot
    // schedule a restart after it is no longer part of the active set.
    watchers = []
    for (const watcher of activeWatchers) {
      try {
        watcher.close()
      } catch {
        // A failed close must not prevent the remaining watchers from closing.
      }
    }
  }

  const stopWatching = () => {
    if (watcherRetry) {
      clearTimeout(watcherRetry)
      watcherRetry = null
    }
    if (debounce) {
      clearTimeout(debounce)
      debounce = null
    }
    closeWatchers()
  }

  const notify = (event: string, data: unknown) => {
    if (!serverRef) return
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      const server = serverRef
      if (!server) return
      try {
        broadcast(server, event, data)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        server.config.logger.warn(
          `[playdate-project-bridge] Could not broadcast ${event}: ${message}`,
        )
      }
    }, 40)
  }

  const logWatcherFailure = (error: unknown, context: string) => {
    const message = error instanceof Error ? error.message : String(error)
    serverRef?.config.logger.warn(
      `[playdate-project-bridge] ${context}; retrying: ${message}`,
    )
  }

  const scheduleWatcherRetry = () => {
    if (!serverRef || watcherRetry) return
    watcherRetry = setTimeout(() => {
      watcherRetry = null
      if (!serverRef || watchers.length > 0) return
      try {
        attachWatchers()
      } catch (error) {
        // Retries run outside Vite's request lifecycle and must not turn an
        // intermittent filesystem failure into an uncaught timer exception.
        logWatcherFailure(error, 'Could not restore file watchers')
        scheduleWatcherRetry()
      }
    }, 1_000)
  }

  const attachWatchers = () => {
    if (!serverRef || watchers.length > 0) return
    closeWatchers()
    try {
      ensureEditorDirs()
    } catch (error) {
      logWatcherFailure(error, 'Could not prepare editor directories')
      scheduleWatcherRetry()
      return
    }
    const dirs = [SCENES_DIR, SOURCE_DIR, EDITOR_DIR, join(PACKAGE_ROOT, 'schema')]
    for (const dir of dirs) {
      try {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
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
        w.on('error', (error) => {
          if (!watchers.includes(w)) return

          // An unobserved FSWatcher error is fatal in Node. Recreate the whole
          // set after a short delay because a transient directory replacement can
          // invalidate more than one recursive watcher on Windows.
          logWatcherFailure(error, 'File watcher failed')
          closeWatchers()
          scheduleWatcherRetry()
        })
        watchers.push(w)
      } catch (error) {
        logWatcherFailure(error, `Could not watch ${dir}`)
        closeWatchers()
        scheduleWatcherRetry()
        return
      }
    }
  }

  return {
    name: 'playdate-project-bridge',
    configureServer(server) {
      serverRef = server
      attachWatchers()
      server.httpServer?.once('close', () => {
        stopWatching()
        stopActiveAssistant()
        serverRef = null
      })

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/__playdate/')) return next()

        res.on('error', (error) => {
          const message = error instanceof Error ? error.message : String(error)
          server.config.logger.warn(
            `[playdate-project-bridge] HTTP response failed: ${message}`,
          )
        })

        try {
          if (url.startsWith('/__playdate/assets/')) {
            const rel = decodeURIComponent(
              url.slice('/__playdate/assets/'.length).split('?')[0]!,
            )
            const buf = readAssetBytes(rel)
            if (!buf) return sendJson(res, 404, { error: 'not found' })
            const ext = rel.split('.').pop()?.toLowerCase() ?? ''
            sendBytes(res, MIME[ext] ?? 'application/octet-stream', buf)
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
              stopActiveAssistant()
            }

            let runKill: (() => void) | null = null
            let assistantFinished = false
            let terminationRequested = false
            const clearActiveRun = () => {
              if (runKill && activeAssistantKill === runKill) {
                activeAssistantKill = null
              }
            }
            const stopRunForClient = () => {
              if (!runKill || terminationRequested) return
              terminationRequested = true
              stopActiveAssistant(runKill)
            }

            if (!isResponseWritable(res)) return
            try {
              res.statusCode = 200
              res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
              res.setHeader('Cache-Control', 'no-cache, no-transform')
              res.setHeader('Connection', 'keep-alive')
              res.flushHeaders?.()
            } catch {
              return
            }
            res.once('close', stopRunForClient)
            res.once('error', stopRunForClient)

            const writeEvent = createSseEventWriter(res)

            const endSse = () => {
              if (!isResponseWritable(res)) return
              try {
                res.end()
              } catch {
                // The SSE client may disconnect between the writable check and end.
              }
            }

            if (
              !writeEvent('start', {
                provider: status.provider,
                mode,
                scene: sceneFile.name,
                hasPreview: pack.hasPreview,
                effort: status.effort,
              })
            ) {
              endSse()
              return
            }

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
                const writeAssistantEvent = (event: string, data: unknown) => {
                  if (!writeEvent(event, data)) stopRunForClient()
                }
                if (chunk.type === 'stdout') {
                  writeAssistantEvent('stdout', { text: chunk.text })
                } else if (chunk.type === 'stderr') {
                  writeAssistantEvent('stderr', { text: chunk.text })
                } else if (chunk.type === 'step') {
                  writeAssistantEvent('step', {
                    label: chunk.label,
                    tool: chunk.tool,
                  })
                } else if (chunk.type === 'error') {
                  writeAssistantEvent('error', { message: chunk.message })
                } else if (chunk.type === 'done') {
                  writeAssistantEvent('done', {
                    code: chunk.code,
                    signal: chunk.signal,
                  })
                  assistantFinished = true
                  clearActiveRun()
                  endSse()
                }
              },
            )
            runKill = run.kill
            if (!assistantFinished) activeAssistantKill = runKill
            return
          }

          if (
            url === '/__playdate/api/assistant/cancel' &&
            req.method === 'POST'
          ) {
            if (activeAssistantKill) {
              stopActiveAssistant()
            }
            return sendJson(res, 200, { ok: true })
          }

          return sendJson(res, 404, { error: 'unknown api route' })
        } catch (e) {
          if (e instanceof RequestBodyTooLargeError) {
            return sendJson(res, 413, { error: 'request body too large' })
          }
          if (e instanceof RequestAbortedError) {
            return sendJson(res, 400, { error: 'request aborted' })
          }
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
      stopWatching()
      stopActiveAssistant()
      serverRef = null
    },
  }
}
