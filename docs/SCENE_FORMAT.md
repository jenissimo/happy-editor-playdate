# Playdate Scene Format

Canonical layout format for **HappyEditor** (`happy-editor-playdate`). Scene JSON is the source of truth.
Lua modules under `playdate/Source/scenes/` are generated and must not be hand-edited.

Schema: [`schema/playdate-scene.schema.json`](../schema/playdate-scene.schema.json)

## Paths

| Role | Path (fixture defaults) |
|---|---|
| Scene source | `playdate/scenes/<name>.scene.json` |
| Generated Lua | `playdate/Source/scenes/<name>.lua` |
| Assets | under `playdate/Source/` (`images/`, `fonts/`, …) |
| Project config | `.playdate-editor/project.json` |
| Workspace layout | `.playdate-editor/workspace.json` |

Paths are **not hard-coded** in the tooling. They come from `.playdate-editor/project.json` relative to the **project root** (see README → *Use as a git submodule*). Resolver: `src/core/project/paths.ts`.

| `project.json` key | Fixture default | Host-game default |
|---|---|---|
| `sceneRoot` | `playdate/scenes` | `scenes` |
| `sourceRoot` | `playdate/Source` | `Source` |
| `generatedLuaRoot` | `playdate/Source/scenes` | `Source/scenes` |
| `pdxOut` | `playdate/Editor.pdx` | `Editor.pdx` |
| `defaultScene` | `demo-title` | `menu` |

Override the project root with `HAPPY_EDITOR_ROOT` / `PLAYDATE_EDITOR_ROOT`, or rely on parent-folder auto-detect when this repo is a submodule.

## Minimal scene

```json
{
  "version": 1,
  "id": "example",
  "name": "example",
  "width": 400,
  "height": 240,
  "states": ["default"],
  "defaultState": "default",
  "nodes": []
}
```

`width` / `height` are fixed at **400×240** (Playdate screen).

## Coordinates and pivot

- `x`, `y` are the **pivot** position in screen pixels.
- `anchor.x` / `anchor.y` are pivot fractions: `0` = left/top, `0.5` = center, `1` = right/bottom.
- Visual top-left = `(x - anchor.x * w, y - anchor.y * h)`.
- Editor default for new nodes is top-left pivot `(0, 0)` so resize grows from the opposite edge.

## Node types

### Common fields

| Field | Meaning |
|---|---|
| `id` | Stable unique string |
| `name` | Display name in Hierarchy |
| `type` | `text` \| `image` \| `panel` \| `frame` \| `shape` \| `group` |
| `x` `y` `w` `h` | Pivot position and size |
| `anchor` | Pivot fractions |
| `rotation` | Degrees clockwise around pivot (default `0`) |
| `states` | Empty = all states; otherwise visible only in listed states |
| `visible` | Soft hide |
| `locked` | Blocks transform in the editor |

### Screen states (editor + runtime)

A scene lists named modes in `states` (e.g. `default`, `confirm`) and a `defaultState`.
Nodes with `states: []` are visible in every mode; a non-empty list restricts them.

In the editor:
- **Scene toolbar** — always-visible state strip: switch preview, `+` to add, right-click / `⋯` to rename, set default (`*`), or delete (cascades node membership).
- **Context options / Inspector** — **All** or per-state chips to assign membership on the selection.
- **Alt+[ / Alt+]** — previous / next state. Command palette: assign selection to current state, or show in all states.
- Preview choice is remembered per scene in workspace preferences.

On device, call `Ui.setState("confirm")` (same filter rule as the editor).

### `text`

```json
{
  "id": "title",
  "name": "Title",
  "type": "text",
  "x": 70, "y": 45, "w": 260, "h": 22,
  "anchor": { "x": 0, "y": 0 },
  "states": [],
  "visible": true,
  "locked": false,
  "text": "Hello",
  "font": "fonts/Roobert-11-Medium",
  "align": "center"
}
```

`font` is a logical Playdate path without extension. Empty or missing
resolves to **`fonts/Roobert-11-Medium`** (bundled default) — never the OS
system / monospace font.

Optional layer-style effects (clipped to the text box; leave padding so they
are not cut off):

