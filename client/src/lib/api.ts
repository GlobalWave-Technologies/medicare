import { request, mutation } from '../api/client'
export { ApiError } from '../api/client'
export { authApi } from '../api/auth'
export type { BackendRole, StaffUser } from '../api/auth'
/* =========================================================
   PATIENTS
   ========================================================= */

export type Patient = {
  id: string
  patientNumber: string
  firstName: string
  middleName: string | null
  lastName: string
  dateOfBirth: string | null
  phone: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export type PatientPagination = {
  page: number
  limit: number
  total: number
  totalPages: number
}

export type CreatePatientInput = {
  firstName: string
  middleName?: string | null
  lastName: string
  dateOfBirth?: string | null
  phone?: string | null
}

/* =========================================================
   APPOINTMENTS
   ========================================================= */

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

export const patientsApi = {
  list(options?: {
    page?: number
    limit?: number
    search?: string
    archived?:
      | 'false'
      | 'true'
      | 'all'
  }) {
    const params =
      new URLSearchParams()

    params.set(
      'page',
      String(options?.page ?? 1),
    )

    params.set(
      'limit',
      String(options?.limit ?? 10),
    )

    params.set(
      'archived',
      options?.archived ??
        'false',
    )

    if (
      options?.search?.trim()
    ) {
      params.set(
        'search',
        options.search.trim(),
      )
    }

    return request<{
      items: Patient[]
      pagination: PatientPagination
    }>(
      `/patients?${params.toString()}`,
    )
  },

  get(id: string) {
    return request<{
      patient: Patient
    }>(
      `/patients/${encodeURIComponent(
        id,
      )}`,
    )
  },

  create(
    input: CreatePatientInput,
  ) {
    return mutation<{
      patient: Patient
    }>('/patients', {
      method: 'POST',

      body:
        JSON.stringify(input),
    })
  },

  update(
    id: string,
    input:
      Partial<CreatePatientInput>,
  ) {
    return mutation<{
      patient: Patient
    }>(
      `/patients/${encodeURIComponent(
        id,
      )}`,
      {
        method: 'PATCH',

        body:
          JSON.stringify(input),
      },
    )
  },

  archive(id: string) {
    return mutation<{
      patient: Patient
    }>(
      `/patients/${encodeURIComponent(
        id,
      )}/archive`,
      {
        method: 'POST',

        body:
          JSON.stringify({}),
      },
    )
  },

  reactivate(id: string) {
    return mutation<{
      patient: Patient
    }>(
      `/patients/${encodeURIComponent(
        id,
      )}/reactivate`,
      {
        method: 'POST',

        body:
          JSON.stringify({}),
      },
    )
  },
}

/* =========================================================
   APPOINTMENTS
   ========================================================= */

export const appointmentsApi = {
  list(options?: {
    page?: number
    limit?: number
    status?: AppointmentStatus
    type?: AppointmentType
    patientId?: string
    clinicianId?: string
    dateFrom?: string
    dateTo?: string
    search?: string
  }) {
    const params =
      new URLSearchParams()

    params.set(
      'page',
      String(options?.page ?? 1),
    )

    params.set(
      'limit',
      String(options?.limit ?? 20),
    )

    if (options?.status) {
      params.set(
        'status',
        options.status,
      )
    }

    if (options?.type) {
      params.set(
        'type',
        options.type,
      )
    }

    if (options?.patientId) {
      params.set(
        'patientId',
        options.patientId,
      )
    }

    if (options?.clinicianId) {
      params.set(
        'clinicianId',
        options.clinicianId,
      )
    }

    if (options?.dateFrom) {
      params.set(
        'dateFrom',
        options.dateFrom,
      )
    }

    if (options?.dateTo) {
      params.set(
        'dateTo',
        options.dateTo,
      )
    }

    if (
      options?.search?.trim()
    ) {
      params.set(
        'search',
        options.search.trim(),
      )
    }

    return request<{
      items: Appointment[]
      pagination:
        AppointmentPagination
    }>(
      `/appointments?${params.toString()}`,
    )
  },

  get(id: string) {
    return request<{
      appointment: Appointment
    }>(
      `/appointments/${encodeURIComponent(
        id,
      )}`,
    )
  },

  clinicians() {
    return request<{
      clinicians:
        AppointmentClinician[]
    }>(
      '/appointments/clinicians',
    )
  },

  create(
    input:
      CreateAppointmentInput,
  ) {
    return mutation<{
      appointment: Appointment
    }>('/appointments', {
      method: 'POST',

      body:
        JSON.stringify(input),
    })
  },

  update(
    id: string,
    input:
      UpdateAppointmentInput,
  ) {
    return mutation<{
      appointment: Appointment
    }>(
      `/appointments/${encodeURIComponent(
        id,
      )}`,
      {
        method: 'PATCH',

        body:
          JSON.stringify(input),
      },
    )
  },

  changeStatus(
    id: string,
    status:
      AppointmentStatusUpdate,
  ) {
    return mutation<{
      appointment: Appointment
    }>(
      `/appointments/${encodeURIComponent(
        id,
      )}/status`,
      {
        method: 'PATCH',

        body:
          JSON.stringify({
            status,
          }),
      },
    )
  },

  cancel(
    id: string,
    reason?: string | null,
  ) {
    return mutation<{
      appointment: Appointment
    }>(
      `/appointments/${encodeURIComponent(
        id,
      )}/cancel`,
      {
        method: 'POST',

        body:
          JSON.stringify({
            reason:
              reason?.trim() ||
              null,
          }),
      },
    )
  },
}