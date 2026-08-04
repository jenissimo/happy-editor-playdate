/**
 * Production asset catalog.  This deliberately reads PNG headers instead of
 * asking the SDK for sizes: a layout can therefore be rejected before it ever
 * causes a device allocation.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseAssetName } from './parseAssetName.ts'

export const CATALOG_SCHEMA_REVISION = '1'
/** 32-bit aligned rows, separate pixel/mask planes, and object overhead. */
export const MEMORY_FORMULA_REVISION = '1bit-row32-mask-v2'
/** Kept in lockstep with editor/playdate/Source/ui.lua. */
export const DEFAULT_RUNTIME_FONT = 'fonts/Roobert-11-Medium'

export type CatalogEntry = {
  path: string
  kind: 'image' | 'table' | 'slice' | 'font'
  fingerprint: string
  width: number
  height: number
  bytes: number
  bitmaps: number
  cell?: { w: number; h: number; count: number }
  slice?: { left: number; right: number; top: number; bottom: number }
  backing?: string
  /** Only trusted entries may be loaded by a compiled production scene. */
  trusted: boolean
  /** Runtime frames for animated GIFs / sequential tables. */
  frames?: number
  /** Parsed font glyph codepoints when the fnt format makes them provable. */
  glyphs?: number[]
  /** Internal sequential-table position; omitted from generated public catalog. */
  frameIndex?: number
}

export type AssetCatalog = {
  schemaRevision: string
  memoryFormulaRevision: string
  revision: string
  entries: Record<string, CatalogEntry>
}

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) files(full, out)
    else out.push(full)
  }
  return out
}

function pngSize(bytes: Buffer, path: string): { width: number; height: number } {
  if (bytes.length < 24 || bytes.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error(`invalid PNG bounds: ${path}`)
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (!width || !height || width > 4096 || height > 4096) {
    throw new Error(`invalid PNG bounds: ${path}`)
  }
  return { width, height }
}

function fontGlyphs(bytes: Buffer): number[] | undefined {
  const text = bytes.toString('utf8')
  const found = new Set<number>()
  // Playdate .fnt files have varied over SDK releases; accept only explicit
  // textual character declarations, otherwise leave coverage unproven.
  for (const m of text.matchAll(/(?:char|glyph)\s*(?:=|:)\s*(\d+)/gi)) found.add(Number(m[1]))
  return found.size ? [...found].sort((a, b) => a - b) : undefined
}

/** Conservative UI-owned allocation credit. Pixel + mask planes are charged. */
export function bitmapBytes(width: number, height: number): number {
  const alignedStride = Math.ceil(width / 32) * 4
  return alignedStride * height * 2 + 64
}

function digest(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16)
}

