import { mutation, request } from './client'
import type { Pagination, PatientSummary, StaffSummary } from './common'

export type AdmissionStatus = 'ADMITTED' | 'DISCHARGED'
export type AdmissionSummary = {
  id: string; admissionNumber: string; status: AdmissionStatus; roomNumber: string; admittedAt: string; dischargedAt: string | null
  patient: PatientSummary; admittedBy: StaffSummary; dischargedBy: StaffSummary | null
}
export type RoomAssignment = { id: string; roomNumber: string; note: string | null; assignedAt: string; endedAt: string | null; assignedBy: StaffSummary }
// dischargeNotes is present only for clinical readers (Medical Officers).
export type Admission = AdmissionSummary & { createdAt: string; updatedAt: string; rooms: RoomAssignment[]; dischargeNotes?: string | null }
export type AdmissionPage = { items: AdmissionSummary[]; pagination: Pagination }
export type AdmissionQuery = { page?: number; limit?: number; status?: AdmissionStatus; patientId?: string; search?: string }
export type AdmitInput = { patientId: string; roomNumber: string; admittedAt?: string }
export type RoomChangeInput = { roomNumber: string; note?: string | null }
export type DischargeInput = { dischargedAt?: string; dischargeNotes?: string | null }
type Result = { admission: Admission }
const path = (id: string) => `/admissions/${encodeURIComponent(id)}`

export const admissionsApi = {
  // `automatic` marks a page's own timed refresh, which does not count as the person's activity.
  list(query: AdmissionQuery = {}, signal?: AbortSignal, automatic = false) {
    const params = new URLSearchParams({ page: String(query.page ?? 1), limit: String(query.limit ?? 20) })
    if (query.status) params.set('status', query.status)
    if (query.patientId) params.set('patientId', query.patientId)
    if (query.search?.trim()) params.set('search', query.search.trim())
    return request<AdmissionPage>(`/admissions?${params}`, { signal, headers: automatic ? { 'X-Background-Refresh': '1' } : undefined })
  },
  get: (id: string, signal?: AbortSignal) => request<Result>(path(id), { signal }),
  // Only the documented fields are sent; an omitted time means "now" on the server.
  admit: (input: AdmitInput, idempotencyKey?: string) => mutation<Result>('/admissions', { method: 'POST',
    body: JSON.stringify({ patientId: input.patientId, roomNumber: input.roomNumber, ...(input.admittedAt ? { admittedAt: input.admittedAt } : {}) }) }, { idempotencyKey }),
  changeRoom: (id: string, input: RoomChangeInput) => mutation<Result>(`${path(id)}/room`, { method: 'POST',
    body: JSON.stringify({ roomNumber: input.roomNumber, ...(input.note !== undefined ? { note: input.note } : {}) }) }),
  discharge: (id: string, input: DischargeInput = {}) => mutation<Result>(`${path(id)}/discharge`, { method: 'POST',
    body: JSON.stringify({ ...(input.dischargedAt ? { dischargedAt: input.dischargedAt } : {}), ...(input.dischargeNotes !== undefined ? { dischargeNotes: input.dischargeNotes } : {}) }) }),
}
