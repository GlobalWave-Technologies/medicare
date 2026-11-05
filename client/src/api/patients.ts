import { mutation, request } from './client'

export type Patient = {
  id: string; patientNumber: string; firstName: string; middleName: string | null
  lastName: string; dateOfBirth: string | null; phone: string | null
  archivedAt: string | null; createdAt: string; updatedAt: string
}
export type PatientPagination = { page: number; limit: number; total: number; totalPages: number }
export type CreatePatientInput = {
  firstName: string; lastName: string; middleName?: string | null
  dateOfBirth?: string | null; phone?: string | null
}
export type PatientQuery = { page?: number; limit?: number; search?: string; archived?: 'false' | 'true' | 'all' }
export type PatientPage = { items: Patient[]; pagination: PatientPagination }
type PatientResult = { patient: Patient }
const path = (id: string) => `/patients/${encodeURIComponent(id)}`

// Select only editable fields, including when a caller supplies a full DTO at runtime.
function editable(input: Partial<CreatePatientInput>) {
  const result: Partial<CreatePatientInput> = {}
  for (const key of ['firstName', 'middleName', 'lastName', 'dateOfBirth', 'phone'] as const) {
    const value = input[key]
    if (value !== undefined) Object.assign(result, { [key]: value })
  }
  return result
}
export const patientsApi = {
  list(options: PatientQuery = {}, signal?: AbortSignal) {
    const params = new URLSearchParams({ page: String(options.page ?? 1), limit: String(options.limit ?? 10), archived: options.archived ?? 'false' })
    if (options.search?.trim()) params.set('search', options.search.trim())
    return request<PatientPage>(`/patients?${params}`, { signal })
  },
  get: (id: string, signal?: AbortSignal) => request<PatientResult>(path(id), { signal }),
  create: (input: CreatePatientInput, idempotencyKey?: string) => mutation<PatientResult>('/patients', { method: 'POST', body: JSON.stringify(editable(input)) }, { idempotencyKey }),
  update: (id: string, input: Partial<CreatePatientInput>) => mutation<PatientResult>(path(id), { method: 'PATCH', body: JSON.stringify(editable(input)) }),
  archive: (id: string) => mutation<PatientResult>(`${path(id)}/archive`, { method: 'POST', body: '{}' }),
  reactivate: (id: string) => mutation<PatientResult>(`${path(id)}/reactivate`, { method: 'POST', body: '{}' }),
}
