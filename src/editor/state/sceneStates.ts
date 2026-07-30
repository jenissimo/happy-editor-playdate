import type { Scene, SceneNode } from '../../core/scene/types'

/** Map every node (including group children) through `fn`. */
export function mapAllNodes(
  nodes: SceneNode[],
  fn: (n: SceneNode) => SceneNode,
): SceneNode[] {
  return nodes.map((n) => {
    const next = fn(n)
    if (next.type === 'group') {
      return { ...next, children: mapAllNodes(next.children, fn) }
    }
    return next
  })
}

export function sanitizeStateName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
}

/** Unique name among `existing`; appends -2, -3, … on conflict. */
export function uniqueStateName(
  existing: string[],
  preferred: string,
): string {
  const base = sanitizeStateName(preferred) || 'state'
  if (!existing.includes(base)) return base
  let n = 2
  while (existing.includes(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

export function suggestNextStateName(states: string[]): string {
  return uniqueStateName(states, `state-${states.length + 1}`)
}

export function addSceneState(scene: Scene, name?: string): Scene {
  const nextName = uniqueStateName(
    scene.states,
    name?.trim() ? name : suggestNextStateName(scene.states),
  )
  return {
    ...scene,
    states: [...scene.states, nextName],
  }
}

export function renameSceneState(
  scene: Scene,
  from: string,
  toRaw: string,
): Scene {
  if (!scene.states.includes(from)) return scene
  const to = uniqueStateName(
    scene.states.filter((s) => s !== from),
    toRaw,
  )
  if (to === from) return scene
  return {
    ...scene,
    states: scene.states.map((s) => (s === from ? to : s)),
    defaultState: scene.defaultState === from ? to : scene.defaultState,
    nodes: mapAllNodes(scene.nodes, (n) => ({
      ...n,
      states: n.states.map((s) => (s === from ? to : s)),
    })),
  }
}

export function removeSceneState(scene: Scene, name: string): Scene {
  if (scene.states.length <= 1) return scene
  if (!scene.states.includes(name)) return scene
  const states = scene.states.filter((s) => s !== name)
  const defaultState =
    scene.defaultState === name ? states[0]! : scene.defaultState
  return {
    ...scene,
    states,
    defaultState,
    nodes: mapAllNodes(scene.nodes, (n) => {
      const next = n.states.filter((s) => s !== name)
      return { ...n, states: next }
    }),
  }
}

export function setDefaultState(scene: Scene, name: string): Scene {
  if (!scene.states.includes(name)) return scene
  return { ...scene, defaultState: name }
}

/** Set `states` on the given node ids (empty = all). */
export function setNodesStates(
  scene: Scene,
  ids: string[],
  states: string[],
): Scene {
  const idSet = new Set(ids)
  const cleaned = [
    ...new Set(states.filter((s) => scene.states.includes(s))),
  ]
  return {
    ...scene,
    nodes: mapAllNodes(scene.nodes, (n) =>
      idSet.has(n.id) ? { ...n, states: cleaned } : n,
    ),
  }
}

/** Toggle one scene state in a node's membership list. */
export function toggleNodeStateMembership(
  current: string[],
  sceneStates: string[],
  state: string,
): string[] {
  if (!sceneStates.includes(state)) return current
  // Empty = all → switching to "only this" when adding first restriction
  // from All: if current is empty (all), picking a state means "only that state"
  // unless we interpret toggle on All separately.
  if (current.length === 0) {
    // Was "all": selecting one state restricts to that single state.
    return [state]
  }
  if (current.includes(state)) {
    const next = current.filter((s) => s !== state)
    // No named states left → all
    return next
  }
  return [...current, state]
}

export function resolveActiveState(
  scene: Scene,
  preferred: string | undefined | null,
): string {
  if (preferred && scene.states.includes(preferred)) return preferred
  if (scene.states.includes(scene.defaultState)) return scene.defaultState
  return scene.states[0] ?? 'default'
}

export function cycleSceneState(
  states: string[],
  current: string,
  delta: 1 | -1,
): string {
  if (states.length === 0) return current
  const idx = states.indexOf(current)
  const i = idx < 0 ? 0 : idx
  const next = (i + delta + states.length) % states.length
  return states[next]!
}

export function nodeVisibleInState(
  node: { states: string[]; visible?: boolean },
  state: string,
): boolean {
  if (node.visible === false) return false
  if (!node.states || node.states.length === 0) return true
  return node.states.includes(state)
}
