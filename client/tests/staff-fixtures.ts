import type { StaffUser } from '../src/api/auth'
import type { StaffMember, StaffPage } from '../src/api/staff'

export const signedIn: StaffUser = {
  id: '10000000-0000-4000-8000-000000000001', staffNumber: 'STF-ADMIN001', firstName: 'Ada', lastName: 'Admin',
  email: 'ada.admin@example.test', role: 'ADMIN', status: 'ACTIVE',
}
export const self: StaffMember = { ...signedIn }
export const officer: StaffMember = {
  id: '20000000-0000-4000-8000-000000000002', staffNumber: 'STF-REC00002', firstName: 'Rhea', lastName: 'Records',
  email: 'rhea.records@example.test', role: 'RECORDS_OFFICER', status: 'ACTIVE',
}
export const doctor: StaffMember = {
  id: '30000000-0000-4000-8000-000000000003', staffNumber: 'STF-DOC00003', firstName: 'Dara', lastName: 'Doctor',
  email: 'dara.doctor@example.test', role: 'DOCTOR_IN_CHARGE', status: 'SUSPENDED',
}
export const pending: StaffMember = {
  id: '40000000-0000-4000-8000-000000000004', staffNumber: 'STF-PEN00004', firstName: 'Pat', lastName: 'Pending',
  email: 'pat.pending@example.test', role: 'RECORDS_OFFICER', status: 'PENDING',
}
export const disabled: StaffMember = {
  id: '50000000-0000-4000-8000-000000000005', staffNumber: 'STF-DIS00005', firstName: 'Dee', lastName: 'Disabled',
  email: 'dee.disabled@example.test', role: 'DOCTOR_IN_CHARGE', status: 'DISABLED',
}
export const otherAdmin: StaffMember = {
  id: '60000000-0000-4000-8000-000000000006', staffNumber: 'STF-ADM00006', firstName: 'Avery', lastName: 'Admin',
  email: 'avery.admin@example.test', role: 'ADMIN', status: 'ACTIVE',
}
export const staffPage = (users: StaffMember[] = [self, officer, doctor], page = 1, total = users.length, limit = 20): StaffPage =>
  ({ users, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } })
export const validForm = {
  firstName: 'Nia', lastName: 'Newhire', email: 'nia.newhire@example.test', staffNumber: 'stf-new00007',
  password: 'correct horse battery staple', confirmPassword: 'correct horse battery staple',
}
export const created: StaffMember = {
  id: '70000000-0000-4000-8000-000000000007', staffNumber: 'STF-NEW00007', firstName: 'Nia', lastName: 'Newhire',
  email: 'nia.newhire@example.test', role: 'DOCTOR_IN_CHARGE', status: 'ACTIVE',
}
