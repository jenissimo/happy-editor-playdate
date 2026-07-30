import { useEffect, useRef } from 'react'
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

type Props = {
  scene: Scene
  assets: IndexedAsset[]
  state?: string
  className?: string
}

function resolveImageUrl(basePath: string, assets: IndexedAsset[]): string | null {
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

function sceneNeedsAnim(nodes: SceneNode[]): boolean {
  for (const n of flattenNodes(nodes)) {
    if (n.type === 'image' && (n.fps ?? 0) > 0) return true
  }
  return false
}

/** 400×240 Playdate framebuffer preview (shared draw path with visual-parity). */
export function SceneCanvasPreview({
  scene,
  assets,
  state,
  className,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const w = scene.width || SCREEN_W
    const h = scene.height || SCREEN_H
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let cancelled = false
    let raf = 0
    const cache = new Map<string, HTMLImageElement>()
    const tableCache = new Map<string, FrameBitmap[]>()
    const t0 = performance.now()

    const makeCanvas = (cw: number, ch: number) => {
      const c = document.createElement('canvas')
      c.width = cw
      c.height = ch
      return c
    }

    const loadImg = (url: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const hit = cache.get(url)
        if (hit?.complete) {
          resolve(hit)
          return
        }
        const img = new Image()
        img.onload = () => {
          cache.set(url, img)
          resolve(img)
        }
        img.onerror = () => reject(new Error(url))
        img.src = url
      })

    const loadTableFrames = async (
      basePath: string,
    ): Promise<FrameBitmap[] | null> => {
      if (tableCache.has(basePath)) return tableCache.get(basePath)!
      const refTab = resolveImagetable(basePath, assets)
      if (!refTab) return null
      if (refTab.kind === 'matrix') {
        const sheet = await loadImg(refTab.sheetUrl)
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
        const img = await loadImg(f.url)
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

    const paint = async (timeSec: number) => {
      if (cancelled || !ref.current) return
      const cctx = ref.current.getContext('2d')
      if (!cctx) return
      await drawSceneToCanvas(
        cctx,
        scene,
        {
          list: assets,
          timeSec,
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
    }

    void (async () => {
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
              if (url) await loadImg(url)
            }
          } catch {
            /* missing */
          }
        }),
      )
      if (cancelled) return

      const animate = sceneNeedsAnim(scene.nodes)
      if (!animate) {
        await paint(0)
        return
      }

      let painting = false
      const tick = () => {
        if (cancelled) return
        const timeSec = (performance.now() - t0) / 1000
        if (!painting) {
          painting = true
          void paint(timeSec).finally(() => {
            painting = false
          })
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [scene, assets, state])

  return (
    <canvas
      ref={ref}
      className={className}
      width={scene.width || SCREEN_W}
      height={scene.height || SCREEN_H}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        imageRendering: 'pixelated',
        background: 'transparent',
      }}
    />
  )
}