| Field | Meaning |
|---|---|
| `outline` | `{ width, color, outer? }` — 8-direction glyph rings. Primary is the **inner** ring (`width` default `1`). Optional `outer: { width, color }` draws further out (rings `width+1 .. width+outer.width`). Classic readable UI: white inner + black outer. `null` / absent = off |
| `shadow` | `{ x, y, color }` — single offset drop shadow (defaults `1,1`). `null` / absent = off |

Draw order: **shadow → outer outline → inner outline → fill**. `color` is `black` \| `white`.

```json
{
  "text": "Score: 1000",
  "font": "fonts/Roobert-11-Medium",
  "align": "left",
  "outline": {
    "width": 1,
    "color": "white",
    "outer": { "width": 1, "color": "black" }
  },
  "shadow": { "x": 1, "y": 1, "color": "white" }
}
```

### `image`

```json
{
  "id": "icon",
  "name": "Icon",
  "type": "image",
  "x": 304, "y": 172, "w": 24, "h": 24,
  "anchor": { "x": 0, "y": 0 },
  "states": [],
  "visible": true,
  "locked": false,
  "asset": "images/icon"
}
```

Imagetable (animated sprite) — same node type, point `asset` at a Playdate table
(`foo-table-32-32.png` or `foo-table-001.png`…):

```json
{
  "type": "image",
  "asset": "images/player",
  "w": 32, "h": 32,
  "fps": 10,
  "loop": true,
  "frameStart": 1,
  "frameEnd": 4
}
```

| Field | Meaning |
|---|---|
| `fps` | Playback rate. `0` / omitted = static (`frame` or `frameStart`) |
| `loop` | Loop within range (default `true`) |
| `frameStart` / `frameEnd` | 1-based inclusive range (Playdate imagetable indices) |
| `frame` | Static frame when `fps` is 0 |

On device, call `Ui.update(dt)` each frame so animation advances (same clock as tweens).

### `panel` (9-slice)

```json
{
  "id": "panel-1",
  "name": "Panel",
  "type": "panel",
  "x": 40, "y": 28, "w": 320, "h": 184,
  "anchor": { "x": 0, "y": 0 },
  "states": [],
  "visible": true,
  "locked": false,
  "asset": "images/panel",
  "slice": { "left": 8, "right": 8, "top": 8, "bottom": 8 }
}
```

On disk the file is `images/panel-slice-8-8-8-8.png`. Runtime resolves
`asset` + `slice` → that filename. Insets order is **L R T B**.

### `frame` (procedural)

```json
{
  "id": "frame-1",
  "name": "Frame",
  "type": "frame",
  "x": 56, "y": 44, "w": 288, "h": 40,
  "anchor": { "x": 0, "y": 0 },
  "states": [],
  "visible": true,
  "locked": false,
  "style": "double",
  "thickness": 1
}
```

`style`: `line` | `double` | `ticks`.

Prefer **`shape`** for new procedural borders/fills; `frame` remains for simple legacy borders.

### `shape` (procedural fill + stroke)

Extensible 1-bit primitive. `fill` and `stroke` are discriminated by `kind` so new kinds can be added later without breaking existing scenes.

```json
{
  "id": "shape-1",
  "name": "Shape",
  "type": "shape",
  "x": 56, "y": 150, "w": 100, "h": 40,
  "anchor": { "x": 0, "y": 0 },
  "states": [],
  "visible": true,
  "locked": false,
  "cornerRadius": 6,
  "fill": { "kind": "dither", "pattern": "checker", "color": "black" },
  "stroke": { "kind": "solid", "thickness": 1, "color": "black" }
}
```

**`fill.kind`**

| kind | Fields | Notes |
|---|---|---|
| `none` | — | Transparent |
| `solid` | `color` | Flat ink |
| `dither` | `pattern`, `color` | Named hatch / Bayer |
| `gradient` | `axis` (`h`\|`v`), `from`, `to` (0..1), `color` | Density bands along axis |

**`stroke.kind`**

| kind | Fields |
|---|---|
| `none` | — |
| `solid` | `thickness`, `color` |
| `double` | `thickness`, `gap`, `color` |
| `dashed` | `thickness`, `dash`, `gap`, `color` |
| `ticks` | `thickness`, `step`, `color` |

**`pattern`**: `bayer2` \| `bayer4` \| `bayer8` \| `horizontal` \| `vertical` \| `diagonal` \| `screen` \| `checker` \| `dots`.

`cornerRadius` applies to solid/dither fills and solid/double strokes. Gradient fills and dashed/ticks strokes use sharp corners in v1.

