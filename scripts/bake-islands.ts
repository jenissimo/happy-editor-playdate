/**
 * Bake render-island rasters at BUILD time using the real Playdate Simulator,
 * so first-paint no longer pays the on-device rasterization cost (up to
 * 1525ms observed on the leaderboard scene).
 *
 * This is a PROTOTYPE. It does not wire into build:playdate and does not
 * change runtime behavior — it only produces PNGs + a manifest.json under
 * .playdate-editor/bake-islands/ for inspection, plus a console report.
 *
 * Why the Simulator and not the editor's canvas preview: text rendering
 * (glyph rasterization, the 8-direction outline rings in source/ui.lua) is
 * what makes island rasterization expensive, and the canvas preview is only
 * an approximation of it. The Simulator runs the same Lua and the same
 * graphics implementation as the device, so its raster is authoritative.
 *
 * How pixels get out of the Simulator: `playdate.simulator.writeToFile(image,
 * path)` (Simulator-only; confirmed against Inside Playdate.html section
 * 7.27 and empirically). `path` is a real filesystem path, parent
 * directories must already exist on the host.
 *
 * How the driver reaches the island bitmaps: `cache` in source/ui.lua is a
 * module-local, and `Ui.islandStats()` — the only thing the runtime exports
 * about the cache — returns counts only (active islands, rebuilds,
 * promoted), never the records or their images. Playdate's Lua `debug`
 * table is restricted to `getinfo`/`traceback` (no `getupvalue`), so
 * upvalue introspection is not available either (verified empirically: a
 * probe script produced `field 'getupvalue' is not callable (a nil
 * value)`). The reachable path that touches neither guarded file: the bake
 * driver pre-imports "ui/cache" itself, BEFORE "ui", and monkey-patches
 * `UiCache.new` to record the instance it constructs. Because Playdate's
 * `import` is idempotent (like `require`), ui.lua's own `import "ui/cache"`
 * becomes a no-op and it picks up the already-patched module-scope table —
 * so when ui.lua does `Cache.new(gfx, W, H, memory)`, our wrapper runs and
 * captures the exact `cache` instance ui.lua is about to use. No file this
 * script isn't allowed to touch is read-modified-written; the patch lives
 * entirely in the driver we already control.
 *
 * A correctness trap this driver specifically avoids: a single Ui.draw()
 * after Ui.load() only rasterizes islands visible in the scene's
 * defaultState. Singleton islands gated by `states` (e.g. a menu row's
 * selection highlight) stay un-rasterized (`island.dirty` stays true, its
 * image is a never-drawn-into clear bitmap) until the state that makes them
 * visible is actually selected — confirmed empirically: baking
 * `row2-sel-bg` (states={"sel2"}) right after load produced a 115-byte
 * (near-blank) PNG; sweeping every state referenced anywhere in the scene
 * via Ui.setState + Ui.draw before harvesting produced a 177-byte PNG with
 * real fill content, and the two differ byte-for-byte. So the driver walks
 * every node's `states` field (recursing into groups' `children`) and
 * visits each one before reading cache.islands. Multi-member (coalesced)
 * islands are unaffected either way — the compiler never merges
 * per-state-gated nodes into them (see CLAUDE.md), so a state change only
 * ever forces a content-identical rebuild for those, never a promotion
 * (Ui.setState -> Cache:invalidateUnpromotedGates only flips `.dirty`, and
 * only for multi-member islands; nothing here ever sets a member `pending`,
 * so no island is ever promoted to per-member bitmaps during a bake — which
 * matters because promotion would split up the exact coalesced raster this
 * script exists to capture).
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findPdc, findSimulator } from '../src/core/playdate/sdk.ts'
import { listScenes, ROOT, SOURCE_DIR, validateSceneObject } from '../src/core/scene/io.ts'
import { prepareGeneration, publishGeneration } from '../src/core/scene/publication.ts'

const OUT_DIR = join(ROOT, '.playdate-editor', 'bake-islands')

/** Matches source/main.lua's `import "layouts/*"` list. */
const LAYOUTS: Array<{ file: string; global: string }> = [
  { file: 'menu-ui', global: 'MenuUiScene' },
  { file: 'loading-ui', global: 'LoadingUiScene' },
  { file: 'clear-ui', global: 'ClearUiScene' },
  { file: 'gameover-ui', global: 'GameoverUiScene' },
  { file: 'leaderboard-ui', global: 'LeaderboardUiScene' },
  { file: 'name-entry-ui', global: 'NameEntryUiScene' },
  { file: 'rules-ui', global: 'RulesUiScene' },
  { file: 'game-hud', global: 'GameHudScene' },
]

