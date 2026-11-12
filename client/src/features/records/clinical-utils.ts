import type { BackendRole, StaffUser } from '../../api/auth'
import { ApiError, authErrorMessage } from '../../api/client'
import type { DraftInput, Encounter, EncounterStatus, EncounterSummary, AmendmentInput, Medication, MedicationInput } from '../../api/encounters'
import { localInputToISO, toLocalInput } from '../../lib/time'
export const clinicalLabels: Record<EncounterStatus, string> = { DRAFT: 'Draft', REVIEWED: 'Finalized', VOIDED: 'Voided' }
export const hasClinicalAccess = (role: BackendRole) => role === 'DOCTOR_IN_CHARGE'
export const isClinicalAuthor = (user: StaffUser, encounter: EncounterSummary) => hasClinicalAccess(user.role) && encounter.clinician?.id === user.id && encounter.author.id === user.id
export const canEditDraft = (user: StaffUser, encounter: EncounterSummary) => isClinicalAuthor(user, encounter) && encounter.status === 'DRAFT'
export const canAmend = (user: StaffUser, encounter: EncounterSummary) => isClinicalAuthor(user, encounter) && encounter.status === 'REVIEWED'
// The dosing fields typed for each order. The medicine itself is chosen from the catalog.
export const medicationFields = ['strength', 'dose', 'route', 'frequency', 'duration', 'notes'] as const
export type MedicationField = typeof medicationFields[number]
export const medicationLabels: Record<MedicationField, string> = { strength: 'Strength', dose: 'Dose', route: 'Route', frequency: 'Frequency', duration: 'Duration', notes: 'Instructions' }
export const medicationLimits: Record<MedicationField, number> = { strength: 100, dose: 100, route: 50, frequency: 100, duration: 100, notes: 2000 }
export const requiredMedicationFields = ['dose', 'route', 'frequency'] as const
// The previous system's routes, with its "Injection" split into the routes that matter clinically.
// "Other" lets the Medical Officer type a route that is not listed.
export const routeOptions = ['Oral', 'Intravenous (IV)', 'Intramuscular (IM)', 'Subcutaneous (SC)', 'Topical', 'Inhaled']
export const frequencyOptions = ['Once daily', 'Twice daily', 'Three times daily', 'Four times daily', 'As needed', 'Stat']
// "Paracetamol 500 mg" then "1 tablet · Oral · Three times daily · 5 days".
export const medicationTitle = (order: Pick<Medication, 'medicine' | 'strength'>) => [order.medicine, order.strength].map((part) => part?.trim()).filter(Boolean).join(' ')
export const medicationSummary = (order: Partial<Pick<Medication, 'dose' | 'route' | 'frequency' | 'duration'>>) =>
  [order.dose, order.route, order.frequency, order.duration].map((part) => part?.trim()).filter(Boolean).join(' · ')
// medicationId is empty only for an order written before the catalog existed (its typed name is kept in "medicine").
export type MedicationValues = Record<MedicationField, string> & { key: number; medicationId: string; medicine: string }
export type ClinicalFormValues = {
  occurredAt: string; followUpAt: string; roomLabel: string; historySummary: string; clinicalNotes: string; treatmentPlan: string
  complaints: { key: number; description: string }[]; diagnoses: { key: number; description: string; code: string; notes: string }[]
  medications: MedicationValues[]
}
export const emptyMedication = (key: number): MedicationValues => ({ key, medicationId: '', medicine: '', strength: '', dose: '', route: '', frequency: '', duration: '', notes: '' })
// A new record starts in the admission's current room; the clinician can change it.
export function clinicalFormValues(encounter?: Encounter, defaultRoom = ''): ClinicalFormValues {
  return { occurredAt: toLocalInput(encounter?.occurredAt ?? new Date().toISOString()), followUpAt: encounter?.followUpAt ? toLocalInput(encounter.followUpAt) : '',
    roomLabel: encounter ? encounter.roomLabel ?? '' : defaultRoom, historySummary: encounter?.historySummary ?? '', clinicalNotes: encounter?.clinicalNotes ?? '', treatmentPlan: encounter?.treatmentPlan ?? '',
    complaints: encounter?.complaints.map((item, key) => ({ key, description: item.description })) ?? [],
    diagnoses: encounter?.diagnoses.map((item, key) => ({ key, description: item.description, code: item.code ?? '', notes: item.notes ?? '' })) ?? [],
    medications: encounter?.medications.map((item, index) => ({ key: 1000 + index, medicationId: item.medicationId ?? '', medicine: item.medicine, strength: item.strength ?? '',
      dose: item.dose ?? '', route: item.route ?? '', frequency: item.frequency ?? '', duration: item.duration ?? '', notes: item.notes ?? '' })) ?? [] }
}
const medicationInput = (values: MedicationValues[]): MedicationInput[] => values.map((item) => ({ medicationId: item.medicationId, strength: item.strength.trim() || null,
  dose: item.dose.trim(), route: item.route.trim(), frequency: item.frequency.trim(), duration: item.duration.trim() || null, notes: item.notes.trim() || null }))
