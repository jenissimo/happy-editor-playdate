/**
 * Playdate bitmap font (.fnt + *-table-W-H.png atlas) loader / renderer.
 * Spec: https://github.com/cranksters/playdate-reverse-engineering/blob/main/formats/fnt.md
 */

import { DEFAULT_FONT } from '../../core/scene/defaults'
import type { Ink, TextOutline, TextShadow } from '../../core/scene/types'

export { DEFAULT_FONT }

/** Resolve empty/missing font path to the bundled Playdate default. */
export function resolveFontPath(fontPath: string | null | undefined): string {
  if (fontPath == null || fontPath === '') return DEFAULT_FONT
  return fontPath
}

export type PlaydateGlyph = {
  char: string
  /** Advance width in pixels (may be < cellW). */
  width: number
  /** Index into the atlas sheet (row-major). */
  index: number
}

export type PlaydateFontData = {
  tracking: number
  cellW: number
  cellH: number
  glyphs: PlaydateGlyph[]
  byChar: Map<string, PlaydateGlyph>
  /** kern pair "ab" → offset */
  kerning: Map<string, number>
  atlasUrl: string
}

export type LoadedPlaydateFont = PlaydateFontData & {
  atlas: HTMLCanvasElement | HTMLImageElement | ImageBitmap
  cols: number
}

const cache = new Map<string, Promise<LoadedPlaydateFont | null>>()

function parseFntLine(
  line: string,
):
  | { kind: 'meta'; key: string; value: string }
  | { kind: 'glyph'; char: string; width: number }
  | { kind: 'kern'; a: string; b: string; offset: number }
  | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('--')) return null

  const eq = trimmed.indexOf('=')
  if (eq > 0 && !/\s/.test(trimmed.slice(0, eq))) {
    return {
      kind: 'meta',
      key: trimmed.slice(0, eq).trim(),
      value: trimmed.slice(eq + 1).trim(),
    }
  }

  const m = trimmed.match(/^(.+?)\s+(-?\d+)\s*$/)
  if (!m) return null
  const key = m[1]!
  const num = Number(m[2])
  if (key === 'space') return { kind: 'glyph', char: ' ', width: num }

  const cps = [...key]
  if (cps.length === 1) return { kind: 'glyph', char: cps[0]!, width: num }
  if (cps.length === 2) {
    return { kind: 'kern', a: cps[0]!, b: cps[1]!, offset: num }
  }
  return null
}

export function parsePlaydateFnt(
  text: string,
  cellW: number,
  cellH: number,
  atlasUrl: string,
): PlaydateFontData {
  let tracking = 1
  const glyphs: PlaydateGlyph[] = []
  const byChar = new Map<string, PlaydateGlyph>()
  const kerning = new Map<string, number>()

  for (const raw of text.split(/\r?\n/)) {
    const parsed = parseFntLine(raw)
    if (!parsed) continue
    if (parsed.kind === 'meta') {
      if (parsed.key === 'tracking') tracking = Number(parsed.value) || 0
      if (parsed.key === 'width') cellW = Number(parsed.value) || cellW
      if (parsed.key === 'height') cellH = Number(parsed.value) || cellH
      continue
    }
    if (parsed.kind === 'glyph') {
      const g: PlaydateGlyph = {
        char: parsed.char,
        width: parsed.width,
        index: glyphs.length,
      }
      glyphs.push(g)
      byChar.set(parsed.char, g)
      continue
    }
    if (parsed.kind === 'kern') {
      kerning.set(parsed.a + parsed.b, parsed.offset)
    }
  }

  return { tracking, cellW, cellH, glyphs, byChar, kerning, atlasUrl }
}

export type FontLoadHooks = {
  loadAtlas?: (url: string) => Promise<CanvasImageSource>
  readFnt?: (url: string) => Promise<string>
  createCanvas?: (
    w: number,
    h: number,
  ) => {
    width: number
    height: number
    getContext: (id: '2d') => CanvasRenderingContext2D | null
  }
}

let hooks: FontLoadHooks = {}

