import { describe, expect, test } from 'bun:test'
import { createEmptyScene, createTextNode } from '../../core/scene/types'
import {
  addSceneState,
  cycleSceneState,
  removeSceneState,
  renameSceneState,
  resolveActiveState,
  setDefaultState,
  setNodesStates,
  toggleNodeStateMembership,
  uniqueStateName,
} from './sceneStates'

describe('sceneStates', () => {
  test('uniqueStateName suffixes on conflict', () => {
    expect(uniqueStateName(['default'], 'default')).toBe('default-2')
    expect(uniqueStateName(['default', 'default-2'], 'default')).toBe(
      'default-3',
    )
  })

  test('addSceneState appends unique name', () => {
    const s = addSceneState(createEmptyScene('x'))
    expect(s.states).toEqual(['default', 'state-2'])
  })

  test('rename cascades to defaultState and nodes', () => {
    let s = createEmptyScene('x')
    s = addSceneState(s, 'confirm')
    const node = createTextNode({ text: 'hi' })
    node.states = ['confirm']
    s = { ...s, nodes: [node], defaultState: 'confirm' }
    s = renameSceneState(s, 'confirm', 'quit')
    expect(s.states).toEqual(['default', 'quit'])
    expect(s.defaultState).toBe('quit')
    expect(s.nodes[0]!.states).toEqual(['quit'])
  })

  test('removeSceneState clears membership and reassigns default', () => {
    let s = createEmptyScene('x')
    s = addSceneState(s, 'hurt')
    const node = createTextNode()
    node.states = ['default', 'hurt']
    s = { ...s, nodes: [node], defaultState: 'hurt' }
    s = removeSceneState(s, 'hurt')
    expect(s.states).toEqual(['default'])
    expect(s.defaultState).toBe('default')
    expect(s.nodes[0]!.states).toEqual(['default'])
  })

  test('remove refuses last state', () => {
    const s = createEmptyScene('x')
    expect(removeSceneState(s, 'default')).toBe(s)
  })

  test('setNodesStates empty means all', () => {
    let s = createEmptyScene('x')
    s = addSceneState(s, 'a')
    const n = createTextNode()
    n.states = ['a']
    s = { ...s, nodes: [n] }
    s = setNodesStates(s, [n.id], [])
    expect(s.nodes[0]!.states).toEqual([])
  })

  test('toggle membership from all restricts; clearing returns all', () => {
    expect(toggleNodeStateMembership([], ['a', 'b'], 'a')).toEqual(['a'])
    expect(toggleNodeStateMembership(['a'], ['a', 'b'], 'a')).toEqual([])
    expect(toggleNodeStateMembership(['a'], ['a', 'b'], 'b')).toEqual([
      'a',
      'b',
    ])
  })

  test('setDefaultState / resolve / cycle', () => {
    let s = createEmptyScene('x')
    s = addSceneState(s, 'confirm')
    s = setDefaultState(s, 'confirm')
    expect(s.defaultState).toBe('confirm')
    expect(resolveActiveState(s, 'missing')).toBe('confirm')
    expect(cycleSceneState(s.states, 'default', 1)).toBe('confirm')
    expect(cycleSceneState(s.states, 'confirm', 1)).toBe('default')
  })
})
