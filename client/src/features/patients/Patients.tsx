import { useEffect, useState } from 'react'
import {
  ChevronDown,
  Plus,
  Search,
} from 'lucide-react'
import { Pagination } from '../../components/ui/Pagination'
import {
  ApiError,
  patientsApi,
  type Patient,
  type PatientPagination,
} from '../../lib/api'
import './patients.css'

type PatientsProps = {
  onAdd: () => void
  refreshKey?: number
}

const emptyPagination: PatientPagination = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 0,
}

function calculateAge(dateOfBirth: string | null) {
  if (!dateOfBirth) return '—'

  const birthDate = new Date(`${dateOfBirth}T00:00:00`)
  const today = new Date()

  let age = today.getFullYear() - birthDate.getFullYear()

  const monthDifference =
    today.getMonth() - birthDate.getMonth()

  if (
    monthDifference < 0 ||
    (
      monthDifference === 0 &&
      today.getDate() < birthDate.getDate()
    )
  ) {
    age -= 1
  }

  return age >= 0 ? String(age) : '—'
}

function patientInitials(patient: Patient) {
  return `${patient.firstName[0] ?? ''}${patient.lastName[0] ?? ''}`
    .toUpperCase()
}

function patientName(patient: Patient) {
  return [
    patient.firstName,
    patient.middleName,
    patient.lastName,
  ]
    .filter(Boolean)
    .join(' ')
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

export function Patients({
  onAdd,
  refreshKey = 0,
}: PatientsProps) {
  const [patients, setPatients] = useState<Patient[]>([])

  const [pagination, setPagination] =
    useState<PatientPagination>(emptyPagination)

  const [query, setQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  const [archivedFilter, setArchivedFilter] =
    useState<'false' | 'true' | 'all'>('false')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const pageSize = 10

  useEffect(() => {
    let active = true

    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')

      try {
        const result = await patientsApi.list({
          page: currentPage,
          limit: pageSize,
          search: query,
          archived: archivedFilter,
        })

        if (!active) return

        setPatients(result.items)
        setPagination(result.pagination)
      } catch (error) {
        if (!active) return

        setPatients([])
        setPagination(emptyPagination)

        if (error instanceof ApiError) {
          if (error.status === 401) {
            setError(
              'Your session has expired. Please sign in again.',
            )
          } else if (error.status === 403) {
            setError(
              'You do not have permission to view patient records.',
            )
          } else {
            setError(error.message)
          }
        } else {
          setError(
            'Unable to load patients. Please check the server connection.',
          )
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }, query ? 300 : 0)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [
    query,
    currentPage,
    archivedFilter,
    refreshKey,
  ])

  const pageCount = Math.max(
    1,
    pagination.totalPages || 1,
  )

  return (
    <section className="panel page-panel patients-panel">
      <div className="panel-header patients-header">
        <div>
          <p className="patients-kicker">
            PATIENT MANAGEMENT
          </p>

          <h2>Patient directory</h2>

          <p>
            {pagination.total.toLocaleString()} patient
            {pagination.total === 1
              ? ' record'
              : ' records'}{' '}
            in this view
          </p>
        </div>

        <button
          className="button button-primary patients-add-button"
          type="button"
          onClick={onAdd}
        >
          <Plus size={17} />
          Add patient
        </button>
      </div>

      <div className="patients-summary">
        <div className="patients-summary-card">
          <span className="patients-summary-dot patients-summary-dot-active" />

          <div>
            <strong>Active patients</strong>

            <small>
              Available for normal hospital workflows and care.
            </small>
          </div>
        </div>

        <div className="patients-summary-card">
          <span className="patients-summary-dot patients-summary-dot-archived" />

          <div>
            <strong>Archived patients</strong>

            <small>
              Retained securely but excluded from the normal
              active directory.
            </small>
          </div>
        </div>
      </div>

      <div className="patients-toolbar">
        <label className="patients-search">
          <Search size={17} />

          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setCurrentPage(1)
            }}
            placeholder="Search by patient name or number..."
          />
        </label>

        <div className="patients-filter">
          <select
            value={archivedFilter}
            onChange={(event) => {
              setArchivedFilter(
                event.target.value as
                  | 'false'
                  | 'true'
                  | 'all',
              )

              setCurrentPage(1)
            }}
            aria-label="Filter patient records"
          >
            <option value="false">
              Active patients
            </option>

            <option value="true">
              Archived patients
            </option>

            <option value="all">
              All patients
            </option>
          </select>

          <ChevronDown size={15} />
        </div>
      </div>

      {error && (
        <div
          className="patients-state patients-state-error"
          role="alert"
        >
          <strong>
            Unable to load patient records
          </strong>

          <span>{error}</span>
        </div>
      )}

      <div className="patient-table patients-table">
        <div className="table-row table-head">
          <span>Patient</span>
          <span>Age</span>
          <span>Phone</span>
          <span>Status</span>
          <span>Registered</span>
        </div>

        {loading ? (
          <div className="patients-state">
            <strong>
              Loading patient records…
            </strong>

            <span>
              Please wait a moment.
            </span>
          </div>
        ) : patients.length === 0 ? (
          <div className="patients-state">
            <strong>
              No patient records found
            </strong>

            <span>
              {query
                ? 'Try a different search term.'
                : archivedFilter === 'false'
                  ? 'Register a patient to start building the directory.'
                  : 'There are no patients in this category.'}
            </span>
          </div>
        ) : (
          patients.map((patient) => {
            const archived =
              Boolean(patient.archivedAt)

            const status =
              archived
                ? 'Archived'
                : 'Active'

            return (
              <div
                className="table-row"
                key={patient.id}
              >
                <div className="patient-name">
                  <div className="avatar avatar-blue">
                    {patientInitials(patient)}
                  </div>

                  <div className="patients-name-copy">
                    <strong>
                      {patientName(patient)}
                    </strong>

                    <span>
                      {patient.patientNumber}
                    </span>
                  </div>
                </div>

                <span data-label="Age">
                  {calculateAge(
                    patient.dateOfBirth,
                  )}
                </span>

                <span data-label="Phone">
                  {patient.phone ?? '—'}
                </span>

                <span data-label="Status">
                  <em
                    className={`status ${
                      archived
                        ? 'archived'
                        : 'active'
                    }`}
                  >
                    {status}
                  </em>
                </span>

                <span data-label="Registered">
                  {formatDate(
                    patient.createdAt,
                  )}
                </span>
              </div>
            )
          })
        )}
      </div>

      <Pagination
        currentPage={Math.max(
          1,
          pagination.page || currentPage,
        )}
        pageCount={pageCount}
        total={pagination.total}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
      />
    </section>
  )
}