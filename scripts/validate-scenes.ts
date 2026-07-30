#!/usr/bin/env bun
import { listScenes } from '../src/core/scene/io'

const scenes = listScenes()
let errors = 0
for (const s of scenes) {
  const errs = s.diagnostics.filter((d) => d.severity === 'error')
  if (errs.length === 0) {
    console.log(`ok  ${s.relativePath} (${s.revision})`)
  } else {
    errors += errs.length
    console.log(`ERR ${s.relativePath}`)
    for (const e of errs) console.log(`  - ${e.message}`)
  }
}
if (scenes.length === 0) {
  console.log('no scenes found under playdate/scenes/')
}
process.exit(errors > 0 ? 1 : 0)
