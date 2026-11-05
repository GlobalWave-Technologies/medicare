// Reporting periods are UTC calendar dates. Nothing here reads the browser's time zone,
// so a label such as 2026-11-01 can never be shown as 31 October.
export const DAY_MS = 86400000
export const MAX_RANGE_DAYS = 366
export type ReportBucket = 'day' | 'week' | 'month'
export type RangePreset = 'last7' | 'last30' | 'last90'
export type UtcRange = { from: string; to: string }
export type RangeProblem = { field: 'from' | 'to'; message: string }

const presetDays: Record<RangePreset, number> = { last7: 7, last30: 30, last90: 90 }
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/

export function utcDate(value: string): number | null {
  const match = datePattern.exec(value)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])]
  const date = new Date(0)
  date.setUTCFullYear(year, month, day)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day ? date.getTime() : null
}
export const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10)
const midnight = (now: number) => Math.floor(now / DAY_MS) * DAY_MS
export const utcToday = (now: number) => isoDate(midnight(now))

// The last N UTC calendar dates including today, as the half-open [from, to) the API expects.
export function presetRange(preset: RangePreset, now: number): UtcRange {
  const today = midnight(now)
  return { from: new Date(today - (presetDays[preset] - 1) * DAY_MS).toISOString(), to: new Date(today + DAY_MS).toISOString() }
}
// Custom ranges are chosen as inclusive UTC dates; the end date becomes the next midnight.
export function customRange(fromDate: string, toDate: string): UtcRange | RangeProblem {
  if (!fromDate && !toDate) return { field: 'from', message: 'Choose a start date and an end date.' }
  if (!fromDate) return { field: 'from', message: 'Choose a start date as well as an end date.' }
  if (!toDate) return { field: 'to', message: 'Choose an end date as well as a start date.' }
  const from = utcDate(fromDate), through = utcDate(toDate)
  if (from === null) return { field: 'from', message: 'Enter a valid start date.' }
  if (through === null) return { field: 'to', message: 'Enter a valid end date.' }
  if (from > through) return { field: 'to', message: 'The end date must be on or after the start date.' }
  if (through + DAY_MS - from > MAX_RANGE_DAYS * DAY_MS) return { field: 'to', message: 'Choose a period of 366 days or fewer.' }
  return { from: new Date(from).toISOString(), to: new Date(through + DAY_MS).toISOString() }
}
export const isRangeProblem = (value: UtcRange | RangeProblem): value is RangeProblem => 'message' in value

// The inclusive UTC dates covered by a server range [from, to).
export function rangeDates(range: UtcRange) {
  return { first: isoDate(Date.parse(range.from)), last: isoDate(Date.parse(range.to) - 1) }
}
export function reportDate(value: string, style: 'short' | 'long' = 'long') {
  const time = utcDate(value)
  if (time === null) return value
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short', ...(style === 'long' ? { year: 'numeric' } : {}) }).format(time)
}
export function periodLabel(period: string, bucket: ReportBucket, style: 'short' | 'long' = 'long') {
  const time = utcDate(period)
  if (time === null) return period
  if (bucket === 'month') return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: style === 'long' ? 'long' : 'short', year: 'numeric' }).format(time)
  return bucket === 'week' && style === 'long' ? `Week of ${reportDate(period)}` : reportDate(period, style)
}
export function rangeLabel(range: UtcRange) {
  const { first, last } = rangeDates(range)
  return first === last ? reportDate(first) : `${reportDate(first)} – ${reportDate(last)}`
}
export const rangeDayCount = (range: UtcRange) => Math.round((Date.parse(range.to) - Date.parse(range.from)) / DAY_MS)
