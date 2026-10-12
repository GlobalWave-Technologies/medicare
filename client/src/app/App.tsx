import {
  useState,
} from 'react'
import type {
  Broadcast,
  View,
} from '../types/index'
import { defaultBroadcasts } from '../mocks/data'
import {
  navItemsByRole,
  roleLabels,
  toUiRole,
  allowedView,
} from './navigation'
import { AuthGate } from '../features/auth/AuthGate'
import { authStore } from '../features/auth/auth-store'
import { ApiError, authErrorMessage } from '../api/client'
import { CloudMark } from '../components/branding/BrandMarks'
import {
  Bell,
  ChevronDown,
  Download,
  Menu,
  Plus,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import { Overview } from '../features/dashboard/Overview'
import { Patients } from '../features/patients/Patients'
import {
  AppointmentModal,
  Appointments,
} from '../features/appointments/Appointments'
import { Records } from '../features/records/Records'
import { Reports } from '../features/reports/Reports'
import {
  BroadcastModal,
  Notifications,
} from '../features/notifications/Notifications'
import { PatientModal } from '../features/patients/PatientModal'
import type { StaffUser } from '../api/auth'
import '../styles/App.css'

type PageContext = {
  eyebrow: string
  title: string
  description: string
}

function getPageContext(
  view: View,
  firstName: string,
  currentDate: string,
): PageContext {
  switch (view) {
    case 'Overview':
      return {
        eyebrow: `${currentDate} • LIVE OVERVIEW`,
        title: `Welcome, ${firstName}`,
        description:
          "Here's what's happening across your hospital today.",
      }

    case 'Patients':
      return {
        eyebrow: 'PATIENT MANAGEMENT',
        title: 'Patients',
        description:
          'Search, register and manage secure hospital patient records.',
      }

    case 'Appointments':
      return {
        eyebrow: 'APPOINTMENT SCHEDULING',
        title: 'Appointments',
        description:
          'Manage scheduled consultations and clinical appointments.',
      }

    case 'Medical records':
      return {
        eyebrow: 'CLINICAL RECORDS',
        title: 'Medical records',
        description:
          'Review secure patient encounter history and clinical documentation.',
      }

    case 'Reports':
      return {
        eyebrow: 'HOSPITAL REPORTING',
        title: 'Reports',
        description:
          'Review operational and clinical reporting across the hospital.',
      }

    case 'Notifications':
      return {
        eyebrow: 'COMMUNICATIONS',
        title: 'Notifications',
        description:
          'Review alerts, hospital communications and important updates.',
      }
  }
}

function AuthenticatedApp({ user }: { user: StaffUser }) {
  const [requestedView, setView] =
    useState<View>('Overview')

  const [isMenuOpen, setIsMenuOpen] =
    useState(false)

  const [
    showPatientForm,
    setShowPatientForm,
  ] = useState(false)

  const [
    showAppointmentForm,
    setShowAppointmentForm,
  ] = useState(false)

  const [
    patientRefreshKey,
    setPatientRefreshKey,
  ] = useState(0)

  const [
    appointmentRefreshKey,
    setAppointmentRefreshKey,
  ] = useState(0)

  const [
    broadcasts,
    setBroadcasts,
  ] = useState<Broadcast[]>(
    defaultBroadcasts,
  )

  const [
    showBroadcastModal,
    setShowBroadcastModal,
  ] = useState(false)

  const role = toUiRole(user.role)
  const view = allowedView(user.role, requestedView)
  const [signingOut, setSigningOut] = useState(false)
  const [logoutError, setLogoutError] = useState<unknown>(null)

  async function handleLogout() {
    if (signingOut) return
    setSigningOut(true)
    setLogoutError(null)
    try { await authStore.logout() }
    catch (error) { setLogoutError(error) }
    finally { setSigningOut(false) }
  }
  const handleBroadcast = (
    message: string,
  ) => {
    if (!message.trim()) return

    setBroadcasts(
      (current) => [
        {
          id: Date.now(),
          title:
            'Admin broadcast',
          message:
            message.trim(),
          audience:
            'All Records Officers',
          createdAt:
            new Date().toLocaleTimeString(
              [],
              {
                hour: '2-digit',
                minute: '2-digit',
              },
            ),
        },
        ...current,
      ],
    )

    setView('Notifications')
    setShowBroadcastModal(false)
  }

  const canCreatePatients =
    role === 'Admin' ||
    role ===
      'Records Officer'

  const showHeaderAddPatientButton =
    canCreatePatients &&
    view === 'Overview'

  const showBroadcastButton =
    role === 'Admin' &&
    (
      view === 'Overview' ||
      view === 'Notifications'
    )

  const showExportReportButton =
    role === 'Admin' &&
    view === 'Reports'

  const navItems =
    navItemsByRole[role]

  const currentDate =
    new Intl.DateTimeFormat(
      'en-GB',
      {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      },
    )
      .format(new Date())
      .toUpperCase()

  const page =
    getPageContext(
      view,
      user.firstName,
      currentDate,
    )

  const initials =
    `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`
      .toUpperCase()

  return (
    <div className="app-shell">
      <aside
        className={`sidebar ${
          isMenuOpen
            ? 'open'
            : ''
        }`}
      >
        <div className="brand">
          <div className="brand-mark">
            <CloudMark />
          </div>

          <div>
            <strong>
              Hospital Records
            </strong>

            <span>
              Secure Access Portal
            </span>
          </div>
        </div>

        <div className="workspace-label">
          WORKSPACE
        </div>

        <nav>
          {navItems.map(
            ({
              label,
              icon: Icon,
            }) => (
              <button
                key={label}
                className={
                  view === label
                    ? 'active'
                    : ''
                }
                onClick={() => {
                  setView(label)
                  setIsMenuOpen(false)
                }}
              >
                <Icon size={18} />

                <span>
                  {label}
                </span>

                {label ===
                  'Appointments' && (
                  <b>8</b>
                )}

                {label ===
                  'Notifications' && (
                  <b>3</b>
                )}
              </button>
            ),
          )}
        </nav>

        <div className="sidebar-bottom">
          <div className="workspace-label">
            SYSTEM
          </div>

          {role === 'Admin' && (
            <button>
              <Settings
                size={18}
              />

              <span>
                Settings
              </span>
            </button>
          )}

          <div className="security-note">
            <ShieldCheck
              size={18}
            />

            <div>
              <strong>
                System protected
              </strong>

              <span>
                Secure authenticated session
              </span>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button
            className="icon-btn menu-btn"
            onClick={() =>
              setIsMenuOpen(
                !isMenuOpen,
              )
            }
          >
            <Menu size={20} />
          </button>

          <div className="breadcrumbs">
            <span>
              Workspace
            </span>

            <span>/</span>

            <strong>
              {view}
            </strong>
          </div>

          <div className="topbar-actions">
            <button className="icon-btn notification">
              <Bell size={19} />
              <i />
            </button>

            <button
              className="profile"
              onClick={
                handleLogout
              }
              title="Sign out" aria-label={signingOut ? "Signing out" : "Sign out"} disabled={signingOut}
            >
              <div className="avatar avatar-blue">
                {initials}
              </div>

              <div className="profile-copy">
                <strong>
                  {user.firstName}{' '}
                  {user.lastName}
                </strong>

                <span>
                  {
                    roleLabels[
                      role
                    ]
                  }
                </span>
              </div>

              <ChevronDown
                size={16}
              />
            </button>
          </div>
        </header>

        <section className="page-content">
          {logoutError !== null && <div className="auth-error" role="alert">
            Sign-out could not be confirmed. {authErrorMessage(logoutError)}
            {logoutError instanceof ApiError && logoutError.requestId && <p>Support reference: {logoutError.requestId}</p>}
          </div>}
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {page.eyebrow}
              </p>

              <h1>
                {page.title}
              </h1>

              <p className="subheading">
                {page.description}
              </p>
            </div>

            <div className="heading-actions">
              {showBroadcastButton && (
                <button
                  className="button button-ghost"
                  onClick={() =>
                    setShowBroadcastModal(
                      true,
                    )
                  }
                >
                  <Bell size={16} />
                  Broadcast alert
                </button>
              )}

              {showExportReportButton && (
                <button className="button button-ghost">
                  <Download size={16} />
                  Export report
                </button>
              )}

              {showHeaderAddPatientButton && (
                <button
                  className="button button-primary"
                  onClick={() =>
                    setShowPatientForm(
                      true,
                    )
                  }
                >
                  <Plus size={18} />
                  Add patient
                </button>
              )}
            </div>
          </div>

          {view ===
            'Overview' && (
            <Overview
              onView={
                setView
              }
            />
          )}

          {view ===
            'Patients' && (
            <Patients
              onAdd={() =>
                setShowPatientForm(
                  true,
                )
              }
              refreshKey={
                patientRefreshKey
              }
            />
          )}

          {view ===
            'Appointments' && (
            <Appointments
              onBook={() =>
                setShowAppointmentForm(
                  true,
                )
              }
              refreshKey={
                appointmentRefreshKey
              }
            />
          )}

          {view ===
            'Medical records' && (
            <Records />
          )}

          {view ===
            'Reports' && (
            <Reports />
          )}

          {view ===
            'Notifications' && (
            <Notifications
              broadcasts={
                broadcasts
              }
            />
          )}

          {showPatientForm && (
            <PatientModal
              onClose={() =>
                setShowPatientForm(
                  false,
                )
              }
              onCreated={() => {
                setPatientRefreshKey(
                  (current) =>
                    current + 1,
                )

                setView(
                  'Patients',
                )
              }}
            />
          )}

          {showAppointmentForm && (
            <AppointmentModal
              onClose={() =>
                setShowAppointmentForm(
                  false,
                )
              }
              onCreated={() => {
                setAppointmentRefreshKey(
                  (current) =>
                    current + 1,
                )

                setView(
                  'Appointments',
                )
              }}
            />
          )}

          {showBroadcastModal && (
            <BroadcastModal
              onClose={() =>
                setShowBroadcastModal(
                  false,
                )
              }
              onSend={
                handleBroadcast
              }
            />
          )}
        </section>
      </main>
    </div>
  )
}
export function App() {
  return <AuthGate>{(user) => <AuthenticatedApp key={`${user.id}:${user.role}`} user={user} />}</AuthGate>
}
