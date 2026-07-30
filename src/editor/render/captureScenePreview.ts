/**
 * Capture a 400×240 (scene size) Playdate framebuffer PNG for Nibble context.
 */
import { SCREEN_H, SCREEN_W } from '../../core/constants'
import type { IndexedAsset } from '../../core/assets/types'
import type { Scene, SceneNode } from '../../core/scene/types'
import { flattenNodes } from '../state/nodeTree'
import { drawSceneToCanvas } from './drawSceneToCanvas'
import {
  resolveImagetable,
  sliceMatrixFrames,
  type FrameBitmap,
} from './imagetable'

function resolveImageUrl(
  basePath: string,
  assets: IndexedAsset[],
): string | null {
  const slice = assets.find(
    (a) => a.basePath === basePath && a.kind === 'slice',
  )
  if (slice) return slice.previewUrl
  const image = assets.find(
    (a) => a.basePath === basePath && (a.kind === 'image' || a.kind === 'table'),
  )
  if (image) return image.previewUrl
  return `/__playdate/assets/${basePath}.png`
}

function loadImg(
  url: string,
  cache: Map<string, HTMLImageElement>,
): Promise<HTMLImageElement> {
  const hit = cache.get(url)
  if (hit?.complete) return Promise.resolve(hit)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      cache.set(url, img)
      resolve(img)
    }
    img.onerror = () => reject(new Error(url))
    img.src = url
  })
}

/**
 * Draw the current scene at native Playdate resolution and return raw base64 PNG
 * (no `data:` prefix). Returns null if the browser cannot create a 2d context.
 */
export async function captureScenePreviewPng(
  scene: Scene,
  assets: IndexedAsset[],
  state?: string,
): Promise<string | null> {
  const w = scene.width || SCREEN_W
  const h = scene.height || SCREEN_H
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const cache = new Map<string, HTMLImageElement>()
  const tableCache = new Map<string, FrameBitmap[]>()

  const makeCanvas = (cw: number, ch: number) => {
    const c = document.createElement('canvas')
    c.width = cw
    c.height = ch
    return c
  }

  const loadTableFrames = async (
    basePath: string,
  ): Promise<FrameBitmap[] | null> => {
    if (tableCache.has(basePath)) return tableCache.get(basePath)!
    const refTab = resolveImagetable(basePath, assets)
    if (!refTab) return null
    if (refTab.kind === 'matrix') {
      const sheet = await loadImg(refTab.sheetUrl, cache)
      const frames = sliceMatrixFrames(
        sheet,
        refTab.cellW,
        refTab.cellH,
        makeCanvas,
      )
      tableCache.set(basePath, frames)
      return frames
    }
    const frames: FrameBitmap[] = []
    for (const f of refTab.frames) {
      const img = await loadImg(f.url, cache)
      const c = makeCanvas(img.width, img.height)
      const cctx = c.getContext('2d')
      if (cctx) {
        cctx.imageSmoothingEnabled = false
        cctx.drawImage(img, 0, 0)
      }
      frames.push(c)
    }
    tableCache.set(basePath, frames)
    return frames
  }

  const flat = flattenNodes(scene.nodes)
  const paths = new Set<string>()
  for (const n of flat) {
    if (n.type === 'panel' || n.type === 'image') paths.add(n.asset)
  }
  await Promise.all(
    [...paths].map(async (p) => {
      try {
        const tab = await loadTableFrames(p)
        if (!tab) {
          const url = resolveImageUrl(p, assets)
          if (url) await loadImg(url, cache)
        }
      } catch {
        /* missing asset */
      }
    }),
  )

  await drawSceneToCanvas(
    ctx,
    scene,
    {
      list: assets,
      timeSec: 0,
      getImage: (basePath) => {
        const url = resolveImageUrl(basePath, assets)
        if (!url) return null
        return cache.get(url) ?? null
      },
      getImagetableFrames: (basePath) => {
        const hit = tableCache.get(basePath)
        return hit && hit.length > 0
          ? (hit as unknown as HTMLCanvasElement[])
          : null
      },
    },
    { state },
  )

  const dataUrl = canvas.toDataURL('image/png')
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : null
}

/** @internal exported for tests that need flatten without editor imports */
export function collectAssetPaths(nodes: SceneNode[]): string[] {
  const paths = new Set<string>()
  for (const n of flattenNodes(nodes)) {
    if (n.type === 'panel' || n.type === 'image') paths.add(n.asset)
  }
  return [...paths]
}
