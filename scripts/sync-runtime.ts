#!/usr/bin/env bun
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { getProjectPaths, PACKAGE_ROOT } from '../src/core/project/paths.ts'

const RUNTIME_FILES = [
  'ui.lua',
  'ui/assets.lua',
  'ui/tree.lua',
  'ui/cache.lua',
  'ui/memory.lua',
  'ui/animation.lua',
  'ui/renderer.lua',
  'ui_asset_catalog.lua',
] as const

const checkOnly = process.argv.includes('--check')
const paths = getProjectPaths()
let failed = 0

type PendingInstall = {
  file: string
  installed: string
  actual: string | null
  temporary: string
}

function stageWrite(path: string, content: string, index: number) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.${index}.tmp`
  writeFileSync(temporary, content, 'utf8')
  return temporary
}

const pending: PendingInstall[] = []

for (const file of RUNTIME_FILES) {
  const canonical = join(PACKAGE_ROOT, 'playdate', 'Source', file)
  const installed = join(paths.sourceDir, file)
  const expected = readFileSync(canonical, 'utf8')
  const actual = existsSync(installed) ? readFileSync(installed, 'utf8') : null

  if (actual === expected) {
    console.log(`ok ${relative(paths.root, installed)}`)
    continue
  }

  failed++
  if (checkOnly) {
    console.error(`out of sync ${relative(paths.root, installed)}`)
    continue
  }

  pending.push({
    file,
    installed,
    actual,
    temporary: stageWrite(installed, expected, pending.length),
  })
}

if (!checkOnly) {
  // ui.lua is the public entry point. Publishing it last prevents a freshly
  // installed facade from seeing stale support modules if a write fails.
  pending.sort((a, b) => (a.file === 'ui.lua' ? 1 : 0) - (b.file === 'ui.lua' ? 1 : 0))
  const installed: PendingInstall[] = []
  try {
    for (const entry of pending) {
      renameSync(entry.temporary, entry.installed)
      installed.push(entry)
      console.log(`installed ${relative(paths.root, entry.installed)}`)
    }
  } catch (error) {
    for (let i = installed.length - 1; i >= 0; i--) {
      const entry = installed[i]
      if (entry.actual === null) {
        if (existsSync(entry.installed)) unlinkSync(entry.installed)
      } else {
        const rollback = stageWrite(entry.installed, entry.actual, i)
        renameSync(rollback, entry.installed)
      }
    }
    for (const entry of pending) {
      if (existsSync(entry.temporary)) unlinkSync(entry.temporary)
    }
    throw error
  }
}

if (checkOnly && failed > 0) {
  console.error(`runtime check failed: ${failed} file(s) differ`)
  process.exit(1)
}
