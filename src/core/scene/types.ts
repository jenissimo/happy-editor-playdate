import { SCREEN_H, SCREEN_W } from '../constants.js'
import { DEFAULT_FONT } from './defaults.js'

export type NodeType =
  | 'text'
  | 'image'
  | 'panel'
  | 'frame'
  | 'shape'
  | 'group'

export type Vec2 = { x: number; y: number }

/** Anchor: 0 = left/top, 0.5 = center, 1 = right/bottom. */
export type Anchor = { x: number; y: number }

export type BaseNode = {
  id: string
  name: string
  type: NodeType
  x: number
  y: number
  w: number
  h: number
  anchor: Anchor
  /** Degrees clockwise around anchor/pivot. Missing = 0. */
  rotation?: number
  /** Visible in which screen states; empty = all. */
  states: string[]
  visible: boolean
  locked: boolean
}

export type TextAlign = 'left' | 'center' | 'right'
export type TextVAlign = 'top' | 'middle' | 'bottom'

/** 1-bit ink color. */
export type Ink = 'black' | 'white'

/** One outline ring stack (8-direction). */
export type TextOutlineRing = { width: number; color: Ink }

/**
 * Glyph outline. Absent / null = off.
 * Primary `width`/`color` is the inner ring; optional `outer` draws further out
 * (classic readable UI: white inner + black outer around black fill).
 */
export type TextOutline = TextOutlineRing & {
  outer?: TextOutlineRing | null
}

/** Single-offset drop shadow. Absent / null = off. */
export type TextShadow = { x: number; y: number; color: Ink }

export type TextNode = BaseNode & {
  type: 'text'
  text: string
  /**
   * Asset basePath of a .fnt.
   * Empty / missing resolves to DEFAULT_FONT (Roobert-11-Medium), not OS/system font.
   */
  font: string
  align: TextAlign
  /** Vertical alignment within the text box. Omitted → top. */
  valign?: TextVAlign
  /** Layer-style outline around glyphs (optional outer ring). Drawn after shadow, before fill. */
  outline?: TextOutline | null
  /** Layer-style drop shadow. Drawn first (shadow → outline → fill). */
  shadow?: TextShadow | null
}

export type ImageNode = BaseNode & {
  type: 'image'
  /** Asset basePath (Playdate load path). Plain image or imagetable. */
  asset: string
  /**
   * Frames per second for imagetable playback. `0` / omitted = static
   * (`frame` or first frame of range).
   */
  fps?: number
  /** Loop when animating. Default true. */
  loop?: boolean
  /** 1-based inclusive start frame (Playdate imagetable index). Default 1. */
  frameStart?: number
  /** 1-based inclusive end frame. Default = table length. */
  frameEnd?: number
  /** Static 1-based frame when fps is 0 / omitted. Default = frameStart. */
  frame?: number
}

export type PanelNode = BaseNode & {
  type: 'panel'
  /** Asset basePath of a *-slice-L-R-T-B image. */
  asset: string
  slice: { left: number; right: number; top: number; bottom: number }
}

export type FrameStyle = 'line' | 'double' | 'ticks'

export type FrameNode = BaseNode & {
  type: 'frame'
  style: FrameStyle
  thickness: number
}

/** Named dither / hatch patterns (Playdate-aligned). */
export type DitherPattern =
  | 'bayer2'
  | 'bayer4'
  | 'bayer8'
  | 'horizontal'
  | 'vertical'
  | 'diagonal'
  | 'screen'
  | 'checker'
  | 'dots'

export const DITHER_PATTERNS: readonly DitherPattern[] = [
  'bayer2',
  'bayer4',
  'bayer8',
  'horizontal',
  'vertical',
  'diagonal',
  'screen',
  'checker',
  'dots',
] as const

export type ShapeFill =
  | { kind: 'none' }
  | { kind: 'solid'; color: Ink }
  | { kind: 'dither'; pattern: DitherPattern; color: Ink }
  | {
      kind: 'gradient'
      /** Band axis: density changes along this axis. */
      axis: 'h' | 'v'
      /** Density 0..1 at start (0 = empty / white, 1 = solid ink). */
      from: number
      /** Density 0..1 at end. */
      to: number
      color: Ink
    }

