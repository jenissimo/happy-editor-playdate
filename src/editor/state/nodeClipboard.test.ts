import { describe, expect, test } from 'bun:test'
import {
  createGroupNode,
  createTextNode,
} from '../../core/scene/types'
import {
  cloneSelectionForClipboard,
  materializePasteNodes,
} from './nodeClipboard'

describe('nodeClipboard', () => {
  test('clones selected roots and skips descendants of selected groups', () => {
    const child = createTextNode({ id: 'child', name: 'Child', x: 10, y: 10 })
    const group = createGroupNode({
      id: 'group',
      name: 'Group',
      children: [child],
    })
    const other = createTextNode({ id: 'other', name: 'Other', x: 40, y: 40 })
    const scene = [group, other]

    const clipped = cloneSelectionForClipboard(scene, [
      'group',
      'child',
      'other',
    ])
    expect(clipped.map((n) => n.id)).toEqual(['group', 'other'])
    expect(clipped[0]).not.toBe(group)
    if (clipped[0]?.type === 'group') {
      expect(clipped[0].children[0]?.id).toBe('child')
    }
  })

  test('paste regenerates ids and nudges position', () => {
    const a = createTextNode({ id: 'a', name: 'A', x: 5, y: 7 })
    const [pasted] = materializePasteNodes([a], 8)
    expect(pasted).toBeDefined()
    expect(pasted!.id).not.toBe('a')
    expect(pasted!.x).toBe(13)
    expect(pasted!.y).toBe(15)
    expect(pasted!.name).toBe('A')
  })

  test('paste regenerates nested group child ids', () => {
    const child = createTextNode({ id: 'child', name: 'Child' })
    const group = createGroupNode({
      id: 'group',
      name: 'Group',
      children: [child],
    })
    const [pasted] = materializePasteNodes([group])
    expect(pasted?.type).toBe('group')
    if (pasted?.type === 'group') {
      expect(pasted.id).not.toBe('group')
      expect(pasted.children[0]?.id).not.toBe('child')
      expect(pasted.children[0]?.id).not.toBe(pasted.id)
    }
  })
})
