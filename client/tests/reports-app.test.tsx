// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BackendRole, StaffUser } from '../src/api/auth'
import { appointmentsApi } from '../src/api/appointments'
import { dashboardApi } from '../src/api/dashboard'
import { encountersApi } from '../src/api/encounters'
import { notificationsApi } from '../src/api/notifications'
import { patientsApi } from '../src/api/patients'
import { reportsApi } from '../src/api/reports'
import { App } from '../src/app/App'
import { clinician, page } from './appointment-fixtures'
import { appointmentReport, clinicalReport, dashboardFor, patientReport } from './report-fixtures'

const identity = vi.hoisted(() => ({ role: 'ADMIN' as BackendRole }))
vi.mock('../src/features/auth/AuthGate', () => ({ AuthGate: ({ children }: { children: (user: StaffUser) => ReactNode }) => children({
  id: '80000000-0000-4000-8000-000000000008', staffNumber: 'STF-REPORTS', firstName: 'Rae', lastName: 'Reports', email: 'rae@example.test', status: 'ACTIVE', role: identity.role }) }))
let host: HTMLDivElement, root: Root
const empty = { items: [], pagination: { ...page.pagination, total: 0, totalPages: 0 } }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T09:30:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(dashboardApi, 'get').mockImplementation(async () => dashboardFor(identity.role))
  vi.spyOn(reportsApi, 'patients').mockResolvedValue(patientReport); vi.spyOn(reportsApi, 'appointments').mockResolvedValue(appointmentReport)
  vi.spyOn(reportsApi, 'clinicalActivity').mockResolvedValue(clinicalReport)
  vi.spyOn(notificationsApi, 'unreadCount').mockResolvedValue({ count: 0 })
  vi.spyOn(notificationsApi, 'list').mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } })
  vi.spyOn(patientsApi, 'list').mockResolvedValue(empty); vi.spyOn(patientsApi, 'get')
  vi.spyOn(appointmentsApi, 'list').mockResolvedValue(empty); vi.spyOn(appointmentsApi, 'get'); vi.spyOn(appointmentsApi, 'clinicians').mockResolvedValue({ clinicians: [clinician] })
  vi.spyOn(encountersApi, 'list').mockResolvedValue(empty); vi.spyOn(encountersApi, 'get')
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(300) }) }
const start = async (role: BackendRole) => { identity.role = role; await act(async () => root.render(<App />)); await tick() }
const navLabels = () => Array.from(host.querySelectorAll('.desktop-sidebar nav button span:first-of-type')).map((item) => item.textContent)
const nav = async (label: string) => { await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('.desktop-sidebar nav button')).find((item) => item.querySelector('span')?.textContent === label)!.click()); await tick() }
const click = async (text: string) => { await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === text && !item.closest('[hidden]'))!.click()); await tick() }

it.each([
  ['ADMIN', ['Overview', 'Patients', 'Appointments', 'Staff & Access', 'Reports', 'Notifications'], 'Monitor hospital operations and current workload.'],
  ['RECORDS_OFFICER', ['Overview', 'Patients', 'Appointments', 'Reports', 'Notifications'], 'Track patient registration and appointment activity.'],
  ['DOCTOR_IN_CHARGE', ['Overview', 'Patients', 'Appointments', 'Medical Records', 'Reports', 'Notifications'], 'Review your appointments and clinical workload.'],
] as const)('%s lands on its own Overview with Reports in the navigation', async (role, labels, description) => {
  await start(role)
  expect(navLabels()).toEqual(labels)
  expect(host.querySelector('h1')?.textContent).toBe('Overview'); expect(host.querySelector('.subheading')?.textContent).toBe(description)
  expect(dashboardApi.get).toHaveBeenCalledOnce(); expect(vi.mocked(dashboardApi.get).mock.calls[0]![0]).toEqual({})
  expect(host.querySelector('.kpi-card')).not.toBeNull()
})
it.each([
  ['ADMIN', 'Review operational activity over a selected reporting period.', 'patients'],
  ['RECORDS_OFFICER', 'Review operational activity over a selected reporting period.', 'patients'],
  ['DOCTOR_IN_CHARGE', 'Review your own clinical activity over a selected reporting period.', 'clinicalActivity'],
] as const)('%s opens only the reports it may read', async (role, description, api) => {
  await start(role); await nav('Reports')
  expect(host.querySelector('h1')?.textContent).toBe('Reports'); expect(host.querySelector('.subheading')?.textContent).toBe(description)
  expect(reportsApi[api]).toHaveBeenCalledOnce()
  for (const other of (['patients', 'appointments', 'clinicalActivity'] as const).filter((name) => name !== api)) expect(reportsApi[other]).not.toHaveBeenCalled()
})
it('opens the appointment schedule from the upcoming appointments card', async () => {
  await start('RECORDS_OFFICER'); await click('View appointments')
  expect(host.querySelector('h1')?.textContent).toBe('Appointments'); expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('Appointments')
})
it('opens medical records from a doctor’s open drafts card', async () => {
  await start('DOCTOR_IN_CHARGE'); await click('Open medical records'); expect(host.querySelector('h1')?.textContent).toBe('Medical Records')
})
it.each(['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('%s Overview fetches nothing beyond its own aggregates', async (role) => {
  await start(role)
  for (const fn of [patientsApi.list, patientsApi.get, appointmentsApi.list, appointmentsApi.get, encountersApi.list, encountersApi.get, notificationsApi.list,
    reportsApi.patients, reportsApi.appointments, reportsApi.clinicalActivity]) expect(fn).not.toHaveBeenCalled()
})
it('fetches a fresh dashboard each time Overview is opened', async () => {
  await start('ADMIN'); await nav('Patients'); await nav('Overview')
  expect(dashboardApi.get).toHaveBeenCalledTimes(2)
})
it('shows the dashboard’s own unread snapshot without overriding the navigation badge', async () => {
  vi.mocked(notificationsApi.unreadCount).mockResolvedValue({ count: 5 })
  await start('ADMIN')
  expect(host.querySelector('.desktop-sidebar .nav-badge')?.textContent).toBe('5')
  const unread = Array.from(host.querySelectorAll('.kpi-card')).find((card) => card.querySelector('h3')?.textContent === 'Unread notifications')!
  expect(unread.querySelector('.kpi-value')?.textContent).toBe('3')
})
it('keeps navigation working while the dashboard is unavailable', async () => {
  vi.mocked(dashboardApi.get).mockRejectedValue(new TypeError('Failed to fetch'))
  await start('ADMIN')
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Unable to contact the server. Please try again.')
  expect(host.querySelectorAll('.workflow-card')).toHaveLength(3)
  await nav('Reports'); expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Patient activity')
})
