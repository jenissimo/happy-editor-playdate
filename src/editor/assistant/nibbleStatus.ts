export type NibbleStatus =
  | 'idle'
  | 'thinking'
  | 'success'
  | 'error'
  | 'unconfigured'

export function nibbleStatusLabel(status: NibbleStatus): string {
  switch (status) {
    case 'idle':
      return 'Ready'
    case 'thinking':
      return 'Thinking…'
    case 'success':
      return 'Done'
    case 'error':
      return 'Error'
    case 'unconfigured':
      return 'Not configured'
  }
}
