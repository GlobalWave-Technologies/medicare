import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuthStore } from '../src/features/auth/auth-store'
import { ApiError, request, resetApiSession } from '../src/api/client'
import { allowedView, navItemsByRole, toUiRole } from '../src/app/navigation'
import type { StaffUser } from '../src/api/auth'
const user: StaffUser = { id: 'synthetic', firstName: 'Test', lastName: 'Staff', email: 'test@example.test', staffNumber: 'STF-TESTADMIN', role: 'ADMIN', status: 'ACTIVE' }
const stores: ReturnType<typeof createAuthStore>[] = []
function setup() {
  const api = { me: vi.fn().mockResolvedValue({ user }), login: vi.fn().mockResolvedValue({ user }),
    csrf: vi.fn().mockResolvedValue({ csrfToken: 'a'.repeat(64) }), logout: vi.fn().mockResolvedValue({ loggedOut: true }), logoutAll: vi.fn().mockResolvedValue({ loggedOut: true }) }
  const store = createAuthStore(api); stores.push(store)
  return { api, store }
}
afterEach(() => { stores.splice(0).forEach((store) => store.dispose()); vi.unstubAllGlobals(); resetApiSession() })
describe('in-memory authentication lifecycle', () => {
  it('starts loading and restores a safe authenticated user', async () => {
    const { store } = setup()
    expect(store.getSnapshot()).toEqual({ status: 'loading', user: null })
    await store.refreshUser()
    expect(store.getSnapshot()).toEqual({ status: 'authenticated', user })
  })
  it('treats initial 401 as unauthenticated', async () => {
    const { store, api } = setup(); api.me.mockRejectedValueOnce(new ApiError(401, 'Sign in'))
    await store.refreshUser()
    expect(store.getSnapshot()).toEqual({ status: 'unauthenticated', user: null })
  })
  it.each([new TypeError('network'), new ApiError(503, 'Unavailable')])('blocks content on restoration error and allows a retry %#', async (error) => {
    const { store, api } = setup(); api.me.mockRejectedValueOnce(error)
    await store.refreshUser()
    expect(store.getSnapshot()).toEqual({ status: 'error', user: null, error })
    await store.refreshUser()
    expect(store.getSnapshot().status).toBe('authenticated')
  })
  it('stores the role returned by login, with no role argument', async () => {
    const { store, api } = setup(), doctor = { ...user, role: 'DOCTOR_IN_CHARGE' as const }
    api.login.mockResolvedValueOnce({ user: doctor })
    await store.login(user.email, 'private-password')
    expect(api.login).toHaveBeenCalledExactlyOnceWith(user.email, 'private-password')
    expect(store.getSnapshot()).toEqual({ status: 'authenticated', user: doctor })
  })
  it('does not authenticate on failed login', async () => {
    const { store, api } = setup(); api.me.mockRejectedValueOnce(new ApiError(401, 'Sign in'))
    await store.refreshUser(); api.login.mockRejectedValueOnce(new ApiError(401, 'Invalid credentials'))
    await expect(store.login(user.email, 'wrong')).rejects.toMatchObject({ status: 401 })
    expect(store.getSnapshot().status).toBe('unauthenticated')
  })
  it.each(['logout', 'logoutAll'] as const)('%s calls the server and clears identity', async (method) => {
    const { store, api } = setup(); await store.refreshUser(); await store[method]()
    expect(api[method]).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toEqual({ status: 'unauthenticated', user: null })
  })
  it('clears stale UI after logout 401', async () => {
    const { store, api } = setup(); await store.refreshUser(); api.logout.mockRejectedValueOnce(new ApiError(401, 'Expired'))
    await store.logout()
    expect(store.getSnapshot().status).toBe('unauthenticated')
  })
  it.each([new TypeError('network'), new ApiError(403, 'Forbidden'), new ApiError(500, 'Failure')])('retains identity and reports unconfirmed logout failure %#', async (error) => {
    const { store, api } = setup(); await store.refreshUser(); api.logout.mockRejectedValueOnce(error)
    await expect(store.logout()).rejects.toBe(error)
    expect(store.getSnapshot().status).toBe('authenticated')
  })
  it('coalesces simultaneous logout clicks', async () => {
    const { store, api } = setup(); await store.refreshUser()
    await Promise.all([store.logout(), store.logout()])
    expect(api.logout).toHaveBeenCalledTimes(1)
  })
  it('clears state on centralized authenticated 401 but not 403', async () => {
    const { store } = setup(); await store.refreshUser()
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 403 })).mockResolvedValueOnce(new Response('{}', { status: 401 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(request('/protected')).rejects.toMatchObject({ status: 403 })
    expect(store.getSnapshot().status).toBe('authenticated')
    await expect(request('/protected')).rejects.toMatchObject({ status: 401 })
    expect(store.getSnapshot().status).toBe('unauthenticated')
  })
  it('ignores a stale restoration after a later successful login', async () => {
    const { store, api } = setup(); let complete!: (value: { user: StaffUser }) => void
    api.me.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    const pending = store.refreshUser()
    const doctor = { ...user, role: 'DOCTOR_IN_CHARGE' as const }; api.login.mockResolvedValueOnce({ user: doctor })
    await store.login(user.email, 'password'); complete({ user }); await pending
    expect(store.getSnapshot().user?.role).toBe('DOCTOR_IN_CHARGE')
  })
  it('ignores an aborted restoration response', async () => {
    const { store } = setup(), controller = new AbortController()
    const pending = store.refreshUser(controller.signal); controller.abort(); await pending
    expect(store.getSnapshot().status).toBe('loading')
  })
  it.each(['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('derives allowed navigation and landing from backend %s', (role) => {
    const uiRole = toUiRole(role), available = navItemsByRole[uiRole]
    // Every role has a server dashboard and at least one report it may read.
    expect(available[0]!.label).toBe('Overview'); expect(allowedView(role, 'Overview')).toBe('Overview')
    expect(allowedView(role, 'Reports')).toBe('Reports')
    expect(allowedView(role, 'Staff')).toBe(role === 'ADMIN' ? 'Staff' : 'Overview')
    expect(allowedView(role, 'Medical records')).toBe(role === 'DOCTOR_IN_CHARGE' ? 'Medical records' : 'Overview')
  })
})
