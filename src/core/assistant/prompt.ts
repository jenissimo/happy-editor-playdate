/**
 * Build Nibble instruction files and short CLI argv prompts.
 */
import type { Scene, SceneNode } from '../scene/types.ts'
import type { AssistantMode } from './providers.ts'

export type AssistantPromptContext = {
  mode: AssistantMode
  userMessage: string
  sceneName: string
  scenePath: string
  schemaPath: string
  /** Absolute or project-relative path to SCENE_FORMAT copy / docs. */
  formatDocPath: string
  /** Project-relative path to preview.png, if written. */
  previewPath?: string
  activeState: string
  selectedIds: string[]
  selectedSummary?: string
  /** Compact scene node list (prebuilt or from scene). */
  nodeInventory?: string
  /** Optional effort note for providers without a native flag (e.g. Cursor). */
  effortNote?: string
}

function flattenNodes(nodes: SceneNode[]): SceneNode[] {
  const out: SceneNode[] = []
  for (const n of nodes) {
    out.push(n)
    if (n.type === 'group') out.push(...flattenNodes(n.children))
  }
  return out
}

/** One-line-per-node inventory for the instructions file. */
export function buildNodeInventory(scene: Scene): string {
  const lines = flattenNodes(scene.nodes).map(
    (n) =>
      `- ${n.id} (${n.type} "${n.name}") @ (${Math.round(n.x)},${Math.round(n.y)}) ${Math.round(n.w)}×${Math.round(n.h)}`,
  )
  return lines.length > 0 ? lines.join('\n') : '(empty scene)'
}

/**
 * Full instructions written to `.playdate-editor/nibble-run/INSTRUCTIONS.md`.
 * Keep the CLI argv short; put heavy context here.
 */
export function buildAssistantInstructions(ctx: AssistantPromptContext): string {
  const selected =
    ctx.selectedIds.length === 0 ? '(none)' : ctx.selectedIds.join(', ')

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

  const inventory = ctx.nodeInventory?.trim()
    ? ctx.nodeInventory.trim()
    : '(not provided)'

  const previewLine = ctx.previewPath
    ? `- Scene preview (400×240 1:1 PNG): ${ctx.previewPath}`
    : '- Scene preview: (not available this run)'

  const effortLine = ctx.effortNote
    ? `- Requested effort: ${ctx.effortNote}`
    : undefined

  const firstSteps = ctx.previewPath
    ? [
        'Before answering or editing, do this in order:',
        `1) Read the preview image: ${ctx.previewPath}`,
        `2) Skim the format docs: ${ctx.formatDocPath}`,
        `3) Use the scene JSON at ${ctx.scenePath} (inventory below is a shortcut; re-read the file if you need full fields).`,
      ].join('\n')
    : [
        'Before answering or editing, do this in order:',
        `1) Skim the format docs: ${ctx.formatDocPath}`,
        `2) Use the scene JSON at ${ctx.scenePath} (inventory below is a shortcut; re-read the file if you need full fields).`,
      ].join('\n')

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
    previewLine,
    `- Active preview state: ${ctx.activeState}`,
    `- Selected node ids: ${selected}`,
    effortLine,
    selectionExtra,
    '',
    'Node inventory:',
    inventory,
    '',
    firstSteps,
    '',
    'User request:',
    ctx.userMessage.trim(),
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n')
}

/** @deprecated Prefer buildAssistantInstructions; kept for older call sites/tests. */
export function buildAssistantPrompt(ctx: AssistantPromptContext): string {
  return buildAssistantInstructions(ctx)
}

/** Short positional argv so Windows CreateProcess stays under length limits. */
export function buildAssistantCliPrompt(opts: {
  instructionsRel: string
  hasPreview: boolean
}): string {
  if (opts.hasPreview) {
    return `Follow ${opts.instructionsRel}. Start by reading preview.png and SCENE_FORMAT.md in that folder, then fulfill the user request in the file.`
  }
  return `Follow ${opts.instructionsRel}. Start by reading SCENE_FORMAT.md in that folder, then fulfill the user request in the file.`
}
