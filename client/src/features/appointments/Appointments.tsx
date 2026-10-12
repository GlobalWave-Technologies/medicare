import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import {
  CalendarDays,
  ChevronDown,
  Clock3,
  Plus,
  Search,
  Stethoscope,
  UserRound,
  X,
} from 'lucide-react'
import {
  ApiError,
  appointmentsApi,
  patientsApi,
  type Appointment,
  type AppointmentClinician,
  type AppointmentPagination,
  type AppointmentStatus,
  type AppointmentType,
  type Patient,
} from '../../lib/api'
import { Pagination } from '../../components/ui/Pagination'
import './appointments.css'

/* =========================================================
   CONSTANTS
   ========================================================= */

const appointmentTypeLabels: Record<AppointmentType, string> = {
  CONSULTATION: 'Consultation',
  FOLLOW_UP: 'Follow-up',
  ROUTINE_CHECKUP: 'Routine check-up',
  EMERGENCY_REVIEW: 'Emergency review',
}

const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Scheduled',
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'Checked in',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No show',
}

const emptyPagination: AppointmentPagination = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 0,
}

/* =========================================================
   HELPERS
   ========================================================= */

function patientName(
  patient: Appointment['patient'],
) {
  return [
    patient.firstName,
    patient.middleName,
    patient.lastName,
  ]
    .filter(Boolean)
    .join(' ')
}

function patientOptionName(patient: Patient) {
  return [
    patient.firstName,
    patient.middleName,
    patient.lastName,
  ]
    .filter(Boolean)
    .join(' ')
}

function clinicianName(
  clinician: AppointmentClinician | null,
) {
  if (!clinician) {
    return 'Not assigned'
  }

  return `${clinician.firstName} ${clinician.lastName}`
}

function formatAppointmentDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function formatAppointmentTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function getWeekRange() {
  const now = new Date()

  const start = new Date(now)
  const day = start.getDay()

  const daysSinceMonday =
    day === 0
      ? 6
      : day - 1

  start.setDate(
    start.getDate() - daysSinceMonday,
  )

  start.setHours(
    0,
    0,
    0,
    0,
  )

  const end = new Date(start)

  end.setDate(
    start.getDate() + 6,
  )

  end.setHours(
    23,
    59,
    59,
    999,
  )

  return {
    start,
    end,
  }
}

