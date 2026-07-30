/**
 * Asset naming conventions — no sidecar meta files.
 *
 * Playdate SDK:
 *   foo-table-32-32.png     → imagetable, cell 32×32
 *   foo-table-001.png       → sequential imagetable frame
 *
 * Ours (parsed here, consumed by Lua runtime later):
 *   foo-slice-8-8-8-8.png   → 9-slice, insets L R T B
 */

export type AssetKind = 'image' | 'table' | 'slice' | 'font'

export type ParsedAsset = {
  /** Path without extension, as Playdate loaders expect (e.g. "ui/panel"). */
  basePath: string
  /** Original filename stem including notation suffixes. */
  fileStem: string
  extension: string
  kind: AssetKind
  /** Imagetable cell size when kind === "table". */
  cell?: { w: number; h: number }
  /** Frame index when stem looks like sequential table (`-table-001`). */
  frameIndex?: number
  /** 9-slice insets when kind === "slice". */
  slice?: { left: number; right: number; top: number; bottom: number }
  /** Font point size hint when kind === "font" (`Name-24.fnt`). */
  fontSize?: number
}

const TABLE_CELL = /-table-(\d+)-(\d+)$/
const TABLE_FRAME = /-table-(\d+)$/
const SLICE = /-slice-(\d+)-(\d+)-(\d+)-(\d+)$/
const FONT_SIZE = /-(\d+)$/

function splitPath(path: string): { dir: string; stem: string; ext: string } {
  const normalized = path.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  const file = slash >= 0 ? normalized.slice(slash + 1) : normalized
  const dir = slash >= 0 ? normalized.slice(0, slash) : ''
  const dot = file.lastIndexOf('.')
  const stem = dot >= 0 ? file.slice(0, dot) : file
  const ext = dot >= 0 ? file.slice(dot + 1).toLowerCase() : ''
  return { dir, stem, ext }
}

function joinBase(dir: string, logicalStem: string): string {
  return dir ? `${dir}/${logicalStem}` : logicalStem
}

/**
 * Parse a filename or relative path into an asset descriptor.
 * Returns null only for empty input.
 */
export function parseAssetName(path: string): ParsedAsset | null {
  const trimmed = path.trim()
  if (!trimmed) return null

  const { dir, stem, ext } = splitPath(trimmed)

  if (ext === 'fnt') {
    const m = stem.match(FONT_SIZE)
    const fontSize = m ? Number(m[1]) : undefined
    const logical = m ? stem.slice(0, -m[0].length) : stem
    return {
      basePath: joinBase(dir, logical),
      fileStem: stem,
      extension: ext,
      kind: 'font',
      fontSize,
    }
  }

  const slice = stem.match(SLICE)
  if (slice) {
    const logical = stem.slice(0, -slice[0].length)
    return {
      basePath: joinBase(dir, logical),
      fileStem: stem,
      extension: ext || 'png',
      kind: 'slice',
      slice: {
        left: Number(slice[1]),
        right: Number(slice[2]),
        top: Number(slice[3]),
        bottom: Number(slice[4]),
      },
    }
  }

  const cell = stem.match(TABLE_CELL)
  if (cell) {
    const logical = stem.slice(0, -cell[0].length)
    return {
      basePath: joinBase(dir, logical),
      fileStem: stem,
      extension: ext || 'png',
      kind: 'table',
      cell: { w: Number(cell[1]), h: Number(cell[2]) },
    }
  }

  const frame = stem.match(TABLE_FRAME)
  if (frame) {
    const logical = stem.slice(0, -frame[0].length)
    return {
      basePath: joinBase(dir, logical),
      fileStem: stem,
      extension: ext || 'png',
      kind: 'table',
      frameIndex: Number(frame[1]),
    }
  }

  return {
    basePath: joinBase(dir, stem),
    fileStem: stem,
    extension: ext || 'png',
    kind: 'image',
  }
}

/** Human-readable summary for the asset browser. */
export function describeAsset(asset: ParsedAsset): string {
  switch (asset.kind) {
    case 'slice': {
      const s = asset.slice!
      return `9-slice · L${s.left} R${s.right} T${s.top} B${s.bottom}`
    }
    case 'table':
      if (asset.cell) return `table · ${asset.cell.w}×${asset.cell.h}`
      if (asset.frameIndex != null)
        return `table frame · #${asset.frameIndex}`
      return 'table'
    case 'font':
      return asset.fontSize != null ? `font · ${asset.fontSize}px` : 'font'
    default:
      return 'image'
  }
}
