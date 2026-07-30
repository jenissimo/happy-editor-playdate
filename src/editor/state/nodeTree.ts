import type { GroupNode, SceneNode } from '../../core/scene/types'

export type DropPlace = 'before' | 'after' | 'into'

export function flattenNodes(nodes: SceneNode[]): SceneNode[] {
  const out: SceneNode[] = []
  for (const n of nodes) {
    out.push(n)
    if (n.type === 'group') out.push(...flattenNodes(n.children))
  }
  return out
}

export function findNode(nodes: SceneNode[], id: string): SceneNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.type === 'group') {
      const found = findNode(n.children, id)
      if (found) return found
    }
  }
  return null
}

export function isDescendant(
  nodes: SceneNode[],
  ancestorId: string,
  maybeChildId: string,
): boolean {
  const anc = findNode(nodes, ancestorId)
  if (!anc || anc.type !== 'group') return false
  return findNode(anc.children, maybeChildId) != null
}

/** Remove node by id from any depth; returns the extracted node (if any). */
export function extractNode(
  nodes: SceneNode[],
  id: string,
): { nodes: SceneNode[]; extracted: SceneNode | null } {
  let extracted: SceneNode | null = null
  const next: SceneNode[] = []
  for (const n of nodes) {
    if (n.id === id) {
      extracted = n
      continue
    }
    if (n.type === 'group') {
      const inner = extractNode(n.children, id)
      if (inner.extracted) extracted = inner.extracted
      next.push({ ...n, children: inner.nodes })
    } else {
      next.push(n)
    }
  }
  return { nodes: next, extracted }
}

function insertInList(
  list: SceneNode[],
  targetId: string,
  place: 'before' | 'after',
  item: SceneNode,
): SceneNode[] | null {
  const idx = list.findIndex((n) => n.id === targetId)
  if (idx < 0) return null
  const out = [...list]
  out.splice(place === 'after' ? idx + 1 : idx, 0, item)
  return out
}

function insertIntoTree(
  nodes: SceneNode[],
  targetId: string,
  place: DropPlace,
  item: SceneNode,
): SceneNode[] | null {
  if (place === 'into') {
    let found = false
    const mapped = nodes.map((n) => {
      if (n.id === targetId && n.type === 'group') {
        found = true
        return { ...n, children: [...n.children, item] }
      }
      if (n.type === 'group') {
        const kids = insertIntoTree(n.children, targetId, place, item)
        if (kids) {
          found = true
          return { ...n, children: kids }
        }
      }
      return n
    })
    return found ? mapped : null
  }

  const atRoot = insertInList(nodes, targetId, place, item)
  if (atRoot) return atRoot

  let found = false
  const mapped = nodes.map((n) => {
    if (n.type !== 'group') return n
    const kids = insertIntoTree(n.children, targetId, place, item)
    if (kids) {
      found = true
      return { ...n, children: kids }
    }
    return n
  })
  return found ? mapped : null
}

/**
 * Move `fromId` relative to `toId`.
 * `place` is in **array** order (draw order): before = lower z, after = higher z.
 */
export function moveNode(
  nodes: SceneNode[],
  fromId: string,
  toId: string,
  place: DropPlace,
): SceneNode[] {
  if (fromId === toId) return nodes
  if (place === 'into' && isDescendant(nodes, fromId, toId)) return nodes
  if (isDescendant(nodes, fromId, toId)) return nodes

  const { nodes: without, extracted } = extractNode(nodes, fromId)
  if (!extracted) return nodes

  const target = findNode(without, toId)
  if (!target) return nodes
  if (place === 'into' && target.type !== 'group') return nodes

  const inserted = insertIntoTree(without, toId, place, extracted)
  return inserted ?? nodes
}

export type HierarchyRow = {
  node: SceneNode
  depth: number
  /** Parent group id, or null at root */
  parentId: string | null
}

/**
 * Visual rows: each sibling list is reversed so higher z-order appears first.
 * Collapsed groups hide their descendants.
 */
export function buildHierarchyRows(
  nodes: SceneNode[],
  collapsed: ReadonlySet<string>,
  depth = 0,
  parentId: string | null = null,
): HierarchyRow[] {
  const rows: HierarchyRow[] = []
  for (const n of [...nodes].reverse()) {
    rows.push({ node: n, depth, parentId })
    if (n.type === 'group' && !collapsed.has(n.id) && n.children.length > 0) {
      rows.push(...buildHierarchyRows(n.children, collapsed, depth + 1, n.id))
    }
  }
  return rows
}

/** Map a visual slot (above/below a row in the reversed list) to array place. */
export function visualPlaceToArrayPlace(
  visual: 'before' | 'after',
): 'before' | 'after' {
  // Visual list is reversed vs draw order.
  return visual === 'before' ? 'after' : 'before'
}

export function countNodes(nodes: SceneNode[]): number {
  return flattenNodes(nodes).length
}

export function regenerateIds(node: SceneNode): SceneNode {
  const id = crypto.randomUUID()
  if (node.type === 'group') {
    return {
      ...node,
      id,
      children: node.children.map(regenerateIds),
    } satisfies GroupNode
  }
  return { ...node, id }
}
