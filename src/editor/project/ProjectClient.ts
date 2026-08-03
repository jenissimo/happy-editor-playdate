import type { IndexedAsset } from '../../core/assets/types'
import type { Scene } from '../../core/scene/types'

export type Diagnostic = {
  id: string
  severity: 'error' | 'warning' | 'info'
  path?: string
  message: string
}

export type WorkspaceFile = {
  version: number
  layout: unknown
  preferences: Record<string, unknown>
  pan?: { x: number; y: number }
  activeScene?: string
}

export type SceneListItem = {
  id: string
  name: string
  relativePath: string
  revision: string
  diagnostics: Diagnostic[]
}

export type ProjectSnapshot = {
  project: Record<string, unknown>
  workspace: WorkspaceFile
  scenes: SceneListItem[]
  assets: IndexedAsset[]
  diagnostics: Diagnostic[]
  root: string
  packageRoot?: string
  rootSource?: string
  paths?: {
    scenes: string
    source: string
    editor: string
  }
}

export type SceneResponse = {
  scene: Scene
  revision: string
  relativePath: string
  diagnostics: Diagnostic[]
}

export type SaveSceneResult = {
  ok: true
  revision: string
  path: string
  luaPath: string
}

export type SaveSceneConflict = {
  error: 'revision conflict'
  currentRevision: string
  scene: Scene
}

export type HotHandlers = {
  onSceneChanged?: (data: Record<string, unknown>) => void
  onAssetsChanged?: (data: Record<string, unknown>) => void
  onWorkspaceChanged?: (data: Record<string, unknown>) => void
  onGenerated?: (data: Record<string, unknown>) => void
}

export type AssistantStatus = {
  configured: boolean
  provider: 'cursor' | 'claude' | 'codex' | null
  available: boolean
  displayName: string | null
  docsPath: string
}

export type AssistantRunRequest = {
  message: string
  mode: 'ask' | 'edit'
  sceneName: string
  activeState?: string
  selectedIds?: string[]
  selectedSummary?: string
  /** Raw base64 PNG (no data: prefix) of the 400×240 scene preview. */
  previewPngBase64?: string
}

export type AssistantRunHandlers = {
  onStart?: (data: Record<string, unknown>) => void
  onStdout?: (text: string) => void
  onStderr?: (text: string) => void
  onStep?: (label: string, tool?: string) => void
  onError?: (message: string, code?: string) => void
  onDone?: (result: { code: number | null; signal: string | null }) => void
}

