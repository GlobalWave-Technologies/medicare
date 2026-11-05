import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { patientsApi } from '../src/api/patients'
import { patientsApi as compatibleApi } from '../src/lib/api'
import { resetApiSession } from '../src/api/client'
import { createAuthStore } from '../src/features/auth/auth-store'
const fetcher = vi.fn<typeof fetch>()
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
beforeEach(() => { resetApiSession(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher) })
afterEach(() => { vi.unstubAllGlobals(); resetApiSession() })
it('preserves the existing appointment-facing patient API export', () => expect(compatibleApi).toBe(patientsApi))
it('lists active patients with server pagination by default, credentials and no CSRF', async () => {
  fetcher.mockResolvedValueOnce(ok({ items: [], pagination: {} }))
  await patientsApi.list()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/patients?page=1&limit=10&archived=false')
  expect(fetcher.mock.calls[0]![1]?.credentials).toBe('include')
  expect(new Headers(fetcher.mock.calls[0]![1]?.headers).has('X-CSRF-Token')).toBe(false)
})
it.each(['true', 'all'] as const)('encodes page/search/archive %s and passes cancellation', async (archived) => {
  fetcher.mockResolvedValueOnce(ok({ items: [], pagination: {} }))
  const controller = new AbortController()
  await patientsApi.list({ page: 3, limit: 20, search: ' +233 & Amina ', archived }, controller.signal)
  const url = new URL(String(fetcher.mock.calls[0]![0]), 'http://localhost')
  expect(Object.fromEntries(url.searchParams)).toEqual({ page: '3', limit: '20', search: '+233 & Amina', archived })
  expect(fetcher.mock.calls[0]![1]?.signal).toBe(controller.signal)
})
it('gets detail using the encoded internal ID with cancellation and no CSRF', async () => {
  fetcher.mockResolvedValueOnce(ok({ patient: {} }))
  const controller = new AbortController()
  await patientsApi.get('id/with space', controller.signal)
  expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/patients/id%2Fwith%20space')
  expect(fetcher.mock.calls[0]![1]?.signal).toBe(controller.signal)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it.each(['create', 'update', 'archive', 'reactivate'] as const)('%s uses shared CSRF and excludes immutable/unsupported fields', async (action) => {
  const token = 'a'.repeat(64)
  fetcher.mockResolvedValueOnce(ok({ csrfToken: token })).mockResolvedValueOnce(ok({ patient: { id: 'server-id' } }))
  const input = { firstName: 'Test', lastName: 'Patient', dateOfBirth: '2000-01-01', id: 'fake', patientNumber: 'fake', createdBy: 'fake', email: 'unsupported', archivedAt: 'fake' }
  const result = action === 'create' ? await patientsApi.create(input) : action === 'update' ? await patientsApi.update('real-id', input) : await patientsApi[action]('real-id')
  expect(result.patient.id).toBe('server-id')
  const [url, init] = fetcher.mock.calls[1]!
  expect(url).toBe(action === 'create' ? '/api/v1/patients' : `/api/v1/patients/real-id${action === 'update' ? '' : `/${action}`}`)
  expect(init?.method).toBe(action === 'update' ? 'PATCH' : 'POST')
  expect(init?.credentials).toBe('include')
  expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe(token)
  expect(JSON.parse(String(init?.body))).toEqual(['archive', 'reactivate'].includes(action) ? {} : { firstName: 'Test', lastName: 'Patient', dateOfBirth: '2000-01-01' })
})
it('preserves auth on patient 403 and invalidates it on patient 401', async () => {
  const store = createAuthStore()
  try {
    fetcher.mockResolvedValueOnce(ok({ user: { id: 'staff', staffNumber: 'STF-QA', firstName: 'QA', lastName: 'Staff', email: 'qa@example.test', role: 'DOCTOR_IN_CHARGE', status: 'ACTIVE' } }))
    await store.refreshUser()
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    await expect(patientsApi.get('id')).rejects.toMatchObject({ status: 403 })
    expect(store.getSnapshot().status).toBe('authenticated')
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 401 }))
    await expect(patientsApi.get('id')).rejects.toMatchObject({ status: 401 })
    expect(store.getSnapshot().status).toBe('unauthenticated')
  } finally { store.dispose() }
})
