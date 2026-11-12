import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import type { AuthContext, AuditContext } from '../auth/auth.context.js'
import { assertCurrentActor } from '../auth/security.transaction.js'
import { assertPermission, type Permission } from '../../shared/authorization/permissions.js'
import { appendAuditEvent } from '../../shared/audit/audit.js'
import { AppError } from '../../shared/errors/AppError.js'
import { paginationWindow } from '../../shared/utils/pagination.js'
import { idempotent, type IdempotencyScope } from '../../shared/idempotency/idempotency.js'
import { encounterDetailSelect, encounterSummarySelect, medicationHistorySelect, type EncounterDetails } from './encounter.dto.js'
import type { CreateEncounterInput, UpdateEncounterInput, EncounterQuery, AmendmentInput, MedicationHistoryQuery } from './encounter.validation.js'

function transaction<T>(db: PrismaClient, auth: AuthContext, permission: Permission, write: boolean,
  operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(1296385106, 1)`
    if (write) await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(1296385106, 2)`
    assertPermission(await assertCurrentActor(tx, auth), permission)
    return operation(tx)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000 })
}
async function patientExists(tx: Prisma.TransactionClient, id: string, active: boolean) {
  const patient = await tx.patient.findUnique({ where: { id }, select: { archivedAt: true } })
  if (!patient) throw new AppError(404, 'PATIENT_NOT_FOUND', 'Patient not found')
  if (active && patient.archivedAt) throw new AppError(409, 'PATIENT_ARCHIVED', 'Patient is archived')
}
// A new record is opened only on a current admission. The share lock makes a concurrent discharge
// (which takes the row for update) wait for this record and then refuse because it is a draft.
async function currentAdmission(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "Admission" WHERE id = ${id}::uuid FOR SHARE`
  const admission = await tx.admission.findUnique({ where: { id }, select: { id: true, patientId: true, status: true, roomNumber: true } })
  if (!admission) throw new AppError(404, 'ADMISSION_NOT_FOUND', 'Admission not found')
  if (admission.status !== 'ADMITTED') {
    throw new AppError(409, 'ADMISSION_NOT_CURRENT', 'Clinical records can only be opened on a current admission')
  }
  return admission
}
async function current(tx: Prisma.TransactionClient, id: string, write: boolean) {
  if (write) await tx.$queryRaw`SELECT id FROM "Encounter" WHERE id = ${id}::uuid FOR UPDATE`
  else await tx.$queryRaw`SELECT id FROM "Encounter" WHERE id = ${id}::uuid FOR SHARE`
  const value = await tx.encounter.findUnique({ where: { id }, select: encounterDetailSelect })
  if (!value) throw new AppError(404, 'ENCOUNTER_NOT_FOUND', 'Encounter not found')
  return value
}
function author(value: EncounterDetails, auth: AuthContext) {
  if (value.clinicianId !== auth.principal.id || value.createdById !== auth.principal.id) {
    throw new AppError(403, 'ENCOUNTER_AUTHOR_REQUIRED', 'Original clinical author is required')
  }
}
function draft(value: EncounterDetails) {
  if (value.status === 'REVIEWED') throw new AppError(409, 'ENCOUNTER_FINALIZED', 'Finalized encounters cannot be edited')
  if (value.status !== 'DRAFT') throw new AppError(409, 'ENCOUNTER_NOT_EDITABLE', 'Encounter is not editable')
}
export function validateEncounterTime(occurredAt: Date, followUpAt: Date | null | undefined) {
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 60000
    || (followUpAt && (!Number.isFinite(followUpAt.getTime()) || followUpAt < occurredAt))) {
    throw new AppError(400, 'INVALID_ENCOUNTER_TIME', 'Invalid encounter or follow-up time')
  }
}
// Medication orders are named in the audit event (as a field classification, never their content).
function audit(tx: Prisma.TransactionClient, auth: AuthContext, context: AuditContext, id: string,
  action: 'MEDICAL_RECORD_CREATED' | 'MEDICAL_RECORD_UPDATED' | 'MEDICAL_RECORD_VIEWED' | 'MEDICAL_RECORD_FINALIZED' | 'MEDICAL_RECORD_AMENDED', medications = false) {
  const changedFields: Array<'clinicalRecord' | 'status' | 'medications'> = action === 'MEDICAL_RECORD_UPDATED' || action === 'MEDICAL_RECORD_AMENDED'
    ? ['clinicalRecord'] : action === 'MEDICAL_RECORD_FINALIZED' ? ['status'] : []
  if (medications) changedFields.push('medications')
  return appendAuditEvent(tx, { ...context, actorId: auth.principal.id, entityType: 'ENCOUNTER', entityId: id, action,
    metadata: { source: 'API', ...(changedFields.length ? { changedFields } : {}) } })
}
// Children written together would share one timestamp and fall back to random id
// order; distinct millisecond offsets keep the clinician's entry order on read.
function inEntryOrder<T extends object>(values: T[]) {
  const base = Date.now()
  return values.map((value, index) => ({ ...value, createdAt: new Date(base + index) }))
}
const complaintData = (values: NonNullable<UpdateEncounterInput['complaints']>) => inEntryOrder(values.map((v) => ({ description: v.description })))
const diagnosisData = (values: NonNullable<UpdateEncounterInput['diagnoses']>) => inEntryOrder(values.map((v) => ({ description: v.description, code: v.code ?? null, notes: v.notes ?? null })))
type MedicationValues = NonNullable<UpdateEncounterInput['medications']>
// The catalog entries an order set names, share-locked so a concurrent deactivation waits for this
// write. A new order needs an active medicine; one already on this draft may stay after its
// medicine is deactivated, so editing something else never forces a prescription to change.
async function catalogMedicines(tx: Prisma.TransactionClient, values: MedicationValues, alreadyPrescribed: ReadonlySet<string>) {
  const ids = [...new Set(values.map((value) => value.medicationId))]
  if (!ids.length) return new Map<string, string>()
  const rows = await tx.$queryRaw<Array<{ id: string; name: string; active: boolean }>>`
    SELECT "id", "name", "active" FROM "Medication" WHERE "id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) FOR SHARE`
  const found = new Map(rows.map((row) => [row.id, row]))
  for (const id of ids) {
    const row = found.get(id)
    if (!row) throw new AppError(404, 'MEDICATION_NOT_FOUND', 'Medication not found')
    if (!row.active && !alreadyPrescribed.has(id)) throw new AppError(409, 'MEDICATION_INACTIVE', 'This medicine is no longer in the catalog')
  }
  return new Map(rows.map((row) => [row.id, row.name]))
}
// "medicine" keeps the catalog name as it is now: the order stays readable whatever happens later.
const medicationData = (values: MedicationValues, names: ReadonlyMap<string, string>) => inEntryOrder(values.map((v) => ({
  medicationId: v.medicationId, medicine: names.get(v.medicationId)!, strength: v.strength ?? null, dose: v.dose, route: v.route,
  frequency: v.frequency, duration: v.duration ?? null, notes: v.notes ?? null })))

