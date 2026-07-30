import { SCREEN_H, SCREEN_W } from '../../core/constants'
import type { IndexedAsset } from '../../core/assets/types'
import type { Scene, SceneNode } from '../../core/scene/types'
import {
  drawBitmapText,
  loadPlaydateFont,
  resolveFontAssets,
  resolveFontPath,
  type LoadedPlaydateFont,
} from '../fonts/playdateFont'
import { drawRotatedNearest } from './drawRotated'
import { animFrameIndex, imageAnimParams } from './imagetable'
import { applyImageTint } from './imageTint'
import { asPlaydateBitmap, type CanvasFactory } from './playdateImage'
import { rasterizeShape } from './procedural'

export type CanvasImage = CanvasImageSource & {
  width: number
  height: number
}

export type SceneDrawAssets = {
  /** Resolve image/slice PNG by asset basePath (without -slice suffix for panels). */
  getImage: (basePath: string) => CanvasImage | null
  /**
   * Optional imagetable frames for `basePath` (0-based array).
   * Playdate frame `i` (1-based) → `frames[i - 1]`.
   */
  getImagetableFrames?: (basePath: string) => CanvasImage[] | null
  /** Animation clock seconds (shared with Ui._time). */
  timeSec?: number
  /** All indexed assets (for font .fnt + table lookup). */
  list: IndexedAsset[]
  /** Optional: absolute/URL override for font loading in Node. */
  fontUrlFor?: (relativePath: string) => string
  /** Optional canvas factory for Node (@napi-rs/canvas). */
  createCanvas?: CanvasFactory
}

function topLeft(node: SceneNode): { x: number; y: number } {
  return {
    x: node.x - node.anchor.x * node.w,
    y: node.y - node.anchor.y * node.h,
  }
}

function nodeVisible(node: SceneNode, state: string): boolean {
  if (!node.visible) return false
  if (!node.states || node.states.length === 0) return true
  return node.states.includes(state)
}

type Any2D =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D

function drawNineSlice(
  ctx: Any2D,
  img: CanvasImage,
  slice: { left: number; right: number; top: number; bottom: number },
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const nw = 'naturalWidth' in img && typeof img.naturalWidth === 'number'
    ? img.naturalWidth || img.width
    : img.width
  const nh = 'naturalHeight' in img && typeof img.naturalHeight === 'number'
    ? img.naturalHeight || img.height
    : img.height
  const L = Math.max(0, Math.min(slice.left, nw))
  const R = Math.max(0, Math.min(slice.right, nw - L))
  const T = Math.max(0, Math.min(slice.top, nh))
  const B = Math.max(0, Math.min(slice.bottom, nh - T))
  const midW = Math.max(0, nw - L - R)
  const midH = Math.max(0, nh - T - B)

  // Playdate nineSlice tiles stretchable patches (drawTiled), not scale.
  let outW = Math.floor(dw)
  let outH = Math.floor(dh)
  const minW = L + R
  const minH = T + B
  if (outW < minW) outW = minW
  if (outH < minH) outH = minH
  const outMidW = Math.max(0, outW - L - R)
  const outMidH = Math.max(0, outH - T - B)

  const blit = (
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    x: number,
    y: number,
  ) => {
    if (sw <= 0 || sh <= 0) return
    ctx.drawImage(img, sx, sy, sw, sh, x, y, sw, sh)
  }

  const tile = (
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    x: number,
    y: number,
    tw: number,
    th: number,
  ) => {
    if (sw <= 0 || sh <= 0 || tw <= 0 || th <= 0) return
    for (let oy = 0; oy < th; oy += sh) {
      for (let ox = 0; ox < tw; ox += sw) {
        const cw = Math.min(sw, tw - ox)
        const ch = Math.min(sh, th - oy)
        ctx.drawImage(img, sx, sy, cw, ch, x + ox, y + oy, cw, ch)
      }
    }
  }

  blit(0, 0, L, T, dx, dy)
  tile(L, 0, midW, T, dx + L, dy, outMidW, T)
  blit(nw - R, 0, R, T, dx + L + outMidW, dy)

  tile(0, T, L, midH, dx, dy + T, L, outMidH)
  tile(L, T, midW, midH, dx + L, dy + T, outMidW, outMidH)
  tile(nw - R, T, R, midH, dx + L + outMidW, dy + T, R, outMidH)

  blit(0, nh - B, L, B, dx, dy + T + outMidH)
  tile(L, nh - B, midW, B, dx + L, dy + T + outMidH, outMidW, B)
  blit(nw - R, nh - B, R, B, dx + L + outMidW, dy + T + outMidH)
}

