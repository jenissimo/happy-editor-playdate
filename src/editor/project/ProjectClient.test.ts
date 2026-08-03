import { expect, test } from 'bun:test'
import { ProjectClient } from './ProjectClient.ts'

test('assistant stream EOF completes once when no done event arrives', async () => {
  const originalFetch = globalThis.fetch
  const encoder = new TextEncoder()
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('event: stdout\ndata: {"text":"partial"}\n\n'),
          )
          controller.close()
        },
      }),
      { status: 200 },
    )) as typeof fetch

  try {
    const done: Array<{ code: number | null; signal: string | null }> = []
    const complete = new Promise<void>((resolve) => {
      new ProjectClient().runAssistant(
        {
          message: 'test',
          mode: 'ask',
          sceneName: 'test',
        },
        {
          onDone(result) {
            done.push(result)
            resolve()
          },
        },
      )
    })

    await complete

    expect(done).toEqual([{ code: null, signal: 'eof' }])
  } finally {
    globalThis.fetch = originalFetch
  }
})
