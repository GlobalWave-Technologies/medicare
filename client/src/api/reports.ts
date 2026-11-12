import { ApiError, isRecord, request } from './client'

export type ReportBucket = 'day' | 'week' | 'month'
export type ReportRange = { from: string; to: string; bucket: ReportBucket; timezone: 'UTC' }
export type ReportQuery = { from?: string; to?: string; bucket?: ReportBucket }
type Generated = { generatedAt: string; range: ReportRange }
export type PatientReport = Generated & {
  snapshot: { activePatients: number; archivedPatients: number }
  summary: { registrationsInRange: number }
  series: { period: string; registrations: number }[]
}
export type AdmissionReport = Generated & {
  snapshot: { currentAdmissions: number }
  summary: { admissionsInRange: number; dischargesInRange: number }
  series: { period: string; admissions: number; discharges: number }[]
}

export const reportBuckets: readonly ReportBucket[] = ['day', 'week', 'month']
export const invalidResponse = () => new ApiError(502, 'The server returned an unexpected response.', 'INVALID_RESPONSE')
export function record(value: unknown) {
  if (!isRecord(value)) throw invalidResponse()
  return value
}
export function count(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalidResponse()
  return value
}
function timestamp(value: unknown) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw invalidResponse()
  return value
}
function period(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalidResponse()
  return value
}
export function generated(data: Record<string, unknown>): Generated {
  const range = record(data.range)
  if (!reportBuckets.includes(range.bucket as ReportBucket) || range.timezone !== 'UTC') throw invalidResponse()
  const from = timestamp(range.from), to = timestamp(range.to)
  if (Date.parse(from) >= Date.parse(to)) throw invalidResponse()
  return { generatedAt: timestamp(data.generatedAt), range: { from, to, bucket: range.bucket as ReportBucket, timezone: 'UTC' } }
}
function rows<T>(value: unknown, map: (row: Record<string, unknown>) => T) {
  if (!Array.isArray(value)) throw invalidResponse()
  return value.map((row) => map(record(row)))
}
// Only the paired range and the bucket are ever sent; the server chooses scope from the session.
export function rangeParams(query: ReportQuery, bucket: boolean) {
  const params = new URLSearchParams()
  if (query.from !== undefined && query.to !== undefined) { params.set('from', query.from); params.set('to', query.to) }
  if (bucket && query.bucket) params.set('bucket', query.bucket)
  const text = params.toString()
  return text ? `?${text}` : ''
}

export const reportsApi = {
  async patients(query: ReportQuery = {}, signal?: AbortSignal): Promise<PatientReport> {
    const data = record(await request<unknown>(`/reports/patients${rangeParams(query, true)}`, { signal }))
    const snapshot = record(data.snapshot), summary = record(data.summary)
    return {
      ...generated(data), snapshot: { activePatients: count(snapshot.activePatients), archivedPatients: count(snapshot.archivedPatients) },
      summary: { registrationsInRange: count(summary.registrationsInRange) },
      series: rows(data.series, (row) => ({ period: period(row.period), registrations: count(row.registrations) })),
    }
  },
  async admissions(query: ReportQuery = {}, signal?: AbortSignal): Promise<AdmissionReport> {
    const data = record(await request<unknown>(`/reports/admissions${rangeParams(query, true)}`, { signal }))
    const snapshot = record(data.snapshot), summary = record(data.summary)
    return {
      ...generated(data), snapshot: { currentAdmissions: count(snapshot.currentAdmissions) },
      summary: { admissionsInRange: count(summary.admissionsInRange), dischargesInRange: count(summary.dischargesInRange) },
      series: rows(data.series, (row) => ({ period: period(row.period), admissions: count(row.admissions), discharges: count(row.discharges) })),
    }
  },
}
