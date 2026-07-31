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
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  themeDark,
} from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import {
  ConsolePanel,
  ExportPanel,
  HierarchyPanel,
  InspectorPanel,
  ProjectPanel,
} from '../panels/sidePanels'
import { GamePanel, ScenePanel } from '../panels/ScenePanel'
import { useEditorContext } from '../state/EditorContext'
import { IconButton } from '../components/IconButton'
import { CommandPalette } from '../components/CommandPalette'
import { projectClient } from '../project/ProjectClient'
import { APP_TITLE } from '../../core/constants'
import { NibbleChat } from '../assistant/NibbleChat'
import { NibbleMascot } from '../assistant/NibbleMascot'
import type { NibbleStatus } from '../assistant/nibbleStatus'
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  FloppyDisk,
  GameController,
  Play,
} from '../icons'

const DEFAULT_LAYOUT_KEY = 'default'
const PREVIEW_W = 416
/** Floating height: titlebar (~22) + bezel/padding + 240 screen — no tab strip. */
const PREVIEW_H = 276

function HierarchyView(_props: IDockviewPanelProps) {
  return <HierarchyPanel />
}
function ProjectView(_props: IDockviewPanelProps) {
  return <ProjectPanel />
}
function SceneView(_props: IDockviewPanelProps) {
  return <ScenePanel />
}
function GameView(_props: IDockviewPanelProps) {
  return <GamePanel />
}
function InspectorView(_props: IDockviewPanelProps) {
  return <InspectorPanel />
}
function ExportView(_props: IDockviewPanelProps) {
  return <ExportPanel />
}
function ConsoleView(_props: IDockviewPanelProps) {
  return <ConsolePanel />
}

const components = {
  hierarchy: HierarchyView,
  project: ProjectView,
  scene: SceneView,
  game: GameView,
  inspector: InspectorView,
  export: ExportView,
  console: ConsoleView,
}

function addGamePreview(api: DockviewApi) {
  if (api.getPanel('game')) return
  api.addPanel({
    id: 'game',
    component: 'game',
    title: 'Preview',
    floating: {
      width: PREVIEW_W,
      height: PREVIEW_H,
      position: { bottom: 20, right: 20 },
      dragHandle: 'titlebar',
    },
  })
  lockPreviewGroup(api)
}

/** Preview stays floating — never dock into the main grid. Hide tab/X chrome. */
function lockPreviewGroup(api: DockviewApi) {
  const game = api.getPanel('game')
  if (!game) return
  game.group.locked = 'no-drop-target'
  game.group.header.hidden = true
}

function ensureGamePreview(api: DockviewApi) {
  const game = api.getPanel('game')
  if (!game) {
    addGamePreview(api)
    return
  }
  const loc = game.group.api.location
  if (loc.type !== 'floating') {
    api.addFloatingGroup(game, {
      width: PREVIEW_W,
      height: PREVIEW_H,
      position: { bottom: 20, right: 20 },
      dragHandle: 'titlebar',
    })
  }
  game.api.setTitle('Preview')
  lockPreviewGroup(api)
}

function showUtilityPanel(
  api: DockviewApi,
  id: 'console' | 'export',
  title: string,
) {
  if (api.getPanel(id)) {
    api.getPanel(id)!.api.setActive()
    return
  }
  const inspector = api.getPanel('inspector')
  api.addPanel({
    id,
    component: id,
    title,
    position: inspector
      ? { referencePanel: inspector, direction: 'below' }
      : undefined,
  })
}

export function buildDefaultLayout(api: DockviewApi) {
  api.clear()
  const scene = api.addPanel({
    id: 'scene',
    component: 'scene',
    title: 'Scene',
  })
  const hierarchy = api.addPanel({
    id: 'hierarchy',
    component: 'hierarchy',
    title: 'Hierarchy',
    position: { referencePanel: scene, direction: 'left' },
    initialWidth: 280,
  })
  api.addPanel({
    id: 'project',
    component: 'project',
    title: 'Project',
    position: { referencePanel: hierarchy, direction: 'below' },
  })
  api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: 'Inspector',
    position: { referencePanel: scene, direction: 'right' },
    initialWidth: 280,
  })
  // Console / Export are available from View menu — hidden by default.
  addGamePreview(api)
}

