import type { ParsedAsset } from './parseAssetName'

export type IndexedAsset = ParsedAsset & {
  path: string
  relativePath: string
  previewUrl: string
  sizeBytes: number
  mtimeMs: number
  /** Intrinsic pixel size for raster images (from PNG IHDR). */
  pixelWidth?: number
  pixelHeight?: number
}

