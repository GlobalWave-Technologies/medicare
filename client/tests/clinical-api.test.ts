import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { encountersApi } from '../src/api/encounters'
import { resetApiSession } from '../src/api/client'
import { createAuthStore } from '../src/features/auth/auth-store'
import { doctor, encounter, patient, reviewed } from './clinical-fixtures'
const fetcher = vi.fn<typeof fetch>(), ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
beforeEach(() => { resetApiSession(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher) })
afterEach(() => { vi.unstubAllGlobals(); resetApiSession() })
it('lists summaries using backend defaults, credentials and no CSRF', async () => {
  fetcher.mockResolvedValueOnce(ok({ items: [], pagination: {} })); await encountersApi.list()
  expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/encounters?page=1&limit=20')
  expect(fetcher.mock.calls[0]![1]?.credentials).toBe('include'); expect(new Headers(fetcher.mock.calls[0]![1]?.headers).has('X-CSRF-Token')).toBe(false); expect(fetcher).toHaveBeenCalledOnce()
})
it.each(['list', 'history'] as const)('%s encodes actual filters and cannot override patient history scope', async (action) => {
  fetcher.mockResolvedValueOnce(ok({ items: [], pagination: {} }))
  const signal = new AbortController().signal
  const query = { page: 3, limit: 10, patientId: 'forged-other-patient', clinicianId: doctor.id, appointmentId: encounter.appointment!.id, status: 'REVIEWED' as const, search: ' MR-% & ', dateFrom: '2026-01-01T00:00:00+03:00', dateTo: '2026-11-01T12:00:00Z' }
  if (action === 'list') await encountersApi.list(query, signal); else await encountersApi.history(patient.id, query, signal)
  const url = new URL(String(fetcher.mock.calls[0]![0]), 'http://localhost')
  expect(url.pathname).toBe(action === 'list' ? '/api/v1/encounters' : `/api/v1/patients/${patient.id}/encounters`)
  expect(url.searchParams.get('search')).toBe('MR-% &'); expect(url.searchParams.get('page')).toBe('3'); expect(url.searchParams.get('limit')).toBe('10')
  expect(url.searchParams.get('patientId')).toBe(action === 'list' ? query.patientId : null)
  for (const key of ['clinicianId', 'appointmentId', 'status', 'dateFrom', 'dateTo'] as const) expect(url.searchParams.get(key)).toBe(query[key])
  expect(fetcher.mock.calls[0]![1]?.signal).toBe(signal)
})
it('loads detail by encoded UUID, no CSRF and cancellable read', async () => {
  fetcher.mockResolvedValueOnce(ok({ encounter })); const signal = new AbortController().signal
  expect(await encountersApi.get('id/space here', signal)).toEqual({ encounter })
  expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/encounters/id%2Fspace%20here'); expect(fetcher.mock.calls[0]![1]?.signal).toBe(signal); expect(fetcher).toHaveBeenCalledOnce()
})
it.each(['create', 'updateDraft', 'finalize', 'amend'] as const)('%s sends exact endpoint/allowlisted fields with shared CSRF', async (action) => {
  fetcher.mockResolvedValueOnce(ok({ csrfToken: 'a'.repeat(64) })).mockResolvedValueOnce(ok({ encounter }))
  const input = { patientId: patient.id, appointmentId: encounter.appointment!.id, occurredAt: encounter.occurredAt, clinicalNotes: 'Clinical payload', complaints: [{ description: 'Complaint', id: 'forged', patientId: 'forged' }], diagnoses: [{ description: 'Diagnosis', code: null, notes: 'Note', id: 'forged', authorId: 'forged' }], clinicianId: 'forged', authorId: 'forged', reference: 'forged', status: 'REVIEWED', reviewedAt: 'forged', createdAt: 'forged', amendments: ['forged'] }
  const result = action === 'create' ? await encountersApi.create(input) : action === 'updateDraft' ? await encountersApi.updateDraft(encounter, input) : action === 'finalize' ? await encountersApi.finalize(encounter.id) : await encountersApi.amend(encounter.id, { ...input, reason: 'Correction reason', content: 'Correction content' })
  expect(result.encounter).toEqual(encounter)
  const [url, init] = fetcher.mock.calls[1]!
  expect(url).toBe(`/api/v1/encounters${action === 'create' ? '' : `/${encounter.id}${action === 'updateDraft' ? '' : `/${action}`}`}`)
  expect(init?.method).toBe(action === 'updateDraft' ? 'PATCH' : 'POST'); expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('a'.repeat(64)); expect(init?.credentials).toBe('include')
  const expected = { occurredAt: input.occurredAt, clinicalNotes: input.clinicalNotes, complaints: [{ description: 'Complaint' }], diagnoses: [{ description: 'Diagnosis', code: null, notes: 'Note' }] }
  expect(JSON.parse(String(init?.body))).toEqual(action === 'create' ? { ...expected, patientId: patient.id, appointmentId: input.appointmentId } : action === 'updateDraft' ? expected : action === 'finalize' ? {} : { reason: 'Correction reason', content: 'Correction content' })
})
it.each(['REVIEWED', 'VOIDED'] as const)('refuses known %s records through the generic draft helper before transport', async (status) => {
  await expect(encountersApi.updateDraft({ ...reviewed, status }, { clinicalNotes: 'forbidden' })).rejects.toMatchObject({ code: 'ENCOUNTER_NOT_EDITABLE' }); expect(fetcher).not.toHaveBeenCalled()
})
it('supports unlinked creation without inventing an appointment', async () => {
  fetcher.mockResolvedValueOnce(ok({ csrfToken: 'a'.repeat(64) })).mockResolvedValueOnce(ok({ encounter }))
  await encountersApi.create({ patientId: patient.id }); expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body))).toEqual({ patientId: patient.id })
})
it('preserves doctor authentication on 403 and invalidates on 401', async () => {
  const store = createAuthStore()
  try {
    fetcher.mockResolvedValueOnce(ok({ user: doctor })); await store.refreshUser()
    fetcher.mockResolvedValueOnce(ok({ csrfToken: 'a'.repeat(64) })).mockResolvedValueOnce(new Response('{}', { status: 403 }))
    await expect(encountersApi.finalize(encounter.id)).rejects.toMatchObject({ status: 403 }); expect(store.getSnapshot()).toMatchObject({ status: 'authenticated', user: { role: 'DOCTOR_IN_CHARGE' } })
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 401 })); await expect(encountersApi.get(encounter.id)).rejects.toMatchObject({ status: 401 }); expect(store.getSnapshot().status).toBe('unauthenticated')
  } finally { store.dispose() }
})
it('never automatically replays a failed amendment', async () => {
  fetcher.mockResolvedValueOnce(ok({ csrfToken: 'a'.repeat(64) })).mockResolvedValueOnce(new Response('{}', { status: 500 }))
  await expect(encountersApi.amend(encounter.id, { reason: 'Reason', content: 'Content' })).rejects.toMatchObject({ status: 500 }); expect(fetcher).toHaveBeenCalledTimes(2)
})
