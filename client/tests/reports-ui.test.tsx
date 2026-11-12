// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BackendRole } from '../src/api/auth'
import { ApiError } from '../src/api/client'
import { reportsApi, type PatientReport } from '../src/api/reports'
import { Reports } from '../src/features/reports/Reports'
import { TrendChart } from '../src/features/reports/TrendChart'
import { admissionReport, emptyAdmissionReport, emptyPatientReport, patientReport, range } from './report-fixtures'

let host: HTMLDivElement, root: Root
const defaultQuery = { from: '2026-10-07T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z', bucket: 'day' }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T09:30:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(reportsApi, 'patients').mockImplementation(async () => patientReport)
  vi.spyOn(reportsApi, 'admissions').mockImplementation(async () => admissionReport)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }
const mount = async (node: ReactNode) => { await act(async () => root.render(node)); await tick() }
const render = (role: BackendRole) => mount(<Reports role={role} />)
const button = (text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === text)
const press = async (element: HTMLElement | null | undefined) => { await act(async () => element!.click()); await tick() }
const click = (text: string) => press(button(text))
const field = <T extends HTMLElement = HTMLInputElement>(name: string) => host.querySelector<T>(`[name="${name}"]`)!
async function fill(name: string, value: string) {
  await act(async () => {
    const element = field<HTMLInputElement | HTMLSelectElement>(name)
    Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
const apply = async () => { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick() }
const last = (fn: unknown) => vi.mocked(fn as typeof reportsApi.patients).mock.calls.at(-1)![0]
const cards = () => Array.from(host.querySelectorAll('.kpi-card')).map((card) => [card.querySelector('h3')?.textContent, card.querySelector('.kpi-value')?.textContent])
const tabs = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
const utc = (value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...options }).format(Date.parse(`${value}T00:00:00Z`))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes }); return { promise, resolve } }