type IslandRow = {
  scene: string
  id: string
  x: number
  y: number
  w: number
  h: number
  members: number
  baked: boolean
  reason: string
  pngFile: string | null
}

type SceneRow = { name: string; sceneRevision: string }

function driverLua(bakedPngDir: string): string {
  const imports = LAYOUTS.map((l) => `import "layouts/${l.file}"`).join('\n')
  const scenesTable = LAYOUTS.map(
    (l) => `    { name = "${l.file}", scene = ${l.global} },`,
  ).join('\n')
  const outDirLua = bakedPngDir.replace(/\\/g, '/')

  return `-- Generated by bake-islands.ts — build-time island raster capture.
-- Replaces the game's own main.lua for this one Simulator run only; the
-- staged copy this runs against is discarded afterward.
import "CoreLibs/graphics"

-- Pre-import so ui.lua's own "import \\"ui/cache\\"" is a no-op (import is
-- idempotent) and picks up this already-patched module table. Lets us
-- capture the private cache instance ui.lua constructs, without touching
-- ui.lua or ui/cache.lua.
import "ui/cache"
local originalCacheNew = UiCache.new
local capturedCache = nil
UiCache.new = function(...)
    capturedCache = originalCacheNew(...)
    return capturedCache
end

import "ui"
${imports}

local OUT_DIR <const> = "${outDirLua}"

local SCENES <const> = {
${scenesTable}
}

local function collectStates(nodes, set)
    if not nodes then return end
    for i = 1, #nodes do
        local node = nodes[i]
        if node.states then
            for j = 1, #node.states do set[node.states[j]] = true end
        end
        if node.children then collectStates(node.children, set) end
    end
end

print("BAKE_START")

if not capturedCache then
    print("BAKE_FATAL no-cache-captured")
    print("BAKE_DONE")
    playdate.simulator.exit()
    return
end

for i = 1, #SCENES do
    local entry = SCENES[i]
    local loaded = Ui.load(entry.scene)
    if not loaded then
        print("BAKE_LOAD_ERROR " .. entry.name)
    else
        -- Rasterize the default state, then sweep every other state
        -- referenced anywhere in the scene so state-gated singleton islands
        -- (e.g. a selection highlight) are not left un-rasterized (blank).
        Ui.draw()
        local stateSet = {}
        collectStates(entry.scene.nodes, stateSet)
        for state in pairs(stateSet) do
            Ui.setState(state)
            Ui.draw()
        end

        local compiled = entry.scene._compiled
        local revision = (compiled and compiled.sceneRevision) or ""
        print("BAKE_SCENE " .. entry.name .. " " .. revision)

        local islands = capturedCache.islands or {}
        for j = 1, #islands do
            local rec = islands[j]
            local memberCount = #rec.members
            local skip, reason = false, "-"
            if memberCount == 1 and rec.members[1].type == "image" then
                skip = true
                reason = "singleton-image"
            end
            local filename = entry.name .. "-" .. rec.id .. ".png"
            if not skip then
                local ok, err = pcall(function()
                    playdate.simulator.writeToFile(rec.image, OUT_DIR .. "/" .. entry.name .. "/" .. filename)
                end)
                if not ok then
                    print("BAKE_WRITE_ERROR " .. entry.name .. " " .. rec.id .. " " .. tostring(err))
                    skip = true
                    reason = "write-failed"
                end
            end
            print(string.format("BAKE_ISLAND %s %s %d %d %d %d %d %s %s %s",
                entry.name, rec.id, rec.x, rec.y, rec.width, rec.height, memberCount,
                skip and "skip" or "bake", reason, skip and "-" or filename))
        end
    end
end

print("BAKE_DONE")
playdate.simulator.exit()
`
}

function buildPdx(pdc: string, sourceDir: string, pdxOut: string) {
  const r = spawnSync(pdc, ['--skip-unknown', sourceDir, pdxOut], {
    encoding: 'utf8',
    env: process.env,
  })
  if (r.status !== 0) {
    throw new Error(`pdc failed: ${r.stderr || r.stdout}`)
  }
}

/** Spawn the Simulator on pdx, capture stdout, resolve once BAKE_DONE is seen. */
function runSimulator(
  sim: string,
  pdx: string,
  timeoutMs: number,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(sim, [pdx], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false })
    let buf = ''
    const lines: string[] = []
    let settled = false
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      if (err) reject(err)
      else resolve(lines)
    }
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '')
        buf = buf.slice(idx + 1)
        lines.push(line)
        if (line.includes('BAKE_DONE')) {
          setTimeout(() => finish(), 200) // let the process start exiting cleanly
        }
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    const timer = setTimeout(
      () => finish(new Error('Simulator bake timed out; captured lines:\n' + lines.join('\n'))),
      timeoutMs,
    )
    child.on('exit', () => {
      if (lines.some((l) => l.includes('BAKE_DONE'))) finish()
      else finish(new Error('Simulator exited without BAKE_DONE; captured lines:\n' + lines.join('\n')))
    })
    child.on('error', (err) => finish(err))
  })
}

