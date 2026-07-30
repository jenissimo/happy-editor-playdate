import { describe, expect, test } from 'bun:test'
import { createEmptyScene, createTextNode } from '../../core/scene/types'
import { HistoryStack } from './history'

describe('HistoryStack', () => {
  test('undo and redo restore scenes', () => {
    let scene = createEmptyScene('test')
    const history = new HistoryStack()
    const setScene = (s: typeof scene) => {
      scene = s
    }

    history.apply(
      () => scene,
      setScene,
      (s) => ({
        ...s,
        nodes: [...s.nodes, createTextNode({ text: 'Hello', x: 10, y: 10 })],
      }),
      'Add text',
    )
    expect(scene.nodes).toHaveLength(1)
    expect(history.canUndo).toBe(true)

    history.undo()
    expect(scene.nodes).toHaveLength(0)
    expect(history.canRedo).toBe(true)

    history.redo()
    expect(scene.nodes).toHaveLength(1)
    expect(scene.nodes[0]?.type).toBe('text')
  })
})
