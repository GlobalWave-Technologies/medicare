import { useEffect, useRef, useState } from 'react'
import { LogOut, Menu } from 'lucide-react'
import type { View } from '../types/index'
import { navItemsByRole, roleLabels, toUiRole, allowedView, viewLabels } from './navigation'
import { AuthGate } from '../features/auth/AuthGate'
import { authStore } from '../features/auth/auth-store'
import { ApiError, authErrorMessage } from '../api/client'
import type { StaffUser } from '../api/auth'
import { Brand } from '../components/branding/BrandMarks'
import { Dialog } from '../components/ui/Dialog'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'
import { Overview } from '../features/dashboard/Overview'
import { Patients } from '../features/patients/Patients'
import { PatientModal } from '../features/patients/PatientModal'
import { PatientDetail } from '../features/patients/PatientDetail'
import { canManagePatients } from '../features/patients/patient-utils'
import type { Patient } from '../api/patients'
import { Appointments } from '../features/appointments/Appointments'
import { AppointmentForm } from '../features/appointments/AppointmentForm'
import { AppointmentDetail } from '../features/appointments/AppointmentDetail'
import { canManageAppointments } from '../features/appointments/appointment-utils'
import type { Appointment } from '../api/appointments'
import { Records, type ClinicalContext } from '../features/records/Records'
import { hasClinicalAccess } from '../features/records/clinical-utils'
import { Reports } from '../features/reports/Reports'
import { Notifications } from '../features/notifications/Notifications'
import { StaffAdministration } from '../features/staff/StaffAdministration'
import { useUnreadCount } from '../features/notifications/useNotifications'
import { compactCount, unreadLabel } from '../features/notifications/notification-utils'
import '../styles/App.css'

const descriptions: Record<View, string> = {
  Overview: 'Monitor hospital operations and current workload.',
  Patients: 'Manage patient registrations and demographic records.',
  Appointments: 'Schedule and manage hospital appointments.',
  'Medical records': 'Document and review clinical encounters.',
  Staff: 'Manage staff accounts, roles and system access.',
  Reports: 'Review operational activity over a selected reporting period.',
  Notifications: 'Stay up to date with appointments and hospital operations.',
}

// Overview and Reports describe the dashboard and reports the server provides for each role.
const roleDescriptions: Partial<Record<StaffUser['role'], Partial<Record<View, string>>>> = {
  RECORDS_OFFICER: { Overview: 'Track patient registration and appointment activity.' },
  DOCTOR_IN_CHARGE: {
    Overview: 'Review your appointments and clinical workload.', Patients: 'Find patients and open their clinical history.',
    Appointments: 'Review the appointments assigned to you and record attendance.', Reports: 'Review your own clinical activity over a selected reporting period.',
  },
}

