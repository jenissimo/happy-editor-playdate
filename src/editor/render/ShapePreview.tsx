import { useEffect, useRef } from 'react'
import type { ShapeNode } from '../../core/scene/types'
import { rasterizeShape } from './procedural'

export function ShapePreview({ node }: { node: ShapeNode }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const w = Math.max(1, Math.round(node.w))
    const h = Math.max(1, Math.round(node.h))
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, w, h)
    ctx.putImageData(
      rasterizeShape(node, { originX: node.x, originY: node.y }),
      0,
      0,
    )
  }, [
    node.x,
    node.y,
    node.w,
    node.h,
    node.cornerRadius,
    node.fill,
    node.stroke,
  ])

  return (
    <canvas
      ref={ref}
      className="node-renderer__shape"
      width={Math.max(1, Math.round(node.w))}
      height={Math.max(1, Math.round(node.h))}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        imageRendering: 'pixelated',
      }}
    />
  )
}
