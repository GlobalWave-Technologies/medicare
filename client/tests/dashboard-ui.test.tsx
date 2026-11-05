// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BackendRole } from '../src/api/auth'
import { ApiError } from '../src/api/client'
import { dashboardApi, type Dashboard } from '../src/api/dashboard'
import { Overview } from '../src/features/dashboard/Overview'
import type { View } from '../src/types/index'
import { adminDashboard, dashboardFor, doctorDashboard, generatedAt, recordsDashboard, zeroSummary } from './report-fixtures'

let host: HTMLDivElement, root: Root, onView: ReturnType<typeof vi.fn<(view: View) => void>>
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T09:30:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); onView = vi.fn()
  vi.spyOn(dashboardApi, 'get').mockImplementation(async () => adminDashboard)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }
const render = async (role: BackendRole, data: Dashboard = dashboardFor(role)) => {
  vi.mocked(dashboardApi.get).mockImplementation(async () => data)
  await act(async () => root.render(<Overview role={role} onView={onView} />)); await tick()
}
const button = (text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === text)
const click = async (text: string) => { await act(async () => button(text)!.click()); await tick() }
const section = (id: string) => host.querySelector<HTMLElement>(`[aria-labelledby="${id}"]`)!
const cards = (id: string) => Array.from(section(id).querySelectorAll('.kpi-card')).map((card) => [card.querySelector('h3')?.textContent, card.querySelector('.kpi-value')?.textContent])
const details = (id: string) => Array.from(section(id).querySelectorAll('.kpi-detail')).map((item) => item.textContent)
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

