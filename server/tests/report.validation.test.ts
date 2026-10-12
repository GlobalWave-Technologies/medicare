import { describe, expect, it } from 'vitest'
import { dashboardQuerySchema, reportQuerySchema, resolveReportRange, DAY_MS } from '../src/modules/reports/report.validation.js'
import { appointmentSummary, bucketStart, buildTimeBuckets, countNumber, emptyAppointmentCounts, rangeDto } from '../src/modules/reports/report.dto.js'

const from = '2024-02-28T12:00:00Z', to = '2024-03-02T12:00:00Z'
describe('report validation and UTC buckets', () => {
  it.each(['role', 'clinicianId', 'authorId', 'patientId', 'status', 'page', 'limit', 'timezone', 'where', 'orderBy', 'include', 'select', 'diagnosis', 'export'])('rejects widening field %s', (key) => {
    expect(reportQuerySchema.safeParse({ [key]: 'anything' }).success).toBe(false)
    expect(dashboardQuerySchema.safeParse({ [key]: 'anything' }).success).toBe(false)
  })
  it.each(['2024-02-30T00:00:00Z', '2024-01-01', '2024-01-01T00:00:00', 'invalid', '0000-01-01T00:00:00Z', '2024-01-01T00:00:00+25:00'])('rejects invalid timestamp %s', (value) => {
    expect(reportQuerySchema.safeParse({ from: value, to }).success).toBe(false)
    expect(reportQuerySchema.safeParse({ from, to: value }).success).toBe(false)
  })
  it.each([{ from }, { to }, { from: [from, from], to }, { from: { gte: from }, to }])('rejects malformed range %j', (query) => {
    expect(reportQuerySchema.safeParse(query).success).toBe(false)
  })
  it.each(['year', 'hour', 'DAY', "day'); DROP TABLE Patient;--", '', ['day', 'week']])('rejects bucket %j', (bucket) => {
    expect(reportQuerySchema.safeParse({ bucket }).success).toBe(false)
  })
  it.each(['day', 'week', 'month'])('accepts bucket %s', (bucket) => expect(reportQuerySchema.parse({ bucket }).bucket).toBe(bucket))
  it('defaults to daily and disallows a dashboard bucket selector', () => {
    expect(reportQuerySchema.parse({})).toEqual({ bucket: 'day' })
    expect(dashboardQuerySchema.safeParse({ bucket: 'day' }).success).toBe(false)
  })
  it.each([true, false])('has bounded UTC defaults dashboard=%s', (dashboard) => {
    const range = resolveReportRange({}, dashboard, new Date('2024-03-01T23:59:59.999Z'))
    expect(range.to.toISOString()).toBe('2024-03-02T00:00:00.000Z')
    expect(range.to.getTime() - range.from.getTime()).toBe((dashboard ? 1 : 30) * DAY_MS)
    expect(range.from.getUTCHours()).toBe(0)
  })
  it.each([{ from, to: from }, { from: to, to: from }, { from }, { to }, { from: 'bad', to },
    { from: '2023-01-01T00:00:00Z', to: '2024-01-03T00:00:00Z' }])('rejects unordered/unbounded service input %j', (query) => {
    expect(() => resolveReportRange(query, false)).toThrow()
  })
  it('allows exactly 366 days and partial edge buckets, rejects one extra millisecond', () => {
    const start = Date.parse(from), end = start + 366 * DAY_MS
    expect(buildTimeBuckets(resolveReportRange({ from, to: new Date(end).toISOString() }, false))).toHaveLength(367)
    expect(() => resolveReportRange({ from, to: new Date(end + 1).toISOString() }, false)).toThrow()
  })
  it('normalizes explicit offsets across a UTC date boundary', () => {
    expect(rangeDto(resolveReportRange({ from: '2024-03-01T01:00:00+02:00', to: '2024-03-01T00:00:00-02:00' }, false)))
      .toEqual({ from: '2024-02-29T23:00:00.000Z', to: '2024-03-01T02:00:00.000Z', bucket: 'day', timezone: 'UTC' })
  })
  it.each([
    ['day', ['2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02']],
    ['week', ['2024-02-26']], ['month', ['2024-02-01', '2024-03-01']],
  ] as const)('fills ordered %s buckets across leap day', (bucket, expected) => {
    expect(buildTimeBuckets(resolveReportRange({ from, to, bucket }, false))).toEqual(expected)
  })
  it('excludes the exact upper bucket boundary', () => {
    expect(buildTimeBuckets(resolveReportRange({ from: '2024-12-31T00:00:00Z', to: '2025-01-01T00:00:00Z' }, false))).toEqual(['2024-12-31'])
  })
  it('uses Monday at the year boundary without mutating input', () => {
    const value = new Date('2023-01-01T19:00:00Z')
    expect(bucketStart(value, 'week').toISOString()).toBe('2022-12-26T00:00:00.000Z')
    expect(value.toISOString()).toBe('2023-01-01T19:00:00.000Z')
  })
  it('guards bucket allocation even for an internal unvalidated range', () => {
    expect(() => buildTimeBuckets({ from: new Date('2020-01-01'), to: new Date('2025-01-01'), bucket: 'day' })).toThrow()
  })
})
describe('safe numeric aggregates', () => {
  it.each([0, 1, 123n, BigInt(Number.MAX_SAFE_INTEGER)])('converts count %s', (value) => expect(countNumber(value)).toBe(Number(value)))
  it.each([-1, -1n, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, BigInt(Number.MAX_SAFE_INTEGER) + 1n])('rejects unsafe count %s', (value) => expect(() => countNumber(value)).toThrow())
  it('has finite zeros for empty status groups', () => {
    expect(appointmentSummary(emptyAppointmentCounts())).toEqual({ ...emptyAppointmentCounts(), totalAppointments: 0, cancellationRate: 0, noShowRate: 0 })
  })
  it('includes every status in the denominator and rounds to two decimals', () => {
    expect(appointmentSummary({ scheduled: 1, confirmed: 1, checkedIn: 1, completed: 1, cancelled: 1, noShow: 1 }))
      .toEqual({ scheduled: 1, confirmed: 1, checkedIn: 1, completed: 1, cancelled: 1, noShow: 1, totalAppointments: 6, cancellationRate: 16.67, noShowRate: 16.67 })
  })
  it('detects aggregate overflow', () => expect(() => appointmentSummary({ ...emptyAppointmentCounts(), scheduled: Number.MAX_SAFE_INTEGER, cancelled: 1 })).toThrow())
})
