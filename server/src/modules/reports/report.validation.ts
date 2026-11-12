import { z } from 'zod'
import { timezoneTimestamp } from '../../shared/validation/timestamp.js'
import { AppError } from '../../shared/errors/AppError.js'

export const DAY_MS = 86400000
export const MAX_RANGE_DAYS = 366
export const MAX_BUCKETS = 367
// The dashboard chart shows daily points: at most one month (31 days), last 7 days by default.
export const DASHBOARD_MAX_DAYS = 31
export const DASHBOARD_DEFAULT_DAYS = 7
export const reportBucketSchema = z.enum(['day', 'week', 'month'])
export type ReportBucket = z.infer<typeof reportBucketSchema>
const rangeFields = { from: timezoneTimestamp.optional(), to: timezoneTimestamp.optional() }
const paired = (value: { from?: string; to?: string }) => (value.from === undefined) === (value.to === undefined)
export const dashboardQuerySchema = z.object(rangeFields).strict().refine(paired)
export const reportQuerySchema = z.object({ ...rangeFields, bucket: reportBucketSchema.default('day') }).strict().refine(paired)
export type ReportQuery = z.infer<typeof reportQuerySchema>
export interface ReportRange { from: Date; to: Date; bucket: ReportBucket }

// Half-open ranges compose without counting midnight twice. Defaults include today: the last 7
// UTC days for the dashboard, the last 30 for reports.
export function resolveReportRange(query: { from?: string; to?: string; bucket?: ReportBucket }, dashboard: boolean, now = new Date()): ReportRange {
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0)
  const from = query.from ? new Date(query.from) : new Date(today.getTime() - (dashboard ? DASHBOARD_DEFAULT_DAYS - 1 : 29) * DAY_MS)
  const to = query.to ? new Date(query.to) : new Date(today.getTime() + DAY_MS)
  if (!paired(query) || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())
    || from >= to || from.getUTCFullYear() < 1 || to.getUTCFullYear() > 9999) {
    throw new AppError(400, 'INVALID_REPORT_RANGE', 'Report range must have ordered, supported endpoints')
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new AppError(400, 'REPORT_RANGE_TOO_LARGE', 'Report range cannot exceed 366 days')
  }
  if (dashboard && to.getTime() - from.getTime() > DASHBOARD_MAX_DAYS * DAY_MS) {
    throw new AppError(400, 'REPORT_RANGE_TOO_LARGE', 'Dashboard range cannot exceed 31 days')
  }
  return { from, to, bucket: query.bucket ?? 'day' }
}
