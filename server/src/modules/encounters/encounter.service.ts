import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import type { AuthContext, AuditContext } from '../auth/auth.context.js'
import { assertCurrentActor } from '../auth/security.transaction.js'
import { assertPermission, type Permission } from '../../shared/authorization/permissions.js'
import { appendAuditEvent } from '../../shared/audit/audit.js'
import { AppError } from '../../shared/errors/AppError.js'
import { paginationWindow } from '../../shared/utils/pagination.js'
import { idempotent, type IdempotencyScope } from '../../shared/idempotency/idempotency.js'
import { encounterDetailSelect, encounterSummarySelect, type EncounterDetails } from './encounter.dto.js'
import type { CreateEncounterInput, UpdateEncounterInput, EncounterQuery, AmendmentInput } from './encounter.validation.js'

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
function audit(tx: Prisma.TransactionClient, auth: AuthContext, context: AuditContext, id: string,
  action: 'MEDICAL_RECORD_CREATED' | 'MEDICAL_RECORD_UPDATED' | 'MEDICAL_RECORD_VIEWED' | 'MEDICAL_RECORD_FINALIZED' | 'MEDICAL_RECORD_AMENDED') {
  return appendAuditEvent(tx, { ...context, actorId: auth.principal.id, entityType: 'ENCOUNTER', entityId: id, action,
    metadata: { source: 'API', ...(action === 'MEDICAL_RECORD_UPDATED' || action === 'MEDICAL_RECORD_AMENDED'
      ? { changedFields: ['clinicalRecord'] as const } : action === 'MEDICAL_RECORD_FINALIZED' ? { changedFields: ['status'] as const } : {}) } })
}
// Children written together would share one timestamp and fall back to random id
// order; distinct millisecond offsets keep the clinician's entry order on read.
function inEntryOrder<T extends object>(values: T[]) {
  const base = Date.now()
  return values.map((value, index) => ({ ...value, createdAt: new Date(base + index) }))
}
const complaintData = (values: NonNullable<UpdateEncounterInput['complaints']>) => inEntryOrder(values.map((v) => ({ description: v.description })))
const diagnosisData = (values: NonNullable<UpdateEncounterInput['diagnoses']>) => inEntryOrder(values.map((v) => ({ description: v.description, code: v.code ?? null, notes: v.notes ?? null })))

// The accepted values createEncounter writes; only a keyed digest of them is stored.
export function encounterFingerprint(input: CreateEncounterInput) {
  const instant = (value: string | null | undefined) => value ? new Date(value).toISOString() : null
  return {
    patientId: input.patientId, appointmentId: input.appointmentId ?? null, occurredAt: instant(input.occurredAt), followUpAt: instant(input.followUpAt),
    roomLabel: input.roomLabel ?? null, historySummary: input.historySummary ?? null, clinicalNotes: input.clinicalNotes ?? null,
    treatmentPlan: input.treatmentPlan ?? null, complaints: (input.complaints ?? []).map((value) => value.description),
    diagnoses: (input.diagnoses ?? []).map((value) => ({ description: value.description, code: value.code ?? null, notes: value.notes ?? null })),
  }
}

export async function createEncounter(db: PrismaClient, auth: AuthContext, context: AuditContext, input: CreateEncounterInput, idempotency?: IdempotencyScope) {
  try {
    return await transaction(db, auth, 'CLINICAL_RECORD_CREATE', true, (tx) => idempotent(tx, idempotency,
      (stored) => tx.encounter.findUniqueOrThrow({ where: { id: stored.encounterId! }, select: encounterDetailSelect }), async () => {
      await patientExists(tx, input.patientId, true)
      const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date()
      const followUpAt = input.followUpAt ? new Date(input.followUpAt) : null
      validateEncounterTime(occurredAt, followUpAt)
      if (input.appointmentId) {
        await tx.$queryRaw`SELECT id FROM "Appointment" WHERE id = ${input.appointmentId}::uuid FOR UPDATE`
        const appointment = await tx.appointment.findUnique({ where: { id: input.appointmentId },
          select: { patientId: true, clinicianId: true, status: true } })
        if (!appointment) throw new AppError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found')
        if (appointment.patientId !== input.patientId || appointment.clinicianId !== auth.principal.id
          || !['CHECKED_IN', 'COMPLETED'].includes(appointment.status)) {
          throw new AppError(409, 'APPOINTMENT_NOT_ELIGIBLE_FOR_ENCOUNTER', 'Appointment is not eligible for this encounter')
        }
        if (await tx.encounter.findFirst({ where: { appointmentId: input.appointmentId }, select: { id: true } })) {
          throw new AppError(409, 'APPOINTMENT_ALREADY_HAS_ENCOUNTER', 'Appointment already has an encounter')
        }
      }
      const value = await tx.encounter.create({ data: {
        patientId: input.patientId, appointmentId: input.appointmentId ?? null, clinicianId: auth.principal.id, createdById: auth.principal.id,
        status: 'DRAFT', occurredAt, followUpAt, roomLabel: input.roomLabel ?? null, historySummary: input.historySummary ?? null,
        clinicalNotes: input.clinicalNotes ?? null, treatmentPlan: input.treatmentPlan ?? null,
        complaints: { create: complaintData(input.complaints ?? []) }, diagnoses: { create: diagnosisData(input.diagnoses ?? []) },
      }, select: encounterDetailSelect })
      await audit(tx, auth, context, value.id, 'MEDICAL_RECORD_CREATED')
      return { value, resource: { encounterId: value.id } }
    }))
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // The database unique key also protects against writers bypassing locks.
      if (input.appointmentId && await db.encounter.findFirst({ where: { appointmentId: input.appointmentId }, select: { id: true } })) {
        throw new AppError(409, 'APPOINTMENT_ALREADY_HAS_ENCOUNTER', 'Appointment already has an encounter')
      }
      throw new AppError(409, 'ENCOUNTER_REFERENCE_CONFLICT', 'Encounter reference conflict; retry creation')
    }
    throw error
  }
}
export function listEncounters(db: PrismaClient, auth: AuthContext, context: AuditContext, query: EncounterQuery, patientId?: string) {
  return transaction(db, auth, 'CLINICAL_RECORD_READ', false, async (tx) => {
    if (patientId) await patientExists(tx, patientId, false)
    const where: Prisma.EncounterWhereInput = { patientId: patientId ?? query.patientId, clinicianId: query.clinicianId,
      appointmentId: query.appointmentId, status: query.status,
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
    await audit(tx, auth, context, id, 'MEDICAL_RECORD_UPDATED')
    return tx.encounter.findUniqueOrThrow({ where: { id }, select: encounterDetailSelect })
  })
}
export function finalizeEncounter(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string) {
  return transaction(db, auth, 'CLINICAL_RECORD_CREATE', true, async (tx) => {
    const value = await current(tx, id, true)
    author(value, auth); draft(value)
    await patientExists(tx, value.patient.id, true)
    if (!value.clinicalNotes?.trim() && !value.historySummary?.trim() && !value.treatmentPlan?.trim()
      && !value.complaints.length && !value.diagnoses.length) throw new AppError(409, 'EMPTY_CLINICAL_RECORD', 'Clinical content is required before finalization')
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
