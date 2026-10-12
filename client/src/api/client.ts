export class ApiError extends Error {
  status: number
  code?: string
  requestId?: string
  retryAfter?: number
  constructor(status: number, message: string, code?: string,
    requestId?: string, retryAfter?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status; this.code = code; this.requestId = requestId; this.retryAfter = retryAfter
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const textField = (value: unknown) => typeof value === 'string' ? value : undefined
const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/+$/, '')
let revision = 0
let csrf: string | undefined
let pendingCsrf: Promise<string> | undefined
const invalidationListeners = new Set<() => void>()

export function resetApiSession() {
  revision += 1
  csrf = undefined
  pendingCsrf = undefined
}
export function onSessionInvalidated(listener: () => void) {
  invalidationListeners.add(listener)
  return () => { invalidationListeners.delete(listener) }
}
const sessionChanged = () => new ApiError(409, 'The session changed. Please try again.', 'SESSION_CHANGED')

export async function request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  const started = revision
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include', cache: 'no-store' })
  const payload: unknown = await response.json().catch(() => null)
  // Late responses from an old session must not clear or populate a new session.
  if (started !== revision) throw sessionChanged()
  if (!response.ok) {
    if (authenticated && response.status === 401) {
      resetApiSession()
      invalidationListeners.forEach((listener) => listener())
    }
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {}
    const retryHeader = response.headers.get('Retry-After')
    const retryAfter = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : undefined
    throw new ApiError(response.status, textField(error.message) ?? 'Request failed',
      textField(error.code), textField(error.requestId) ?? response.headers.get('X-Request-Id') ?? undefined, retryAfter)
  }
  if (!isRecord(payload) || payload.success !== true || !('data' in payload)) {
    throw new ApiError(502, 'The server returned an unexpected response.', 'INVALID_RESPONSE')
  }
  return payload.data as T
}

export function csrfToken(): Promise<string> {
  if (csrf) return Promise.resolve(csrf)
  if (pendingCsrf) return pendingCsrf
  const started = revision
  const pending = request<unknown>('/auth/csrf').then((data) => {
    if (started !== revision) throw sessionChanged()
    if (!isRecord(data) || typeof data.csrfToken !== 'string' || !/^[a-f0-9]{64}$/.test(data.csrfToken)) {
      throw new ApiError(502, 'The server returned an unexpected response.', 'INVALID_RESPONSE')
    }
    csrf = data.csrfToken
    return csrf
  }).finally(() => { if (pendingCsrf === pending) pendingCsrf = undefined })
  pendingCsrf = pending
  return pending
}

export async function mutation<T>(path: string, init: RequestInit): Promise<T> {
  const started = revision
  const token = await csrfToken()
  init.signal?.throwIfAborted()
  if (started !== revision) throw sessionChanged()
  const headers = new Headers(init.headers)
  headers.set('X-CSRF-Token', token)
  try {
    return await request<T>(path, { ...init, headers })
  } catch (error) {
    if (started === revision && error instanceof ApiError && error.code === 'CSRF_INVALID') {
      csrf = undefined
      pendingCsrf = undefined
    }
    // Never replay a mutation. A deliberate retry fetches CSRF again if needed.
    throw error
  }
}

export function authErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_CREDENTIALS') return 'Invalid email or password.'
    if (error.status === 429) return error.retryAfter
      ? `Too many sign-in attempts. Try again in about ${Math.ceil(error.retryAfter / 60)} minute(s).`
      : 'Too many sign-in attempts. Please try again later.'
    if (error.code === 'CSRF_INVALID') return 'Your security token needs refreshing. Please try again.'
    if (error.status === 403) return 'You do not have permission to perform this action.'
    if (error.code === 'SESSION_CHANGED') return 'Your session changed. Please try again.'
  }
  return 'Unable to contact the server. Please try again.'
}