function getTodayInputValue() {
  const now = new Date()

  const year =
    now.getFullYear()

  const month =
    String(
      now.getMonth() + 1,
    ).padStart(2, '0')

  const day =
    String(
      now.getDate(),
    ).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getDefaultTime() {
  const now = new Date()

  now.setMinutes(
    Math.ceil(
      now.getMinutes() / 15,
    ) * 15,
  )

  if (
    now.getMinutes() === 60
  ) {
    now.setHours(
      now.getHours() + 1,
      0,
      0,
      0,
    )
  }

  return `${String(
    now.getHours(),
  ).padStart(2, '0')}:${String(
    now.getMinutes(),
  ).padStart(2, '0')}`
}

/* =========================================================
   APPOINTMENTS PAGE
   ========================================================= */

type AppointmentsProps = {
  onBook: () => void
  refreshKey?: number
}

export function Appointments({
  onBook,
  refreshKey = 0,
}: AppointmentsProps) {
  const [appointments, setAppointments] =
    useState<Appointment[]>([])

  const [pagination, setPagination] =
    useState<AppointmentPagination>(
      emptyPagination,
    )

  const [query, setQuery] =
    useState('')

  const [
    currentPage,
    setCurrentPage,
  ] = useState(1)

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState<
      AppointmentStatus | ''
    >('')

  const [
    viewMode,
    setViewMode,
  ] =
    useState<
      'week' | 'all'
    >('week')

  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState('')

  const pageSize = 10

  const weekRange =
    useMemo(
      () => getWeekRange(),
      [],
    )

  useEffect(() => {
    let active = true

    const timer =
      window.setTimeout(
        async () => {
          setLoading(true)
          setError('')

          try {
            const result =
              await appointmentsApi.list({
                page: currentPage,
                limit: pageSize,

                search:
                  query.trim() ||
                  undefined,

                status:
                  statusFilter ||
                  undefined,

                dateFrom:
                  viewMode === 'week'
                    ? weekRange.start.toISOString()
                    : undefined,

                dateTo:
                  viewMode === 'week'
                    ? weekRange.end.toISOString()
                    : undefined,
              })

            if (!active) return

            setAppointments(
              result.items,
            )

            setPagination(
              result.pagination,
            )
          } catch (error) {
            if (!active) return

            setAppointments([])
            setPagination(
              emptyPagination,
            )

            if (
              error instanceof ApiError
            ) {
              if (
                error.status === 401
              ) {
                setError(
                  'Your session has expired. Please sign in again.',
                )
              } else if (
                error.status === 403
              ) {
                setError(
                  'You do not have permission to view appointments.',
                )
              } else {
                setError(
                  error.message,
                )
              }
            } else {
              setError(
                'Unable to load appointments. Please check the server connection.',
              )
            }
          } finally {
            if (active) {
              setLoading(false)
            }
          }
        },
        query ? 300 : 0,
      )

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [
    currentPage,
    query,
    statusFilter,
    viewMode,
    refreshKey,
    weekRange,
  ])

  const pageCount =
    Math.max(
      1,
      pagination.totalPages || 1,
    )

  return (
    <section className="panel page-panel appointments-panel">
      <div className="panel-header appointments-header">
        <div>
          <p className="appointments-kicker">
            SCHEDULE MANAGEMENT
          </p>

          <h2>
            Appointment directory
          </h2>

          <p>
            {pagination.total.toLocaleString()}{' '}
            appointment
            {pagination.total === 1
              ? ''
              : 's'}{' '}
            in this view
          </p>
        </div>

        <button
          className="button button-primary appointments-book-button"
          type="button"
          onClick={onBook}
        >
          <Plus size={17} />
          Book appointment
        </button>
      </div>

      <div className="appointments-summary">
        <div className="appointments-summary-card">
          <CalendarDays size={18} />

          <div>
            <strong>
              {viewMode === 'week'
                ? 'This week'
                : 'All appointments'}
            </strong>

            <small>
              {viewMode === 'week'
                ? `${formatAppointmentDate(
                    weekRange.start.toISOString(),
                  )} – ${formatAppointmentDate(
                    weekRange.end.toISOString(),
                  )}`
                : 'Showing the complete appointment schedule.'}
            </small>
          </div>
        </div>

        <div className="appointments-summary-card">
          <Clock3 size={18} />

          <div>
            <strong>
              Schedule protected
            </strong>

            <small>
              Conflicting clinician appointment times are blocked automatically.
            </small>
          </div>
        </div>
      </div>

      <div className="appointments-toolbar">
        <label className="appointments-search">
          <Search size={17} />

          <input
            value={query}
            onChange={(event) => {
              setQuery(
                event.target.value,
              )

              setCurrentPage(1)
            }}
            placeholder="Search patient name, number or appointment reference..."
          />
        </label>

        <div className="appointments-filter">
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(
                event.target
                  .value as
                  | AppointmentStatus
                  | '',
              )

              setCurrentPage(1)
            }}
            aria-label="Appointment status"
          >
            <option value="">
              All statuses
            </option>

            <option value="SCHEDULED">
              Scheduled
            </option>

            <option value="CONFIRMED">
              Confirmed
            </option>

            <option value="CHECKED_IN">
              Checked in
            </option>

            <option value="COMPLETED">
              Completed
            </option>

            <option value="CANCELLED">
              Cancelled
            </option>

            <option value="NO_SHOW">
              No show
            </option>
          </select>

          <ChevronDown size={15} />
        </div>

        <div className="appointments-filter">
          <select
            value={viewMode}
            onChange={(event) => {
              setViewMode(
                event.target
                  .value as
                  | 'week'
                  | 'all',
              )

              setCurrentPage(1)
            }}
            aria-label="Appointment date range"
          >
            <option value="week">
              Week view
            </option>

            <option value="all">
              All dates
            </option>
          </select>

          <ChevronDown size={15} />
        </div>
      </div>

      {error && (
        <div
          className="appointments-state appointments-state-error"
          role="alert"
        >
          <strong>
            Unable to load appointments
          </strong>

          <span>{error}</span>
        </div>
      )}

      <div className="appointments-table">
        <div className="appointments-row appointments-table-head">
          <span>
            Date & time
          </span>

          <span>
            Patient
          </span>

          <span>
            Clinician
          </span>

          <span>
            Type
          </span>

          <span>
            Status
          </span>
        </div>

        {loading ? (
          <div className="appointments-state">
            <CalendarDays size={26} />

            <strong>
              Loading appointments…
            </strong>

            <span>
              Retrieving the latest hospital schedule.
            </span>
          </div>
        ) : appointments.length === 0 ? (
          <div className="appointments-state">
            <CalendarDays size={28} />

            <strong>
              No appointments found
            </strong>

            <span>
              {query
                ? 'Try another patient name, number or appointment reference.'
                : viewMode === 'week'
                  ? 'There are no appointments scheduled for this week.'
                  : 'No appointments have been scheduled yet.'}
            </span>

            <button
              type="button"
              className="button button-primary"
              onClick={onBook}
            >
              <Plus size={16} />
              Book appointment
            </button>
          </div>
        ) : (
          appointments.map(
            (appointment) => (
              <div
                className="appointments-row"
                key={
                  appointment.id
                }
              >
                <div className="appointment-date-cell">
                  <strong>
                    {formatAppointmentDate(
                      appointment.scheduledStart,
                    )}
                  </strong>

                  <span>
                    {formatAppointmentTime(
                      appointment.scheduledStart,
                    )}
                    {' – '}
                    {formatAppointmentTime(
                      appointment.scheduledEnd,
                    )}
                  </span>
                </div>

                <div className="appointment-person-cell">
                  <div className="avatar avatar-blue">
                    {`${appointment.patient.firstName[0] ?? ''}${appointment.patient.lastName[0] ?? ''}`.toUpperCase()}
                  </div>

                  <div>
                    <strong>
                      {patientName(
                        appointment.patient,
                      )}
                    </strong>

                    <span>
                      {
                        appointment
                          .patient
                          .patientNumber
                      }
                    </span>
                  </div>
                </div>

                <div className="appointment-clinician-cell">
                  <strong>
                    {clinicianName(
                      appointment.clinician,
                    )}
                  </strong>

                  <span>
                    {appointment
                      .clinician
                      ?.staffNumber ??
                      '—'}
                  </span>
                </div>

                <span data-label="Type">
                  {
                    appointmentTypeLabels[
                      appointment.type
                    ]
                  }
                </span>

                <span data-label="Status">
                  <em
                    className={`appointment-status appointment-status-${appointment.status.toLowerCase()}`}
                  >
                    {
                      appointmentStatusLabels[
                        appointment
                          .status
                      ]
                    }
                  </em>
                </span>
              </div>
            ),
          )
        )}
      </div>

      <Pagination
        currentPage={Math.max(
          1,
          pagination.page ||
            currentPage,
        )}
        pageCount={pageCount}
        total={pagination.total}
        pageSize={pageSize}
        onPageChange={
          setCurrentPage
        }
      />
    </section>
  )
}