function drawFrame(
  ctx: Any2D,
  node: Extract<SceneNode, { type: 'frame' }>,
  x: number,
  y: number,
) {
  const t = Math.max(1, node.thickness)
  ctx.strokeStyle = '#000'
  ctx.fillStyle = '#000'
  if (node.style === 'double') {
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, node.w - 1, node.h - 1)
    const inset = t + 1
    ctx.strokeRect(
      x + inset + 0.5,
      y + inset + 0.5,
      node.w - 2 * inset - 1,
      node.h - 2 * inset - 1,
    )
  } else if (node.style === 'ticks') {
    const st = 6
    ctx.lineWidth = 1
    for (let i = 0; i < node.w; i += st * 2) {
      const x2 = Math.min(i + st, node.w - 1)
      ctx.fillRect(x + i, y, x2 - i + 1, 1)
      ctx.fillRect(x + i, y + node.h - 1, x2 - i + 1, 1)
    }
    for (let i = 0; i < node.h; i += st * 2) {
      const y2 = Math.min(i + st, node.h - 1)
      ctx.fillRect(x, y + i, 1, y2 - i + 1)
      ctx.fillRect(x + node.w - 1, y + i, 1, y2 - i + 1)
    }
  } else {
    // Match ui.lua: concentric drawRect rings (setLineWidth alone ≠ inset rings on PD)
    for (let i = 0; i < t; i++) {
      const rw = node.w - 2 * i
      const rh = node.h - 2 * i
      if (rw <= 0 || rh <= 0) break
      ctx.strokeRect(x + i + 0.5, y + i + 0.5, rw - 1, rh - 1)
    }
  }
}

const fontCache = new Map<string, LoadedPlaydateFont | null>()

async function getFont(
  fontPath: string,
  assets: SceneDrawAssets,
): Promise<LoadedPlaydateFont | null> {
  const path = resolveFontPath(fontPath)
  if (fontCache.has(path)) return fontCache.get(path)!
  let list = assets.list
  if (assets.fontUrlFor) {
    list = list.map((a) =>
      a.kind === 'font' || a.kind === 'table'
        ? { ...a, previewUrl: assets.fontUrlFor!(a.relativePath) }
        : a,
    )
  }
  const refs = resolveFontAssets(path, list)
  const font = refs ? await loadPlaydateFont(refs) : null
  if (!font) {
    console.warn('[drawSceneToCanvas] font load failed:', path)
  }
  fontCache.set(path, font)
  return font
}

