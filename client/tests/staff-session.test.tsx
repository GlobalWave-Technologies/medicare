// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resetApiSession } from '../src/api/client'
import { App } from '../src/app/App'
import { officer, self, signedIn } from './staff-fixtures'

// Drives the real AuthGate, auth store and shared transport against a routed fetch.
const fetcher = vi.fn<typeof fetch>()
const state = { signedIn: true, calls: [] as string[] }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const ok = (data: unknown) => json(200, { success: true, data })
const unauthorized = () => json(401, { success: false, error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required', requestId: 'req-401' } })
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', fetcher); resetApiSession()
  state.signedIn = true; state.calls = []
  fetcher.mockReset().mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost'), method = init?.method ?? 'GET'
    state.calls.push(`${method} ${url.pathname}`)
    if (!state.signedIn && url.pathname !== '/api/v1/auth/login') return unauthorized()
    if (url.pathname === '/api/v1/auth/me') return ok({ user: signedIn })
    if (url.pathname === '/api/v1/auth/csrf') return ok({ csrfToken: 'd'.repeat(64) })
    if (url.pathname === '/api/v1/notifications/unread-count') return ok({ count: 0 })
    if (url.pathname === '/api/v1/staff' && method === 'GET') return ok({ users: [self, officer], pagination: { page: 1, limit: Number(url.searchParams.get('limit')), total: 2 } })
    const match = /^\/api\/v1\/staff\/([^/]+)(?:\/(role|status|sessions))?$/.exec(url.pathname)
    const target = [self, officer].find((member) => member.id === match?.[1])
    if (target && !match![2]) return ok({ user: target })
    if (target && match![2] === 'sessions') { if (target.id === self.id) state.signedIn = false; return ok({ revoked: true }) }
    if (target && match![2]) {
      // The server revokes the caller's own session when they change their own account.
      if (target.id === self.id) state.signedIn = false
      return ok({ user: { ...target, ...JSON.parse(String(init?.body)) } })
    }
    return json(404, { success: false, error: { code: 'NOT_FOUND', message: 'Not found' } })
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); resetApiSession() })
const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) }
const button = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((item) => (item.getAttribute('aria-label') ?? item.textContent?.trim()) === label && !item.closest('[hidden]'))!
const press = async (label: string) => { await act(async () => button(label).click()); await settle() }
const confirm = async () => { await act(async () => host.querySelector<HTMLButtonElement>('[role="dialog"] .modal-footer button:last-child')!.click()); await settle() }
const signedOut = () => Boolean(host.querySelector('input[name="email"]')) && !host.querySelector('.app-shell')
async function openOwnAccount() {
  await act(async () => root.render(<App />)); await settle()
  await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('.desktop-sidebar nav button')).find((item) => item.textContent === 'Staff & Access')!.click()); await settle()
  await press(`Manage ${self.firstName} ${self.lastName}`)
  expect(host.querySelector('#staff-detail-title')?.textContent).toBe('Ada Admin')
}

it('returns to sign-in after an administrator changes their own role, as the server ended the session', async () => {
  await openOwnAccount(); await press('Change role')
  await act(async () => host.querySelector<HTMLInputElement>('input[name="newRole"][value="RECORDS_OFFICER"]')!.click()); await confirm()
  expect(state.calls).toContain(`PATCH /api/v1/staff/${self.id}/role`)
  expect(state.calls.slice(state.calls.indexOf(`PATCH /api/v1/staff/${self.id}/role`) + 1)).toEqual(['GET /api/v1/auth/me'])
  expect(signedOut()).toBe(true); expect(host.textContent).not.toMatch(/Staff directory|Ada Admin/)
})
it('returns to sign-in after an administrator signs out all of their own sessions', async () => {
  await openOwnAccount(); await press('Sign out all sessions'); await confirm()
  expect(state.calls).toContain(`DELETE /api/v1/staff/${self.id}/sessions`)
  expect(signedOut()).toBe(true)
})
it('stays signed in after signing out another account’s sessions', async () => {
  await act(async () => root.render(<App />)); await settle()
  await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('.desktop-sidebar nav button')).find((item) => item.textContent === 'Staff & Access')!.click()); await settle()
  await press('Manage Rhea Records'); await press('Sign out all sessions'); await confirm()
  expect(signedOut()).toBe(false); expect(host.querySelector('.staff-notice')?.textContent).toBe('All sessions for Rhea Records have been signed out. The account is still Active.')
  expect(state.calls.filter((call) => call === 'GET /api/v1/auth/me')).toHaveLength(1)
})
it('invalidates the session when a staff read returns 401, without showing stale staff data', async () => {
  await act(async () => root.render(<App />)); await settle()
  state.signedIn = false
  await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('.desktop-sidebar nav button')).find((item) => item.textContent === 'Staff & Access')!.click()); await settle()
  expect(signedOut()).toBe(true); expect(host.textContent).not.toMatch(/Rhea Records|Staff directory/)
})
