/**
 * Parse assistant CLI stdout into chat text + progress steps.
 * Supports Claude/Cursor `--output-format stream-json` NDJSON and plain text.
 */

export type AssistantStreamEvent =
  | { kind: 'text'; text: string }
  | { kind: 'step'; label: string; tool?: string }
  | { kind: 'result'; text: string }

export type AssistantStreamState = {
  buffer: string
  sawJson: boolean
  /** When true, the next complete assistant text block was already streamed via deltas. */
  skipNextAssistantText: boolean
}

export function createAssistantStreamState(): AssistantStreamState {
  return { buffer: '', sawJson: false, skipNextAssistantText: false }
}

const TOOL_STEP_LABELS: Record<string, string> = {
  Read: 'Reading…',
  Edit: 'Editing scene…',
  Write: 'Writing scene…',
  MultiEdit: 'Editing scene…',
  Glob: 'Searching files…',
  Grep: 'Searching…',
  Bash: 'Running command…',
  PowerShell: 'Running command…',
  LS: 'Listing files…',
  TodoWrite: 'Planning…',
  Task: 'Delegating…',
  WebFetch: 'Fetching…',
  WebSearch: 'Searching web…',
}

export function stepLabelForTool(tool: string): string {
  return TOOL_STEP_LABELS[tool] ?? `${tool}…`
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object'
    ? (value as JsonRecord)
    : null
}

function contentBlocks(message: unknown): JsonRecord[] {
  const msg = asRecord(message)
  const content = msg?.content
  if (!Array.isArray(content)) return []
  return content.map(asRecord).filter((b): b is JsonRecord => Boolean(b))
}

/** Feed one stdout line (or plain chunk). Returns zero or more logical events. */
export function parseAssistantStreamChunk(
  chunk: string,
  state: AssistantStreamState,
): AssistantStreamEvent[] {
  const events: AssistantStreamEvent[] = []
  state.buffer += chunk

  // Prefer line-oriented JSON when we see NDJSON; otherwise flush as text.
  while (true) {
    const nl = state.buffer.indexOf('\n')
    if (nl < 0) break
    const line = state.buffer.slice(0, nl).replace(/\r$/, '')
    state.buffer = state.buffer.slice(nl + 1)
    if (!line.trim()) continue

    const trimmed = line.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        state.sawJson = true
        events.push(...eventsFromJson(parsed, state))
        continue
      } catch {
        /* fall through as text */
      }
    }

    if (!state.sawJson) {
      events.push({ kind: 'text', text: line + '\n' })
    }
  }

  // Plain-text mode: emit incomplete buffer only when not accumulating JSON.
  if (!state.sawJson && state.buffer.length > 0 && !looksLikeJsonStart(state.buffer)) {
    events.push({ kind: 'text', text: state.buffer })
    state.buffer = ''
  }

  return events
}

/** Flush remaining buffered bytes at process end. */
export function flushAssistantStream(
  state: AssistantStreamState,
): AssistantStreamEvent[] {
  const rest = state.buffer
  state.buffer = ''
  if (!rest.trim()) return []
  if (state.sawJson) {
    try {
      return eventsFromJson(JSON.parse(rest.trim()), state)
    } catch {
      return []
    }
  }
  return [{ kind: 'text', text: rest }]
}

function looksLikeJsonStart(buf: string): boolean {
  const t = buf.trimStart()
  return t.startsWith('{') || t.startsWith('[')
}

function eventsFromJson(
  value: unknown,
  state: AssistantStreamState,
): AssistantStreamEvent[] {
  const obj = asRecord(value)
  if (!obj) return []
  const type = typeof obj.type === 'string' ? obj.type : ''

  if (type === 'system') {
    if (obj.subtype === 'init') {
      return [{ kind: 'step', label: 'Starting…' }]
    }
    if (obj.subtype === 'status' && obj.status === 'requesting') {
      return [{ kind: 'step', label: 'Thinking…' }]
    }
    return []
  }

  // Claude --include-partial-messages: token-level text deltas.
  if (type === 'stream_event') {
    return eventsFromStreamEvent(obj, state)
  }

  if (type === 'assistant') {
    const events: AssistantStreamEvent[] = []
    for (const block of contentBlocks(obj.message)) {
      if (block.type === 'tool_use' && typeof block.name === 'string') {
        events.push({
          kind: 'step',
          label: stepLabelForTool(block.name),
          tool: block.name,
        })
      } else if (
        block.type === 'text' &&
        typeof block.text === 'string' &&
        block.text
      ) {
        if (state.skipNextAssistantText) {
          // Already painted via content_block_delta — avoid duplicating the full message.
          state.skipNextAssistantText = false
          continue
        }
        events.push({ kind: 'text', text: block.text })
      }
    }
    return events
  }

  if (type === 'result') {
    const text = typeof obj.result === 'string' ? obj.result : ''
    const events: AssistantStreamEvent[] = []
    if (text) events.push({ kind: 'result', text })
    return events
  }

  // Cursor agent-style tool call envelopes (best-effort).
  if (type === 'tool_call' || type === 'tool-call') {
    const name =
      (typeof obj.toolName === 'string' && obj.toolName) ||
      (typeof obj.name === 'string' && obj.name) ||
      (typeof asRecord(obj.tool)?.name === 'string'
        ? (asRecord(obj.tool)!.name as string)
        : '')
    if (name) {
      return [{ kind: 'step', label: stepLabelForTool(name), tool: name }]
    }
  }

  return []
}

function eventsFromStreamEvent(
  obj: JsonRecord,
  state: AssistantStreamState,
): AssistantStreamEvent[] {
  const event = asRecord(obj.event)
  if (!event) return []
  const eventType = typeof event.type === 'string' ? event.type : ''
  // Nested tool streams are noise for the chat bubble.
  const nested = obj.parent_tool_use_id != null

  if (eventType === 'content_block_start') {
    const block = asRecord(event.content_block)
    if (!block) return []
    if (block.type === 'tool_use' && typeof block.name === 'string') {
      return [
        {
          kind: 'step',
          label: stepLabelForTool(block.name),
          tool: block.name,
        },
      ]
    }
    if (block.type === 'text' && !nested) {
      return [{ kind: 'step', label: 'Writing…' }]
    }
    return []
  }

  if (eventType === 'content_block_delta') {
    const delta = asRecord(event.delta)
    if (
      delta?.type === 'text_delta' &&
      typeof delta.text === 'string' &&
      delta.text &&
      !nested
    ) {
      state.skipNextAssistantText = true
      return [{ kind: 'text', text: delta.text }]
    }
    return []
  }

  return []
}
