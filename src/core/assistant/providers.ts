/**
 * Resolve headless CLI binaries and argv for Nibble (Cursor / Claude / Codex).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import type {
  AssistantEffort,
  AssistantProvider,
} from '../project/paths.ts'
import { DEFAULT_ASSISTANT_EFFORT } from '../project/paths.ts'

export type AssistantMode = 'ask' | 'edit'

export type ProviderCommand = {
  command: string
  args: string[]
  cwd: string
}

const BINARIES: Record<AssistantProvider, string[]> = {
  cursor: ['agent', 'cursor-agent'],
  claude: ['claude'],
  codex: ['codex'],
}

const EFFORT_IN_MODEL =
  /-(low|medium|high|xhigh|max|extra-high|thinking-high|thinking-low|thinking-medium)$/i

export function whichBinary(name: string): string | null {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(finder, [name], { encoding: 'utf8' })
  if (result.status !== 0) return null
  const line = result.stdout?.trim().split(/\r?\n/)[0]?.trim()
  if (!line) return null
  return existsSync(line) ? line : line
}

export function findProviderBinary(
  provider: AssistantProvider,
): string | null {
  for (const name of BINARIES[provider]) {
    const found = whichBinary(name)
    if (found) return found
  }
  return null
}

export function providerDisplayName(provider: AssistantProvider): string {
  switch (provider) {
    case 'cursor':
      return 'Cursor CLI'
    case 'claude':
      return 'Claude Code'
    case 'codex':
      return 'Codex'
  }
}

/** Map Nibble effort → Codex `model_reasoning_effort` (`max` → `xhigh`). */
export function codexEffortValue(effort: AssistantEffort): string {
  return effort === 'max' ? 'xhigh' : effort
}

/**
 * Cursor has no `--effort`; bake the tier into `--model` when the id has no
 * effort/thinking suffix yet.
 */
export function cursorModelWithEffort(
  model: string | undefined,
  effort: AssistantEffort,
): string | null {
  const trimmed = model?.trim()
  if (!trimmed) return null
  if (EFFORT_IN_MODEL.test(trimmed)) return trimmed
  return `${trimmed}-${effort}`
}

export function buildProviderCommand(input: {
  provider: AssistantProvider
  mode: AssistantMode
  prompt: string
  cwd: string
  binary?: string | null
  effort?: AssistantEffort
  model?: string
}): ProviderCommand | { error: string } {
  const binary = input.binary ?? findProviderBinary(input.provider)
  if (!binary) {
    return {
      error: `${providerDisplayName(input.provider)} CLI not found in PATH`,
    }
  }

  const { provider, mode, prompt, cwd } = input
  const effort = input.effort ?? DEFAULT_ASSISTANT_EFFORT
  const model = input.model?.trim() || undefined

  if (provider === 'cursor') {
    const args = ['-p', '--output-format', 'stream-json']
    if (mode === 'ask') args.push('--mode=ask')
    else args.push('--force')
    const modelArg = cursorModelWithEffort(model, effort)
    if (modelArg) args.push('--model', modelArg)
    args.push(prompt)
    return { command: binary, args, cwd }
  }

  if (provider === 'claude') {
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--effort',
      effort,
    ]
    if (model) args.push('--model', model)
    if (mode === 'ask') {
      args.push('--permission-mode', 'plan')
    } else {
      args.push(
        '--allowedTools',
        'Read,Edit,Write',
        '--permission-mode',
        'acceptEdits',
      )
    }
    args.push(prompt)
    return { command: binary, args, cwd }
  }

  // codex
  const args = [
    'exec',
    '--ask-for-approval',
    'never',
    '-c',
    `model_reasoning_effort="${codexEffortValue(effort)}"`,
  ]
  if (model) args.push('-m', model)
  if (mode === 'ask') args.push('--sandbox', 'read-only')
  else args.push('--sandbox', 'workspace-write')
  args.push(prompt)
  return { command: binary, args, cwd }
}
