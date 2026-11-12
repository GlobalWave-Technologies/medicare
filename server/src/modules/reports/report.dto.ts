import { AppError } from '../../shared/errors/AppError.js'
import { MAX_BUCKETS, type ReportRange, type ReportBucket } from './report.validation.js'

export function rangeDto(range: ReportRange) {
  return { from: range.from.toISOString(), to: range.to.toISOString(), bucket: range.bucket, timezone: 'UTC' as const }
}
export function countNumber(value: bigint | number) {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Aggregate count is outside the safe integer range')
  return count
}
export function bucketStart(value: Date, bucket: ReportBucket) {
  const start = new Date(value); start.setUTCHours(0, 0, 0, 0)
  if (bucket === 'week') start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7)
  if (bucket === 'month') start.setUTCDate(1)
  return start
}
export function buildTimeBuckets(range: ReportRange) {
  const result: string[] = [], cursor = bucketStart(range.from, range.bucket)
  while (cursor < range.to) {
    if (result.length >= MAX_BUCKETS) throw new AppError(400, 'REPORT_RANGE_TOO_LARGE', 'Report bucket limit exceeded')
    result.push(cursor.toISOString().slice(0, 10))
    if (range.bucket === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    else cursor.setUTCDate(cursor.getUTCDate() + (range.bucket === 'week' ? 7 : 1))
  }
  return result
}
