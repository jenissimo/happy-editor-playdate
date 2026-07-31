import { useMemo, useState, type DragEvent, type MouseEvent } from 'react'
import { describeAsset } from '../../core/assets/parseAssetName'
import type { AssetKind } from '../../core/assets/parseAssetName'
import type { FrameStyle, Ink } from '../../core/scene/types'
import {
  ContextMenu,
  ctxItem,
  ctxSep,
  type ContextMenuItem,
} from '../components/ContextMenu'
import { IconButton } from '../components/IconButton'
import { NumericField } from '../components/NumericField'
import { ChoiceTiles } from '../components/ChoiceTiles'
import { AnchorPicker } from '../components/AnchorPicker'
import { AssetPicker } from '../components/AssetPicker'
import { FontPicker } from '../components/FontPicker'
import { ShapePropertyEditors } from '../components/ContextOptionsBar'
import { StateMembership } from '../components/StateMembership'
import { nodeVisibleInState } from '../state/sceneStates'
import {
  AlignPreview,
  VAlignPreview,
  FrameStylePreview,
  InkSwatch,
} from '../components/PropertyPreviews'
import {
  CaretDown,
  CaretRight,
  Eye,
  EyeSlash,
  FolderOpen,
  List,
  Lock,
  LockOpen,
  NODE_ICONS,
  SquaresFour,
  Trash,
} from '../icons'
import { AssetZoomLens } from '../components/AssetZoomLens'
import { useEditorContext } from '../state/EditorContext'
import {
  buildHierarchyRows,
  countNodes,
  visualPlaceToArrayPlace,
  type HierarchyRow,
} from '../state/nodeTree'

