import type { CSSProperties } from 'react'
import type { IndexedAsset } from '../../core/assets/types'
import type { SceneNode } from '../../core/scene/types'
import type { AssetRegistry } from '../assets/AssetRegistry'
import { BitmapText } from '../fonts/BitmapText'
import { nodeRect } from '../geometry'
import { NineSlice } from './NineSlice'
import { ShapePreview } from './ShapePreview'
import { TintedImage } from './TintedImage'

export type AssetLookup =
  | Map<string, IndexedAsset>
  | AssetRegistry
  | {
      findByBasePath: (path: string) => IndexedAsset | undefined
      list?: () => IndexedAsset[]
    }
  | IndexedAsset[]
  | undefined

type Props = {
  node: SceneNode
  assets?: AssetLookup
  interactive?: boolean
  className?: string
  /**
   * `absolute` — position via node rect (Game preview).
   * `fill` — fill parent that already owns the rect (Scene hit targets).
   */
  layout?: 'absolute' | 'fill'
}

function findAsset(assets: AssetLookup, basePath: string): IndexedAsset | undefined {
  if (!assets || !basePath) return undefined
  if (assets instanceof Map) return assets.get(basePath)
  if (Array.isArray(assets)) {
    return assets.find((a) => a.basePath === basePath)
  }
  return assets.findByBasePath(basePath)
}

function assetsList(assets: AssetLookup): IndexedAsset[] {
  if (!assets) return []
  if (Array.isArray(assets)) return assets
  if ('list' in assets && typeof assets.list === 'function') return assets.list()
  if (assets instanceof Map) return [...assets.values()]
  return []
}

function previewUrlFor(
  basePath: string,
  assets: AssetLookup,
): string | null {
  if (!basePath) return null
  const asset = findAsset(assets, basePath)
  if (asset?.previewUrl) return asset.previewUrl
  return `/__playdate/assets/${basePath}.png`
}

export function NodeRenderer({
  node,
  assets,
  interactive = true,
  className,
  layout = 'absolute',
}: Props) {
  if (!node.visible) return null

  const r = nodeRect(node)
  const rot = node.rotation ?? 0
  const origin = `${node.anchor.x * 100}% ${node.anchor.y * 100}%`
  const style: CSSProperties =
    layout === 'fill'
      ? {
          position: 'relative',
          width: '100%',
          height: '100%',
          pointerEvents: interactive ? 'auto' : 'none',
          imageRendering: 'pixelated',
        }
      : {
          position: 'absolute',
          left: r.left,
          top: r.top,
          width: node.w,
          height: node.h,
          transform: rot ? `rotate(${rot}deg)` : undefined,
          transformOrigin: origin,
          pointerEvents: interactive ? 'auto' : 'none',
          imageRendering: 'pixelated',
        }

  return (
    <div
      className={[
        'node-renderer',
        `node-renderer--${node.type}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-node-id={node.id}
      data-node-type={node.type}
      style={style}
    >
      <NodeContent node={node} assets={assets} interactive={interactive} />
    </div>
  )
}

function NodeContent({
  node,
  assets,
  interactive,
}: {
  node: SceneNode
  assets: AssetLookup
  interactive: boolean
}) {
  switch (node.type) {
    case 'text':
      return (
        <BitmapText
          text={node.text}
          fontPath={node.font}
          align={node.align}
          valign={node.valign ?? 'top'}
          width={node.w}
          height={node.h}
          assets={assetsList(assets)}
          color={node.color ?? 'black'}
          outline={node.outline}
          shadow={node.shadow}
        />
      )

    case 'image': {
      const src = previewUrlFor(node.asset, assets)
      if (!src) {
        return <div className="node-renderer__missing" title="Missing image" />
      }
      return (
        <TintedImage
          className="node-renderer__image"
          src={src}
          width={node.w}
          height={node.h}
          tint={node.tint}
          alt={node.name}
          draggable={false}
          style={{
            pointerEvents: interactive ? 'auto' : 'none',
          }}
        />
      )
    }

    case 'panel': {
      const src = previewUrlFor(node.asset, assets)
      if (!src) {
        return (
          <div
            className="node-renderer__missing"
            title={node.asset || 'Missing panel'}
            style={{
              width: '100%',
              height: '100%',
              border: '1px solid #000',
              background: '#fff',
              boxSizing: 'border-box',
            }}
          />
        )
      }
      return (
        <NineSlice
          src={src}
          slice={node.slice}
          width={node.w}
          height={node.h}
        />
      )
    }

    case 'frame':
      return (
        <div
          className={`node-renderer__frame style-${node.style}`}
          style={{
            width: '100%',
            height: '100%',
            borderStyle: node.style === 'double' ? 'double' : 'solid',
            borderWidth: node.thickness,
            borderColor: 'var(--pixel-black, #0a0a0a)',
            boxSizing: 'border-box',
            background:
              node.style === 'ticks'
                ? 'repeating-linear-gradient(90deg,#000 0 2px,transparent 2px 6px)'
                : 'transparent',
          }}
        />
      )

    case 'shape':
      return <ShapePreview node={node} />

    case 'group':
      return (
        <div
          className="node-renderer__group"
          style={{ width: '100%', height: '100%' }}
        >
          {node.children.map((child) => (
            <NodeRenderer
              key={child.id}
              node={child}
              assets={assets}
              interactive={interactive}
            />
          ))}
        </div>
      )
  }
}
