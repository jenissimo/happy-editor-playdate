/**
 * Locate Playdate SDK tools (pdc + Simulator) and build/run the fixture .pdx.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  PDX_OUT,
  SOURCE_DIR,
  atomicWrite,
  generateProjectGeneration,
} from '../scene/io.ts'
import type { Scene } from '../scene/types.ts'
import { exportSceneLua } from '../scene/export.ts'

export { PDX_OUT }
export const ACTIVE_SCENE_LUA = join(SOURCE_DIR, 'active_scene.lua')

function sdkRoots(): string[] {
  const env = process.env.PLAYDATE_SDK_PATH?.trim()
  return [
    env || '',
    join(homedir(), 'Documents', 'PlaydateSDK'),
    join(homedir(), 'Developer', 'PlaydateSDK'),
  ].filter(Boolean)
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (p && existsSync(p)) return p
  }
  return null
}

export function findPdc(): string | null {
  const fromSdk = sdkRoots().flatMap((sdk) => [
    join(sdk, 'bin', 'pdc.exe'),
    join(sdk, 'bin', 'pdc'),
  ])
  const found = firstExisting(fromSdk)
  if (found) return found

  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pdc'], {
    encoding: 'utf8',
  })
  const line = which.stdout?.trim().split(/\r?\n/)[0]
  return line && existsSync(line) ? line : null
}

export function findSimulator(): string | null {
  const fromSdk = sdkRoots().flatMap((sdk) => [
    join(sdk, 'bin', 'PlaydateSimulator.exe'),
    join(sdk, 'bin', 'PlaydateSimulator'),
  ])
  return firstExisting(fromSdk)
}

/** Write Source/active_scene.lua so main.lua can Ui.load(ActiveScene). */
export function writeActiveSceneLua(scene: Scene): string {
  const generated = generateProjectGeneration(scene)
  const compiled = generated.prepared.compiled.get(scene.name)
  if (!compiled) throw new Error(`compiled scene missing: ${scene.name}`)
  const content = exportSceneLua(compiled, 'ActiveScene')
  atomicWrite(ACTIVE_SCENE_LUA, content)
  return ACTIVE_SCENE_LUA
}

export type RunSimulatorResult =
  | { ok: true; pdx: string; scene: string; log: string }
  | { ok: false; error: string; log?: string }

export function buildAndRunSimulator(scene: Scene): RunSimulatorResult {
  const pdc = findPdc()
  if (!pdc) {
    return {
      ok: false,
      error: 'pdc not found — set PLAYDATE_SDK_PATH',
    }
  }
  const sim = findSimulator()
  if (!sim) {
    return {
      ok: false,
      error: 'PlaydateSimulator not found — set PLAYDATE_SDK_PATH',
    }
  }

  writeActiveSceneLua(scene)

  const build = spawnSync(pdc, [SOURCE_DIR, PDX_OUT], {
    encoding: 'utf8',
    env: process.env,
  })
  const log = [build.stdout ?? '', build.stderr ?? ''].join('\n').trim()
  if (build.status !== 0) {
    return {
      ok: false,
      error: `pdc failed (exit ${build.status ?? '?'})`,
      log,
    }
  }

  const child = spawn(sim, [PDX_OUT], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.once('error', (error) => {
    // spawn() reports some launch failures asynchronously. The HTTP endpoint
    // already returned its synchronous build result, so contain and surface
    // the later failure rather than allowing an unhandled EventEmitter error.
    console.warn(`[happy-editor] Failed to launch Playdate Simulator: ${error.message}`)
  })
  child.unref()

  return {
    ok: true,
    pdx: PDX_OUT,
    scene: scene.name,
    log: log || `Built ${PDX_OUT} and launched Simulator`,
  }
}
