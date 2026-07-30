/**
 * Build the system+user prompt Nibble sends to the configured CLI.
 */
import type { AssistantMode } from './providers.ts'

export type AssistantPromptContext = {
  mode: AssistantMode
  userMessage: string
  sceneName: string
  scenePath: string
  schemaPath: string
  formatDocPath: string
  activeState: string
  selectedIds: string[]
  selectedSummary?: string
}

export function buildAssistantPrompt(ctx: AssistantPromptContext): string {
  const selected =
    ctx.selectedIds.length === 0
      ? '(none)'
      : ctx.selectedIds.join(', ')

  const modeBlock =
    ctx.mode === 'ask'
      ? [
          'Mode: ASK (read-only).',
          'Do NOT modify any files.',
          'Answer questions about the current Playdate scene and HappyEditor format.',
        ].join('\n')
      : [
          'Mode: EDIT.',
          `You MAY edit ONLY this scene file: ${ctx.scenePath}`,
          'Do NOT edit generated Lua under Source/scenes/, other scenes, or unrelated project files.',
          'Match schema/playdate-scene.schema.json (version 1, 400×240, unique node ids).',
          'After edits, keep valid JSON. Prefer small, focused changes that match the user request.',
        ].join('\n')

  const selectionExtra = ctx.selectedSummary
    ? `\nSelected nodes detail:\n${ctx.selectedSummary}`
    : ''

  return [
    'You are Nibble, the HappyEditor scene assistant for Playdate (400×240).',
    '',
    modeBlock,
    '',
    'Context:',
    `- Current scene name: ${ctx.sceneName}`,
    `- Scene JSON path: ${ctx.scenePath}`,
    `- Schema: ${ctx.schemaPath}`,
    `- Format docs: ${ctx.formatDocPath}`,
    `- Active preview state: ${ctx.activeState}`,
    `- Selected node ids: ${selected}`,
    selectionExtra,
    '',
    'Read the scene JSON and format docs as needed before answering or editing.',
    '',
    'User request:',
    ctx.userMessage.trim(),
  ]
    .filter((line) => line !== undefined)
    .join('\n')
}