// Compared field by field, so an unchanged order set (including an older order with no catalog entry) is not resent.
const comparableOrders = (orders: Array<Omit<Medication, 'id' | 'medicine' | 'createdAt'> | MedicationInput>) => JSON.stringify(orders.map((order) => [order.medicationId || null,
  order.strength ?? null, order.dose || null, order.route || null, order.frequency || null, order.duration ?? null, order.notes ?? null]))
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
  const medications = medicationInput(values.medications)
  if (!encounter || comparableOrders(medications) !== comparableOrders(encounter.medications)) result.medications = medications
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
  if (values.complaints.length > 30 || values.diagnoses.length > 30 || values.medications.length > 30) return 'A clinical record allows up to 30 complaints, 30 diagnoses and 30 medication orders.'
  if (values.complaints.some((item) => !item.description.trim() || item.description.length > 200)) return 'Each complaint needs a description of 1 to 200 characters.'
  if (new Set(values.complaints.map((item) => item.description.trim())).size !== values.complaints.length) return 'Remove duplicate complaints.'
  if (values.diagnoses.some((item) => !item.description.trim() || item.description.length > 500 || item.code.length > 64 || item.notes.length > 5000)) return 'Each diagnosis needs a description (up to 500 characters), optional code (64) and optional notes (5,000).'
  if (input.medications) {
    const older = values.medications.find((item) => !item.medicationId)
    if (older) return older.medicine ? `Choose a medicine from the list for “${older.medicine}”, or remove that order, before saving the medications.` : 'Choose the medicine for each medication order.'
    if (values.medications.some((item) => requiredMedicationFields.some((key) => !item[key].trim()))) return 'Each medication order needs the dose, route and frequency.'
  }
  const long = values.medications.flatMap((item) => medicationFields.filter((key) => item[key].trim().length > medicationLimits[key]))[0]
  if (long) return `The medication ${medicationLabels[long].toLowerCase()} allows up to ${medicationLimits[long].toLocaleString()} characters.`
  const texts = [values.roomLabel, values.historySummary, values.clinicalNotes, values.treatmentPlan, ...values.complaints.map((item) => item.description), ...values.diagnoses.flatMap((item) => [item.description, item.code, item.notes]),
    ...values.medications.flatMap((item) => medicationFields.map((key) => item[key]))]
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
  ADMISSION_NOT_FOUND: 'Admission not found. Refresh the patient record.',
  MEDICATION_NOT_FOUND: 'A chosen medicine is no longer in the medication list. Choose it again from the list.',
  MEDICATION_INACTIVE: 'A chosen medicine has been removed from the medication list and cannot be newly prescribed. Choose another medicine.',
  ADMISSION_NOT_CURRENT: 'This admission has been discharged. Clinical records can only be opened on a current admission; earlier records remain readable.',
  ENCOUNTER_REFERENCE_CONFLICT: 'The record reference could not be allocated. Please try again.',
  EMPTY_CLINICAL_RECORD: 'Add a history summary, clinical notes, treatment plan, complaint, diagnosis or medication before finalizing.',
  INVALID_ENCOUNTER_TIME: 'Check the encounter and follow-up times. Encounter time must have been reached before finalization.',
  PATIENT_ARCHIVED: 'This patient is archived. Reactivation is required to create, edit or finalize an encounter. Existing finalized records can still receive permitted amendments.',
  PATIENT_NOT_FOUND: 'Patient not found.',
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
