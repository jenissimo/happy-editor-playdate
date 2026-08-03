import { expect, mock, test } from 'bun:test'

let command = '__happy_editor_missing_assistant_binary__'
let args: string[] = []

mock.module('./providers.ts', () => ({
  findProviderBinary: () => process.execPath,
  buildProviderCommand: () => ({
    command,
    args,
    cwd: process.cwd(),
  }),
}))

const { startAssistantRun } = await import('./run.ts')

test('assistant spawn errors emit one error followed by one terminal done event', async () => {
  command = '__happy_editor_missing_assistant_binary__'
  args = []
  const chunks: Array<{ type: string }> = []
  const complete = new Promise<void>((resolve) => {
    startAssistantRun(
      {
        provider: 'codex',
        mode: 'ask',
        prompt: 'test',
        cwd: process.cwd(),
      },
      (chunk) => {
        chunks.push(chunk)
        if (chunk.type === 'done') resolve()
      },
    )
  })

  await complete

  expect(chunks.map((chunk) => chunk.type)).toEqual(['error', 'done'])
})

test('assistant emits done only after a naturally exiting child closes', async () => {
  command = process.execPath
  args = [
    '-e',
    "process.stdout.write('ready\\n'); setTimeout(() => process.exit(0), 200)",
  ]
  const chunks: Array<{ type: string }> = []
  const ready = new Promise<void>((resolve) => {
    startAssistantRun(
      {
        provider: 'codex',
        mode: 'ask',
        prompt: 'test',
        cwd: process.cwd(),
      },
      (chunk) => {
        chunks.push(chunk)
        if (chunk.type === 'stdout') resolve()
      },
    )
  })

  await ready
  await Bun.sleep(50)

  expect(chunks.some((chunk) => chunk.type === 'done')).toBe(false)
  await Bun.sleep(250)
  expect(chunks.map((chunk) => chunk.type)).toEqual(['stdout', 'done'])
})

test('assistant timeout closes an unresponsive child before terminal done', async () => {
  command = process.execPath
  args = [
    '-e',
    "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000)",
  ]
  const chunks: Array<{ type: string }> = []
  const complete = new Promise<void>((resolve) => {
    startAssistantRun(
      {
        provider: 'codex',
        mode: 'ask',
        prompt: 'test',
        cwd: process.cwd(),
        timeoutMs: 200,
      },
      (chunk) => {
        chunks.push(chunk)
        if (chunk.type === 'done') resolve()
      },
    )
  })

  await Promise.race([
    complete,
    Bun.sleep(2_500).then(() => {
      throw new Error('timed-out assistant child did not close')
    }),
  ])

  expect(chunks.map((chunk) => chunk.type)).toEqual([
    'stdout',
    'error',
    'done',
  ])
})
