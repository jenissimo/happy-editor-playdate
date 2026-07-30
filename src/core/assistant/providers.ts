/**
 * Resolve headless CLI binaries and argv for Nibble (Cursor / Claude / Codex).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { AssistantProvider } from '../project/paths.ts'

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

export function buildProviderCommand(input: {
  provider: AssistantProvider
  mode: AssistantMode
  prompt: string
  cwd: string
  binary?: string | null
}): ProviderCommand | { error: string } {
  const binary = input.binary ?? findProviderBinary(input.provider)
  if (!binary) {
    return {
      error: `${providerDisplayName(input.provider)} CLI not found in PATH`,
    }
  }

  const { provider, mode, prompt, cwd } = input

  if (provider === 'cursor') {
    const args = ['-p', '--output-format', 'text']
    if (mode === 'ask') args.push('--mode=ask')
    else args.push('--force')
    args.push(prompt)
    return { command: binary, args, cwd }
  }

  if (provider === 'claude') {
    const args = ['-p', '--output-format', 'text']
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
  const args = ['exec', '--ask-for-approval', 'never']
  if (mode === 'ask') args.push('--sandbox', 'read-only')
  else args.push('--sandbox', 'workspace-write')
  args.push(prompt)
  return { command: binary, args, cwd }
}
