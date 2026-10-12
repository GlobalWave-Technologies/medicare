import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import type { AuditContext, AuthContext } from '../auth/auth.context.js'
import { assertCurrentActor } from '../auth/security.transaction.js'
import { assertPermission, type Permission } from '../../shared/authorization/permissions.js'
import { appendAuditEvent } from '../../shared/audit/audit.js'
import { AppError } from '../../shared/errors/AppError.js'
import { paginationWindow } from '../../shared/utils/pagination.js'
import { patientSelect, type PatientDemographics } from './patient.dto.js'
import { normalizePhone, type CreatePatientInput, type UpdatePatientInput, type PatientQuery } from './patient.validation.js'

const missing = () => new AppError(404, 'PATIENT_NOT_FOUND', 'Patient not found')
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')

function patientTransaction<T>(db: PrismaClient, auth: AuthContext, permission: Permission,
  write: boolean, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async (tx) => {
    // Readers/writers share the auth lock; staff/session changes take it exclusively.
    // A second lock serializes patient writes, protecting duplicate checks and
    // merging PATCHes against the latest row. Lock order is always auth -> patient.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(1296385106, 1)`
    if (write) await tx.$executeRaw`SELECT pg_advisory_xact_lock(1296385106, 2)`
    assertPermission(await assertCurrentActor(tx, auth), permission)
    return operation(tx)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000 })
}

function fields(input: UpdatePatientInput) {
  const data: Prisma.PatientUpdateInput = {}
  if (input.firstName !== undefined) data.firstName = input.firstName
  if (input.middleName !== undefined) data.middleName = input.middleName
  if (input.lastName !== undefined) data.lastName = input.lastName
  if (input.dateOfBirth !== undefined) data.dateOfBirth = input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00.000Z`) : null
  if (input.phone !== undefined) data.phone = input.phone
  return data
}

async function rejectProbableDuplicate(tx: Prisma.TransactionClient,
  input: Pick<PatientDemographics, 'firstName' | 'middleName' | 'lastName' | 'dateOfBirth' | 'phone'>, excludeId?: string) {
  if (!input.dateOfBirth || !input.phone) return
  const match = await tx.patient.findFirst({ where: {
    id: excludeId ? { not: excludeId } : undefined,
    firstName: { equals: escapeLike(input.firstName), mode: 'insensitive' },
    middleName: input.middleName === null ? null : { equals: escapeLike(input.middleName), mode: 'insensitive' },
    lastName: { equals: escapeLike(input.lastName), mode: 'insensitive' },
    dateOfBirth: input.dateOfBirth, phone: input.phone,
    // Include archived identities: reactivation preserves their history.
  }, select: { id: true } })
  if (match) throw new AppError(409, 'POSSIBLE_DUPLICATE_PATIENT', 'A possible duplicate requires staff review')
}

export async function createPatient(db: PrismaClient, auth: AuthContext, context: AuditContext, input: CreatePatientInput) {
  try {
    return await patientTransaction(db, auth, 'PATIENT_CREATE', true, async (tx) => {
      const data = {
        firstName: input.firstName, middleName: input.middleName ?? null, lastName: input.lastName,
        dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00.000Z`) : null,
        phone: input.phone ?? null, createdById: auth.principal.id,
      }
      await rejectProbableDuplicate(tx, data)
      const patient = await tx.patient.create({ data, select: patientSelect })
      await appendAuditEvent(tx, { ...context, actorId: auth.principal.id, action: 'PATIENT_CREATED',
        entityType: 'PATIENT', entityId: patient.id, metadata: { source: 'API' } })
      return patient
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'PATIENT_IDENTIFIER_CONFLICT', 'Patient identifier conflict; retry registration')
    }
    throw error
  }
}

