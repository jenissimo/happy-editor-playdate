import { createHash } from 'node:crypto'
import { bitmapBytes, DEFAULT_RUNTIME_FONT, type AssetCatalog } from '../assets/catalog.ts'
import type { Scene, SceneNode } from './types.ts'

export const COMPILER_REVISION = 'ui-islands-4'
export const SCHEMA_REVISION = '1'

export type CompiledIsland = { id: string; x: number; y: number; w: number; h: number; descendants: number; renderIndex: number; members: string[] }
export type CompiledScene = Scene & { _compiled: {
  schemaRevision: string; compilerRevision: string; catalogRevision: string; generationId: string
  memoryFormulaRevision: string
  sceneRevision: string; maxIslandBytes: number; maxIslandBitmaps: number
  /** Exact load-time ledger reservation for islands, promotion slots, scratch, and allowlisted assets. */
  maxUiBytes: number; maxUiBitmaps: number; islands: CompiledIsland[]
  /** Catalog keys preloaded at Ui.load; controller literals are included. */
  allowlist: string[]
} }

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 16) }
function isMergeSafe(node: SceneNode): boolean {
  return node.type !== 'group' && !node.states.length && !(node.rotation ?? 0) &&
    !(node.type === 'image' && (node.fps ?? 0) > 0) &&
    !(node.type === 'text' && (node.scale ?? 1) > 1)
}
function topLeft(node: SceneNode) { return { x: node.x - node.anchor.x * node.w, y: node.y - node.anchor.y * node.h } }
// An `image` node draws its asset through img:draw(x, y), which blits at the
// asset's INTRINSIC size and ignores the node's declared w/h -- an asset
// larger than its box has always painted past it (harmless when a node drew
// straight to the screen; the editor's own preview shows the same overflow).
// The raster cache changed that: every node now rasterizes into a buffer
// sized from its declared box, so anything past it is silently clipped.
// Island bounds and the declared byte/bitmap budget must therefore be sized
// from what the node actually draws, not merely what it declares -- while
// its declared x/y/w/h (and so topLeft, and so its anchor-derived position)
// stays exactly what the author authored. A frame `image` node backed by a
// sequential imagetable draws one CELL, not the sheet, so that's the size
// that matters for it; anything else (a still image) draws at its full
// width/height.
function assetIntrinsicSize(node: SceneNode, catalog: AssetCatalog): { w: number; h: number } | null {
  if (node.type !== 'image' || !node.asset) return null
  const entry = catalog.entries[node.asset]
  if (!entry) return null
  if (entry.kind === 'table') return entry.cell ? { w: entry.cell.w, h: entry.cell.h } : null
  if (entry.kind === 'image') return { w: entry.width, h: entry.height }
  return null
}
function effectiveSize(node: SceneNode, catalog: AssetCatalog): { w: number; h: number } {
  const asset = assetIntrinsicSize(node, catalog)
  return { w: Math.max(node.w, asset?.w ?? 0), h: Math.max(node.h, asset?.h ?? 0) }
}
function flush(run: SceneNode[], out: CompiledIsland[], catalog: AssetCatalog) {
  if (!run.length) return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const node of run) {
    const p = topLeft(node)
    const size = effectiveSize(node, catalog)
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + size.w); maxY = Math.max(maxY, p.y + size.h)
  }
  const renderIndex = out.length
  out.push({ id: `island-${renderIndex}`, x: Math.floor(minX), y: Math.floor(minY), w: Math.max(1, Math.ceil(maxX - minX)), h: Math.max(1, Math.ceil(maxY - minY)), descendants: run.length, renderIndex, members: run.map((n) => n.id) })
  run.length = 0
}
function walk(nodes: SceneNode[], out: CompiledIsland[], assets: Set<string>, drawables: SceneNode[], catalog: AssetCatalog): boolean {
  const run: SceneNode[] = []
  let needsDefaultFont = false
  for (const node of nodes) {
    if (node.type === 'group') { flush(run, out, catalog); if (walk(node.children, out, assets, drawables, catalog)) needsDefaultFont = true; continue }
    drawables.push(node)
    if ((node.type === 'image' || node.type === 'panel') && node.asset) assets.add(node.asset)
    if (node.type === 'text') {
      if (node.font) assets.add(node.font)
      else needsDefaultFont = true
    }
    if (isMergeSafe(node)) run.push(node)
    else {
      flush(run, out, catalog)
      const p = topLeft(node)
      const size = effectiveSize(node, catalog)
      out.push({ id: `island-${out.length}`, x: Math.floor(p.x), y: Math.floor(p.y), w: Math.max(1, Math.ceil(size.w)), h: Math.max(1, Math.ceil(size.h)), descendants: 1, renderIndex: out.length, members: [node.id] })
    }
  }
  flush(run, out, catalog)
  return needsDefaultFont
}
function runtimeBitmapBytes(width: number, height: number): number {
  return bitmapBytes(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)))
}
function scratchBytes(node: SceneNode): number {
  if (node.type !== 'text') return 0
  const scale = Math.floor(node.scale ?? 1)
  if (scale <= 1) return 0
  return runtimeBitmapBytes(Math.max(1, Math.floor(node.w / scale)), Math.max(1, Math.floor(node.h / scale)))
}
/** Compile immutable render-island capacity metadata without changing scene JSON. */
export function compileScene(scene: Scene, catalog: AssetCatalog, generationId: string, dynamicAllowlist: readonly string[] = []): CompiledScene {
  const islands: CompiledIsland[] = [], assets = new Set<string>(dynamicAllowlist), drawables: SceneNode[] = []
  if (walk(scene.nodes, islands, assets, drawables, catalog)) assets.add(DEFAULT_RUNTIME_FONT)
  const allowlist = [...assets].filter((path) => catalog.entries[path]?.trusted === true).sort()
  const maxIslandBytes = islands.reduce((n, i) => n + runtimeBitmapBytes(i.w, i.h), 0)
  const maxIslandBitmaps = islands.length
  // Cache.preallocateIslands reserves every island surface and every member
  // promotion slot, including singleton islands, before Assets.preload.
  const memberBytes = drawables.reduce((n, node) => { const size = effectiveSize(node, catalog); return n + runtimeBitmapBytes(size.w, size.h) }, 0)
  const scratch = drawables.reduce((n, node) => n + scratchBytes(node), 0)
  const scratchBitmaps = drawables.filter((node) => scratchBytes(node) > 0).length
  const assetEntries = allowlist.map((path) => catalog.entries[path]!)
  const assetBytes = assetEntries.reduce((n, entry) => n + entry.bytes, 0)
  const assetBitmaps = assetEntries.reduce((n, entry) => n + entry.bitmaps, 0)
  const maxUiBytes = maxIslandBytes + memberBytes + scratch + assetBytes
  const maxUiBitmaps = maxIslandBitmaps + drawables.length + scratchBitmaps + assetBitmaps
  const base = JSON.parse(JSON.stringify(scene)) as Scene
  const plan = { schemaRevision: SCHEMA_REVISION, compilerRevision: COMPILER_REVISION, catalogRevision: catalog.revision, memoryFormulaRevision: catalog.memoryFormulaRevision, generationId, maxIslandBytes, maxIslandBitmaps, maxUiBytes, maxUiBitmaps, islands, allowlist }
  const relevant = allowlist.map((k) => `${k}:${catalog.entries[k]?.fingerprint ?? 'untrusted'}`)
  return { ...base, _compiled: { ...plan, sceneRevision: hash(`${canonical(base)}|${canonical(plan)}|${relevant.join(',')}`) } }
}
