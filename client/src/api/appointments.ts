import { request, mutation } from './client'

export type AppointmentQuery = {
  page?: number; limit?: number; status?: AppointmentStatus; type?: AppointmentType
  patientId?: string; clinicianId?: string; dateFrom?: string; dateTo?: string; search?: string
}
export type AppointmentPage = { items: Appointment[]; pagination: AppointmentPagination }
type Result = { appointment: Appointment }
const path = (id: string) => `/appointments/${encodeURIComponent(id)}`
function editable(input: UpdateAppointmentInput): UpdateAppointmentInput {
  const result: UpdateAppointmentInput = {}
  for (const key of ['clinicianId', 'scheduledStart', 'scheduledEnd', 'type', 'reason', 'notes'] as const) {
    if (input[key] !== undefined) Object.assign(result, { [key]: input[key] })
  }
  return result
}
export const appointmentsApi = {
  list(options: AppointmentQuery = {}, signal?: AbortSignal) {
    const params = new URLSearchParams({ page: String(options.page ?? 1), limit: String(options.limit ?? 20) })
    for (const key of ['status', 'type', 'patientId', 'clinicianId', 'dateFrom', 'dateTo', 'search'] as const) {
      const value = options[key]?.trim()
      if (value) params.set(key, value)
    }
    return request<AppointmentPage>(`/appointments?${params}`, { signal })
  },
  get: (id: string, signal?: AbortSignal) => request<Result>(path(id), { signal }),
  // This dedicated, permission-checked lookup returns active doctors only.
  clinicians: (signal?: AbortSignal) => request<{ clinicians: AppointmentClinician[] }>('/appointments/clinicians', { signal }),
  create: (input: CreateAppointmentInput) => mutation<Result>('/appointments', { method: 'POST', body: JSON.stringify({ ...editable(input), patientId: input.patientId }) }),
  update: (id: string, input: UpdateAppointmentInput) => mutation<Result>(path(id), { method: 'PATCH', body: JSON.stringify(editable(input)) }),
  changeStatus: (id: string, status: AppointmentStatusUpdate) => mutation<Result>(`${path(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  cancel: (id: string, reason?: string | null) => mutation<Result>(`${path(id)}/cancel`, { method: 'POST', body: JSON.stringify({ reason: reason?.trim() || null }) }),
}
export type AppointmentStatus =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'

export type AppointmentType =
  | 'CONSULTATION'
  | 'FOLLOW_UP'
  | 'ROUTINE_CHECKUP'
  | 'EMERGENCY_REVIEW'

export type AppointmentPatient = {
  id: string
  patientNumber: string
  firstName: string
  middleName: string | null
  lastName: string
}

export type AppointmentClinician = {
  id: string
  staffNumber: string
  firstName: string
  lastName: string
}

export type Appointment = {
  id: string
  reference: string

  patient: AppointmentPatient

  clinician: AppointmentClinician | null

  scheduledStart: string
  scheduledEnd: string

  type: AppointmentType
  status: AppointmentStatus

  reason: string | null
  notes: string | null

  cancelledAt: string | null
  cancellationReason: string | null

  createdAt: string
  updatedAt: string
}

export type AppointmentPagination = {
  page: number
  limit: number
  total: number
  totalPages: number
}

export type CreateAppointmentInput = {
  patientId: string
  clinicianId: string
  scheduledStart: string
  scheduledEnd: string
  type: AppointmentType
  reason?: string | null
  notes?: string | null
}

export type UpdateAppointmentInput = {
  clinicianId?: string
  scheduledStart?: string
  scheduledEnd?: string
  type?: AppointmentType
  reason?: string | null
  notes?: string | null
}

export type AppointmentStatusUpdate =
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'COMPLETED'
  | 'NO_SHOW'


