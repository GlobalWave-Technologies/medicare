/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { notificationsApi } from '../src/api/notifications'
import { resetApiSession } from '../src/api/client'
import { createAuthStore } from '../src/features/auth/auth-store'
import { appointmentNotice, broadcastNotice, readAt, staff } from './notification-fixtures'

const fetcher = vi.fn<typeof fetch>()
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
const csrf = () => ok({ csrfToken: 'a'.repeat(64) })
const call = (index: number) => ({ url: String(fetcher.mock.calls[index]![0]), init: fetcher.mock.calls[index]![1] })
beforeEach(() => { resetApiSession(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher) })
afterEach(() => { vi.unstubAllGlobals(); resetApiSession() })

it('lists the own inbox with credentials, default pagination and no CSRF', async () => {
  fetcher.mockResolvedValueOnce(ok({ items: [appointmentNotice], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }))
  const result = await notificationsApi.list()
  expect(result.items).toEqual([appointmentNotice])
  expect(call(0).url).toBe('/api/v1/notifications?page=1&limit=20')
  expect(call(0).init?.credentials).toBe('include')
  expect(new Headers(call(0).init?.headers).has('X-CSRF-Token')).toBe(false)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it.each([
  [{ page: 3, limit: 10, read: false, type: 'BROADCAST' as const }, { page: '3', limit: '10', read: 'false', type: 'BROADCAST' }],
  [{ read: true }, { page: '1', limit: '20', read: 'true' }],
  [{ type: 'DIRECT' as const }, { page: '1', limit: '20', type: 'DIRECT' }],
])('encodes only the supported filters %j', async (query, expected) => {
  fetcher.mockResolvedValueOnce(ok({ items: [], pagination: {} }))
  const signal = new AbortController().signal
  await notificationsApi.list(query, signal)
  expect(Object.fromEntries(new URL(call(0).url, 'http://localhost').searchParams)).toEqual(expected)
  expect(call(0).init?.signal).toBe(signal)
})
it('reads one notification through an encoded path without CSRF', async () => {
  fetcher.mockResolvedValueOnce(ok({ notification: broadcastNotice }))
  const signal = new AbortController().signal
  expect((await notificationsApi.get('id/with space', signal)).notification).toEqual(broadcastNotice)
  expect(call(0).url).toBe('/api/v1/notifications/id%2Fwith%20space')
  expect(call(0).init?.signal).toBe(signal); expect(call(0).init?.method).toBeUndefined()
  expect(new Headers(call(0).init?.headers).has('X-CSRF-Token')).toBe(false)
})
it('reads the unread count without a query, CSRF or recipient', async () => {
  fetcher.mockResolvedValueOnce(ok({ count: 7 }))
  const signal = new AbortController().signal
  expect(await notificationsApi.unreadCount(signal)).toEqual({ count: 7 })
  expect(call(0).url).toBe('/api/v1/notifications/unread-count')
  expect(call(0).init?.signal).toBe(signal)
  expect(new Headers(call(0).init?.headers).has('X-CSRF-Token')).toBe(false)
})
it.each([{ count: -1 }, { count: 1.5 }, { count: '3' }, {}])('rejects an invalid unread count %j instead of displaying it', async (data) => {
  fetcher.mockResolvedValueOnce(ok(data))
  await expect(notificationsApi.unreadCount()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})
it.each(['markRead', 'markAllRead'] as const)('%s posts no body or recipient with the shared CSRF token', async (action) => {
  fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(ok(action === 'markRead' ? { notification: { ...appointmentNotice, readAt } } : { updated: 4 }))
  const result = action === 'markRead' ? await notificationsApi.markRead(appointmentNotice.id) : await notificationsApi.markAllRead()
  expect(result).toEqual(action === 'markRead' ? { notification: { ...appointmentNotice, readAt } } : { updated: 4 })
  expect(call(0).url).toBe('/api/v1/auth/csrf')
  expect(call(1).url).toBe(action === 'markRead' ? `/api/v1/notifications/${appointmentNotice.id}/read` : '/api/v1/notifications/read-all')
  expect(call(1).init?.method).toBe('POST'); expect(call(1).init?.body).toBeUndefined(); expect(call(1).init?.credentials).toBe('include')
  expect(new Headers(call(1).init?.headers).get('X-CSRF-Token')).toBe('a'.repeat(64))
})
it('reuses one CSRF token across notification mutations', async () => {
  fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(ok({ notification: appointmentNotice })).mockResolvedValueOnce(ok({ updated: 0 }))
  await notificationsApi.markRead(appointmentNotice.id); await notificationsApi.markAllRead()
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/v1/auth/csrf', `/api/v1/notifications/${appointmentNotice.id}/read`, '/api/v1/notifications/read-all'])
})
it.each([
  [{ type: 'ALL' as const }, { type: 'ALL' }],
  [{ type: 'ROLE' as const, role: 'DOCTOR_IN_CHARGE' as const }, { type: 'ROLE', role: 'DOCTOR_IN_CHARGE' }],
])('broadcasts trimmed plain text with an allowlisted audience %j', async (audience, expected) => {
  const created = { notification: { ...broadcastNotice, readAt: undefined }, recipientCount: 14 }
  fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(ok(created))
  const forged = { ...audience, recipientId: 'forged', staffIds: ['forged'] }
  const input = { title: '  Staff briefing ', message: ' Line one\nLine two  ', audience: forged, recipientId: 'forged', type: 'DIRECT' }
  expect(await notificationsApi.broadcast(input)).toEqual(created)
  expect(call(1).url).toBe('/api/v1/notifications/broadcast'); expect(call(1).init?.method).toBe('POST')
  expect(new Headers(call(1).init?.headers).get('X-CSRF-Token')).toBe('a'.repeat(64))
  expect(JSON.parse(String(call(1).init?.body))).toEqual({ title: 'Staff briefing', message: 'Line one\nLine two', audience: expected })
})
it('does not replay a rejected notification mutation', async () => {
  fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'CSRF_INVALID' } }), { status: 403 }))
  await expect(notificationsApi.markAllRead()).rejects.toMatchObject({ code: 'CSRF_INVALID' })
  fetcher.mockResolvedValueOnce(csrf()).mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await expect(notificationsApi.broadcast({ title: 'T', message: 'M', audience: { type: 'ALL' } })).rejects.toBeInstanceOf(TypeError)
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/v1/auth/csrf', '/api/v1/notifications/read-all', '/api/v1/auth/csrf', '/api/v1/notifications/broadcast'])
})
it('keeps the session on a forbidden broadcast and invalidates it on 401', async () => {
  const store = createAuthStore()
  try {
    fetcher.mockResolvedValueOnce(ok({ user: staff('RECORDS_OFFICER') }))
    await store.refreshUser()
    fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: 403 }))
    await expect(notificationsApi.broadcast({ title: 'T', message: 'M', audience: { type: 'ALL' } })).rejects.toMatchObject({ status: 403 })
    expect(store.getSnapshot()).toMatchObject({ status: 'authenticated', user: { role: 'RECORDS_OFFICER' } })
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 401 }))
    await expect(notificationsApi.unreadCount()).rejects.toMatchObject({ status: 401 })
    expect(store.getSnapshot().status).toBe('unauthenticated')
  } finally { store.dispose() }
})
it('keeps notification code free of recipient selection, markup injection, storage, mocks and raw fetch', () => {
  const folder = resolve('src/features/notifications')
  const source = [resolve('src/api/notifications.ts'), ...readdirSync(folder).filter((name) => /\.tsx?$/.test(name)).map((name) => resolve(folder, name))]
    .map((file) => readFileSync(file, 'utf8')).join('\n')
  expect(source).not.toMatch(/dangerouslySetInnerHTML|innerHTML|localStorage|sessionStorage|indexedDB|mocks\/|fetch\(|console\.|recipientId|staffUserId|\bany\b/)
  expect(source).not.toMatch(/patientsApi|encountersApi|appointmentsApi/)
})
