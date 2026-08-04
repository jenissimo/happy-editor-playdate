#!/usr/bin/env bun
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { listScenes, LUA_SCENES_DIR, SOURCE_DIR, validateSceneObject } from '../src/core/scene/io.ts'
import { prepareGeneration, publishGeneration } from '../src/core/scene/publication.ts'
import { PACKAGE_ROOT } from '../src/core/project/paths.ts'

try {
  const scenes = listScenes().map((s) => ({ name: s.scene.name, scene: s.scene, content: readFileSync(s.path, 'utf8') }))
  const prepared = prepareGeneration(SOURCE_DIR, scenes, { validate: validateSceneObject })
  const fixture = join(PACKAGE_ROOT, 'playdate', 'Source', 'ui_asset_catalog.lua')
  publishGeneration(prepared, LUA_SCENES_DIR, [fixture, join(SOURCE_DIR, 'ui_asset_catalog.lua')], (n) => {
    if (process.env.HAPPY_EDITOR_FAIL_PUBLISH_AFTER === String(n)) throw new Error('injected interrupted publication')
  })
  for (const name of prepared.layouts.keys()) console.log(`generated ${join('source/layouts', `${name}.lua`)}`)
  console.log(`generated catalog ${prepared.id} (${Object.keys(prepared.catalog.entries).length} entries)`)
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1) }
