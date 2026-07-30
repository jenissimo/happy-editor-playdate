/**
 * Spawn a headless assistant CLI and stream stdout/stderr.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  buildProviderCommand,
  findProviderBinary,
  type AssistantMode,
} from './providers.ts'
import type { AssistantProvider } from '../project/paths.ts'

export type AssistantRunInput = {
  provider: AssistantProvider
  mode: AssistantMode
  prompt: string
  cwd: string
  /** Soft timeout in ms (default 5 minutes). */
  timeoutMs?: number
}

export type AssistantChunk =
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'done'; code: number | null; signal: NodeJS.Signals | null }
  | { type: 'error'; message: string }

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

export function startAssistantRun(
  input: AssistantRunInput,
  onChunk: (chunk: AssistantChunk) => void,
): { kill: () => void } {
  const binary = findProviderBinary(input.provider)
  const cmd = buildProviderCommand({
    provider: input.provider,
    mode: input.mode,
    prompt: input.prompt,
    cwd: input.cwd,
    binary,
  })
  if ('error' in cmd) {
    onChunk({ type: 'error', message: cmd.error })
    onChunk({ type: 'done', code: 1, signal: null })
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
    onChunk({
      type: 'error',
      message: e instanceof Error ? e.message : 'Failed to spawn assistant CLI',
    })
    onChunk({ type: 'done', code: 1, signal: null })
    return { kill: () => {} }
  }

  let settled = false
  const settle = (chunk: AssistantChunk) => {
    if (settled) return
    settled = true
    onChunk(chunk)
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => {
    child.kill('SIGTERM')
    settle({
      type: 'error',
      message: `Assistant timed out after ${Math.round(timeoutMs / 1000)}s`,
    })
    settle({ type: 'done', code: null, signal: 'SIGTERM' })
  }, timeoutMs)

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (text: string) => {
    if (text) onChunk({ type: 'stdout', text })
  })
  child.stderr.on('data', (text: string) => {
    if (text) onChunk({ type: 'stderr', text })
  })
  child.on('error', (err) => {
    clearTimeout(timer)
    settle({ type: 'error', message: err.message })
    settle({ type: 'done', code: 1, signal: null })
  })
  child.on('close', (code, signal) => {
    clearTimeout(timer)
    settle({ type: 'done', code, signal })
  })

  return {
    kill: () => {
      clearTimeout(timer)
      if (!settled) {
        child.kill('SIGTERM')
      }
    },
  }
}