function parseLines(lines: string[]): { scenes: SceneRow[]; islands: IslandRow[] } {
  const scenes: SceneRow[] = []
  const islands: IslandRow[] = []
  for (const line of lines) {
    if (line.startsWith('BAKE_LOAD_ERROR ')) {
      console.error(`[bake-islands] scene failed to load: ${line.slice('BAKE_LOAD_ERROR '.length)}`)
      continue
    }
    if (line.startsWith('BAKE_WRITE_ERROR ')) {
      console.error(`[bake-islands] ${line}`)
      continue
    }
    if (line.startsWith('BAKE_FATAL ')) {
      throw new Error(line)
    }
    if (line.startsWith('BAKE_SCENE ')) {
      const [, name, revision] = line.split(' ')
      scenes.push({ name, sceneRevision: revision ?? '' })
      continue
    }
    if (line.startsWith('BAKE_ISLAND ')) {
      const parts = line.split(' ')
      // BAKE_ISLAND scene id x y w h members bake|skip reason filename
      const [, scene, id, x, y, w, h, members, verdict, reason, filename] = parts
      islands.push({
        scene,
        id,
        x: Number(x),
        y: Number(y),
        w: Number(w),
        h: Number(h),
        members: Number(members),
        baked: verdict === 'bake',
        reason: reason === '-' ? '' : reason,
        pngFile: filename === '-' ? null : filename,
      })
      continue
    }
  }
  return { scenes, islands }
}

function fileSize(path: string): number {
  return existsSync(path) ? statSync(path).size : 0
}

function collectPdiSizes(dir: string, prefix = '', out = new Map<string, number>()): Map<string, number> {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectPdiSizes(full, `${prefix}${entry.name}/`, out)
    else if (entry.isFile() && entry.name.endsWith('.pdi')) {
      out.set(`${prefix}${entry.name}`, statSync(full).size)
    }
  }
  return out
}

if (import.meta.main) {
  main().then((code) => process.exit(code))
}

