/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { dashboardApi } from '../src/api/dashboard'
import { reportsApi } from '../src/api/reports'
import { resetApiSession } from '../src/api/client'
import { createAuthStore } from '../src/features/auth/auth-store'
import { adminDashboard, appointmentReport, clinicalReport, doctorDashboard, patientReport, recordsDashboard } from './report-fixtures'

const fetcher = vi.fn<typeof fetch>()
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
const fail = (status: number, code: string) => new Response(JSON.stringify({ success: false, error: { code, message: 'relation "Patient" does not exist', requestId: 'req-report' } }), { status })
const call = (index: number) => ({ url: String(fetcher.mock.calls[index]![0]), init: fetcher.mock.calls[index]![1] })
const params = (index: number) => Object.fromEntries(new URL(call(index).url, 'http://localhost').searchParams)
const from = '2026-10-01T00:00:00.000Z', to = '2026-11-01T00:00:00.000Z'
beforeEach(() => { resetApiSession(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher) })
afterEach(() => { vi.unstubAllGlobals(); resetApiSession() })

it('reads the session-selected dashboard with no query, no CSRF and the caller signal', async () => {
  fetcher.mockResolvedValueOnce(ok(adminDashboard))
  const signal = new AbortController().signal
  expect(await dashboardApi.get({}, signal)).toEqual(adminDashboard)
  expect(call(0).url).toBe('/api/v1/dashboard'); expect(call(0).init?.signal).toBe(signal)
  expect(call(0).init?.method).toBeUndefined(); expect(call(0).init?.credentials).toBe('include')
  expect(new Headers(call(0).init?.headers).has('X-CSRF-Token')).toBe(false); expect(fetcher).toHaveBeenCalledTimes(1)
})
it('sends only a paired period to the dashboard, never a role, scope, staff ID or bucket', async () => {
  fetcher.mockImplementation(async () => ok(recordsDashboard))
  await dashboardApi.get(Object.assign({ from, to }, { role: 'ADMIN', scope: 'all', staffId: 'x', bucket: 'week' }))
  expect(params(0)).toEqual({ from, to })
  await dashboardApi.get({ from }); await dashboardApi.get({ to })
  expect(call(1).url).toBe('/api/v1/dashboard'); expect(call(2).url).toBe('/api/v1/dashboard')
})
it.each([
  ['patients', '/api/v1/reports/patients', () => reportsApi.patients({ from, to, bucket: 'week' }), patientReport],
  ['appointments', '/api/v1/reports/appointments', () => reportsApi.appointments({ from, to, bucket: 'month' }), appointmentReport],
  ['clinical activity', '/api/v1/reports/clinical-activity', () => reportsApi.clinicalActivity({ from, to, bucket: 'day' }), clinicalReport],
] as const)('reads the %s report with only from, to and bucket', async (_name, path, run, body) => {
  fetcher.mockResolvedValueOnce(ok(body))
  expect(await run()).toEqual(body)
  expect(new URL(call(0).url, 'http://localhost').pathname).toBe(path)
  expect(Object.keys(params(0)).sort()).toEqual(['bucket', 'from', 'to'])
  expect(new Headers(call(0).init?.headers).has('X-CSRF-Token')).toBe(false)
})
it('URL-encodes offset timestamps, including a + offset', async () => {
  fetcher.mockResolvedValueOnce(ok(patientReport))
  await reportsApi.patients({ from: '2026-10-01T00:00:00+01:00', to: '2026-10-08T00:00:00+01:00', bucket: 'day' })
  expect(call(0).url).toBe('/api/v1/reports/patients?from=2026-10-01T00%3A00%3A00%2B01%3A00&to=2026-10-08T00%3A00%3A00%2B01%3A00&bucket=day')
})
it('lets the server default a report when no period or bucket is given, and never sends half a range', async () => {
  fetcher.mockImplementation(async () => ok(appointmentReport))
  await reportsApi.appointments(); await reportsApi.appointments({ from, bucket: 'week' })
  expect(call(0).url).toBe('/api/v1/reports/appointments'); expect(call(1).url).toBe('/api/v1/reports/appointments?bucket=week')
})
it('forwards the abort signal to every report', async () => {
  fetcher.mockResolvedValueOnce(ok(patientReport)).mockResolvedValueOnce(ok(appointmentReport)).mockResolvedValueOnce(ok(clinicalReport))
  const signal = new AbortController().signal
  await reportsApi.patients({}, signal); await reportsApi.appointments({}, signal); await reportsApi.clinicalActivity({}, signal)
  expect([0, 1, 2].map((index) => call(index).init?.signal)).toEqual([signal, signal, signal])
})
it.each(['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('keeps only the documented %s dashboard fields', async (role) => {
  const base = role === 'ADMIN' ? adminDashboard : role === 'RECORDS_OFFICER' ? recordsDashboard : doctorDashboard
  fetcher.mockResolvedValueOnce(ok({ ...base, patients: [{ firstName: 'Leak' }], diagnoses: ['Leak'], snapshot: { ...base.snapshot, activePatients: 999, activeStaff: { total: 9, admins: 9, recordsOfficers: 0, doctors: 0, emails: ['x'] } },
    period: { ...base.period, clinical: { encountersInRange: 5, finalizedEncountersInRange: 5, amendmentsInRange: 5, notes: 'Leak' } } }))
  const result = await dashboardApi.get()
  expect(JSON.stringify(result)).not.toMatch(/Leak|emails|diagnoses|patients"/)
  expect(Object.keys(result.snapshot).sort()).toEqual(Object.keys(base.snapshot).sort())
  expect(Object.keys(result.period).sort()).toEqual(Object.keys(base.period).sort())
})
it.each([
  ['an unknown role', { ...adminDashboard, role: 'SUPERUSER' }],
  ['a negative count', { ...adminDashboard, snapshot: { ...adminDashboard.snapshot, activePatients: -1 } }],
  ['a fractional count', { ...recordsDashboard, period: { ...recordsDashboard.period, patientsRegistered: 1.5 } }],
  ['a rate above 100', { ...adminDashboard, period: { ...adminDashboard.period, appointments: { ...adminDashboard.period.appointments, noShowRate: 140 } } }],
  ['a missing staff snapshot', { ...adminDashboard, snapshot: { ...recordsDashboard.snapshot } }],
  ['a missing draft count', { ...doctorDashboard, snapshot: { upcomingAppointments: 1, unreadNotifications: 0 } }],
  ['a non-UTC range', { ...adminDashboard, range: { ...adminDashboard.range, timezone: 'Europe/London' } }],
  ['a reversed range', { ...adminDashboard, range: { ...adminDashboard.range, from: adminDashboard.range.to, to: adminDashboard.range.from } }],
  ['a bad generatedAt', { ...adminDashboard, generatedAt: 'yesterday' }],
])('rejects a dashboard with %s instead of displaying it', async (_label, body) => {
  fetcher.mockResolvedValueOnce(ok(body))
  await expect(dashboardApi.get()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})
it.each([
  ['patients', () => reportsApi.patients(), { ...patientReport, series: [{ period: '1 Nov', registrations: 1 }] }],
  ['patients', () => reportsApi.patients(), { ...patientReport, series: 'none' }],
  ['appointments', () => reportsApi.appointments(), { ...appointmentReport, summary: { ...appointmentReport.summary, noShow: undefined } }],
  ['appointments', () => reportsApi.appointments(), { ...appointmentReport, range: { ...appointmentReport.range, bucket: 'quarter' } }],
  ['clinical', () => reportsApi.clinicalActivity(), { ...clinicalReport, series: [{ period: '2026-11-02', encounters: 'two', finalized: 0, amendments: 0 }] }],
  ['clinical', () => reportsApi.clinicalActivity(), { ...clinicalReport, snapshot: {} }],
] as const)('rejects a malformed %s report', async (_name, run, body) => {
  fetcher.mockResolvedValueOnce(ok(body))
  await expect(run()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})
it('drops anything beyond the documented clinical aggregates', async () => {
  fetcher.mockResolvedValueOnce(ok({ ...clinicalReport, encounters: [{ clinicalNotes: 'Leak' }], series: clinicalReport.series.map((row) => ({ ...row, diagnosis: 'Leak', authorId: 'other-doctor' })) }))
  const result = await reportsApi.clinicalActivity()
  expect(JSON.stringify(result)).not.toMatch(/Leak|authorId|other-doctor|clinicalNotes/)
  expect(Object.keys(result.series[0]!).sort()).toEqual(['amendments', 'encounters', 'finalized', 'period'])
})
it('keeps the session on a forbidden report and invalidates it on 401', async () => {
  const store = createAuthStore()
  try {
    fetcher.mockResolvedValueOnce(ok({ user: { id: 'doctor', staffNumber: 'STF-DOC', firstName: 'Dana', lastName: 'Doctor', email: 'dana@example.test', role: 'DOCTOR_IN_CHARGE', status: 'ACTIVE' } }))
    await store.refreshUser()
    fetcher.mockResolvedValueOnce(fail(403, 'FORBIDDEN'))
    await expect(reportsApi.patients()).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', requestId: 'req-report' })
    expect(store.getSnapshot().status).toBe('authenticated')
    fetcher.mockResolvedValueOnce(fail(401, 'AUTHENTICATION_REQUIRED'))
    await expect(dashboardApi.get()).rejects.toMatchObject({ status: 401 })
    expect(store.getSnapshot().status).toBe('unauthenticated')
  } finally { store.dispose() }
})
it('keeps dashboard and report code read-only and free of storage, logging, mocks, raw fetch, loose types and clinical reads', () => {
  const files = [resolve('src/api/dashboard.ts'), resolve('src/api/reports.ts'),
    ...['src/features/reports', 'src/features/dashboard'].flatMap((folder) => readdirSync(resolve(folder)).filter((name) => /\.tsx?$/.test(name)).map((name) => resolve(folder, name)))]
  const source = files.map((file) => readFileSync(file, 'utf8')).join('\n')
  expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|mocks\/|fetch\(|console\.|\bany\b|dangerouslySetInnerHTML|mutation\(|setInterval|EventSource|WebSocket/)
  expect(source).not.toMatch(/encountersApi|patientsApi|appointmentsApi|notificationsApi|staffApi|\.diagnoses|\.complaints|clinicalNotes|chiefComplaint/)
  expect(source).not.toMatch(/params\.set\('(role|scope|staffId|clinicianId|authorId)'/)
})