function MenuBar({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (!openId) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (!t?.closest('.menubar-menus')) setOpenId(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenId(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [openId])

  const value = useMemo(() => ({ openId, setOpenId }), [openId])

  return (
    <MenuBarContext.Provider value={value}>
      <div className="menubar-menus" role="menubar">
        {children}
      </div>
    </MenuBarContext.Provider>
  )
}

const MenuBarContext = createContext<{
  openId: string | null
  setOpenId: (id: string | null) => void
} | null>(null)

function Menu({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: ReactNode
}) {
  const ctx = useContext(MenuBarContext)
  if (!ctx) throw new Error('Menu outside MenuBar')
  const open = ctx.openId === id

  return (
    <div
      className={`menu${open ? ' is-open' : ''}`}
      onMouseEnter={() => {
        if (ctx.openId != null) ctx.setOpenId(id)
      }}
    >
      <button
        type="button"
        className="menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => ctx.setOpenId(open ? null : id)}
      >
        {label}
      </button>
      {open && (
        <div
          className="menu-pop"
          role="menu"
          onClick={() => ctx.setOpenId(null)}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function EditorShell() {
  const editor = useEditorContext()
  const apiRef = useRef<DockviewApi | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** True when the user hid Preview via View / Mod+P — don't auto-restore. */
  const previewUserHiddenRef = useRef(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [nibbleOpen, setNibbleOpen] = useState(false)
  const [nibbleStatus, setNibbleStatus] = useState<NibbleStatus>('idle')
  const [presets, setPresets] = useState<string[]>([])
  const [simBusy, setSimBusy] = useState(false)

  const persistLayout = useCallback(() => {
    const api = apiRef.current
    if (!api) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void editor.saveWorkspace({ layout: api.toJSON() })
    }, 400)
  }, [editor])

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api
      const layout = editor.workspace?.layout
      try {
        if (layout) {
          event.api.fromJSON(layout as Parameters<DockviewApi['fromJSON']>[0])
        } else {
          buildDefaultLayout(event.api)
        }
      } catch {
        buildDefaultLayout(event.api)
      }
      previewUserHiddenRef.current = false
      ensureGamePreview(event.api)
      // Keep Preview floating if the user tries to dock it; recreate if
      // removed accidentally (old layout / tab close). Respect intentional hide.
      let floatingGuard = false
      event.api.onDidLayoutChange(() => {
        if (floatingGuard) return
        const game = event.api.getPanel('game')
        if (!game) {
          if (!previewUserHiddenRef.current) {
            floatingGuard = true
            try {
              ensureGamePreview(event.api)
            } finally {
              floatingGuard = false
            }
          }
          persistLayout()
          return
        }
        if (game.group.api.location.type !== 'floating') {
          floatingGuard = true
          try {
            ensureGamePreview(event.api)
          } finally {
            floatingGuard = false
          }
        }
        lockPreviewGroup(event.api)
        persistLayout()
      })
    },
    [editor.workspace?.layout, persistLayout],
  )

  const togglePreview = useCallback(() => {
    const api = apiRef.current
    if (!api) return
    const existing = api.getPanel('game')
    if (existing) {
      previewUserHiddenRef.current = true
      existing.api.close()
    } else {
      previewUserHiddenRef.current = false
      addGamePreview(api)
    }
    persistLayout()
  }, [persistLayout])

  const runInSimulator = useCallback(async () => {
    if (simBusy) return
    setSimBusy(true)
    try {
      if (editor.dirty) {
        await editor.save()
      }
      const result = await projectClient.runSimulator({
        scene: editor.scene,
      })
      editor.pushConsole({
        severity: 'info',
        message: `Simulator: ${result.scene} → ${result.pdx}`,
      })
      if (result.log) {
        editor.pushConsole({ severity: 'info', message: result.log })
      }
    } catch (e) {
      const err = e as Error & { body?: { error?: string; log?: string } }
      const msg =
        err.body?.error ??
        (e instanceof Error ? e.message : 'Failed to run Simulator')
      editor.pushConsole({ severity: 'error', message: msg })
      if (err.body?.log) {
        editor.pushConsole({ severity: 'error', message: err.body.log })
      }
    } finally {
      setSimBusy(false)
    }
  }, [editor, simBusy])

  const resetLayout = () => {
    const api = apiRef.current
    if (!api) return
    previewUserHiddenRef.current = false
    buildDefaultLayout(api)
    void editor.saveWorkspace({ layout: api.toJSON() })
  }

  const savePreset = async (name: string) => {
    const api = apiRef.current
    if (!api) return
    await projectClient.saveLayoutPreset(name, api.toJSON())
    setPresets((p) => (p.includes(name) ? p : [...p, name].sort()))
    editor.pushConsole({
      severity: 'info',
      message: `Saved layout preset "${name}"`,
    })
  }

  const loadPreset = async (name: string) => {
    const api = apiRef.current
    if (!api) return
    try {
      const layout = await projectClient.fetchLayoutPreset(name)
      api.fromJSON(layout as Parameters<DockviewApi['fromJSON']>[0])
      previewUserHiddenRef.current = false
      ensureGamePreview(api)
      void editor.saveWorkspace({ layout: api.toJSON() })
      editor.pushConsole({
        severity: 'info',
        message: `Loaded layout preset "${name}"`,
      })
    } catch (e) {
      editor.pushConsole({
        severity: 'error',
        message: e instanceof Error ? e.message : 'Failed to load preset',
      })
    }
  }

  const copyExport = async () => {
    await navigator.clipboard.writeText(editor.exportText)
    editor.pushConsole({
      severity: 'info',
      message: `Copied ${editor.exportFormat.toUpperCase()} to clipboard`,
    })
  }

  useEffect(() => {
    void projectClient.listLayoutPresets().then((r) => setPresets(r.presets))
  }, [])

  useEffect(() => {
    editor.commands.register({
      id: 'view.commandPalette',
      title: 'Command Palette',
      shortcut: 'Mod+K',
      enabled: () => true,
      run: () => setPaletteOpen(true),
    })
    editor.commands.register({
      id: 'view.togglePreview',
      title: 'Toggle Game Preview',
      shortcut: 'Mod+P',
      enabled: () => true,
      run: togglePreview,
    })
    editor.commands.register({
      id: 'play.runSimulator',
      title: 'Run in Playdate Simulator',
      shortcut: 'Mod+Shift+R',
      enabled: () => !simBusy,
      run: () => void runInSimulator(),
    })
    editor.commands.register({
      id: 'assistant.open',
      title: 'Open Nibble',
      shortcut: 'Mod+Shift+N',
      enabled: () => true,
      run: () => setNibbleOpen(true),
    })
  }, [editor.commands, togglePreview, runInSimulator, simBusy])

  const theme = useMemo(() => themeDark, [])
  const commandList = useMemo(
    () => editor.commands.list(),
    [editor.commands, paletteOpen],
  )

  if (!editor.ready) {
    return <div className="boot-screen">Loading project…</div>
  }

  return (
    <div className="app ide">
      <header className="menubar">
        <span className="app-brand" title={APP_TITLE}>
          <NibbleMascot
            status={nibbleStatus}
            size={16}
            interactive
            title="Open Nibble (Mod+Shift+N)"
            onClick={() => setNibbleOpen((v) => !v)}
          />
          <span className="app-title">{APP_TITLE}</span>
        </span>
        <div className="menubar-menus-wrap">
          <MenuBar>
          <Menu id="file" label="File">
            <button type="button" onClick={() => void editor.newScene()}>
              New Scene…
            </button>
            <hr className="menu-sep" />
            <div className="menu-section-label">Open Scene</div>
            {editor.scenes.length === 0 && (
              <button type="button" disabled>
                No scenes
              </button>
            )}
            {editor.scenes.map((s) => (
              <button
                key={s.id}
                type="button"
                className={
                  s.name === editor.scene.name ? 'is-checked' : undefined
                }
                onClick={() => void editor.openScene(s.name)}
              >
                {s.name}
                <span className="menu-aside mono">{s.relativePath}</span>
              </button>
            ))}
            <hr className="menu-sep" />
            <button
              type="button"
              disabled={!editor.dirty}
              onClick={() => void editor.save()}
            >
              Save
              <kbd>Mod+S</kbd>
            </button>
            <button type="button" onClick={() => void editor.reloadFromDisk()}>
              Reload from Disk
            </button>
            <hr className="menu-sep" />
            <button type="button" onClick={() => void copyExport()}>
              Copy Export ({editor.exportFormat.toUpperCase()})
            </button>
            <hr className="menu-sep" />
            <button
              type="button"
              disabled={simBusy}
              onClick={() => void runInSimulator()}
            >
              Run in Simulator
              <kbd>Mod+Shift+R</kbd>
            </button>
          </Menu>

          <Menu id="edit" label="Edit">
            <button
              type="button"
              disabled={!editor.history.canUndo}
              onClick={editor.undo}
            >
              Undo
              <kbd>Mod+Z</kbd>
            </button>
            <button
              type="button"
              disabled={!editor.history.canRedo}
              onClick={editor.redo}
            >
              Redo
              <kbd>Mod+Shift+Z</kbd>
            </button>
            <hr className="menu-sep" />
            <button
              type="button"
              disabled={editor.selectedIds.length === 0}
              onClick={editor.copySelected}
            >
              Copy
              <kbd>Mod+C</kbd>
            </button>
            <button
              type="button"
              disabled={!editor.canPaste}
              onClick={editor.pasteClipboard}
            >
              Paste
              <kbd>Mod+V</kbd>
            </button>
            <button
              type="button"
              disabled={editor.selectedIds.length === 0}
              onClick={editor.duplicateSelected}
            >
              Duplicate
              <kbd>Mod+D</kbd>
            </button>
            <button
              type="button"
              disabled={editor.selectedIds.length === 0}
              onClick={editor.deleteSelected}
            >
              Delete
              <kbd>Del</kbd>
            </button>
          </Menu>

          <Menu id="view" label="View">
            <button
              type="button"
              onClick={() => editor.setShowGrid((v) => !v)}
            >
              {editor.showGrid ? 'Hide Grid' : 'Show Grid'}
              <kbd>Mod+G</kbd>
            </button>
            <button
              type="button"
              onClick={() =>
                editor.setSnap((s) => ({ ...s, enabled: !s.enabled }))
              }
            >
              {editor.snap.enabled ? 'Disable Snap' : 'Enable Snap'}
            </button>
            <button type="button" onClick={togglePreview}>
              Toggle Preview
              <kbd>Mod+P</kbd>
            </button>
            <hr className="menu-sep" />
            <button
              type="button"
              onClick={() => {
                const api = apiRef.current
                if (!api) return
                showUtilityPanel(api, 'console', 'Console')
                persistLayout()
              }}
            >
              Console
            </button>
            <button
              type="button"
              onClick={() => {
                const api = apiRef.current
                if (!api) return
                showUtilityPanel(api, 'export', 'Export')
                persistLayout()
              }}
            >
              Export
            </button>
            <hr className="menu-sep" />
            <button type="button" onClick={() => setPaletteOpen(true)}>
              Command Palette…
              <kbd>Mod+K</kbd>
            </button>
            <button type="button" onClick={() => setNibbleOpen(true)}>
              Nibble…
              <kbd>Mod+Shift+N</kbd>
            </button>
          </Menu>

          <Menu id="layout" label="Layout">
            <button type="button" onClick={resetLayout}>
              Reset Layout
            </button>
            <button
              type="button"
              onClick={() => void savePreset(DEFAULT_LAYOUT_KEY)}
            >
              Save as Default
            </button>
            <button type="button" onClick={() => void savePreset('compact')}>
              Save as Compact
            </button>
            {presets.length > 0 && <hr className="menu-sep" />}
            {presets.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => void loadPreset(name)}
              >
                Load “{name}”
              </button>
            ))}
          </Menu>
          </MenuBar>
        </div>

        <span className="menubar-sep" />
        <span className="mono dim">{editor.scene.name}.scene.json</span>
        {editor.dirty && <span className="dirty-dot" title="Unsaved">●</span>}
        <span className="menubar-sep" />

        <div className="toolbar">
          <IconButton
            icon={FloppyDisk}
            title="Save (Mod+S)"
            disabled={!editor.dirty}
            onClick={() => void editor.save()}
          />
          <IconButton
            icon={ArrowCounterClockwise}
            title="Undo"
            disabled={!editor.history.canUndo}
            onClick={editor.undo}
          />
          <IconButton
            icon={ArrowClockwise}
            title="Redo"
            disabled={!editor.history.canRedo}
            onClick={editor.redo}
          />
          <IconButton
            icon={Play}
            title={simBusy ? 'Building…' : 'Run in Simulator (Mod+Shift+R)'}
            disabled={simBusy}
            onClick={() => void runInSimulator()}
          />
          <IconButton
            icon={GameController}
            title="Toggle Preview (Mod+P)"
            onClick={togglePreview}
          />
        </div>
      </header>

      {editor.conflict && (
        <div className="conflict-banner">
          <span>
            Disk changed
            {editor.conflict.relativePath
              ? ` (${editor.conflict.relativePath})`
              : ''}
            . Local edits are dirty.
          </span>
          <button type="button" onClick={() => void editor.reloadFromDisk()}>
            Reload
          </button>
          <button type="button" onClick={editor.keepMine}>
            Keep mine
          </button>
        </div>
      )}

      <div className="dock-host">
        <DockviewReact
          className="dockview-theme-dark playdate-dock"
          theme={theme}
          components={components}
          onReady={onReady}
          floatingGroupDragHandle="titlebar"
          floatingGroupBounds="boundedWithinViewport"
        />
      </div>

      <footer className="statusbar">
        <span>{editor.status}</span>
        <span className="mono">
          rev {editor.revision?.slice(0, 8) ?? '—'}
          {editor.dirty ? ' · dirty' : ' · clean'}
        </span>
        <span>
          {Math.round(editor.zoom * 100)}% · {editor.selectedIds.length} sel ·{' '}
          {editor.tool}
          {editor.scene.states.length > 1
            ? ` · state ${editor.activeState}`
            : ''}
        </span>
      </footer>

      <CommandPalette
        open={paletteOpen}
        commands={commandList}
        onClose={() => setPaletteOpen(false)}
        onRun={(id) => editor.commands.run(id)}
      />

      <NibbleChat
        open={nibbleOpen}
        status={nibbleStatus}
        onStatusChange={setNibbleStatus}
        onClose={() => setNibbleOpen(false)}
      />
    </div>
  )
}