export async function listPatients(db: PrismaClient, query: PatientQuery) {
  const where: Prisma.PatientWhereInput = {
    archivedAt: query.archived === 'all' ? undefined : query.archived === 'true' ? { not: null } : null,
  }
  if (query.search) {
    // Prisma's contains uses LIKE patterns. Escape wildcard characters so user
    // input is a literal substring, not an unbounded wildcard expression.
    const escaped = escapeLike(query.search)
    where.OR = [
      { patientNumber: { contains: escaped, mode: 'insensitive' } },
      { firstName: { contains: escaped, mode: 'insensitive' } },
      { middleName: { contains: escaped, mode: 'insensitive' } },
      { lastName: { contains: escaped, mode: 'insensitive' } },
    ]
    if (/^[+0-9 ().-]+$/.test(query.search)) {
      const phone = normalizePhone(query.search)
      if (/^\+?\d+$/.test(phone)) where.OR.push({ phone: { contains: phone } })
    }
  }
  const [items, total] = await Promise.all([
    db.patient.findMany({ where, select: patientSelect, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...paginationWindow(query) }),
    db.patient.count({ where }),
  ])
  return { items, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } }
}

export function getPatientById(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string) {
  return patientTransaction(db, auth, 'PATIENT_READ', false, async (tx) => {
    const patient = await tx.patient.findUnique({ where: { id }, select: patientSelect })
    if (!patient) throw missing()
    await appendAuditEvent(tx, { ...context, actorId: auth.principal.id, action: 'PATIENT_VIEWED',
      entityType: 'PATIENT', entityId: id, metadata: { source: 'API' } })
    return patient
  })
}

export function updatePatient(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string, input: UpdatePatientInput) {
  return patientTransaction(db, auth, 'PATIENT_UPDATE', true, async (tx) => {
    const current = await tx.patient.findUnique({ where: { id }, select: patientSelect })
    if (!current) throw missing()
    if (current.archivedAt) throw new AppError(409, 'PATIENT_ARCHIVED', 'Reactivate the patient before editing demographics')
    if (input.dateOfBirth && input.dateOfBirth > current.createdAt.toISOString().slice(0, 10)) {
      throw new AppError(400, 'INVALID_PATIENT_DATA', 'Date of birth cannot follow patient registration')
    }
    // Build the merged duplicate signal from validated fields and the locked row.
    await rejectProbableDuplicate(tx, {
      firstName: input.firstName ?? current.firstName,
      middleName: input.middleName === undefined ? current.middleName : input.middleName,
      lastName: input.lastName ?? current.lastName,
      dateOfBirth: input.dateOfBirth === undefined ? current.dateOfBirth
        : input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00.000Z`) : null,
      phone: input.phone === undefined ? current.phone : input.phone,
    }, id)
    const patient = await tx.patient.update({ where: { id }, data: fields(input), select: patientSelect })
    await appendAuditEvent(tx, { ...context, actorId: auth.principal.id, action: 'PATIENT_UPDATED',
      entityType: 'PATIENT', entityId: id, metadata: { source: 'API', changedFields: ['demographics'] } })
    return patient
  })
}

function setArchived(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string, archived: boolean) {
  return patientTransaction(db, auth, 'PATIENT_ARCHIVE', true, async (tx) => {
    const current = await tx.patient.findUnique({ where: { id }, select: patientSelect })
    if (!current) throw missing()
    if (Boolean(current.archivedAt) === archived) return current
    if (!archived) await rejectProbableDuplicate(tx, current, id)
    const patient = await tx.patient.update({ where: { id }, data: { archivedAt: archived ? new Date() : null }, select: patientSelect })
    await appendAuditEvent(tx, { ...context, actorId: auth.principal.id,
      action: archived ? 'PATIENT_ARCHIVED' : 'PATIENT_REACTIVATED', entityType: 'PATIENT', entityId: id,
      metadata: { source: 'API' } })
    return patient
  })
}

export const archivePatient = (db: PrismaClient, auth: AuthContext, context: AuditContext, id: string) => setArchived(db, auth, context, id, true)
export const reactivatePatient = (db: PrismaClient, auth: AuthContext, context: AuditContext, id: string) => setArchived(db, auth, context, id, false)
