import type { StaffRole } from '../../generated/prisma/client.js'
import { AppError } from '../errors/AppError.js'

export const permissions = [
  'DASHBOARD_VIEW_ADMIN', 'DASHBOARD_VIEW_RECORDS', 'DASHBOARD_VIEW_CLINICAL',
  'REPORT_OPERATIONAL_VIEW',
  'NOTIFICATION_READ_OWN', 'NOTIFICATION_MANAGE_OWN', 'NOTIFICATION_BROADCAST',
  'PATIENT_READ', 'PATIENT_CREATE', 'PATIENT_UPDATE', 'PATIENT_ARCHIVE',
  'ADMISSION_READ', 'ADMISSION_CREATE', 'ADMISSION_UPDATE', 'ADMISSION_DISCHARGE',
  'CLINICAL_RECORD_READ', 'CLINICAL_RECORD_CREATE', 'CLINICAL_RECORD_AMEND',
  'MEDICATION_CATALOG_READ', 'MEDICATION_CATALOG_MANAGE',
] as const
export type Permission = typeof permissions[number]

// DOCTOR_IN_CHARGE is the stored code for the Medical Officer role.
// Admission (admit and change room) is shared by every role; only Medical Officers discharge,
// and only Medical Officers read or write clinical records. Appointments are no longer a workflow.
// The medication catalog is a list of names, not clinical data: Admin manages it and Medical
// Officers prescribe from it. Managing it grants no access to anyone's prescriptions.
const rolePermissions: Record<StaffRole, readonly Permission[]> = {
  ADMIN: ['NOTIFICATION_READ_OWN', 'NOTIFICATION_MANAGE_OWN', 'NOTIFICATION_BROADCAST', 'PATIENT_READ', 'PATIENT_CREATE', 'PATIENT_UPDATE', 'PATIENT_ARCHIVE',
    'ADMISSION_READ', 'ADMISSION_CREATE', 'ADMISSION_UPDATE', 'DASHBOARD_VIEW_ADMIN', 'REPORT_OPERATIONAL_VIEW',
    'MEDICATION_CATALOG_READ', 'MEDICATION_CATALOG_MANAGE'],
  RECORDS_OFFICER: ['NOTIFICATION_READ_OWN', 'NOTIFICATION_MANAGE_OWN', 'PATIENT_READ', 'PATIENT_CREATE', 'PATIENT_UPDATE', 'PATIENT_ARCHIVE',
    'ADMISSION_READ', 'ADMISSION_CREATE', 'ADMISSION_UPDATE', 'DASHBOARD_VIEW_RECORDS', 'REPORT_OPERATIONAL_VIEW'],
  DOCTOR_IN_CHARGE: ['NOTIFICATION_READ_OWN', 'NOTIFICATION_MANAGE_OWN', 'PATIENT_READ', 'PATIENT_CREATE',
    'ADMISSION_READ', 'ADMISSION_CREATE', 'ADMISSION_UPDATE', 'ADMISSION_DISCHARGE',
    'CLINICAL_RECORD_READ', 'CLINICAL_RECORD_CREATE', 'CLINICAL_RECORD_AMEND', 'DASHBOARD_VIEW_CLINICAL', 'MEDICATION_CATALOG_READ'],
}

export function hasPermission(role: StaffRole, permission: Permission) {
  return rolePermissions[role].includes(permission)
}

export function assertPermission(role: StaffRole, permission: Permission) {
  if (!hasPermission(role, permission)) throw new AppError(403, 'FORBIDDEN', 'Permission denied')
}
