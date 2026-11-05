// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resetApiSession } from '../src/api/client'
import { App } from '../src/app/App'
import { dashboardFor, patientReport } from './report-fixtures'

// Drives the real AuthGate, auth store and shared transport against a routed fetch.
const fetcher = vi.fn<typeof fetch>()
const state = { dashboard: 200, report: 200, calls: [] as string[] }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const ok = (data: unknown) => json(200, { success: true, data })
const failure = (status: number, code: string) => json(status, { success: false, error: { code, message: 'Refused', requestId: `req-${status}` } })
const user = { id: '90000000-0000-4000-8000-000000000009', staffNumber: 'STF-SESSION', firstName: 'Sam', lastName: 'Session', email: 'sam@example.test', role: 'RECORDS_OFFICER', status: 'ACTIVE' }
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', fetcher); resetApiSession()
  state.dashboard = 200; state.report = 200; state.calls = []
  fetcher.mockReset().mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://localhost')
    state.calls.push(url.pathname)
    if (url.pathname === '/api/v1/auth/me') return ok({ user })
    if (url.pathname === '/api/v1/notifications/unread-count') return ok({ count: 0 })
    if (url.pathname === '/api/v1/dashboard') return state.dashboard === 200 ? ok(dashboardFor('RECORDS_OFFICER')) : failure(state.dashboard, state.dashboard === 401 ? 'AUTHENTICATION_REQUIRED' : 'FORBIDDEN')
    if (url.pathname === '/api/v1/reports/patients') return state.report === 200 ? ok(patientReport) : failure(state.report, state.report === 401 ? 'AUTHENTICATION_REQUIRED' : 'FORBIDDEN')
    return json(404, { success: false, error: { code: 'NOT_FOUND', message: 'Not found' } })
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); resetApiSession() })
const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) }
const signedOut = () => Boolean(host.querySelector('input[name="email"]')) && !host.querySelector('.app-shell')
const openReports = async () => { await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('.desktop-sidebar nav button')).find((item) => item.textContent === 'Reports')!.click()); await settle() }

it('returns to sign-in when the dashboard reports an ended session, without stale figures', async () => {
  state.dashboard = 401
  await act(async () => root.render(<App />)); await settle()
  expect(signedOut()).toBe(true); expect(host.textContent).not.toMatch(/Active patients|128/)
})
it('keeps the session when a report is refused, and says so', async () => {
  await act(async () => root.render(<App />)); await settle()
  state.report = 403; await openReports()
  expect(signedOut()).toBe(false); expect(host.querySelector('[role="alert"]')?.textContent).toBe('You don’t have access to this report.Support reference: req-403')
  expect(state.calls.filter((path) => path === '/api/v1/auth/me')).toHaveLength(1)
})
it('returns to sign-in when a report read finds the session ended', async () => {
  await act(async () => root.render(<App />)); await settle()
  state.report = 401; await openReports()
  expect(signedOut()).toBe(true); expect(host.textContent).not.toMatch(/Patient activity|Patients registered/)
})
