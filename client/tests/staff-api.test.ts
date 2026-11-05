/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { staffApi } from '../src/api/staff'
import { resetApiSession } from '../src/api/client'
import { createAuthStore } from '../src/features/auth/auth-store'
import { created, doctor, officer, signedIn, self } from './staff-fixtures'

const fetcher = vi.fn<typeof fetch>()
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
const fail = (status: number, code: string) => new Response(JSON.stringify({ success: false, error: { code, message: 'Refused', requestId: 'req-staff-1' } }), { status })
const csrf = () => ok({ csrfToken: 'b'.repeat(64) })
const call = (index: number) => ({ url: String(fetcher.mock.calls[index]![0]), init: fetcher.mock.calls[index]![1] })
const csrfHeader = (index: number) => new Headers(call(index).init?.headers).get('X-CSRF-Token')
const listData = (users: unknown[] = [self, officer], total = users.length) => ({ users, pagination: { page: 1, limit: 20, total } })
beforeEach(() => { resetApiSession(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher) })
afterEach(() => { vi.unstubAllGlobals(); resetApiSession() })

it('lists staff with credentials, default pagination, derived page count and no CSRF', async () => {
  fetcher.mockResolvedValueOnce(ok(listData([self, officer], 41)))
  const signal = new AbortController().signal
  const result = await staffApi.list({}, signal)
  expect(result).toEqual({ users: [self, officer], pagination: { page: 1, limit: 20, total: 41, totalPages: 3 } })
  expect(call(0).url).toBe('/api/v1/staff?page=1&limit=20')
  expect(call(0).init?.credentials).toBe('include'); expect(call(0).init?.signal).toBe(signal); expect(call(0).init?.method).toBeUndefined()
  expect(csrfHeader(0)).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1)
})
it.each([
  [{ page: 2, limit: 50, role: 'DOCTOR_IN_CHARGE' as const, status: 'SUSPENDED' as const }, { page: '2', limit: '50', role: 'DOCTOR_IN_CHARGE', status: 'SUSPENDED' }],
  [{ role: 'ADMIN' as const }, { page: '1', limit: '20', role: 'ADMIN' }],
  [{ status: 'PENDING' as const, limit: 1 }, { page: '1', limit: '1', status: 'PENDING' }],
])('sends only the server-supported role/status/page filters %j', async (query, expected) => {
  fetcher.mockResolvedValueOnce(ok(listData()))
  await staffApi.list(Object.assign({ search: 'ignored' }, query))
  expect(Object.fromEntries(new URL(call(0).url, 'http://localhost').searchParams)).toEqual(expected)
})
it('reads one account through an encoded path without CSRF', async () => {
  fetcher.mockResolvedValueOnce(ok({ user: officer }))
  const signal = new AbortController().signal
  expect(await staffApi.get('id/with space', signal)).toEqual({ user: officer })
  expect(call(0).url).toBe('/api/v1/staff/id%2Fwith%20space'); expect(call(0).init?.signal).toBe(signal)
  expect(csrfHeader(0)).toBeNull()
})
it('keeps only the safe staff fields even if a response carries secrets', async () => {
  const leaked = { ...officer, passwordHash: '$argon2id$secret', sessions: [{ id: 'session-1', tokenHash: 'hash' }], csrfToken: 'c'.repeat(64), createdAt: '2026-01-01T00:00:00Z' }
  fetcher.mockResolvedValueOnce(ok({ user: leaked })).mockResolvedValueOnce(ok(listData([leaked])))
  const { user } = await staffApi.get(officer.id)
  const page = await staffApi.list()
  for (const value of [user, page.users[0]]) {
    expect(Object.keys(value!).sort()).toEqual(['email', 'firstName', 'id', 'lastName', 'role', 'staffNumber', 'status'])
    expect(JSON.stringify(value)).not.toMatch(/argon2|session-1|tokenHash|cccc/)
  }
})
it.each([
  ['an unknown role', { user: { ...officer, role: 'SUPERUSER' } }],
  ['an unknown status', { user: { ...officer, status: 'LOCKED' } }],
  ['a missing email', { user: { ...officer, email: undefined } }],
  ['no user', {}],
])('rejects a detail response with %s instead of displaying it', async (_label, data) => {
  fetcher.mockResolvedValueOnce(ok(data))
  await expect(staffApi.get(officer.id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})
it.each([
  { users: 'none', pagination: { page: 1, limit: 20, total: 0 } },
  { users: [], pagination: { page: 1, limit: 0, total: 0 } },
  { users: [], pagination: { page: 1, limit: 20, total: -3 } },
  { users: [] },
])('rejects a malformed staff page %j', async (data) => {
  fetcher.mockResolvedValueOnce(ok(data))
  await expect(staffApi.list()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})
it('creates an account with CSRF and only the six accepted fields, sending the password exactly as typed', async () => {
  fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(ok({ user: created }))
  const input = {
    firstName: '  Nia ', lastName: ' Newhire ', email: ' nia.newhire@example.test ', staffNumber: ' stf-new00007 ', role: 'DOCTOR_IN_CHARGE' as const,
    password: '  spaced password kept  ', confirmPassword: 'x', status: 'ACTIVE', id: 'forged', passwordHash: 'forged', staffUserId: 'forged',
  }
  expect(await staffApi.create(input)).toEqual({ user: created })
  expect(call(0).url).toBe('/api/v1/auth/csrf'); expect(call(1).url).toBe('/api/v1/staff')
  expect(call(1).init?.method).toBe('POST'); expect(csrfHeader(1)).toBe('b'.repeat(64))
  expect(new Headers(call(1).init?.headers).has('Idempotency-Key')).toBe(false)
  expect(JSON.parse(String(call(1).init?.body))).toEqual({
    firstName: 'Nia', lastName: 'Newhire', email: 'nia.newhire@example.test', staffNumber: 'STF-NEW00007', role: 'DOCTOR_IN_CHARGE', password: '  spaced password kept  ',
  })
  expect(call(1).url).not.toContain('password')
})
it.each([
  ['changeRole', () => staffApi.changeRole(officer.id, 'DOCTOR_IN_CHARGE'), 'PATCH', 'role', { role: 'DOCTOR_IN_CHARGE' }],
  ['changeStatus', () => staffApi.changeStatus(officer.id, 'SUSPENDED'), 'PATCH', 'status', { status: 'SUSPENDED' }],
] as const)('%s patches only its own field with CSRF', async (_name, run, method, suffix, body) => {
  fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(ok({ user: { ...officer, ...body } }))
  expect(await run()).toEqual({ user: { ...officer, ...body } })
  expect(call(1).url).toBe(`/api/v1/staff/${officer.id}/${suffix}`); expect(call(1).init?.method).toBe(method)
  expect(csrfHeader(1)).toBe('b'.repeat(64)); expect(JSON.parse(String(call(1).init?.body))).toEqual(body)
})
it('revokes sessions with DELETE, CSRF and no body, and exposes no session data', async () => {
  fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(ok({ revoked: true, sessions: ['session-1'] }))
  expect(await staffApi.revokeSessions(doctor.id)).toEqual({ revoked: true })
  expect(call(1).url).toBe(`/api/v1/staff/${doctor.id}/sessions`); expect(call(1).init?.method).toBe('DELETE')
  expect(call(1).init?.body).toBeUndefined(); expect(csrfHeader(1)).toBe('b'.repeat(64))
  fetcher.mockResolvedValueOnce(ok({ revoked: false }))
  await expect(staffApi.revokeSessions(doctor.id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})
it('reuses one CSRF token across staff mutations and never replays a failed one', async () => {
  fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(ok({ user: officer })).mockResolvedValueOnce(fail(409, 'LAST_ADMIN_PROTECTION'))
  await staffApi.changeStatus(officer.id, 'ACTIVE')
  await expect(staffApi.changeRole(self.id, 'RECORDS_OFFICER')).rejects.toMatchObject({ status: 409, code: 'LAST_ADMIN_PROTECTION', requestId: 'req-staff-1' })
  fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await expect(staffApi.revokeSessions(officer.id)).rejects.toBeInstanceOf(TypeError)
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/v1/auth/csrf', `/api/v1/staff/${officer.id}/status`, `/api/v1/staff/${self.id}/role`, `/api/v1/staff/${officer.id}/sessions`])
})
it('refreshes CSRF only on a deliberate retry after CSRF_INVALID', async () => {
  fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(fail(403, 'CSRF_INVALID'))
  await expect(staffApi.changeStatus(officer.id, 'SUSPENDED')).rejects.toMatchObject({ code: 'CSRF_INVALID' })
  expect(fetcher).toHaveBeenCalledTimes(2)
  fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(ok({ user: { ...officer, status: 'SUSPENDED' } }))
  await staffApi.changeStatus(officer.id, 'SUSPENDED')
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/v1/auth/csrf', `/api/v1/staff/${officer.id}/status`, '/api/v1/auth/csrf', `/api/v1/staff/${officer.id}/status`])
})
it('keeps the session on a forbidden staff request and invalidates it on 401', async () => {
  const store = createAuthStore()
  try {
    fetcher.mockResolvedValueOnce(ok({ user: signedIn }))
    await store.refreshUser()
    fetcher.mockResolvedValueOnce(fail(403, 'FORBIDDEN'))
    await expect(staffApi.list()).rejects.toMatchObject({ status: 403 })
    fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(fail(403, 'FORBIDDEN'))
    await expect(staffApi.changeRole(officer.id, 'ADMIN')).rejects.toMatchObject({ status: 403 })
    expect(store.getSnapshot()).toMatchObject({ status: 'authenticated', user: { id: signedIn.id } })
    fetcher.mockResolvedValueOnce(fail(401, 'AUTHENTICATION_REQUIRED'))
    await expect(staffApi.get(officer.id)).rejects.toMatchObject({ status: 401 })
    expect(store.getSnapshot().status).toBe('unauthenticated')
  } finally { store.dispose() }
})
it('keeps staff code free of storage, logging, markup injection, mocks, raw fetch and loose types', () => {
  const folder = resolve('src/features/staff')
  const source = [resolve('src/api/staff.ts'), ...readdirSync(folder).filter((name) => /\.tsx?$/.test(name)).map((name) => resolve(folder, name))]
    .map((file) => readFileSync(file, 'utf8')).join('\n')
  expect(source).not.toMatch(/dangerouslySetInnerHTML|innerHTML|localStorage|sessionStorage|indexedDB|mocks\/|fetch\(|console\.|\bany\b|passwordHash|tokenHash|deleteStaff|method: 'DELETE', body/)
  expect(source).not.toMatch(/patientsApi|encountersApi|appointmentsApi|notificationsApi/)
})
