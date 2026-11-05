import type { BackendRole, StaffUser } from '../../api/auth'
import type { Appointment } from '../../api/appointments'
import { ApiError, authErrorMessage } from '../../api/client'
import type { DraftInput, Encounter, EncounterStatus, EncounterSummary, AmendmentInput } from '../../api/encounters'
import { localInputToISO, toLocalInput } from '../appointments/appointment-time'
export const clinicalLabels: Record<EncounterStatus, string> = { DRAFT: 'Draft', REVIEWED: 'Finalized', VOIDED: 'Voided' }
export const hasClinicalAccess = (role: BackendRole) => role === 'DOCTOR_IN_CHARGE'
export const isClinicalAuthor = (user: StaffUser, encounter: EncounterSummary) => hasClinicalAccess(user.role) && encounter.clinician?.id === user.id && encounter.author.id === user.id
export const canEditDraft = (user: StaffUser, encounter: EncounterSummary) => isClinicalAuthor(user, encounter) && encounter.status === 'DRAFT'
export const canAmend = (user: StaffUser, encounter: EncounterSummary) => isClinicalAuthor(user, encounter) && encounter.status === 'REVIEWED'
export const canStartLinked = (user: StaffUser, appointment: Appointment) => hasClinicalAccess(user.role) && appointment.clinician?.id === user.id && ['CHECKED_IN', 'COMPLETED'].includes(appointment.status)
export type ClinicalFormValues = {
  occurredAt: string; followUpAt: string; roomLabel: string; historySummary: string; clinicalNotes: string; treatmentPlan: string
  complaints: { key: number; description: string }[]; diagnoses: { key: number; description: string; code: string; notes: string }[]
}
export function clinicalFormValues(encounter?: Encounter): ClinicalFormValues {
  return { occurredAt: toLocalInput(encounter?.occurredAt ?? new Date().toISOString()), followUpAt: encounter?.followUpAt ? toLocalInput(encounter.followUpAt) : '',
    roomLabel: encounter?.roomLabel ?? '', historySummary: encounter?.historySummary ?? '', clinicalNotes: encounter?.clinicalNotes ?? '', treatmentPlan: encounter?.treatmentPlan ?? '',
    complaints: encounter?.complaints.map((item, key) => ({ key, description: item.description })) ?? [],
    diagnoses: encounter?.diagnoses.map((item, key) => ({ key, description: item.description, code: item.code ?? '', notes: item.notes ?? '' })) ?? [] }
}
export function clinicalInput(values: ClinicalFormValues, encounter?: Encounter): DraftInput {
  const result: DraftInput = {}
  if (!encounter || values.occurredAt !== toLocalInput(encounter.occurredAt)) result.occurredAt = localInputToISO(values.occurredAt) ?? ''
  if (!encounter || values.followUpAt !== (encounter.followUpAt ? toLocalInput(encounter.followUpAt) : '')) result.followUpAt = values.followUpAt ? localInputToISO(values.followUpAt) ?? '' : null
  for (const key of ['roomLabel', 'historySummary', 'clinicalNotes', 'treatmentPlan'] as const) {
    const value = values[key].trim() || null
    if (!encounter || value !== encounter[key]) result[key] = value
  }
  const complaints = values.complaints.map(({ description }) => ({ description: description.trim() }))
  const diagnoses = values.diagnoses.map(({ description, code, notes }) => ({ description: description.trim(), code: code.trim() || null, notes: notes.trim() || null }))
  if (!encounter || JSON.stringify(complaints) !== JSON.stringify(encounter.complaints.map(({ description }) => ({ description })))) result.complaints = complaints
  if (!encounter || JSON.stringify(diagnoses) !== JSON.stringify(encounter.diagnoses.map(({ description, code, notes }) => ({ description, code, notes })))) result.diagnoses = diagnoses
  return result
}
const safeText = (value: string) => Array.from(value).every((character) => { const code = character.codePointAt(0)!; return [9, 10, 13].includes(code) || (code >= 32 && (code < 127 || code > 159)) })
export function validateClinical(values: ClinicalFormValues, encounter?: Encounter, now = Date.now()): string | null {
  const input = clinicalInput(values, encounter)
  const occurredAt = input.occurredAt ?? encounter?.occurredAt
  const followUpAt = input.followUpAt === undefined ? encounter?.followUpAt : input.followUpAt
  if (!occurredAt || (values.followUpAt && !followUpAt)) return 'Enter valid local encounter and follow-up times. Some times do not exist when clocks change.'
  if (Date.parse(occurredAt) > now + 60000) return 'Encounter time cannot be more than one minute in the future.'
  if (followUpAt && Date.parse(followUpAt) < Date.parse(occurredAt)) return 'Follow-up time must be at or after the encounter time.'
  if (values.roomLabel.length > 100) return 'Room allows up to 100 characters.'
  if ([values.historySummary, values.clinicalNotes, values.treatmentPlan].some((value) => value.length > 20000)) return 'Each clinical text field allows up to 20,000 characters.'
  if (values.complaints.length > 30 || values.diagnoses.length > 30) return 'An encounter allows up to 30 complaints and 30 diagnoses.'
  if (values.complaints.some((item) => !item.description.trim() || item.description.length > 200)) return 'Each complaint needs a description of 1 to 200 characters.'
  if (new Set(values.complaints.map((item) => item.description.trim())).size !== values.complaints.length) return 'Remove duplicate complaints.'
  if (values.diagnoses.some((item) => !item.description.trim() || item.description.length > 500 || item.code.length > 64 || item.notes.length > 5000)) return 'Each diagnosis needs a description (up to 500 characters), optional code (64) and optional notes (5,000).'
  const texts = [values.roomLabel, values.historySummary, values.clinicalNotes, values.treatmentPlan, ...values.complaints.map((item) => item.description), ...values.diagnoses.flatMap((item) => [item.description, item.code, item.notes])]
  if (texts.some((value) => !safeText(value))) return 'Remove unsupported control characters from the text.'
  if (new TextEncoder().encode(JSON.stringify(input)).length > 100 * 1024 - 512) return 'This draft is too long to save in one go. Shorten the content before saving.'
  if (encounter && !Object.keys(input).length) return 'No changes to save.'
  return null
}
export function validateAmendment(input: AmendmentInput) {
  if (!input.reason.trim() || !input.content.trim()) return 'Enter both a reason and amendment content.'
  if (input.reason.length > 1000 || input.content.length > 20000) return 'Reason allows 1,000 characters; amendment content allows 20,000.'
  if (!safeText(input.reason + input.content)) return 'Remove unsupported control characters from the text.'
  if (new TextEncoder().encode(JSON.stringify(input)).length > 100 * 1024 - 512) return 'This amendment is too long to add in one go. Shorten the content before submitting.'
  return null
}
const errors: Record<string, string> = {
  ENCOUNTER_NOT_FOUND: 'Clinical record not found.',
  ENCOUNTER_FINALIZED: 'This record has been finalized. Refresh it to view the permanent record and use an amendment for corrections.',
  ENCOUNTER_NOT_EDITABLE: 'This clinical record cannot be edited. Refresh to see its current status.',
  ENCOUNTER_NOT_FINALIZED: 'Only finalized clinical records can receive amendments. Refresh the record.',
  ENCOUNTER_AUTHOR_REQUIRED: 'Only the original clinical author can perform this action.',
  DUPLICATE_AMENDMENT: 'This exact amendment is already part of the permanent record. Close this dialog and refresh the clinical record to review it.',
  APPOINTMENT_NOT_ELIGIBLE_FOR_ENCOUNTER: 'This appointment is not eligible. It must be assigned to you, match the patient, and be checked in or completed.',
  APPOINTMENT_ALREADY_HAS_ENCOUNTER: 'This appointment already has a clinical record. Open the existing record instead.',
  ENCOUNTER_REFERENCE_CONFLICT: 'The record reference could not be allocated. Please try again.',
  EMPTY_CLINICAL_RECORD: 'Add a history summary, clinical notes, treatment plan, complaint or diagnosis before finalizing.',
  INVALID_ENCOUNTER_TIME: 'Check the encounter and follow-up times. Encounter time must have been reached before finalization.',
  PATIENT_ARCHIVED: 'This patient is archived. Reactivation is required to create, edit or finalize an encounter. Existing finalized records can still receive permitted amendments.',
  PATIENT_NOT_FOUND: 'Patient not found.', APPOINTMENT_NOT_FOUND: 'Appointment not found.',
}
export function clinicalError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code && errors[error.code]) return errors[error.code]
    if (error.status === 404) return 'Clinical record not found.'
    if (error.status === 401) return 'Your session has expired. Sign in again.'
    if (error.status === 413) return 'The clinical content is too long to save in one go. Shorten it before submitting.'
  }
  return authErrorMessage(error)
}
