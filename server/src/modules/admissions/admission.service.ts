import { Prisma, type PrismaClient, type StaffRole } from '../../generated/prisma/client.js'
import type { AuditContext, AuthContext } from '../auth/auth.context.js'
import { assertCurrentActor } from '../auth/security.transaction.js'
import { assertPermission, hasPermission, type Permission } from '../../shared/authorization/permissions.js'
import { appendAuditEvent } from '../../shared/audit/audit.js'
import { AppError } from '../../shared/errors/AppError.js'
import { paginationWindow } from '../../shared/utils/pagination.js'
import { idempotent, type IdempotencyScope } from '../../shared/idempotency/idempotency.js'
import { admissionDetailSelect, admissionSummarySelect, type AdmissionDetails } from './admission.dto.js'
import type { AdmissionQuery, ChangeRoomInput, CreateAdmissionInput, DischargeInput } from './admission.validation.js'

const FUTURE_TOLERANCE_MS = 60000
const notFound = () => new AppError(404, 'ADMISSION_NOT_FOUND', 'Admission not found')
export const alreadyAdmitted = () => new AppError(409, 'PATIENT_ALREADY_ADMITTED', 'This patient is already admitted.')
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')
export type AdmissionResult = { value: AdmissionDetails; clinical: boolean }

function admissionTransaction<T>(db: PrismaClient, auth: AuthContext, permission: Permission, write: boolean,
  operation: (tx: Prisma.TransactionClient, role: StaffRole) => Promise<T>) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(1296385106, 1)`
    // Shared with clinical writes. Exclusive patient writes (edits, archive) wait for it, so a
    // record cannot be archived between these checks and the admission write.
    if (write) await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(1296385106, 2)`
    const role = await assertCurrentActor(tx, auth)
    assertPermission(role, permission)
    return operation(tx, role)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000 })
}
const clinicalReader = (role: StaffRole) => hasPermission(role, 'CLINICAL_RECORD_READ')

