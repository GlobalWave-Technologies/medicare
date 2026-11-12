// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { admissionsApi, type Admission, type AdmissionQuery } from '../src/api/admissions'
import type { BackendRole, StaffUser } from '../src/api/auth'
import { ApiError } from '../src/api/client'
import { dashboardApi } from '../src/api/dashboard'
import { encountersApi, type Encounter } from '../src/api/encounters'
import { medicationsApi } from '../src/api/medications'
import { notificationsApi } from '../src/api/notifications'
import { patientsApi, type Patient } from '../src/api/patients'
import { App } from '../src/app/App'
import { clinician } from './admission-fixtures'
import { catalogOptions, encounter as encounterTemplate } from './clinical-fixtures'
import { dashboardFor } from './report-fixtures'

// The whole Phase 19A journey through the real application composition, against an in-memory
// API that applies the same rules as the server: one current stay, no discharge over a draft,
// no new record on a discharged stay, discharge notes only for Medical Officers.
const identity = vi.hoisted(() => ({ role: 'DOCTOR_IN_CHARGE' as BackendRole }))
const me = () => ({ ...clinician, email: 'qa@example.test', role: identity.role, status: 'ACTIVE' as const, mustChangePassword: false })
vi.mock('../src/features/auth/AuthGate', () => ({ AuthGate: ({ children }: { children: (user: StaffUser) => ReactNode }) => children(me()) }))
let root: Root, host: HTMLDivElement, patients: Omit<Patient, 'currentAdmission'>[], stays: Admission[], records: Encounter[], serial: number
const now = () => new Date().toISOString()
const withStay = (patient: Omit<Patient, 'currentAdmission'>): Patient => {
  const current = stays.find((stay) => stay.patient.id === patient.id && stay.status === 'ADMITTED')
  return { ...patient, currentAdmission: current ? { id: current.id, admissionNumber: current.admissionNumber, roomNumber: current.roomNumber, admittedAt: current.admittedAt } : null }
}
const view = (stay: Admission): Admission => {
  const { dischargeNotes, ...rest } = stay
  return identity.role === 'DOCTOR_IN_CHARGE' ? { ...rest, dischargeNotes: dischargeNotes ?? null } : rest
}
const page = <T,>(items: T[]) => ({ items, pagination: { page: 1, limit: 20, total: items.length, totalPages: items.length ? 1 : 0 } })
const staff = () => ({ id: clinician.id, staffNumber: clinician.staffNumber, firstName: clinician.firstName, lastName: clinician.lastName })
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-11T09:00:00Z')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); patients = []; stays = []; records = []; serial = 0
  vi.spyOn(window, 'confirm').mockReturnValue(true); vi.spyOn(Storage.prototype, 'setItem')
  vi.spyOn(dashboardApi, 'get').mockImplementation(async () => dashboardFor(identity.role))
  vi.spyOn(notificationsApi, 'unreadCount').mockResolvedValue({ count: 0 })
  vi.spyOn(medicationsApi, 'options').mockResolvedValue({ items: catalogOptions })
  vi.spyOn(patientsApi, 'list').mockImplementation(async (query) => page(patients.filter((item) => query?.archived === 'all' || Boolean(item.archivedAt) === (query?.archived === 'true')).map(withStay)))
  vi.spyOn(patientsApi, 'get').mockImplementation(async (id) => ({ patient: withStay(patients.find((item) => item.id === id)!) }))
  vi.spyOn(patientsApi, 'create').mockImplementation(async (input) => {
    const patient = { id: `patient-${++serial}`, patientNumber: `PT-SYNTHETIC-${serial}`, firstName: input.firstName, middleName: input.middleName ?? null, lastName: input.lastName,
      dateOfBirth: input.dateOfBirth ?? null, phone: null, archivedAt: null, createdAt: now(), updatedAt: now() }
    patients.push(patient); return { patient: withStay(patient) }
  })
  vi.spyOn(admissionsApi, 'list').mockImplementation(async (query: AdmissionQuery = {}) => page(stays.filter((stay) => (!query.status || stay.status === query.status)
    && (!query.patientId || stay.patient.id === query.patientId)).map(view).reverse()))
  vi.spyOn(admissionsApi, 'get').mockImplementation(async (id) => ({ admission: view(stays.find((stay) => stay.id === id)!) }))
  vi.spyOn(admissionsApi, 'admit').mockImplementation(async (input) => {
    if (stays.some((stay) => stay.patient.id === input.patientId && stay.status === 'ADMITTED')) throw new ApiError(409, 'This patient is already admitted.', 'PATIENT_ALREADY_ADMITTED')
    const patient = patients.find((item) => item.id === input.patientId)!, at = input.admittedAt ?? now(), number = stays.length + 1
    const stay: Admission = { id: `stay-${number}`, admissionNumber: `AD-00000${number}`, status: 'ADMITTED', roomNumber: input.roomNumber, admittedAt: at, dischargedAt: null,
      patient: { id: patient.id, patientNumber: patient.patientNumber, firstName: patient.firstName, middleName: patient.middleName, lastName: patient.lastName },
      admittedBy: staff(), dischargedBy: null, createdAt: at, updatedAt: at, rooms: [{ id: `room-${number}-1`, roomNumber: input.roomNumber, note: null, assignedAt: at, endedAt: null, assignedBy: staff() }] }
    stays.push(stay); return { admission: view(stay) }
  })
  vi.spyOn(admissionsApi, 'changeRoom').mockImplementation(async (id, input) => {
    const stay = stays.find((item) => item.id === id)!, at = now()
    stay.rooms = [...stay.rooms.map((room) => room.endedAt ? room : { ...room, endedAt: at }), { id: `room-${stay.rooms.length + 1}`, roomNumber: input.roomNumber, note: input.note ?? null, assignedAt: at, endedAt: null, assignedBy: staff() }]
    stay.roomNumber = input.roomNumber; return { admission: view(stay) }
  })
  vi.spyOn(admissionsApi, 'discharge').mockImplementation(async (id, input) => {
    const stay = stays.find((item) => item.id === id)!
    if (records.some((record) => record.admission?.id === id && record.status === 'DRAFT')) throw new ApiError(409, 'This admission has an unfinished clinical record.', 'ADMISSION_HAS_DRAFT_RECORDS')
    const at = input?.dischargedAt ?? now()
    Object.assign(stay, { status: 'DISCHARGED', dischargedAt: at, dischargedBy: staff(), dischargeNotes: input?.dischargeNotes ?? null, rooms: stay.rooms.map((room) => room.endedAt ? room : { ...room, endedAt: at }) })
    return { admission: view(stay) }
  })
  const summaries = (items: Encounter[]) => page(items.map(({ id, reference, status, occurredAt, reviewedAt, createdAt, patient, clinician: who, author, admission, appointment, diagnoses }) =>
    ({ id, reference, status, occurredAt, reviewedAt, createdAt, patient, clinician: who, author, admission, appointment, diagnoses: diagnoses.map(({ id: key, description, code }) => ({ id: key, description, code })) })))
  vi.spyOn(encountersApi, 'list').mockImplementation(async (query) => summaries(records.filter((record) => !query?.admissionId || record.admission?.id === query.admissionId)))
  vi.spyOn(encountersApi, 'history').mockImplementation(async (patientId) => summaries(records.filter((record) => record.patient.id === patientId)))
  vi.spyOn(encountersApi, 'get').mockImplementation(async (id) => ({ encounter: records.find((record) => record.id === id)! }))
  // The server's filters: one stay's orders, or every other order of the patient.
  vi.spyOn(encountersApi, 'medications').mockImplementation(async (patientId, query = {}) => page(records.filter((record) => record.patient.id === patientId
    && (!query.admissionId || record.admission?.id === query.admissionId) && (!query.excludeAdmissionId || record.admission?.id !== query.excludeAdmissionId))
    .flatMap((record) => record.medications.map((order) => {
      const stay = stays.find((item) => item.id === record.admission?.id)
      return { ...order, encounter: { id: record.id, reference: record.reference, status: record.status, occurredAt: record.occurredAt, reviewedAt: record.reviewedAt, clinician: record.clinician,
        admission: stay ? { id: stay.id, admissionNumber: stay.admissionNumber, status: stay.status, admittedAt: stay.admittedAt, dischargedAt: stay.dischargedAt } : null } }
    }))))
  vi.spyOn(encountersApi, 'create').mockImplementation(async (input) => {
    const stay = stays.find((item) => item.id === input.admissionId)!
    if (stay.status !== 'ADMITTED') throw new ApiError(409, 'Not current', 'ADMISSION_NOT_CURRENT')
    const record: Encounter = { ...encounterTemplate, id: `record-${records.length + 1}`, reference: `MR-SYNTHETIC-${records.length + 1}`, patient: stay.patient, clinician: staff(), author: staff(),
      admission: { id: stay.id, admissionNumber: stay.admissionNumber }, roomLabel: input.roomLabel ?? null, clinicalNotes: input.clinicalNotes ?? null, historySummary: null, treatmentPlan: null,
      complaints: [], diagnoses: (input.diagnoses ?? []).map((item, index) => ({ id: `diagnosis-${index}`, description: item.description, code: item.code ?? null, notes: item.notes ?? null, createdAt: now() })),
      // The server copies the catalog name onto the order.
      medications: (input.medications ?? []).map((item, index) => ({ id: `medication-${index}`, medicationId: item.medicationId, medicine: catalogOptions.find((option) => option.id === item.medicationId)!.name,
        strength: item.strength ?? null, dose: item.dose, route: item.route, frequency: item.frequency, duration: item.duration ?? null, notes: item.notes ?? null, createdAt: now() })),
      occurredAt: now(), createdAt: now(), updatedAt: now(), followUpAt: null }
    records.push(record); return { encounter: record }
  })
  vi.spyOn(encountersApi, 'finalize').mockImplementation(async (id) => {
    const record = records.find((item) => item.id === id)!
    Object.assign(record, { status: 'REVIEWED', reviewedAt: now() }); return { encounter: record }
  })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })

const visible = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter((button) => !button.closest('[hidden]'))
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(400) }) }
const find = (text: string) => visible().find((button) => button.textContent?.trim() === text)
async function click(text: string) { const target = find(text); expect(target, text).toBeDefined(); await act(async () => target!.click()); await tick() }
async function fill(name: string, value: string) {
  await act(async () => {
    type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    const input = host.querySelector<Field>(`[role="dialog"] [name="${name}"]`) ?? host.querySelector<Field>(`[name="${name}"]`)!
    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
// Chooses a medicine from the searchable list the way staff do: type part of the name, then Enter.
async function chooseMedicine(search: string) {
  await fill('medication-medicine', search)
  await act(async () => { host.querySelector('[name="medication-medicine"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
}
const submit = async () => { await act(async () => { host.querySelector('[role="dialog"] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await tick() }
const dialog = () => host.querySelector('[role="dialog"]')
const text = () => host.textContent ?? ''
const start = async () => { await act(async () => root.render(<App />)); await tick() }
async function registerAndAdmit(last = 'Cycle', room = 'Ward A - Bed 6') {
  await click('Patients'); await click('Register patient'); await fill('firstName', 'Synthetic'); await fill('lastName', last); await click('Register & admit')
  expect(dialog()?.querySelector('h2')?.textContent).toBe('Admit patient'); expect(dialog()?.textContent).toContain('Patient registered. Now record the admission.')
  await fill('roomNumber', room); await submit()
}

it.each(['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const)('%s navigation has no Appointments, and Reports only for Admin and Records', async (role) => {
  identity.role = role; await start()
  const nav = Array.from(host.querySelectorAll('.desktop-sidebar nav button')).map((button) => button.textContent)
  expect(nav).toEqual({ ADMIN: ['Overview', 'Patients', 'Staff & Access', 'Staff Activity', 'Medication Catalog', 'Notifications', 'Reports'], RECORDS_OFFICER: ['Overview', 'Patients', 'Notifications', 'Reports'],
    DOCTOR_IN_CHARGE: ['Overview', 'Patients', 'Medical Records', 'Notifications'] }[role])
  expect(text()).not.toMatch(/ppointment/)
  expect(host.querySelector('.desktop-sidebar')?.textContent).toContain(role === 'DOCTOR_IN_CHARGE' ? 'Medical Officer' : role === 'ADMIN' ? 'Administrator' : 'Records Officer')
})

it('a Medical Officer registers & admits, changes room, treats, is stopped by a draft, discharges, reviews history and re-admits', async () => {
  identity.role = 'DOCTOR_IN_CHARGE'; await start()
  await registerAndAdmit()
  expect(admissionsApi.admit).toHaveBeenCalledWith({ patientId: 'patient-1', roomNumber: 'Ward A - Bed 6' }, expect.stringMatching(/^[0-9a-f-]{32,36}$/))
  const detail = () => host.querySelector('.patient-detail')?.textContent ?? ''
  expect(detail()).toContain('Patient admitted to Ward A - Bed 6.'); expect(detail()).toContain('AD-000001'); expect(detail()).toContain('Admitted')
  // Room transfer keeps history.
  await click('Change room'); await fill('roomNumber', 'Male Ward 2'); await fill('note', 'Synthetic transfer'); await submit()
  expect(admissionsApi.changeRoom).toHaveBeenCalledWith('stay-1', { roomNumber: 'Male Ward 2', note: 'Synthetic transfer' }); expect(detail()).toContain('Room changed to Male Ward 2.')
  // Medical record on the current admission: diagnosis and medication.
  await click('Open medical record')
  expect(host.querySelector('.admission-banner')?.textContent).toContain('Male Ward 2')
  await click('New clinical record'); expect(host.querySelector<HTMLInputElement>('[name="roomLabel"]')!.value).toBe('Male Ward 2')
  await fill('clinicalNotes', 'Synthetic ward round'); await click('Add diagnosis'); await fill('diagnosis-0-description', 'Synthetic diagnosis')
  await click('Add medication'); await chooseMedicine('para'); await fill('medication-strength', '500 mg'); await fill('medication-dose', '1 tablet')
  await fill('medication-route', 'Oral'); await fill('medication-frequency', 'Three times daily'); await click('Add to record'); await submit()
  expect(encountersApi.create).toHaveBeenCalledWith(expect.objectContaining({ admissionId: 'stay-1', clinicalNotes: 'Synthetic ward round',
    diagnoses: [{ description: 'Synthetic diagnosis', code: null, notes: null }],
    medications: [{ medicationId: 'catalog-paracetamol', strength: '500 mg', dose: '1 tablet', route: 'Oral', frequency: 'Three times daily', duration: null, notes: null }] }), expect.any(String))
  expect(host.querySelector('.clinical-detail')?.textContent).toContain('Draft saved.')
  await click('Back to AD-000001')
  expect(host.querySelector('.medication-history')?.textContent).toContain('Paracetamol 500 mg')
  // Discharge refuses an unfinished record and keeps it.
  await click('Discharge patient'); expect(dialog()?.textContent).toContain('Discharging this patient will close the current admission and remove them from Currently admitted. Their admission, room history, clinical records and medications stay in their history.')
  await submit(); expect(dialog()?.textContent).toContain('This admission has an unfinished clinical record. Finalize or complete the draft record before discharging the patient.'); expect(records[0]!.status).toBe('DRAFT')
  await click('Cancel')
  await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('.clinical-open')).find((item) => item.textContent?.includes('MR-SYNTHETIC-1'))!.click()); await tick()
  await click('Finalize record'); await submit(); await click('Back to AD-000001')
  await click('Discharge patient'); await fill('dischargeNotes', 'Synthetic discharge summary'); await submit()
  expect(admissionsApi.discharge).toHaveBeenLastCalledWith('stay-1', { dischargeNotes: 'Synthetic discharge summary' })
  expect(text()).toContain('Patient discharged. Their medical history remains available.'); expect(host.querySelector('.admission-banner')?.textContent).toContain('Discharged')
  expect(find('New clinical record')).toBeUndefined(); expect(find('Discharge patient')).toBeUndefined()
  // Patient record: active, not admitted, with the past stay and its full history.
  await click('Back to patient')
  expect(detail()).toContain('Not currently admitted'); expect(host.querySelector('.detail-title .status')?.textContent).toBe('Not admitted'); expect(host.querySelector('[aria-label="Previous admissions"]')?.textContent).toContain('AD-000001')
  await click('View record AD-000001')
  const record = host.querySelector('.admission-record')?.textContent ?? ''
  for (const value of ['Ward A - Bed 6', 'Male Ward 2', 'Synthetic transfer', 'Synthetic discharge summary', 'MR-SYNTHETIC-1', 'Paracetamol 500 mg', 'read-only']) expect(record).toContain(value)
  await click('Back to patient')
  // Patients workspace: the stay is off the current list and on the discharged list.
  await click('Back to Patients'); await click('Currently admitted'); expect(text()).toContain('No patients are currently admitted.')
  await click('Discharged'); expect(host.querySelector('[aria-label="Discharged admissions"]')?.textContent).toContain('AD-000001')
  // Re-admission of the same permanent record.
  await click('All patients'); await click('Synthetic Cycle'); await click('Admit patient'); await fill('roomNumber', 'Private Room 3'); await submit()
  expect(detail()).toContain('AD-000002'); expect(detail()).toContain('Private Room 3'); expect(patients).toHaveLength(1)
  expect(Storage.prototype.setItem).not.toHaveBeenCalled()
})

it.each(['ADMIN', 'RECORDS_OFFICER'] as const)('%s registers, admits and changes rooms, but cannot discharge or reach clinical records', async (role) => {
  identity.role = role; await start()
  await registerAndAdmit('Operational', 'Room 4')
  const detail = host.querySelector('.patient-detail')?.textContent ?? ''
  expect(detail).toContain('AD-000001'); expect(detail).toContain('Clinical records are kept by Medical Officers')
  expect(find('Discharge patient')).toBeUndefined(); expect(find('Open medical record')).toBeUndefined(); expect(find('View clinical history')).toBeUndefined()
  await click('Change room'); await fill('roomNumber', 'Room 5'); await submit(); expect(admissionsApi.changeRoom).toHaveBeenCalledOnce()
  await click('Back to Patients'); await click('Currently admitted')
  expect(host.querySelector('[aria-label="Currently admitted patients"]')?.textContent).toContain('Room 5')
  expect(visible().some((button) => /^(Medical record|Discharge) /.test(button.textContent ?? ''))).toBe(false)
  await click('Synthetic Operational'); await click('View admission')
  expect(host.querySelector('.admission-record')?.textContent).not.toContain('Discharge note')
  expect(encountersApi.list).not.toHaveBeenCalled(); expect(encountersApi.history).not.toHaveBeenCalled(); expect(encountersApi.medications).not.toHaveBeenCalled()
})

it('says "This patient is already admitted." and offers the current admission instead of a second stay', async () => {
  identity.role = 'RECORDS_OFFICER'; await start()
  await registerAndAdmit('Twice')
  await click('Back to Patients')
  // A stale stay list still offers Admit patient; the server refuses the second stay.
  vi.mocked(admissionsApi.list).mockResolvedValueOnce(page([]))
  await click('Synthetic Twice'); await click('Admit patient'); await fill('roomNumber', 'Room 9'); await submit()
  expect(dialog()?.textContent).toContain('This patient is already admitted.')
  await click('Open current admission')
  expect(dialog()).toBeNull(); expect(stays).toHaveLength(1); expect(host.querySelector('.patient-detail')?.textContent).toContain('AD-000001')
})

it('a Medical Officer can discharge from the Currently admitted list, and the list refreshes', async () => {
  identity.role = 'DOCTOR_IN_CHARGE'; await start()
  await registerAndAdmit('Listed')
  await click('Back to Patients'); await click('Currently admitted')
  await click('Discharge Synthetic Listed')
  await submit()
  expect(admissionsApi.discharge).toHaveBeenCalledWith('stay-1', {}); expect(text()).toContain('No patients are currently admitted.')
})

it('keeps other clinicians’ records readable without edit controls', async () => {
  identity.role = 'DOCTOR_IN_CHARGE'; await start()
  await registerAndAdmit('Shared')
  records.push({ ...encounterTemplate, id: 'record-other', reference: 'MR-OTHER', admission: { id: 'stay-1', admissionNumber: 'AD-000001' }, author: { ...clinician, id: 'other' }, clinician: { ...clinician, id: 'other' } })
  await click('Open medical record')
  await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('.clinical-open')).find((item) => item.textContent?.includes('MR-OTHER'))!.click()); await tick()
  expect(host.querySelector('.clinical-detail')?.textContent).toContain('Original clinical notes')
  expect(visible().some((button) => /Edit draft|Finalize record|Add amendment/.test(button.textContent ?? ''))).toBe(false)
})