`color` / ink is `black` \| `white`.

### `group`

```json
{
  "id": "group-1",
  "name": "Group",
  "type": "group",
  "x": 0, "y": 0, "w": 100, "h": 100,
  "anchor": { "x": 0, "y": 0 },
  "states": [],
  "visible": true,
  "locked": false,
  "children": []
}
```

Children store **absolute** `x`/`y` (the group is hierarchy + bbox, not a
transform parent at draw time). Runtime `Ui.set` / `Ui.animate` on a group's
`x`/`y` cascade the delta to all descendants so the whole group moves together.

## Runtime API (`playdate/Source/ui.lua`)

Load a generated scene module, then mutate nodes by stable `id` each frame.

```lua
import "ui"
import "scenes/menu"

Ui.load(MenuScene)

-- Score / mock copy
Ui.setText("score", "Score: " .. tostring(points))
print(Ui.getText("score"))

-- Popup group: show off-screen, then tween in
Ui.setVisible("popup", true)
Ui.set("popup", { y = 80 })  -- moves group + all children by dy
Ui.animate("popup", { y = 40 }, { duration = 0.3, ease = "inOut" })

function playdate.update()
  local dt = playdate.getElapsedTime()
  playdate.resetElapsedTime()
  Ui.update(dt)   -- tick tweens before draw
  gfx.clear(gfx.kColorWhite)
  Ui.draw()
end
```

| API | Behavior |
|---|---|
| `Ui.find(id)` | Recursive lookup (groups + nested). `nil` if missing |
| `Ui.setText(id, text)` / `Ui.getText(id)` | Text nodes only |
| `Ui.setVisible(id, visible)` | Sets `node.visible`; on a group, hides the whole branch |
| `Ui.set(id, patch)` | Shallow field merge; group `x`/`y` cascade to descendants |
| `Ui.setState(state)` | Active screen state filter |
| `Ui.update(dt)` | Advance tweens (`dt` = delta seconds) |
| `Ui.animate(id, props, opts?)` | Tween `x`,`y`,`w`,`h`,`rotation`. Group `x`/`y` cascade. Replaces prior tween for `id` |
| `Ui.cancelAnimate(id?)` | Cancel one id, or all if `id` omitted |

`opts`: `duration` (default `0.25`), `ease` `"linear"` \| `"inOut"`, optional `onComplete`.
`visible` is not tweened. At end, properties snap to exact targets.

Default font constant on device matches the editor: `fonts/Roobert-11-Medium`.

## Asset naming (no meta files)

| Pattern | Kind |
|---|---|
| `foo.png` | image |
| `foo-table-32-32.png` | Playdate imagetable |
| `foo-table-001.png` | sequential table frame |
| `foo-slice-8-8-8-8.png` | 9-slice L-R-T-B |
| `Name-11.fnt` | font (+ companion bitmap table) |

## Editing with an agent

### Via Nibble (in-editor)

1. Set `assistant.provider` in `.playdate-editor/project.json` (`cursor` | `claude` | `codex`).
2. Open Nibble (menubar dog / Mod+Shift+N) and use **Edit** mode.
3. Nibble autosaves if dirty, runs the CLI headlessly, and applies the resulting
   scene JSON as one undoable history entry (`Nibble: …`).
4. Agents must edit **only** the current `*.scene.json` — never generated Lua
   under `Source/scenes/`.

See [`docs/NIBBLE.md`](./NIBBLE.md).

### Via disk / external agent

1. Edit `playdate/scenes/<name>.scene.json` directly (or your host `sceneRoot`).
2. Keep `"$schema"` tooling happy by matching `schema/playdate-scene.schema.json`.
3. Validate:

```bash
bun run scenes:validate
```

4. With `bun dev` running, the Vite project bridge watches the file, validates,
   regenerates Lua under `generatedLuaRoot`, and pushes a live update to
   the open editor (no browser refresh).
5. If the editor has unsaved dirty changes, it shows a conflict banner instead of
   silently overwriting. (Nibble Edit avoids this by autosaving first.)

## Generated Lua

```bash
bun run scenes:generate
```

Output header:

```lua
-- Generated by HappyEditor — DO NOT EDIT
```

The fixture loads modules via `import "scenes/menu"` and `Ui.load(MenuScene)`.
