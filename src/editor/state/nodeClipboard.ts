import type { SceneNode } from '../../core/scene/types'
import { findNode, isDescendant, regenerateIds } from './nodeTree'

/**
 * Deep-clone selected roots for an in-memory clipboard.
 * If both a group and one of its descendants are selected, keep only the group.
 */
export function cloneSelectionForClipboard(
  nodes: SceneNode[],
  selectedIds: readonly string[],
): SceneNode[] {
  const selected = new Set(selectedIds)
  const out: SceneNode[] = []
  for (const id of selectedIds) {
    let underSelectedAncestor = false
    for (const sid of selected) {
      if (sid !== id && isDescendant(nodes, sid, id)) {
        underSelectedAncestor = true
        break
      }
    }
    if (underSelectedAncestor) continue
    const n = findNode(nodes, id)
    if (n) out.push(structuredClone(n))
  }
  return out
}

/** Fresh IDs + scene-space nudge for paste / duplicate-style insert. */
export function materializePasteNodes(
  clipboard: readonly SceneNode[],
  nudge = 8,
): SceneNode[] {
  return clipboard.map((n) => {
    const copy = regenerateIds(structuredClone(n))
    copy.x += nudge
    copy.y += nudge
    return copy
  })
}