/** Index every SDK-supported raster and .fnt below the configured Source tree. */
export function buildAssetCatalog(sourceDir: string): AssetCatalog {
  if (!existsSync(sourceDir)) throw new Error(`missing Source tree: ${sourceDir}`)
  const pending = new Map<string, CatalogEntry[]>()
  const fonts: Array<{ path: string; source: string }> = []
  for (const full of files(sourceDir)) {
    const rel = relative(sourceDir, full).replace(/\\/g, '/')
    const ext = rel.split('.').pop()?.toLowerCase()
    if (ext === 'gif' || ext === 'jpg' || ext === 'jpeg') {
      throw new Error(`unsupported non-PNG UI raster: ${rel}`)
    }
    if (!ext || !['png', 'fnt'].includes(ext)) continue
    const parsed = parseAssetName(rel)
    if (!parsed) continue
    const bytes = readFileSync(full)
    if (ext === 'fnt') {
      fonts.push({ path: parsed.basePath, source: rel })
      continue
    }
    const size = pngSize(bytes, rel)
    const info = { ...size, frames: 1 }
    const path = parsed.basePath
    const entry: CatalogEntry = {
      path,
      kind: parsed.kind === 'slice' ? 'slice' : parsed.kind === 'table' ? 'table' : 'image',
      fingerprint: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
      width: info.width,
      height: info.height,
      // GIF disposal/subrect descriptors do not bound runtime memory: every
      // decoded frame is conservatively charged at logical canvas size.
      bytes: bitmapBytes(info.width, info.height) * info.frames,
      bitmaps: info.frames,
      trusted: true,
      ...(info.frames > 1 ? { frames: info.frames } : {}),
      ...(parsed.slice ? { slice: parsed.slice } : {}),
      ...(parsed.cell ? { cell: { ...parsed.cell, count: 1 } } : {}),
      ...(parsed.frameIndex !== undefined ? { frameIndex: parsed.frameIndex } : {}),
    }
    const group = pending.get(path) ?? []
    group.push(entry)
    pending.set(path, group)
  }

  const entries: Record<string, CatalogEntry> = {}
  for (const path of [...pending.keys()].sort()) {
    const group = pending.get(path)!
    const first = group[0]
    if (first.kind === 'table') {
      // Matrix tables are one sheet; reserve every cell, not the sheet.
      const matrix = group.filter((x) => x.cell)
      if (matrix.length === 1 && group.length === 1) {
        const e = matrix[0]
        const c = e.cell!
        if (c.w < 1 || c.h < 1) throw new Error(`invalid matrix cell geometry: ${path}`)
        if (e.width % c.w || e.height % c.h) throw new Error(`non-divisible table: ${path}`)
        c.count = (e.width / c.w) * (e.height / c.h)
        e.bytes = bitmapBytes(c.w, c.h) * c.count + 64
        e.bitmaps = c.count
        entries[path] = e
      } else {
        const frames = group.filter((x) => !x.cell).sort((a, b) => (a.frameIndex ?? 0) - (b.frameIndex ?? 0))
        if (frames.length !== group.length) throw new Error(`ambiguous table topology: ${path}`)
        for (let i = 0; i < frames.length; i++) {
          if (frames[i].frameIndex !== i + 1) throw new Error(`gapped sequential table: ${path}`)
        }
        // Frame suffixes are lost in the public entry, so recover sorted source
        // ordering from the deterministic path walk; require equal topology.
        const dims = `${frames[0].width}x${frames[0].height}`
        if (frames.some((f) => `${f.width}x${f.height}` !== dims)) throw new Error(`uneven table frames: ${path}`)
        entries[path] = {
          ...frames[0], bitmaps: frames.length,
          bytes: frames.reduce((n, f) => n + bitmapBytes(f.width, f.height), 64),
          fingerprint: digest(frames.map((f) => f.fingerprint)),
          cell: { w: frames[0].width, h: frames[0].height, count: frames.length }, frames: frames.length,
        }
      }
    } else {
      if (group.length !== 1) throw new Error(`duplicate logical asset path: ${path}`)
      const e = first
      if (e.kind === 'slice') {
        const s = e.slice!
        if (s.left + s.right >= e.width || s.top + s.bottom >= e.height) throw new Error(`invalid nine-slice geometry: ${path}`)
        // Source image plus the nine-slice object; destinations are ledgered by runtime.
        e.bytes += 128
      }
      entries[path] = e
    }
  }
  for (const font of fonts.sort((a, b) => a.path.localeCompare(b.path))) {
    const backing = entries[font.path]
    if (!backing || backing.kind !== 'table') throw new Error(`font backing atlas missing: ${font.source}`)
    entries[font.path] = {
      ...backing, path: font.path, kind: 'font', backing: font.path,
      bytes: backing.bytes + 192, bitmaps: backing.bitmaps,
      fingerprint: digest([backing.fingerprint, readFileSync(join(sourceDir, font.source)).toString('binary')]),
      glyphs: fontGlyphs(readFileSync(join(sourceDir, font.source))),
    }
  }
  if (!entries[DEFAULT_RUNTIME_FONT] || entries[DEFAULT_RUNTIME_FONT].kind !== 'font' || !entries[DEFAULT_RUNTIME_FONT].trusted) {
    throw new Error(`runtime default font missing or untrusted: ${DEFAULT_RUNTIME_FONT}`)
  }
  for (const entry of Object.values(entries)) delete entry.frameIndex
  const serial = Object.keys(entries).sort().map((k) => JSON.stringify(entries[k]))
  return { schemaRevision: CATALOG_SCHEMA_REVISION, memoryFormulaRevision: MEMORY_FORMULA_REVISION, revision: digest(serial), entries }
}

export function catalogLua(catalog: AssetCatalog, generationId: string): string {
  const lua = (v: unknown): string => {
    if (v === null || v === undefined) return 'nil'
    if (typeof v === 'string') return JSON.stringify(v)
    if (typeof v === 'number') return String(v)
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    if (Array.isArray(v)) return `{ ${v.map(lua).join(', ')} }`
    return `{ ${Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `[${JSON.stringify(k)}] = ${lua(x)}`).join(', ')} }`
  }
  return `-- Generated by HappyEditor -- DO NOT EDIT\nUiAssetCatalog = {\n  schemaRevision = ${lua(catalog.schemaRevision)},\n  memoryFormulaRevision = ${lua(catalog.memoryFormulaRevision)},\n  revision = ${lua(catalog.revision)},\n  generationId = ${lua(generationId)},\n  entries = ${lua(catalog.entries)}\n}\nreturn UiAssetCatalog\n`
}
