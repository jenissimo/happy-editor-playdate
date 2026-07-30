import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { SCREEN_H, SCREEN_W } from '../../core/constants'
import type { Scene, SceneNode } from '../../core/scene/types'
import {
  ContextMenu,
  ctxItem,
  ctxSep,
  type ContextMenuItem,
} from '../components/ContextMenu'
import { ContextOptionsBar } from '../components/ContextOptionsBar'
import { SceneStateBar } from '../components/SceneStateBar'
import { IconButton } from '../components/IconButton'
import {
  CornersOut,
  Cursor,
  GridFour,
  HandGrabbing,
  MagnetStraight,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  NODE_ICONS,
} from '../icons'
import {
  nodeRect,
  otherRects,
  hitStackAt,
  cycleHitId,
  rectsIntersect,
  rectToNodePatch,
  snapResize,
  snapTranslate,
  unionRects,
  type Guide,
  type Rect,
  type ResizeHandle,
  type SnapSettings,
} from '../geometry'
import { SceneCanvasPreview } from '../render/SceneCanvasPreview'
import { useEditorContext } from '../state/EditorContext'
import { findNode, flattenNodes } from '../state/nodeTree'
import { clampZoom, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '../zoom'

export { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, clampZoom }
const RULER = 18

/** Pinch / ctrl-wheel: pixels of deltaY before one integer zoom step. */
const PINCH_ZOOM_THRESHOLD = 48

const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

function isVisible(node: SceneNode, state: string) {
  if (!node.visible) return false
  if (node.states.length === 0) return true
  return node.states.includes(state)
}

function normalizeMarquee(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  }
}

