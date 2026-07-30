# Nibble — scene assistant

Nibble is HappyEditor’s pixel-dog assistant. Ask questions about the open scene, or let Nibble edit the current `.scene.json` through a configured headless CLI.

## Setup (project install)

Provider is **project-level**, not per-chat. Add it when you create `.playdate-editor/project.json`:

```json
{
  "version": 1,
  "sceneRoot": "scenes",
  "sourceRoot": "Source",
  "generatedLuaRoot": "Source/scenes",
  "assetRoots": ["Source/images", "Source/fonts"],
  "defaultScene": "menu",
  "pdxOut": "Editor.pdx",
  "assistant": {
    "provider": "cursor"
  }
}
```

`assistant.provider` must be one of:

| Value | CLI binary | Notes |
|---|---|---|
| `cursor` | `agent` (or `cursor-agent`) | Ask: `--mode=ask`. Edit: `--force` |
| `claude` | `claude` | Ask: plan permission mode. Edit: Read/Edit/Write tools |
| `codex` | `codex` | `codex exec` with read-only or workspace-write sandbox |

The chosen CLI must be on `PATH` and authenticated the way that tool expects (`CURSOR_API_KEY`, `claude login`, Codex login / `CODEX_API_KEY`, etc.).

If `assistant` is missing, Nibble shows **Not configured** and will not guess a provider.

## Open Nibble

- Click the dog in the menubar
- View → Nibble…
- Shortcut: **Mod+Shift+N**
- Command palette: **Open Nibble**

## Modes

| Mode | Behavior |
|---|---|
| **Ask** | Read-only. CLI answers; no file writes. |
| **Edit** | Autosaves if dirty, then CLI may edit **only** the current scene JSON. The editor applies the disk update as one undoable `Nibble: …` history entry. |

Nibble tells the agent: do not touch generated Lua under `Source/scenes/`, other scenes, or unrelated files.

## Dog statuses

| Status | Meaning |
|---|---|
| `idle` | Ready |
| `thinking` | CLI running |
| `success` | Reply / edit finished (brief) |
| `error` | Fail / timeout / missing CLI / auth |
| `unconfigured` | No `assistant.provider` in project.json |

Menubar dog and chat avatar share the same status. Extra sprites can live under `src/assets/nibble/{status}.gif`; until then the UI uses `happy_dog.gif` plus CSS cues.

## Undo

After an Edit run that changes the scene file, **Undo** restores the pre-Nibble scene snapshot. Save again if you want that restored JSON on disk.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Not configured | Add `assistant.provider` to `.playdate-editor/project.json` |
| CLI not found in PATH | Install Cursor CLI / Claude Code / Codex and restart `bun dev` |
| Conflict banner | Dirty local edits vs external write — Save first, or use Ask; Edit autosaves before the run |
| No reply text | Check Console / auth for the CLI; Stop cancels the run |

See also: [SCENE_FORMAT.md](./SCENE_FORMAT.md) (agent editing), [README](../README.md) (submodule setup).
