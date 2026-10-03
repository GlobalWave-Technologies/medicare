import { useEffect, useState } from 'react'
import {
  Activity, ArrowUpRight, Bell, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ClipboardList,
  Clock3, Download, FileText, HeartPulse, LayoutDashboard, Menu, MoreHorizontal,
  Pill, Plus, Search, Settings, ShieldCheck, Stethoscope, UserRound, UsersRound, X,
} from 'lucide-react'
import './App.css'

const complaints = ['Abdominal Pain', 'Allergic Reaction', 'Asthmatic Attack', 'Boils/Rashes/Itches', 'Burns', 'Chest Pains', 'Chills', 'Cold/Running Nose', 'Coughs', 'Diarrhoea', 'Earache', 'Fever', 'General Body Pain', 'Headache', 'Heartburns', 'Lightheadedness', 'Menstrual Pain', 'Neck Pain', 'Sore Throat', 'Stomach Ache', 'Ulcer', 'Wounds', 'Other']
type Role = 'Admin' | 'Records Officer' | 'Doctor in Charge'
type View = 'Overview' | 'Patients' | 'Appointments' | 'Medical records' | 'Reports' | 'Notifications'

const roles: Role[] = ['Admin', 'Records Officer', 'Doctor in Charge']
const navItemsByRole: Record<Role, Array<{ label: View; icon: typeof LayoutDashboard }>> = {
  Admin: [{ label: 'Overview', icon: LayoutDashboard }, { label: 'Patients', icon: UsersRound }, { label: 'Medical records', icon: FileText }, { label: 'Reports', icon: ClipboardList }, { label: 'Notifications', icon: Bell }],
  'Records Officer': [{ label: 'Patients', icon: UsersRound }, { label: 'Medical records', icon: FileText }, { label: 'Notifications', icon: Bell }],
  'Doctor in Charge': [{ label: 'Overview', icon: LayoutDashboard }, { label: 'Patients', icon: UsersRound }, { label: 'Medical records', icon: FileText }, { label: 'Notifications', icon: Bell }],
}
const roleLabels: Record<Role, string> = {
  Admin: 'Administrator',
  'Records Officer': 'Records Officer',
  'Doctor in Charge': 'Doctor in Charge',
}
const appointments = [{ time: '09:00', name: 'Amina Yusuf', detail: 'Follow-up consultation', color: 'mint', initials: 'AY' }, { time: '10:30', name: 'Marcus Johnson', detail: 'General body pain', color: 'gold', initials: 'MJ' }, { time: '11:15', name: 'Sofia Martins', detail: 'Routine check-up', color: 'lilac', initials: 'SM' }, { time: '13:00', name: 'Daniel Kim', detail: 'Chest pains', color: 'rose', initials: 'DK' }]
const recentPatients = [{ id: 'PT-2048', name: 'Amina Yusuf', roomNumber: 'Ward 3 / Room 12', complaint: 'Allergic Reaction', status: 'Active', seen: 'Today, 08:42', initials: 'AY', color: 'mint' }, { id: 'PT-2047', name: 'Marcus Johnson', roomNumber: 'Ward 2 / Room 08', complaint: 'General Body Pain', status: 'Active', seen: 'Today, 08:15', initials: 'MJ', color: 'gold' }, { id: 'PT-2046', name: 'Sofia Martins', roomNumber: 'Ward 1 / Room 06', complaint: 'Headache', status: 'Pending', seen: 'Yesterday, 16:20', initials: 'SM', color: 'lilac' }, { id: 'PT-2045', name: 'Daniel Kim', roomNumber: 'Ward 4 / Room 14', complaint: 'Chest Pains', status: 'Active', seen: 'Yesterday, 14:08', initials: 'DK', color: 'rose' }]
type Patient = (typeof recentPatients)[number]
type MedicationOrder = {
  id: string
  patientId: string
  medication: string
  strength: string
  dose: string
  route: string
  frequency: string
  duration: string
  instructions: string
  assignedAt: string
  assignedBy: string
}
type MedicationDraft = Omit<MedicationOrder, 'id' | 'patientId' | 'assignedAt' | 'assignedBy'>

function loadMedicationOrders(): MedicationOrder[] {
  try {
    const savedOrders = JSON.parse(localStorage.getItem('medicare-medication-orders') ?? '[]')
    return Array.isArray(savedOrders) ? savedOrders as MedicationOrder[] : []
  } catch {
    return []
  }
}

const medicalRecords = [{ patient: 'Amina Yusuf', recordId: 'MR-7842', visit: 'Today, 08:42', diagnosis: 'Allergic Reaction', clinician: 'Dr. Okafor', status: 'Reviewed', color: 'mint', initials: 'AY' }, { patient: 'Marcus Johnson', recordId: 'MR-7841', visit: 'Today, 08:15', diagnosis: 'General Body Pain', clinician: 'Dr. Okafor', status: 'Reviewed', color: 'gold', initials: 'MJ' }, { patient: 'Sofia Martins', recordId: 'MR-7839', visit: 'Yesterday, 16:20', diagnosis: 'Headache', clinician: 'Dr. Bello', status: 'Pending', color: 'lilac', initials: 'SM' }, { patient: 'Daniel Kim', recordId: 'MR-7836', visit: 'Yesterday, 14:08', diagnosis: 'Chest Pains', clinician: 'Dr. Mensah', status: 'Reviewed', color: 'rose', initials: 'DK' }]