export function ScenePanel() {
  const editor = useEditorContext()
  const {
    scene,
    selectedIds,
    selectOne,
    setSelectedIds,
    snap,
    showGrid,
    zoom,
    setZoom,
    pan,
    setPan,
    tool,
    setTool,
    activeState,
    assets,
    patchNodesLive,
    commitLiveGesture,
    getSceneSnapshot,
    addFromAsset,
    addNode,
    commands,
    patchNode,
    deleteSelected,
    duplicateSelected,
    groupSelected,
  } = editor

  const [guides, setGuides] = useState<Guide[]>([])
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    items: ContextMenuItem[]
  } | null>(null)
  const marqueeStart = useRef<{ x: number; y: number } | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const panning = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const pinchAcc = useRef(0)
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  zoomRef.current = zoom
  panRef.current = pan

  const applyZoomAt = useCallback(
    (nextZoom: number, clientX: number, clientY: number) => {
      const vp = viewportRef.current
      if (!vp) return
      const z = zoomRef.current
      const p = panRef.current
      if (nextZoom === z) return
      const rect = vp.getBoundingClientRect()
      const wx = (clientX - rect.left - RULER - p.x) / z
      const wy = (clientY - rect.top - RULER - p.y) / z
      setZoom(nextZoom)
      setPan({
        x: clientX - rect.left - RULER - wx * nextZoom,
        y: clientY - rect.top - RULER - wy * nextZoom,
      })
    },
    [setPan, setZoom],
  )

  // Native non-passive wheel: trackpad pan / pinch zoom / mouse-wheel zoom.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // Pinch-to-zoom on Mac trackpads is synthesized as ctrl+wheel.
      if (e.ctrlKey || e.metaKey) {
        pinchAcc.current += -e.deltaY
        let z = zoomRef.current
        while (pinchAcc.current >= PINCH_ZOOM_THRESHOLD) {
          pinchAcc.current -= PINCH_ZOOM_THRESHOLD
          z = clampZoom(z + ZOOM_STEP)
        }
        while (pinchAcc.current <= -PINCH_ZOOM_THRESHOLD) {
          pinchAcc.current += PINCH_ZOOM_THRESHOLD
          z = clampZoom(z - ZOOM_STEP)
        }
        applyZoomAt(z, e.clientX, e.clientY)
        return
      }
      // Mouse wheel (line/page mode, or large discrete ticks) → zoom.
      // Trackpad two-finger scroll (pixel deltas, often with deltaX) → pan.
      const mouseWheel =
        e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
        (Math.abs(e.deltaY) >= 40 && Math.abs(e.deltaX) < 1 && !e.shiftKey)
      if (mouseWheel && !e.shiftKey) {
        const next = clampZoom(
          zoomRef.current + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP),
        )
        applyZoomAt(next, e.clientX, e.clientY)
        return
      }
      setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [applyZoomAt, setPan])

  const screenToPlaydate = useCallback(
    (clientX: number, clientY: number) => {
      const vp = viewportRef.current
      if (!vp) return { x: 0, y: 0 }
      const rect = vp.getBoundingClientRect()
      const x = (clientX - rect.left - RULER - pan.x) / zoom
      const y = (clientY - rect.top - RULER - pan.y) / zoom
      return { x: Math.round(x), y: Math.round(y) }
    },
    [pan, zoom],
  )

  const flatNodes = useMemo(() => flattenNodes(scene.nodes), [scene.nodes])

  const frameToContent = useCallback(() => {
    const vp = viewportRef.current
    if (!vp) return
    const selected = flatNodes.filter((n) => selectedIds.includes(n.id))
    const bounds =
      unionRects(selected.map(nodeRect)) ??
      ({ left: 0, top: 0, right: SCREEN_W, bottom: SCREEN_H } satisfies Rect)
    const bw = Math.max(1, bounds.right - bounds.left)
    const bh = Math.max(1, bounds.bottom - bounds.top)
    const availW = vp.clientWidth - RULER - 48
    const availH = vp.clientHeight - RULER - 48
    // Largest integer scale that still fits.
    const fitted = Math.floor(Math.min(availW / bw, availH / bh))
    const nextZoom = clampZoom(Number.isFinite(fitted) ? fitted : 1)
    setZoom(nextZoom)
    setPan({
      x: (availW - bw * nextZoom) / 2 - bounds.left * nextZoom + 24,
      y: (availH - bh * nextZoom) / 2 - bounds.top * nextZoom + 24,
    })
  }, [flatNodes, selectedIds, setPan, setZoom])

  useEffect(() => {
    commands.register({
      id: 'view.frameSelection',
      title: 'Frame Selection',
      shortcut: 'F',
      enabled: () => true,
      run: frameToContent,
    })
  }, [commands, frameToContent])

  const onViewportPointerDown = (e: ReactPointerEvent) => {
    // Middle button always pans — never selects or starts marquee.
    if (e.button === 1 || tool === 'hand') {
      e.preventDefault()
      e.stopPropagation()
      setCtxMenu(null)
      panning.current = {
        sx: e.clientX,
        sy: e.clientY,
        ox: pan.x,
        oy: pan.y,
      }
      setIsPanning(true)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      return
    }
    // Select tool: click outside the screen clears selection (marquee lives on .screen-world).
    if (tool === 'select' && e.button === 0) {
      const t = e.target as HTMLElement
      if (!t.closest('.screen-world')) {
        if (!(e.metaKey || e.ctrlKey || e.shiftKey)) setSelectedIds([])
      }
    }
  }

  const openSceneContextMenu = useCallback(
    (clientX: number, clientY: number, hitId: string | null) => {
      let ids = selectedIds
      if (hitId) {
        if (!selectedIds.includes(hitId)) {
          selectOne(hitId)
          ids = [hitId]
        }
      }
      const focusId = hitId ?? ids[0] ?? null
      const focus = focusId ? findNode(scene.nodes, focusId) : null
      const items: ContextMenuItem[] = []

      if (focus) {
        items.push(
          ctxItem({
            id: 'duplicate',
            label: 'Duplicate',
            shortcut: '⌘D',
            run: () => duplicateSelected(),
          }),
          ctxItem({
            id: 'delete',
            label: 'Delete',
            shortcut: '⌫',
            danger: true,
            run: () => deleteSelected(),
          }),
          ctxSep(),
          ctxItem({
            id: 'lock',
            label: focus.locked ? 'Unlock' : 'Lock',
            run: () =>
              patchNode(focus.id, { locked: !focus.locked }, 'Toggle lock'),
          }),
          ctxItem({
            id: 'visible',
            label: focus.visible ? 'Hide' : 'Show',
            run: () =>
              patchNode(
                focus.id,
                { visible: !focus.visible },
                'Toggle visibility',
              ),
          }),
        )
        if (ids.length >= 2) {
          items.push(
            ctxSep(),
            ctxItem({
              id: 'group',
              label: 'Group selection',
              shortcut: '⌘G',
              run: () => groupSelected(),
            }),
          )
        }
        items.push(ctxSep())
      }

      items.push(
        ctxItem({
          id: 'add-text',
          label: 'Add Text',
          run: () => addNode('text'),
        }),
        ctxItem({
          id: 'add-shape',
          label: 'Add Shape',
          run: () => addNode('shape'),
        }),
        ctxSep(),
        ctxItem({
          id: 'frame',
          label: 'Frame selection',
          shortcut: 'F',
          run: () => commands.run('view.frameSelection'),
        }),
        ctxItem({
          id: 'zoom-reset',
          label: 'Zoom to 100%',
          run: () => setZoom(1),
        }),
      )
      setCtxMenu({ x: clientX, y: clientY, items })
    },
    [
      addNode,
      commands,
      deleteSelected,
      duplicateSelected,
      groupSelected,
      patchNode,
      scene.nodes,
      selectOne,
      selectedIds,
      setZoom,
    ],
  )

  const onViewportContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const t = e.target as HTMLElement
    const hit = t.closest('.node-hit') as HTMLElement | null
    const hitId = hit?.dataset.nodeId ?? null
    openSceneContextMenu(e.clientX, e.clientY, hitId)
  }

  const onViewportPointerMove = (e: ReactPointerEvent) => {
    const pd = screenToPlaydate(e.clientX, e.clientY)
    setCursor(pd)
    if (panning.current) {
      setPan({
        x: panning.current.ox + (e.clientX - panning.current.sx),
        y: panning.current.oy + (e.clientY - panning.current.sy),
      })
    }
    if (marqueeStart.current) {
      setMarquee(normalizeMarquee(marqueeStart.current, pd))
    }
  }

  const finishMarquee = (additive: boolean) => {
    if (!marqueeStart.current || !marquee) {
      marqueeStart.current = null
      setMarquee(null)
      return
    }
    const box = marquee
    const hits = flatNodes
      .filter(
        (n) =>
          n.type !== 'group' &&
          isVisible(n, activeState) &&
          rectsIntersect(nodeRect(n), box),
      )
      .map((n) => n.id)
    if (additive) {
      setSelectedIds([...new Set([...selectedIds, ...hits])])
    } else {
      setSelectedIds(hits)
    }
    marqueeStart.current = null
    setMarquee(null)
  }

  const onViewportPointerUp = (e: ReactPointerEvent) => {
    if (panning.current) {
      panning.current = null
      setIsPanning(false)
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        /* */
      }
    }
    if (marqueeStart.current) {
      finishMarquee(e.metaKey || e.ctrlKey || e.shiftKey)
    }
  }

  const beginMarquee = (e: ReactPointerEvent) => {
    if (tool !== 'select' || e.button !== 0) return
    const pd = screenToPlaydate(e.clientX, e.clientY)
    marqueeStart.current = pd
    setMarquee({ left: pd.x, top: pd.y, right: pd.x, bottom: pd.y })
    if (!(e.metaKey || e.ctrlKey || e.shiftKey)) setSelectedIds([])
    setGuides([])
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const path = e.dataTransfer.getData('application/x-playdate-asset')
    if (!path) return
    const asset = assets.find((a) => a.relativePath === path)
    if (!asset) return
    const at = screenToPlaydate(e.clientX, e.clientY)
    addFromAsset(asset, at)
  }

  const rulerTicks = useMemo(() => {
    const step = snap.grid > 0 ? snap.grid : 8
    const xs: number[] = []
    const ys: number[] = []
    for (let x = 0; x <= SCREEN_W; x += step) xs.push(x)
    for (let y = 0; y <= SCREEN_H; y += step) ys.push(y)
    return { xs, ys }
  }, [snap.grid])

  return (
    <div className="scene-panel">
      <div className="scene-toolbar">
        <IconButton
          icon={Cursor}
          title="Select (V)"
          active={tool === 'select'}
          onClick={() => setTool('select')}
        />
        <IconButton
          icon={HandGrabbing}
          title="Hand (H / Space)"
          active={tool === 'hand'}
          onClick={() => setTool('hand')}
        />
        <span className="toolbar-sep" />
        <IconButton
          icon={NODE_ICONS.text}
          title="Add Text"
          onClick={() => addNode('text')}
        />
        <IconButton
          icon={NODE_ICONS.panel}
          title="Add Panel"
          onClick={() => addNode('panel')}
        />
        <IconButton
          icon={NODE_ICONS.frame}
          title="Add Frame"
          onClick={() => addNode('frame')}
        />
        <IconButton
          icon={NODE_ICONS.shape}
          title="Add Shape"
          onClick={() => addNode('shape')}
        />
        <IconButton
          icon={NODE_ICONS.image}
          title="Add Image"
          onClick={() => addNode('image')}
        />
        <IconButton
          icon={NODE_ICONS.group}
          title="Add Group"
          onClick={() => addNode('group')}
        />
        <span className="toolbar-sep" />
        <IconButton
          icon={MagnetStraight}
          title="Snap"
          active={snap.enabled}
          onClick={() =>
            editor.setSnap((s) => ({ ...s, enabled: !s.enabled }))
          }
        />
        <IconButton
          icon={GridFour}
          title="Grid"
          active={showGrid}
          onClick={() => editor.setShowGrid((v) => !v)}
        />
        <IconButton
          icon={CornersOut}
          title="Frame selection (F)"
          onClick={frameToContent}
        />
        <span className="toolbar-sep" />
        <IconButton
          icon={MagnifyingGlassMinus}
          title="Zoom out"
          onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
        />
        <button
          type="button"
          className="zoom-pct"
          title="Reset zoom"
          onClick={() => setZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconButton
          icon={MagnifyingGlassPlus}
          title="Zoom in"
          onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
        />
        <span className="toolbar-sep" />
        <SceneStateBar />
      </div>

      <ContextOptionsBar />

      <div
        ref={viewportRef}
        className={`scene-viewport tool-${tool}${isPanning ? ' is-panning' : ''}`}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={onViewportPointerUp}
        onPointerCancel={onViewportPointerUp}
        onContextMenu={onViewportContextMenu}
        onAuxClick={(e) => {
          // Block browser middle-click autoscroll / open-link.
          if (e.button === 1) e.preventDefault()
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <div className="ruler-corner" />
        <div className="ruler ruler-x" style={{ height: RULER }}>
          {rulerTicks.xs.map((x) => (
            <span
              key={x}
              className={`ruler-tick${x % 40 === 0 ? ' major' : ''}`}
              style={{ left: RULER + pan.x + x * zoom }}
            >
              {x % 40 === 0 ? x : ''}
            </span>
          ))}
        </div>
        <div className="ruler ruler-y" style={{ width: RULER }}>
          {rulerTicks.ys.map((y) => (
            <span
              key={y}
              className={`ruler-tick${y % 40 === 0 ? ' major' : ''}`}
              style={{ top: RULER + pan.y + y * zoom }}
            >
              {y % 40 === 0 ? y : ''}
            </span>
          ))}
        </div>

        <div
          className="screen-world"
          style={{
            transform: `translate(${pan.x + RULER}px, ${pan.y + RULER}px)`,
          }}
          onPointerDown={(e) => {
            // Middle button: don't marquee / capture — bubble to viewport pan.
            if (e.button === 1) return
            if ((e.target as HTMLElement).closest('.node-hit')) return
            beginMarquee(e)
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          }}
        >
          <div
            className="screen-scale"
            style={{ width: SCREEN_W * zoom, height: SCREEN_H * zoom }}
          >
            <div
              className="screen"
              style={{
                width: SCREEN_W,
                height: SCREEN_H,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
              }}
            >
              {/* Same draw path as Preview / Simulator — hit targets overlay on top. */}
              <SceneCanvasPreview
                className="screen-framebuffer"
                scene={scene}
                assets={assets}
                state={activeState}
              />
              {showGrid && <div className="screen-grid-overlay" aria-hidden />}
              {flatNodes.map((node) =>
                node.type !== 'group' && isVisible(node, activeState) ? (
                  <SceneNodeView
                    key={node.id}
                    node={node}
                    nodes={flatNodes}
                    selected={selectedIds.includes(node.id)}
                    selectedIds={selectedIds}
                    activeState={activeState}
                    snap={snap}
                    zoom={zoom}
                    tool={tool}
                    screenToPlaydate={screenToPlaydate}
                    onSelect={selectOne}
                    onLivePatch={patchNodesLive}
                    onCommit={(label, before) =>
                      commitLiveGesture(label, before)
                    }
                    getBefore={getSceneSnapshot}
                    onGuides={setGuides}
                  />
                ) : null,
              )}
              {guides.map((g, i) => (
                <div
                  key={`${g.axis}-${g.pos}-${i}`}
                  className={`guide guide-${g.axis} guide-${g.kind}`}
                  style={g.axis === 'x' ? { left: g.pos } : { top: g.pos }}
                />
              ))}
              {marquee && (
                <div
                  className="marquee"
                  style={{
                    left: marquee.left,
                    top: marquee.top,
                    width: marquee.right - marquee.left,
                    height: marquee.bottom - marquee.top,
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="scene-status">
        {SCREEN_W}×{SCREEN_H}
        {cursor ? ` · ${cursor.x},${cursor.y}` : ''}
        {snap.enabled ? ` · snap ${snap.grid}px` : ' · free'}
        {` · ${selectedIds.length} selected`}
        {
          ' · middle/trackpad pan · pinch zoom · Alt+click through · F frame'
        }
      </div>

      {ctxMenu ? (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      ) : null}
    </div>
  )
}

function SceneNodeView({
  node,
  nodes,
  selected,
  selectedIds,
  activeState,
  snap,
  zoom,
  tool,
  screenToPlaydate,
  onSelect,
  onLivePatch,
  onCommit,
  getBefore,
  onGuides,
}: {
  node: SceneNode
  nodes: SceneNode[]
  selected: boolean
  selectedIds: string[]
  activeState: string
  snap: SnapSettings
  zoom: number
  tool: 'select' | 'hand'
  screenToPlaydate: (clientX: number, clientY: number) => { x: number; y: number }
  onSelect: (id: string, additive?: boolean) => void
  onLivePatch: (patches: Record<string, Partial<SceneNode>>) => void
  onCommit: (label: string, before: Scene) => void
  getBefore: () => Scene
  onGuides: (g: Guide[]) => void
}) {
  const origin = nodeRect(node)

  const onPointerDown = (e: ReactPointerEvent) => {
    // Middle button → viewport pan (do not capture the node).
    if (e.button === 1) return
    if (e.button !== 0) return
    if (tool === 'hand') return
    if ((e.target as HTMLElement).closest('.handle')) return

    // Alt/Option+click: cycle selection down through overlapping layers.
    if (e.altKey) {
      e.stopPropagation()
      e.preventDefault()
      const pd = screenToPlaydate(e.clientX, e.clientY)
      const stack = hitStackAt(nodes, pd.x, pd.y, (n) =>
        isVisible(n, activeState),
      )
      const current =
        selectedIds.find((id) => stack.some((n) => n.id === id)) ?? null
      const nextId = cycleHitId(stack, current)
      if (nextId) onSelect(nextId, e.metaKey || e.ctrlKey)
      return
    }

    if (node.locked) {
      onSelect(node.id, e.metaKey || e.ctrlKey)
      return
    }
    e.stopPropagation()
    onSelect(node.id, e.metaKey || e.ctrlKey)
    const before = getBefore()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startY = e.clientY
    const start = nodeRect(node)

    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - startX) / zoom)
      const dy = Math.round((ev.clientY - startY) / zoom)
      const moved = {
        left: start.left + dx,
        right: start.right + dx,
        top: start.top + dy,
        bottom: start.bottom + dy,
      }
      const { rect, guides } = snapTranslate(
        moved,
        snap,
        otherRects(nodes, node.id),
      )
      onGuides(guides)
      onLivePatch({ [node.id]: rectToNodePatch(rect, node.anchor) })
    }
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId)
      onGuides([])
      onCommit('Move', before)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onHandleDown = (handle: ResizeHandle) => (e: ReactPointerEvent) => {
    if (node.locked) return
    e.stopPropagation()
    onSelect(node.id)
    const before = getBefore()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startY = e.clientY
    const start = nodeRect(node)

    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - startX) / zoom)
      const dy = Math.round((ev.clientY - startY) / zoom)
      const { rect, guides } = snapResize(
        start,
        handle,
        dx,
        dy,
        snap,
        otherRects(nodes, node.id),
      )
      onGuides(guides)
      onLivePatch({ [node.id]: rectToNodePatch(rect, node.anchor) })
    }
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId)
      onGuides([])
      onCommit('Resize', before)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onRotateDown = (e: ReactPointerEvent) => {
    if (node.locked) return
    e.stopPropagation()
    e.preventDefault()
    onSelect(node.id)
    const before = getBefore()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const hit = el.parentElement
    const pivotEl = hit?.querySelector('.node-pivot') as HTMLElement | null
    const pivot = pivotEl?.getBoundingClientRect()
    const px = pivot ? pivot.left : e.clientX
    const py = pivot ? pivot.top : e.clientY
    const startAngle = Math.atan2(e.clientY - py, e.clientX - px)
    const startRot = node.rotation ?? 0

    const move = (ev: PointerEvent) => {
      const angle = Math.atan2(ev.clientY - py, ev.clientX - px)
      let deg = startRot + ((angle - startAngle) * 180) / Math.PI
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15
      else deg = Math.round(deg)
      onLivePatch({ [node.id]: { rotation: deg } })
    }
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId)
      onCommit('Rotate', before)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className={`node-hit${selected ? ' is-selected' : ''}${node.locked ? ' is-locked' : ''}`}
      data-node-id={node.id}
      style={{
        left: origin.left,
        top: origin.top,
        width: node.w,
        height: node.h,
        transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
        transformOrigin: `${node.anchor.x * 100}% ${node.anchor.y * 100}%`,
      }}
      onPointerDown={onPointerDown}
    >
      <span
        className="node-pivot"
        style={{
          left: `${node.anchor.x * 100}%`,
          top: `${node.anchor.y * 100}%`,
        }}
        aria-hidden
      />
      {selected &&
        !node.locked &&
        HANDLES.map((h) => (
          <button
            key={h}
            type="button"
            className={`handle handle-${h}`}
            aria-label={`Resize ${h}`}
            onPointerDown={onHandleDown(h)}
          />
        ))}
      {selected && !node.locked && (
        <button
          type="button"
          className="handle handle-rotate"
          aria-label="Rotate"
          title="Rotate · Shift = 15°"
          onPointerDown={onRotateDown}
        />
      )}
      {selected && (
        <span className="node-size-tag">
          {node.w}×{node.h}
          {(node.rotation ?? 0) !== 0 ? ` · ${Math.round(node.rotation ?? 0)}°` : ''}
        </span>
      )}
    </div>
  )
}

export function GamePanel() {
  const { scene, activeState, assets } = useEditorContext()
  const scale = 1
  return (
    <div className="game-panel game-panel--float">
      <div
        className="game-bezel"
        style={{ width: SCREEN_W * scale, height: SCREEN_H * scale }}
      >
        <div
          className="pd-lcd-surface"
          style={{
            width: SCREEN_W * scale,
            height: SCREEN_H * scale,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <SceneCanvasPreview
            scene={scene}
            assets={assets}
            state={activeState}
          />
        </div>
      </div>
    </div>
  )
}
