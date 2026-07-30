import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readPngSize } from './indexAssets'

describe('readPngSize', () => {
  test('reads paw_print IHDR', () => {
    const buf = readFileSync(
      join(import.meta.dir, '../../../playdate/Source/images/paw_print.png'),
    )
    expect(readPngSize(buf)).toEqual({ width: 55, height: 60 })
  })
})