// Room changes and discharge of one admission are serialized by its row lock. A clinical record
// being opened holds a share lock on the same row, so discharge waits for it and then sees it.
async function lockAdmission(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "Admission" WHERE id = ${id}::uuid FOR UPDATE`
  const value = await tx.admission.findUnique({ where: { id }, select: { id: true, status: true, roomNumber: true, admittedAt: true,
    rooms: { where: { endedAt: null }, select: { assignedAt: true } } } })
  if (!value) throw notFound()
  return value
}

// The accepted values admitPatient writes; used as the idempotency request fingerprint.
export const admissionFingerprint = (input: CreateAdmissionInput) => ({ patientId: input.patientId, roomNumber: input.roomNumber,
  admittedAt: input.admittedAt ? new Date(input.admittedAt).toISOString() : null })

export async function admitPatient(db: PrismaClient, auth: AuthContext, context: AuditContext, input: CreateAdmissionInput, idempotency?: IdempotencyScope) {
  try {
    return await admissionTransaction(db, auth, 'ADMISSION_CREATE', true, async (tx, role) => {
      const result = await idempotent(tx, idempotency,
        // A resent admission returns the admission it created, before the duplicate check would refuse it.
        (stored) => tx.admission.findUniqueOrThrow({ where: { id: stored.admissionId! }, select: admissionDetailSelect }),
        async () => {
          // Serializes admissions of one patient; the partial unique index is the final guard.
          const [patient] = await tx.$queryRaw<Array<{ archivedAt: Date | null }>>`
            SELECT "archivedAt" FROM "Patient" WHERE id = ${input.patientId}::uuid FOR NO KEY UPDATE`
          if (!patient) throw new AppError(404, 'PATIENT_NOT_FOUND', 'Patient not found')
          if (patient.archivedAt) throw new AppError(409, 'PATIENT_ARCHIVED', 'Reactivate the patient record before admitting')
          if (await tx.admission.findFirst({ where: { patientId: input.patientId, status: 'ADMITTED' }, select: { id: true } })) throw alreadyAdmitted()
          const now = Date.now(), admittedAt = input.admittedAt ? new Date(input.admittedAt) : new Date(now)
          if (admittedAt.getTime() > now + FUTURE_TOLERANCE_MS) {
            throw new AppError(400, 'INVALID_ADMISSION_TIME', 'Admission time cannot be in the future')
          }
          const previous = await tx.admission.findFirst({ where: { patientId: input.patientId },
            orderBy: [{ dischargedAt: { sort: 'desc', nulls: 'last' } }], select: { dischargedAt: true } })
          if (previous?.dischargedAt && admittedAt < previous.dischargedAt) {
            throw new AppError(409, 'ADMISSION_OVERLAPS_PREVIOUS', 'The admission time must follow the previous discharge')
          }
          const value = await tx.admission.create({ data: {
            patientId: input.patientId, roomNumber: input.roomNumber, admittedAt, admittedById: auth.principal.id,
            rooms: { create: { roomNumber: input.roomNumber, assignedAt: admittedAt, assignedById: auth.principal.id } },
          }, select: admissionDetailSelect })
          await appendAuditEvent(tx, { ...context, actorId: auth.principal.id, action: previous ? 'PATIENT_READMITTED' : 'PATIENT_ADMITTED',
            entityType: 'ADMISSION', entityId: value.id, metadata: { source: 'API' } })
          return { value, resource: { admissionId: value.id } }
        })
      return { ...result, clinical: clinicalReader(role) }
    })
  } catch (error) {
    // The partial unique index also protects against writers that bypass the row lock.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      if (await db.admission.findFirst({ where: { patientId: input.patientId, status: 'ADMITTED' }, select: { id: true } })) throw alreadyAdmitted()
      throw new AppError(409, 'ADMISSION_NUMBER_CONFLICT', 'The admission number could not be assigned; retry the admission')
    }
    throw error
  }
}

export async function listAdmissions(db: PrismaClient, query: AdmissionQuery) {
  const where: Prisma.AdmissionWhereInput = { status: query.status, patientId: query.patientId }
  if (query.search) {
    const fields = (text: string): Prisma.AdmissionWhereInput[] => {
      const contains = { contains: escapeLike(text), mode: 'insensitive' as const }
      return [{ admissionNumber: contains }, { roomNumber: contains }, { patient: { OR: [
        { patientNumber: contains }, { firstName: contains }, { middleName: contains }, { lastName: contains }] } }]
    }
    // As for patients: the whole text in one field (a room such as "Ward B"), or every word somewhere.
    const words = query.search.split(/\s+/).filter(Boolean).slice(0, 5)
    where.OR = [...fields(query.search), ...(words.length > 1 ? [{ AND: words.map((word) => ({ OR: fields(word) })) }] : [])]
  }
  // Current stays list the latest admitted first; past stays the latest discharged first.
  const orderBy: Prisma.AdmissionOrderByWithRelationInput[] = query.status === 'DISCHARGED'
    ? [{ dischargedAt: 'desc' }, { id: 'asc' }] : [{ admittedAt: 'desc' }, { id: 'asc' }]
  const [items, total] = await Promise.all([
    db.admission.findMany({ where, select: admissionSummarySelect, orderBy, ...paginationWindow(query) }),
    db.admission.count({ where }),
  ])
  return { items, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } }
}

export function getAdmission(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string): Promise<AdmissionResult> {
  return admissionTransaction(db, auth, 'ADMISSION_READ', false, async (tx, role) => {
    const value = await tx.admission.findUnique({ where: { id }, select: admissionDetailSelect })
    if (!value) throw notFound()
    await appendAuditEvent(tx, { ...context, actorId: auth.principal.id, action: 'ADMISSION_VIEWED', entityType: 'ADMISSION', entityId: id, metadata: { source: 'API' } })
    return { value, clinical: clinicalReader(role) }
  })
}

export function changeRoom(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string, input: ChangeRoomInput): Promise<AdmissionResult> {
  return admissionTransaction(db, auth, 'ADMISSION_UPDATE', true, async (tx, role) => {
    const current = await lockAdmission(tx, id)
    if (current.status !== 'ADMITTED') throw new AppError(409, 'ADMISSION_DISCHARGED', 'This admission has been discharged')
    if (current.roomNumber === input.roomNumber) throw new AppError(409, 'ROOM_UNCHANGED', 'The patient is already in this room')
    // A transfer is recorded now; it can never precede the assignment it closes.
    const open = current.rooms[0]?.assignedAt.getTime() ?? current.admittedAt.getTime()
    const at = new Date(Math.max(Date.now(), open))
    await tx.admissionRoomHistory.updateMany({ where: { admissionId: id, endedAt: null }, data: { endedAt: at } })
    await tx.admissionRoomHistory.create({ data: { admissionId: id, roomNumber: input.roomNumber, note: input.note ?? null, assignedAt: at, assignedById: auth.principal.id } })
    const value = await tx.admission.update({ where: { id }, data: { roomNumber: input.roomNumber }, select: admissionDetailSelect })
    await appendAuditEvent(tx, { ...context, actorId: auth.principal.id, action: 'ADMISSION_ROOM_CHANGED', entityType: 'ADMISSION', entityId: id, metadata: { source: 'API' } })
    return { value, clinical: clinicalReader(role) }
  })
}

// Discharge closes the stay in one transaction: status, time, staff, note, the open room and the
// audit event. Nothing clinical is deleted or archived, and the patient record stays active.
export function dischargeAdmission(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string, input: DischargeInput): Promise<AdmissionResult> {
  return admissionTransaction(db, auth, 'ADMISSION_DISCHARGE', true, async (tx, role) => {
    const current = await lockAdmission(tx, id)
    if (current.status !== 'ADMITTED') throw new AppError(409, 'ADMISSION_ALREADY_DISCHARGED', 'This admission has already been discharged')
    const now = Date.now(), dischargedAt = input.dischargedAt ? new Date(input.dischargedAt) : new Date(now)
    const roomSince = current.rooms[0]?.assignedAt ?? current.admittedAt
    if (dischargedAt.getTime() > now + FUTURE_TOLERANCE_MS || dischargedAt <= current.admittedAt || dischargedAt < roomSince) {
      throw new AppError(400, 'INVALID_DISCHARGE_TIME', 'The discharge time must follow the admission and the latest room change, and cannot be in the future')
    }
    // Drafts are never discarded: the clinician finalizes them first (the trigger enforces this too).
    if (await tx.encounter.count({ where: { admissionId: id, status: 'DRAFT' } })) {
      throw new AppError(409, 'ADMISSION_HAS_DRAFT_RECORDS', 'This admission has an unfinished clinical record.')
    }
    await tx.admissionRoomHistory.updateMany({ where: { admissionId: id, endedAt: null }, data: { endedAt: dischargedAt } })
    const value = await tx.admission.update({ where: { id }, data: { status: 'DISCHARGED', dischargedAt, dischargedById: auth.principal.id,
      dischargeNotes: input.dischargeNotes ?? null }, select: admissionDetailSelect })
    await appendAuditEvent(tx, { ...context, actorId: auth.principal.id, action: 'PATIENT_DISCHARGED', entityType: 'ADMISSION', entityId: id, metadata: { source: 'API' } })
    return { value, clinical: clinicalReader(role) }
  })
}