export function HierarchyPanel() {
  const {
    scene,
    selectedIds,
    selectOne,
    patchNode,
    deleteSelected,
    duplicateSelected,
    copySelected,
    pasteClipboard,
    canPaste,
    reorder,
    addNode,
    groupSelected,
    activeState,
    setActiveState,
  } = useEditorContext()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<{
    id: string
    visual: 'before' | 'after' | 'into'
  } | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    items: ContextMenuItem[]
  } | null>(null)

  const collapsedSet = useMemo(
    () =>
      new Set(
        Object.entries(collapsed)
          .filter(([, v]) => v)
          .map(([k]) => k),
      ),
    [collapsed],
  )

  const rows = useMemo(
    () => buildHierarchyRows(scene.nodes, collapsedSet),
    [scene.nodes, collapsedSet],
  )

  const total = useMemo(() => countNodes(scene.nodes), [scene.nodes])

  const clearDrag = () => {
    setDragId(null)
    setDrop(null)
  }

  const placeFromEvent = (
    e: DragEvent,
    row: HierarchyRow,
  ): 'before' | 'after' | 'into' => {
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    const y = e.clientY - rect.top
    const ratio = rect.height > 0 ? y / rect.height : 0.5
    if (row.node.type === 'group') {
      if (ratio < 0.25) return 'before'
      if (ratio > 0.75) return 'after'
      return 'into'
    }
    return ratio < 0.5 ? 'before' : 'after'
  }

  const openRowMenu = (e: MouseEvent, nodeId: string) => {
    e.preventDefault()
    e.stopPropagation()
    let ids = selectedIds
    if (!selectedIds.includes(nodeId)) {
      selectOne(nodeId)
      ids = [nodeId]
    }
    const n = rows.find((r) => r.node.id === nodeId)?.node
    if (!n) return
    const items: ContextMenuItem[] = [
      ctxItem({
        id: 'copy',
        label: 'Copy',
        shortcut: '⌘C',
        run: () => copySelected(),
      }),
      ctxItem({
        id: 'paste',
        label: 'Paste',
        shortcut: '⌘V',
        disabled: !canPaste,
        run: () => pasteClipboard(),
      }),
      ctxItem({
        id: 'dup',
        label: 'Duplicate',
        run: () => duplicateSelected(),
      }),
      ctxItem({
        id: 'del',
        label: 'Delete',
        danger: true,
        run: () => deleteSelected(),
      }),
      ctxSep(),
      ctxItem({
        id: 'lock',
        label: n.locked ? 'Unlock' : 'Lock',
        run: () => patchNode(n.id, { locked: !n.locked }, 'Toggle lock'),
      }),
      ctxItem({
        id: 'vis',
        label: n.visible ? 'Hide' : 'Show',
        run: () => patchNode(n.id, { visible: !n.visible }, 'Toggle visibility'),
      }),
    ]
    if (ids.length >= 2) {
      items.push(
        ctxSep(),
        ctxItem({
          id: 'group',
          label: 'Group selection',
          run: () => groupSelected(),
        }),
      )
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, items })
  }

  return (
    <div className="panel-root">
      <div className="panel-toolbar">
        <span className="hint">{total} nodes</span>
        <IconButton
          icon={NODE_ICONS.group}
          title="Add Group"
          onClick={() => addNode('group')}
        />
        <IconButton
          icon={SquaresFour}
          title="Group selection (Ctrl+G)"
          disabled={selectedIds.length === 0}
          onClick={groupSelected}
        />
        <IconButton
          icon={Trash}
          title="Delete selected"
          danger
          disabled={selectedIds.length === 0}
          onClick={deleteSelected}
        />
      </div>
      <ul
        className="hierarchy-list"
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null)
        }}
      >
        {rows.length === 0 && <li className="empty">Empty scene</li>}
        {rows.map((row) => {
          const n = row.node
          const Icon = NODE_ICONS[n.type]
          const active = selectedIds.includes(n.id)
          const isGroup = n.type === 'group'
          const isCollapsed = collapsed[n.id] === true
          const childCount = isGroup ? n.children.length : 0
          const dropHere = drop?.id === n.id ? drop.visual : null
          const dragging = dragId === n.id
          const inActiveState =
            !n.states || n.states.length === 0 || n.states.includes(activeState)

          return (
            <li
              key={n.id}
              className={[
                'hierarchy-item',
                dropHere === 'before' ? 'drop-before' : '',
                dropHere === 'after' ? 'drop-after' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div
                className={[
                  'hierarchy-row',
                  active ? 'is-active' : '',
                  n.locked ? 'is-locked' : '',
                  dragging ? 'is-dragging' : '',
                  dropHere === 'into' ? 'is-drop-into' : '',
                  !inActiveState ? 'is-other-state' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ paddingLeft: `${0.3 + row.depth * 0.75}rem` }}
                draggable
                onDragStart={(e) => {
                  setDragId(n.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', n.id)
                }}
                onDragEnd={clearDrag}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (!dragId || dragId === n.id) {
                    setDrop(null)
                    return
                  }
                  const visual = placeFromEvent(e, row)
                  setDrop((prev) =>
                    prev?.id === n.id && prev.visual === visual
                      ? prev
                      : { id: n.id, visual },
                  )
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (!dragId || dragId === n.id) {
                    clearDrag()
                    return
                  }
                  const visual = placeFromEvent(e, row)
                  if (visual === 'into') {
                    reorder(dragId, n.id, 'into')
                  } else {
                    reorder(dragId, n.id, visualPlaceToArrayPlace(visual))
                  }
                  if (visual === 'into' && isCollapsed) {
                    setCollapsed((c) => ({ ...c, [n.id]: false }))
                  }
                  clearDrag()
                }}
                onClick={(e) => {
                  if (
                    n.states.length > 0 &&
                    !n.states.includes(activeState)
                  ) {
                    setActiveState(n.states[0]!)
                  }
                  selectOne(n.id, e.metaKey || e.ctrlKey)
                }}
                onContextMenu={(e) => openRowMenu(e, n.id)}
              >
                {isGroup ? (
                  <button
                    type="button"
                    className="icon-ghost hierarchy-twist"
                    title={isCollapsed ? 'Expand' : 'Collapse'}
                    onClick={(e) => {
                      e.stopPropagation()
                      setCollapsed((c) => ({ ...c, [n.id]: !c[n.id] }))
                    }}
                  >
                    {isCollapsed || childCount === 0 ? (
                      <CaretRight size={12} />
                    ) : (
                      <CaretDown size={12} />
                    )}
                  </button>
                ) : (
                  <span className="hierarchy-twist-spacer" />
                )}
                <Icon size={14} weight="regular" />
                <span className="hierarchy-name">
                  {n.name}
                  {isGroup ? (
                    <span className="hierarchy-meta">{childCount}</span>
                  ) : null}
                  {n.states.length > 0 ? (
                    <span className="hierarchy-meta hierarchy-state">
                      {n.states.join(', ')}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="icon-ghost"
                  title={n.visible ? 'Hide' : 'Show'}
                  onClick={(e) => {
                    e.stopPropagation()
                    patchNode(n.id, { visible: !n.visible }, 'Toggle visibility')
                  }}
                >
                  {n.visible ? <Eye size={12} /> : <EyeSlash size={12} />}
                </button>
                <button
                  type="button"
                  className="icon-ghost"
                  title={n.locked ? 'Unlock' : 'Lock'}
                  onClick={(e) => {
                    e.stopPropagation()
                    patchNode(n.id, { locked: !n.locked }, 'Toggle lock')
                  }}
                >
                  {n.locked ? <Lock size={12} /> : <LockOpen size={12} />}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
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

const KIND_FILTERS: Array<AssetKind | 'all'> = [
  'all',
  'image',
  'slice',
  'table',
  'font',
]

export function ProjectPanel() {
  const { assets, addFromAsset, registry, workspace, saveWorkspace } =
    useEditorContext()
  const prefs = workspace?.preferences ?? {}
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<(typeof KIND_FILTERS)[number]>('all')
  const [view, setView] = useState<'grid' | 'list'>(
    prefs.projectView === 'list' ? 'list' : 'grid',
  )
  const [thumbSize, setThumbSize] = useState<'s' | 'm' | 'l'>(
    prefs.thumbnailSize === 48
      ? 's'
      : prefs.thumbnailSize === 96
        ? 'l'
        : 'm',
  )
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [zoom, setZoom] = useState<{
    asset: (typeof assets)[number]
    x: number
    y: number
  } | null>(null)

  const filtered = useMemo(() => {
    let list = query ? registry.search(query) : assets
    if (kind !== 'all') list = list.filter((a) => a.kind === kind)
    return list
  }, [assets, registry, query, kind])

  const folders = useMemo(() => {
    const map = new Map<string, typeof filtered>()
    for (const a of filtered) {
      const slash = a.relativePath.lastIndexOf('/')
      const folder = slash >= 0 ? a.relativePath.slice(0, slash) : '(root)'
      const bucket = map.get(folder)
      if (bucket) bucket.push(a)
      else map.set(folder, [a])
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === '(root)') return -1
      if (b === '(root)') return 1
      return a.localeCompare(b)
    })
  }, [filtered])

  const selected = selectedPath
    ? assets.find((a) => a.relativePath === selectedPath)
    : null

  const setViewMode = (next: 'grid' | 'list') => {
    setView(next)
    void saveWorkspace({
      preferences: {
        ...prefs,
        projectView: next,
      },
    })
  }

  const setThumb = (next: 's' | 'm' | 'l') => {
    setThumbSize(next)
    void saveWorkspace({
      preferences: {
        ...prefs,
        thumbnailSize: next === 's' ? 48 : next === 'l' ? 96 : 64,
      },
    })
  }

  const toggleFolder = (folder: string) => {
    setCollapsed((c) => ({ ...c, [folder]: !c[folder] }))
  }

  const onDragStart = (e: DragEvent, path: string) => {
    e.dataTransfer.setData('application/x-playdate-asset', path)
    e.dataTransfer.effectAllowed = 'copy'
  }

  const showZoom = (e: MouseEvent<HTMLElement>, a: (typeof assets)[number]) => {
    const thumb = e.currentTarget.querySelector('.asset-thumb')
    const rect = (thumb ?? e.currentTarget).getBoundingClientRect()
    setZoom({
      asset: a,
      x: rect.right + 10,
      y: rect.top,
    })
  }

  return (
    <div className="panel-root project-panel">
      <div className="panel-toolbar project-toolbar">
        <input
          className="search-input"
          placeholder="Search assets…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="view-toggle" role="group" aria-label="View mode">
          <IconButton
            icon={SquaresFour}
            title="Icons"
            active={view === 'grid'}
            onClick={() => setViewMode('grid')}
          />
          <IconButton
            icon={List}
            title="List"
            active={view === 'list'}
            onClick={() => setViewMode('list')}
          />
        </div>
      </div>
      <div className="filter-row">
        {KIND_FILTERS.map((k) => (
          <button
            key={k}
            type="button"
            className={`chip${kind === k ? ' is-active' : ''}`}
            onClick={() => setKind(k)}
          >
            {k}
          </button>
        ))}
        {view === 'grid' && (
          <div className="thumb-size" role="group" aria-label="Thumbnail size">
            {(['s', 'm', 'l'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`chip${thumbSize === s ? ' is-active' : ''}`}
                onClick={() => setThumb(s)}
                title={`Thumb ${s.toUpperCase()}`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        className={`asset-browser asset-browser--${view} asset-browser--thumb-${thumbSize}`}
      >
        {folders.map(([folder, items]) => {
          const isOpen = query ? true : !collapsed[folder]
          const label = folder === '(root)' ? '/' : folder
          return (
            <section key={folder} className="asset-folder">
              <button
                type="button"
                className="asset-folder-header"
                onClick={() => toggleFolder(folder)}
                aria-expanded={isOpen}
              >
                {isOpen ? (
                  <CaretDown size={12} weight="bold" />
                ) : (
                  <CaretRight size={12} weight="bold" />
                )}
                <FolderOpen size={14} weight="duotone" />
                <span className="asset-folder-name">{label}</span>
                <span className="asset-folder-count">{items.length}</span>
              </button>
              {isOpen && (
                <div className="asset-folder-items">
                  {items.map((a) => {
                    const fileName =
                      a.relativePath.split('/').pop() ?? a.basePath
                    return (
                      <button
                        key={a.relativePath}
                        type="button"
                        className={`asset-card${selectedPath === a.relativePath ? ' is-active' : ''}`}
                        draggable
                        onDragStart={(e) => onDragStart(e, a.relativePath)}
                        onClick={() => setSelectedPath(a.relativePath)}
                        onDoubleClick={() => addFromAsset(a)}
                        onMouseEnter={(e) => showZoom(e, a)}
                        onMouseLeave={() => setZoom(null)}
                        title={a.relativePath}
                      >
                        <div className="asset-thumb checker">
                          {a.extension !== 'fnt' ? (
                            <img src={a.previewUrl} alt="" draggable={false} />
                          ) : (
                            <span className="font-sample">Aa</span>
                          )}
                        </div>
                        <div className="asset-card-meta">
                          <span className="asset-card-name">{fileName}</span>
                          <span className="asset-card-desc">
                            {describeAsset(a)}
                          </span>
                        </div>
                        <span className={`asset-card-kind kind kind-${a.kind}`}>
                          {a.kind}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
          )
        })}
        {filtered.length === 0 && <p className="empty">No assets</p>}
      </div>
      {selected && (
        <div className="asset-details">
          <div className="asset-details-thumb checker">
            {selected.extension !== 'fnt' ? (
              <img src={selected.previewUrl} alt="" />
            ) : (
              <span className="font-sample lg">Aa</span>
            )}
          </div>
          <div>
            <div className="mono">{selected.relativePath}</div>
            <div className="hint">{describeAsset(selected)}</div>
            <div className="hint">base: {selected.basePath}</div>
            <button
              type="button"
              className="primary sm"
              onClick={() => addFromAsset(selected)}
            >
              Add to Scene
            </button>
          </div>
        </div>
      )}
      {zoom && (
        <AssetZoomLens asset={zoom.asset} x={zoom.x} y={zoom.y} />
      )}
    </div>
  )
}

export function InspectorPanel() {
  const {
    selected,
    selectedNodes,
    selectedIds,
    patchNode,
    assets,
    scene,
    setNodeStates,
    activeState,
  } = useEditorContext()
  if (!selected) {
    return <p className="empty pad">Select a node</p>
  }
  const multi = selectedNodes.length > 1
  const locked = selected.locked
  const visibleInActive = nodeVisibleInState(selected, activeState)
  const membershipValue = (() => {
    if (!multi) return selected.states
    const first = selectedNodes[0]!.states
    const same = selectedNodes.every(
      (n) =>
        n.states.length === first.length &&
        n.states.every((s, i) => s === first[i]),
    )
    return same ? first : []
  })()

  const setSize = (w: number, h: number) => {
    const left = selected.x - selected.anchor.x * selected.w
    const top = selected.y - selected.anchor.y * selected.h
    const nw = Math.max(1, w)
    const nh = Math.max(1, h)
    patchNode(
      selected.id,
      {
        w: nw,
        h: nh,
        x: left + selected.anchor.x * nw,
        y: top + selected.anchor.y * nh,
      },
      'Resize',
    )
  }

  const setAnchor = (anchor: { x: number; y: number }) => {
    const left = selected.x - selected.anchor.x * selected.w
    const top = selected.y - selected.anchor.y * selected.h
    patchNode(
      selected.id,
      {
        anchor,
        x: left + anchor.x * selected.w,
        y: top + anchor.y * selected.h,
      },
      'Anchor',
    )
  }

  return (
    <div className="panel-root inspector">
      <div className="inspector-type">
        <span className={`kind kind-${selected.type}`}>{selected.type}</span>
        {multi && <span className="hint">{selectedNodes.length} selected</span>}
      </div>

      {!visibleInActive && (
        <p className="hint pad-x inspector-state-hint">
          Not visible in state &ldquo;{activeState}&rdquo;
        </p>
      )}

      <p className="section-label">States</p>
      <StateMembership
        sceneStates={scene.states}
        value={membershipValue}
        disabled={locked}
        onChange={(next) => setNodeStates(selectedIds, next)}
      />
      <p className="hint">Empty / All = visible in every state</p>

      <label className="field">
        <span>Name</span>
        <input
          value={selected.name}
          disabled={locked}
          onChange={(e) =>
            patchNode(selected.id, { name: e.target.value }, 'Rename')
          }
        />
      </label>

      <p className="section-label">Transform</p>
      <div className="field-row">
        <NumericField
          label="X"
          value={Math.round(selected.x - selected.anchor.x * selected.w)}
          disabled={locked}
          onChange={(left) => {
            const top = selected.y - selected.anchor.y * selected.h
            patchNode(
              selected.id,
              {
                x: left + selected.anchor.x * selected.w,
                y: top + selected.anchor.y * selected.h,
              },
              'Move',
            )
          }}
        />
        <NumericField
          label="Y"
          value={Math.round(selected.y - selected.anchor.y * selected.h)}
          disabled={locked}
          onChange={(top) => {
            const left = selected.x - selected.anchor.x * selected.w
            patchNode(
              selected.id,
              {
                x: left + selected.anchor.x * selected.w,
                y: top + selected.anchor.y * selected.h,
              },
              'Move',
            )
          }}
        />
      </div>
      <div className="field-row">
        <NumericField
          label="W"
          value={selected.w}
          min={1}
          disabled={locked}
          onChange={(w) => setSize(w, selected.h)}
        />
        <NumericField
          label="H"
          value={selected.h}
          min={1}
          disabled={locked}
          onChange={(h) => setSize(selected.w, h)}
        />
      </div>
      <div className="inspector-anchor-row">
        <div>
          <p className="section-label" style={{ marginTop: 0 }}>
            Anchor
          </p>
          <AnchorPicker
            value={selected.anchor}
            disabled={locked}
            onChange={setAnchor}
          />
        </div>
        <NumericField
          label="Rotation °"
          value={selected.rotation ?? 0}
          disabled={locked}
          onChange={(rotation) =>
            patchNode(selected.id, { rotation }, 'Rotate')
          }
        />
      </div>
      <p className="hint">[ ] rotate 15° · Shift+[ ] = 1°</p>

      {selected.type === 'text' && (
        <>
          <p className="section-label">Text</p>
          <label className="field">
            <span>Content</span>
            <textarea
              rows={3}
              disabled={locked}
              value={selected.text}
              onChange={(e) =>
                patchNode(selected.id, { text: e.target.value }, 'Edit text')
              }
            />
          </label>
          <p className="section-label">Font</p>
          <FontPicker
            value={selected.font}
            disabled={locked}
            onChange={(font) => patchNode(selected.id, { font }, 'Edit font')}
          />
          <NumericField
            label="Scale"
            value={selected.scale ?? 1}
            min={1}
            max={8}
            step={1}
            disabled={locked}
            onChange={(raw) => {
              const scale = Math.max(1, Math.min(8, Math.floor(raw)))
              patchNode(
                selected.id,
                { scale: scale === 1 ? undefined : scale },
                'Text scale',
              )
            }}
          />
          <p className="hint">Integer nearest-neighbor (1–8). Prefer W/H multiples of scale.</p>
          <ChoiceTiles
            label="Align"
            value={selected.align}
            disabled={locked}
            columns={3}
            options={(
              ['left', 'center', 'right'] as const
            ).map((align) => ({
              value: align,
              label: align,
              preview: <AlignPreview align={align} />,
            }))}
            onChange={(align) => patchNode(selected.id, { align }, 'Align')}
          />
          <ChoiceTiles
            label="Vertical"
            value={selected.valign ?? 'top'}
            disabled={locked}
            columns={3}
            options={(
              ['top', 'middle', 'bottom'] as const
            ).map((valign) => ({
              value: valign,
              label: valign,
              preview: <VAlignPreview valign={valign} />,
            }))}
            onChange={(valign) =>
              patchNode(selected.id, { valign }, 'VAlign')
            }
          />
          <p className="section-label">Effects</p>
          <label className="field field-check">
            <span>Outline</span>
            <input
              type="checkbox"
              disabled={locked}
              checked={!!selected.outline}
              onChange={(e) =>
                patchNode(
                  selected.id,
                  {
                    // Default: white inner + black outer (classic 1-bit UI).
                    outline: e.target.checked
                      ? {
                          width: selected.outline?.width ?? 1,
                          color: selected.outline?.color ?? 'white',
                          outer:
                            selected.outline?.outer !== undefined
                              ? selected.outline.outer
                              : { width: 1, color: 'black' },
                        }
                      : null,
                  },
                  'Outline',
                )
              }
            />
          </label>
          {selected.outline && (
            <>
              <NumericField
                label="Inner width"
                value={selected.outline.width}
                min={1}
                disabled={locked}
                onChange={(width) =>
                  patchNode(
                    selected.id,
                    {
                      outline: {
                        ...selected.outline!,
                        width: Math.max(1, Math.round(width)),
                      },
                    },
                    'Outline width',
                  )
                }
              />
              <ChoiceTiles
                label="Inner ink"
                value={selected.outline.color}
                disabled={locked}
                columns={2}
                options={(['black', 'white'] as Ink[]).map((color) => ({
                  value: color,
                  label: color,
                  preview: <InkSwatch color={color} />,
                }))}
                onChange={(color) =>
                  patchNode(
                    selected.id,
                    { outline: { ...selected.outline!, color } },
                    'Outline color',
                  )
                }
              />
              <label className="field field-check">
                <span>Outer outline</span>
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={!!selected.outline.outer}
                  onChange={(e) =>
                    patchNode(
                      selected.id,
                      {
                        outline: {
                          ...selected.outline!,
                          outer: e.target.checked
                            ? {
                                width: selected.outline!.outer?.width ?? 1,
                                color:
                                  selected.outline!.outer?.color ?? 'black',
                              }
                            : null,
                        },
                      },
                      'Outer outline',
                    )
                  }
                />
              </label>
              {selected.outline.outer && (
                <>
                  <NumericField
                    label="Outer width"
                    value={selected.outline.outer.width}
                    min={1}
                    disabled={locked}
                    onChange={(width) =>
                      patchNode(
                        selected.id,
                        {
                          outline: {
                            ...selected.outline!,
                            outer: {
                              ...selected.outline!.outer!,
                              width: Math.max(1, Math.round(width)),
                            },
                          },
                        },
                        'Outer outline width',
                      )
                    }
                  />
                  <ChoiceTiles
                    label="Outer ink"
                    value={selected.outline.outer.color}
                    disabled={locked}
                    columns={2}
                    options={(['black', 'white'] as Ink[]).map((color) => ({
                      value: color,
                      label: color,
                      preview: <InkSwatch color={color} />,
                    }))}
                    onChange={(color) =>
                      patchNode(
                        selected.id,
                        {
                          outline: {
                            ...selected.outline!,
                            outer: {
                              ...selected.outline!.outer!,
                              color,
                            },
                          },
                        },
                        'Outer outline color',
                      )
                    }
                  />
                </>
              )}
            </>
          )}
          <label className="field field-check">
            <span>Shadow</span>
            <input
              type="checkbox"
              disabled={locked}
              checked={!!selected.shadow}
              onChange={(e) =>
                patchNode(
                  selected.id,
                  {
                    shadow: e.target.checked
                      ? {
                          x: selected.shadow?.x ?? 1,
                          y: selected.shadow?.y ?? 1,
                          color: selected.shadow?.color ?? 'black',
                        }
                      : null,
                  },
                  'Shadow',
                )
              }
            />
          </label>
          {selected.shadow && (
            <>
              <div className="field-row">
                <NumericField
                  label="X"
                  value={selected.shadow.x}
                  disabled={locked}
                  onChange={(x) =>
                    patchNode(
                      selected.id,
                      { shadow: { ...selected.shadow!, x: Math.round(x) } },
                      'Shadow X',
                    )
                  }
                />
                <NumericField
                  label="Y"
                  value={selected.shadow.y}
                  disabled={locked}
                  onChange={(y) =>
                    patchNode(
                      selected.id,
                      { shadow: { ...selected.shadow!, y: Math.round(y) } },
                      'Shadow Y',
                    )
                  }
                />
              </div>
              <ChoiceTiles
                label="Shadow ink"
                value={selected.shadow.color}
                disabled={locked}
                columns={2}
                options={(['black', 'white'] as Ink[]).map((color) => ({
                  value: color,
                  label: color,
                  preview: <InkSwatch color={color} />,
                }))}
                onChange={(color) =>
                  patchNode(
                    selected.id,
                    { shadow: { ...selected.shadow!, color } },
                    'Shadow color',
                  )
                }
              />
            </>
          )}
        </>
      )}

      {selected.type === 'panel' && (
        <>
          <p className="section-label">Panel / 9-slice</p>
          <AssetPicker
            value={selected.asset}
            disabled={locked}
            kinds={['slice']}
            onChange={(asset) => patchNode(selected.id, { asset }, 'Asset')}
          />
          <p className="section-label">Slice</p>
          <div className="field-row fours">
            {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
              <NumericField
                key={side}
                label={side[0]!.toUpperCase()}
                value={selected.slice[side]}
                min={0}
                disabled={locked}
                onChange={(n) =>
                  patchNode(
                    selected.id,
                    {
                      slice: {
                        ...selected.slice,
                        [side]: Math.max(0, Math.round(n)),
                      },
                    },
                    'Slice',
                  )
                }
              />
            ))}
          </div>
        </>
      )}

      {selected.type === 'frame' && (
        <>
          <p className="section-label">Frame</p>
          <ChoiceTiles
            value={selected.style}
            disabled={locked}
            columns={3}
            options={(['line', 'double', 'ticks'] as FrameStyle[]).map(
              (style) => ({
                value: style,
                label: style,
                preview: <FrameStylePreview style={style} />,
              }),
            )}
            onChange={(style) => patchNode(selected.id, { style }, 'Style')}
          />
          <NumericField
            label="Thickness"
            value={selected.thickness}
            min={1}
            disabled={locked}
            onChange={(thickness) =>
              patchNode(
                selected.id,
                { thickness: Math.max(1, Math.round(thickness)) },
                'Thickness',
              )
            }
          />
        </>
      )}

      {selected.type === 'shape' && (
        <ShapePropertyEditors
          node={selected}
          locked={locked}
          patch={(patch, label) => patchNode(selected.id, patch, label)}
        />
      )}

      {selected.type === 'image' && (
        <>
          <p className="section-label">Image</p>
          <AssetPicker
            value={selected.asset}
            disabled={locked}
            kinds={['image', 'table']}
            onChange={(assetPath) => {
              const table = assets.find(
                (a) => a.basePath === assetPath && a.kind === 'table',
              )
              const any = assets.find((a) => a.basePath === assetPath)
              const w = table?.cell?.w ?? any?.pixelWidth
              const h = table?.cell?.h ?? any?.pixelHeight
              patchNode(
                selected.id,
                {
                  asset: assetPath,
                  ...(w && h ? { w, h } : {}),
                  ...(table
                    ? {
                        fps:
                          selected.fps && selected.fps > 0 ? selected.fps : 10,
                        loop: selected.loop !== false,
                      }
                    : {}),
                },
                'Asset',
              )
            }}
          />
          {assets.some(
            (a) => a.basePath === selected.asset && a.kind === 'table',
          ) && (
            <>
              <p className="section-label">Animation</p>
              <div className="field-row">
                <NumericField
                  label="fps"
                  value={selected.fps ?? 0}
                  disabled={locked}
                  onChange={(fps) =>
                    patchNode(selected.id, { fps }, 'Anim fps')
                  }
                />
                <NumericField
                  label="frame"
                  value={selected.frame ?? selected.frameStart ?? 1}
                  disabled={locked}
                  min={1}
                  onChange={(frame) =>
                    patchNode(selected.id, { frame }, 'Anim frame')
                  }
                />
              </div>
              <div className="field-row">
                <NumericField
                  label="start"
                  value={selected.frameStart ?? 1}
                  disabled={locked}
                  min={1}
                  onChange={(frameStart) =>
                    patchNode(selected.id, { frameStart }, 'Anim start')
                  }
                />
                <NumericField
                  label="end"
                  value={selected.frameEnd ?? 0}
                  disabled={locked}
                  min={0}
                  onChange={(frameEnd) =>
                    patchNode(
                      selected.id,
                      { frameEnd: frameEnd > 0 ? frameEnd : undefined },
                      'Anim end',
                    )
                  }
                />
              </div>
              <label className="field-check">
                <input
                  type="checkbox"
                  checked={selected.loop !== false}
                  disabled={locked}
                  onChange={(e) =>
                    patchNode(
                      selected.id,
                      { loop: e.target.checked },
                      'Anim loop',
                    )
                  }
                />
                Loop
              </label>
              <p className="hint">
                fps 0 = static frame. Needs Ui.update(dt) on device.
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}

export function ExportPanel() {
  const { exportText, exportFormat, setExportFormat, scene } =
    useEditorContext()
  return (
    <div className="panel-root">
      <div className="seg">
        <button
          type="button"
          className={exportFormat === 'json' ? 'is-active' : ''}
          onClick={() => setExportFormat('json')}
        >
          JSON
        </button>
        <button
          type="button"
          className={exportFormat === 'lua' ? 'is-active' : ''}
          onClick={() => setExportFormat('lua')}
        >
          Lua
        </button>
      </div>
      <p className="hint mono">
        playdate/scenes/{scene.name}.scene.json → Source/scenes/{scene.name}.lua
      </p>
      <pre className="export-pre">{exportText}</pre>
      <button
        type="button"
        className="primary"
        onClick={() => void navigator.clipboard.writeText(exportText)}
      >
        Copy
      </button>
    </div>
  )
}

export function ConsolePanel() {
  const { console: entries } = useEditorContext()
  return (
    <div className="panel-root console-panel">
      {entries.length === 0 && <p className="empty">No messages</p>}
      <ul className="console-list">
        {entries.map((e) => (
          <li key={e.id} className={`console-line console-${e.severity}`}>
            <span className="console-sev">{e.severity}</span>
            <span>{e.message}</span>
            {e.path && <span className="mono dim">{e.path}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
