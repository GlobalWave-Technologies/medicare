// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthGate } from '../src/features/auth/AuthGate'
import { Login } from '../src/features/auth/Login'
import { createAuthStore } from '../src/features/auth/auth-store'
import { authApi, type StaffUser } from '../src/api/auth'
import { ApiError, request } from '../src/api/client'
import { INSTALL_OFFER_KEY, resetInstallForTests } from '../src/pwa/install'
import { setOnlineForTests } from '../src/pwa/connectivity'

let host: HTMLDivElement, root: Root
const stores: ReturnType<typeof createAuthStore>[] = []
const established: StaffUser = { id: 'synthetic-staff', firstName: 'Ama', lastName: 'Recruit', email: 'ama.recruit@example.test', staffNumber: 'STF-RECRUIT1', role: 'RECORDS_OFFICER', status: 'ACTIVE', mustChangePassword: false }
const temporary: StaffUser = { ...established, mustChangePassword: true }
const TEMP = 'Temporary synthetic passphrase 2026', NEXT = 'Personal synthetic passphrase 2026'
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear(); resetInstallForTests(); setOnlineForTests(true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); stores.splice(0).forEach((store) => store.dispose()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function setup(user: StaffUser = temporary) {
  const api = { me: vi.fn().mockResolvedValue({ user }), login: vi.fn().mockResolvedValue({ user: established }), csrf: vi.fn().mockResolvedValue({ csrfToken: 'a'.repeat(64) }),
    logout: vi.fn().mockResolvedValue({ loggedOut: true }), logoutAll: vi.fn().mockResolvedValue({ loggedOut: true }) }
  const store = createAuthStore(api); stores.push(store); return { api, store }
}
const render = async (store: ReturnType<typeof createAuthStore>) => act(async () => root.render(<AuthGate store={store}>{(user) => <nav aria-label="Workspace navigation"><p>Workspace for {user.firstName}</p></nav>}</AuthGate>))
const buttons = () => [...host.querySelectorAll('button')].map((button) => button.textContent?.trim())
const button = (name: string) => [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === name)!
const field = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
async function type(name: string, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(name), value)
    field(name).dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const submit = async () => { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }) }
async function fill(current = TEMP, next = NEXT, confirm = next) { await type('currentPassword', current); await type('newPassword', next); await type('confirmNewPassword', confirm) }

it('shows only the mandatory change screen while the password is temporary: no workspace, menu or skip', async () => {
  const { store } = setup()
  await render(store)
  expect(host.querySelector('h1')?.textContent).toBe('Change your temporary password')
  expect(host.textContent).toContain('Replace the temporary password you were given before you use Medicare.')
  expect(host.textContent).not.toContain('Workspace for')
  expect(host.querySelector('nav[aria-label="Workspace navigation"]')).toBeNull()
  expect(['currentPassword', 'newPassword', 'confirmNewPassword'].map((name) => Boolean(field(name)))).toEqual([true, true, true])
  expect([...host.querySelectorAll('label')].map((label) => label.firstChild?.textContent)).toEqual(expect.arrayContaining(['Current password', 'New password', 'Confirm new password']))
  expect(buttons()).toEqual(expect.arrayContaining(['Change password', 'Sign out']))
  expect(buttons().filter((name) => /skip|later|continue|not now|install/i.test(name ?? ''))).toEqual([])
  expect(host.textContent).toMatch(/15 to 128 characters; spaces are allowed/)
  expect(document.activeElement).toBe(host.querySelector('h1'))
})

it('signs out from the mandatory screen', async () => {
  const { store, api } = setup()
  await render(store)
  await act(async () => { button('Sign out').click() })
  expect(api.logout).toHaveBeenCalledTimes(1)
  expect(host.querySelector('#login-email')).not.toBeNull()
})

it('checks the new password locally before sending anything, and never sends the confirmation', async () => {
  const { store } = setup()
  const change = vi.spyOn(authApi, 'changePassword').mockResolvedValue({ passwordChanged: true })
  await render(store)
  await fill(TEMP, 'too short', 'too short'); await submit()
  await fill(TEMP, NEXT, 'Different confirmation passphrase'); await submit()
  expect(change).not.toHaveBeenCalled()
  expect(host.textContent).toContain('The new passwords don’t match.')
  await fill(); await submit()
  expect(change).toHaveBeenCalledWith(TEMP, NEXT)
  expect(change.mock.calls[0]).toHaveLength(2)
})