type Broadcast = { id: number; title: string; message: string; audience: string; createdAt: string }
const defaultBroadcasts: Broadcast[] = [
  { id: 1, title: 'Staff briefing', message: 'Please review all checked-in patients before 10:00 AM.', audience: 'All Records Officers', createdAt: '08:30 AM' },
  { id: 2, title: 'Bed update', message: 'Ward 3 is now ready for new admissions.', audience: 'All Records Officers', createdAt: '09:05 AM' },
]

const statusMeaning: Record<string, string> = {
  Active: 'Currently admitted or receiving consultation/care in the facility',
  Pending: 'Checked in and waiting in queue for doctor consultation or triage',
}

function App() {
  const [view, setView] = useState<View>('Overview')
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [medicationOrders, setMedicationOrders] = useState<MedicationOrder[]>(loadMedicationOrders)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [showPatientForm, setShowPatientForm] = useState(false)
  const [showAppointmentForm, setShowAppointmentForm] = useState(false)
  const [query, setQuery] = useState('')
  const [signedIn, setSignedIn] = useState(false)
  const [role, setRole] = useState<Role>('Admin')
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>(defaultBroadcasts)
  const [showBroadcastModal, setShowBroadcastModal] = useState(false)

  useEffect(() => {
    if (!signedIn) return
    const validViews = navItemsByRole[role]
    if (!validViews.some((item) => item.label === view)) {
      setView(validViews[0].label)
    }
  }, [role, signedIn, view])

  useEffect(() => {
    if (!signedIn) return
    let logoutTimer: number | undefined
    const resetTimer = () => {
      window.clearTimeout(logoutTimer)
      logoutTimer = window.setTimeout(() => setSignedIn(false), 20 * 60 * 1000)
    }

    const handleUserActivity = () => resetTimer()
    window.addEventListener('mousemove', handleUserActivity)
    window.addEventListener('keydown', handleUserActivity)
    window.addEventListener('click', handleUserActivity)
    window.addEventListener('touchstart', handleUserActivity)
    resetTimer()

    return () => {
      window.clearTimeout(logoutTimer)
      window.removeEventListener('mousemove', handleUserActivity)
      window.removeEventListener('keydown', handleUserActivity)
      window.removeEventListener('click', handleUserActivity)
      window.removeEventListener('touchstart', handleUserActivity)
    }
  }, [signedIn])

  useEffect(() => {
    localStorage.setItem('medicare-medication-orders', JSON.stringify(medicationOrders))
  }, [medicationOrders])

  if (!signedIn) return <Login onLogin={(selectedRole) => { setRole(selectedRole); setSignedIn(true) }} />

  const filteredPatients = recentPatients.filter((patient) => `${patient.name} ${patient.id} ${patient.complaint}`.toLowerCase().includes(query.toLowerCase()))
  const pageTitle = role === 'Admin' ? 'Good morning, Admin' : role === 'Records Officer' ? 'Good morning, Records Officer' : 'Good morning, Doctor in Charge'
  const pageDescription = role === 'Admin' ? "Here's what's happening across your hospital today." : role === 'Records Officer' ? 'Monitor patient logging, records access, and urgent notifications.' : 'Review high-level care metrics and key clinical operations.'
  const showExportReportButton = view === 'Reports' && role === 'Admin'
  const navItems = navItemsByRole[role]

  const handleBroadcast = (message: string) => {
    if (!message.trim()) return
    setBroadcasts((current) => [{
      id: Date.now(),
      title: 'Admin broadcast',
      message: message.trim(),
      audience: 'All Records Officers',
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }, ...current])
    setView('Notifications')
    setShowBroadcastModal(false)
  }

  const handleAssignMedication = (patientId: string, draft: MedicationDraft) => {
    setMedicationOrders((current) => [{
      ...draft,
      id: `RX-${Date.now()}`,
      patientId,
      assignedAt: new Date().toISOString(),
      assignedBy: roleLabels[role],
    }, ...current])
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${isMenuOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><CloudMark /></div>
          <div><strong>Infirmary Management System</strong><span>Secure Access Portal</span></div>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          {navItems.map(({ label, icon: Icon }) => (
            <button key={label} className={view === label ? 'active' : ''} onClick={() => { setView(label); setIsMenuOpen(false); if (label === 'Patients') setSelectedPatient(null) }}>
              <Icon size={18} />
              <span>{label}</span>
              {label === 'Appointments' && <b>8</b>}
              {label === 'Notifications' && <b>3</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-label">SYSTEM</div>
          {role === 'Admin' && <button><Settings size={18} /><span>Settings</span></button>}
          <div className="security-note">
            <ShieldCheck size={18} />
            <div><strong>System protected</strong><span>Last backup 18 min ago</span></div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setIsMenuOpen(!isMenuOpen)}><Menu size={20} /></button>
          <div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>{view}</strong></div>
          <div className="topbar-actions">
            <button className="icon-btn notification"><Bell size={19} /><i /></button>
            <button className="profile" onClick={() => setSignedIn(false)}>
              <div className="avatar avatar-blue">{role === 'Admin' ? 'AD' : role === 'Records Officer' ? 'RO' : 'DC'}</div>
              <div className="profile-copy"><strong>{role === 'Admin' ? 'Dr. Adaeze Okafor' : role === 'Records Officer' ? 'Tina Okon' : 'Dr. Alfred Eke'}</strong><span>{roleLabels[role]}</span></div>
              <ChevronDown size={16} />
            </button>
          </div>
        </header>

        <section className="page-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">THURSDAY, 18 SEPTEMBER 2026 <span className="live-dot" /> LIVE OVERVIEW</p>
              <h1>{pageTitle}</h1>
              <p className="subheading">{pageDescription}</p>
            </div>
            <div className="heading-actions">
              {role === 'Admin' && <button className="button button-ghost" onClick={() => setShowBroadcastModal(true)}><Bell size={16} /> Broadcast alert</button>}
              {showExportReportButton && <button className="button button-ghost"><Download size={16} /> Export report</button>}
            </div>
          </div>

          {view === 'Overview' && <Overview onView={setView} />}
          {view === 'Patients' && (selectedPatient
            ? <PatientDetails
                patient={selectedPatient}
                orders={medicationOrders.filter((order) => order.patientId === selectedPatient.id)}
                onBack={() => setSelectedPatient(null)}
                onAssign={(draft) => handleAssignMedication(selectedPatient.id, draft)}
              />
            : <Patients query={query} setQuery={setQuery} patients={filteredPatients} onAdd={() => setShowPatientForm(true)} onSelect={setSelectedPatient} />)}
          {view === 'Appointments' && <Appointments onBook={() => setShowAppointmentForm(true)} />}
          {view === 'Medical records' && <Records />}
          {view === 'Reports' && <Reports />}
          {view === 'Notifications' && <Notifications broadcasts={broadcasts} />}

          {showPatientForm && <PatientModal onClose={() => setShowPatientForm(false)} />}
          {showAppointmentForm && <AppointmentModal onClose={() => setShowAppointmentForm(false)} />}
          {showBroadcastModal && <BroadcastModal onClose={() => setShowBroadcastModal(false)} onSend={handleBroadcast} />}
        </section>
      </main>
    </div>
  )
}

function Overview({ onView }: { onView: (view: View) => void }) {
  return (
    <>
      <div className="stats-grid">
        <StatCard icon={UsersRound} label="Total patients" value="2,048" change="12.5%" note="vs last month" color="blue" />
        <StatCard icon={CalendarDays} label="Appointments" value="86" change="8.2%" note="this week" color="mint" />
        <StatCard icon={FileText} label="Medical records" value="1,279" change="4.6%" note="this month" color="lilac" />
        <StatCard icon={Activity} label="Active cases" value="24" change="2.1%" note="vs last week" color="gold" />
      </div>

      <div className="dashboard-grid">
        <section className="panel chart-panel">
          <div className="panel-header">
            <div>
              <h2>Patient activity</h2>
              <p>New registrations across the last 7 days</p>
            </div>
            <button className="select-button">This week <ChevronDown size={15} /></button>
          </div>
          <div className="chart-area">
            <div className="y-axis"><span>80</span><span>60</span><span>40</span><span>20</span><span>0</span></div>
            <div className="bars">
              <div className="grid-lines"><i /><i /><i /><i /><i /></div>
              {[['Mon', 47], ['Tue', 62], ['Wed', 54], ['Thu', 75], ['Fri', 49], ['Sat', 66], ['Sun', 44]].map(([day, height]) => (
                <div className="bar-column" key={day as string}>
                  <div className="bar-value" style={{ height: `${Number(height) / 0.8}%` }}><span>{height}</span></div>
                  <small>{day}</small>
                </div>
              ))}
            </div>
          </div>
          <div className="chart-foot">
            <span><i className="legend-dot blue-dot" /> New patients</span>
            <span className="trend"><ArrowUpRight size={15} /> 12.5% compared to last week</span>
          </div>
        </section>

        <section className="panel breakdown-panel">
          <div className="panel-header">
            <div>
              <h2>Chief complaints</h2>
              <p>Patient visits by reason</p>
            </div>
            <button className="more-button"><MoreHorizontal size={20} /></button>
          </div>
          <div className="donut-wrap">
            <div className="donut"><div><strong>2048</strong><span>visits</span></div></div>
            <div className="complaint-list">
              <Legend color="blue" label="Fever" value="34%" />
              <Legend color="mint" label="Headache" value="24%" />
              <Legend color="gold" label="Chest pain" value="18%" />
              <Legend color="lilac" label="Respiratory" value="12%" />
              <Legend color="rose" label="Other" value="12%" />
            </div>
          </div>
        </section>

        <section className="panel panel-wide">
          <div className="panel-header">
            <div>
              <h2>Recent activity</h2>
              <p>Today's key updates from across the clinic</p>
            </div>
            <button className="more-button"><MoreHorizontal size={20} /></button>
          </div>
          <div className="activity-list">
            <ActivityItem icon={UserRound} text="New patient registered" by="Reception desk" time="08:42" color="blue" />
            <ActivityItem icon={CalendarDays} text="Consultation rescheduled" by="Scheduling team" time="09:15" color="mint" />
            <ActivityItem icon={ShieldCheck} text="Lab report approved" by="Clinical team" time="10:30" color="gold" />
            <ActivityItem icon={FileText} text="Medical record review completed" by="Dr. Okafor" time="11:10" color="lilac" />
          </div>
        </section>
      </div>

      <section className="panel panel-compact">
        <div className="panel-header marginless">
          <div>
            <h2>Today’s schedule</h2>
            <p>Upcoming patient visits and follow-up care</p>
          </div>
          <button className="button button-primary" onClick={() => onView('Appointments')}><Plus size={17} /> View all</button>
        </div>
        <div className="appointment-list">
          {appointments.map((appointment) => (
            <div key={appointment.time} className="appointment-item">
              <div className={`appointment-time ${appointment.color}`}> {appointment.time}</div>
              <div className="appointment-copy">
                <strong>{appointment.name}</strong>
                <span>{appointment.detail}</span>
              </div>
              <div className={`avatar avatar-${appointment.color}`}>{appointment.initials}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

function Patients({ query, setQuery, patients, onAdd, onSelect }: { query: string; setQuery: (value: string) => void; patients: typeof recentPatients; onAdd: () => void; onSelect: (patient: Patient) => void }) {
  const pageSize = 2
  const [currentPage, setCurrentPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(patients.length / pageSize))
  const page = Math.min(currentPage, pageCount)
  const visiblePatients = patients.slice((page - 1) * pageSize, page * pageSize)

  return (
    <section className="panel page-panel">
      <div className="panel-header table-header">
        <div>
          <h2>Patient directory</h2>
          <p>2,048 patient records across all departments</p>
        </div>
        <button className="button button-primary" onClick={onAdd}><Plus size={17} /> Add patient</button>
      </div>
      <div className="status-summary">
        <div className="status-row">
          <span className="status active">Active</span>
          <small>Currently admitted or receiving care/consultation</small>
        </div>
        <div className="status-row">
          <span className="status pending">Pending</span>
          <small>Checked in and waiting in queue for doctor consultation or triage</small>
        </div>
      </div>
      <div className="table-tools">
        <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setCurrentPage(1) }} placeholder="Search by name or symptoms..." /></label>
        <button className="select-button">All statuses <ChevronDown size={15} /></button>
      </div>
      <div className="patient-table">
        <div className="table-row table-head"><span>Patient name</span><span>Room number</span><span>Symptoms</span><span>Status</span><span /></div>
        {visiblePatients.map((patient) => (
          <div className="table-row" key={patient.id}>
            <div className="patient-name"><div className={`avatar avatar-${patient.color}`}>{patient.initials}</div><strong>{patient.name}</strong></div>
            <span>{patient.roomNumber}</span>
            <span>{patient.complaint}</span>
            <span title={statusMeaning[patient.status] ?? patient.status}><em className={`status ${patient.status.toLowerCase()}`}>{patient.status}</em></span>
            <button className="patient-detail-action" aria-label={`View details for ${patient.name}`} onClick={() => onSelect(patient)}><span>View details</span><ArrowUpRight size={16} /></button>
          </div>
        ))}
      </div>
      <Pagination currentPage={page} pageCount={pageCount} total={patients.length} pageSize={pageSize} onPageChange={setCurrentPage} />
    </section>
  )
}

function PatientDetails({ patient, orders, onBack, onAssign }: { patient: Patient; orders: MedicationOrder[]; onBack: () => void; onAssign: (draft: MedicationDraft) => void }) {
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    onAssign({
      medication: String(values.get('medication')).trim(),
      strength: String(values.get('strength')).trim(),
      dose: String(values.get('dose')).trim(),
      route: String(values.get('route')),
      frequency: String(values.get('frequency')).trim(),
      duration: String(values.get('duration')).trim(),
      instructions: String(values.get('instructions')).trim(),
    })
    form.reset()
  }

  return (
    <div className="patient-detail-view">
      <button className="button button-ghost patient-detail-back" onClick={onBack}><ChevronLeft size={16} /> Patient directory</button>

      <section className="panel patient-profile-panel">
        <div className="patient-profile-heading">
          <div className="patient-profile-identity">
            <div className={`avatar avatar-${patient.color}`}>{patient.initials}</div>
            <div><p className="eyebrow">PATIENT PROFILE</p><h2>{patient.name}</h2></div>
          </div>
          <em className={`status ${patient.status.toLowerCase()}`}>{patient.status}</em>
        </div>
        <div className="patient-info-grid">
          <div><span>Patient ID</span><strong>{patient.id}</strong></div>
          <div><span>Room number</span><strong>{patient.roomNumber}</strong></div>
          <div><span>Current complaint</span><strong>{patient.complaint}</strong></div>
          <div><span>Last seen</span><strong>{patient.seen}</strong></div>
        </div>
      </section>

      <div className="patient-care-grid">
        <section className="panel medication-panel">
          <div className="panel-header">
            <div><h2>Assign medication</h2><p>Record medication details exactly as prescribed.</p></div>
            <Pill size={20} aria-hidden="true" />
          </div>
          <form className="medication-form" onSubmit={handleSubmit}>
            <label>Medication name<input name="medication" required maxLength={100} placeholder="Enter medication name" /></label>
            <label>Strength<input name="strength" required maxLength={60} placeholder="e.g. 500 mg" /></label>
            <label>Dose<input name="dose" required maxLength={80} placeholder="e.g. 1 tablet" /></label>
            <label>Route<select name="route" required defaultValue=""><option value="" disabled>Select route</option><option>Oral</option><option>Injection</option><option>Topical</option><option>Inhaled</option><option>Other</option></select></label>
            <label>Frequency<input name="frequency" required maxLength={80} placeholder="Enter prescribed frequency" /></label>
            <label>Duration<input name="duration" required maxLength={80} placeholder="e.g. 5 days" /></label>
            <label className="medication-instructions">Instructions<textarea name="instructions" maxLength={500} rows={3} placeholder="Additional instructions (optional)" /></label>
            <button className="button button-primary medication-submit" type="submit"><Plus size={17} /> Assign medication</button>
          </form>
        </section>

        <section className="panel assigned-medications-panel">
          <div className="panel-header">
            <div><h2>Assigned medications</h2><p>{orders.length} {orders.length === 1 ? 'order' : 'orders'} for {patient.name}</p></div>
          </div>
          {orders.length === 0
            ? <div className="medication-empty"><Pill size={22} /><strong>No medications assigned</strong><span>Assigned orders will appear here.</span></div>
            : <div className="medication-order-list">{orders.map((order) => (
                <article className="medication-order" key={order.id}>
                  <div className="medication-order-heading"><div><strong>{order.medication}</strong><span>{order.strength}</span></div><time dateTime={order.assignedAt}>{new Date(order.assignedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time></div>
                  <div className="medication-order-details"><span><b>Dose</b>{order.dose}</span><span><b>Route</b>{order.route}</span><span><b>Frequency</b>{order.frequency}</span><span><b>Duration</b>{order.duration}</span></div>
                  {order.instructions && <p className="medication-order-instructions">{order.instructions}</p>}
                  <small>Assigned by {order.assignedBy}</small>
                </article>
              ))}</div>}
        </section>
      </div>
    </div>
  )
}

function Appointments({ onBook }: { onBook: () => void }) {
  return (
    <section className="panel page-panel">
      <div className="panel-header">
        <div>
          <h2>Upcoming appointments</h2>
          <p>Thursday, 18 September 2026</p>
        </div>
        <button className="select-button">Week view <ChevronDown size={15} /></button>
      </div>
      <div className="calendar-placeholder">
        <CalendarDays size={32} />
        <strong>Appointment calendar</strong>
        <p>86 appointments scheduled this week. Calendar integration is ready for your clinical team.</p>
        <button className="button button-primary" onClick={onBook}><Plus size={17} /> Book appointment</button>
      </div>
    </section>
  )
}

function Records() {
  const pageSize = 2
  const [currentPage, setCurrentPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(medicalRecords.length / pageSize))
  const visibleRecords = medicalRecords.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return (
    <section className="panel page-panel">
      <div className="panel-header table-header">
        <div>
          <h2>Medical records</h2>
          <p>Clinical records restricted to authorised staff</p>
        </div>
        <div className="access-badge"><ShieldCheck size={16} /> Clinical access</div>
      </div>
      <div className="record-cards">
        <div className="record-card"><div className="record-icon blue-bg"><HeartPulse size={22} /></div><strong>1,279</strong><span>Records updated this month</span></div>
        <div className="record-card"><div className="record-icon mint-bg"><Stethoscope size={22} /></div><strong>98.4%</strong><span>Complete patient profiles</span></div>
        <div className="record-card"><div className="record-icon gold-bg"><Clock3 size={22} /></div><strong>18 min</strong><span>Average review time</span></div>
      </div>
      <div className="patient-table records-table">
        <div className="table-row table-head"><span>Patient</span><span>Record ID</span><span>Last visit</span><span>Diagnosis</span><span>Clinician</span><span>Status</span><span /></div>
        {visibleRecords.map((record) => (
          <div className="table-row" key={record.recordId}>
            <div className="patient-name"><div className={`avatar avatar-${record.color}`}>{record.initials}</div><strong>{record.patient}</strong></div>
            <span>{record.recordId}</span>
            <span>{record.visit}</span>
            <span>{record.diagnosis}</span>
            <span>{record.clinician}</span>
            <span title={statusMeaning[record.status] ?? record.status}><em className={`status ${record.status.toLowerCase()}`}>{record.status}</em></span>
            <button className="more-button"><MoreHorizontal size={18} /></button>
          </div>
        ))}
      </div>
      <Pagination currentPage={currentPage} pageCount={pageCount} total={medicalRecords.length} pageSize={pageSize} onPageChange={setCurrentPage} />
    </section>
  )
}

function Pagination({ currentPage, pageCount, total, pageSize, onPageChange }: { currentPage: number; pageCount: number; total: number; pageSize: number; onPageChange: (page: number) => void }) {
  const firstItem = total === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const lastItem = Math.min(currentPage * pageSize, total)

  return (
    <div className="pagination">
      <span>Showing {firstItem}-{lastItem} of {total}</span>
      <div>
        <button className="pagination-button" disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
        {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
          <button className={`pagination-button ${page === currentPage ? 'active' : ''}`} key={page} onClick={() => onPageChange(page)}>{page}</button>
        ))}
        <button className="pagination-button" disabled={currentPage === pageCount} onClick={() => onPageChange(currentPage + 1)} aria-label="Next page"><ChevronRight size={15} /></button>
      </div>
    </div>
  )
}

function Reports() {
  return (
    <section className="panel page-panel">
      <div className="panel-header">
        <div>
          <h2>Reports & insights</h2>
          <p>Generate operational reports from your hospital data</p>
        </div>
        <button className="button button-primary"><Download size={17} /> Export all</button>
      </div>
      <div className="report-grid">
        <ReportCard title="Patient census" detail="Patient counts by department and demographic" date="Updated today" />
        <ReportCard title="Appointment summary" detail="Bookings, cancellations and attendance trends" date="Updated today" />
        <ReportCard title="Chief complaint breakdown" detail="Visit reasons filtered by date range" date="Updated yesterday" />
        <ReportCard title="Staff activity log" detail="User sign-ins and protected actions" date="Updated 18 min ago" />
      </div>
    </section>
  )
}

function Notifications({ broadcasts }: { broadcasts: Broadcast[] }) {
  return (
    <section className="panel page-panel">
      <div className="panel-header">
        <div>
          <h2>Notifications</h2>
          <p>Latest updates from the hospital workspace</p>
        </div>
      </div>
      <div className="activity-list">
        {broadcasts.map((broadcast) => (
          <div key={broadcast.id} className="activity-item">
            <div className="activity-icon blue"><Bell size={16} /></div>
            <div>
              <strong>{broadcast.title}</strong>
              <span>{broadcast.message}</span>
              <small>{broadcast.audience} · {broadcast.createdAt}</small>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ReportCard({ title, detail, date }: { title: string; detail: string; date: string }) {
  return (
    <button className="report-card">
      <div className="report-card-icon"><ClipboardList size={19} /></div>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
        <small>{date}</small>
      </div>
      <ArrowUpRight size={17} />
    </button>
  )
}

function StatCard({ icon: Icon, label, value, change, note, color }: { icon: typeof UsersRound; label: string; value: string; change: string; note: string; color: string }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${color}`}><Icon size={20} /></div>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <div className="stat-change"><span><ArrowUpRight size={13} /> {change}</span>{note}</div>
    </div>
  )
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="legend">
      <i className={`legend-dot ${color}-dot`} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function ActivityItem({ icon: Icon, text, by, time, color }: { icon: typeof UserRound; text: string; by: string; time: string; color: string }) {
  return (
    <div className="activity-item">
      <div className={`activity-icon ${color}`}><Icon size={16} /></div>
      <div>
        <strong>{text}</strong>
        <span>{by} <i /> {time}</span>
      </div>
    </div>
  )
}

function PatientModal({ onClose }: { onClose: () => void }) {
  const [selectedComplaints, setSelectedComplaints] = useState<string[]>([])
  const [otherComplaint, setOtherComplaint] = useState('')

  const toggleComplaint = (complaint: string) => {
    setSelectedComplaints((current) => current.includes(complaint)
      ? current.filter((item) => item !== complaint)
      : [...current, complaint])
    if (complaint === 'Other') setOtherComplaint('')
  }

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const record = {
      receivedBy: String(values.get('receivedBy') ?? '').trim() || 'Not provided',
      firstName: String(values.get('firstName') ?? '').trim(),
      lastName: String(values.get('lastName') ?? '').trim(),
      roomNumber: String(values.get('roomNumber') ?? '').trim(),
      phoneNumber: String(values.get('phoneNumber') ?? '').trim(),
      personnelName: String(values.get('personnelName') ?? '').trim() || 'Not provided',
      chiefComplaints: selectedComplaints.map((complaint) => complaint === 'Other' && otherComplaint.trim()
        ? `Other: ${otherComplaint.trim()}`
        : complaint),
      medicalHistory: String(values.get('medicalHistory') ?? '').trim(),
      savedAt: new Date().toISOString(),
    }

    try {
      const existing = JSON.parse(localStorage.getItem('medicare-records') ?? '[]') as Array<typeof record>
      localStorage.setItem('medicare-records', JSON.stringify([...existing, record]))
    } catch {
      localStorage.setItem('medicare-records', JSON.stringify([record]))
    }

    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">PATIENT REGISTRATION</p><h2>Add a new patient</h2></div>
          <button className="icon-btn" onClick={onClose}><X size={19} /></button>
        </div>
        <form className="patient-form" onSubmit={handleSave}>
          <div className="form-grid">
          <label className="wide attended-field">
            Attended / Received By
            <input name="receivedBy" placeholder="Enter full name or initials" />
            <small className="field-helper">Enter your staff details.</small>
          </label>
          <label>First name<input name="firstName" placeholder="e.g. Amina" /></label>
          <label>Last name<input name="lastName" placeholder="e.g. Yusuf" /></label>
          <label>Room number<input name="roomNumber" placeholder="e.g. Ward 3 / Room 12" /></label>
          <label>Phone number<input name="phoneNumber" type="tel" placeholder="+234 800 000 0000" /></label>
          <label className="wide">Personnel name<input name="personnelName" placeholder="Enter personnel name" /></label>
          <div className="wide complaint-picker">
            <label>Chief complaint</label>
            <div className="complaint-options">
              {complaints.map((complaint) => (
                <label key={complaint} className="complaint-option">
                  <input type="checkbox" name="chiefComplaint" value={complaint} checked={selectedComplaints.includes(complaint)} onChange={() => toggleComplaint(complaint)} />
                  <span>{complaint}</span>
                </label>
              ))}
            </div>
            {selectedComplaints.includes('Other') && <label className="other-complaint-field">Other sickness<input name="otherComplaint" value={otherComplaint} onChange={(event) => setOtherComplaint(event.target.value)} required maxLength={120} placeholder="Enter the sickness or complaint" /></label>}
            {selectedComplaints.length > 0 && <small className="field-helper">Selected: {selectedComplaints.map((complaint) => complaint === 'Other' && otherComplaint.trim() ? `Other: ${otherComplaint.trim()}` : complaint).join(', ')}</small>}
          </div>
          <label className="wide">Medical history summary<textarea name="medicalHistory" placeholder="Add a brief summary for the care team..." /></label>
          </div>
          <div className="modal-footer">
            <button type="button" className="button button-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="button button-primary"><Plus size={17} /> Save patient</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AppointmentModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">APPOINTMENT BOOKING</p><h2>Book a consultation</h2></div>
          <button className="icon-btn" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="form-grid">
          <label>Patient name<input placeholder="Search patient or enter name" /></label>
          <label>Appointment date<input type="date" /></label>
          <label>Time<input type="time" /></label>
          <label>Clinician<select defaultValue=""><option value="" disabled>Select doctor</option><option>Dr. Adaeze Okafor</option><option>Dr. Bello</option><option>Dr. Mensah</option></select></label>
          <label className="wide">Visit type<select defaultValue=""><option value="" disabled>Select appointment type</option><option>Consultation</option><option>Follow-up</option><option>Routine check-up</option><option>Emergency review</option></select></label>
          <label className="wide">Notes<textarea placeholder="Add appointment details or patient notes..." /></label>
        </div>
        <div className="modal-footer">
          <button className="button button-ghost" onClick={onClose}>Cancel</button>
          <button className="button button-primary" onClick={onClose}><Plus size={17} /> Book appointment</button>
        </div>
      </div>
    </div>
  )
}

function Login({ onLogin }: { onLogin: (role: Role) => void }) {
  const [showCreateAccount, setShowCreateAccount] = useState(false)
  const [selectedRole, setSelectedRole] = useState<Role>('Admin')

  if (showCreateAccount) return <Signup onBack={() => setShowCreateAccount(false)} />

  return (
    <div className="login-page">
      <div className="login-visual">
        <div className="login-orbit orbit-one" />
        <div className="login-orbit orbit-two" />
        <div className="login-brand">
          <div className="brand-mark"><CloudMark /></div>
          <strong>Infirmary Management System</strong>
          <span>Secure Access Portal</span>
        </div>
        <div className="login-visual-copy">
          <p className="eyebrow">A BETTER WAY TO CARE</p>
          <h1>Clarity for every<br /><em>patient journey.</em></h1>
          <p>One secure workspace for your care team to manage records, appointments and the moments that matter.</p>
          <div className="login-trust"><ShieldCheck size={17} /><span>Protected with enterprise-grade security</span></div>
        </div>
        <span className="login-version">IMS / v1.0.0</span>
      </div>

      <div className="login-form-wrap">
        <div className="login-form">
          <div className="login-user-icon"><UserRound size={30} /></div>
          <p className="eyebrow">WELCOME BACK</p>
          <h2>Sign in to your workspace</h2>
          <p className="login-helper">Use your hospital email to continue.</p>
          <form onSubmit={(event) => { event.preventDefault(); onLogin(selectedRole) }}>
            <label>Email address<input type="email" placeholder="you@hospital.com" defaultValue="admin@hospital.com" /></label>
            <label>Password<div className="password-input"><input type="password" placeholder="Enter your password" defaultValue="password" /><span>Show</span></div></label>
            <label>Role<select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as Role)}><option value="Admin">Admin</option><option value="Records Officer">Records Officer</option><option value="Doctor in Charge">Doctor in Charge</option></select></label>
            <div className="form-options">
              <label className="check-label"><input type="checkbox" defaultChecked /> Keep me signed in</label>
              <a href="#reset">Forgot password?</a>
            </div>
            <button className="button button-primary login-button">Sign in securely <ArrowUpRight size={17} /></button>
          </form>
          <div className="social-divider"><span>or continue with</span></div>
          <div className="social-buttons">
            <button type="button" className="social-button"><GoogleMark /> <span>Google</span></button>
            <button type="button" className="social-button"><AppleMark /> <span>Apple</span></button>
          </div>
          <div className="login-footer">
            <p>Need an account? <button type="button" className="text-button" onClick={() => setShowCreateAccount(true)}>Request access</button></p>
          </div>
        </div>
        <div className="login-copyright">© 2026 Infirmary Management System <span>·</span> Privacy & security</div>
      </div>
    </div>
  )
}

function BroadcastModal({ onClose, onSend }: { onClose: () => void; onSend: (message: string) => void }) {
  const [message, setMessage] = useState('')

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">ADMIN BROADCAST</p><h2>Send alert to Records Officers</h2></div>
          <button className="icon-btn" onClick={onClose}><X size={19} /></button>
        </div>

        <div className="form-grid">
          <label className="wide">Message<textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write a message to all Records Officers..." rows={5} /></label>
        </div>

        <div className="modal-footer">
          <button className="button button-ghost" onClick={onClose}>Cancel</button>
          <button className="button button-primary" onClick={() => onSend(message)}>Send broadcast</button>
        </div>
      </div>
    </div>
  )
}

function Signup({ onBack }: { onBack: () => void }) {
  return (
    <div className="login-page">
      <div className="login-visual">
        <div className="login-orbit orbit-one" />
        <div className="login-orbit orbit-two" />
        <div className="login-brand">
          <div className="brand-mark"><CloudMark /></div>
          <strong>Infirmary Management System</strong>
          <span>Secure Access Portal</span>
        </div>
        <div className="login-visual-copy">
          <p className="eyebrow">JOIN YOUR CARE TEAM</p>
          <h1>Care starts with<br /><em>connected people.</em></h1>
          <p>Create a staff account to access your hospital workspace. Your administrator will approve your role.</p>
        </div>
        <span className="login-version">IMS / v1.0.0</span>
      </div>

      <div className="login-form-wrap">
        <div className="login-form signup-form">
          <div className="login-user-icon"><UserRound size={30} /></div>
          <p className="eyebrow">STAFF REGISTRATION</p>
          <h2>Create your account</h2>
          <p className="login-helper">Use your hospital details to request access.</p>
          <form onSubmit={(event) => { event.preventDefault(); onBack() }}>
            <div className="signup-name-grid">
              <label>First name<input placeholder="Amina" required /></label>
              <label>Last name<input placeholder="Yusuf" required /></label>
            </div>
            <label>Hospital email<input type="email" placeholder="you@hospital.com" required /></label>
            <label>Role<select defaultValue=""><option value="" disabled>Select your role</option>{roles.map((role) => <option key={role}>{role}</option>)}</select></label>
            <label>Password<input type="password" placeholder="At least 8 characters" minLength={8} required /></label>
            <button className="button button-primary login-button">Request access <ArrowUpRight size={17} /></button>
          </form>
          <button type="button" className="back-login" onClick={onBack}>Back to sign in</button>
        </div>
        <div className="login-copyright">© 2026 Infirmary Management System <span>·</span> Privacy & security</div>
      </div>
    </div>
  )
}

function CloudMark() {
  return (
    <svg viewBox="0 0 32 24" fill="none" aria-hidden="true">
      <path d="M7.4 21.2a6.4 6.4 0 0 1-.8-12.75A9.05 9.05 0 0 1 23.9 7.1a5.8 5.8 0 0 1 .7 11.75H7.4Z" fill="white" fillOpacity=".18" stroke="white" strokeWidth="1.8" />
      <path d="m10.8 14.3 3.05 3.05 7.4-7.4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.23c0-.7-.06-1.38-.18-2.03H12v3.84h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.22c1.89-1.74 2.99-4.3 2.99-7.34Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.61-2.43l-3.22-2.51c-.9.6-2.05.96-3.39.96-2.61 0-4.83-1.76-5.62-4.13H3.05v2.59A9.98 9.98 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.38 13.89A6 6 0 0 1 6.06 12c0-.66.11-1.3.32-1.89V7.52H3.05A10 10 0 0 0 2 12c0 1.61.39 3.13 1.05 4.48l3.33-2.59Z" />
      <path fill="#EA4335" d="M12 5.98c1.47 0 2.79.5 3.83 1.49l2.87-2.87C16.96 2.99 14.7 2 12 2a9.98 9.98 0 0 0-8.95 5.52l3.33 2.59C7.17 7.74 9.39 5.98 12 5.98Z" />
    </svg>
  )
}

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M17.05 12.54c-.02-2.37 1.93-3.51 2.02-3.56a4.34 4.34 0 0 0-3.42-1.85c-1.44-.15-2.82.86-3.55.86-.74 0-1.88-.84-3.1-.81a4.57 4.57 0 0 0-3.84 2.34c-1.65 2.86-.42 7.07 1.18 9.39.78 1.13 1.7 2.39 2.91 2.34 1.18-.05 1.62-.75 3.04-.75 1.42 0 1.82.75 3.05.73 1.26-.02 2.06-1.14 2.83-2.28a9.36 9.36 0 0 0 1.28-2.64 4.09 4.09 0 0 1-2.4-3.77ZM14.72 5.61a4.07 4.07 0 0 0 .93-2.92 4.15 4.15 0 0 0-2.68 1.39 3.87 3.87 0 0 0-.96 2.81 3.43 3.43 0 0 0 2.71-1.28Z" />
    </svg>
  )
}

export default App
