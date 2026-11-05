import { ApiError, mutation, request } from './client'
import type { AppointmentPatient, AppointmentClinician, AppointmentPagination } from './appointments'

export type EncounterStatus = 'DRAFT' | 'REVIEWED' | 'VOIDED'
export type ComplaintInput = { description: string }
export type DiagnosisInput = { description: string; code?: string | null; notes?: string | null }
export type EncounterSummary = {
  id: string; reference: string; status: EncounterStatus; occurredAt: string; reviewedAt: string | null; createdAt: string
  patient: AppointmentPatient; clinician: AppointmentClinician | null; author: AppointmentClinician
  appointment: { id: string; reference: string } | null
  diagnoses: { id: string; description: string; code: string | null }[]
}
export type Encounter = Omit<EncounterSummary, 'diagnoses'> & {
  roomLabel: string | null; historySummary: string | null; clinicalNotes: string | null; treatmentPlan: string | null
  followUpAt: string | null; updatedAt: string; voidedAt: string | null; voidReason: string | null
  complaints: { id: string; description: string; createdAt: string }[]
  diagnoses: { id: string; description: string; code: string | null; notes: string | null; createdAt: string }[]
  amendments: { id: string; reason: string; content: string; createdAt: string; author: AppointmentClinician }[]
}
export type DraftInput = {
  occurredAt?: string; roomLabel?: string | null; historySummary?: string | null; clinicalNotes?: string | null
  treatmentPlan?: string | null; followUpAt?: string | null; complaints?: ComplaintInput[]; diagnoses?: DiagnosisInput[]
}
export type CreateEncounterInput = DraftInput & { patientId: string; appointmentId?: string | null }
export type AmendmentInput = { reason: string; content: string }
export type EncounterQuery = { page?: number; limit?: number; patientId?: string; clinicianId?: string; appointmentId?: string; status?: EncounterStatus; dateFrom?: string; dateTo?: string; search?: string }
export type EncounterPage = { items: EncounterSummary[]; pagination: AppointmentPagination }
type Result = { encounter: Encounter }
const path = (id: string) => `/encounters/${encodeURIComponent(id)}`
function parameters(query: EncounterQuery, history: boolean) {
  const result = new URLSearchParams({ page: String(query.page ?? 1), limit: String(query.limit ?? 20) })
  for (const key of ['patientId', 'clinicianId', 'appointmentId', 'status', 'dateFrom', 'dateTo', 'search'] as const) {
    if (history && key === 'patientId') continue
    const value = query[key]?.trim()
    if (value) result.set(key, value)
  }
  return result
}
function editable(input: DraftInput): DraftInput {
  const result: DraftInput = {}
  for (const key of ['occurredAt', 'roomLabel', 'historySummary', 'clinicalNotes', 'treatmentPlan', 'followUpAt'] as const) {
    if (input[key] !== undefined) Object.assign(result, { [key]: input[key] })
  }
  if (input.complaints !== undefined) result.complaints = input.complaints.map(({ description }) => ({ description }))
  if (input.diagnoses !== undefined) result.diagnoses = input.diagnoses.map(({ description, code, notes }) => ({ description, ...(code !== undefined ? { code } : {}), ...(notes !== undefined ? { notes } : {}) }))
  return result
}
export const encountersApi = {
  list: (query: EncounterQuery = {}, signal?: AbortSignal) => request<EncounterPage>(`/encounters?${parameters(query, false)}`, { signal }),
  history: (patientId: string, query: Omit<EncounterQuery, 'patientId'> = {}, signal?: AbortSignal) => request<EncounterPage>(`/patients/${encodeURIComponent(patientId)}/encounters?${parameters(query, true)}`, { signal }),
  get: (id: string, signal?: AbortSignal) => request<Result>(path(id), { signal }),
  create: (input: CreateEncounterInput, idempotencyKey?: string) => mutation<Result>('/encounters', { method: 'POST', body: JSON.stringify({ ...editable(input), patientId: input.patientId, ...(input.appointmentId !== undefined ? { appointmentId: input.appointmentId } : {}) }) }, { idempotencyKey }),
  // Requiring the current DTO prevents known finalized/voided records from being
  // sent through this helper. The backend rechecks current status and authorship.
  updateDraft: (encounter: Pick<Encounter, 'id' | 'status'>, input: DraftInput): Promise<Result> => {
    if (encounter.status !== 'DRAFT') return Promise.reject(new ApiError(409, 'Clinical record is not editable.', 'ENCOUNTER_NOT_EDITABLE'))
    return mutation<Result>(path(encounter.id), { method: 'PATCH', body: JSON.stringify(editable(input)) })
  },
  finalize: (id: string) => mutation<Result>(`${path(id)}/finalize`, { method: 'POST', body: '{}' }),
  amend: (id: string, input: AmendmentInput) => mutation<Result>(`${path(id)}/amend`, { method: 'POST', body: JSON.stringify({ reason: input.reason, content: input.content }) }),
}
