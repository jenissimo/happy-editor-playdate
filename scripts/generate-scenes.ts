#!/usr/bin/env bun
import {
  generateSceneLua,
  listScenes,
  validateSceneObject,
} from '../src/core/scene/io'

const scenes = listScenes()
let failed = 0
for (const s of scenes) {
  const errs = validateSceneObject(s.scene).filter((d) => d.severity === 'error')
  if (errs.length) {
    failed++
    console.error(`skip ${s.relativePath}: ${errs.map((e) => e.message).join('; ')}`)
    continue
  }
  const { path } = generateSceneLua(s.scene)
  console.log(`generated ${path}`)
}
process.exit(failed > 0 ? 1 : 0)
