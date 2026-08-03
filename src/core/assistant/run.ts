/**
 * Spawn a headless assistant CLI and stream stdout/stderr.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  buildProviderCommand,
  findProviderBinary,
  type AssistantMode,
} from './providers.ts'
import {
  createAssistantStreamState,
  flushAssistantStream,
  parseAssistantStreamChunk,
} from './streamParse.ts'
import type {
  AssistantEffort,
  AssistantProvider,
} from '../project/paths.ts'

export type AssistantRunInput = {
  provider: AssistantProvider
  mode: AssistantMode
  prompt: string
  cwd: string
  effort?: AssistantEffort
  model?: string
  /** Soft timeout in ms (default 5 minutes). */
  timeoutMs?: number
}

export type AssistantChunk =
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'step'; label: string; tool?: string }
  | { type: 'done'; code: number | null; signal: NodeJS.Signals | null }
  | { type: 'error'; message: string }

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
// Give a CLI a short chance to flush and exit cleanly, without leaving an
// abandoned process alive after its SSE client or the dev server goes away.
const TERMINATION_GRACE_MS = 1_000

export function startAssistantRun(
  input: AssistantRunInput,
  onChunk: (chunk: AssistantChunk) => void,
): { kill: () => void } {
  const emit = (chunk: AssistantChunk) => {
    try {
      onChunk(chunk)
    } catch (error) {
      // Output consumers commonly write to sockets. Never let a closed client
      // turn a child-process event or timeout callback into a fatal exception.
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[happy-editor] Assistant output consumer failed: ${message}`)
    }
  }

  const binary = findProviderBinary(input.provider)
  const cmd = buildProviderCommand({
    provider: input.provider,
    mode: input.mode,
    prompt: input.prompt,
    cwd: input.cwd,
    binary,
    effort: input.effort,
    model: input.model,
  })
  if ('error' in cmd) {
    emit({ type: 'error', message: cmd.error })
    emit({ type: 'done', code: 1, signal: null })
    return { kill: () => {} }
  }

  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(cmd.command, cmd.args, {
      cwd: cmd.cwd,
      env: process.env,
      windowsHide: true,
    })
  } catch (e) {
    emit({
      type: 'error',
      message: e instanceof Error ? e.message : 'Failed to spawn assistant CLI',
    })
    emit({ type: 'done', code: 1, signal: null })
    return { kill: () => {} }
  }

  let closeObserved = false
  let done = false
  let errorEmitted = false
  let terminationRequested = false
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null
  let killTimer: ReturnType<typeof setTimeout> | null = null

  const clearTerminationTimers = () => {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
      timeoutTimer = null
    }
    if (killTimer) {
      clearTimeout(killTimer)
      killTimer = null
    }
  }

  const emitDone = (code: number | null, signal: NodeJS.Signals | null) => {
    if (done) return
    done = true
    emit({ type: 'done', code, signal })
  }

  const emitError = (message: string) => {
    if (closeObserved || errorEmitted) return
    errorEmitted = true
    emit({ type: 'error', message })
  }

  const requestTermination = (message?: string) => {
    if (closeObserved) return
    if (message) emitError(message)
    if (terminationRequested) return
    terminationRequested = true
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
      timeoutTimer = null
    }
    try {
      child.kill('SIGTERM')
    } catch (error) {
      emitError(
        error instanceof Error ? error.message : 'Failed to stop assistant CLI',
      )
    }
    killTimer = setTimeout(() => {
      if (closeObserved) return
      try {
        child.kill('SIGKILL')
      } catch (error) {
        emitError(
          error instanceof Error ? error.message : 'Failed to force-stop assistant CLI',
        )
      }
    }, TERMINATION_GRACE_MS)
  }

  const streamState = createAssistantStreamState()
  let emittedText = false

  const emitParsed = (
    events: ReturnType<typeof parseAssistantStreamChunk>,
  ) => {
    for (const ev of events) {
      if (ev.kind === 'step') {
        emit({ type: 'step', label: ev.label, tool: ev.tool })
      } else if (ev.kind === 'text') {
        if (ev.text) {
          emittedText = true
          emit({ type: 'stdout', text: ev.text })
        }
      } else if (ev.kind === 'result') {
        // Prefer streamed assistant text; result is a fallback when none arrived.
        if (!emittedText && ev.text) {
          emittedText = true
          emit({ type: 'stdout', text: ev.text })
        }
      }
    }
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  timeoutTimer = setTimeout(() => {
    requestTermination(
      `Assistant timed out after ${Math.round(timeoutMs / 1000)}s`,
    )
  }, timeoutMs)

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (text: string) => {
    if (text) emitParsed(parseAssistantStreamChunk(text, streamState))
  })
  child.stderr.on('data', (text: string) => {
    if (text) emit({ type: 'stderr', text })
  })
  child.on('error', (err) => {
    requestTermination(err.message)
  })
  child.on('close', (code, signal) => {
    if (closeObserved) return
    closeObserved = true
    clearTerminationTimers()
    emitParsed(flushAssistantStream(streamState))
    emitDone(code, signal)
  })

  return {
    kill: () => {
      requestTermination()
    },
  }
}
