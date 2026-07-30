import { describe, expect, test } from 'bun:test'
import {
  createGroupNode,
  createTextNode,
  type SceneNode,
} from '../../core/scene/types'
import {
  buildHierarchyRows,
  moveNode,
  visualPlaceToArrayPlace,
} from './nodeTree'

function ids(nodes: SceneNode[]): string[] {
  return nodes.map((n) => n.id)
}

describe('nodeTree', () => {
  test('visual place maps through reversed list', () => {
    expect(visualPlaceToArrayPlace('before')).toBe('after')
    expect(visualPlaceToArrayPlace('after')).toBe('before')
  })

  test('reorder siblings by array place', () => {
    const a = createTextNode({ id: 'a', name: 'A' })
    const b = createTextNode({ id: 'b', name: 'B' })
    const c = createTextNode({ id: 'c', name: 'C' })
    const next = moveNode([a, b, c], 'c', 'a', 'before')
    expect(ids(next)).toEqual(['c', 'a', 'b'])
  })

  test('nest into group', () => {
    const t = createTextNode({ id: 't', name: 'T' })
    const g = createGroupNode({ id: 'g', name: 'G', children: [] })
    const next = moveNode([t, g], 't', 'g', 'into')
    expect(next).toHaveLength(1)
    expect(next[0]?.type).toBe('group')
    if (next[0]?.type === 'group') {
      expect(ids(next[0].children)).toEqual(['t'])
    }
  })

  test('cannot nest group into its descendant', () => {
    const child = createGroupNode({ id: 'child', children: [] })
    const parent = createGroupNode({ id: 'parent', children: [child] })
    const next = moveNode([parent], 'parent', 'child', 'into')
    expect(next).toEqual([parent])
  })

  test('hierarchy rows reverse siblings and indent', () => {
    const a = createTextNode({ id: 'a' })
    const b = createTextNode({ id: 'b' })
    const g = createGroupNode({ id: 'g', children: [a] })
    const rows = buildHierarchyRows([b, g], new Set())
    expect(rows.map((r) => r.node.id)).toEqual(['g', 'a', 'b'])
    expect(rows[1]?.depth).toBe(1)
  })
})
