import { EditorProvider } from './state/EditorContext'
import { EditorShell } from './shell/EditorShell'

export default function EditorApp() {
  return (
    <EditorProvider>
      <EditorShell />
    </EditorProvider>
  )
}
