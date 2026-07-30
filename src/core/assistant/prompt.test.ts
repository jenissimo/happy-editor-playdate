import { describe, expect, test } from 'bun:test'
import { buildAssistantPrompt } from './prompt.ts'
import { buildProviderCommand } from './providers.ts'

describe('buildAssistantPrompt', () => {
  test('includes ask guardrails and scene paths', () => {
    const prompt = buildAssistantPrompt({
      mode: 'ask',
      userMessage: 'What nodes are selected?',
      sceneName: 'demo-title',
      scenePath: '/proj/playdate/scenes/demo-title.scene.json',
      schemaPath: '/proj/schema/playdate-scene.schema.json',
      formatDocPath: '/proj/docs/SCENE_FORMAT.md',
      activeState: 'default',
      selectedIds: ['title'],
    })
    expect(prompt).toContain('Mode: ASK')
    expect(prompt).toContain('Do NOT modify any files')
    expect(prompt).toContain('demo-title.scene.json')
    expect(prompt).toContain('What nodes are selected?')
  })

  test('includes edit guardrails', () => {
    const prompt = buildAssistantPrompt({
      mode: 'edit',
      userMessage: 'Move title to center',
      sceneName: 'demo-title',
      scenePath: '/proj/playdate/scenes/demo-title.scene.json',
      schemaPath: '/proj/schema/playdate-scene.schema.json',
      formatDocPath: '/proj/docs/SCENE_FORMAT.md',
      activeState: 'default',
      selectedIds: [],
    })
    expect(prompt).toContain('Mode: EDIT')
    expect(prompt).toContain('ONLY this scene file')
    expect(prompt).toContain('Do NOT edit generated Lua')
  })
})

describe('buildProviderCommand', () => {
  test('cursor ask uses mode=ask without force', () => {
    const cmd = buildProviderCommand({
      provider: 'cursor',
      mode: 'ask',
      prompt: 'hello',
      cwd: '/proj',
      binary: '/bin/agent',
    })
    expect('error' in cmd).toBe(false)
    if ('error' in cmd) return
    expect(cmd.args).toContain('--mode=ask')
    expect(cmd.args).not.toContain('--force')
    expect(cmd.args.at(-1)).toBe('hello')
  })

  test('codex edit uses workspace-write', () => {
    const cmd = buildProviderCommand({
      provider: 'codex',
      mode: 'edit',
      prompt: 'edit scene',
      cwd: '/proj',
      binary: '/bin/codex',
    })
    expect('error' in cmd).toBe(false)
    if ('error' in cmd) return
    expect(cmd.args).toContain('exec')
    expect(cmd.args).toContain('workspace-write')
  })
})
