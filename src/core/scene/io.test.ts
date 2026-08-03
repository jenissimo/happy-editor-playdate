import { describe, expect, test } from 'bun:test'
import {
  getDefaultSceneValidator,
  validateSceneObject,
} from './io.ts'

const validScene = {
  version: 1,
  id: 'validator-test',
  name: 'validator-test',
  width: 400,
  height: 240,
  states: ['default'],
  defaultState: 'default',
  nodes: [],
}

describe('scene validation', () => {
  test('reuses the default compiled validator', () => {
    expect(getDefaultSceneValidator()).toBe(getDefaultSceneValidator())
    expect(validateSceneObject(validScene)).toEqual([])
  })

  test('continues to accept an explicitly injected validator', () => {
    const validate = Object.assign(() => false, {
      errors: [{ instancePath: '/name', message: 'must be unique' }],
    })

    expect(validateSceneObject(validScene, validate)).toEqual([
      {
        id: 'schema:/name',
        severity: 'error',
        message: '/name must be unique',
      },
    ])
  })
})
