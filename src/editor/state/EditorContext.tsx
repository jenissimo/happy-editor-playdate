import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { IndexedAsset } from '../../core/assets/types'
import {
  createEmptyScene,
  createFrameNode,
  createGroupNode,
  createImageNode,
  createPanelNode,
  createShapeNode,
  createTextNode,
  type Scene,
  type SceneNode,
} from '../../core/scene/types'
import {
  findNode,
  flattenNodes,
  moveNode,
  regenerateIds,
  type DropPlace,
} from './nodeTree'
import {
  addSceneState as addSceneStatePure,
  cycleSceneState,
  removeSceneState as removeSceneStatePure,
  renameSceneState as renameSceneStatePure,
  resolveActiveState,
  setDefaultState as setDefaultStatePure,
  setNodesStates,
} from './sceneStates'
import { exportSceneJson, exportSceneLua } from '../../core/scene/export'
import { AssetRegistry } from '../assets/AssetRegistry'
import { CommandRegistry, findCommandByShortcut } from '../commands/registry'
import { DEFAULT_SNAP, type SnapSettings } from '../geometry'
import { clampZoom } from '../zoom'
import {
  projectClient,
  type Diagnostic,
  type SceneListItem,
  type WorkspaceFile,
} from '../project/ProjectClient'
import { HistoryStack } from './history'

export type Tool = 'select' | 'hand'

export type ConflictState = {
  revision: string
  scene: Scene
  relativePath?: string
} | null

export type ConsoleEntry = {
  id: string
  severity: 'error' | 'warning' | 'info'
  message: string
  path?: string
  at: number
}

function updateNode(
  nodes: SceneNode[],
  id: string,
  patch: Partial<SceneNode>,
): SceneNode[] {
  return nodes.map((n) => {
    if (n.id === id) return { ...n, ...patch } as SceneNode
    if (n.type === 'group') {
      return { ...n, children: updateNode(n.children, id, patch) }
    }
    return n
  })
}

function removeNodes(nodes: SceneNode[], ids: Set<string>): SceneNode[] {
  return nodes
    .filter((n) => !ids.has(n.id))
    .map((n) =>
      n.type === 'group'
        ? { ...n, children: removeNodes(n.children, ids) }
        : n,
    )
}

type EditorContextValue = {
  ready: boolean
  scene: Scene
  revision: string | null
  dirty: boolean
  conflict: ConflictState
  selectedIds: string[]
  selected: SceneNode | null
  selectedNodes: SceneNode[]
  assets: IndexedAsset[]
  registry: AssetRegistry
  diagnostics: Diagnostic[]
  console: ConsoleEntry[]
  snap: SnapSettings
  showGrid: boolean
  zoom: number
  pan: { x: number; y: number }
  tool: Tool
  activeState: string
  status: string
  history: HistoryStack
  commands: CommandRegistry
  exportText: string
  exportFormat: 'json' | 'lua'
  setExportFormat: (f: 'json' | 'lua') => void
  setSelectedIds: (ids: string[]) => void
  selectOne: (id: string | null, additive?: boolean) => void
  setSnap: (s: SnapSettings | ((prev: SnapSettings) => SnapSettings)) => void
  setShowGrid: (v: boolean | ((p: boolean) => boolean)) => void
  setZoom: (z: number | ((p: number) => number)) => void
  setPan: (p: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => void
  setTool: (t: Tool) => void
  setActiveState: (s: string) => void
  addSceneState: (name?: string) => string
  renameSceneState: (from: string, to: string) => void
  removeSceneState: (name: string) => void
  setDefaultState: (name: string) => void
  setNodeStates: (ids: string[], states: string[]) => void
  mutate: (label: string, mutator: (scene: Scene) => Scene) => void
  patchNode: (id: string, patch: Partial<SceneNode>, label?: string) => void
  patchNodesLive: (patches: Record<string, Partial<SceneNode>>) => void
  commitLiveGesture: (label: string, before: Scene) => void
  addNode: (type: SceneNode['type'], at?: { x: number; y: number }) => void
  addFromAsset: (asset: IndexedAsset, at?: { x: number; y: number }) => void
  deleteSelected: () => void
  duplicateSelected: () => void
  reorder: (fromId: string, toId: string, place: DropPlace) => void
  groupSelected: () => void
  save: () => Promise<void>
  openScene: (name: string) => Promise<void>
  newScene: () => Promise<void>
  reloadFromDisk: () => Promise<void>
  keepMine: () => void
  undo: () => void
  redo: () => void
  pushConsole: (entry: Omit<ConsoleEntry, 'id' | 'at'>) => void
  workspace: WorkspaceFile | null
  scenes: SceneListItem[]
  saveWorkspace: (patch: Partial<WorkspaceFile>) => Promise<void>
  getSceneSnapshot: () => Scene
  /** Mark upcoming disk scene updates as undoable Nibble edits. */
  beginNibbleSession: (label: string) => void
  endNibbleSession: () => void
  /**
   * Pull latest scene from disk (if changed) as one undoable Nibble edit,
   * then clear the session. Call when an Edit run finishes.
   */
  finishNibbleSession: () => Promise<boolean>
  /** True while a Nibble edit session is waiting for disk updates. */
  nibbleSessionActive: boolean
}

const EditorContext = createContext<EditorContextValue | null>(null)

/** Shared dirty-guard for open / new scene. Returns false if the user cancels. */
function confirmDiscardIfDirty(
  dirty: boolean,
  currentName: string,
  nextActionLabel: string,
): boolean {
  if (!dirty) return true
  return window.confirm(
    `Scene "${currentName}" has unsaved changes. Discard and ${nextActionLabel}?`,
  )
}

function sanitizeSceneName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
}

