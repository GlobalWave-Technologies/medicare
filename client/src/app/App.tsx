import { useEffect, useRef, useState } from 'react'
import { KeyRound, LogOut, Menu } from 'lucide-react'
import type { View } from '../types/index'
import { navItemsByRole, roleLabels, toUiRole, allowedView, viewLabels } from './navigation'
import { AuthGate } from '../features/auth/AuthGate'
import { ChangePasswordDialog } from '../features/auth/ChangePasswordDialog'
import { authStore } from '../features/auth/auth-store'
import { ApiError, authErrorMessage } from '../api/client'
import type { StaffUser } from '../api/auth'
import { Brand } from '../components/branding/BrandMarks'
import { Dialog } from '../components/ui/Dialog'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'
import { ThemeControl } from '../components/ui/ThemeControl'
import { Overview } from '../features/dashboard/Overview'
import { Patients, type PatientView } from '../features/patients/Patients'
import { PatientModal } from '../features/patients/PatientModal'
import { PatientDetail } from '../features/patients/PatientDetail'
import { canRegisterPatients } from '../features/patients/patient-utils'
import type { Patient } from '../api/patients'
import type { AdmissionSummary } from '../api/admissions'
import { AdmissionRecord } from '../features/admissions/AdmissionRecord'
import { DischargeDialog } from '../features/admissions/AdmissionDialogs'
import { Records, type ClinicalContext } from '../features/records/Records'
import { hasClinicalAccess } from '../features/records/clinical-utils'
import { Reports } from '../features/reports/Reports'
import { Notifications } from '../features/notifications/Notifications'
import { StaffAdministration } from '../features/staff/StaffAdministration'
import { MedicationCatalog } from '../features/medications/MedicationCatalog'
import { StaffActivity } from '../features/staff-activity/StaffActivity'
import { useUnreadCount } from '../features/notifications/useNotifications'
import { compactCount, unreadLabel } from '../features/notifications/notification-utils'
import { InstallAction, InstallOnboarding, OfflineOverlay, UpdateNotice } from '../pwa/PwaUi'
import { useOffline } from '../pwa/connectivity'
import '../styles/App.css'

const descriptions: Record<View, string> = {
  Overview: 'Monitor hospital operations and current workload.',
  Patients: 'Register patients, admit them, change rooms and see who is in hospital.',
  'Medical records': 'Document care for admitted patients: clinical records, diagnoses and medications.',
  Staff: 'Manage staff accounts, roles and system access.',
  Activity: 'See who is signed in, when staff last used the system, and recent actions.',
  Medicines: 'Keep the list of medicines Medical Officers prescribe from.',
  Reports: 'Review registrations, admissions and discharges over a reporting period.',
  Notifications: 'Stay up to date with hospital operations.',
}

// Overview and Reports describe the dashboard and reports the server provides for each role.
const roleDescriptions: Partial<Record<StaffUser['role'], Partial<Record<View, string>>>> = {
  RECORDS_OFFICER: { Overview: 'Track admissions, discharges and who is in hospital.' },
  DOCTOR_IN_CHARGE: {
    Overview: 'See who is admitted and your clinical workload.', Patients: 'Register and admit patients, change rooms and open their medical records.',
  },
}

