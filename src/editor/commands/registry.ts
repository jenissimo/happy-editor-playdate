export type Command = {
  id: string
  title: string
  shortcut?: string
  icon?: string
  enabled: () => boolean
  run: () => void
}

export class CommandRegistry {
  private readonly commands = new Map<string, Command>()

  register(command: Command): void {
    this.commands.set(command.id, command)
  }

  get(id: string): Command | undefined {
    return this.commands.get(id)
  }

  list(): Command[] {
    return [...this.commands.values()]
  }

  run(id: string): boolean {
    const cmd = this.commands.get(id)
    if (!cmd || !cmd.enabled()) return false
    cmd.run()
    return true
  }
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}

/**
 * Match a keyboard event against a shortcut string like "Mod+S", "Mod+Shift+Z", "Delete", "F".
 * Mod = Meta on macOS, Ctrl elsewhere.
 */
export function matchShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+').map((p) => p.trim().toLowerCase())
  if (parts.length === 0) return false

  const keyPart = parts[parts.length - 1]!
  const mods = new Set(parts.slice(0, -1))

  const wantMod = mods.has('mod')
  const wantCtrl = mods.has('ctrl') || mods.has('control')
  const wantMeta = mods.has('meta') || mods.has('cmd') || mods.has('command')
  const wantAlt = mods.has('alt') || mods.has('option')
  const wantShift = mods.has('shift')

  const mac = isMacPlatform()
  const modDown = mac ? e.metaKey : e.ctrlKey

  if (wantMod) {
    if (!modDown) return false
    if (mac && e.ctrlKey && !wantCtrl) return false
    if (!mac && e.metaKey && !wantMeta) return false
  } else {
    if (wantCtrl !== e.ctrlKey) return false
    if (wantMeta !== e.metaKey) return false
  }

  if (wantAlt !== e.altKey) return false
  if (wantShift !== e.shiftKey) return false

  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()
  const codeKey = e.code.replace(/^Key/, '').replace(/^Digit/, '').toLowerCase()

  if (keyPart === 'delete' || keyPart === 'del') {
    return e.key === 'Delete' || e.key === 'Backspace'
  }
  if (keyPart === 'escape' || keyPart === 'esc') {
    return e.key === 'Escape'
  }
  if (keyPart === 'enter' || keyPart === 'return') {
    return e.key === 'Enter'
  }
  if (keyPart === 'space') {
    return e.key === ' ' || e.code === 'Space'
  }
  if (keyPart === 'plus' || keyPart === '=') {
    return e.key === '+' || e.key === '=' || e.code === 'Equal'
  }
  if (keyPart === 'minus' || keyPart === '-') {
    return e.key === '-' || e.key === '_' || e.code === 'Minus'
  }

  return (
    eventKey === keyPart ||
    codeKey === keyPart ||
    e.key.toLowerCase() === keyPart
  )
}

export function findCommandByShortcut(
  registry: CommandRegistry,
  e: KeyboardEvent,
): Command | undefined {
  for (const cmd of registry.list()) {
    if (cmd.shortcut && matchShortcut(e, cmd.shortcut) && cmd.enabled()) {
      return cmd
    }
  }
  return undefined
}
