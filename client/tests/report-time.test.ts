/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { ApiError } from '../src/api/client'
import { customRange, isRangeProblem, periodLabel, presetRange, rangeDates, rangeDayCount, rangeLabel, utcDate, utcToday } from '../src/features/reports/report-time'
import { formatRate, labelIndexes, niceTop, reportError, reportKinds } from '../src/features/reports/report-utils'

const at = (iso: string) => Date.parse(iso)
const utc = (value: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...options }).format(Date.parse(`${value}T00:00:00Z`))

it.each([
  ['last7', '2026-10-30T00:00:00.000Z'], ['last30', '2026-10-07T00:00:00.000Z'], ['last90', '2026-08-08T00:00:00.000Z'],
] as const)('%s covers that many UTC calendar dates ending today, as a half-open range', (preset, from) => {
  expect(presetRange(preset, at('2026-11-05T09:30:00Z'))).toEqual({ from, to: '2026-11-06T00:00:00.000Z' })
})
it('matches the API default of 30 UTC dates for Last 30 days', () => {
  const range = presetRange('last30', at('2026-11-05T09:30:00Z'))
  expect(rangeDayCount(range)).toBe(30); expect(rangeDates(range)).toEqual({ first: '2026-10-07', last: '2026-11-05' })
})
it('uses the UTC date, not the local one, just either side of UTC midnight', () => {
  expect(presetRange('last7', at('2026-11-05T23:59:59.999Z')).to).toBe('2026-11-06T00:00:00.000Z')
  expect(presetRange('last7', at('2026-11-06T00:00:00.000Z')).to).toBe('2026-11-07T00:00:00.000Z')
  expect(utcToday(at('2026-11-05T23:30:00-05:00'))).toBe('2026-11-06')
})
it('turns inclusive custom dates into the exclusive next UTC midnight', () => {
  expect(customRange('2026-10-01', '2026-10-31')).toEqual({ from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' })
  expect(customRange('2026-11-05', '2026-11-05')).toEqual({ from: '2026-11-05T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z' })
  expect(customRange('2025-11-06', '2026-11-05')).toEqual({ from: '2025-11-06T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z' })
})
it.each([
  ['', '', 'from', 'Choose a start date and an end date.'],
  ['2026-10-01', '', 'to', 'Choose an end date as well as a start date.'],
  ['', '2026-10-31', 'from', 'Choose a start date as well as an end date.'],
  ['2026-11-02', '2026-11-01', 'to', 'The end date must be on or after the start date.'],
  ['2025-11-04', '2026-11-05', 'to', 'Choose a period of 366 days or fewer.'],
  ['2026-02-30', '2026-03-05', 'from', 'Enter a valid start date.'],
  ['2026-03-01', '2026-13-01', 'to', 'Enter a valid end date.'],
] as const)('rejects custom range %s → %s before sending', (from, to, field, message) => {
  const result = customRange(from, to)
  expect(isRangeProblem(result)).toBe(true); expect(result).toEqual({ field, message })
})
it('accepts exactly 366 days, the API maximum, including across a leap day', () => {
  expect(rangeDayCount(customRange('2028-01-01', '2028-12-31') as { from: string; to: string })).toBe(366)
  expect(isRangeProblem(customRange('2027-01-01', '2028-01-02'))).toBe(true)
})
it('parses reporting dates strictly as UTC calendar dates', () => {
  expect(utcDate('2026-11-01')).toBe(Date.UTC(2026, 10, 1)); expect(utcDate('2026-02-29')).toBeNull(); expect(utcDate('1 Nov 2026')).toBeNull()
})
it('labels day, Monday-start week and month buckets from their UTC start date', () => {
  expect(periodLabel('2026-11-01', 'day')).toBe(utc('2026-11-01', { day: 'numeric', month: 'short', year: 'numeric' }))
  expect(periodLabel('2026-11-02', 'week')).toBe(`Week of ${utc('2026-11-02', { day: 'numeric', month: 'short', year: 'numeric' })}`)
  expect(new Date('2026-11-02T00:00:00Z').getUTCDay()).toBe(1)
  expect(periodLabel('2026-11-01', 'month')).toBe(utc('2026-11-01', { month: 'long', year: 'numeric' }))
  expect(periodLabel('2026-11-02', 'week', 'short')).toBe(utc('2026-11-02', { day: 'numeric', month: 'short' }))
  expect(periodLabel('not-a-date', 'day')).toBe('not-a-date')
})
it('shows a server range [from, to) as its inclusive UTC dates', () => {
  expect(rangeLabel({ from: '2026-10-07T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z' })).toBe(`${utc('2026-10-07', { day: 'numeric', month: 'short', year: 'numeric' })} – ${utc('2026-11-05', { day: 'numeric', month: 'short', year: 'numeric' })}`)
  expect(rangeLabel({ from: '2026-11-05T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z' })).toBe(utc('2026-11-05', { day: 'numeric', month: 'short', year: 'numeric' }))
})
it('formats server rates as given, with 0% for an empty denominator', () => {
  expect(formatRate(8.25)).toBe('8.25%'); expect(formatRate(0)).toBe('0%'); expect(formatRate(100)).toBe('100%'); expect(formatRate(33.33)).toBe('33.33%')
})
it('chooses whole-number chart scales and at most four axis labels', () => {
  expect([0, 1, 2, 3, 5, 7, 9, 11, 45, 101].map(niceTop)).toEqual([1, 1, 2, 4, 6, 8, 10, 20, 60, 200])
  expect(labelIndexes(0)).toEqual([]); expect(labelIndexes(3)).toEqual([0, 1, 2]); expect(labelIndexes(30)).toEqual([0, 10, 19, 29]); expect(labelIndexes(367)).toEqual([0, 122, 244, 366])
})
it('offers only the reports each role may read', () => {
  expect(reportKinds('ADMIN')).toEqual(['patients', 'appointments']); expect(reportKinds('RECORDS_OFFICER')).toEqual(['patients', 'appointments'])
  expect(reportKinds('DOCTOR_IN_CHARGE')).toEqual(['clinical'])
})
it.each([
  [new ApiError(403, 'Permission denied', 'FORBIDDEN'), 'report', 'You don’t have access to this report.'],
  [new ApiError(403, 'Permission denied', 'FORBIDDEN'), 'dashboard', 'You don’t have access to this dashboard.'],
  [new ApiError(400, 'x', 'INVALID_REPORT_RANGE'), 'report', 'The reporting period wasn’t accepted. Choose a start date before the end date.'],
  [new ApiError(400, 'x', 'REPORT_RANGE_TOO_LARGE'), 'report', 'Choose a reporting period of 366 days or fewer.'],
  [new ApiError(400, 'x', 'VALIDATION_ERROR'), 'report', 'The reporting period wasn’t accepted. Check the dates and try again.'],
  [new ApiError(500, 'relation "Patient" does not exist', 'INTERNAL_ERROR'), 'report', 'The report couldn’t be loaded. Try again.'],
  [new ApiError(502, 'x', 'INVALID_RESPONSE'), 'dashboard', 'The dashboard could not be displayed because the server response was incomplete. Try again.'],
  [new ApiError(401, 'x', 'AUTHENTICATION_REQUIRED'), 'report', 'Your session has expired. Sign in again.'],
  [new TypeError('Failed to fetch'), 'report', 'Unable to contact the server. Please try again.'],
] as const)('maps %s to a safe %s message', (error, subject, message) => {
  expect(reportError(error, subject)).toBe(message)
})

// The same helpers, run in other process time zones, must give identical UTC results.
const moduleUrl = pathToFileURL(resolve('src/features/reports/report-time.ts')).href
const inZone = (zone: string) => JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--input-type=module', '-e',
  `import * as t from ${JSON.stringify(moduleUrl)}; const now = Date.parse('2026-11-05T23:30:00Z'); console.log(JSON.stringify({
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone, day: t.periodLabel('2026-11-01', 'day'), week: t.periodLabel('2026-11-02', 'week'),
    month: t.periodLabel('2026-11-01', 'month'), short: t.periodLabel('2026-11-01', 'day', 'short'), preset: t.presetRange('last7', now), today: t.utcToday(now),
    custom: t.customRange('2026-10-01', '2026-10-31'), range: t.rangeLabel({ from: '2026-11-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z' }) }))`],
  { env: { ...process.env, TZ: zone }, encoding: 'utf8' })) as Record<string, unknown>
it('never shifts a UTC reporting date in browsers west or east of UTC', () => {
  const [base, ...others] = ['UTC', 'Pacific/Honolulu', 'America/New_York', 'Asia/Tokyo', 'Pacific/Kiritimati'].map(inZone)
  expect(others.map((result) => result.zone)).toEqual(['Pacific/Honolulu', 'America/New_York', 'Asia/Tokyo', 'Pacific/Kiritimati'])
  for (const result of others) expect({ ...result, zone: 'UTC' }).toEqual(base)
  expect(base!.today).toBe('2026-11-05'); expect(String(base!.day)).toMatch(/\b1\b/); expect(String(base!.day)).not.toMatch(/31|Oct/)
})
