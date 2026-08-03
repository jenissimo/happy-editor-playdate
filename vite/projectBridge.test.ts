import { expect, mock, test } from 'bun:test'
import type { ServerResponse } from 'node:http'
import { createSseEventWriter } from './projectBridge.ts'

test('SSE writer latches after backpressure and suppresses later chunks', () => {
  const write = mock(() => false)
  const response = {
    destroyed: false,
    writableEnded: false,
    writable: true,
    write,
  } as unknown as ServerResponse
  const writeEvent = createSseEventWriter(response)

  expect(writeEvent('stdout', { text: 'first' })).toBe(false)
  expect(writeEvent('stdout', { text: 'second' })).toBe(false)
  expect(write).toHaveBeenCalledTimes(1)
})
