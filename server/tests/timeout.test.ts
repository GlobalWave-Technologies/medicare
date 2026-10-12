import { afterEach, expect, it, vi } from 'vitest'
import { withTimeout } from '../src/shared/utils/withTimeout.js'

afterEach(() => vi.useRealTimers())

it('bounds a stalled readiness dependency and clears the timer', async () => {
  vi.useFakeTimers()
  const pending = withTimeout(new Promise<never>(() => undefined), 3500)
  const assertion = expect(pending).rejects.toThrow('Operation timed out')
  await vi.advanceTimersByTimeAsync(3500)
  await assertion
  expect(vi.getTimerCount()).toBe(0)
})

it('clears the timeout after a successful operation', async () => {
  vi.useFakeTimers()
  await expect(withTimeout(Promise.resolve(1), 3500)).resolves.toBe(1)
  expect(vi.getTimerCount()).toBe(0)
})