async function main(): Promise<number> {
  const pdc = findPdc()
  if (!pdc) {
    console.error('pdc not found — set PLAYDATE_SDK_PATH')
    return 1
  }
  const sim = findSimulator()
  if (!sim) {
    console.error('PlaydateSimulator not found — set PLAYDATE_SDK_PATH')
    return 1
  }

  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })

  const tempRoot = mkdtempSync(join(tmpdir(), 'nyandoku-bake-islands-'))
  try {
    console.log('Staging source/ …')
    const stagedSource = join(tempRoot, 'Source')
    cpSync(SOURCE_DIR, stagedSource, { recursive: true, dereference: true, errorOnExist: true })

    // The live source/layouts/*.lua on disk can be stale relative to the
    // current scenes/*.scene.json (e.g. mid-edit, not yet republished via
    // `scenes:generate`) -- baking against them would capture islands whose
    // sceneRevision a subsequent `build:playdate` (which always regenerates
    // fresh from current scenes/*.json, see build-playdate.ts) can never
    // match, making every bake look permanently stale. Regenerating here the
    // same way keeps this run and an immediately-following build deriving
    // the same deterministic generationId/sceneRevision from the same scene
    // + asset inputs, so a bake stays usable by the build that follows it.
    console.log('Regenerating layouts from current scenes …')
    const sceneInputs = listScenes().map((sf) => ({ name: sf.scene.name, scene: sf.scene, content: readFileSync(sf.path, 'utf8') }))
    const stagedLayoutsDir = join(stagedSource, 'layouts')
    rmSync(stagedLayoutsDir, { recursive: true, force: true })
    const prepared = prepareGeneration(stagedSource, sceneInputs, { validate: validateSceneObject })
    publishGeneration(prepared, stagedLayoutsDir, join(stagedSource, 'ui_asset_catalog.lua'))

    const bakedPngDir = join(tempRoot, 'baked-png')
    for (const l of LAYOUTS) mkdirSync(join(bakedPngDir, l.file), { recursive: true })

    writeFileSync(join(stagedSource, 'main.lua'), driverLua(bakedPngDir))

    const bakePdx = join(tempRoot, 'bake.pdx')
    console.log('Compiling bake driver with pdc…')
    buildPdx(pdc, stagedSource, bakePdx)

    console.log('Running Simulator…')
    const lines = await runSimulator(sim, bakePdx, 120_000)
    const { scenes, islands } = parseLines(lines)

    if (scenes.length !== LAYOUTS.length) {
      console.error(
        `[bake-islands] expected ${LAYOUTS.length} scenes, got ${scenes.length}. Raw output:\n${lines.join('\n')}`,
      )
    }

    const checkRel = 'images/_bake_check'
    let anyBaked = false
    for (const isl of islands) {
      if (!isl.baked || !isl.pngFile) continue
      const src = join(bakedPngDir, isl.scene, isl.pngFile)
      if (!existsSync(src)) {
        console.error(`[bake-islands] missing expected PNG: ${src}`)
        continue
      }
      const destDir = join(stagedSource, checkRel, isl.scene)
      mkdirSync(destDir, { recursive: true })
      cpSync(src, join(destDir, isl.pngFile))
      anyBaked = true
    }

    let pdiSizes = new Map<string, number>()
    if (anyBaked) {
      const checkPdx = join(tempRoot, 'bake-check.pdx')
      console.log('Compiling baked PNGs to measure .pdi size…')
      buildPdx(pdc, stagedSource, checkPdx)
      pdiSizes = collectPdiSizes(join(checkPdx, checkRel))
    }

    const manifestScenes: Array<{
      name: string
      sceneRevision: string
      islands: Array<{
        id: string
        x: number
        y: number
        w: number
        h: number
        members: number
        baked: boolean
        reason?: string
        file?: string
        pngBytes?: number
        pdiBytes?: number
      }>
    }> = []
    let totalPng = 0
    let totalPdi = 0
    let totalBaked = 0
    let totalSkipped = 0

    for (const scene of scenes) {
      const sceneIslands = islands.filter((i) => i.scene === scene.name)
      const outSceneDir = join(OUT_DIR, scene.name)
      mkdirSync(outSceneDir, { recursive: true })

      const islandEntries = sceneIslands.map((isl) => {
        let pngBytes = 0
        let pdiBytes = 0
        let outFile: string | undefined
        if (isl.baked && isl.pngFile) {
          const src = join(bakedPngDir, isl.scene, isl.pngFile)
          if (existsSync(src)) {
            pngBytes = fileSize(src)
            cpSync(src, join(outSceneDir, isl.pngFile))
            outFile = `${scene.name}/${isl.pngFile}`
            const key = `${isl.scene}/${isl.pngFile.replace(/\.png$/, '.pdi')}`
            pdiBytes = pdiSizes.get(key) ?? 0
          }
          totalBaked++
          totalPng += pngBytes
          totalPdi += pdiBytes
        } else {
          totalSkipped++
        }
        return {
          id: isl.id,
          x: isl.x,
          y: isl.y,
          w: isl.w,
          h: isl.h,
          members: isl.members,
          baked: isl.baked,
          reason: isl.reason || undefined,
          file: outFile,
          pngBytes: isl.baked ? pngBytes : undefined,
          pdiBytes: isl.baked ? pdiBytes : undefined,
        }
      })

      manifestScenes.push({ name: scene.name, sceneRevision: scene.sceneRevision, islands: islandEntries })
    }

    const manifest = {
      generatedAt: new Date().toISOString(),
      pdcVersion: spawnSync(pdc, ['--version'], { encoding: 'utf8' }).stdout?.trim() || undefined,
      scenes: manifestScenes,
      totals: {
        islandsBaked: totalBaked,
        islandsSkipped: totalSkipped,
        totalPngBytes: totalPng,
        totalPdiBytes: totalPdi,
      },
    }
    writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))

    console.log('')
    console.log('=== bake-islands report ===')
    for (const scene of manifestScenes) {
      const baked = scene.islands.filter((i) => i.baked)
      const skipped = scene.islands.filter((i) => !i.baked)
      const png = baked.reduce((a, i) => a + (i.pngBytes ?? 0), 0)
      const pdi = baked.reduce((a, i) => a + (i.pdiBytes ?? 0), 0)
      console.log(
        `${scene.name}: baked=${baked.length} skipped=${skipped.length} png=${png}B pdi=${pdi}B rev=${scene.sceneRevision}`,
      )
    }
    console.log(`TOTAL: baked=${totalBaked} skipped=${totalSkipped} png=${totalPng}B pdi=${totalPdi}B`)
    console.log(`manifest: ${join(OUT_DIR, 'manifest.json')}`)
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}