/* =========================================================
   BOOK APPOINTMENT MODAL
   ========================================================= */

type AppointmentModalProps = {
  onClose: () => void

  onCreated?: (
    appointment: Appointment,
  ) => void
}

export function AppointmentModal({
  onClose,
  onCreated,
}: AppointmentModalProps) {
  const [patientQuery, setPatientQuery] =
    useState('')

  const [
    patientOptions,
    setPatientOptions,
  ] = useState<Patient[]>([])

  const [
    selectedPatientId,
    setSelectedPatientId,
  ] = useState('')

  const [
    clinicians,
    setClinicians,
  ] =
    useState<
      AppointmentClinician[]
    >([])

  const [
    clinicianId,
    setClinicianId,
  ] = useState('')

  const [
    appointmentDate,
    setAppointmentDate,
  ] = useState(
    getTodayInputValue(),
  )

  const [
    appointmentTime,
    setAppointmentTime,
  ] = useState(
    getDefaultTime(),
  )

  const [
    durationMinutes,
    setDurationMinutes,
  ] = useState('30')

  const [
    appointmentType,
    setAppointmentType,
  ] =
    useState<AppointmentType>(
      'CONSULTATION',
    )

  const [reason, setReason] =
    useState('')

  const [notes, setNotes] =
    useState('')

  const [
    loadingClinicians,
    setLoadingClinicians,
  ] = useState(true)

  const [
    loadingPatients,
    setLoadingPatients,
  ] = useState(false)

  const [saving, setSaving] =
    useState(false)

  const [error, setError] =
    useState('')

  useEffect(() => {
    let active = true

    appointmentsApi
      .clinicians()
      .then(
        ({
          clinicians,
        }) => {
          if (!active) return

          setClinicians(
            clinicians,
          )

          if (
            clinicians.length > 0
          ) {
            setClinicianId(
              clinicians[0].id,
            )
          }
        },
      )
      .catch((error) => {
        if (!active) return

        if (
          error instanceof ApiError
        ) {
          setError(
            error.message,
          )
        } else {
          setError(
            'Unable to load eligible clinicians.',
          )
        }
      })
      .finally(() => {
        if (active) {
          setLoadingClinicians(
            false,
          )
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    const timer =
      window.setTimeout(
        async () => {
          setLoadingPatients(
            true,
          )

          try {
            const result =
              await patientsApi.list({
                page: 1,
                limit: 20,
                archived:
                  'false',
                search:
                  patientQuery ||
                  undefined,
              })

            if (!active) return

            setPatientOptions(
              result.items,
            )
          } catch {
            if (!active) return

            setPatientOptions(
              [],
            )
          } finally {
            if (active) {
              setLoadingPatients(
                false,
              )
            }
          }
        },
        patientQuery ? 250 : 0,
      )

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [patientQuery])

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    if (saving) return

    setError('')

    if (!selectedPatientId) {
      setError(
        'Please select a patient.',
      )
      return
    }

    if (!clinicianId) {
      setError(
        'Please select an eligible clinician.',
      )
      return
    }

    if (
      !appointmentDate ||
      !appointmentTime
    ) {
      setError(
        'Please choose the appointment date and time.',
      )
      return
    }

    const start =
      new Date(
        `${appointmentDate}T${appointmentTime}`,
      )

    if (
      Number.isNaN(
        start.getTime(),
      )
    ) {
      setError(
        'Please choose a valid appointment date and time.',
      )
      return
    }

    const duration =
      Number(
        durationMinutes,
      )

    const end =
      new Date(
        start.getTime() +
          duration *
            60 *
            1000,
      )

    setSaving(true)

    try {
      const result =
        await appointmentsApi.create({
          patientId:
            selectedPatientId,

          clinicianId,

          scheduledStart:
            start.toISOString(),

          scheduledEnd:
            end.toISOString(),

          type:
            appointmentType,

          reason:
            reason.trim() ||
            null,

          notes:
            notes.trim() ||
            null,
        })

      onCreated?.(
        result.appointment,
      )

      onClose()
    } catch (error) {
      if (
        error instanceof ApiError
      ) {
        switch (error.code) {
          case 'APPOINTMENT_CONFLICT':
            setError(
              'That clinician already has an appointment during the selected time. Please choose another time.',
            )
            break

          case 'PATIENT_ARCHIVED':
            setError(
              'This patient has been archived and cannot be scheduled.',
            )
            break

          case 'CLINICIAN_NOT_ACTIVE':
            setError(
              'The selected clinician is no longer active.',
            )
            break

          case 'INVALID_CLINICIAN_ROLE':
          case 'CLINICIAN_NOT_FOUND':
            setError(
              'Please choose another eligible clinician.',
            )
            break

          case 'APPOINTMENT_IN_PAST':
            setError(
              'Appointments cannot be scheduled in the past.',
            )
            break

          case 'INVALID_APPOINTMENT_TIME':
            setError(
              'The appointment duration or schedule is invalid.',
            )
            break

          default:
            setError(
              error.message,
            )
        }
      } else {
        setError(
          'Unable to book the appointment. Please check the server connection.',
        )
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="modal-backdrop appointment-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="modal appointment-modal"
        onClick={(event) =>
          event.stopPropagation()
        }
      >
        <form
          onSubmit={
            handleSubmit
          }
        >
          <div className="modal-header appointment-modal-header">
            <div>
              <p className="eyebrow">
                APPOINTMENT BOOKING
              </p>

              <h2>
                Book a consultation
              </h2>

              <p className="appointment-modal-subtitle">
                Schedule an active patient with an eligible clinician.
              </p>
            </div>

            <button
              type="button"
              className="icon-btn appointment-modal-close"
              onClick={onClose}
              aria-label="Close appointment booking"
            >
              <X size={19} />
            </button>
          </div>

          <div className="appointment-form-section">
            <div className="appointment-form-section-title">
              <UserRound
                size={16}
              />

              <span>
                Patient
              </span>
            </div>

            <label className="appointment-field">
              Search patient

              <div className="appointment-input-icon">
                <Search
                  size={16}
                />

                <input
                  value={
                    patientQuery
                  }
                  onChange={(
                    event,
                  ) =>
                    setPatientQuery(
                      event
                        .target
                        .value,
                    )
                  }
                  placeholder="Search by patient name or number"
                />
              </div>
            </label>

            <label className="appointment-field">
              Select patient

              <select
                value={
                  selectedPatientId
                }
                onChange={(
                  event,
                ) =>
                  setSelectedPatientId(
                    event
                      .target
                      .value,
                  )
                }
                required
              >
                <option value="">
                  {loadingPatients
                    ? 'Loading patients...'
                    : 'Select active patient'}
                </option>

                {patientOptions.map(
                  (patient) => (
                    <option
                      key={
                        patient.id
                      }
                      value={
                        patient.id
                      }
                    >
                      {patientOptionName(
                        patient,
                      )}{' '}
                      —{' '}
                      {
                        patient.patientNumber
                      }
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>

          <div className="appointment-form-section">
            <div className="appointment-form-section-title">
              <Stethoscope
                size={16}
              />

              <span>
                Clinician
              </span>
            </div>

            <label className="appointment-field">
              Doctor in charge

              <select
                value={
                  clinicianId
                }
                onChange={(
                  event,
                ) =>
                  setClinicianId(
                    event
                      .target
                      .value,
                  )
                }
                disabled={
                  loadingClinicians
                }
                required
              >
                <option value="">
                  {loadingClinicians
                    ? 'Loading clinicians...'
                    : clinicians.length ===
                        0
                      ? 'No eligible clinicians available'
                      : 'Select clinician'}
                </option>

                {clinicians.map(
                  (clinician) => (
                    <option
                      key={
                        clinician.id
                      }
                      value={
                        clinician.id
                      }
                    >
                      {
                        clinician.firstName
                      }{' '}
                      {
                        clinician.lastName
                      }{' '}
                      —{' '}
                      {
                        clinician.staffNumber
                      }
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>

          <div className="appointment-form-section">
            <div className="appointment-form-section-title">
              <CalendarDays
                size={16}
              />

              <span>
                Schedule
              </span>
            </div>

            <div className="appointment-form-grid">
              <label className="appointment-field">
                Date

                <input
                  type="date"
                  value={
                    appointmentDate
                  }
                  min={
                    getTodayInputValue()
                  }
                  onChange={(
                    event,
                  ) =>
                    setAppointmentDate(
                      event
                        .target
                        .value,
                    )
                  }
                  required
                />
              </label>

              <label className="appointment-field">
                Start time

                <input
                  type="time"
                  value={
                    appointmentTime
                  }
                  onChange={(
                    event,
                  ) =>
                    setAppointmentTime(
                      event
                        .target
                        .value,
                    )
                  }
                  required
                />
              </label>

              <label className="appointment-field">
                Duration

                <select
                  value={
                    durationMinutes
                  }
                  onChange={(
                    event,
                  ) =>
                    setDurationMinutes(
                      event
                        .target
                        .value,
                    )
                  }
                >
                  <option value="15">
                    15 minutes
                  </option>

                  <option value="30">
                    30 minutes
                  </option>

                  <option value="45">
                    45 minutes
                  </option>

                  <option value="60">
                    1 hour
                  </option>

                  <option value="90">
                    1 hour 30 minutes
                  </option>

                  <option value="120">
                    2 hours
                  </option>
                </select>
              </label>

              <label className="appointment-field">
                Appointment type

                <select
                  value={
                    appointmentType
                  }
                  onChange={(
                    event,
                  ) =>
                    setAppointmentType(
                      event
                        .target
                        .value as AppointmentType,
                    )
                  }
                >
                  <option value="CONSULTATION">
                    Consultation
                  </option>

                  <option value="FOLLOW_UP">
                    Follow-up
                  </option>

                  <option value="ROUTINE_CHECKUP">
                    Routine check-up
                  </option>

                  <option value="EMERGENCY_REVIEW">
                    Emergency review
                  </option>
                </select>
              </label>
            </div>
          </div>

          <div className="appointment-form-section">
            <div className="appointment-form-section-title">
              <Clock3
                size={16}
              />

              <span>
                Visit details
              </span>
            </div>

            <label className="appointment-field">
              Reason for appointment

              <input
                value={reason}
                maxLength={500}
                onChange={(
                  event,
                ) =>
                  setReason(
                    event.target
                      .value,
                  )
                }
                placeholder="Brief reason for this appointment"
              />
            </label>

            <label className="appointment-field">
              Internal notes

              <textarea
                value={notes}
                maxLength={5000}
                onChange={(
                  event,
                ) =>
                  setNotes(
                    event.target
                      .value,
                  )
                }
                placeholder="Optional scheduling or clinical notes..."
                rows={3}
              />
            </label>
          </div>

          {error && (
            <div
              className="appointment-modal-error"
              role="alert"
            >
              {error}
            </div>
          )}

          <div className="modal-footer appointment-modal-footer">
            <button
              className="button button-ghost"
              type="button"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              className="button button-primary"
              type="submit"
              disabled={
                saving ||
                loadingClinicians
              }
            >
              <Plus size={17} />

              {saving
                ? 'Booking appointment…'
                : 'Book appointment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}