export type ShapeStroke =
  | { kind: 'none' }
  | { kind: 'solid'; thickness: number; color: Ink }
  | { kind: 'double'; thickness: number; gap: number; color: Ink }
  | {
      kind: 'dashed'
      thickness: number
      dash: number
      gap: number
      color: Ink
    }
  | { kind: 'ticks'; thickness: number; step: number; color: Ink }

export type ShapeNode = BaseNode & {
  type: 'shape'
  /** 0 = sharp corners. Applied to solid/dither fills and solid/double strokes. */
  cornerRadius: number
  fill: ShapeFill
  stroke: ShapeStroke
}

export type GroupNode = BaseNode & {
  type: 'group'
  children: SceneNode[]
}

export type SceneNode =
  | TextNode
  | ImageNode
  | PanelNode
  | FrameNode
  | ShapeNode
  | GroupNode

export type Scene = {
  version: 1
  id: string
  name: string
  width: number
  height: number
  /** Named states this screen can be in (e.g. "idle", "focus"). */
  states: string[]
  /** Currently edited / default state. */
  defaultState: string
  nodes: SceneNode[]
}

export function createEmptyScene(name = 'untitled'): Scene {
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    width: SCREEN_W,
    height: SCREEN_H,
    states: ['default'],
    defaultState: 'default',
    nodes: [],
  }
}

export function createTextNode(partial?: Partial<TextNode>): TextNode {
  return {
    id: crypto.randomUUID(),
    name: 'Text',
    type: 'text',
    x: 120,
    y: 110,
    w: 160,
    h: 20,
    anchor: { x: 0, y: 0 },
    rotation: 0,
    states: [],
    visible: true,
    locked: false,
    text: 'Hello',
    font: DEFAULT_FONT,
    align: 'left',
    valign: 'top',
    ...partial,
  }
}

export function createPanelNode(partial?: Partial<PanelNode>): PanelNode {
  return {
    id: crypto.randomUUID(),
    name: 'Panel',
    type: 'panel',
    x: 40,
    y: 30,
    w: 320,
    h: 180,
    anchor: { x: 0, y: 0 },
    rotation: 0,
    states: [],
    visible: true,
    locked: false,
    asset: '',
    slice: { left: 8, right: 8, top: 8, bottom: 8 },
    ...partial,
  }
}

export function createFrameNode(partial?: Partial<FrameNode>): FrameNode {
  return {
    id: crypto.randomUUID(),
    name: 'Frame',
    type: 'frame',
    x: 20,
    y: 20,
    w: 360,
    h: 200,
    anchor: { x: 0, y: 0 },
    rotation: 0,
    states: [],
    visible: true,
    locked: false,
    style: 'line',
    thickness: 2,
    ...partial,
  }
}

export function defaultShapeFill(): ShapeFill {
  return { kind: 'none' }
}

export function defaultShapeStroke(): ShapeStroke {
  return { kind: 'solid', thickness: 1, color: 'black' }
}

export function createShapeNode(partial?: Partial<ShapeNode>): ShapeNode {
  return {
    id: crypto.randomUUID(),
    name: 'Shape',
    type: 'shape',
    x: 80,
    y: 60,
    w: 120,
    h: 80,
    anchor: { x: 0, y: 0 },
    rotation: 0,
    states: [],
    visible: true,
    locked: false,
    cornerRadius: 0,
    fill: defaultShapeFill(),
    stroke: defaultShapeStroke(),
    ...partial,
  }
}

export function createImageNode(partial?: Partial<ImageNode>): ImageNode {
  return {
    id: crypto.randomUUID(),
    name: 'Image',
    type: 'image',
    x: 184,
    y: 104,
    w: 32,
    h: 32,
    anchor: { x: 0, y: 0 },
    rotation: 0,
    states: [],
    visible: true,
    locked: false,
    asset: '',
    ...partial,
  }
}

export function createGroupNode(partial?: Partial<GroupNode>): GroupNode {
  return {
    id: crypto.randomUUID(),
    name: 'Group',
    type: 'group',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    anchor: { x: 0, y: 0 },
    rotation: 0,
    states: [],
    visible: true,
    locked: false,
    children: [],
    ...partial,
  }
}
