import { describe, expect, test } from 'bun:test'
import {
  buildAssistantCliPrompt,
  buildAssistantInstructions,
  buildNodeInventory,
} from './prompt.ts'
import {
  buildProviderCommand,
  codexEffortValue,
  cursorModelWithEffort,
} from './providers.ts'
import type { Scene } from '../scene/types.ts'

const baseCtx = {
  mode: 'edit' as const,
  userMessage: 'Add a black circle under A',
  sceneName: 'demo-title',
  scenePath: 'playdate/scenes/demo-title.scene.json',
  schemaPath: 'schema/playdate-scene.schema.json',
  formatDocPath: '.playdate-editor/nibble-run/SCENE_FORMAT.md',
  previewPath: '.playdate-editor/nibble-run/preview.png',
  activeState: 'default',
  selectedIds: ['btn-panel'],
  selectedSummary: '- btn-panel (panel "Start") @ (136,160) 128×22',
  nodeInventory:
    '- bg (shape "Background") @ (0,0) 400×240\n- title (text "Title") @ (68,42) 264×26',
}

describe('buildAssistantInstructions', () => {
  test('includes preview, format, inventory, and user request', () => {
    const text = buildAssistantInstructions(baseCtx)
    expect(text).toContain('Mode: EDIT')
    expect(text).toContain('preview.png')
    expect(text).toContain('SCENE_FORMAT.md')
    expect(text).toContain('Node inventory:')
    expect(text).toContain('btn-panel')
    expect(text).toContain('Add a black circle under A')
    expect(text).toContain('Read the preview image')
  })

  test('omits preview step when no preview', () => {
    const text = buildAssistantInstructions({
      ...baseCtx,
      previewPath: undefined,
    })
    expect(text).toContain('Scene preview: (not available this run)')
    expect(text).toContain('Skim the format docs')
    expect(text).not.toContain('Read the preview image')
  })
})

describe('buildAssistantCliPrompt', () => {
  test('stays short and points at instructions', () => {
    const prompt = buildAssistantCliPrompt({
      instructionsRel: '.playdate-editor/nibble-run/INSTRUCTIONS.md',
      hasPreview: true,
    })
    expect(prompt.length).toBeLessThan(220)
    expect(prompt).toContain('INSTRUCTIONS.md')
    expect(prompt).toContain('preview.png')
  })
})

describe('buildNodeInventory', () => {
  test('lists nodes with type and bounds', () => {
    const scene: Scene = {
      version: 1,
      id: 't',
      name: 't',
      width: 400,
      height: 240,
      states: ['default'],
      defaultState: 'default',
      nodes: [
        {
          id: 'a',
          name: 'A',
          type: 'text',
          x: 10,
          y: 20,
          w: 30,
          h: 40,
          anchor: { x: 0, y: 0 },
          states: [],
          visible: true,
          locked: false,
          text: 'A',
          font: 'fonts/Roobert-10-Bold',
          align: 'center',
          valign: 'middle',
        },
      ],
    }
    expect(buildNodeInventory(scene)).toContain('a (text "A")')
  })
})

describe('buildProviderCommand effort/model', () => {
  test('claude defaults to --effort medium', () => {
    const cmd = buildProviderCommand({
      provider: 'claude',
      mode: 'ask',
      prompt: 'hi',
      cwd: '/proj',
      binary: '/bin/claude',
    })
    expect('error' in cmd).toBe(false)
    if ('error' in cmd) return
    expect(cmd.args).toContain('--effort')
    expect(cmd.args).toContain('medium')
    expect(cmd.args).toContain('--include-partial-messages')
  })

  test('claude effort high and model', () => {
    const cmd = buildProviderCommand({
      provider: 'claude',
      mode: 'edit',
      prompt: 'hi',
      cwd: '/proj',
      binary: '/bin/claude',
      effort: 'high',
      model: 'sonnet',
    })
    expect('error' in cmd).toBe(false)
    if ('error' in cmd) return
    const effortIdx = cmd.args.indexOf('--effort')
    expect(cmd.args[effortIdx + 1]).toBe('high')
    expect(cmd.args).toContain('--model')
    expect(cmd.args).toContain('sonnet')
  })

  test('codex defaults to model_reasoning_effort medium', () => {
    const cmd = buildProviderCommand({
      provider: 'codex',
      mode: 'edit',
      prompt: 'hi',
      cwd: '/proj',
      binary: '/bin/codex',
    })
    expect('error' in cmd).toBe(false)
    if ('error' in cmd) return
    expect(cmd.args).toContain('-c')
    expect(cmd.args).toContain('model_reasoning_effort="medium"')
  })

  test('codex maps max to xhigh and passes -m', () => {
    expect(codexEffortValue('max')).toBe('xhigh')
    const cmd = buildProviderCommand({
      provider: 'codex',
      mode: 'ask',
      prompt: 'hi',
      cwd: '/proj',
      binary: '/bin/codex',
      effort: 'max',
      model: 'gpt-5',
    })
    expect('error' in cmd).toBe(false)
    if ('error' in cmd) return
    expect(cmd.args).toContain('model_reasoning_effort="xhigh"')
    expect(cmd.args).toContain('-m')
    expect(cmd.args).toContain('gpt-5')
  })

  test('cursor ask uses stream-json; model gets effort suffix', () => {
    const cmd = buildProviderCommand({
      provider: 'cursor',
      mode: 'ask',
      prompt: 'hello',
      cwd: '/proj',
      binary: '/bin/agent',
      effort: 'high',
      model: 'composer-2',
    })
    expect('error' in cmd).toBe(false)
    if ('error' in cmd) return
    expect(cmd.args).toContain('--mode=ask')
    expect(cmd.args).toContain('stream-json')
    expect(cmd.args).toContain('--model')
    expect(cmd.args).toContain('composer-2-high')
  })

  test('cursor keeps model that already has effort suffix', () => {
    expect(cursorModelWithEffort('claude-opus-4-7-medium', 'high')).toBe(
      'claude-opus-4-7-medium',
    )
    const cmd = buildProviderCommand({
      provider: 'cursor',
      mode: 'edit',
      prompt: 'hello',
      cwd: '/proj',
      binary: '/bin/agent',
      effort: 'high',
      model: 'claude-opus-4-7-medium',
    })
    expect('error' in cmd).toBe(false)
    if ('error' in cmd) return
    expect(cmd.args).toContain('claude-opus-4-7-medium')
    expect(cmd.args).not.toContain('claude-opus-4-7-medium-high')
  })

  test('cursor without model does not invent --model', () => {
    const cmd = buildProviderCommand({
      provider: 'cursor',
      mode: 'edit',
      prompt: 'hello',
      cwd: '/proj',
      binary: '/bin/agent',
      effort: 'medium',
    })
    expect('error' in cmd).toBe(false)
    if ('error' in cmd) return
    expect(cmd.args).not.toContain('--model')
  })
})