it('a wrong temporary password keeps the requirement and shows a field error', async () => {
  const { store } = setup()
  vi.spyOn(authApi, 'changePassword').mockRejectedValue(new ApiError(400, 'Wrong', 'CURRENT_PASSWORD_INVALID'))
  await render(store)
  await fill(); await submit()
  expect(host.querySelector('h1')?.textContent).toBe('Change your temporary password')
  expect(host.textContent).toContain('Your current password isn’t correct.')
  expect(field('currentPassword').getAttribute('aria-invalid')).toBe('true')
})

it('after the change: sign-in with a clear confirmation, then the normal workspace on the next sign-in', async () => {
  const { store, api } = setup()
  vi.spyOn(authApi, 'changePassword').mockResolvedValue({ passwordChanged: true })
  await render(store)
  await fill(); await submit()
  expect(host.querySelector('.login-notice[role="status"]')?.textContent).toBe('Password changed successfully. Sign in again with your new password.')
  expect(host.textContent).not.toContain('Workspace for')
  expect(localStorage.getItem(INSTALL_OFFER_KEY)).toBe('1')
  await type('email', established.email); await type('password', NEXT); await submit()
  expect(api.login).toHaveBeenCalledWith(established.email, NEXT)
  expect(host.textContent).toContain('Workspace for Ama')
})

it('a 403 PASSWORD_CHANGE_REQUIRED from any request re-reads the identity and shows the change screen', async () => {
  const { store, api } = setup(established)
  await render(store)
  expect(host.textContent).toContain('Workspace for Ama')
  api.me.mockResolvedValue({ user: temporary })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change your temporary password to continue' } }), { status: 403 })))
  await act(async () => { await request('/patients').catch(() => {}) })
  await act(async () => { await Promise.resolve() })
  expect(api.me).toHaveBeenCalledTimes(2)
  expect(host.querySelector('h1')?.textContent).toBe('Change your temporary password')
  expect(host.textContent).not.toContain('Workspace for')
})

it('Forgot your password? explains administrator-assisted recovery and sends nothing', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  await act(async () => root.render(<Login onLogin={vi.fn()} />))
  const toggle = button('Forgot your password?')
  const note = host.querySelector<HTMLElement>('#login-forgot-note')!
  expect([toggle.getAttribute('aria-expanded'), toggle.getAttribute('aria-controls'), note.hidden]).toEqual(['false', 'login-forgot-note', true])
  await type('email', 'someone@example.test')
  await act(async () => { toggle.click() })
  expect([toggle.getAttribute('aria-expanded'), note.hidden, note.textContent?.trim()]).toEqual(['true', false, 'Contact your system administrator to reset your password.'])
  await type('email', 'nobody@example.test')
  expect(note.textContent?.trim()).toBe('Contact your system administrator to reset your password.')
  expect(fetch).not.toHaveBeenCalled()
  expect(host.querySelector('#login-email')?.getAttribute('aria-invalid')).toBeNull()
})

it('the install offer never appears before the mandatory change, even when the browser offers installation', async () => {
  localStorage.setItem(INSTALL_OFFER_KEY, '1')
  const { store } = setup()
  await render(store)
  expect(host.textContent).not.toMatch(/Install Medicare|Welcome to Medicare/)
})

it('rejects an identity without a boolean credential-state flag', async () => {
  for (const flag of [undefined, 'false', 0]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { user: { ...established, mustChangePassword: flag } } }), { status: 200 })))
    await expect(authApi.me()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { user: temporary } }), { status: 200 })))
  expect(await authApi.me()).toEqual({ user: temporary })
})

it('a temporary-password session reached through restoration is still held at the change screen after refresh', async () => {
  const { store, api } = setup()
  await render(store)
  await act(async () => { await store.refreshUser() })
  expect(api.me).toHaveBeenCalledTimes(2)
  expect(host.querySelector('h1')?.textContent).toBe('Change your temporary password')
})
