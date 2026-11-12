// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { admissionsApi } from '../src/api/admissions'
import type { BackendRole } from '../src/api/auth'
import { ApiError } from '../src/api/client'
import { dashboardApi, type Dashboard } from '../src/api/dashboard'
import { Overview } from '../src/features/dashboard/Overview'
import type { PatientView } from '../src/features/patients/Patients'
import type { View } from '../src/types/index'
import { adminDashboard, dashboardFor, doctorDashboard, emptyActivity, generatedAt, recentPage, recordsDashboard, week } from './report-fixtures'

let host: HTMLDivElement, root: Root, onView: ReturnType<typeof vi.fn<(view: View, list?: PatientView) => void>>, visibility: DocumentVisibilityState
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T09:30:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  visibility = 'visible'; vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); onView = vi.fn()
  vi.spyOn(dashboardApi, 'get').mockImplementation(async () => adminDashboard)
  vi.spyOn(admissionsApi, 'list').mockImplementation(async (query = {}) => recentPage(query.status ?? 'ADMITTED'))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const render = async (role: BackendRole, data: Dashboard = dashboardFor(role), onRegister?: () => void) => {
  vi.mocked(dashboardApi.get).mockImplementation(async () => data)
  await act(async () => root.render(<Overview role={role} onView={onView} onRegister={onRegister} />)); await tick()
}
const button = (text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === text)
const click = async (text: string) => { await act(async () => button(text)!.click()); await tick() }
const section = (id: string) => host.querySelector<HTMLElement>(`[aria-labelledby="${id}"]`)!
const cards = () => Array.from(host.querySelectorAll('.dashboard-kpis .kpi-card')).map((card) => [card.querySelector('h3')?.textContent, card.querySelector('.kpi-value')?.textContent])
const lastQuery = () => vi.mocked(dashboardApi.get).mock.calls.at(-1)![0]
const frame = () => host.querySelector<HTMLElement>('.activity-frame')!
const key = async (name: string) => { await act(async () => frame().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }))) }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