function suggestUntitledName(existing: Set<string>): string {
  if (!existing.has('untitled')) return 'untitled'
  let n = 2
  while (existing.has(`untitled-${n}`)) n += 1
  return `untitled-${n}`
}

export function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error('useEditorContext outside provider')
  return ctx
}

export function EditorProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [scene, setScene] = useState<Scene>(() => createEmptyScene('menu'))
  const [revision, setRevision] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [conflict, setConflict] = useState<ConflictState>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [assets, setAssets] = useState<IndexedAsset[]>([])
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [snap, setSnap] = useState<SnapSettings>(DEFAULT_SNAP)
  const [showGrid, setShowGrid] = useState(true)
  const [zoom, setZoom] = useState(2)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [tool, setTool] = useState<Tool>('select')
  const [activeState, setActiveState] = useState('default')
  const [status, setStatus] = useState('Loading…')
  const [exportFormat, setExportFormat] = useState<'json' | 'lua'>('lua')
  const [workspace, setWorkspace] = useState<WorkspaceFile | null>(null)
  const [scenes, setScenes] = useState<SceneListItem[]>([])

  const historyRef = useRef(new HistoryStack())
  const commandsRef = useRef(new CommandRegistry())
  const sceneRef = useRef(scene)
  const revisionRef = useRef(revision)
  const dirtyRef = useRef(dirty)
  const scenesRef = useRef(scenes)
  const savingRef = useRef(false)
  const gestureBeforeRef = useRef<Scene | null>(null)
  const nibbleSessionRef = useRef<{ label: string } | null>(null)
  const [nibbleSessionActive, setNibbleSessionActive] = useState(false)

  sceneRef.current = scene
  revisionRef.current = revision
  dirtyRef.current = dirty
  scenesRef.current = scenes

  const registry = useMemo(() => new AssetRegistry(assets), [assets])

  const pushConsole = useCallback(
    (entry: Omit<ConsoleEntry, 'id' | 'at'>) => {
      setConsoleEntries((prev) => [
        {
          ...entry,
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          at: Date.now(),
        },
        ...prev,
      ].slice(0, 200))
    },
    [],
  )

  const selectedNodes = useMemo(
    () =>
      selectedIds
        .map((id) => findNode(scene.nodes, id))
        .filter((n): n is SceneNode => n != null),
    [scene.nodes, selectedIds],
  )
  const selected = selectedNodes[0] ?? null

  const markDirty = useCallback(() => setDirty(true), [])

  const mutate = useCallback(
    (label: string, mutator: (scene: Scene) => Scene) => {
      historyRef.current.apply(
        () => sceneRef.current,
        (s) => {
          setScene(s)
          sceneRef.current = s
          setDirty(true)
        },
        mutator,
        label,
      )
    },
    [],
  )

  const patchNode = useCallback(
    (id: string, patch: Partial<SceneNode>, label = 'Edit node') => {
      mutate(label, (s) => ({
        ...s,
        nodes: updateNode(s.nodes, id, patch),
      }))
    },
    [mutate],
  )

  const addSceneState = useCallback(
    (name?: string) => {
      let created = ''
      mutate('Add state', (s) => {
        const next = addSceneStatePure(s, name)
        created = next.states[next.states.length - 1]!
        return next
      })
      if (created) setActiveState(created)
      return created
    },
    [mutate],
  )

  const renameSceneState = useCallback(
    (from: string, to: string) => {
      let renamedTo = from
      mutate('Rename state', (s) => {
        const next = renameSceneStatePure(s, from, to)
        const idx = s.states.indexOf(from)
        if (idx >= 0) renamedTo = next.states[idx]!
        return next
      })
      setActiveState((cur) => (cur === from ? renamedTo : cur))
    },
    [mutate],
  )

  const removeSceneState = useCallback(
    (name: string) => {
      const before = sceneRef.current
      if (before.states.length <= 1) return
      mutate('Delete state', (s) => removeSceneStatePure(s, name))
      setActiveState((cur) => {
        if (cur !== name) return cur
        return resolveActiveState(sceneRef.current, null)
      })
    },
    [mutate],
  )

  const setDefaultState = useCallback(
    (name: string) => {
      mutate('Set default state', (s) => setDefaultStatePure(s, name))
    },
    [mutate],
  )

  const setNodeStates = useCallback(
    (ids: string[], states: string[]) => {
      if (ids.length === 0) return
      mutate('Set node states', (s) => setNodesStates(s, ids, states))
    },
    [mutate],
  )

  const patchNodesLive = useCallback(
    (patches: Record<string, Partial<SceneNode>>) => {
      if (!gestureBeforeRef.current) {
        gestureBeforeRef.current = structuredClone(sceneRef.current)
      }
      setScene((s) => {
        let nodes = s.nodes
        for (const [id, patch] of Object.entries(patches)) {
          nodes = updateNode(nodes, id, patch)
        }
        const next = { ...s, nodes }
        sceneRef.current = next
        return next
      })
      setDirty(true)
    },
    [],
  )

  const commitLiveGesture = useCallback((label: string, before: Scene) => {
    const after = structuredClone(sceneRef.current)
    historyRef.current.push({
      label,
      undo: () => {
        setScene(structuredClone(before))
        sceneRef.current = structuredClone(before)
        setDirty(true)
      },
      redo: () => {
        setScene(structuredClone(after))
        sceneRef.current = structuredClone(after)
        setDirty(true)
      },
    })
    gestureBeforeRef.current = null
  }, [])

  const getSceneSnapshot = useCallback(() => structuredClone(sceneRef.current), [])

  const addNode = useCallback(
    (type: SceneNode['type'], at?: { x: number; y: number }) => {
      let node: SceneNode
      const pos = at ?? { x: 40, y: 40 }
      switch (type) {
        case 'text':
          node = createTextNode({ x: pos.x, y: pos.y })
          break
        case 'panel':
          node = createPanelNode({
            x: pos.x,
            y: pos.y,
            asset: 'images/panel',
            slice: { left: 8, right: 8, top: 8, bottom: 8 },
          })
          break
        case 'frame':
          node = createFrameNode({ x: pos.x, y: pos.y })
          break
        case 'shape':
          node = createShapeNode({ x: pos.x, y: pos.y })
          break
        case 'image':
          node = createImageNode({ x: pos.x, y: pos.y, asset: 'images/icon' })
          break
        case 'group':
          node = createGroupNode({ x: pos.x, y: pos.y, w: 1, h: 1 })
          break
        default:
          return
      }
      mutate(`Add ${type}`, (s) => ({ ...s, nodes: [...s.nodes, node] }))
      setSelectedIds([node.id])
    },
    [mutate],
  )

  const addFromAsset = useCallback(
    (asset: IndexedAsset, at?: { x: number; y: number }) => {
      const pos = at ?? { x: 40, y: 40 }
      let node: SceneNode
      if (asset.kind === 'slice' && asset.slice) {
        node = createPanelNode({
          name: asset.basePath.split('/').pop() ?? 'Panel',
          asset: asset.basePath,
          slice: asset.slice,
          x: pos.x,
          y: pos.y,
        })
      } else if (asset.kind === 'font') {
        node = createTextNode({
          font: asset.basePath,
          text: 'Text',
          x: pos.x,
          y: pos.y,
        })
      } else {
        // Prefer imagetable cell size; else intrinsic PNG size.
        const pw = asset.cell?.w ?? asset.pixelWidth ?? 32
        const ph = asset.cell?.h ?? asset.pixelHeight ?? 32
        node = createImageNode({
          name: asset.basePath.split('/').pop() ?? 'Image',
          asset: asset.basePath,
          w: pw,
          h: ph,
          x: pos.x,
          y: pos.y,
          ...(asset.kind === 'table'
            ? { fps: 10, loop: true, frameStart: 1 }
            : {}),
        })
      }
      mutate(`Add ${asset.kind}`, (s) => ({ ...s, nodes: [...s.nodes, node] }))
      setSelectedIds([node.id])
    },
    [mutate],
  )

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return
    const ids = new Set(selectedIds)
    mutate('Delete', (s) => ({ ...s, nodes: removeNodes(s.nodes, ids) }))
    setSelectedIds([])
  }, [mutate, selectedIds])

  const duplicateSelected = useCallback(() => {
    if (selectedIds.length === 0) return
    mutate('Duplicate', (s) => {
      const copies: SceneNode[] = []
      for (const id of selectedIds) {
        const n = findNode(s.nodes, id)
        if (!n) continue
        const copy = regenerateIds(structuredClone(n))
        copy.name = `${n.name} Copy`
        copy.x += 8
        copy.y += 8
        copies.push(copy)
      }
      return { ...s, nodes: [...s.nodes, ...copies] }
    })
  }, [mutate, selectedIds])

  const reorder = useCallback(
    (fromId: string, toId: string, place: DropPlace) => {
      mutate(place === 'into' ? 'Nest' : 'Reorder', (s) => ({
        ...s,
        nodes: moveNode(s.nodes, fromId, toId, place),
      }))
    },
    [mutate],
  )

  const groupSelected = useCallback(() => {
    if (selectedIds.length === 0) return
    const groupId = crypto.randomUUID()
    mutate('Group', (s) => {
      const ids = new Set(selectedIds)
      const picked: SceneNode[] = []
      for (const id of selectedIds) {
        const n = findNode(s.nodes, id)
        if (n) picked.push(structuredClone(n))
      }
      if (picked.length === 0) return s
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const n of picked) {
        minX = Math.min(minX, n.x)
        minY = Math.min(minY, n.y)
        maxX = Math.max(maxX, n.x + n.w)
        maxY = Math.max(maxY, n.y + n.h)
      }
      const group = createGroupNode({
        id: groupId,
        name: 'Group',
        x: Number.isFinite(minX) ? minX : 0,
        y: Number.isFinite(minY) ? minY : 0,
        w: Number.isFinite(maxX - minX) ? Math.max(1, maxX - minX) : 100,
        h: Number.isFinite(maxY - minY) ? Math.max(1, maxY - minY) : 100,
        children: picked,
      })
      const rest = removeNodes(s.nodes, ids)
      return { ...s, nodes: [...rest, group] }
    })
    setSelectedIds([groupId])
  }, [mutate, selectedIds])

  const selectOne = useCallback((id: string | null, additive = false) => {
    if (!id) {
      setSelectedIds([])
      return
    }
    setSelectedIds((prev) => {
      if (additive) {
        return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      }
      return [id]
    })
  }, [])

  const save = useCallback(async () => {
    if (savingRef.current) return
    savingRef.current = true
    setStatus('Saving…')
    try {
      const result = await projectClient.saveScene(
        sceneRef.current,
        revisionRef.current ?? undefined,
      )
      setRevision(result.revision)
      setDirty(false)
      setConflict(null)
      setStatus(`Saved · ${result.path}`)
      pushConsole({
        severity: 'info',
        message: `Saved ${result.path} → ${result.luaPath}`,
      })
    } catch (e) {
      const err = e as Error & { status?: number; body?: { currentRevision?: string; scene?: Scene } }
      if (err.status === 409 && err.body?.scene && err.body.currentRevision) {
        setConflict({
          revision: err.body.currentRevision,
          scene: err.body.scene,
        })
        setStatus('Conflict — external changes detected')
      } else {
        setStatus(err.message || 'Save failed')
        pushConsole({ severity: 'error', message: err.message || 'Save failed' })
      }
    } finally {
      savingRef.current = false
    }
  }, [pushConsole])

  const reloadFromDisk = useCallback(async () => {
    if (!conflict) {
      const name = sceneRef.current.name
      const res = await projectClient.fetchScene(name)
      setScene(res.scene)
      sceneRef.current = res.scene
      setRevision(res.revision)
      setDirty(false)
      setDiagnostics(res.diagnostics)
      setStatus('Reloaded from disk')
      return
    }
    setScene(conflict.scene)
    sceneRef.current = conflict.scene
    setRevision(conflict.revision)
    setDirty(false)
    setConflict(null)
    setStatus('Reloaded external version')
  }, [conflict])

  const keepMine = useCallback(() => {
    setConflict(null)
    setStatus('Keeping local edits — save to overwrite')
  }, [])

  const undo = useCallback(() => {
    if (historyRef.current.undo()) {
      markDirty()
      setStatus(`Undo: ${historyRef.current.redoLabel ?? ''}`)
    }
  }, [markDirty])

  const redo = useCallback(() => {
    if (historyRef.current.redo()) {
      markDirty()
      setStatus(`Redo: ${historyRef.current.undoLabel ?? ''}`)
    }
  }, [markDirty])

  const saveWorkspace = useCallback(
    async (patch: Partial<WorkspaceFile>) => {
      const prevMap =
        (workspace?.preferences?.activeStateByScene as
          | Record<string, string>
          | undefined) ?? {}
      const next: WorkspaceFile = {
        version: 1,
        layout: workspace?.layout ?? null,
        pan,
        activeScene: scene.name,
        ...patch,
        preferences: {
          ...(workspace?.preferences ?? {}),
          zoom,
          showGrid,
          snap,
          activeStateByScene: {
            ...prevMap,
            [scene.name]: activeState,
          },
          ...(patch.preferences ?? {}),
        },
      }
      // Re-merge activeStateByScene if patch overwrote the whole map
      if (
        patch.preferences &&
        typeof patch.preferences === 'object' &&
        patch.preferences.activeStateByScene &&
        typeof patch.preferences.activeStateByScene === 'object'
      ) {
        next.preferences = {
          ...next.preferences,
          activeStateByScene: {
            ...prevMap,
            [scene.name]: activeState,
            ...(patch.preferences.activeStateByScene as Record<string, string>),
          },
        }
      }
      setWorkspace(next)
      await projectClient.saveWorkspace(next)
    },
    [workspace, zoom, showGrid, snap, pan, scene.name, activeState],
  )

  const openScene = useCallback(
    async (name: string) => {
      if (
        !confirmDiscardIfDirty(
          dirtyRef.current,
          sceneRef.current.name,
          `open "${name}"`,
        )
      ) {
        return
      }
      try {
        const res = await projectClient.fetchScene(name)
        setScene(res.scene)
        sceneRef.current = res.scene
        setRevision(res.revision)
        setDirty(false)
        setConflict(null)
        setSelectedIds([])
        const prefs = workspace?.preferences ?? {}
        const byScene =
          (prefs.activeStateByScene as Record<string, string> | undefined) ?? {}
        setActiveState(
          resolveActiveState(res.scene, byScene[res.scene.name]),
        )
        setDiagnostics(res.diagnostics)
        historyRef.current.clear()
        setStatus(`Opened ${res.relativePath}`)
        void saveWorkspace({ activeScene: res.scene.name })
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to open scene'
        setStatus(msg)
        pushConsole({ severity: 'error', message: msg })
      }
    },
    [pushConsole, saveWorkspace, workspace?.preferences],
  )

  const newScene = useCallback(async () => {
    if (
      !confirmDiscardIfDirty(
        dirtyRef.current,
        sceneRef.current.name,
        'create a new scene',
      )
    ) {
      return
    }
    const existing = new Set(scenesRef.current.map((s) => s.name))
    const suggested = suggestUntitledName(existing)
    const raw = window.prompt('New scene name:', suggested)
    if (raw == null) return
    const name = sanitizeSceneName(raw)
    if (!name) {
      setStatus('Invalid scene name')
      pushConsole({
        severity: 'error',
        message: 'Scene name must contain letters, digits, _ or -',
      })
      return
    }
    if (existing.has(name)) {
      setStatus(`Scene "${name}" already exists`)
      pushConsole({
        severity: 'error',
        message: `Cannot create scene "${name}" — name already in use`,
      })
      return
    }

    const empty = createEmptyScene(name)
    setScene(empty)
    sceneRef.current = empty
    setRevision(null)
    setDirty(false)
    setConflict(null)
    setSelectedIds([])
    setActiveState(empty.defaultState)
    setDiagnostics([])
    historyRef.current.clear()

    savingRef.current = true
    setStatus('Creating scene…')
    try {
      const result = await projectClient.saveScene(empty)
      setRevision(result.revision)
      setDirty(false)
      const snap = await projectClient.fetchProject()
      setScenes(snap.scenes)
      setStatus(`Created ${result.path}`)
      pushConsole({
        severity: 'info',
        message: `Created ${result.path} → ${result.luaPath}`,
      })
      void saveWorkspace({ activeScene: name })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create scene'
      setStatus(msg)
      pushConsole({ severity: 'error', message: msg })
    } finally {
      savingRef.current = false
    }
  }, [pushConsole, saveWorkspace])

  // Bootstrap
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const snap = await projectClient.fetchProject()
        if (cancelled) return
        setAssets(snap.assets)
        setDiagnostics(snap.diagnostics)
        setWorkspace(snap.workspace)
        setScenes(snap.scenes)
        const prefs = snap.workspace.preferences ?? {}
        if (typeof prefs.zoom === 'number') setZoom(clampZoom(prefs.zoom))
        if (typeof prefs.showGrid === 'boolean') setShowGrid(prefs.showGrid)
        if (prefs.snap && typeof prefs.snap === 'object') {
          setSnap({ ...DEFAULT_SNAP, ...(prefs.snap as SnapSettings) })
        }
        if (snap.workspace.pan) setPan(snap.workspace.pan)

        const sceneName =
          snap.workspace.activeScene ??
          (snap.project.defaultScene as string) ??
          snap.scenes[0]?.name ??
          'menu'
        const sceneRes = await projectClient.fetchScene(sceneName)
        if (cancelled) return
        setScene(sceneRes.scene)
        sceneRef.current = sceneRes.scene
        setRevision(sceneRes.revision)
        const byScene =
          (snap.workspace.preferences?.activeStateByScene as
            | Record<string, string>
            | undefined) ?? {}
        setActiveState(
          resolveActiveState(sceneRes.scene, byScene[sceneRes.scene.name]),
        )
        setDiagnostics((d) => [...d, ...sceneRes.diagnostics])
        for (const diag of [...snap.diagnostics, ...sceneRes.diagnostics]) {
          pushConsole({
            severity: diag.severity,
            message: diag.message,
            path: diag.path,
          })
        }
        setStatus(`Loaded ${sceneRes.relativePath}`)
        setReady(true)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to load project'
        setStatus(msg)
        pushConsole({ severity: 'error', message: msg })
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pushConsole])

  const beginNibbleSession = useCallback((label: string) => {
    nibbleSessionRef.current = { label }
    setNibbleSessionActive(true)
  }, [])

  const endNibbleSession = useCallback(() => {
    nibbleSessionRef.current = null
    setNibbleSessionActive(false)
  }, [])

  const applyNibbleDiskIfChanged = useCallback(async (): Promise<boolean> => {
    const nibble = nibbleSessionRef.current
    if (!nibble) return false
    const name = sceneRef.current.name
    const res = await projectClient.fetchScene(name)
    if (res.revision === revisionRef.current) return false
    historyRef.current.apply(
      () => sceneRef.current,
      (s) => {
        setScene(s)
        sceneRef.current = s
      },
      () => structuredClone(res.scene),
      nibble.label,
    )
    setRevision(res.revision)
    setDirty(false)
    setConflict(null)
    setDiagnostics(res.diagnostics)
    setStatus(`Nibble updated · ${res.relativePath}`)
    pushConsole({
      severity: 'info',
      message: `${nibble.label} → ${res.relativePath}`,
    })
    return true
  }, [pushConsole])

  const finishNibbleSession = useCallback(async () => {
    try {
      return await applyNibbleDiskIfChanged()
    } catch {
      return false
    } finally {
      nibbleSessionRef.current = null
      setNibbleSessionActive(false)
    }
  }, [applyNibbleDiskIfChanged])

  // HMR subscriptions
  useEffect(() => {
    return projectClient.subscribeHot({
      onSceneChanged: async (data) => {
        const rawName = (data.name as string) || sceneRef.current.name
        // Watcher may pass a filename; API expects scene id/name without suffix.
        const name = rawName.replace(/\.scene\.json$/i, '').replace(/^.*\//, '')
        if (savingRef.current) return
        try {
          const res = await projectClient.fetchScene(name)
          if (res.revision === revisionRef.current) return

          const nibble = nibbleSessionRef.current
          if (nibble && name === sceneRef.current.name) {
            historyRef.current.apply(
              () => sceneRef.current,
              (s) => {
                setScene(s)
                sceneRef.current = s
              },
              () => structuredClone(res.scene),
              nibble.label,
            )
            setRevision(res.revision)
            setDirty(false)
            setConflict(null)
            setDiagnostics(res.diagnostics)
            setStatus(`Nibble updated · ${res.relativePath}`)
            pushConsole({
              severity: 'info',
              message: `${nibble.label} → ${res.relativePath}`,
            })
            return
          }

          if (dirtyRef.current) {
            setConflict({
              revision: res.revision,
              scene: res.scene,
              relativePath: res.relativePath,
            })
            setStatus('External edit — resolve conflict')
            return
          }
          const keep = new Set(selectedIds)
          setScene(res.scene)
          sceneRef.current = res.scene
          setRevision(res.revision)
          setSelectedIds(
            flattenNodes(res.scene.nodes)
              .map((n) => n.id)
              .filter((id) => keep.has(id)),
          )
          setDiagnostics(res.diagnostics)
          setStatus(`Updated from disk · ${res.relativePath}`)
        } catch {
          /* ignore transient */
        }
      },
      onAssetsChanged: async () => {
        try {
          const { assets: next } = await projectClient.fetchAssets()
          setAssets(next)
          setStatus('Assets refreshed')
        } catch {
          /* ignore */
        }
      },
      onGenerated: (data) => {
        pushConsole({
          severity: 'info',
          message: `Generated Lua for ${(data.scene as string) ?? 'scene'}`,
        })
      },
    })
  }, [pushConsole, selectedIds])

  // Register commands
  useEffect(() => {
    const reg = commandsRef.current
    const cmds = [
      {
        id: 'file.save',
        title: 'Save Scene',
        shortcut: 'Mod+S',
        enabled: () => dirtyRef.current,
        run: () => void save(),
      },
      {
        id: 'edit.undo',
        title: 'Undo',
        shortcut: 'Mod+Z',
        enabled: () => historyRef.current.canUndo,
        run: undo,
      },
      {
        id: 'edit.redo',
        title: 'Redo',
        shortcut: 'Mod+Shift+Z',
        enabled: () => historyRef.current.canRedo,
        run: redo,
      },
      {
        id: 'edit.delete',
        title: 'Delete',
        shortcut: 'Delete',
        enabled: () => selectedIds.length > 0,
        run: deleteSelected,
      },
      {
        id: 'edit.duplicate',
        title: 'Duplicate',
        shortcut: 'Mod+D',
        enabled: () => selectedIds.length > 0,
        run: duplicateSelected,
      },
      {
        id: 'view.toggleGrid',
        title: 'Toggle Grid',
        shortcut: 'Mod+G',
        enabled: () => true,
        run: () => setShowGrid((v) => !v),
      },
      {
        id: 'view.toggleSnap',
        title: 'Toggle Snap',
        shortcut: 'Shift+S',
        enabled: () => true,
        run: () => setSnap((s) => ({ ...s, enabled: !s.enabled })),
      },
      {
        id: 'create.text',
        title: 'Add Text',
        enabled: () => true,
        run: () => addNode('text'),
      },
      {
        id: 'create.panel',
        title: 'Add Panel',
        enabled: () => true,
        run: () => addNode('panel'),
      },
      {
        id: 'create.frame',
        title: 'Add Frame',
        enabled: () => true,
        run: () => addNode('frame'),
      },
      {
        id: 'create.shape',
        title: 'Add Shape',
        enabled: () => true,
        run: () => addNode('shape'),
      },
      {
        id: 'create.image',
        title: 'Add Image',
        enabled: () => true,
        run: () => addNode('image'),
      },
      {
        id: 'create.group',
        title: 'Add Group',
        enabled: () => true,
        run: () => addNode('group'),
      },
      {
        id: 'edit.group',
        title: 'Group Selection',
        shortcut: 'Ctrl+G',
        enabled: () => selectedIds.length > 0,
        run: groupSelected,
      },
      {
        id: 'tool.select',
        title: 'Select Tool',
        shortcut: 'V',
        enabled: () => true,
        run: () => setTool('select'),
      },
      {
        id: 'tool.hand',
        title: 'Hand Tool',
        shortcut: 'H',
        enabled: () => true,
        run: () => setTool('hand'),
      },
      {
        id: 'state.next',
        title: 'Next State',
        shortcut: 'Alt+]',
        enabled: () => sceneRef.current.states.length > 1,
        run: () => {
          const s = sceneRef.current
          setActiveState(cycleSceneState(s.states, activeState, 1))
        },
      },
      {
        id: 'state.prev',
        title: 'Previous State',
        shortcut: 'Alt+[',
        enabled: () => sceneRef.current.states.length > 1,
        run: () => {
          const s = sceneRef.current
          setActiveState(cycleSceneState(s.states, activeState, -1))
        },
      },
      {
        id: 'state.add',
        title: 'Add State',
        enabled: () => true,
        run: () => {
          addSceneState()
        },
      },
      {
        id: 'state.assignCurrent',
        title: 'Assign Selection to Current State',
        enabled: () => selectedIds.length > 0,
        run: () => setNodeStates(selectedIds, [activeState]),
      },
      {
        id: 'state.assignAll',
        title: 'Show Selection in All States',
        enabled: () => selectedIds.length > 0,
        run: () => setNodeStates(selectedIds, []),
      },
      {
        id: 'transform.rotateCCW',
        title: 'Rotate −15°',
        enabled: () => selectedIds.length > 0,
        run: () => {
          mutate('Rotate', (s) => {
            let nodes = s.nodes
            for (const id of selectedIds) {
              const n = findNode(nodes, id)
              if (!n || n.locked) continue
              nodes = updateNode(nodes, id, {
                rotation: (n.rotation ?? 0) - 15,
              })
            }
            return { ...s, nodes }
          })
        },
      },
      {
        id: 'transform.rotateCW',
        title: 'Rotate +15°',
        enabled: () => selectedIds.length > 0,
        run: () => {
          mutate('Rotate', (s) => {
            let nodes = s.nodes
            for (const id of selectedIds) {
              const n = findNode(nodes, id)
              if (!n || n.locked) continue
              nodes = updateNode(nodes, id, {
                rotation: (n.rotation ?? 0) + 15,
              })
            }
            return { ...s, nodes }
          })
        },
      },
    ]
    for (const c of cmds) reg.register(c)
  }, [
    save,
    undo,
    redo,
    deleteSelected,
    duplicateSelected,
    addNode,
    groupSelected,
    selectedIds,
    selectedIds.length,
    setTool,
    activeState,
    addSceneState,
    setNodeStates,
    mutate,
    setShowGrid,
    setSnap,
  ])

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.target as HTMLElement)?.isContentEditable) return

      const cmd = findCommandByShortcut(commandsRef.current, e)
      if (cmd) {
        e.preventDefault()
        cmd.run()
        return
      }

      if (e.key === ' ' && !e.repeat) {
        e.preventDefault()
        setTool('hand')
      }

      if (!selectedIds.length) return

      if ((e.key === '[' || e.key === ']') && !e.altKey) {
        e.preventDefault()
        const delta = (e.key === ']' ? 1 : -1) * (e.shiftKey ? 1 : 15)
        mutate('Rotate', (s) => {
          let nodes = s.nodes
          for (const id of selectedIds) {
            const n = findNode(nodes, id)
            if (!n || n.locked) continue
            nodes = updateNode(nodes, id, {
              rotation: (n.rotation ?? 0) + delta,
            })
          }
          return { ...s, nodes }
        })
        return
      }

      const step = e.shiftKey ? snap.grid || 8 : 1
      let dx = 0
      let dy = 0
      if (e.key === 'ArrowLeft') dx = -step
      if (e.key === 'ArrowRight') dx = step
      if (e.key === 'ArrowUp') dy = -step
      if (e.key === 'ArrowDown') dy = step
      if (dx || dy) {
        e.preventDefault()
        mutate('Nudge', (s) => {
          let nodes = s.nodes
          for (const id of selectedIds) {
            const n = findNode(nodes, id)
            if (!n || n.locked) continue
            nodes = updateNode(nodes, id, { x: n.x + dx, y: n.y + dy })
          }
          return { ...s, nodes }
        })
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setTool('select')
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [selectedIds, snap.grid, mutate])

  // Debounced autosave of prefs
  useEffect(() => {
    if (!ready || !workspace) return
    const t = setTimeout(() => {
      void saveWorkspace({})
    }, 800)
    return () => clearTimeout(t)
  }, [zoom, showGrid, snap, pan, activeState, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  const exportText = useMemo(() => {
    return exportFormat === 'json'
      ? exportSceneJson(scene)
      : exportSceneLua(scene)
  }, [scene, exportFormat])

  const value: EditorContextValue = {
    ready,
    scene,
    revision,
    dirty,
    conflict,
    selectedIds,
    selected,
    selectedNodes,
    assets,
    registry,
    diagnostics,
    console: consoleEntries,
    snap,
    showGrid,
    zoom,
    pan,
    tool,
    activeState,
    status,
    history: historyRef.current,
    commands: commandsRef.current,
    exportText,
    exportFormat,
    setExportFormat,
    setSelectedIds,
    selectOne,
    setSnap,
    setShowGrid,
    setZoom,
    setPan,
    setTool,
    setActiveState,
    addSceneState,
    renameSceneState,
    removeSceneState,
    setDefaultState,
    setNodeStates,
    mutate,
    patchNode,
    patchNodesLive,
    commitLiveGesture,
    addNode,
    addFromAsset,
    deleteSelected,
    duplicateSelected,
    reorder,
    groupSelected,
    save,
    openScene,
    newScene,
    reloadFromDisk,
    keepMine,
    undo,
    redo,
    pushConsole,
    workspace,
    scenes,
    saveWorkspace,
    getSceneSnapshot,
    beginNibbleSession,
    endNibbleSession,
    finishNibbleSession,
    nibbleSessionActive,
  }

  return (
    <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
  )
}
