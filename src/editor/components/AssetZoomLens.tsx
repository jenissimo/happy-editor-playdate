import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { IndexedAsset } from '../../core/assets/types'
import { describeAsset } from '../../core/assets/parseAssetName'

type Props = {
  asset: IndexedAsset
  /** Preferred top-left of the lens in viewport coords */
  x: number
  y: number
}

const MAX = 256
const SCALE = 4

export function AssetZoomLens({ asset, x, y }: Props) {
  const [nat, setNat] = useState({ w: 32, h: 32 })
  const [pos, setPos] = useState({ left: x, top: y })

  // Integer pixel scale, capped so huge tables don't blow the screen
  const fitScale = Math.max(
    1,
    Math.min(
      SCALE,
      Math.floor(MAX / Math.max(nat.w, 1)),
      Math.floor(MAX / Math.max(nat.h, 1)),
    ),
  )
  const w = nat.w * fitScale
  const h = nat.h * fitScale

  useEffect(() => {
    const pad = 12
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = x
    let top = y
    const boxW = Math.max(w, 80) + 24
    const boxH = h + 48
    if (left + boxW > vw - pad) left = Math.max(pad, x - boxW - 8)
    if (top + boxH > vh - pad) top = Math.max(pad, vh - boxH - pad)
    setPos({ left, top })
  }, [x, y, w, h])

  return createPortal(
    <div
      className="asset-zoom"
      style={{ left: pos.left, top: pos.top }}
      role="presentation"
    >
      <div
        className="asset-zoom__frame checker"
        style={{ width: w, height: h }}
      >
        {asset.extension !== 'fnt' ? (
          <img
            src={asset.previewUrl}
            alt=""
            width={w}
            height={h}
            onLoad={(e) => {
              const img = e.currentTarget
              if (img.naturalWidth && img.naturalHeight) {
                setNat({ w: img.naturalWidth, h: img.naturalHeight })
              }
            }}
          />
        ) : (
          <span className="font-sample asset-zoom__font">Aa</span>
        )}
      </div>
      <div className="asset-zoom__meta">
        <span className="asset-zoom__name">
          {asset.relativePath.split('/').pop()}
        </span>
        <span className="asset-zoom__desc">
          {describeAsset(asset)} · ×{fitScale}
        </span>
      </div>
    </div>,
    document.body,
  )
}
