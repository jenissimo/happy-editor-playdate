/**
 * Build the Playdate fixture project.
 *
 * Usage: bun scripts/build-playdate.ts
 *
 * Requires PLAYDATE_SDK_PATH (or pdc on PATH).
 */
import { spawnSync } from 'node:child_process'
import { findPdc, PDX_OUT } from '../src/core/playdate/sdk.ts'
import { SOURCE_DIR } from '../src/core/scene/io.ts'

const pdc = findPdc()
if (!pdc) {
  console.error('pdc not found — set PLAYDATE_SDK_PATH')
  process.exit(1)
}

console.log('pdc:', pdc)
console.log('source:', SOURCE_DIR)
console.log('out:', PDX_OUT)

const r = spawnSync(pdc, [SOURCE_DIR, PDX_OUT], { stdio: 'inherit' })
process.exit(r.status ?? 1)