function AuthenticatedApp({ user }: { user: StaffUser }) {
  const [requestedView, setView] = useState<View>('Overview')
  const [clinicalContext, setClinicalContext] = useState<ClinicalContext>()
  const [patientSelection, setPatientSelection] = useState<{ id: string; initialPatient?: Patient; autoAdmit?: boolean } | null>(null)
  const [admissionSelection, setAdmissionSelection] = useState<string | null>(null), [discharging, setDischarging] = useState<AdmissionSummary | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false), [visit, setVisit] = useState(0), [patientView, setPatientView] = useState<PatientView>('all'), [activityStaff, setActivityStaff] = useState<string>()
  const [showPatientForm, setShowPatientForm] = useState(false), [patientRefreshKey, setPatientRefreshKey] = useState(0)
  const [signingOut, setSigningOut] = useState(false), [logoutError, setLogoutError] = useState<unknown>(null), [changingPassword, setChangingPassword] = useState(false)
  const logoutPending = useRef(false), heading = useRef<HTMLHeadingElement>(null)
  const role = toUiRole(user.role), view = allowedView(user.role, requestedView)
  const navItems = navItemsByRole[role]
  const unread = useUnreadCount(), unreadCount = unread.count ?? 0
  useEffect(() => {
    if (!document.querySelector('[role="dialog"]')) heading.current?.focus()
  }, [view, patientSelection?.id, admissionSelection])
  useEffect(() => {
    const resize = () => { if (window.innerWidth > 900) setIsMenuOpen(false) }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  function navigate(next: View, list: PatientView = 'all') {
    // Choosing a workspace always opens its landing view, even when it is already the current one.
    setView(next); setPatientView(list); setActivityStaff(undefined); setVisit((n) => n + 1); setPatientSelection(null); setAdmissionSelection(null); setClinicalContext(undefined); setIsMenuOpen(false); unread.refresh()
  }
  // Medical Officers open an admission's medical record from the patient record or the admitted list.
  // The registration snapshot and Register & admit apply once; afterwards the patient is re-read.
  const settlePatient = () => setPatientSelection((current) => current && (current.initialPatient || current.autoAdmit) ? { id: current.id } : current)
  const openRecord = hasClinicalAccess(user.role) ? (admission: AdmissionSummary) => { settlePatient(); setClinicalContext({ kind: 'admission', admission }); setView('Medical records') } : undefined
  const openPatient = (id: string) => { setPatientSelection({ id }); setAdmissionSelection(null); setView('Patients') }
  async function handleLogout() {
    if (logoutPending.current) return
    logoutPending.current = true; setSigningOut(true); setLogoutError(null)
    try { await authStore.logout() } catch (error) { setLogoutError(error) }
    finally { logoutPending.current = false; setSigningOut(false) }
  }
  const name = `${user.firstName} ${user.lastName}`
  const detail = view === 'Patients' && patientSelection ? 'Patient record' : view === 'Patients' && admissionSelection ? 'Admission record' : undefined
  const navigation = <nav aria-label="Workspace navigation">{navItems.map(({ label, icon: Icon }) => <button key={label} className={view === label ? 'active' : ''} aria-current={view === label ? 'page' : undefined} onClick={() => navigate(label)}>
    <Icon size={20} aria-hidden="true" /><span>{viewLabels[label]}</span>
    {label === 'Notifications' && unreadCount > 0 && <><span className="nav-badge" aria-hidden="true">{compactCount(unreadCount)}</span><span className="visually-hidden">{unreadLabel(unreadCount)}</span></>}
  </button>)}</nav>
  const identity = <div className="sidebar-bottom"><ThemeControl /><div className="sidebar-identity"><span className="avatar" aria-hidden="true">{user.firstName[0]}{user.lastName[0]}</span>
    <div><span className="visually-hidden">Signed in as </span><strong>{name}</strong><span>{roleLabels[role]}</span></div></div>
    <button type="button" className="button-link sidebar-password" onClick={() => { setIsMenuOpen(false); setChangingPassword(true) }}><KeyRound size={16} aria-hidden="true" />Change password</button>
    <InstallAction onBeforeOpen={() => setIsMenuOpen(false)} /></div>
  return <div className="app-shell">
    <a className="skip-link" href="#page-heading">Skip to main content</a>
    <aside className="sidebar desktop-sidebar"><Brand />
      <p className="workspace-label">Workspace</p>{navigation}{identity}
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="topbar-location"><button className="icon-btn menu-btn" aria-label="Open navigation" aria-describedby={unreadCount > 0 ? 'menu-unread' : undefined} aria-expanded={isMenuOpen} onClick={() => setIsMenuOpen(true)}><Menu size={22} aria-hidden="true" />{unreadCount > 0 && <><span className="nav-badge menu-badge" aria-hidden="true">{compactCount(unreadCount)}</span><span id="menu-unread" className="visually-hidden">{unreadLabel(unreadCount)}</span></>}</button>
          <div className="topbar-brand"><Brand size="small" /></div>
          {/* The page title already names the workspace; the trail appears only inside a record. */}
          {detail && <p className="breadcrumbs">{viewLabels[view]} <span aria-hidden="true">/</span> <strong>{detail}</strong></p>}</div>
        <div className="topbar-actions"><div className="profile-copy"><strong>{name}</strong><span>{roleLabels[role]}</span></div>
          <button className="button button-ghost signout-button" onClick={() => void handleLogout()} disabled={signingOut} aria-label={signingOut ? 'Signing out' : 'Sign out'}><LogOut size={18} aria-hidden="true" /><span>{signingOut ? 'Signing out…' : 'Sign out'}</span></button></div>
      </header>
      <div className="page-content">
        {logoutError !== null && <div className="auth-error" role="alert">Sign-out could not be confirmed. {authErrorMessage(logoutError)}{logoutError instanceof ApiError && logoutError.requestId && <p>Support reference: {logoutError.requestId}</p>}</div>}
        <div className="page-heading"><h1 id="page-heading" data-page-title tabIndex={-1} ref={heading}>{viewLabels[view]}</h1><p className="subheading">{roleDescriptions[user.role]?.[view] ?? descriptions[view]}</p></div>
        {view === 'Overview' && <Overview key={visit} role={user.role} onView={navigate} onRegister={canRegisterPatients(user.role) ? () => setShowPatientForm(true) : undefined} />}
        {view === 'Patients' && <div hidden={Boolean(patientSelection || admissionSelection)}><Patients key={visit} role={user.role} initialView={patientView} onSelect={(id) => setPatientSelection({ id })} onAdd={() => setShowPatientForm(true)} refreshKey={patientRefreshKey}
          onViewAdmission={(admission) => setAdmissionSelection(admission.id)} onOpenRecord={openRecord} onDischarge={hasClinicalAccess(user.role) ? setDischarging : undefined} /></div>}
        {view === 'Patients' && patientSelection && <PatientDetail key={patientSelection.id} id={patientSelection.id} initialPatient={patientSelection.initialPatient} user={user} autoAdmit={patientSelection.autoAdmit}
          onClinical={hasClinicalAccess(user.role) ? (patient) => { settlePatient(); setClinicalContext({ kind: 'patient', patient }); setView('Medical records') } : undefined}
          onOpenRecord={openRecord} onBack={() => setPatientSelection(null)} onChanged={() => { settlePatient(); setPatientRefreshKey((n) => n + 1) }} />}
        {view === 'Patients' && !patientSelection && admissionSelection && <AdmissionRecord key={admissionSelection} id={admissionSelection} user={user} backLabel="Back to Patients"
          onBack={() => setAdmissionSelection(null)} onOpenRecord={openRecord} />}
        {view === 'Medical records' && hasClinicalAccess(user.role) && <Records key={`${visit}:${clinicalContext?.kind === 'patient' ? `patient:${clinicalContext.patient.id}` : clinicalContext?.kind === 'admission' ? `admission:${clinicalContext.admission.id}` : 'all'}`} user={user} context={clinicalContext}
          onBack={() => { setView('Patients'); if (clinicalContext && !patientSelection) setPatientSelection({ id: clinicalContext.kind === 'patient' ? clinicalContext.patient.id : clinicalContext.admission.patient.id }) }}
          onOpenPatient={openPatient} onAdmissionsChanged={() => setPatientRefreshKey((n) => n + 1)} />}
        {view === 'Staff' && user.role === 'ADMIN' && <StaffAdministration key={visit} user={user} onSessionEnded={() => void authStore.refreshUser()}
          onViewActivity={(id) => { setActivityStaff(id); setView('Activity'); setVisit((n) => n + 1) }} />}
        {view === 'Activity' && user.role === 'ADMIN' && <StaffActivity key={visit} initialStaffId={activityStaff} onSessionEnded={() => void authStore.refreshUser()} />}
        {view === 'Medicines' && user.role === 'ADMIN' && <MedicationCatalog key={visit} role={user.role} />}
        {view === 'Reports' && <Reports key={visit} role={user.role} />}
        {view === 'Notifications' && <Notifications key={visit} user={user} unread={unread} />}
        {showPatientForm && canRegisterPatients(user.role) && <PatientModal role={user.role} onClose={() => setShowPatientForm(false)} onCreated={(patient, admitNext) => {
          setPatientSelection({ id: patient.id, initialPatient: patient, autoAdmit: admitNext }); setAdmissionSelection(null); setPatientRefreshKey((n) => n + 1); setView('Patients') }} />}
        {discharging && <DischargeDialog admission={discharging} onClose={() => setDischarging(null)} onSaved={() => setPatientRefreshKey((n) => n + 1)} onOpenRecord={openRecord ? () => openRecord(discharging) : undefined} />}
      </div>
    </main>
    {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} onChanged={() => authStore.passwordChanged()} />}
    <InstallOnboarding />
    {isMenuOpen && <Dialog title="Workspace navigation" kind="navigation" closeLabel="Close navigation" onClose={() => setIsMenuOpen(false)}><div className="sidebar mobile-sidebar">{navigation}{identity}
      <button type="button" className="button button-ghost drawer-signout" onClick={() => { setIsMenuOpen(false); void handleLogout() }} disabled={signingOut}><LogOut size={18} aria-hidden="true" />{signingOut ? 'Signing out…' : 'Sign out'}</button></div></Dialog>}
  </div>
}
export function App() {
  const offline = useOffline()
  // While offline the app stays mounted (unsaved text is kept) but is inert and covered, so no
  // record is visible or usable until the connection returns.
  return <ErrorBoundary>
    <div className="app-frame" inert={offline || undefined} aria-hidden={offline || undefined}>
      <AuthGate>{(user) => <AuthenticatedApp key={`${user.id}:${user.role}`} user={user} />}</AuthGate>
    </div>
    <OfflineOverlay />
    <UpdateNotice />
  </ErrorBoundary>
}
