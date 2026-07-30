import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { parseAssetName } from './parseAssetName.ts'
import type { IndexedAsset } from './types.ts'
import { ROOT, SOURCE_DIR } from '../scene/io.ts'

export type { IndexedAsset } from './types.ts'

const IMAGE_EXT = new Set(['png', 'gif', 'jpg', 'jpeg'])
const FONT_EXT = new Set(['fnt'])

/** Read width/height from PNG IHDR without full decode. */
export function readPngSize(
  buf: Buffer,
): { width: number; height: number } | null {
  if (buf.length < 24) return null
  // 8-byte signature + 4 length + 4 'IHDR'
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  if (width < 1 || height < 1 || width > 4096 || height > 4096) return null
  return { width, height }
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

export function indexPlaydateAssets(
  sourceDir = SOURCE_DIR,
  root = ROOT,
): IndexedAsset[] {
  void root
  const files = walk(sourceDir)
  const assets: IndexedAsset[] = []

  for (const full of files) {
    const relativePath = relative(sourceDir, full).replace(/\\/g, '/')
    const parsed = parseAssetName(relativePath)
    if (!parsed) continue
    if (
      !IMAGE_EXT.has(parsed.extension) &&
      !FONT_EXT.has(parsed.extension)
    ) {
      continue
    }
    const st = statSync(full)
    let pixelWidth: number | undefined
    let pixelHeight: number | undefined
    if (IMAGE_EXT.has(parsed.extension)) {
      try {
        const buf = readFileSync(full)
        const size = readPngSize(buf)
        if (size) {
          pixelWidth = size.width
          pixelHeight = size.height
        }
      } catch {
        /* ignore */
      }
    }
    assets.push({
      ...parsed,
      path: full,
      relativePath,
      previewUrl: `/__playdate/assets/${relativePath}`,
      sizeBytes: st.size,
      mtimeMs: st.mtimeMs,
      pixelWidth,
      pixelHeight,
    })
  }

  return assets.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

export function readAssetBytes(relativePath: string): Buffer | null {
  const safe = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (safe.includes('..')) return null
  const full = join(SOURCE_DIR, safe)
  const norm = full.replace(/\\/g, '/')
  const root = SOURCE_DIR.replace(/\\/g, '/')
  if (!norm.startsWith(root)) return null
  if (!existsSync(full)) return null
  return readFileSync(full)
}
