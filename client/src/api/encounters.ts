import { ApiError, mutation, request } from './client'
import type { Pagination, PatientSummary, StaffSummary } from './common'

export type EncounterStatus = 'DRAFT' | 'REVIEWED' | 'VOIDED'
export type ComplaintInput = { description: string }
export type DiagnosisInput = { description: string; code?: string | null; notes?: string | null }
// A new order names a catalog medicine; the server copies its name. Dose, route and frequency are required.
export type MedicationInput = { medicationId: string; strength?: string | null; dose: string; route: string; frequency: string; duration?: string | null; notes?: string | null }
// "medicine" is the name as prescribed; medicationId is null only for orders made before the catalog.
export type Medication = { id: string; medicationId: string | null; medicine: string; strength: string | null; dose: string | null; route: string | null
  frequency: string | null; duration: string | null; notes: string | null; createdAt: string }
export type EncounterSummary = {
  id: string; reference: string; status: EncounterStatus; occurredAt: string; reviewedAt: string | null; createdAt: string
  patient: PatientSummary; clinician: StaffSummary | null; author: StaffSummary
  admission: { id: string; admissionNumber: string } | null
  // Only records made before appointments were retired carry one.
  appointment: { id: string; reference: string } | null
  diagnoses: { id: string; description: string; code: string | null }[]
}
export type Encounter = Omit<EncounterSummary, 'diagnoses'> & {
  roomLabel: string | null; historySummary: string | null; clinicalNotes: string | null; treatmentPlan: string | null
  followUpAt: string | null; updatedAt: string; voidedAt: string | null; voidReason: string | null
  complaints: { id: string; description: string; createdAt: string }[]
  diagnoses: { id: string; description: string; code: string | null; notes: string | null; createdAt: string }[]
  medications: Medication[]
  amendments: { id: string; reason: string; content: string; createdAt: string; author: StaffSummary }[]
}
export type HistoryAdmission = { id: string; admissionNumber: string; status: 'ADMITTED' | 'DISCHARGED'; admittedAt: string; dischargedAt: string | null }
export type MedicationHistoryItem = Medication & {
  encounter: { id: string; reference: string; status: EncounterStatus; occurredAt: string; reviewedAt: string | null; clinician: StaffSummary | null; admission: HistoryAdmission | null }
}
// One stay's orders, or every order outside one stay (including records from before admissions).
export type MedicationHistoryQuery = { page?: number; limit?: number; admissionId?: string; excludeAdmissionId?: string }
export type DraftInput = {
  occurredAt?: string; roomLabel?: string | null; historySummary?: string | null; clinicalNotes?: string | null
  treatmentPlan?: string | null; followUpAt?: string | null; complaints?: ComplaintInput[]; diagnoses?: DiagnosisInput[]; medications?: MedicationInput[]
}
// A new clinical record is opened on a current admission; the server takes the patient from it.
export type CreateEncounterInput = DraftInput & { admissionId: string }
export type AmendmentInput = { reason: string; content: string }
export type EncounterQuery = { page?: number; limit?: number; patientId?: string; clinicianId?: string; admissionId?: string; status?: EncounterStatus; dateFrom?: string; dateTo?: string; search?: string }
export type EncounterPage = { items: EncounterSummary[]; pagination: Pagination }
export type MedicationHistoryPage = { items: MedicationHistoryItem[]; pagination: Pagination }
type Result = { encounter: Encounter }
const path = (id: string) => `/encounters/${encodeURIComponent(id)}`
function parameters(query: EncounterQuery, history: boolean) {
  const result = new URLSearchParams({ page: String(query.page ?? 1), limit: String(query.limit ?? 20) })
  for (const key of ['patientId', 'clinicianId', 'admissionId', 'status', 'dateFrom', 'dateTo', 'search'] as const) {
    if (history && key === 'patientId') continue
    const value = query[key]?.trim()
    if (value) result.set(key, value)
  }
  return result
}
const medicationFields = ['medicationId', 'strength', 'dose', 'route', 'frequency', 'duration', 'notes'] as const
function editable(input: DraftInput): DraftInput {
  const result: DraftInput = {}
  for (const key of ['occurredAt', 'roomLabel', 'historySummary', 'clinicalNotes', 'treatmentPlan', 'followUpAt'] as const) {
    if (input[key] !== undefined) Object.assign(result, { [key]: input[key] })
  }
  if (input.complaints !== undefined) result.complaints = input.complaints.map(({ description }) => ({ description }))
  if (input.diagnoses !== undefined) result.diagnoses = input.diagnoses.map(({ description, code, notes }) => ({ description, ...(code !== undefined ? { code } : {}), ...(notes !== undefined ? { notes } : {}) }))
  if (input.medications !== undefined) result.medications = input.medications.map((order) => Object.fromEntries(medicationFields
    .filter((key) => order[key] !== undefined).map((key) => [key, order[key]])) as MedicationInput)
  return result
}
export const encountersApi = {
  list: (query: EncounterQuery = {}, signal?: AbortSignal) => request<EncounterPage>(`/encounters?${parameters(query, false)}`, { signal }),
  history: (patientId: string, query: Omit<EncounterQuery, 'patientId'> = {}, signal?: AbortSignal) => request<EncounterPage>(`/patients/${encodeURIComponent(patientId)}/encounters?${parameters(query, true)}`, { signal }),
  medications: (patientId: string, query: MedicationHistoryQuery = {}, signal?: AbortSignal) => {
    const parameters = new URLSearchParams({ page: String(query.page ?? 1), limit: String(query.limit ?? 20) })
    if (query.admissionId) parameters.set('admissionId', query.admissionId)
    else if (query.excludeAdmissionId) parameters.set('excludeAdmissionId', query.excludeAdmissionId)
    return request<MedicationHistoryPage>(`/patients/${encodeURIComponent(patientId)}/medications?${parameters}`, { signal })
  },
  get: (id: string, signal?: AbortSignal) => request<Result>(path(id), { signal }),
  create: (input: CreateEncounterInput, idempotencyKey?: string) => mutation<Result>('/encounters', { method: 'POST', body: JSON.stringify({ ...editable(input), admissionId: input.admissionId }) }, { idempotencyKey }),
  // Requiring the current DTO prevents known finalized/voided records from being
  // sent through this helper. The backend rechecks current status and authorship.
  updateDraft: (encounter: Pick<Encounter, 'id' | 'status'>, input: DraftInput): Promise<Result> => {
    if (encounter.status !== 'DRAFT') return Promise.reject(new ApiError(409, 'Clinical record is not editable.', 'ENCOUNTER_NOT_EDITABLE'))
    return mutation<Result>(path(encounter.id), { method: 'PATCH', body: JSON.stringify(editable(input)) })
  },
  finalize: (id: string) => mutation<Result>(`${path(id)}/finalize`, { method: 'POST', body: '{}' }),
  amend: (id: string, input: AmendmentInput) => mutation<Result>(`${path(id)}/amend`, { method: 'POST', body: JSON.stringify({ reason: input.reason, content: input.content }) }),
}
