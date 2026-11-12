// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { admissionsApi } from '../src/api/admissions'
import type { BackendRole, StaffUser } from '../src/api/auth'
import { dashboardApi } from '../src/api/dashboard'
import { encountersApi } from '../src/api/encounters'
import { notificationsApi } from '../src/api/notifications'
import { patientsApi } from '../src/api/patients'
import { reportsApi } from '../src/api/reports'
import { App } from '../src/app/App'
import { admissionReport, dashboardFor, patientReport, recentPage } from './report-fixtures'

const identity = vi.hoisted(() => ({ role: 'ADMIN' as BackendRole }))
vi.mock('../src/features/auth/AuthGate', () => ({ AuthGate: ({ children }: { children: (user: StaffUser) => ReactNode }) => children({
  id: '80000000-0000-4000-8000-000000000008', staffNumber: 'STF-REPORTS', firstName: 'Rae', lastName: 'Reports', email: 'rae@example.test', status: 'ACTIVE', mustChangePassword: false, role: identity.role }) }))
let host: HTMLDivElement, root: Root
const empty = { items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T09:30:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(dashboardApi, 'get').mockImplementation(async () => dashboardFor(identity.role))
  vi.spyOn(reportsApi, 'patients').mockResolvedValue(patientReport); vi.spyOn(reportsApi, 'admissions').mockResolvedValue(admissionReport)
  vi.spyOn(notificationsApi, 'unreadCount').mockResolvedValue({ count: 0 })
  vi.spyOn(notificationsApi, 'list').mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } })
  vi.spyOn(patientsApi, 'list').mockResolvedValue(empty); vi.spyOn(patientsApi, 'get')
  vi.spyOn(admissionsApi, 'list').mockImplementation(async (query = {}) => recentPage(query.status ?? 'ADMITTED')); vi.spyOn(admissionsApi, 'get')
  vi.spyOn(encountersApi, 'list').mockResolvedValue(empty); vi.spyOn(encountersApi, 'get')
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(300) }) }
const start = async (role: BackendRole) => { identity.role = role; await act(async () => root.render(<App />)); await tick() }
const navLabels = () => Array.from(host.querySelectorAll('.desktop-sidebar nav button span:first-of-type')).map((item) => item.textContent)
const nav = async (label: string) => { await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('.desktop-sidebar nav button')).find((item) => item.querySelector('span')?.textContent === label)!.click()); await tick() }
const click = async (text: string) => { await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === text && !item.closest('[hidden]'))!.click()); await tick() }

it.each([
  ['ADMIN', ['Overview', 'Patients', 'Staff & Access', 'Staff Activity', 'Medication Catalog', 'Notifications', 'Reports'], 'Monitor hospital operations and current workload.'],
  ['RECORDS_OFFICER', ['Overview', 'Patients', 'Notifications', 'Reports'], 'Track admissions, discharges and who is in hospital.'],
  ['DOCTOR_IN_CHARGE', ['Overview', 'Patients', 'Medical Records', 'Notifications'], 'See who is admitted and your clinical workload.'],
] as const)('%s lands on its own Overview with the revised navigation', async (role, labels, description) => {
  await start(role)
  expect(navLabels()).toEqual(labels)
  expect(host.querySelector('h1')?.textContent).toBe('Overview'); expect(host.querySelector('.subheading')?.textContent).toBe(description)
  // The chart opens on the last 7 UTC days; every role can register a patient from the overview.
  expect(dashboardApi.get).toHaveBeenCalledOnce(); expect(Object.keys(vi.mocked(dashboardApi.get).mock.calls[0]![0]!).sort()).toEqual(['from', 'to'])
  expect(host.querySelector('.kpi-card')).not.toBeNull(); expect(host.querySelector('.activity-chart')).not.toBeNull()
  await act(async () => host.querySelector<HTMLButtonElement>('.dashboard-register')!.click()); await tick()
  expect(host.querySelector('[role="dialog"] h2')?.textContent).toBe('Register patient')
})
it.each(['ADMIN', 'RECORDS_OFFICER'] as const)('%s opens the registration and admission reports', async (role) => {
  await start(role); await nav('Reports')
  expect(host.querySelector('h1')?.textContent).toBe('Reports'); expect(host.querySelector('.subheading')?.textContent).toBe('Review registrations, admissions and discharges over a reporting period.')
  expect(reportsApi.patients).toHaveBeenCalledOnce(); expect(reportsApi.admissions).not.toHaveBeenCalled()
  await click('Admissions and discharges'); expect(reportsApi.admissions).toHaveBeenCalledOnce()
})
it('opens Patients from the current admissions card', async () => {
  await start('RECORDS_OFFICER')
  await act(async () => Array.from(host.querySelectorAll('.kpi-card')).find((card) => card.querySelector('h3')?.textContent === 'Currently admitted')!.querySelector<HTMLButtonElement>('.kpi-action')!.click()); await tick()
  expect(host.querySelector('h1')?.textContent).toBe('Patients'); expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('Patients')
})
it('opens medical records from a Medical Officer’s unfinished records card', async () => {
  await start('DOCTOR_IN_CHARGE'); await click('Open medical records'); expect(host.querySelector('h1')?.textContent).toBe('Medical Records')
})
it.each(['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('%s Overview fetches only its own aggregates and the latest stays', async (role) => {
  await start(role)
  for (const fn of [patientsApi.list, patientsApi.get, admissionsApi.get, encountersApi.list, encountersApi.get, notificationsApi.list, reportsApi.patients, reportsApi.admissions]) expect(fn).not.toHaveBeenCalled()
  expect(vi.mocked(admissionsApi.list).mock.calls.map(([query]) => query)).toEqual(role === 'DOCTOR_IN_CHARGE' ? [{ status: 'ADMITTED', limit: 5 }] : [{ status: 'ADMITTED', limit: 5 }, { status: 'DISCHARGED', limit: 5 }])
})
it('fetches a fresh dashboard each time Overview is opened', async () => {
  await start('ADMIN'); await nav('Patients'); await nav('Overview')
  expect(dashboardApi.get).toHaveBeenCalledTimes(2)
})
it('leaves the unread count to the navigation badge instead of repeating it as a card', async () => {
  vi.mocked(notificationsApi.unreadCount).mockResolvedValue({ count: 5 })
  await start('ADMIN')
  expect(host.querySelector('.desktop-sidebar .nav-badge')?.textContent).toBe('5')
  expect(Array.from(host.querySelectorAll('.kpi-card h3')).map((item) => item.textContent)).not.toContain('Unread notifications')
})
it('keeps navigation working while the dashboard is unavailable', async () => {
  vi.mocked(dashboardApi.get).mockRejectedValue(new TypeError('Failed to fetch'))
  await start('ADMIN')
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Unable to contact the server. Please try again.')
  // Every workspace is still one click away in the navigation.
  expect(navLabels()).toEqual(['Overview', 'Patients', 'Staff & Access', 'Staff Activity', 'Medication Catalog', 'Notifications', 'Reports'])
  await nav('Reports'); expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Patient registrations')
})
