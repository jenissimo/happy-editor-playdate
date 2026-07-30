import type { Scene } from '../../core/scene/types'

export type HistoryEntry = {
  label: string
  undo: () => void
  redo: () => void
}

export class HistoryStack {
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private readonly limit: number

  constructor(limit = 100) {
    this.limit = limit
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null
  }

  push(entry: HistoryEntry): void {
    this.undoStack.push(entry)
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack.length = 0
  }

  /**
   * Apply a scene mutation, storing before/after snapshots for undo/redo.
   * Returns the new scene.
   */
  apply(
    getScene: () => Scene,
    setScene: (scene: Scene) => void,
    mutator: (scene: Scene) => Scene,
    label: string,
  ): Scene {
    const before = structuredClone(getScene())
    const after = mutator(structuredClone(before))
    setScene(after)
    this.push({
      label,
      undo: () => setScene(structuredClone(before)),
      redo: () => setScene(structuredClone(after)),
    })
    return after
  }

  undo(): boolean {
    const entry = this.undoStack.pop()
    if (!entry) return false
    entry.undo()
    this.redoStack.push(entry)
    return true
  }

  redo(): boolean {
    const entry = this.redoStack.pop()
    if (!entry) return false
    entry.redo()
    this.undoStack.push(entry)
    return true
  }

  clear(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
  }
}
