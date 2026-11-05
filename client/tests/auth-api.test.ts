import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authApi } from '../src/api/auth'
import { ApiError, authErrorMessage, mutation, onSessionInvalidated, request, resetApiSession } from '../src/api/client'

const user = { id: 'synthetic-id', staffNumber: 'STF-TESTADMIN', firstName: 'Test', lastName: 'Staff', email: 'staff@example.test', role: 'ADMIN', status: 'ACTIVE' }
const token = 'a'.repeat(64)
const response = (data: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }), { status, headers })
const fetcher = vi.fn<typeof fetch>()
beforeEach(() => { resetApiSession(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher) })
afterEach(() => vi.unstubAllGlobals())

describe('credentialed API and session contract', () => {
  it('does not invalidate authentication when a cancelled response finishes parsing', async () => {
    const controller = new AbortController()
    const invalidated = vi.fn(), stop = onSessionInvalidated(invalidated)
    let complete!: (value: unknown) => void
    const result = response({ code: 'AUTHENTICATION_REQUIRED' }, 401)
    vi.spyOn(result, 'json').mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    fetcher.mockResolvedValueOnce(result)
    try {
      const pending = authApi.me(controller.signal)
      await vi.waitFor(() => expect(result.json).toHaveBeenCalled())
      controller.abort()
      complete({ success: false, error: { code: 'AUTHENTICATION_REQUIRED' } })
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      expect(invalidated).not.toHaveBeenCalled()
    } finally { stop() }
  })
  it('shows safe validation feedback without presenting it as a network failure', () => {
    expect(authErrorMessage(new ApiError(400, 'Invalid request data', 'VALIDATION_ERROR')))
      .toBe('Please check the submitted details and try again.')
  })
  it('logs in using email/password only, with credentials and no CSRF request', async () => {
    fetcher.mockResolvedValueOnce(response({ user }))
    expect(await authApi.login(' staff@example.test ', ' secret password ')).toEqual({ user })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('/api/v1/auth/login')
    expect(init).toMatchObject({ credentials: 'include', method: 'POST', cache: 'no-store' })
    expect(JSON.parse(init!.body as string)).toEqual({ email: 'staff@example.test', password: ' secret password ' })
    expect(new Headers(init!.headers).has('X-CSRF-Token')).toBe(false)
  })
  it('restores exact safe backend identity without retaining extra secret fields', async () => {
    fetcher.mockResolvedValueOnce(response({ user: { ...user, passwordHash: 'discard', sessionId: 'discard' } }))
    expect(await authApi.me()).toEqual({ user })
    expect(new Headers(fetcher.mock.calls[0]![1]!.headers).has('X-CSRF-Token')).toBe(false)
  })
  it.each(['RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'])('restores backend role %s', async (role) => {
    fetcher.mockResolvedValueOnce(response({ user: { ...user, role } }))
    expect((await authApi.me()).user.role).toBe(role)
  })
  it.each([{ role: 'SUPER_ADMIN' }, { status: 'SUSPENDED' }, { status: 'PENDING' }, { status: 'DISABLED' }, { email: null }, { id: 123 }])('fails closed for invalid principal %j', async (fields) => {
    fetcher.mockResolvedValueOnce(response({ user: { ...user, ...fields } }))
    await expect(authApi.me()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
  it('does not globally invalidate for incorrect login credentials', async () => {
    const invalidated = vi.fn(), stop = onSessionInvalidated(invalidated)
    try {
      fetcher.mockResolvedValueOnce(response({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials', requestId: 'req-1' }, 401))
      await expect(authApi.login('staff@example.test', 'wrong')).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS', requestId: 'req-1' })
      expect(invalidated).not.toHaveBeenCalled()
    } finally { stop() }
  })
  it('invalidates authenticated 401 once and clears cached CSRF', async () => {
    const invalidated = vi.fn(), stop = onSessionInvalidated(invalidated)
    try {
      fetcher.mockResolvedValueOnce(response({ csrfToken: token })).mockResolvedValueOnce(response({ code: 'AUTHENTICATION_REQUIRED', message: 'Sign in' }, 401)).mockResolvedValueOnce(response({ csrfToken: 'b'.repeat(64) }))
      await authApi.csrf()
      await expect(request('/protected')).rejects.toMatchObject({ status: 401 })
      expect(invalidated).toHaveBeenCalledTimes(1)
      expect(await authApi.csrf()).toEqual({ csrfToken: 'b'.repeat(64) })
    } finally { stop() }
  })
  it('keeps authenticated state on 403 and preserves safe error fields', async () => {
    const invalidated = vi.fn(), stop = onSessionInvalidated(invalidated)
    try {
      fetcher.mockResolvedValueOnce(response({ code: 'FORBIDDEN', message: 'Permission denied', requestId: 'req-403' }, 403))
      await expect(request('/protected')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', message: 'Permission denied', requestId: 'req-403' })
      expect(invalidated).not.toHaveBeenCalled()
    } finally { stop() }
  })
  it('handles 429 Retry-After without replaying login', async () => {
    fetcher.mockResolvedValueOnce(response({ code: 'LOGIN_RATE_LIMITED', message: 'Try later' }, 429, { 'Retry-After': '120' }))
    const error = await authApi.login('staff@example.test', 'wrong').catch((error: unknown) => error)
    expect(error).toMatchObject({ status: 429, retryAfter: 120 })
    expect(authErrorMessage(error)).toContain('2 minute')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([new Response('<html>Proxy failure</html>', { status: 502 }), response(null), new Response('{}')])('handles malformed envelopes safely %#', async (value) => {
    fetcher.mockResolvedValueOnce(value)
    await expect(authApi.me()).rejects.toBeInstanceOf(ApiError)
  })
  it('merges Headers objects and forwards abort signals', async () => {
    const controller = new AbortController()
    fetcher.mockResolvedValueOnce(response({ ok: true }))
    await request('/protected', { headers: new Headers({ 'X-Request-Id': 'req-test' }), signal: controller.signal })
    expect(fetcher.mock.calls[0]![1]!.signal).toBe(controller.signal)
    expect(new Headers(fetcher.mock.calls[0]![1]!.headers).get('X-Request-Id')).toBe('req-test')
  })
  it('ignores a late 401 from the preceding session after login', async () => {
    let complete!: (response: Response) => void
    fetcher.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    const stale = request('/protected')
    fetcher.mockResolvedValueOnce(response({ user }))
    await authApi.login(user.email, 'password')
    complete(response({ code: 'AUTHENTICATION_REQUIRED' }, 401))
    await expect(stale).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
  })
})

describe('session-bound CSRF and explicit mutations', () => {
  it('shares token requests and reuses a token within a session', async () => {
    fetcher.mockResolvedValueOnce(response({ csrfToken: token }))
    expect(await Promise.all([authApi.csrf(), authApi.csrf()])).toEqual([{ csrfToken: token }, { csrfToken: token }])
    await authApi.csrf()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(['logout', 'logoutAll'] as const)('%s calls the backend with CSRF and clears the cache', async (method) => {
    fetcher.mockResolvedValueOnce(response({ csrfToken: token })).mockResolvedValueOnce(response({ loggedOut: true })).mockResolvedValueOnce(response({ csrfToken: 'b'.repeat(64) }))
    await authApi[method]()
    expect(fetcher.mock.calls[1]![0]).toBe(`/api/v1/auth/${method === 'logout' ? 'logout' : 'logout-all'}`)
    expect(new Headers(fetcher.mock.calls[1]![1]!.headers).get('X-CSRF-Token')).toBe(token)
    expect(fetcher.mock.calls[1]![1]).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(await authApi.csrf()).toEqual({ csrfToken: 'b'.repeat(64) })
  })
  it('refreshes rejected CSRF only on the next deliberate attempt without replaying POST', async () => {
    fetcher.mockResolvedValueOnce(response({ csrfToken: token })).mockResolvedValueOnce(response({ code: 'CSRF_INVALID', message: 'Invalid token' }, 403))
    await expect(mutation('/protected', { method: 'POST' })).rejects.toMatchObject({ code: 'CSRF_INVALID' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    fetcher.mockResolvedValueOnce(response({ csrfToken: 'b'.repeat(64) })).mockResolvedValueOnce(response({ done: true }))
    await mutation('/protected', { method: 'POST' })
    expect(new Headers(fetcher.mock.calls[3]![1]!.headers).get('X-CSRF-Token')).toBe('b'.repeat(64))
  })
  it('drops cached CSRF across login', async () => {
    fetcher.mockResolvedValueOnce(response({ csrfToken: token })).mockResolvedValueOnce(response({ user })).mockResolvedValueOnce(response({ csrfToken: 'b'.repeat(64) }))
    await authApi.csrf(); await authApi.login(user.email, 'password')
    expect(await authApi.csrf()).toEqual({ csrfToken: 'b'.repeat(64) })
  })
  it('does not dispatch a mutation if the session changes during token retrieval', async () => {
    let complete!: (value: Response) => void
    fetcher.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    const pending = mutation('/protected', { method: 'POST' })
    resetApiSession()
    complete(response({ csrfToken: token }))
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('does not dispatch an aborted mutation after shared CSRF retrieval', async () => {
    fetcher.mockResolvedValueOnce(response({ csrfToken: token }))
    const controller = new AbortController(); controller.abort()
    await expect(mutation('/protected', { method: 'PATCH', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([{}, { csrfToken: 'invalid' }, { csrfToken: null }])('rejects malformed CSRF %j', async (data) => {
    fetcher.mockResolvedValueOnce(response(data))
    await expect(authApi.csrf()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
  it('never retries failed network mutations automatically', async () => {
    fetcher.mockResolvedValueOnce(response({ csrfToken: token })).mockRejectedValueOnce(new TypeError('network'))
    await expect(mutation('/protected', { method: 'POST' })).rejects.toThrow('network')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
