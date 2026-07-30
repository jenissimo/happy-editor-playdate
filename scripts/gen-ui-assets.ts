/**
 * Generate simple 1-bit UI chrome PNGs for the Playdate test project.
 * Naming follows our convention: *-slice-L-R-T-B.png
 *
 * Usage: bun scripts/gen-ui-assets.ts
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const OUT = join(ROOT, 'playdate', 'Source', 'images')

function crcTable() {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
}
const CRC = crcTable()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, data.length)
  const body = new Uint8Array(4 + data.length)
  body.set(typeBytes, 0)
  body.set(data, 4)
  const crc = new Uint8Array(4)
  new DataView(crc.buffer).setUint32(0, crc32(body))
  const out = new Uint8Array(4 + body.length + 4)
  out.set(len, 0)
  out.set(body, 4)
  out.set(crc, 4 + body.length)
  return out
}

/** Opaque black/white RGB PNG. pixels: row-major, true = black. */
function encodePng(w: number, h: number, isBlack: (x: number, y: number) => boolean): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < w; x++) {
      const v = isBlack(x, y) ? 0 : 255
      const i = row + 1 + x * 3
      raw[i] = v
      raw[i + 1] = v
      raw[i + 2] = v
    }
  }

  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w)
  dv.setUint32(4, h)
  ihdr[8] = 8
  ihdr[9] = 2 // RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
  const parts = [signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/**
 * Clean 9-slice chrome: white fill, solid outer ring, optional inner ring.
 * Edge band stays white so stretched sides don't turn into dashed seams.
 */
function writeSlicePanel(
  name: string,
  size: number,
  inset: number,
  opts: { double?: boolean } = {},
) {
  const { double = false } = opts
  const png = encodePng(size, size, (x, y) => {
    const last = size - 1
    const onOuter = x === 0 || y === 0 || x === last || y === last
    if (onOuter) return true
    if (double) {
      const onInner =
        x === inset - 1 ||
        y === inset - 1 ||
        x === size - inset ||
        y === size - inset
      if (onInner) return true
    }
    return false
  })

  const path = join(OUT, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, png)
  console.log('wrote', path)
}

writeSlicePanel('panel-slice-8-8-8-8.png', 32, 8, { double: true })
writeSlicePanel('button-slice-4-4-4-4.png', 16, 4, { double: true })

// Small decorative icon (not a slice) for image nodes.
{
  const size = 24
  const png = encodePng(size, size, (x, y) => {
    const cx = 11.5
    const cy = 12.5
    const dx = x - cx
    const dy = y - cy
    const inBody = dx * dx + dy * dy * 1.1 < 36
    const toe =
      (x - 5) ** 2 + (y - 5) ** 2 < 6 ||
      (x - 11) ** 2 + (y - 3) ** 2 < 6 ||
      (x - 17) ** 2 + (y - 5) ** 2 < 6
    const border = x === 0 || y === 0 || x === size - 1 || y === size - 1
    return border || inBody || toe
  })
  const path = join(OUT, 'icon.png')
  writeFileSync(path, png)
  console.log('wrote', path)
}