// The accepted values createEncounter writes; only a keyed digest of them is stored.
export function encounterFingerprint(input: CreateEncounterInput) {
  const instant = (value: string | null | undefined) => value ? new Date(value).toISOString() : null
  return {
    admissionId: input.admissionId, occurredAt: instant(input.occurredAt), followUpAt: instant(input.followUpAt),
    // Omitted (the admission's room is used) stays distinct from an explicit null: the canonical form drops undefined.
    roomLabel: input.roomLabel, historySummary: input.historySummary ?? null, clinicalNotes: input.clinicalNotes ?? null,
    treatmentPlan: input.treatmentPlan ?? null, complaints: (input.complaints ?? []).map((value) => value.description),
    diagnoses: (input.diagnoses ?? []).map((value) => ({ description: value.description, code: value.code ?? null, notes: value.notes ?? null })),
    medications: (input.medications ?? []).map((value) => ({ medicationId: value.medicationId, strength: value.strength ?? null, dose: value.dose,
      route: value.route, frequency: value.frequency, duration: value.duration ?? null, notes: value.notes ?? null })),
  }
}

export async function createEncounter(db: PrismaClient, auth: AuthContext, context: AuditContext, input: CreateEncounterInput, idempotency?: IdempotencyScope) {
  try {
    return await transaction(db, auth, 'CLINICAL_RECORD_CREATE', true, (tx) => idempotent(tx, idempotency,
      (stored) => tx.encounter.findUniqueOrThrow({ where: { id: stored.encounterId! }, select: encounterDetailSelect }), async () => {
      const admission = await currentAdmission(tx, input.admissionId)
      await patientExists(tx, admission.patientId, true)
      const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date()
      const followUpAt = input.followUpAt ? new Date(input.followUpAt) : null
      validateEncounterTime(occurredAt, followUpAt)
      const medications = input.medications ?? []
      const names = await catalogMedicines(tx, medications, new Set())
      const value = await tx.encounter.create({ data: {
        patientId: admission.patientId, admissionId: admission.id, clinicianId: auth.principal.id, createdById: auth.principal.id,
        // The admission's current room is recorded unless the clinician states another.
        status: 'DRAFT', occurredAt, followUpAt, roomLabel: input.roomLabel === undefined ? admission.roomNumber : input.roomLabel,
        historySummary: input.historySummary ?? null, clinicalNotes: input.clinicalNotes ?? null, treatmentPlan: input.treatmentPlan ?? null,
        complaints: { create: complaintData(input.complaints ?? []) }, diagnoses: { create: diagnosisData(input.diagnoses ?? []) },
        medications: { create: medicationData(medications, names) },
      }, select: encounterDetailSelect })
      await audit(tx, auth, context, value.id, 'MEDICAL_RECORD_CREATED', medications.length > 0)
      return { value, resource: { encounterId: value.id } }
    }))
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'ENCOUNTER_REFERENCE_CONFLICT', 'Encounter reference conflict; retry creation')
    }
    throw error
  }
}
export function listEncounters(db: PrismaClient, auth: AuthContext, context: AuditContext, query: EncounterQuery, patientId?: string) {
  return transaction(db, auth, 'CLINICAL_RECORD_READ', false, async (tx) => {
    if (patientId) await patientExists(tx, patientId, false)
    const where: Prisma.EncounterWhereInput = { patientId: patientId ?? query.patientId, clinicianId: query.clinicianId,
      admissionId: query.admissionId, status: query.status,
      occurredAt: { gte: query.dateFrom ? new Date(query.dateFrom) : undefined, lte: query.dateTo ? new Date(query.dateTo) : undefined },
      reference: query.search ? { contains: query.search.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' } : undefined }
    const items = await tx.encounter.findMany({ where, select: encounterSummarySelect,
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }], ...paginationWindow(query) })
    const total = await tx.encounter.count({ where })
    if (patientId) await appendAuditEvent(tx, { ...context, actorId: auth.principal.id, entityType: 'PATIENT', entityId: patientId,
      action: 'MEDICAL_HISTORY_VIEWED', metadata: { source: 'API' } })
    return { items, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } }
  })
}
export function getEncounterById(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string) {
  return transaction(db, auth, 'CLINICAL_RECORD_READ', false, async (tx) => {
    const value = await current(tx, id, false)
    await audit(tx, auth, context, id, 'MEDICAL_RECORD_VIEWED')
    return value
  })
}
export function updateEncounter(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string, input: UpdateEncounterInput) {
  return transaction(db, auth, 'CLINICAL_RECORD_CREATE', true, async (tx) => {
    const value = await current(tx, id, true)
    author(value, auth); draft(value)
    await patientExists(tx, value.patient.id, true)
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : value.occurredAt
    const followUpAt = input.followUpAt === undefined ? value.followUpAt : input.followUpAt ? new Date(input.followUpAt) : null
    validateEncounterTime(occurredAt, followUpAt)
    const data: Prisma.EncounterUpdateInput = {}
    if (input.occurredAt !== undefined) data.occurredAt = occurredAt
    if (input.followUpAt !== undefined) data.followUpAt = followUpAt
    if (input.roomLabel !== undefined) data.roomLabel = input.roomLabel
    if (input.historySummary !== undefined) data.historySummary = input.historySummary
    if (input.clinicalNotes !== undefined) data.clinicalNotes = input.clinicalNotes
    if (input.treatmentPlan !== undefined) data.treatmentPlan = input.treatmentPlan
    await tx.encounter.update({ where: { id }, data })
    // Child replacement is intentional only in drafts, under the parent lock.
    if (input.complaints !== undefined) {
      await tx.encounterComplaint.deleteMany({ where: { encounterId: id } })
      await tx.encounterComplaint.createMany({ data: complaintData(input.complaints).map((v) => ({ ...v, encounterId: id })) })
    }
    if (input.diagnoses !== undefined) {
      await tx.diagnosis.deleteMany({ where: { encounterId: id } })
      await tx.diagnosis.createMany({ data: diagnosisData(input.diagnoses).map((v) => ({ ...v, encounterId: id })) })
    }
    if (input.medications !== undefined) {
      const prescribed = new Set(value.medications.flatMap((order) => order.medicationId ? [order.medicationId] : []))
      const names = await catalogMedicines(tx, input.medications, prescribed)
      await tx.medicationOrder.deleteMany({ where: { encounterId: id } })
      await tx.medicationOrder.createMany({ data: medicationData(input.medications, names).map((v) => ({ ...v, encounterId: id })) })
    }
    await audit(tx, auth, context, id, 'MEDICAL_RECORD_UPDATED', input.medications !== undefined)
    return tx.encounter.findUniqueOrThrow({ where: { id }, select: encounterDetailSelect })
  })
}
export function finalizeEncounter(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string) {
  return transaction(db, auth, 'CLINICAL_RECORD_CREATE', true, async (tx) => {
    const value = await current(tx, id, true)
    author(value, auth); draft(value)
    await patientExists(tx, value.patient.id, true)
    if (!value.clinicalNotes?.trim() && !value.historySummary?.trim() && !value.treatmentPlan?.trim()
      && !value.complaints.length && !value.diagnoses.length && !value.medications.length) throw new AppError(409, 'EMPTY_CLINICAL_RECORD', 'Clinical content is required before finalization')
    const reviewedAt = new Date()
    if (value.occurredAt > reviewedAt) throw new AppError(400, 'INVALID_ENCOUNTER_TIME', 'Encounter time must be reached before finalization')
    const result = await tx.encounter.update({ where: { id }, data: { status: 'REVIEWED', reviewedAt }, select: encounterDetailSelect })
    await audit(tx, auth, context, id, 'MEDICAL_RECORD_FINALIZED')
    return result
  })
}
export function amendEncounter(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string, input: AmendmentInput) {
  return transaction(db, auth, 'CLINICAL_RECORD_AMEND', true, async (tx) => {
    const value = await current(tx, id, true)
    author(value, auth)
    if (value.status !== 'REVIEWED') throw new AppError(409, 'ENCOUNTER_NOT_FINALIZED', 'Only finalized encounters can be amended')
    // Amendments are permanent, so a resent request (including a browser resend
    // after a dropped connection) must not append the same correction twice.
    if (await tx.encounterAmendment.findFirst({ where: { encounterId: id, authorId: auth.principal.id, reason: input.reason, content: input.content }, select: { id: true } })) {
      throw new AppError(409, 'DUPLICATE_AMENDMENT', 'This amendment is already recorded')
    }
    await tx.encounterAmendment.create({ data: { encounterId: id, authorId: auth.principal.id, reason: input.reason, content: input.content } })
    await audit(tx, auth, context, id, 'MEDICAL_RECORD_AMENDED')
    return tx.encounter.findUniqueOrThrow({ where: { id }, select: encounterDetailSelect })
  })
}
// Medication orders for one patient, newest record first: every order, one admission's orders, or
// every order outside one admission (with records made before admissions existed).
export function listMedicationHistory(db: PrismaClient, auth: AuthContext, context: AuditContext, patientId: string, query: MedicationHistoryQuery) {
  return transaction(db, auth, 'CLINICAL_RECORD_READ', false, async (tx) => {
    await patientExists(tx, patientId, false)
    const where: Prisma.MedicationOrderWhereInput = { encounter: { patientId,
      ...(query.admissionId ? { admissionId: query.admissionId } : {}),
      ...(query.excludeAdmissionId ? { OR: [{ admissionId: null }, { admissionId: { not: query.excludeAdmissionId } }] } : {}) } }
    const items = await tx.medicationOrder.findMany({ where, select: medicationHistorySelect,
      orderBy: [{ encounter: { occurredAt: 'desc' } }, { encounterId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], ...paginationWindow(query) })
    const total = await tx.medicationOrder.count({ where })
    await appendAuditEvent(tx, { ...context, actorId: auth.principal.id, entityType: 'PATIENT', entityId: patientId,
      action: 'MEDICAL_HISTORY_VIEWED', metadata: { source: 'API', changedFields: ['medications'] } })
    return { items, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } }
  })
}
