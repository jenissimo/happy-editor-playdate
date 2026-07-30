import { useEffect, useRef, useState } from 'react'
import { projectClient, type AssistantStatus } from '../project/ProjectClient'
import { useEditorContext } from '../state/EditorContext'
import { NibbleMascot } from './NibbleMascot'
import {
  nibbleStatusLabel,
  type NibbleStatus,
} from './nibbleStatus'

export type AssistantMode = 'ask' | 'edit'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
}

type Props = {
  open: boolean
  status: NibbleStatus
  onStatusChange: (status: NibbleStatus) => void
  onClose: () => void
}

function summarizeSelection(
  nodes: { id: string; name: string; type: string; x: number; y: number; w: number; h: number }[],
): string | undefined {
  if (nodes.length === 0) return undefined
  return nodes
    .slice(0, 12)
    .map(
      (n) =>
        `- ${n.id} (${n.type} "${n.name}") @ (${Math.round(n.x)},${Math.round(n.y)}) ${Math.round(n.w)}×${Math.round(n.h)}`,
    )
    .join('\n')
}

export function NibbleChat({
  open,
  status,
  onStatusChange,
  onClose,
}: Props) {
  const editor = useEditorContext()
  const [mode, setMode] = useState<AssistantMode>('ask')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [assistantInfo, setAssistantInfo] = useState<AssistantStatus | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  const [stepLabel, setStepLabel] = useState<string | null>(null)
  const [steps, setSteps] = useState<string[]>([])
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(
    null,
  )
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<{ abort: () => void } | null>(null)
  const replyRef = useRef('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void projectClient.fetchAssistantStatus().then((s) => {
      if (cancelled) return
      setAssistantInfo(s)
      if (!s.configured) onStatusChange('unconfigured')
      else if (status === 'unconfigured') onStatusChange('idle')
    })
    return () => {
      cancelled = true
    }
    // Refresh when opened; intentionally omit `status` to avoid refetch loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onStatusChange])

  useEffect(() => {
    if (!open) return
    const t = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [open])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, busy, steps])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const providerBadge = assistantInfo?.configured
    ? assistantInfo.displayName ?? assistantInfo.provider
    : 'Not configured'

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return

    if (!assistantInfo?.configured) {
      onStatusChange('unconfigured')
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          role: 'system',
          text: 'Nibble is not configured. Set assistant.provider in .playdate-editor/project.json (cursor | claude | codex). See docs/NIBBLE.md.',
        },
      ])
      return
    }

    setInput('')
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', text },
    ])
    setBusy(true)
    setStepLabel('Starting…')
    setSteps([])
    onStatusChange('thinking')
    replyRef.current = ''

    const assistantId = `a-${Date.now()}`
    setActiveAssistantId(assistantId)
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', text: '' },
    ])

    const updateAssistant = (chunk: string) => {
      replyRef.current += chunk
      const snapshot = replyRef.current
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, text: snapshot } : m,
        ),
      )
    }

    let sawError = false
    try {
      if (editor.dirty) {
        await editor.save()
      }

      if (mode === 'edit') {
        const label =
          text.length > 48 ? `Nibble: ${text.slice(0, 45)}…` : `Nibble: ${text}`
        editor.beginNibbleSession(label)
      }

      setStepLabel('Capturing…')
      let previewPngBase64: string | undefined
      try {
        const { captureScenePreviewPng } = await import(
          '../render/captureScenePreview'
        )
        const png = await captureScenePreviewPng(
          editor.scene,
          editor.assets,
          editor.activeState,
        )
        if (png) previewPngBase64 = png
      } catch {
        /* run without preview */
      }

      setStepLabel('Packing context…')

      abortRef.current = projectClient.runAssistant(
        {
          message: text,
          mode,
          sceneName: editor.scene.name,
          activeState: editor.activeState,
          selectedIds: editor.selectedIds,
          selectedSummary: summarizeSelection(editor.selectedNodes),
          previewPngBase64,
        },
        {
          onStdout: updateAssistant,
          onStderr: () => {
            /* keep stderr out of the chat bubble; status/errors surface separately */
          },
          onStep: (label) => {
            setStepLabel(label)
            setSteps((prev) =>
              prev.length > 0 && prev[prev.length - 1] === label
                ? prev
                : [...prev, label].slice(-8),
            )
          },
          onError: (message, code) => {
            sawError = true
            if (code === 'unconfigured') onStatusChange('unconfigured')
            else onStatusChange('error')
            updateAssistant(replyRef.current ? `\n\n${message}` : message)
          },
          onDone: (result) => {
            void (async () => {
              if (mode === 'edit') {
                setStepLabel('Applying scene…')
                await editor.finishNibbleSession()
              } else {
                editor.endNibbleSession()
              }
              setBusy(false)
              setStepLabel(null)
              setActiveAssistantId(null)
              abortRef.current = null
              const aborted = result.signal === 'aborted'
              const failed =
                sawError ||
                (result.code !== null && result.code !== 0 && !aborted)
              if (aborted) {
                onStatusChange('idle')
              } else if (failed) {
                if (!sawError) onStatusChange('error')
              } else {
                onStatusChange('success')
                window.setTimeout(() => onStatusChange('idle'), 1200)
              }
              if (!replyRef.current.trim()) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          text: failed
                            ? 'Nibble finished with an error and no reply text.'
                            : 'Nibble finished.',
                        }
                      : m,
                  ),
                )
              }
            })()
          },
        },
      )
    } catch (e) {
      editor.endNibbleSession()
      setBusy(false)
      setStepLabel(null)
      setActiveAssistantId(null)
      onStatusChange('error')
      const msg = e instanceof Error ? e.message : 'Request failed'
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, text: msg } : m,
        ),
      )
    }
  }

  const stop = () => {
    abortRef.current?.abort()
    abortRef.current = null
    editor.endNibbleSession()
    setBusy(false)
    setStepLabel(null)
    setActiveAssistantId(null)
    onStatusChange('idle')
  }

  return (
    <div className="nibble-chat" role="dialog" aria-label="Nibble assistant">
      <header className="nibble-chat__header">
        <NibbleMascot status={status} size={32} />
        <div className="nibble-chat__titles">
          <strong>Nibble</strong>
          <span className="nibble-chat__meta">
            {nibbleStatusLabel(status, stepLabel)} · {providerBadge}
          </span>
        </div>
        <div className="nibble-chat__modes" role="group" aria-label="Mode">
          <button
            type="button"
            className={mode === 'ask' ? 'is-active' : undefined}
            disabled={busy}
            onClick={() => setMode('ask')}
          >
            Ask
          </button>
          <button
            type="button"
            className={mode === 'edit' ? 'is-active' : undefined}
            disabled={busy}
            onClick={() => setMode('edit')}
          >
            Edit
          </button>
        </div>
        <button
          type="button"
          className="nibble-chat__close"
          onClick={onClose}
          aria-label="Close Nibble"
        >
          ×
        </button>
      </header>

      <div className="nibble-chat__messages" ref={listRef}>
        {messages.length === 0 && (
          <p className="nibble-chat__empty">
            Ask about the current scene, or switch to Edit so Nibble can change{' '}
            <code>{editor.scene.name}.scene.json</code>.
          </p>
        )}
        {messages.map((m) => {
          const isActiveReply = busy && m.id === activeAssistantId
          return (
            <div
              key={m.id}
              className={`nibble-chat__bubble nibble-chat__bubble--${m.role}`}
            >
              {m.text}
              {isActiveReply && m.text && (
                <span className="nibble-chat__caret" aria-hidden="true" />
              )}
              {isActiveReply && !m.text && (
                <div className="nibble-chat__steps" aria-live="polite">
                  {(steps.length > 0 ? steps : [stepLabel ?? 'Thinking…']).map(
                    (s, i, arr) => (
                      <span
                        key={`${s}-${i}`}
                        className={
                          i === arr.length - 1
                            ? 'nibble-chat__step is-current'
                            : 'nibble-chat__step'
                        }
                      >
                        {s}
                      </span>
                    ),
                  )}
                </div>
              )}
              {isActiveReply && m.text && stepLabel && stepLabel !== 'Writing…' && (
                <div className="nibble-chat__step-inline" aria-live="polite">
                  {stepLabel}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <footer className="nibble-chat__footer">
        <textarea
          ref={inputRef}
          className="nibble-chat__input"
          rows={2}
          placeholder={
            mode === 'edit'
              ? 'Tell Nibble what to change…'
              : 'Ask Nibble a question…'
          }
          value={input}
          disabled={busy && !assistantInfo?.configured}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <div className="nibble-chat__actions">
          {busy ? (
            <button type="button" onClick={stop}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="nibble-chat__send"
              disabled={!input.trim()}
              onClick={() => void send()}
            >
              Send
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}