async function drawNodeContent(
  ctx: Any2D,
  node: SceneNode,
  x: number,
  y: number,
  assets: SceneDrawAssets,
) {
  const makeCanvas = assets.createCanvas
  const bit = (img: CanvasImage) =>
    asPlaydateBitmap(img, makeCanvas) as CanvasImage

  switch (node.type) {
    case 'panel': {
      const img = assets.getImage(node.asset)
      if (img) drawNineSlice(ctx, bit(img), node.slice, x, y, node.w, node.h)
      else {
        ctx.strokeStyle = '#000'
        ctx.strokeRect(x + 0.5, y + 0.5, node.w - 1, node.h - 1)
      }
      break
    }
    case 'image': {
      const frames = assets.getImagetableFrames?.(node.asset)
      let drew = false
      if (frames && frames.length > 0) {
        const p = imageAnimParams(node, frames.length)
        const idx = animFrameIndex({
          timeSec: assets.timeSec ?? 0,
          fps: p.fps,
          loop: p.loop,
          frameStart: p.frameStart,
          frameEnd: Math.min(p.frameEnd, frames.length),
          staticFrame: p.staticFrame,
        })
        const frame = frames[idx - 1]
        if (frame) {
          const src = bit(frame as CanvasImage)
          ctx.drawImage(src, x, y)
          applyImageTint(ctx, x, y, src.width, src.height, node.tint)
          drew = true
        }
      } else {
        const img = assets.getImage(node.asset)
        if (img) {
          const src = bit(img)
          ctx.drawImage(src, x, y)
          applyImageTint(ctx, x, y, src.width, src.height, node.tint)
          drew = true
        }
      }
      if (!drew) {
        ctx.strokeStyle = '#000'
        ctx.strokeRect(x + 0.5, y + 0.5, node.w - 1, node.h - 1)
      }
      break
    }
    case 'frame':
      drawFrame(ctx, node, x, y)
      break
    case 'shape': {
      const id = rasterizeShape(node, { originX: x, originY: y })
      const make =
        assets.createCanvas ??
        ((sw: number, sh: number) => {
          if (typeof OffscreenCanvas !== 'undefined') {
            return new OffscreenCanvas(sw, sh)
          }
          const c = (
            globalThis as unknown as {
              document?: { createElement: (t: string) => HTMLCanvasElement }
            }
          ).document?.createElement('canvas')
          if (!c) throw new Error('No canvas factory for shape blit')
          c.width = sw
          c.height = sh
          return c
        })
      const tmp = make(id.width, id.height)
      const tctx = tmp.getContext('2d')
      if (tctx) {
        tctx.putImageData(id, 0, 0)
        ctx.drawImage(tmp as CanvasImageSource, x, y)
      }
      break
    }
    case 'text': {
      const font = await getFont(node.font, assets)
      if (font) {
        drawBitmapText(ctx, font, {
          text: node.text,
          align: node.align,
          valign: node.valign ?? 'top',
          x,
          y,
          width: node.w,
          height: node.h,
          color: node.color ?? 'black',
          outline: node.outline,
          shadow: node.shadow,
        })
      }
      // No monospace/OS fallback — empty box if font cannot load.
      break
    }
    case 'group':
      for (const child of node.children) {
        await drawNode(ctx, child, assets, 'default')
      }
      break
  }
}

async function drawNode(
  ctx: Any2D,
  node: SceneNode,
  assets: SceneDrawAssets,
  state: string,
) {
  if (!nodeVisible(node, state)) return
  if (node.type === 'group') {
    for (const child of node.children) {
      await drawNode(ctx, child, assets, state)
    }
    return
  }
  const { x, y } = topLeft(node)
  const rot = node.rotation ?? 0
  if (!rot) {
    await drawNodeContent(ctx, node, x, y, assets)
    return
  }

  // Match ui.lua drawNodeRotated: rasterize to clear bitmap, then drawRotated.
  const w = Math.max(1, Math.round(node.w))
  const h = Math.max(1, Math.round(node.h))
  const make =
    assets.createCanvas ??
    ((sw: number, sh: number) => {
      if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(sw, sh)
      const c = document.createElement('canvas')
      c.width = sw
      c.height = sh
      return c
    })
  const tmp = make(w, h)
  const tctx = tmp.getContext('2d')
  if (!tctx) {
    await drawNodeContent(ctx, node, x, y, assets)
    return
  }
  tctx.imageSmoothingEnabled = false
  tctx.clearRect(0, 0, w, h)
  // Content at (0,0) — dither phase is local to the bitmap (same as Lua).
  await drawNodeContent(tctx, node, 0, 0, assets)

  const ax = node.anchor.x
  const ay = node.anchor.y
  const pivotLocalX = ax * w
  const pivotLocalY = ay * h
  const prx = pivotLocalX - w / 2
  const pry = pivotLocalY - h / 2
  const rad = (rot * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // clockwise rotation of pivot-relative-to-center (ui.lua)
  const rx = prx * cos + pry * sin
  const ry = -prx * sin + pry * cos
  drawRotatedNearest(
    ctx,
    tmp as CanvasImageSource,
    node.x - rx,
    node.y - ry,
    rot,
    make,
  )
}

/** Draw a scene into a 400×240 (or scene size) canvas context — Playdate white bg. */
export async function drawSceneToCanvas(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  assets: SceneDrawAssets,
  opts?: { width?: number; height?: number; state?: string },
): Promise<void> {
  const w = opts?.width ?? scene.width ?? SCREEN_W
  const h = opts?.height ?? scene.height ?? SCREEN_H
  const state = opts?.state ?? scene.defaultState ?? 'default'
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  for (const node of scene.nodes) {
    await drawNode(ctx, node, assets, state)
  }
}

export function clearSceneFontCache() {
  fontCache.clear()
}
