import { ApiError, isRecord, request } from './client'

export type ReportBucket = 'day' | 'week' | 'month'
export type ReportRange = { from: string; to: string; bucket: ReportBucket; timezone: 'UTC' }
export type ReportQuery = { from?: string; to?: string; bucket?: ReportBucket }
export type AppointmentSummary = {
  totalAppointments: number; scheduled: number; confirmed: number; checkedIn: number; completed: number
  cancelled: number; noShow: number; cancellationRate: number; noShowRate: number
}
export type ClinicalSummary = { encountersInRange: number; finalizedEncountersInRange: number; amendmentsInRange: number }
type Generated = { generatedAt: string; range: ReportRange }
export type PatientReport = Generated & {
  snapshot: { activePatients: number; archivedPatients: number }
  summary: { registrationsInRange: number }
  series: { period: string; registrations: number }[]
}
export type AppointmentReport = Generated & { summary: AppointmentSummary; series: (AppointmentSummary & { period: string })[] }
export type ClinicalActivityReport = Generated & {
  snapshot: { currentAuthoredDrafts: number }
  summary: ClinicalSummary
  series: { period: string; encounters: number; finalized: number; amendments: number }[]
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
function rate(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) throw invalidResponse()
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
// Every aggregate is rebuilt from its documented fields only.
export function appointmentSummary(value: unknown): AppointmentSummary {
  const data = record(value)
  return {
    totalAppointments: count(data.totalAppointments), scheduled: count(data.scheduled), confirmed: count(data.confirmed),
    checkedIn: count(data.checkedIn), completed: count(data.completed), cancelled: count(data.cancelled), noShow: count(data.noShow),
    cancellationRate: rate(data.cancellationRate), noShowRate: rate(data.noShowRate),
  }
}
export function clinicalSummary(value: unknown): ClinicalSummary {
  const data = record(value)
  return { encountersInRange: count(data.encountersInRange), finalizedEncountersInRange: count(data.finalizedEncountersInRange), amendmentsInRange: count(data.amendmentsInRange) }
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
  async appointments(query: ReportQuery = {}, signal?: AbortSignal): Promise<AppointmentReport> {
    const data = record(await request<unknown>(`/reports/appointments${rangeParams(query, true)}`, { signal }))
    return { ...generated(data), summary: appointmentSummary(data.summary), series: rows(data.series, (row) => ({ period: period(row.period), ...appointmentSummary(row) })) }
  },
  async clinicalActivity(query: ReportQuery = {}, signal?: AbortSignal): Promise<ClinicalActivityReport> {
    const data = record(await request<unknown>(`/reports/clinical-activity${rangeParams(query, true)}`, { signal }))
    return {
      ...generated(data), snapshot: { currentAuthoredDrafts: count(record(data.snapshot).currentAuthoredDrafts) }, summary: clinicalSummary(data.summary),
      series: rows(data.series, (row) => ({ period: period(row.period), encounters: count(row.encounters), finalized: count(row.finalized), amendments: count(row.amendments) })),
    }
  },
}