it('shows stable placeholders while loading, keeping the period controls usable', async () => {
  const pending = deferred<Dashboard>(); vi.mocked(dashboardApi.get).mockReturnValue(pending.promise)
  await act(async () => root.render(<Overview role="ADMIN" onView={onView} />))
  expect(host.querySelector('.dashboard-updated')?.textContent).toBe('Loading current figures…')
  expect(host.querySelectorAll('.dashboard-kpis .skeleton-card')).toHaveLength(5); expect(host.querySelector('.dashboard-kpis.kpi-five')).not.toBeNull(); expect(host.querySelector('.chart-placeholder')?.getAttribute('aria-hidden')).toBe('true')
  expect(host.querySelector('.kpi-value')).toBeNull(); expect(button('Last 30 days')!.disabled).toBe(false); expect(button('Refresh')!.disabled).toBe(true)
  expect(host.querySelector('.dashboard')?.getAttribute('aria-busy')).toBe('true')
  pending.resolve(adminDashboard); await tick()
  expect(host.querySelector('.skeleton-card, .chart-placeholder')).toBeNull(); expect(host.querySelector('.activity-chart')).not.toBeNull()
})
it('asks the server for the last 7 UTC days with no role, scope or staff selector', async () => {
  await render('ADMIN')
  expect(vi.mocked(dashboardApi.get).mock.calls[0]![0]).toEqual({ from: '2026-10-30T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z' })
  expect(vi.mocked(dashboardApi.get).mock.calls[0]![1]).toBeInstanceOf(AbortSignal)
  expect(host.querySelectorAll('select, input')).toHaveLength(0); expect(host.textContent).not.toMatch(/View as|Switch role|Role:/)
})
it.each(['ADMIN', 'RECORDS_OFFICER'] as const)('gives %s current admissions, total patients and today’s admissions and discharges', async (role) => {
  await render(role)
  // Administrators also see how many staff are active now (a count only), linking to Staff Activity.
  expect(cards()).toEqual([['Currently admitted', '9'], ['Total patients', '128'], ['Admissions today', '5'], ['Discharges today', '2'], ...(role === 'ADMIN' ? [['Staff active now', '4']] : [])])
  if (role === 'ADMIN') { expect(host.querySelector('.dashboard-kpis')!.textContent).toContain('7 people signed in today'); await click('Open Staff Activity'); expect(onView).toHaveBeenLastCalledWith('Activity') }
  expect(host.querySelector('.dashboard-kpis')!.textContent).toContain('6 archived records kept separately')
  expect(host.textContent).not.toMatch(/draft|encounter|amendment|diagnos|complaint|clinical|unfinished|Active staff|Unread notifications/i)
})
it('gives Medical Officers current admissions, today’s movements and their own unfinished records', async () => {
  await render('DOCTOR_IN_CHARGE')
  expect(cards()).toEqual([['Currently admitted', '9'], ['Admissions today', '5'], ['Discharges today', '2'], ['My unfinished records', '3']])
  expect(host.textContent).toContain('Drafts to finalize before discharge')
  expect(host.textContent).not.toMatch(/Total patients|Active staff|Recent discharges/)
})
it('draws the live admissions and discharges series from the server data only', async () => {
  await render('RECORDS_OFFICER')
  const chart = section('activity-title')
  expect(chart.querySelector('h2')?.textContent).toBe('Admissions and discharges')
  expect(chart.querySelector('#activity-summary')?.textContent).toMatch(/^17 admissions and 10 discharges in the last 7 days\. Most admissions: .+ \(5\)\.$/)
  expect(Array.from(chart.querySelectorAll('.activity-legend li')).map((item) => item.textContent)).toEqual(['Admissions', 'Discharges'])
  const paths = Array.from(chart.querySelectorAll<SVGPathElement>('.activity-frame path.activity-line'))
  expect(paths).toHaveLength(2); for (const path of paths) expect(path.getAttribute('d')!.match(/[ML]/g)).toHaveLength(7)
  // Different marker shapes, not only colours: circles for admissions, squares for discharges.
  expect(chart.querySelectorAll('.activity-frame .series-admissions circle')).toHaveLength(7); expect(chart.querySelectorAll('.activity-frame .series-discharges rect')).toHaveLength(7)
  // Seven day labels and three whole-number gridlines (0, 3, 6) for a peak of 5.
  expect(chart.querySelectorAll('.activity-frame text.activity-axis')).toHaveLength(7 + 3)
  const rows = Array.from(chart.querySelectorAll('.chart-data tbody tr')).map((row) => Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent))
  expect(rows).toEqual(week.map((point) => [String(point.admissions), String(point.discharges)]))
  expect(chart.querySelector('.activity-frame')?.getAttribute('aria-label')).toBe('Admissions and discharges per day, in the last 7 days. Use the left and right arrow keys to read each day.')
})
it('reads each day with the keyboard, in a tooltip and a polite announcement', async () => {
  await render('ADMIN')
  await act(async () => frame().focus())
  const live = () => host.querySelector('.activity-chart [aria-live="polite"]')!.textContent
  expect(host.querySelector('.activity-tooltip')?.textContent).toMatch(/Admissions5Discharges2$/); expect(live()).toMatch(/: 5 admissions, 2 discharges$/)
  await key('ArrowLeft'); expect(live()).toMatch(/: 2 admissions, 1 discharge$/)
  await key('Home'); expect(live()).toMatch(/: 2 admissions, 1 discharge$/); expect(host.querySelector('.activity-tooltip')?.className).toContain('align-start')
  await key('End'); expect(host.querySelector('.activity-tooltip')?.className).toContain('align-end')
  await act(async () => frame().blur()); expect(host.querySelector('.activity-tooltip')).toBeNull(); expect(live()).toBe('')
})
it('switches the chart period to explicit UTC ranges, keeping the old chart dimmed until the new one arrives', async () => {
  await render('ADMIN')
  const pending = deferred<Dashboard>(); vi.mocked(dashboardApi.get).mockReturnValueOnce(pending.promise)
  await click('Last 30 days')
  expect(lastQuery()).toEqual({ from: '2026-10-07T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z' }); expect(button('Last 30 days')!.getAttribute('aria-pressed')).toBe('true')
  expect(host.querySelector('.activity-chart')?.className).toContain('is-busy'); expect(cards()).toHaveLength(5)
  pending.resolve({ ...adminDashboard, activity: { ...adminDashboard.activity, admissions: 40 } }); await tick()
  expect(host.querySelector('.activity-chart')?.className).not.toContain('is-busy'); expect(section('activity-title').textContent).toContain('40 admissions')
  await click('This month'); expect(lastQuery()).toEqual({ from: '2026-11-01T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z' })
})
it('refreshes every minute while visible, never while hidden, and catches up when shown again', async () => {
  await render('ADMIN'); expect(dashboardApi.get).toHaveBeenCalledOnce()
  await tick(60000); expect(dashboardApi.get).toHaveBeenCalledTimes(2)
  expect(admissionsApi.list).toHaveBeenCalledTimes(4)
  visibility = 'hidden'; await tick(5 * 60000); expect(dashboardApi.get).toHaveBeenCalledTimes(2)
  visibility = 'visible'; await act(async () => document.dispatchEvent(new Event('visibilitychange'))); await tick()
  expect(dashboardApi.get).toHaveBeenCalledTimes(3)
  await click('Refresh'); expect(dashboardApi.get).toHaveBeenCalledTimes(4)
})
it('marks its own timed refreshes as background reads, so an unattended Overview does not count as activity', async () => {
  await render('ADMIN')
  expect(vi.mocked(dashboardApi.get).mock.calls[0]![2]).toBe(false); expect(vi.mocked(admissionsApi.list).mock.calls[0]![2]).toBe(false)
  await tick(60000)
  expect(vi.mocked(dashboardApi.get).mock.calls.at(-1)![2]).toBe(true); expect(vi.mocked(admissionsApi.list).mock.calls.at(-1)![2]).toBe(true)
  await click('Refresh'); expect(vi.mocked(dashboardApi.get).mock.calls.at(-1)![2]).toBe(false)
})
it('counts the next automatic refresh from the last load, so a manual Refresh never causes a burst', async () => {
  await render('ADMIN'); await tick(30000); await click('Refresh'); expect(dashboardApi.get).toHaveBeenCalledTimes(2)
  await tick(59000); expect(dashboardApi.get).toHaveBeenCalledTimes(2)
  await tick(1000); expect(dashboardApi.get).toHaveBeenCalledTimes(3)
})
it('keeps the last figures on screen when a refresh fails, and says so', async () => {
  await render('ADMIN')
  vi.mocked(dashboardApi.get).mockRejectedValueOnce(new ApiError(503, 'upstream', 'SERVICE_UNAVAILABLE', 'req-503'))
  await click('Refresh')
  expect(host.querySelector('.dashboard-stale')?.textContent).toMatch(/^The latest figures couldn’t be loaded, so the figures from .+ are shown\.Try again$/)
  expect(cards()).toHaveLength(5); expect(host.querySelector('.activity-chart')).not.toBeNull()
  await click('Try again'); expect(host.querySelector('.dashboard-stale')).toBeNull()
})
it('ignores a slower response for a superseded period and aborts it', async () => {
  const first = deferred<Dashboard>(), second = deferred<Dashboard>()
  vi.mocked(dashboardApi.get).mockImplementation((query = {}) => query.from === '2026-10-07T00:00:00.000Z' ? second.promise : first.promise)
  await act(async () => root.render(<Overview role="ADMIN" onView={onView} />)); await click('Last 30 days')
  expect((vi.mocked(dashboardApi.get).mock.calls[0]![1] as AbortSignal).aborted).toBe(true)
  second.resolve({ ...adminDashboard, today: { admissions: 21, discharges: 0 } }); await tick()
  first.resolve(adminDashboard); await tick()
  expect(cards()[2]).toEqual(['Admissions today', '21'])
})
it('shows a safe error with its reference and recovers on Try again', async () => {
  vi.mocked(dashboardApi.get).mockRejectedValueOnce(new ApiError(500, 'relation "Admission" does not exist', 'INTERNAL_ERROR', 'req-dash-500'))
  await act(async () => root.render(<Overview role="ADMIN" onView={onView} />)); await tick()
  expect(host.querySelector('.report-error')?.textContent).toBe('The dashboard couldn’t be loaded. Try again.Support reference: req-dash-500')
  expect(host.textContent).not.toMatch(/relation|Admission"/)
  await click('Try again'); expect(cards()).toHaveLength(5)
})
it('explains a refused dashboard without a retry loop', async () => {
  vi.mocked(dashboardApi.get).mockRejectedValue(new ApiError(403, 'Permission denied', 'FORBIDDEN', 'req-403'))
  await act(async () => root.render(<Overview role="RECORDS_OFFICER" onView={onView} />)); await tick()
  expect(host.querySelector('.report-error')?.textContent).toBe('You don’t have access to this dashboard.Support reference: req-403'); expect(button('Try again')).toBeUndefined()
})
it('replaces an all-zero chart with a short empty message, and keeps zero counts meaningful', async () => {
  vi.mocked(admissionsApi.list).mockResolvedValue({ items: [], pagination: { page: 1, limit: 5, total: 0, totalPages: 0 } })
  await render('RECORDS_OFFICER', { ...recordsDashboard, today: { admissions: 0, discharges: 0 }, activity: emptyActivity, snapshot: { currentAdmissions: 0, unreadNotifications: 0, activePatients: 0, archivedPatients: 0 } })
  expect(cards().map(([, value]) => value)).toEqual(['0', '0', '0', '0'])
  expect(host.querySelector('.chart-empty')?.textContent).toBe('No admission activity recorded for this period.'); expect(host.querySelector('.activity-chart, .activity-frame')).toBeNull()
  expect(section('recent-admitted').textContent).toContain('No patients are currently admitted.'); expect(section('recent-discharged').textContent).toContain('No discharges yet.')
  expect(host.textContent).not.toMatch(/NaN|undefined|null|Infinity/)
})
it.each(['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('%s sees recent admissions, and only Admin and Records see recent discharges', async (role) => {
  await render(role)
  expect(admissionsApi.list).toHaveBeenCalledWith({ status: 'ADMITTED', limit: 5 }, expect.any(AbortSignal), false)
  expect(section('recent-admitted').textContent).toContain('Recent Patient 1'); expect(section('recent-admitted').textContent).toContain('Ward A - Bed 1')
  expect(Boolean(host.querySelector('[aria-labelledby="recent-discharged"]'))).toBe(role !== 'DOCTOR_IN_CHARGE')
  await act(async () => section('recent-admitted').querySelector<HTMLButtonElement>('.kpi-action')!.click()); expect(onView).toHaveBeenLastCalledWith('Patients', 'admitted')
})
it.each([
  ['ADMIN', 'View admitted patients', ['Patients', 'admitted']], ['ADMIN', 'View patients', ['Patients']], ['RECORDS_OFFICER', 'View discharged patients', ['Patients', 'discharged']],
  ['DOCTOR_IN_CHARGE', 'View admitted patients', ['Patients', 'admitted']], ['DOCTOR_IN_CHARGE', 'Open medical records', ['Medical records']],
] as const)('%s card action %s opens the right list', async (role, label, target) => {
  await render(role); await click(label); expect(onView).toHaveBeenLastCalledWith(...target)
})
it('offers Register patient as the one primary action when the role may register', async () => {
  const register = vi.fn()
  await render('DOCTOR_IN_CHARGE', doctorDashboard, register)
  expect(host.querySelectorAll('.button-primary')).toHaveLength(1); await click('Register patient'); expect(register).toHaveBeenCalledOnce()
  await render('ADMIN'); expect(button('Register patient')).toBeUndefined()
})
it('shows the server generation time and no fabricated growth or appointment figures', async () => {
  await render('ADMIN')
  const time = host.querySelector('.dashboard-updated time')!
  expect(time.getAttribute('datetime')).toBe(generatedAt)
  expect(host.textContent).not.toMatch(/[+↑↓]\s?\d|\bvs\.? last|growth|Today's schedule|Chief complaint|appointment/i)
})
it('never writes dashboard data to browser storage', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  await render('ADMIN'); await click('Last 30 days'); await click('Refresh'); await tick(60000)
  expect(setItem).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0)
})
