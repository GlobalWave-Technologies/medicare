import type { AuditAction } from '../../generated/prisma/client.js'

// The Staff Activity view shows only the actions listed here, as plain sentences. Everything else
// in the audit log stays out of it: record views (who opened which patient or record), failed
// sign-in attempts, retired appointment events and system bootstrap. Sentences never contain
// clinical text, medicines, rooms or patient identifiers; only staff names appear, and only for
// actions on staff accounts.
export const activityCategories = ['authentication', 'patients', 'admissions', 'clinical', 'staff', 'catalog'] as const
export type ActivityCategory = typeof activityCategories[number]
type Subject = string | null
type Label = { category: ActivityCategory; text: (subject: Subject, self: boolean) => string }

const someone = (subject: Subject) => subject ?? 'a staff member'
const possessive = (subject: Subject) => subject ? `${subject}’s` : 'a staff member’s'
const labels = {
  LOGIN_SUCCEEDED: { category: 'authentication', text: () => 'Signed in' },
  LOGOUT: { category: 'authentication', text: () => 'Signed out' },
  SESSION_REVOKED: { category: 'authentication', text: (subject, self) => self ? 'Signed out on all devices' : `Signed ${someone(subject)} out on all devices` },
  STAFF_SESSION_REVOKED: { category: 'authentication', text: (subject) => `Ended a session for ${someone(subject)}` },
  PASSWORD_CHANGED: { category: 'authentication', text: () => 'Changed their password' },
  PATIENT_CREATED: { category: 'patients', text: () => 'Registered a patient' },
  PATIENT_UPDATED: { category: 'patients', text: () => 'Updated a patient’s details' },
  PATIENT_ARCHIVED: { category: 'patients', text: () => 'Archived a patient record' },
  PATIENT_REACTIVATED: { category: 'patients', text: () => 'Reactivated a patient record' },
  PATIENT_ADMITTED: { category: 'admissions', text: () => 'Admitted a patient' },
  PATIENT_READMITTED: { category: 'admissions', text: () => 'Readmitted a patient' },
  ADMISSION_ROOM_CHANGED: { category: 'admissions', text: () => 'Changed a patient’s room' },
  PATIENT_DISCHARGED: { category: 'admissions', text: () => 'Discharged a patient' },
  MEDICAL_RECORD_CREATED: { category: 'clinical', text: () => 'Created a draft clinical record' },
  MEDICAL_RECORD_UPDATED: { category: 'clinical', text: () => 'Updated a draft clinical record' },
  MEDICAL_RECORD_FINALIZED: { category: 'clinical', text: () => 'Finalized a clinical record' },
  MEDICAL_RECORD_AMENDED: { category: 'clinical', text: () => 'Added an amendment to a clinical record' },
  STAFF_CREATED: { category: 'staff', text: (subject) => `Created a staff account for ${someone(subject)}` },
  STAFF_ROLE_CHANGED: { category: 'staff', text: (subject) => `Changed ${possessive(subject)} role` },
  STAFF_STATUS_CHANGED: { category: 'staff', text: (subject) => `Changed ${possessive(subject)} account status` },
  PASSWORD_RESET: { category: 'staff', text: (subject) => `Reset ${possessive(subject)} password` },
  NOTIFICATION_BROADCAST_CREATED: { category: 'staff', text: () => 'Sent a notice to staff' },
  MEDICATION_CREATED: { category: 'catalog', text: () => 'Added a medicine to the catalog' },
  MEDICATION_DEACTIVATED: { category: 'catalog', text: () => 'Deactivated a medicine in the catalog' },
  MEDICATION_REACTIVATED: { category: 'catalog', text: () => 'Reactivated a medicine in the catalog' },
} as const satisfies Partial<Record<AuditAction, Label>>
export type ActivityAction = keyof typeof labels
export const activityLabels: Record<ActivityAction, Label> = labels
export const shownActions = Object.keys(activityLabels) as ActivityAction[]
export const actionsIn = (category: ActivityCategory | 'all') => category === 'all' ? shownActions
  : shownActions.filter((action) => activityLabels[action].category === category)
// Actions whose target is a staff account, so the target's name may be part of the sentence.
export const staffSubjectActions: readonly ActivityAction[] = ['SESSION_REVOKED', 'STAFF_SESSION_REVOKED', 'STAFF_CREATED', 'STAFF_ROLE_CHANGED', 'STAFF_STATUS_CHANGED', 'PASSWORD_RESET']