export function setPlaydateFontHooks(next: FontLoadHooks) {
  hooks = next
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load ${url}`))
    img.src = url
  })
}

export type FontAssetRefs = {
  fntUrl: string
  atlasUrl: string
  cellW: number
  cellH: number
}

/** Resolve .fnt + atlas table for a Playdate font base path. */
export function resolveFontAssets(
  fontBasePath: string,
  assets: Array<{
    basePath: string
    kind: string
    relativePath: string
    previewUrl: string
    cell?: { w: number; h: number }
    extension: string
  }>,
): FontAssetRefs | null {
  if (!fontBasePath) return null
  const norm = fontBasePath.replace(/\\/g, '/').replace(/\.fnt$/i, '')
  const font = assets.find(
    (a) => a.kind === 'font' && a.basePath === norm,
  )
  const table = assets.find(
    (a) => a.kind === 'table' && a.basePath === norm && a.cell,
  )
  if (!font || !table?.cell) return null
  return {
    fntUrl: font.previewUrl,
    atlasUrl: table.previewUrl,
    cellW: table.cell.w,
    cellH: table.cell.h,
  }
}

export async function loadPlaydateFont(
  refs: FontAssetRefs,
): Promise<LoadedPlaydateFont | null> {
  const key = `v3|${refs.fntUrl}|${refs.atlasUrl}`
  const existing = cache.get(key)
  if (existing) return existing

  const promise = (async () => {
    try {
      const readFnt =
        hooks.readFnt ??
        ((url: string) =>
          fetch(url).then((r) => {
            if (!r.ok) throw new Error(`fnt ${r.status}`)
            return r.text()
          }))
      const loadAtlas = hooks.loadAtlas ?? loadImage

      const [fntText, atlas] = await Promise.all([
        readFnt(refs.fntUrl),
        loadAtlas(refs.atlasUrl),
      ])
      const data = parsePlaydateFnt(
        fntText,
        refs.cellW,
        refs.cellH,
        refs.atlasUrl,
      )

      const aw =
        'naturalWidth' in atlas &&
        typeof (atlas as HTMLImageElement).naturalWidth === 'number' &&
        (atlas as HTMLImageElement).naturalWidth > 0
          ? (atlas as HTMLImageElement).naturalWidth
          : (atlas as { width: number }).width
      const ah =
        'naturalHeight' in atlas &&
        typeof (atlas as HTMLImageElement).naturalHeight === 'number' &&
        (atlas as HTMLImageElement).naturalHeight > 0
          ? (atlas as HTMLImageElement).naturalHeight
          : (atlas as { height: number }).height

      const cols = Math.max(1, Math.floor(aw / data.cellW))

      const make =
        hooks.createCanvas ??
        ((w: number, h: number) => {
          const c = document.createElement('canvas')
          c.width = w
          c.height = h
          return c
        })

      const sheet = make(aw, ah)
      const sctx = sheet.getContext('2d')
      if (!sctx) return null
      sctx.drawImage(atlas, 0, 0)
      const img = sctx.getImageData(0, 0, aw, ah)
      const px = img.data

      // Detect atlas polarity among opaque pixels:
      // - black-on-transparent/white (common via skia/napi): keep dark
      // - white-on-black (browser decode of 1-bit PD fonts): keep light
      let opaqueDark = 0
      let opaqueLight = 0
      for (let i = 0; i < px.length; i += 4) {
        if ((px[i + 3] ?? 0) < 16) continue
        const lum = (px[i]! + px[i + 1]! + px[i + 2]!) / 3
        if (lum >= 128) opaqueLight++
        else opaqueDark++
      }
      const keepLight = opaqueLight > opaqueDark

      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3]!
        const lum = (px[i]! + px[i + 1]! + px[i + 2]!) / 3
        const isInk = keepLight
          ? a >= 16 && lum >= 128
          : a >= 16 && lum < 128
        if (isInk) {
          px[i] = 0
          px[i + 1] = 0
          px[i + 2] = 0
          px[i + 3] = 255
        } else {
          px[i + 3] = 0
        }
      }
      sctx.putImageData(img, 0, 0)

      return { ...data, atlas: sheet as HTMLCanvasElement, cols }
    } catch (e) {
      console.warn('[playdateFont] load failed', refs.fntUrl, e)
      return null
    }
  })()

  cache.set(key, promise)
  return promise
}

export function measureGlyphRun(
  font: LoadedPlaydateFont,
  text: string,
): number {
  let w = 0
  let prev: string | null = null
  for (const ch of text) {
    const g = font.byChar.get(ch)
    if (!g) {
      prev = null
      continue
    }
    if (prev != null) {
      w += font.tracking
      const kern = font.kerning.get(prev + ch)
      if (kern) w += kern
    }
    w += g.width
    prev = ch
  }
  return w
}

export function wrapBitmapText(
  font: LoadedPlaydateFont,
  text: string,
  maxWidth: number,
): string[] {
  const paragraphs = text.replace(/\r\n/g, '\n').split('\n')
  const lines: string[] = []
  for (const para of paragraphs) {
    if (para.length === 0) {
      lines.push('')
      continue
    }
    let line = ''
    for (const ch of para) {
      const next = line + ch
      if (line && measureGlyphRun(font, next) > maxWidth) {
        lines.push(line)
        line = ch
      } else {
        line = next
      }
    }
    lines.push(line)
  }
  return lines
}

export type DrawBitmapTextOpts = {
  text: string
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  x?: number
  y?: number
  width: number
  height: number
  /** Fill ink for the main glyphs (default black). */
  color?: Ink
  /** CSS override; wins over `color` when set. */
  fillStyle?: string
  outline?: TextOutline | null
  shadow?: TextShadow | null
  /**
   * Integer nearest-neighbor glyph scale. Omitted / 1 = native .fnt size.
   * Layout uses floor(w/scale)×floor(h/scale) font pixels, then upscales.
   */
  scale?: number
}

/** Clamp text node scale to a crisp integer in 1..8. */
export function normalizeTextScale(scale?: number | null): number {
  if (scale == null || !Number.isFinite(scale)) return 1
  return Math.max(1, Math.min(8, Math.floor(scale)))
}

function makeScratchCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h)
  }
  const doc = (
    globalThis as unknown as {
      document?: { createElement: (t: string) => HTMLCanvasElement }
    }
  ).document
  if (!doc) return null
  const c = doc.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** Pixels reserved so outline/shadow rings fit inside the text box. */
export function textEffectPad(
  outline?: TextOutline | null,
  shadow?: TextShadow | null,
): number {
  let pad = 0
  if (outline) {
    let extent = Math.max(1, Math.round(outline.width))
    if (outline.outer) {
      extent += Math.max(1, Math.round(outline.outer.width))
    }
    pad = Math.max(pad, extent)
  }
  if (shadow) {
    pad = Math.max(pad, Math.abs(shadow.x), Math.abs(shadow.y))
  }
  return pad
}

const OUTLINE_DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
]

function inkToCss(ink: Ink): string {
  return ink === 'white' ? '#ffffff' : '#000000'
}

/** Reused for non-black glyph tinting (avoids wiping neighbors via destination-in). */
let tintScratch: HTMLCanvasElement | null = null
let tintScratchCtx: CanvasRenderingContext2D | null = null

function getTintScratch(
  w: number,
  h: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null
  if (!tintScratch || tintScratch.width < w || tintScratch.height < h) {
    const c = document.createElement('canvas')
    c.width = Math.max(w, 32)
    c.height = Math.max(h, 32)
    tintScratch = c
    tintScratchCtx = c.getContext('2d')
  }
  if (!tintScratchCtx) return null
  return { canvas: tintScratch, ctx: tintScratchCtx }
}

type Any2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function drawGlyphColored(
  ctx: Any2D,
  font: LoadedPlaydateFont,
  g: PlaydateGlyph,
  dx: number,
  dy: number,
  css: string,
): void {
  const col = g.index % font.cols
  const row = Math.floor(g.index / font.cols)
  const sx = col * font.cellW
  const sy = row * font.cellH
  const isBlack = css === '#000000' || css === '#000' || css === '#0a0a0a'

  if (isBlack) {
    ctx.drawImage(
      font.atlas,
      sx,
      sy,
      g.width,
      font.cellH,
      dx,
      dy,
      g.width,
      font.cellH,
    )
    return
  }

  const scratch = getTintScratch(g.width, font.cellH)
  if (!scratch) return
  const { canvas, ctx: sctx } = scratch
  sctx.setTransform(1, 0, 0, 1, 0, 0)
  sctx.clearRect(0, 0, g.width, font.cellH)
  sctx.globalCompositeOperation = 'source-over'
  sctx.drawImage(
    font.atlas,
    sx,
    sy,
    g.width,
    font.cellH,
    0,
    0,
    g.width,
    font.cellH,
  )
  sctx.globalCompositeOperation = 'source-in'
  sctx.fillStyle = css
  sctx.fillRect(0, 0, g.width, font.cellH)
  sctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(canvas, 0, 0, g.width, font.cellH, dx, dy, g.width, font.cellH)
}

function paintBitmapTextPass(
  ctx: Any2D,
  font: LoadedPlaydateFont,
  lines: string[],
  opts: {
    align: 'left' | 'center' | 'right'
    baseX: number
    baseY: number
    width: number
    height: number
    offsetX: number
    offsetY: number
    lineH: number
    textOffsetY: number
    css: string
  },
): void {
  const {
    align,
    baseX,
    baseY,
    width,
    height,
    offsetX,
    offsetY,
    lineH,
    textOffsetY,
    css,
  } = opts
  const x = baseX + offsetX
  const y = baseY + offsetY

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineW = measureGlyphRun(font, line)
    let cursorX =
      align === 'center'
        ? x + Math.round((width - lineW) / 2)
        : align === 'right'
          ? x + (width - lineW)
          : x
    const cursorY = y + textOffsetY + i * lineH
    if (cursorY + lineH <= baseY || cursorY >= baseY + height) continue

    let prev: string | null = null
    for (const ch of line) {
      const g = font.byChar.get(ch)
      if (!g) {
        prev = null
        continue
      }
      if (prev != null) {
        cursorX += font.tracking
        const kern = font.kerning.get(prev + ch)
        if (kern) cursorX += kern
      }
      drawGlyphColored(ctx, font, g, cursorX, cursorY, css)
      cursorX += g.width
      prev = ch
    }
  }
}

/** Draw 1-bit style text into a 2D context. Order: shadow → outer → inner → fill. */
export function drawBitmapText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  font: LoadedPlaydateFont,
  opts: DrawBitmapTextOpts,
): void {
  const {
    text,
    align = 'left',
    valign = 'top',
    color = 'black',
    fillStyle,
    outline = null,
    shadow = null,
  } = opts

  const boxX = opts.x ?? 0
  const boxY = opts.y ?? 0
  const boxW = opts.width
  const boxH = opts.height

  // Inset so outline/shadow rings aren't clipped on left/top-aligned edges.
  const pad = textEffectPad(outline, shadow)
  let x = boxX
  let y = boxY
  let width = boxW
  let height = boxH
  if (pad > 0 && width > pad * 2 && height > pad * 2) {
    x += pad
    y += pad
    width -= pad * 2
    height -= pad * 2
  }

  const lines = wrapBitmapText(font, text, width)
  const lineH = font.cellH
  const textH = lines.length * lineH
  let textOffsetY = 0
  if (valign === 'middle') textOffsetY = Math.round((height - textH) / 2)
  else if (valign === 'bottom') textOffsetY = height - textH

  const fillCss = fillStyle ?? inkToCss(color)

  ctx.save()
  ctx.beginPath()
  ctx.rect(boxX, boxY, boxW, boxH)
  ctx.clip()
  ctx.imageSmoothingEnabled = false

  const passBase = {
    align,
    baseX: x,
    baseY: y,
    width,
    height,
    lineH,
    textOffsetY,
  }

  if (shadow) {
    paintBitmapTextPass(ctx, font, lines, {
      ...passBase,
      offsetX: shadow.x,
      offsetY: shadow.y,
      css: inkToCss(shadow.color),
    })
  }

  if (outline) {
    const ow = Math.max(1, Math.round(outline.width))
    const paintRing = (fromR: number, toR: number, css: string) => {
      for (let r = fromR; r <= toR; r++) {
        for (const [dx, dy] of OUTLINE_DIRS) {
          paintBitmapTextPass(ctx, font, lines, {
            ...passBase,
            offsetX: dx * r,
            offsetY: dy * r,
            css,
          })
        }
      }
    }
    // Outer first, then inner — so rings stack white-inside / black-outside.
    if (outline.outer) {
      const oow = Math.max(1, Math.round(outline.outer.width))
      paintRing(ow + 1, ow + oow, inkToCss(outline.outer.color))
    }
    paintRing(1, ow, inkToCss(outline.color))
  }

  paintBitmapTextPass(ctx, font, lines, {
    ...passBase,
    offsetX: 0,
    offsetY: 0,
    css: fillCss,
  })

  ctx.restore()
}

/**
 * Draw text with optional integer nearest-neighbor scale.
 * `scale` 1 (default) is identical to {@link drawBitmapText}.
 */
export function drawBitmapTextScaled(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  font: LoadedPlaydateFont,
  opts: DrawBitmapTextOpts,
): void {
  const s = normalizeTextScale(opts.scale)
  if (s === 1) {
    drawBitmapText(ctx, font, opts)
    return
  }

  const boxX = opts.x ?? 0
  const boxY = opts.y ?? 0
  const boxW = opts.width
  const boxH = opts.height
  const lw = Math.max(1, Math.floor(boxW / s))
  const lh = Math.max(1, Math.floor(boxH / s))
  const off = makeScratchCanvas(lw, lh)
  if (!off) {
    drawBitmapText(ctx, font, opts)
    return
  }
  if ('width' in off) {
    off.width = lw
    off.height = lh
  }
  const octx = off.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!octx) {
    drawBitmapText(ctx, font, opts)
    return
  }
  octx.imageSmoothingEnabled = false
  drawBitmapText(octx, font, {
    ...opts,
    x: 0,
    y: 0,
    width: lw,
    height: lh,
    scale: undefined,
  })

  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.beginPath()
  ctx.rect(boxX, boxY, boxW, boxH)
  ctx.clip()
  ctx.drawImage(off as CanvasImageSource, 0, 0, lw, lh, boxX, boxY, lw * s, lh * s)
  ctx.restore()
}

/** Clear cache (tests / HMR). */
export function clearPlaydateFontCache() {
  cache.clear()
}
