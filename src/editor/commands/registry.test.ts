import { describe, expect, test } from 'bun:test'
import { CommandRegistry, matchShortcut } from './registry'

describe('CommandRegistry', () => {
  test('registers and runs enabled commands', () => {
    const reg = new CommandRegistry()
    let ran = false
    reg.register({
      id: 'test.run',
      title: 'Run',
      enabled: () => true,
      run: () => {
        ran = true
      },
    })
    expect(reg.run('test.run')).toBe(true)
    expect(ran).toBe(true)
  })

  test('skips disabled commands', () => {
    const reg = new CommandRegistry()
    reg.register({
      id: 'test.skip',
      title: 'Skip',
      enabled: () => false,
      run: () => {
        throw new Error('should not run')
      },
    })
    expect(reg.run('test.skip')).toBe(false)
  })
})

describe('matchShortcut', () => {
  function keyEvent(partial: {
    key: string
    code?: string
    ctrlKey?: boolean
    metaKey?: boolean
    altKey?: boolean
    shiftKey?: boolean
  }): KeyboardEvent {
    return {
      key: partial.key,
      code: partial.code ?? `Key${partial.key.toUpperCase()}`,
      ctrlKey: partial.ctrlKey ?? false,
      metaKey: partial.metaKey ?? false,
      altKey: partial.altKey ?? false,
      shiftKey: partial.shiftKey ?? false,
    } as KeyboardEvent
  }

  test('matches Mod+S', () => {
    expect(matchShortcut(keyEvent({ key: 's', ctrlKey: true }), 'Mod+S')).toBe(
      true,
    )
  })

  test('matches Delete', () => {
    expect(matchShortcut(keyEvent({ key: 'Delete' }), 'Delete')).toBe(true)
  })
})
