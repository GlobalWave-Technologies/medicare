import { ApiError } from './client'

export function newIdempotencyKey() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Browsers without randomUUID still provide the same cryptographic generator.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// One key per deliberate submission of one payload, held only in memory. An unconfirmed
// outcome keeps the key, so resubmitting the unchanged payload returns the original result
// instead of writing twice. Success, a definite server answer or a changed payload starts afresh.
export function submissionKeys() {
  let current: { payload: string; key: string } | undefined
  return {
    key(payload: unknown) {
      const serialized = JSON.stringify(payload)
      if (current?.payload !== serialized) current = { payload: serialized, key: newIdempotencyKey() }
      return current.key
    },
    settle(error?: unknown) {
      if (error === undefined || (error instanceof ApiError && error.status < 500)) current = undefined
    },
  }
}
