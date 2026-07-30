import type { AssetKind } from '../../core/assets/parseAssetName'
import type { IndexedAsset } from '../../core/assets/types'

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.png$/i, '').replace(/\.fnt$/i, '')
}

export class AssetRegistry {
  private assets: IndexedAsset[] = []
  private byBasePath = new Map<string, IndexedAsset>()
  private byRelativePath = new Map<string, IndexedAsset>()

  constructor(assets: IndexedAsset[] = []) {
    this.replace(assets)
  }

  replace(assets: IndexedAsset[]): void {
    this.assets = assets
    this.byBasePath.clear()
    this.byRelativePath.clear()
    for (const asset of assets) {
      if (!this.byBasePath.has(asset.basePath)) {
        this.byBasePath.set(asset.basePath, asset)
      }
      this.byRelativePath.set(asset.relativePath.replace(/\\/g, '/'), asset)
    }
  }

  list(): IndexedAsset[] {
    return this.assets
  }

  findByBasePath(path: string): IndexedAsset | undefined {
    const key = normalizePath(path)
    return this.byBasePath.get(key) ?? this.byBasePath.get(path)
  }

  findByRelativePath(path: string): IndexedAsset | undefined {
    const rel = path.replace(/\\/g, '/')
    return (
      this.byRelativePath.get(rel) ??
      this.byRelativePath.get(rel.replace(/^\/+/, ''))
    )
  }

  filterByKind(kind: AssetKind): IndexedAsset[] {
    return this.assets.filter((a) => a.kind === kind)
  }

  filter(
    predicate: (asset: IndexedAsset) => boolean,
  ): IndexedAsset[] {
    return this.assets.filter(predicate)
  }

  search(query: string): IndexedAsset[] {
    const q = query.trim().toLowerCase()
    if (!q) return this.assets
    return this.assets.filter(
      (a) =>
        a.basePath.toLowerCase().includes(q) ||
        a.relativePath.toLowerCase().includes(q) ||
        a.fileStem.toLowerCase().includes(q) ||
        a.kind.includes(q),
    )
  }

  /** Map keyed by basePath for NodeRenderer lookup. */
  asBasePathMap(): Map<string, IndexedAsset> {
    return new Map(this.byBasePath)
  }
}

export function createAssetRegistry(assets: IndexedAsset[] = []): AssetRegistry {
  return new AssetRegistry(assets)
}
