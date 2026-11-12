import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resetApiSession } from '../src/api/client'
import { staffActivityApi } from '../src/api/staffActivity'
import { staffApi } from '../src/api/staff'

const fetcher = vi.fn<typeof fetch>()
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
const call = (index = 0) => ({ url: String(fetcher.mock.calls[index]![0]), init: fetcher.mock.calls[index]![1] })
beforeEach(() => { resetApiSession(); vi.stubGlobal('fetch', fetcher) })
afterEach(() => { fetcher.mockReset(); vi.unstubAllGlobals() })
const now = '2026-11-12T10:00:00.000Z'
const staff = { id: 's1', staffNumber: 'STF-MO0001', firstName: 'Synthetic', lastName: 'Mensah', role: 'DOCTOR_IN_CHARGE' }
const item = { id: 'e1', occurredAt: now, event: 'MEDICAL_RECORD_FINALIZED', category: 'clinical', text: 'Finalized a clinical record', actor: staff, subject: null }
const active = { generatedAt: now, thresholds: { activeNowMinutes: 5, recentMinutes: 30 }, summary: { activeNow: 1, signedIn: 1, signedInToday: 2 },
  staff: [{ staff, signedInAt: now, lastActivityAt: now, status: 'ACTIVE_NOW', sessions: 1 }] }
const events = { generatedAt: now, items: [item], pagination: { page: 1, limit: 25, total: 1 } }

it('keeps only documented fields, so nothing secret or clinical can reach the screen', async () => {
  fetcher.mockResolvedValueOnce(ok({ ...active, tokenHash: 'leak', staff: [{ ...active.staff[0], csrfToken: 'leak', staff: { ...staff, email: 'leak@example.test', passwordHash: 'leak' } }] }))
  fetcher.mockResolvedValueOnce(ok({ ...events, items: [{ ...item, metadata: { notes: 'leak' }, diagnosis: 'leak', ipAddress: '10.0.0.1', actor: { ...staff, email: 'leak' } }] }))
  const result = JSON.stringify([await staffActivityApi.active(), await staffActivityApi.events({})])
  expect(result).not.toMatch(/leak|ipAddress|metadata|diagnosis|email|tokenHash|csrf|password/)
})
it.each([
  ['an unknown status', { ...active, staff: [{ ...active.staff[0], status: 'ONLINE' }] }],
  ['an unknown role', { ...active, staff: [{ ...active.staff[0], staff: { ...staff, role: 'OWNER' } }] }],
  ['a negative count', { ...active, summary: { ...active.summary, activeNow: -1 } }],
  ['a bad time', { ...active, staff: [{ ...active.staff[0], lastActivityAt: 'soon' }] }],
])('refuses active staff with %s', async (_name, body) => {
  fetcher.mockResolvedValueOnce(ok(body))
  await expect(staffActivityApi.active()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})
it.each([
  ['an unknown category', { ...events, items: [{ ...item, category: 'views' }] }],
  ['a page larger than 50', { ...events, pagination: { page: 1, limit: 500, total: 1 } }],
  ['a missing actor', { ...events, items: [{ ...item, actor: null }] }],
])('refuses activity with %s', async (_name, body) => {
  fetcher.mockResolvedValueOnce(ok(body))
  await expect(staffActivityApi.events({})).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})
it('sends only the documented filters, and marks automatic refreshes', async () => {
  fetcher.mockImplementation(async () => ok(events))
  await staffActivityApi.events({ page: 2, period: 'last7', category: 'clinical', search: '  ama  ', role: 'DOCTOR_IN_CHARGE' }, undefined, true)
  const first = new URL(call(0).url, 'https://x.test')
  expect(first.pathname).toBe('/api/v1/staff-activity/events')
  expect(Object.fromEntries(first.searchParams)).toEqual({ page: '2', limit: '25', period: 'last7', category: 'clinical', search: 'ama', role: 'DOCTOR_IN_CHARGE' })
  expect(new Headers(call(0).init?.headers).get('X-Background-Refresh')).toBe('1')
  await staffActivityApi.events({})
  expect(new Headers(call(1).init?.headers).get('X-Background-Refresh')).toBeNull()
})
it('ends one session with a POST that carries CSRF and an empty body', async () => {
  fetcher.mockResolvedValueOnce(ok({ csrfToken: 'a'.repeat(64) })).mockResolvedValueOnce(ok({ revoked: true }))
  await staffActivityApi.revokeSession('s 1', 'sess/2')
  const request = call(1)
  expect(request.url).toBe('/api/v1/staff/s%201/sessions/sess%2F2/revoke'); expect(request.init?.method).toBe('POST'); expect(request.init?.body).toBe('{}')
  expect(new Headers(request.init?.headers).get('X-CSRF-Token')).toBe('a'.repeat(64))
})
it('reads last sign-in and last activity from the staff directory, and allows them to be missing', async () => {
  const member = { id: 's1', staffNumber: 'STF-MO0001', firstName: 'Synthetic', lastName: 'Mensah', email: 'mo@example.test', role: 'DOCTOR_IN_CHARGE', status: 'ACTIVE' }
  fetcher.mockResolvedValueOnce(ok({ users: [{ ...member, lastLoginAt: now, lastActivityAt: null }, member], pagination: { page: 1, limit: 20, total: 2 } }))
  const page = await staffApi.list()
  expect([page.users[0]!.lastLoginAt, page.users[0]!.lastActivityAt, 'lastLoginAt' in page.users[1]!]).toEqual([now, null, false])
  fetcher.mockResolvedValueOnce(ok({ users: [{ ...member, lastLoginAt: 'yesterday' }], pagination: { page: 1, limit: 20, total: 1 } }))
  await expect(staffApi.list()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})
