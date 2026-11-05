// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffUser } from '../src/api/auth'
import { authApi } from '../src/api/auth'
import { ApiError, resetApiSession } from '../src/api/client'
import { dashboardApi } from '../src/api/dashboard'
import { notificationsApi } from '../src/api/notifications'
import { staffApi } from '../src/api/staff'
import { App } from '../src/app/App'
import { authStore } from '../src/features/auth/auth-store'
import { dashboardFor } from './report-fixtures'
import { disabled, officer, pending, self, staffPage } from './staff-fixtures'
import * as staff from './staff-harness'

const identity = vi.hoisted(() => ({ role: 'RECORDS_OFFICER' as StaffUser['role'] }))
vi.mock('../src/features/auth/AuthGate', () => ({ AuthGate: ({ children }: { children: (user: StaffUser) => ReactNode }) => children({
  id: '70000000-0000-4000-8000-000000000017', staffNumber: 'STF-CRED01', firstName: 'Cora', lastName: 'Credentials', email: 'cora@example.test', status: 'ACTIVE', role: identity.role }) }))

const NEW_PASSWORD = 'Synthetic replacement passphrase'
const secrets = () => [localStorage.length, sessionStorage.length, document.cookie]

describe('administrator password actions', () => {
  beforeEach(staff.setup)
  afterEach(staff.teardown)
  const all = [self, officer, pending, disabled]
  async function open(member: typeof officer) {
    vi.mocked(staffApi.list).mockImplementation(async (query = {}) => query.limit === 1 ? staffPage([], 1, 0, 1) : staffPage(all))
    await staff.render(); await staff.manage(member)
  }
  const section = () => Array.from(staff.harness.host.querySelectorAll<HTMLElement>('.staff-section')).find((item) => item.querySelector('h3')?.textContent === 'Password')!
  const warning = () => document.getElementById(staff.dialog()!.getAttribute('aria-describedby')!)?.textContent ?? ''

  it('offers Reset for active accounts, Set for pending ones, and nothing for disabled or your own account', async () => {
    await open(officer); expect(Array.from(section().querySelectorAll('button')).map((item) => item.textContent)).toEqual(['Reset password'])
    await staff.click('Back to staff directory'); await staff.manage(pending)
    expect(Array.from(section().querySelectorAll('button')).map((item) => item.textContent)).toEqual(['Set password'])
    await staff.click('Back to staff directory'); await staff.manage(disabled)
    expect([section().textContent, section().querySelectorAll('button').length]).toEqual(['PasswordA disabled account can’t be given a new password.', 0])
    await staff.click('Back to staff directory'); await staff.manage(self)
    expect(section().textContent).toBe('PasswordTo change your own password, use Change password in the menu. It asks for your current password.')
    expect(section().querySelectorAll('button')).toHaveLength(0)
  })

  it('checks the new password locally, then sends only that password once and never shows it again', async () => {
    const logs = (['log', 'info', 'warn', 'error'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}))
    await open(officer); await staff.click('Reset password')
    expect(staff.dialog()!.querySelector('h2')?.textContent).toBe('Reset password')
    expect(warning()).toContain('immediately signs them out on all devices'); expect(warning()).toContain('approved secure channel')
    await staff.submit(); expect(staff.dialog()!.textContent).toContain('Enter the new password.')
    await staff.fill('newPassword', 'too short'); await staff.submit(); expect(staff.dialog()!.textContent).toContain('Use 15 to 128 characters.')
    await staff.fill('newPassword', NEW_PASSWORD); await staff.fill('confirmNewPassword', `${NEW_PASSWORD}!`); await staff.submit()
    expect(staff.dialog()!.textContent).toContain('The passwords don’t match.')
    expect(staff.field('confirmNewPassword').getAttribute('aria-invalid')).toBe('true')
    expect(staffApi.resetPassword).not.toHaveBeenCalled()
    await staff.fill('confirmNewPassword', NEW_PASSWORD); await staff.submit()
    expect(staffApi.resetPassword).toHaveBeenCalledExactlyOnceWith(officer.id, NEW_PASSWORD)
    expect(staff.dialog()).toBeNull()
    expect(staff.harness.host.querySelector('.staff-notice')?.textContent).toBe('Password reset for Rhea Records. They’ve been signed out on all devices and must use the new password.')
    expect(staff.text()).not.toContain(NEW_PASSWORD)
    expect(secrets()).toEqual([0, 0, ''])
    expect(logs.flatMap((spy) => spy.mock.calls).flat().map(String).join(' ')).not.toContain(NEW_PASSWORD)
  })

  it('sets a pending account’s first password without activating it', async () => {
    vi.mocked(staffApi.resetPassword).mockResolvedValue({ user: pending })
    await open(pending); await staff.click('Set password')
    expect(warning()).toContain('The account stays Pending until you activate it.')
    await staff.fill('newPassword', NEW_PASSWORD); await staff.fill('confirmNewPassword', NEW_PASSWORD); await staff.submit()
    expect(staff.harness.host.querySelector('.staff-notice')?.textContent).toMatch(/^Password set for .+\. Activate the account when they’re ready to sign in\.$/)
  })

  it('explains refusals and unconfirmed results, keeping the dialog open', async () => {
    await open(officer); await staff.click('Reset password')
    await staff.fill('newPassword', NEW_PASSWORD); await staff.fill('confirmNewPassword', NEW_PASSWORD)
    vi.mocked(staffApi.resetPassword).mockRejectedValueOnce(new ApiError(409, 'Disabled', 'ACCOUNT_DISABLED', 'req-dis'))
    await staff.submit()
    expect(staff.dialog()!.querySelector('[role="alert"]')?.textContent).toBe('A disabled account can’t be given a new password.Support reference: req-dis')
    vi.mocked(staffApi.resetPassword).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await staff.submit()
    expect(staff.dialog()!.querySelector('[role="alert"]')?.textContent).toBe('The password change could not be confirmed. Refresh this account and set the password again if needed; setting it again is safe.')
  })
})

