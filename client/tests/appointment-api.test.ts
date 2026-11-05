import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { appointmentsApi } from '../src/api/appointments'
import { appointmentsApi as compatibleApi } from '../src/lib/api'
import { resetApiSession } from '../src/api/client'
import { createAuthStore } from '../src/features/auth/auth-store'
import { appointment, clinician, patient, user } from './appointment-fixtures'
const fetcher = vi.fn<typeof fetch>()
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
beforeEach(() => { resetApiSession(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher) })
afterEach(() => { vi.unstubAllGlobals(); resetApiSession() })
it('preserves the existing appointment API facade', () => expect(compatibleApi).toBe(appointmentsApi))
it('lists with credentials, default backend pagination and no CSRF', async () => {
  fetcher.mockResolvedValueOnce(ok({ items: [], pagination: {} }))
  await appointmentsApi.list()
  expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/appointments?page=1&limit=20')
  expect(fetcher.mock.calls[0]![1]?.credentials).toBe('include')
  expect(new Headers(fetcher.mock.calls[0]![1]?.headers).has('X-CSRF-Token')).toBe(false)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('encodes every supported filter, pagination, search and abort signal', async () => {
  fetcher.mockResolvedValueOnce(ok({ items: [], pagination: {} }))
  const signal = new AbortController().signal
  const query = { page: 3, limit: 10, status: 'CONFIRMED' as const, type: 'FOLLOW_UP' as const, patientId: patient.id, clinicianId: clinician.id, dateFrom: '2026-10-29T00:00:00+03:00', dateTo: '2026-10-30T00:00:00Z', search: ' Amina & % ' }
  await appointmentsApi.list(query, signal)
  expect(Object.fromEntries(new URL(String(fetcher.mock.calls[0]![0]), 'http://localhost').searchParams)).toEqual({ ...query, search: 'Amina & %', page: '3', limit: '10' })
  expect(fetcher.mock.calls[0]![1]?.signal).toBe(signal)
})
it.each(['get', 'clinicians'] as const)('%s uses a safe read path and cancellation without CSRF', async (action) => {
  fetcher.mockResolvedValueOnce(ok({ appointment, clinicians: [clinician] }))
  const signal = new AbortController().signal
  if (action === 'get') await appointmentsApi.get('id/space here', signal)
  else await appointmentsApi.clinicians(signal)
  expect(fetcher.mock.calls[0]![0]).toBe(`/api/v1/appointments/${action === 'get' ? 'id%2Fspace%20here' : 'clinicians'}`)
  expect(fetcher.mock.calls[0]![1]?.signal).toBe(signal)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it.each(['create', 'update', 'changeStatus', 'cancel'] as const)('%s uses CSRF, exact endpoint and field allowlists', async (action) => {
  fetcher.mockResolvedValueOnce(ok({ csrfToken: 'a'.repeat(64) })).mockResolvedValueOnce(ok({ appointment }))
  const editable = { clinicianId: clinician.id, scheduledStart: appointment.scheduledStart, scheduledEnd: appointment.scheduledEnd, type: appointment.type, reason: null, notes: 'Note' }
  const input = { ...editable, patientId: patient.id, reference: 'forged', status: 'COMPLETED', cancelledAt: 'forged', cancellationReason: 'forged', createdBy: 'forged', updatedAt: 'forged' }
  const result = action === 'create' ? await appointmentsApi.create(input) : action === 'update' ? await appointmentsApi.update(appointment.id, input) : action === 'changeStatus' ? await appointmentsApi.changeStatus(appointment.id, 'CONFIRMED') : await appointmentsApi.cancel(appointment.id, ' Reason ')
  expect(result.appointment).toEqual(appointment)
  const [url, init] = fetcher.mock.calls[1]!
  expect(url).toBe(`/api/v1/appointments${action === 'create' ? '' : `/${appointment.id}${action === 'changeStatus' ? '/status' : action === 'cancel' ? '/cancel' : ''}`}`)
  expect(init?.method).toBe(['update', 'changeStatus'].includes(action) ? 'PATCH' : 'POST')
  expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('a'.repeat(64))
  expect(init?.credentials).toBe('include')
  expect(JSON.parse(String(init?.body))).toEqual(action === 'create' ? { ...editable, patientId: patient.id } : action === 'update' ? editable : action === 'changeStatus' ? { status: 'CONFIRMED' } : { reason: 'Reason' })
})
it('maps a blank cancellation reason to null', async () => {
  fetcher.mockResolvedValueOnce(ok({ csrfToken: 'a'.repeat(64) })).mockResolvedValueOnce(ok({ appointment }))
  await appointmentsApi.cancel(appointment.id, '  ')
  expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body))).toEqual({ reason: null })
})
it('keeps backend-sourced doctor auth on forbidden mutation and invalidates on 401', async () => {
  const store = createAuthStore()
  try {
    fetcher.mockResolvedValueOnce(ok({ user: { ...user, role: 'DOCTOR_IN_CHARGE' } }))
    await store.refreshUser()
    fetcher.mockResolvedValueOnce(ok({ csrfToken: 'a'.repeat(64) })).mockResolvedValueOnce(new Response('{}', { status: 403 }))
    await expect(appointmentsApi.cancel(appointment.id)).rejects.toMatchObject({ status: 403 })
    expect(store.getSnapshot()).toMatchObject({ status: 'authenticated', user: { role: 'DOCTOR_IN_CHARGE' } })
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 401 }))
    await expect(appointmentsApi.get(appointment.id)).rejects.toMatchObject({ status: 401 })
    expect(store.getSnapshot().status).toBe('unauthenticated')
  } finally { store.dispose() }
})
it('does not replay a rejected status mutation', async () => {
  fetcher.mockResolvedValueOnce(ok({ csrfToken: 'a'.repeat(64) })).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'CSRF_INVALID' } }), { status: 403 }))
  await expect(appointmentsApi.changeStatus(appointment.id, 'CONFIRMED')).rejects.toMatchObject({ code: 'CSRF_INVALID' })
  expect(fetcher).toHaveBeenCalledTimes(2)
})