it.each(['ADMIN', 'RECORDS_OFFICER'] as const)('gives %s the registration and admission reports as tabs, defaulting to the last 30 UTC days by day', async (role) => {
  await render(role)
  expect(tabs().map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([['Patient registrations', 'true'], ['Admissions and discharges', 'false']])
  expect(host.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Report type')
  expect(host.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe('report-tab-patients')
  expect(last(reportsApi.patients)).toEqual(defaultQuery); expect(vi.mocked(reportsApi.patients).mock.calls[0]![1]).toBeInstanceOf(AbortSignal)
  expect(reportsApi.admissions).not.toHaveBeenCalled(); expect(host.textContent).not.toMatch(/ppointment|My clinical activity/)
})
it('gives Medical Officers no report and requests nothing (their workload is on the Overview)', async () => {
  await render('DOCTOR_IN_CHARGE')
  expect(tabs()).toHaveLength(0); expect(host.textContent).toContain('Reports are available to administrators and records officers.')
  expect(reportsApi.patients).not.toHaveBeenCalled(); expect(reportsApi.admissions).not.toHaveBeenCalled()
})
it('switches report type with the keyboard and keeps the applied period', async () => {
  await render('ADMIN')
  await act(async () => tabs()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))); await tick()
  expect(tabs()[1]!.getAttribute('aria-selected')).toBe('true'); expect(document.activeElement).toBe(tabs()[1]); expect(tabs()[1]!.tabIndex).toBe(0); expect(tabs()[0]!.tabIndex).toBe(-1)
  expect(last(reportsApi.admissions)).toEqual(defaultQuery)
  await act(async () => tabs()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))); await tick()
  expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true')
})
it('shows the patient snapshot separately from registrations in the period', async () => {
  await render('ADMIN')
  const now = host.querySelector('[aria-labelledby="patients-now"]')!, period = host.querySelector('[aria-labelledby="patients-period"]')!
  expect(now.querySelector('h2')?.textContent).toBe('Current status'); expect(now.textContent).toContain('They don’t depend on the reporting period.')
  expect(cards()).toEqual([['Active patients', '128'], ['Archived patients', '6'], ['Patients registered', '36']])
  expect(period.querySelector('h2')?.textContent).toBe('In this reporting period')
  expect(period.textContent).toContain('counted by registration date, including patients archived since')
  expect(host.querySelector('.report-meta')?.textContent).toContain(`${utc('2026-10-07')} – ${utc('2026-11-05')} (UTC) · grouped by day`)
})
it('charts registrations from the server series with an accessible summary and data table', async () => {
  await render('ADMIN')
  const chart = host.querySelector('.trend-chart')!
  expect(chart.querySelector('h3')?.textContent).toBe('Patients registered per day')
  expect(chart.querySelectorAll('rect')).toHaveLength(30)
  const image = chart.querySelector('[role="img"]')!
  const name = image.getAttribute('aria-labelledby')!.split(' ').map((id) => document.getElementById(id)?.textContent).join(' ')
  expect(name).toMatch(/^Patients registered per day 36 patients registered across 30 days\. Highest: 3 on .*\. Each bar is one UTC calendar day\.$/)
  expect(chart.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  const rows = Array.from(chart.querySelectorAll('tbody tr')).map((row) => [row.querySelector('th')?.textContent, row.querySelector('td')?.textContent])
  expect(rows).toHaveLength(30); expect(rows[0]).toEqual([utc('2026-10-07'), '0']); expect(rows[1]).toEqual([utc('2026-10-08'), '2'])
  expect(Array.from(chart.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual(['Date', 'Patients registered'])
  expect(chart.querySelector('.report-table-scroll')?.getAttribute('tabindex')).toBe('0')
  expect(chart.innerHTML).not.toMatch(/NaN|undefined|Infinity/)
})
it('states that no patients were registered instead of drawing an empty chart', async () => {
  vi.mocked(reportsApi.patients).mockImplementation(async () => emptyPatientReport)
  await render('RECORDS_OFFICER')
  expect(host.querySelector('.report-empty')?.textContent).toBe('No patients were registered in this period.')
  expect(host.querySelector('.trend-chart')).toBeNull(); expect(cards()).toEqual([['Active patients', '128'], ['Archived patients', '6'], ['Patients registered', '0']])
  expect(host.querySelector('[role="alert"]')).toBeNull()
})
it('shows current admissions separately from admissions and discharges in the period, charted together', async () => {
  await render('ADMIN'); await press(tabs()[1])
  expect(cards()).toEqual([['Currently admitted', '9'], ['Admissions', '30'], ['Discharges', '20']])
  expect(host.querySelector('[aria-labelledby="admissions-period"]')?.textContent).toContain('Admissions are counted by admission time and discharges by discharge time')
  const chart = host.querySelector('.trend-chart')!
  expect(chart.querySelector('h3')?.textContent).toBe('Admissions and discharges per day')
  expect(Array.from(chart.querySelectorAll('.chart-legend li')).map((item) => item.textContent)).toEqual(['Admissions', 'Discharges'])
  expect(chart.querySelectorAll('rect')).toHaveLength(60)
  expect(Array.from(chart.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual(['Date', 'Admissions', 'Discharges'])
  expect(host.textContent).not.toMatch(/roomNumber|dischargeNotes|Leak/)
})
it('treats a period with no admissions or discharges as a valid empty report', async () => {
  vi.mocked(reportsApi.admissions).mockImplementation(async () => emptyAdmissionReport)
  await render('ADMIN'); await press(tabs()[1])
  expect(host.querySelector('.report-empty')?.textContent).toBe('No admissions or discharges were recorded in this period.')
  expect(cards().map(([, value]) => value)).toEqual(['9', '0', '0']); expect(host.querySelector('.trend-chart')).toBeNull()
})
it('groups admissions by week with the UTC week explained', async () => {
  vi.mocked(reportsApi.admissions).mockImplementation(async () => ({ ...admissionReport, range: range('2026-10-05T00:00:00.000Z', '2026-11-09T00:00:00.000Z', 'week'),
    series: ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'].map((period, index) => ({ period, admissions: index, discharges: 1 })), summary: { admissionsInRange: 10, dischargesInRange: 5 } }))
  await render('RECORDS_OFFICER'); await press(tabs()[1])
  const chart = host.querySelector('.trend-chart')!
  expect(chart.querySelectorAll('rect')).toHaveLength(10)
  expect(chart.querySelector('tbody th')?.textContent).toBe(`Week of ${utc('2026-10-05')}`)
  expect(chart.textContent).toContain('Weeks start on Monday (UTC). The first and last weeks can be partial.')
})
it.each([['last7', '2026-10-30T00:00:00.000Z'], ['last90', '2026-08-08T00:00:00.000Z'], ['last30', '2026-10-07T00:00:00.000Z']] as const)('applies the %s preset as a UTC range only on Apply', async (preset, from) => {
  await render('ADMIN')
  await fill('reportPeriod', preset)
  if (preset !== 'last30') { expect(host.querySelector('.report-hint')?.textContent).toContain('Select Apply to update the report.'); expect(reportsApi.patients).toHaveBeenCalledOnce() }
  await apply()
  expect(last(reportsApi.patients)).toEqual({ from, to: '2026-11-06T00:00:00.000Z', bucket: 'day' })
  expect(host.querySelector('.report-hint')?.textContent).not.toContain('Select Apply')
})
it('applies custom inclusive UTC dates as the exclusive next midnight, starting from the applied period', async () => {
  await render('RECORDS_OFFICER'); await fill('reportPeriod', 'custom')
  expect([field('reportFrom').value, field('reportTo').value]).toEqual(['2026-10-07', '2026-11-05'])
  expect(field('reportTo').closest('label')?.textContent).toContain('To (UTC date, inclusive)')
  expect(field('reportFrom').getAttribute('aria-describedby')).toBe('report-utc-help')
  await fill('reportFrom', '2026-10-01'); await fill('reportTo', '2026-10-31'); await apply()
  expect(last(reportsApi.patients)).toEqual({ from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z', bucket: 'day' })
  await fill('reportFrom', '2026-11-05'); await fill('reportTo', '2026-11-05'); await apply()
  expect(last(reportsApi.patients)).toEqual({ from: '2026-11-05T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z', bucket: 'day' })
})
it.each([
  ['2026-10-01', '', 'reportTo', 'Choose an end date as well as a start date.'],
  ['', '2026-10-31', 'reportFrom', 'Choose a start date as well as an end date.'],
  ['2026-10-31', '2026-10-01', 'reportTo', 'The end date must be on or after the start date.'],
  ['2025-01-01', '2026-01-02', 'reportTo', 'Choose a period of 366 days or fewer.'],
] as const)('refuses custom dates %s to %s before sending and links the error to the field', async (from, to, name, message) => {
  await render('ADMIN'); await fill('reportPeriod', 'custom'); await fill('reportFrom', from); await fill('reportTo', to); await apply()
  expect(reportsApi.patients).toHaveBeenCalledOnce()
  expect(host.querySelector('#report-range-error')?.textContent).toBe(message); expect(host.querySelector('#report-range-error')?.getAttribute('role')).toBe('alert')
  expect(field(name).getAttribute('aria-invalid')).toBe('true'); expect(field(name).getAttribute('aria-describedby')).toBe('report-utc-help report-range-error')
  expect(document.activeElement).toBe(field(name))
})
it.each(['week', 'month', 'day'] as const)('groups by %s when applied', async (bucket) => {
  await render('ADMIN'); await press(field(`reportBucket"][value="${bucket}`))
  await apply(); expect(last(reportsApi.patients)).toEqual({ ...defaultQuery, bucket })
  expect(Array.from(host.querySelectorAll<HTMLInputElement>('[name="reportBucket"]')).map((input) => input.closest('label')?.textContent)).toEqual(['Day', 'Week', 'Month'])
})
it('labels week and month periods by their UTC start date', async () => {
  vi.mocked(reportsApi.patients).mockImplementation(async () => ({ ...patientReport, range: range('2026-08-01T00:00:00.000Z', '2026-11-06T00:00:00.000Z', 'month'),
    series: [{ period: '2026-08-01', registrations: 4 }, { period: '2026-09-01', registrations: 0 }, { period: '2026-10-01', registrations: 5 }, { period: '2026-11-01', registrations: 1 }], summary: { registrationsInRange: 10 } }))
  await render('ADMIN')
  expect(Array.from(host.querySelectorAll('.trend-chart tbody th')).map((th) => th.textContent)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'].map((day) => utc(day, { month: 'long', year: 'numeric' })))
  expect(host.querySelector('.trend-chart')?.textContent).toContain('Months are UTC calendar months. The first and last months can be partial.')
})
it('ignores and aborts a slower response for an older selection', async () => {
  const older = deferred<PatientReport>(), newer = deferred<typeof admissionReport>()
  vi.mocked(reportsApi.patients).mockReturnValueOnce(older.promise); vi.mocked(reportsApi.admissions).mockReturnValueOnce(newer.promise)
  await mount(<Reports role="ADMIN" />); await press(tabs()[1])
  expect((vi.mocked(reportsApi.patients).mock.calls[0]![1] as AbortSignal).aborted).toBe(true)
  newer.resolve(admissionReport); await tick(); older.resolve(patientReport); await tick()
  expect(cards()[0]).toEqual(['Currently admitted', '9']); expect(host.textContent).not.toContain('Active patients')
})
it('keeps the filters usable while a report loads', async () => {
  const pending = deferred<PatientReport>(); vi.mocked(reportsApi.patients).mockReturnValueOnce(pending.promise)
  await mount(<Reports role="ADMIN" />)
  expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading patient registrations…'); expect(host.querySelector('.report-skeleton')?.getAttribute('aria-hidden')).toBe('true')
  expect(field<HTMLSelectElement>('reportPeriod').disabled).toBe(false); expect(button('Apply')!.disabled).toBe(false)
  pending.resolve(patientReport); await tick(); expect(host.querySelector('.report-skeleton')).toBeNull()
})
it('shows a safe error with its reference and retries on request', async () => {
  vi.mocked(reportsApi.admissions).mockRejectedValueOnce(new ApiError(500, 'relation "Admission" does not exist', 'INTERNAL_ERROR', 'req-rep-500'))
  await render('ADMIN'); await press(tabs()[1])
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('The report couldn’t be loaded. Try again.Support reference: req-rep-500'); expect(host.textContent).not.toContain('relation')
  await click('Try again'); expect(cards()[0]).toEqual(['Currently admitted', '9'])
})
it('says the report is not available to this account on 403, without a retry', async () => {
  vi.mocked(reportsApi.patients).mockRejectedValue(new ApiError(403, 'Permission denied', 'FORBIDDEN', 'req-403'))
  await render('RECORDS_OFFICER')
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('You don’t have access to this report.Support reference: req-403'); expect(button('Try again')).toBeUndefined()
})
it('explains a server range refusal', async () => {
  vi.mocked(reportsApi.patients).mockRejectedValueOnce(new ApiError(400, 'Report range cannot exceed 366 days', 'REPORT_RANGE_TOO_LARGE', 'req-400'))
  await render('ADMIN')
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Choose a reporting period of 366 days or fewer.Support reference: req-400')
})
it('refreshes the applied report on request only, never on a timer', async () => {
  await render('ADMIN'); await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60000) }); expect(reportsApi.patients).toHaveBeenCalledOnce()
  await press(host.querySelector('[aria-label="Refresh report"]')); expect(reportsApi.patients).toHaveBeenCalledTimes(2); expect(last(reportsApi.patients)).toEqual(defaultQuery)
})
it('shows the generation time locally and the reporting period in UTC', async () => {
  await render('ADMIN')
  const time = host.querySelector('.report-meta time')!
  expect(time.getAttribute('datetime')).toBe(patientReport.generatedAt)
  expect(time.textContent).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(patientReport.generatedAt)))
  expect(host.querySelector('#report-utc-help')?.textContent).toBe('Reporting periods use UTC calendar dates, and weeks start on Monday.')
})
it('keeps a maximum-length daily series usable: every bucket drawn, four axis labels, full table', async () => {
  const series = Array.from({ length: 367 }, (_, index) => ({ period: new Date(Date.UTC(2025, 10, 5) + index * 86400000).toISOString().slice(0, 10), registrations: index % 7 }))
  vi.mocked(reportsApi.patients).mockImplementation(async () => ({ ...patientReport, series, summary: { registrationsInRange: series.reduce((total, row) => total + row.registrations, 0) } }))
  await render('ADMIN')
  const chart = host.querySelector('.trend-chart')!
  expect(chart.querySelectorAll('rect')).toHaveLength(367); expect(chart.querySelectorAll('tbody tr')).toHaveLength(367)
  expect(chart.querySelectorAll('.chart-x span')).toHaveLength(7); expect(chart.querySelectorAll('.chart-x span:not(.is-optional)')).toHaveLength(3)
  expect(chart.innerHTML).not.toMatch(/NaN|undefined|Infinity/)
})
it('draws a chart of zeros or a single period without NaN or undefined labels', async () => {
  await mount(<TrendChart title="Zeros" unit="items" bucket="day" periods={['2026-11-01', '2026-11-02']} series={[{ label: 'Items', tone: 'primary', values: [0, 0] }]} />)
  expect(host.innerHTML).not.toMatch(/NaN|undefined|Infinity/); expect(host.querySelector('figcaption p')?.textContent).toMatch(/^0 items across 2 days\. Each bar/)
  await mount(<TrendChart title="One" unit="items" bucket="month" periods={['2026-11-01']} series={[{ label: 'Items', tone: 'primary', values: [3] }]} />)
  expect(host.innerHTML).not.toMatch(/NaN|undefined|Infinity/); expect(host.querySelectorAll('.chart-x span')).toHaveLength(1)
  expect(Array.from(host.querySelectorAll('.chart-y span')).map((span) => span.textContent)).toEqual(['0', '2', '4'])
})
it('offers no export, print, download or clinical breakdown controls', async () => {
  await render('ADMIN')
  expect(host.textContent).not.toMatch(/Export|Download|Print|CSV|PDF|Excel|diagnos|complaint|Top /i)
  await press(tabs()[1]); expect(host.textContent).not.toMatch(/Export|Download|Print|CSV|PDF|Excel|diagnos|Top /i)
})
it('never writes report data to browser storage', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  await render('ADMIN'); await press(tabs()[1]); await fill('reportPeriod', 'last90'); await apply()
  expect(setItem).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0)
})
