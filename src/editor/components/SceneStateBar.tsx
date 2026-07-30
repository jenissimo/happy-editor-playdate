import { useState, type MouseEvent } from 'react'
import { Plus, DotsThreeVertical } from '../icons'
import { useEditorContext } from '../state/EditorContext'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'

/**
 * Always-visible scene state strip: switch preview, add, rename/default/delete.
 */
export function SceneStateBar() {
  const {
    scene,
    activeState,
    setActiveState,
    addSceneState,
    renameSceneState,
    removeSceneState,
    setDefaultState,
  } = useEditorContext()

  const [menu, setMenu] = useState<{
    x: number
    y: number
    state: string
  } | null>(null)

  const openMenu = (e: MouseEvent, state: string) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, state })
  }

  const menuItems = (state: string): ContextMenuItem[] => [
    {
      id: 'rename',
      label: 'Rename…',
      run: () => {
        const next = window.prompt('Rename state:', state)
        if (next == null) return
        const trimmed = next.trim()
        if (!trimmed || trimmed === state) return
        renameSceneState(state, trimmed)
      },
    },
    {
      id: 'default',
      label:
        scene.defaultState === state
          ? 'Default state'
          : 'Set as default',
      disabled: scene.defaultState === state,
      run: () => setDefaultState(state),
    },
    { kind: 'separator' },
    {
      id: 'delete',
      label: 'Delete',
      danger: true,
      disabled: scene.states.length <= 1,
      run: () => {
        if (scene.states.length <= 1) return
        if (
          !window.confirm(
            `Delete state "${state}"? Nodes that only used it will become visible in all remaining states (or lose that membership).`,
          )
        ) {
          return
        }
        removeSceneState(state)
      },
    },
  ]

  return (
    <>
      <div className="seg scene-state-seg" role="group" aria-label="Scene state">
        {scene.states.map((s) => (
          <button
            key={s}
            type="button"
            className={activeState === s ? 'is-active' : ''}
            title={
              scene.defaultState === s
                ? `State: ${s} (default)`
                : `State: ${s}`
            }
            onClick={() => setActiveState(s)}
            onContextMenu={(e) => openMenu(e, s)}
          >
            {s}
            {scene.defaultState === s ? '*' : ''}
          </button>
        ))}
        <button
          type="button"
          className="scene-state-add"
          title="Add state"
          aria-label="Add state"
          onClick={() => addSceneState()}
        >
          <Plus size={12} weight="bold" />
        </button>
        {scene.states.length > 0 && (
          <button
            type="button"
            className="scene-state-more"
            title="State options"
            aria-label="State options"
            onClick={(e) => openMenu(e, activeState)}
          >
            <DotsThreeVertical size={14} weight="bold" />
          </button>
        )}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.state)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}
