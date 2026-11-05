// @vitest-environment jsdom
/// <reference types="node" />
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Login } from '../src/features/auth/Login'
import { AuthGate } from '../src/features/auth/AuthGate'
import { createAuthStore } from '../src/features/auth/auth-store'
import { ApiError } from '../src/api/client'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { StaffUser } from '../src/api/auth'

let host: HTMLDivElement, root: Root
const stores: ReturnType<typeof createAuthStore>[] = []
const user: StaffUser = { id: 'synthetic', firstName: 'Test', lastName: 'Staff', email: 'test@example.test', staffNumber: 'STF-TESTADMIN', role: 'ADMIN', status: 'ACTIVE' }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); stores.splice(0).forEach((store) => store.dispose()); vi.unstubAllGlobals() })
const field = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
async function change(name: string, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(name), value)
    field(name).dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const submit = async () => { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }) }
function setup() {
  const api = { me: vi.fn().mockResolvedValue({ user }), login: vi.fn().mockResolvedValue({ user }), csrf: vi.fn().mockResolvedValue({ csrfToken: 'a'.repeat(64) }), logout: vi.fn().mockResolvedValue({ loggedOut: true }), logoutAll: vi.fn().mockResolvedValue({ loggedOut: true }) }
  const store = createAuthStore(api); stores.push(store); return { api, store }
}
it('waits for session restoration without flashing login or protected content', async () => {
  const { store, api } = setup(); let complete!: (value: { user: StaffUser }) => void
  api.me.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
  await act(async () => root.render(<AuthGate store={store}>{() => <p>Protected content</p>}</AuthGate>))
  expect(host.textContent).toContain('Checking your secure session')
  expect(host.querySelector('form')).toBeNull(); expect(host.textContent).not.toContain('Protected content')
  await act(async () => { complete({ user }) })
  expect(host.textContent).toContain('Protected content')
})
it('returns to sign-in with a confirmation after a password change, without the protected content', async () => {
  const { store } = setup()
  await act(async () => root.render(<AuthGate store={store}>{() => <p>Protected content</p>}</AuthGate>))
  expect(host.textContent).toContain('Protected content')
  await act(async () => store.passwordChanged())
  expect(host.textContent).not.toContain('Protected content')
  expect(host.querySelector('.login-notice[role="status"]')?.textContent).toBe('Your password was changed and you were signed out everywhere. Sign in with your new password.')
  expect(host.querySelector('form')).not.toBeNull()
})
it('shows login after a 401 instead of mounting protected content', async () => {
  const { store, api } = setup(); api.me.mockRejectedValue(new ApiError(401, 'Sign in'))
  await act(async () => root.render(<AuthGate store={store}>{() => <p>Protected content</p>}</AuthGate>))
  expect(host.querySelector('form')).not.toBeNull(); expect(host.textContent).not.toContain('Protected content')
})
it('shows a restoration error with retry and then restores under StrictMode', async () => {
  const { store, api } = setup(); api.me.mockRejectedValue(new ApiError(503, 'Unavailable', 'UNAVAILABLE', 'req-retry'))
  await act(async () => root.render(<StrictMode><AuthGate store={store}>{() => <p>Protected content</p>}</AuthGate></StrictMode>))
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('req-retry')
  expect(host.querySelector('form')).toBeNull()
  api.me.mockResolvedValue({ user })
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
  expect(host.textContent).toContain('Protected content')
})
it('has email/password labels, no role selector or remember-me control', async () => {
  await act(async () => root.render(<Login onLogin={vi.fn()} />))
  expect(field('email').labels?.[0]?.textContent).toContain('Email address')
  expect(field('password').labels?.[0]?.textContent).toContain('Password')
  expect(host.querySelector('select, input[type="radio"], input[type="checkbox"]')).toBeNull()
  expect(host.textContent).not.toMatch(/Doctor in Charge|Records Officer|Remember me/)
  expect(host.querySelector('button[type="submit"]')).not.toBeNull()
})
it('supports password visibility without submitting the form', async () => {
  const login = vi.fn(); await act(async () => root.render(<Login onLogin={login} />))
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Show password"]')!.click())
  expect(field('password').type).toBe('text')
  expect(host.querySelector('[aria-label="Hide password"]')?.getAttribute('aria-pressed')).toBe('true')
  expect(login).not.toHaveBeenCalled()
})
it('submits credentials once, disables pending controls and clears password on failure', async () => {
  let reject!: (error: Error) => void
  const login = vi.fn().mockImplementation(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise }))
  await act(async () => root.render(<Login onLogin={login} />))
  await change('email', user.email); await change('password', 'private-password')
  await submit(); await submit()
  expect(login).toHaveBeenCalledExactlyOnceWith(user.email, 'private-password')
  expect(field('email').disabled).toBe(true)
  expect(host.querySelector('form')?.getAttribute('aria-busy')).toBe('true')
  expect(host.textContent).toContain('Signing in')
  await act(async () => reject(new ApiError(401, 'Do not reveal account details', 'INVALID_CREDENTIALS', 'req-login')))
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Invalid email or password.')
  expect(host.textContent).toContain('req-login')
  expect(host.textContent).not.toContain('Do not reveal account details')
  expect(field('password').value).toBe(''); expect(field('email').disabled).toBe(false)
})
it('displays rate limiting without automatic retries', async () => {
  const login = vi.fn().mockRejectedValue(new ApiError(429, 'Too many', 'LOGIN_RATE_LIMITED', undefined, 60))
  await act(async () => root.render(<Login onLogin={login} />))
  await change('email', user.email); await change('password', 'private-password'); await submit()
  expect(host.textContent).toContain('1 minute'); expect(login).toHaveBeenCalledTimes(1)
})
it('never reads cookies or persists credentials, identity or CSRF in browser storage', async () => {
  const cookie = vi.spyOn(document, 'cookie', 'get'), storage = vi.spyOn(Storage.prototype, 'setItem')
  const { store, api } = setup(); api.me.mockRejectedValueOnce(new ApiError(401, 'Sign in'))
  await act(async () => root.render(<AuthGate store={store}>{() => <p>Protected content</p>}</AuthGate>))
  await change('email', user.email); await change('password', 'private-password'); await submit()
  expect(host.textContent).toContain('Protected content')
  expect(storage).not.toHaveBeenCalled(); expect(cookie).not.toHaveBeenCalled()
})
it('unmounts protected content when logout completes, with no mock data module left behind', async () => {
  const { store } = setup()
  await act(async () => root.render(<AuthGate store={store}>{() => <p>Protected content</p>}</AuthGate>))
  await act(async () => store.logout())
  expect(host.querySelector('form')).not.toBeNull(); expect(host.textContent).not.toContain('Protected content')
  expect(existsSync(resolve('src/mocks'))).toBe(false)
})