describe('changing your own password', () => {
  let host: HTMLDivElement, root: Root
  beforeEach(() => {
    vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    vi.spyOn(dashboardApi, 'get').mockImplementation(async () => dashboardFor(identity.role))
    vi.spyOn(notificationsApi, 'unreadCount').mockResolvedValue({ count: 0 })
    vi.spyOn(authApi, 'changePassword').mockResolvedValue({ passwordChanged: true })
    vi.spyOn(authStore, 'passwordChanged').mockImplementation(() => {})
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
  const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }
  const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]')
  const press = async (element: Element | null | undefined) => { await act(async () => (element as HTMLElement).click()); await tick() }
  const named = (text: string, scope: ParentNode = host) => Array.from(scope.querySelectorAll('button')).find((item) => item.textContent?.trim() === text)
  async function fill(name: string, value: string) {
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>(`[name="${name}"]`)!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const submit = async () => { await act(async () => { dialog()!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick() }
  const render = async () => { await act(async () => root.render(<App />)); await tick() }

  it('opens from the navigation footer, checks locally and sends only the current and new passwords', async () => {
    await render()
    const footer = host.querySelector('.desktop-sidebar .sidebar-bottom')!
    expect(footer.lastElementChild?.textContent).toBe('Change password')
    await press(named('Change password', footer))
    expect(dialog()!.querySelector('h2')?.textContent).toBe('Change password')
    expect(Array.from(dialog()!.querySelectorAll('input')).map((input) => [input.name, input.type, input.autocomplete])).toEqual([
      ['currentPassword', 'password', 'current-password'], ['newPassword', 'password', 'new-password'], ['confirmNewPassword', 'password', 'new-password']])
    await submit(); expect(dialog()!.textContent).toContain('Enter your current password.')
    await fill('currentPassword', 'Synthetic current passphrase'); await fill('newPassword', 'Synthetic current passphrase'); await submit()
    expect(dialog()!.textContent).toContain('Choose a password different from your current one.')
    await fill('newPassword', NEW_PASSWORD); await fill('confirmNewPassword', 'Something else entirely'); await submit()
    expect(dialog()!.textContent).toContain('The new passwords don’t match.')
    expect(authApi.changePassword).not.toHaveBeenCalled()
    await fill('confirmNewPassword', NEW_PASSWORD); await submit()
    expect(authApi.changePassword).toHaveBeenCalledExactlyOnceWith('Synthetic current passphrase', NEW_PASSWORD)
    expect(authStore.passwordChanged).toHaveBeenCalledOnce()
    expect(secrets()).toEqual([0, 0, ''])
  })

  it('shows a wrong current password on its field and keeps the dialog open', async () => {
    vi.mocked(authApi.changePassword).mockRejectedValueOnce(new ApiError(400, 'Incorrect', 'CURRENT_PASSWORD_INVALID'))
    await render(); await press(named('Change password', host.querySelector('.desktop-sidebar')!))
    await fill('currentPassword', 'Mistyped current passphrase'); await fill('newPassword', NEW_PASSWORD); await fill('confirmNewPassword', NEW_PASSWORD); await submit(); await tick()
    expect(dialog()!.textContent).toContain('Your current password isn’t correct.')
    expect(host.querySelector('[name="currentPassword"]')!.getAttribute('aria-invalid')).toBe('true')
    expect(authStore.passwordChanged).not.toHaveBeenCalled()
    vi.mocked(authApi.changePassword).mockRejectedValueOnce(new ApiError(429, 'Limited', 'PASSWORD_CHANGE_RATE_LIMITED', 'req-429', 600)); await submit()
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('Too many incorrect attempts. Try again in 10 minutes.Support reference: req-429')
    vi.mocked(authApi.changePassword).mockRejectedValueOnce(new TypeError('Failed to fetch')); await submit()
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('The password change could not be confirmed. If you are asked to sign in, use your new password; otherwise try again.')
  })

  it('closes the mobile menu before opening Change password, so only one dialog is open', async () => {
    await render(); await press(host.querySelector('button[aria-label="Open navigation"]'))
    const drawer = dialog()!
    expect(drawer.querySelector('.mobile-sidebar')).not.toBeNull()
    await press(named('Change password', drawer))
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(dialog()!.querySelector('h2')?.textContent).toBe('Change password')
  })
})

describe('credential request contracts', () => {
  const fetcher = vi.fn<typeof fetch>()
  const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 })
  beforeEach(() => { resetApiSession(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher) })
  afterEach(() => vi.unstubAllGlobals())
  const csrf = 'c'.repeat(64)
  const member = { id: officer.id, staffNumber: officer.staffNumber, firstName: officer.firstName, lastName: officer.lastName, email: officer.email, role: officer.role, status: officer.status }

  it('changes a password with the current and new values only, then fetches a fresh CSRF token', async () => {
    fetcher.mockResolvedValueOnce(ok({ csrfToken: csrf })).mockResolvedValueOnce(ok({ passwordChanged: true }))
      .mockResolvedValueOnce(ok({ csrfToken: 'd'.repeat(64) })).mockResolvedValueOnce(ok({ user: member }))
    expect(await authApi.changePassword(' current with spaces ', NEW_PASSWORD)).toEqual({ passwordChanged: true })
    const [url, init] = fetcher.mock.calls[1]!
    expect([url, init!.method, new Headers(init!.headers).get('X-CSRF-Token')]).toEqual(['/api/v1/auth/change-password', 'POST', csrf])
    expect(JSON.parse(init!.body as string)).toEqual({ currentPassword: ' current with spaces ', newPassword: NEW_PASSWORD })
    await staffApi.resetPassword(officer.id, NEW_PASSWORD)
    expect(fetcher.mock.calls[2]![0]).toBe('/api/v1/auth/csrf')
  })

  it('sends staff creation with an Idempotency-Key and a reset with only the new password', async () => {
    fetcher.mockResolvedValueOnce(ok({ csrfToken: csrf })).mockResolvedValueOnce(ok({ user: member })).mockResolvedValueOnce(ok({ user: member }))
    await staffApi.create({ firstName: ' Rhea ', lastName: 'Records', email: 'rhea@example.test', staffNumber: 'stf-rec00002', role: 'RECORDS_OFFICER', password: NEW_PASSWORD }, 'staff-key-0123456789')
    const create = fetcher.mock.calls[1]!
    expect([create[0], new Headers(create[1]!.headers).get('Idempotency-Key')]).toEqual(['/api/v1/staff', 'staff-key-0123456789'])
    expect(Object.keys(JSON.parse(create[1]!.body as string)).sort()).toEqual(['email', 'firstName', 'lastName', 'password', 'role', 'staffNumber'])
    await staffApi.resetPassword(officer.id, ` ${NEW_PASSWORD} `)
    const reset = fetcher.mock.calls[2]!
    expect([reset[0], reset[1]!.method, JSON.parse(reset[1]!.body as string)]).toEqual([`/api/v1/staff/${officer.id}/reset-password`, 'POST', { password: ` ${NEW_PASSWORD} ` }])
    expect(new Headers(reset[1]!.headers).get('Idempotency-Key')).toBeNull()
  })
})