it('shows a contained loading state while keeping the period controls usable', async () => {
  const pending = deferred<Dashboard>(); vi.mocked(dashboardApi.get).mockReturnValue(pending.promise)
  await act(async () => root.render(<Overview role="ADMIN" onView={onView} />))
  expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading overview…')
  expect(host.querySelector('.report-skeleton')?.getAttribute('aria-hidden')).toBe('true'); expect(host.querySelector('.kpi-value')).toBeNull()
  expect(button('Last 7 days')!.disabled).toBe(false); expect(button('Refresh')!.disabled).toBe(true)
  expect(host.querySelector('.dashboard')?.getAttribute('aria-busy')).toBe('true')
  pending.resolve(adminDashboard); await tick(); expect(host.querySelector('.report-skeleton')).toBeNull()
})
it('asks the server for its own dashboard with no role, scope or staff selector', async () => {
  await render('ADMIN')
  expect(vi.mocked(dashboardApi.get).mock.calls[0]![0]).toEqual({}); expect(vi.mocked(dashboardApi.get).mock.calls[0]![1]).toBeInstanceOf(AbortSignal)
  expect(host.querySelectorAll('select, input')).toHaveLength(0); expect(host.textContent).not.toMatch(/View as|Switch role|Role:/)
})
it('shows the administrator current status from the server snapshot', async () => {
  await render('ADMIN')
  expect(cards('overview-now')).toEqual([['Active patients', '128'], ['Archived patients', '6'], ['Active staff', '15'], ['Upcoming appointments', '7'], ['Unread notifications', '3']])
  expect(details('overview-now')[2]).toBe('2 Admins · 5 Records Officers · 8 Doctors in Charge')
  expect(details('overview-now')[3]).toBe('Scheduled or confirmed, from now onward.')
})
it('shows the administrator activity for the period, using the server rates', async () => {
  await render('ADMIN')
  expect(section('overview-period').querySelector('h2')?.textContent).toBe('Hospital activity today')
  expect(cards('overview-period')).toEqual([['Patients registered', '4'], ['Appointments', '12'], ['Cancellation rate', '8.33%'], ['No-show rate', '8.33%']])
  expect(details('overview-period').slice(2)).toEqual(['1 of 12 appointments cancelled.', '1 of 12 appointments marked no-show.'])
  expect(section('overview-period').textContent).toContain('Across the whole hospital.')
})
it('keeps current status and period activity visibly separate, with the UTC period stated', async () => {
  await render('RECORDS_OFFICER')
  expect(section('overview-now').querySelector('.report-section-head p')?.textContent).toBe('Live counts when the overview was refreshed. They don’t depend on the activity period.')
  expect(section('overview-period').querySelector('.report-section-head p')?.textContent).toMatch(/^5 Nov 2026 \(UTC calendar day\)\.|\(UTC calendar day\)\./)
})
it('gives records officers patients, appointments and notifications only', async () => {
  await render('RECORDS_OFFICER')
  expect(cards('overview-now').map(([label]) => label)).toEqual(['Active patients', 'Archived patients', 'Upcoming appointments', 'Unread notifications'])
  expect(cards('overview-period').map(([label]) => label)).toEqual(['Patients registered', 'Appointments', 'Cancellation rate', 'No-show rate'])
  expect(button('Manage staff')).toBeUndefined()
})
it.each(['ADMIN', 'RECORDS_OFFICER'] as const)('shows %s no clinical work or content', async (role) => {
  await render(role)
  expect(host.textContent).not.toMatch(/draft|encounter|amendment|diagnos|complaint|clinical/i)
})
it('gives doctors only their own appointments and clinical work', async () => {
  await render('DOCTOR_IN_CHARGE')
  expect(cards('overview-now')).toEqual([['My upcoming appointments', '2'], ['My open drafts', '3'], ['Unread notifications', '0']])
  expect(cards('overview-period')).toEqual([['My appointments', '4'], ['Encounters documented', '2'], ['Encounters finalized', '1'], ['Amendments added', '1']])
  expect(host.textContent).not.toMatch(/Active patients|Archived patients|Active staff|Patients registered|whole hospital|Cancellation rate/)
  expect(section('overview-period').textContent).toContain('Only appointments assigned to you and your own clinical work.')
  expect(section('overview-period').querySelector('.status-breakdown h3')?.textContent).toBe('My appointments by current status')
})
it('lists all six appointment statuses with words and counts, not colour alone', async () => {
  await render('ADMIN')
  const rows = Array.from(host.querySelectorAll('.status-breakdown li')).map((row) => [row.querySelector('.status-breakdown-label')?.textContent, row.querySelector('strong')?.textContent])
  expect(rows).toEqual([['Scheduled:', '3'], ['Confirmed:', '2'], ['Checked in:', '1'], ['Completed:', '4'], ['No-show:', '1'], ['Cancelled:', '1']])
  expect(Array.from(host.querySelectorAll('.status-dot, .status-breakdown-track')).every((item) => item.getAttribute('aria-hidden') === 'true')).toBe(true)
  expect(host.textContent).not.toMatch(/SCHEDULED|CHECKED_IN|NO_SHOW/)
})
it('shows the server generation time in local time', async () => {
  await render('ADMIN')
  const time = host.querySelector('.report-refresh time')!
  expect(time.getAttribute('datetime')).toBe(generatedAt)
  expect(time.textContent).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(generatedAt)))
  expect(host.querySelector('.report-refresh p')?.textContent).toMatch(/^Last refreshed /)
})
it('switches the activity period to explicit UTC calendar ranges and back to the server day', async () => {
  await render('ADMIN')
  await click('Last 7 days')
  expect(vi.mocked(dashboardApi.get).mock.calls.at(-1)![0]).toEqual({ from: '2026-10-30T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z' })
  expect(button('Last 7 days')!.getAttribute('aria-pressed')).toBe('true'); expect(section('overview-period').querySelector('h2')?.textContent).toBe('Hospital activity in the last 7 days')
  await click('Last 30 days'); expect(vi.mocked(dashboardApi.get).mock.calls.at(-1)![0]).toEqual({ from: '2026-10-07T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z' })
  await click('Today'); expect(vi.mocked(dashboardApi.get).mock.calls.at(-1)![0]).toEqual({})
})
it('refreshes on request only, without polling', async () => {
  await render('ADMIN'); expect(dashboardApi.get).toHaveBeenCalledOnce()
  await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60000) }); expect(dashboardApi.get).toHaveBeenCalledOnce()
  await click('Refresh'); expect(dashboardApi.get).toHaveBeenCalledTimes(2)
})
it('ignores a slower response for a superseded period and aborts it', async () => {
  const first = deferred<Dashboard>(), second = deferred<Dashboard>()
  vi.mocked(dashboardApi.get).mockImplementation((query = {}) => query.from ? second.promise : first.promise)
  await act(async () => root.render(<Overview role="ADMIN" onView={onView} />)); await click('Last 7 days')
  expect((vi.mocked(dashboardApi.get).mock.calls[0]![1] as AbortSignal).aborted).toBe(true)
  second.resolve({ ...adminDashboard, period: { ...adminDashboard.period, patientsRegistered: 21 } }); await tick()
  first.resolve(adminDashboard); await tick()
  expect(cards('overview-period')[0]).toEqual(['Patients registered', '21'])
})
it('shows a safe error with its reference and recovers on Try again', async () => {
  vi.mocked(dashboardApi.get).mockRejectedValueOnce(new ApiError(500, 'relation "Appointment" does not exist', 'INTERNAL_ERROR', 'req-dash-500'))
  await act(async () => root.render(<Overview role="ADMIN" onView={onView} />)); await tick()
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('The dashboard couldn’t be loaded. Try again.Support reference: req-dash-500')
  expect(host.textContent).not.toMatch(/relation|Appointment"/)
  await click('Try again'); expect(cards('overview-now')).toHaveLength(5)
})
it('explains a refused dashboard without a retry loop', async () => {
  vi.mocked(dashboardApi.get).mockRejectedValue(new ApiError(403, 'Permission denied', 'FORBIDDEN', 'req-403'))
  await act(async () => root.render(<Overview role="RECORDS_OFFICER" onView={onView} />)); await tick()
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('You don’t have access to this dashboard.Support reference: req-403'); expect(button('Try again')).toBeUndefined()
})
it('keeps zero values meaningful, with 0% rates and an empty-period note', async () => {
  await render('RECORDS_OFFICER', { ...recordsDashboard, snapshot: { upcomingAppointments: 0, unreadNotifications: 0, activePatients: 0, archivedPatients: 0 }, period: { appointments: zeroSummary, patientsRegistered: 0 } })
  expect(cards('overview-now').map(([, value]) => value)).toEqual(['0', '0', '0', '0'])
  expect(cards('overview-period').map(([, value]) => value)).toEqual(['0', '0', '0%', '0%'])
  expect(section('overview-period').querySelector('.report-empty-note')?.textContent).toBe('No appointments are scheduled today.')
  expect(host.textContent).not.toMatch(/NaN|undefined|null|Infinity/)
})
it.each([
  ['ADMIN', 'View patients', 'Patients'], ['ADMIN', 'Manage staff', 'Staff'], ['ADMIN', 'View appointments', 'Appointments'], ['ADMIN', 'Open notifications', 'Notifications'],
  ['RECORDS_OFFICER', 'View appointments', 'Appointments'], ['DOCTOR_IN_CHARGE', 'View my appointments', 'Appointments'], ['DOCTOR_IN_CHARGE', 'Open medical records', 'Medical records'],
] as const)('%s card action %s opens %s', async (role, label, view) => {
  await render(role); await click(label); expect(onView).toHaveBeenLastCalledWith(view)
})
it('shows no fabricated growth, activity feed, schedule or chart on the overview', async () => {
  await render('ADMIN')
  expect(host.textContent).not.toMatch(/[+↑↓]\s?\d|\bvs\.? last|growth|trend|Recent activity|Today's schedule|This week|Chief complaint|2,048|Updated \d+ minutes/i)
  expect(host.querySelector('.trend-chart, .chart-frame, [role="img"], canvas')).toBeNull()
})
it('offers role-appropriate shortcuts', async () => {
  for (const [role, titles] of [['ADMIN', ['Appointment operations', 'Patient directory', 'Staff & Access']], ['RECORDS_OFFICER', ['Appointment operations', 'Patient directory', 'Reports']],
    ['DOCTOR_IN_CHARGE', ['My appointments', 'Patient directory', 'Clinical records']]] as const) {
    await render(role)
    expect(Array.from(host.querySelectorAll('.workflow-card strong')).map((item) => item.textContent)).toEqual(titles)
  }
})
it('renders the doctor dashboard even when it reports nothing yet', async () => {
  await render('DOCTOR_IN_CHARGE', { ...doctorDashboard, snapshot: { upcomingAppointments: 0, unreadNotifications: 0, currentAuthoredDrafts: 0 },
    period: { appointments: zeroSummary, clinical: { encountersInRange: 0, finalizedEncountersInRange: 0, amendmentsInRange: 0 } } })
  expect(cards('overview-period').map(([, value]) => value)).toEqual(['0', '0', '0', '0'])
  expect(section('overview-period').querySelector('.report-empty-note')?.textContent).toBe('No appointments assigned to you are scheduled today.')
})
it('never writes dashboard data to browser storage', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  await render('ADMIN'); await click('Last 30 days'); await click('Refresh')
  expect(setItem).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0)
})