const API = '/__playdate/api'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const body = (await res.json()) as T & { error?: string }
  if (!res.ok) {
    const err = new Error(
      typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`,
    ) as Error & { status: number; body: unknown }
    err.status = res.status
    err.body = body
    throw err
  }
  return body
}

export class ProjectClient {
  fetchProject(): Promise<ProjectSnapshot> {
    return request<ProjectSnapshot>(`${API}/project`)
  }

  fetchScene(id: string): Promise<SceneResponse> {
    return request<SceneResponse>(`${API}/scenes/${encodeURIComponent(id)}`)
  }

  saveScene(
    scene: Scene,
    expectedRevision?: string,
  ): Promise<SaveSceneResult> {
    return request<SaveSceneResult>(
      `${API}/scenes/${encodeURIComponent(scene.name)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ scene, expectedRevision }),
      },
    )
  }

  fetchAssets(): Promise<{ assets: IndexedAsset[] }> {
    return request<{ assets: IndexedAsset[] }>(`${API}/assets`)
  }

  fetchWorkspace(): Promise<WorkspaceFile> {
    return request<WorkspaceFile>(`${API}/workspace`)
  }

  saveWorkspace(
    workspace: WorkspaceFile,
  ): Promise<{ ok: true; revision: string }> {
    return request<{ ok: true; revision: string }>(`${API}/workspace`, {
      method: 'PUT',
      body: JSON.stringify(workspace),
    })
  }

  fetchLayoutPreset(name: string): Promise<unknown> {
    return request<unknown>(`${API}/layouts/${encodeURIComponent(name)}`)
  }

  saveLayoutPreset(
    name: string,
    layout: unknown,
  ): Promise<{ ok: true; name: string }> {
    return request<{ ok: true; name: string }>(
      `${API}/layouts/${encodeURIComponent(name)}`,
      {
        method: 'PUT',
        body: JSON.stringify(layout),
      },
    )
  }

  listLayoutPresets(): Promise<{ presets: string[] }> {
    return request<{ presets: string[] }>(`${API}/layouts`)
  }

  runSimulator(input: {
    scene?: Scene
    sceneName?: string
  }): Promise<{ ok: true; pdx: string; scene: string; log: string }> {
    return request(`${API}/run-simulator`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  fetchAssistantStatus(): Promise<AssistantStatus> {
    return request<AssistantStatus>(`${API}/assistant/status`)
  }

  cancelAssistant(): Promise<{ ok: true }> {
    return request<{ ok: true }>(`${API}/assistant/cancel`, {
      method: 'POST',
      body: '{}',
    })
  }

  /**
   * Stream a Nibble assistant run via SSE. Returns an abort handle.
   */
  runAssistant(
    input: AssistantRunRequest,
    handlers: AssistantRunHandlers,
  ): { abort: () => void } {
    const controller = new AbortController()
    let terminalDelivered = false
    const finish = (result: { code: number | null; signal: string | null }) => {
      if (terminalDelivered) return
      terminalDelivered = true
      handlers.onDone?.(result)
    }
    void (async () => {
      try {
        const res = await fetch(`${API}/assistant/run`, {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
          signal: controller.signal,
        })
        if (!res.ok) {
          let message = `HTTP ${res.status}`
          let code: string | undefined
          try {
            const body = (await res.json()) as {
              error?: string
              code?: string
            }
            if (body.error) message = body.error
            code = body.code
          } catch {
            /* ignore */
          }
          handlers.onError?.(message, code)
          finish({ code: res.status, signal: null })
          return
        }
        if (!res.body) {
          handlers.onError?.('Empty response body')
          finish({ code: 1, signal: null })
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''
          for (const part of parts) {
            const lines = part.split('\n')
            let event = 'message'
            const dataLines: string[] = []
            for (const line of lines) {
              if (line.startsWith('event:')) event = line.slice(6).trim()
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
            }
            if (dataLines.length === 0) continue
            let data: unknown = dataLines.join('\n')
            try {
              data = JSON.parse(dataLines.join('\n'))
            } catch {
              /* keep string */
            }
            const payload = data as Record<string, unknown>
            if (event === 'stdout' && typeof payload.text === 'string') {
              handlers.onStdout?.(payload.text)
            } else if (event === 'stderr' && typeof payload.text === 'string') {
              handlers.onStderr?.(payload.text)
            } else if (event === 'step' && typeof payload.label === 'string') {
              handlers.onStep?.(
                payload.label,
                typeof payload.tool === 'string' ? payload.tool : undefined,
              )
            } else if (event === 'error' && typeof payload.message === 'string') {
              handlers.onError?.(payload.message)
            } else if (event === 'done') {
              finish({
                code: (payload.code as number | null) ?? null,
                signal: (payload.signal as string | null) ?? null,
              })
            } else if (event === 'start') {
              handlers.onStart?.(payload)
            }
          }
        }
        finish({ code: null, signal: 'eof' })
      } catch (e) {
        if (controller.signal.aborted) {
          finish({ code: null, signal: 'aborted' })
          return
        }
        handlers.onError?.(
          e instanceof Error ? e.message : 'Assistant request failed',
        )
        finish({ code: 1, signal: null })
      }
    })()

    return {
      abort: () => {
        controller.abort()
        void this.cancelAssistant().catch(() => {})
      },
    }
  }

  /** Subscribe to Vite HMR custom events from the project bridge. */
  subscribeHot(handlers: HotHandlers): () => void {
    const hot = import.meta.hot
    if (!hot) return () => {}

    const scene = (data: unknown) =>
      handlers.onSceneChanged?.(data as Record<string, unknown>)
    const assets = (data: unknown) =>
      handlers.onAssetsChanged?.(data as Record<string, unknown>)
    const workspace = (data: unknown) =>
      handlers.onWorkspaceChanged?.(data as Record<string, unknown>)
    const generated = (data: unknown) =>
      handlers.onGenerated?.(data as Record<string, unknown>)

    if (handlers.onSceneChanged) hot.on('playdate:scene-changed', scene)
    if (handlers.onAssetsChanged) hot.on('playdate:assets-changed', assets)
    if (handlers.onWorkspaceChanged)
      hot.on('playdate:workspace-changed', workspace)
    if (handlers.onGenerated) hot.on('playdate:generated', generated)

    return () => {
      if (handlers.onSceneChanged) hot.off('playdate:scene-changed', scene)
      if (handlers.onAssetsChanged) hot.off('playdate:assets-changed', assets)
      if (handlers.onWorkspaceChanged)
        hot.off('playdate:workspace-changed', workspace)
      if (handlers.onGenerated) hot.off('playdate:generated', generated)
    }
  }
}

export const projectClient = new ProjectClient()
