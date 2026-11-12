import { expect, it } from 'vitest'
import { activitySummary, chartPeriods, periodQuery } from '../src/features/dashboard/dashboard-utils'

const at = (iso: string) => Date.parse(iso)

it('offers exactly the three chart periods, last 7 days first', () => {
  expect(chartPeriods.map(([value, label]) => [value, label])).toEqual([['last7', 'Last 7 days'], ['last30', 'Last 30 days'], ['month', 'This month']])
})
it.each([
  ['last7', '2026-11-05T23:59:59.999Z', '2026-10-30T00:00:00.000Z', '2026-11-06T00:00:00.000Z'],
  ['last30', '2026-11-05T00:00:00.000Z', '2026-10-07T00:00:00.000Z', '2026-11-06T00:00:00.000Z'],
  ['month', '2026-11-05T09:30:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-06T00:00:00.000Z'],
  ['month', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z'],
  ['month', '2026-12-31T23:00:00.000Z', '2026-12-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'],
  ['month', '2028-02-29T12:00:00.000Z', '2028-02-01T00:00:00.000Z', '2028-03-01T00:00:00.000Z'],
] as const)('%s at %s covers whole UTC days ending today', (period, now, from, to) => {
  expect(periodQuery(period, at(now))).toEqual({ from, to })
  const days = (Date.parse(to) - Date.parse(from)) / 86400000
  expect(Number.isInteger(days) && days >= 1 && days <= 31).toBe(true)
})
it('summarises the period in words, naming the busiest admission day only when there was one', () => {
  const series = [{ period: '2026-11-04', admissions: 1, discharges: 2 }, { period: '2026-11-05', admissions: 3, discharges: 0 }]
  expect(activitySummary(4, 2, 'in the last 7 days', series)).toMatch(/^4 admissions and 2 discharges in the last 7 days\. Most admissions: .*2026 \(3\)\.$/)
  expect(activitySummary(1, 1, 'this month', [{ period: '2026-11-05', admissions: 1, discharges: 1 }])).toMatch(/^1 admission and 1 discharge this month\. Most admissions/)
  expect(activitySummary(0, 2, 'this month', [{ period: '2026-11-05', admissions: 0, discharges: 2 }])).toBe('0 admissions and 2 discharges this month.')
})