function AuthenticatedApp({ user }: { user: StaffUser }) {
  const [requestedView, setView] = useState<View>('Overview')
  const [clinicalContext, setClinicalContext] = useState<ClinicalContext>()
  const [appointmentSelection, setAppointmentSelection] = useState<{ id: string; initialAppointment?: Appointment; fromNotifications?: boolean } | null>(null)
  const [patientSelection, setPatientSelection] = useState<{ id: string; initialPatient?: Patient } | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false), [visit, setVisit] = useState(0)
  const [showPatientForm, setShowPatientForm] = useState(false), [showAppointmentForm, setShowAppointmentForm] = useState(false)
  const [patientRefreshKey, setPatientRefreshKey] = useState(0), [appointmentRefreshKey, setAppointmentRefreshKey] = useState(0)
  const [signingOut, setSigningOut] = useState(false), [logoutError, setLogoutError] = useState<unknown>(null)
  const logoutPending = useRef(false), heading = useRef<HTMLHeadingElement>(null)
  const role = toUiRole(user.role), view = allowedView(user.role, requestedView)
  const navItems = navItemsByRole[role]
  const unread = useUnreadCount(), unreadCount = unread.count ?? 0
  useEffect(() => {
    if (!document.querySelector('[role="dialog"]')) heading.current?.focus()
  }, [view, patientSelection?.id, appointmentSelection?.id])
  useEffect(() => {
    const resize = () => { if (window.innerWidth > 900) setIsMenuOpen(false) }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  function navigate(next: View) {
    // Choosing a workspace always opens its landing view, even when it is already the current one.
    setView(next); setVisit((n) => n + 1); setPatientSelection(null); setAppointmentSelection(null); setClinicalContext(undefined); setIsMenuOpen(false); unread.refresh()
  }
  async function handleLogout() {
    if (logoutPending.current) return
    logoutPending.current = true; setSigningOut(true); setLogoutError(null)
    try { await authStore.logout() } catch (error) { setLogoutError(error) }
    finally { logoutPending.current = false; setSigningOut(false) }
  }
  const name = `${user.firstName} ${user.lastName}`
  const detail = view === 'Patients' && patientSelection ? 'Patient record' : view === 'Appointments' && appointmentSelection ? 'Appointment' : undefined
  const navigation = <nav aria-label="Workspace navigation">{navItems.map(({ label, icon: Icon }) => <button key={label} className={view === label ? 'active' : ''} aria-current={view === label ? 'page' : undefined} onClick={() => navigate(label)}>
    <Icon size={20} aria-hidden="true" /><span>{viewLabels[label]}</span>
    {label === 'Notifications' && unreadCount > 0 && <><span className="nav-badge" aria-hidden="true">{compactCount(unreadCount)}</span><span className="visually-hidden">{unreadLabel(unreadCount)}</span></>}
  </button>)}</nav>
  const identity = <div className="sidebar-bottom"><div className="sidebar-identity"><span className="avatar" aria-hidden="true">{user.firstName[0]}{user.lastName[0]}</span>
    <div><span className="visually-hidden">Signed in as </span><strong>{name}</strong><span>{roleLabels[role]}</span></div></div></div>
  return <div className="app-shell">
    <a className="skip-link" href="#page-heading">Skip to main content</a>
    <aside className="sidebar desktop-sidebar"><Brand />
      <p className="workspace-label">Workspace</p>{navigation}{identity}
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="topbar-location"><button className="icon-btn menu-btn" aria-label="Open navigation" aria-describedby={unreadCount > 0 ? 'menu-unread' : undefined} aria-expanded={isMenuOpen} onClick={() => setIsMenuOpen(true)}><Menu size={22} aria-hidden="true" />{unreadCount > 0 && <><span className="nav-badge menu-badge" aria-hidden="true">{compactCount(unreadCount)}</span><span id="menu-unread" className="visually-hidden">{unreadLabel(unreadCount)}</span></>}</button>
          <div className="topbar-brand"><Brand size="small" /></div>
          <p className="breadcrumbs">{detail ? <>{viewLabels[view]} <span aria-hidden="true">/</span> <strong>{detail}</strong></> : <>Medicare <span aria-hidden="true">/</span> <strong>{viewLabels[view]}</strong></>}</p></div>
        <div className="topbar-actions"><div className="profile-copy"><strong>{name}</strong><span>{roleLabels[role]}</span></div>
          <button className="button button-ghost signout-button" onClick={() => void handleLogout()} disabled={signingOut} aria-label={signingOut ? 'Signing out' : 'Sign out'}><LogOut size={18} aria-hidden="true" /><span>{signingOut ? 'Signing out…' : 'Sign out'}</span></button></div>
      </header>
      <div className="page-content">
        {logoutError !== null && <div className="auth-error" role="alert">Sign-out could not be confirmed. {authErrorMessage(logoutError)}{logoutError instanceof ApiError && logoutError.requestId && <p>Support reference: {logoutError.requestId}</p>}</div>}
        <div className="page-heading"><h1 id="page-heading" data-page-title tabIndex={-1} ref={heading}>{viewLabels[view]}</h1><p className="subheading">{roleDescriptions[user.role]?.[view] ?? descriptions[view]}</p></div>
        {view === 'Overview' && <Overview key={visit} role={user.role} onView={navigate} />}
        {view === 'Patients' && <div hidden={Boolean(patientSelection)}><Patients key={visit} role={user.role} onSelect={(id) => setPatientSelection({ id })} onAdd={() => setShowPatientForm(true)} refreshKey={patientRefreshKey} /></div>}
        {view === 'Patients' && patientSelection && <PatientDetail key={patientSelection.id} id={patientSelection.id} initialPatient={patientSelection.initialPatient} role={user.role}
          onClinical={hasClinicalAccess(user.role) ? (patient) => { setClinicalContext({ kind: 'patient', patient }); setView('Medical records') } : undefined}
          onBack={() => setPatientSelection(null)} onChanged={() => setPatientRefreshKey((n) => n + 1)} />}
        {view === 'Appointments' && <div hidden={Boolean(appointmentSelection)}><Appointments key={visit} user={user} onSelect={(id) => setAppointmentSelection({ id })} onBook={() => setShowAppointmentForm(true)} refreshKey={appointmentRefreshKey} /></div>}
        {view === 'Appointments' && appointmentSelection && <AppointmentDetail key={appointmentSelection.id} id={appointmentSelection.id} initialAppointment={appointmentSelection.initialAppointment} user={user}
          onClinical={hasClinicalAccess(user.role) ? (appointment, encounterId) => { setClinicalContext({ kind: 'appointment', appointment, encounterId }); setView('Medical records') } : undefined}
          backLabel={appointmentSelection.fromNotifications ? 'Back to Notifications' : undefined}
          onBack={() => { if (appointmentSelection.fromNotifications) navigate('Notifications'); else setAppointmentSelection(null) }} onChanged={() => setAppointmentRefreshKey((n) => n + 1)} />}
        {view === 'Medical records' && hasClinicalAccess(user.role) && <Records key={`${visit}:${clinicalContext?.kind === 'patient' ? `patient:${clinicalContext.patient.id}` : clinicalContext?.kind === 'appointment' ? `appointment:${clinicalContext.appointment.id}` : 'all'}`} user={user} context={clinicalContext}
          onBack={() => setView(clinicalContext?.kind === 'appointment' ? 'Appointments' : 'Patients')}
          onChoosePatient={() => { setClinicalContext(undefined); setPatientSelection(null); setView('Patients') }} />}
        {view === 'Staff' && user.role === 'ADMIN' && <StaffAdministration key={visit} user={user} onSessionEnded={() => void authStore.refreshUser()} />}
        {view === 'Reports' && <Reports key={visit} role={user.role} />}
        {view === 'Notifications' && <Notifications key={visit} user={user} unread={unread} onOpenAppointment={(id) => { setAppointmentSelection({ id, fromNotifications: true }); setView('Appointments') }} />}
        {showPatientForm && canManagePatients(user.role) && <PatientModal role={user.role} onClose={() => setShowPatientForm(false)} onCreated={(patient) => { setPatientSelection({ id: patient.id, initialPatient: patient }); setPatientRefreshKey((n) => n + 1); setView('Patients') }} />}
        {showAppointmentForm && canManageAppointments(user.role) && <AppointmentForm role={user.role} onClose={() => setShowAppointmentForm(false)} onSaved={(appointment) => { setAppointmentSelection({ id: appointment.id, initialAppointment: appointment }); setAppointmentRefreshKey((n) => n + 1); setView('Appointments') }} />}
      </div>
    </main>
    {isMenuOpen && <Dialog title="Workspace navigation" kind="navigation" closeLabel="Close navigation" onClose={() => setIsMenuOpen(false)}><div className="sidebar mobile-sidebar">{navigation}{identity}</div></Dialog>}
  </div>
}
export function App() {
  return <ErrorBoundary><AuthGate>{(user) => <AuthenticatedApp key={`${user.id}:${user.role}`} user={user} />}</AuthGate></ErrorBoundary>
}
