import { describe, expect, test } from 'bun:test'
import {
  createAssistantStreamState,
  flushAssistantStream,
  parseAssistantStreamChunk,
  stepLabelForTool,
} from './streamParse.ts'

describe('stepLabelForTool', () => {
  test('maps known tools', () => {
    expect(stepLabelForTool('Read')).toBe('Reading…')
    expect(stepLabelForTool('Edit')).toBe('Editing scene…')
    expect(stepLabelForTool('Write')).toBe('Writing scene…')
  })

  test('falls back for unknown tools', () => {
    expect(stepLabelForTool('CustomTool')).toBe('CustomTool…')
  })
})

describe('parseAssistantStreamChunk', () => {
  test('emits steps and text from Claude stream-json', () => {
    const state = createAssistantStreamState()
    const init =
      '{"type":"system","subtype":"init","cwd":"/proj"}\n' +
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{}}]}}\n' +
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{}}]}}\n' +
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Done editing."}]}}\n' +
      '{"type":"result","result":"Done editing.","subtype":"success"}\n'

    const events = parseAssistantStreamChunk(init, state)
    expect(events).toEqual([
      { kind: 'step', label: 'Starting…' },
      { kind: 'step', label: 'Reading…', tool: 'Read' },
      { kind: 'step', label: 'Editing scene…', tool: 'Edit' },
      { kind: 'text', text: 'Done editing.' },
      { kind: 'result', text: 'Done editing.' },
    ])
  })

  test('streams text_delta tokens and skips duplicate assistant text', () => {
    const state = createAssistantStreamState()
    const chunk =
      '{"type":"system","subtype":"status","status":"requesting"}\n' +
      '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"parent_tool_use_id":null}\n' +
      '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}},"parent_tool_use_id":null}\n' +
      '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}},"parent_tool_use_id":null}\n' +
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Hi there"}]}}\n' +
      '{"type":"result","result":"Hi there","subtype":"success"}\n'

    const events = parseAssistantStreamChunk(chunk, state)
    expect(events).toEqual([
      { kind: 'step', label: 'Thinking…' },
      { kind: 'step', label: 'Writing…' },
      { kind: 'text', text: 'Hi' },
      { kind: 'text', text: ' there' },
      { kind: 'result', text: 'Hi there' },
    ])
  })

  test('ignores nested tool text deltas', () => {
    const state = createAssistantStreamState()
    const chunk =
      '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"secret"}},"parent_tool_use_id":"tool_1"}\n'
    expect(parseAssistantStreamChunk(chunk, state)).toEqual([])
  })

  test('passes through plain text when not JSON', () => {
    const state = createAssistantStreamState()
    const events = parseAssistantStreamChunk('hello world\n', state)
    expect(events).toEqual([{ kind: 'text', text: 'hello world\n' }])
    expect(flushAssistantStream(state)).toEqual([])
  })

  test('flushes trailing plain text', () => {
    const state = createAssistantStreamState()
    expect(parseAssistantStreamChunk('partial', state)).toEqual([
      { kind: 'text', text: 'partial' },
    ])
  })
})
