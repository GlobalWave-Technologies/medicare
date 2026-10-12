import { Prisma, type PrismaClient, type StaffRole, type AppointmentStatus } from '../../generated/prisma/client.js'
import type { AuthContext, AuditContext } from '../auth/auth.context.js'
import { assertCurrentActor } from '../auth/security.transaction.js'
import { assertPermission, type Permission } from '../../shared/authorization/permissions.js'
import { appendAuditEvent } from '../../shared/audit/audit.js'
import { AppError } from '../../shared/errors/AppError.js'
import { paginationWindow } from '../../shared/utils/pagination.js'
import { appointmentSelect } from './appointment.dto.js'
import type { CreateAppointmentInput, UpdateAppointmentInput, AppointmentQuery, AppointmentStatusInput } from './appointment.validation.js'
import { createAppointmentNotification } from '../notifications/notification.service.js'

const missing = () => new AppError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found')
const invalidTransition = () => new AppError(409, 'INVALID_APPOINTMENT_STATUS_TRANSITION', 'Appointment status transition is not allowed')
const editable = ['SCHEDULED', 'CONFIRMED']
export const appointmentTransitions: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  SCHEDULED: ['CONFIRMED', 'NO_SHOW'], CONFIRMED: ['CHECKED_IN', 'NO_SHOW'],
  CHECKED_IN: ['COMPLETED'], COMPLETED: [], CANCELLED: [], NO_SHOW: [],
}

// The adapter preserves PostgreSQL's SQLSTATE under cause/meta. Never match or
// expose database messages, constraint names or conflicting row details.
function isExclusionViolation(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 5) return false
  const value = error as Record<string, unknown>
  return value.originalCode === '23P01' || value.code === '23P01'
    || ['cause', 'meta', 'driverAdapterError'].some((key) => isExclusionViolation(value[key], depth + 1))
}

async function transaction<T>(db: PrismaClient, auth: AuthContext, permission: Permission,
  write: boolean, operation: (tx: Prisma.TransactionClient, role: StaffRole) => Promise<T>) {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(1296385106, 1)`
      // Cooperates with patient archival's exclusive lock. Concurrent bookings
      // share this lock; the exclusion constraints arbitrate schedule conflicts.
      if (write) await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(1296385106, 2)`
      const role = await assertCurrentActor(tx, auth)
      assertPermission(role, permission)
      return operation(tx, role)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000 })
  } catch (error) {
    if (isExclusionViolation(error)) throw new AppError(409, 'APPOINTMENT_CONFLICT', 'The requested appointment time is unavailable')
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'APPOINTMENT_REFERENCE_CONFLICT', 'Appointment reference conflict; retry booking')
    }
    throw error
  }
}

function scope(role: StaffRole, auth: AuthContext): Prisma.AppointmentWhereInput {
  return role === 'DOCTOR_IN_CHARGE' ? { clinicianId: auth.principal.id } : {}
}

async function current(tx: Prisma.TransactionClient, auth: AuthContext, role: StaffRole, id: string, lock = false) {
  if (lock) {
    // Lock only a visible row; waiting commands then see its latest lifecycle and
    // assignment. Keep auth -> patient -> appointment lock order everywhere.
    if (role === 'DOCTOR_IN_CHARGE') {
      await tx.$queryRaw`SELECT id FROM "Appointment" WHERE id = ${id}::uuid AND "clinicianId" = ${auth.principal.id}::uuid FOR UPDATE`
    } else await tx.$queryRaw`SELECT id FROM "Appointment" WHERE id = ${id}::uuid FOR UPDATE`
  }
  const result = await tx.appointment.findFirst({ where: { id, ...scope(role, auth) }, select: appointmentSelect })
  if (!result) throw missing()
  return result
}

async function eligible(tx: Prisma.TransactionClient, patientId: string, clinicianId: string | null) {
  const patient = await tx.patient.findUnique({ where: { id: patientId }, select: { archivedAt: true } })
  if (!patient) throw new AppError(404, 'PATIENT_NOT_FOUND', 'Patient not found')
  if (patient.archivedAt) throw new AppError(409, 'PATIENT_ARCHIVED', 'Patient is archived')
  if (!clinicianId) throw new AppError(409, 'CLINICIAN_NOT_FOUND', 'An eligible clinician is required')
  const clinician = await tx.staffUser.findUnique({ where: { id: clinicianId }, select: { status: true, role: true } })
  if (!clinician) throw new AppError(404, 'CLINICIAN_NOT_FOUND', 'Clinician not found')
  if (clinician.status !== 'ACTIVE') throw new AppError(409, 'CLINICIAN_NOT_ACTIVE', 'Clinician is not active')
  if (clinician.role !== 'DOCTOR_IN_CHARGE') throw new AppError(409, 'INVALID_CLINICIAN_ROLE', 'Staff member is not an eligible clinician')
}

export function validateSchedule(start: Date, end: Date, checkPast = true) {
  const duration = end.getTime() - start.getTime()
  if (!Number.isFinite(duration) || duration < 5 * 60000 || duration > 12 * 3600000) {
    throw new AppError(400, 'INVALID_APPOINTMENT_TIME', 'Appointment duration must be between 5 minutes and 12 hours')
  }
  if (checkPast && start.getTime() < Date.now() - 60000) {
    throw new AppError(409, 'APPOINTMENT_IN_PAST', 'Appointment cannot be scheduled in the past')
  }
}

function audit(tx: Prisma.TransactionClient, auth: AuthContext, context: AuditContext,
  id: string, action: 'APPOINTMENT_CREATED' | 'APPOINTMENT_VIEWED' | 'APPOINTMENT_UPDATED' | 'APPOINTMENT_STATUS_CHANGED' | 'APPOINTMENT_CANCELLED') {
  return appendAuditEvent(tx, { ...context, actorId: auth.principal.id, entityType: 'APPOINTMENT', entityId: id, action,
    metadata: { source: 'API', ...(action === 'APPOINTMENT_UPDATED' ? { changedFields: ['schedule'] as const }
      : action === 'APPOINTMENT_STATUS_CHANGED' || action === 'APPOINTMENT_CANCELLED' ? { changedFields: ['status'] as const } : {}) } })
}

export function createAppointment(db: PrismaClient, auth: AuthContext, context: AuditContext, input: CreateAppointmentInput) {
  return transaction(db, auth, 'APPOINTMENT_CREATE', true, async (tx) => {
    const scheduledStart = new Date(input.scheduledStart), scheduledEnd = new Date(input.scheduledEnd)
    validateSchedule(scheduledStart, scheduledEnd)
    await eligible(tx, input.patientId, input.clinicianId)
    const value = await tx.appointment.create({ data: {
      patientId: input.patientId, clinicianId: input.clinicianId, scheduledStart, scheduledEnd,
      type: input.type, reason: input.reason ?? null, notes: input.notes ?? null,
      status: 'SCHEDULED', createdById: auth.principal.id,
    }, select: appointmentSelect })
    await audit(tx, auth, context, value.id, 'APPOINTMENT_CREATED')
    await createAppointmentNotification(tx, auth.principal.id, value.id, input.clinicianId, 'assigned')
    return value
  })
}

export function listAppointments(db: PrismaClient, auth: AuthContext, query: AppointmentQuery) {
  return transaction(db, auth, 'APPOINTMENT_READ', false, async (tx, role) => {
    const where: Prisma.AppointmentWhereInput = {
      AND: [scope(role, auth), { clinicianId: query.clinicianId }], patientId: query.patientId,
      status: query.status, type: query.type,
      scheduledStart: { gte: query.dateFrom ? new Date(query.dateFrom) : undefined, lte: query.dateTo ? new Date(query.dateTo) : undefined },
    }
    if (query.search) {
      const contains = query.search.replace(/[\\%_]/g, '\\$&')
      const text = { contains, mode: 'insensitive' as const }
      where.OR = [{ reference: text }, { patient: { OR: [
        { patientNumber: text }, { firstName: text }, { middleName: text }, { lastName: text },
      ] } }]
    }
    const items = await tx.appointment.findMany({ where, select: appointmentSelect,
      orderBy: [{ scheduledStart: 'asc' }, { id: 'asc' }], ...paginationWindow(query) })
    const total = await tx.appointment.count({ where })
    return { items, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } }
  })
}

export function getAppointmentById(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string) {
  return transaction(db, auth, 'APPOINTMENT_READ', false, async (tx, role) => {
    const value = await current(tx, auth, role, id)
    await audit(tx, auth, context, id, 'APPOINTMENT_VIEWED')
    return value
  })
}

export function updateAppointment(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string, input: UpdateAppointmentInput) {
  return transaction(db, auth, 'APPOINTMENT_UPDATE', true, async (tx, role) => {
    const value = await current(tx, auth, role, id, true)
    if (!editable.includes(value.status)) throw new AppError(409, 'APPOINTMENT_NOT_EDITABLE', 'Appointment is not editable')
    const scheduledStart = input.scheduledStart ? new Date(input.scheduledStart) : value.scheduledStart
    const scheduledEnd = input.scheduledEnd ? new Date(input.scheduledEnd) : value.scheduledEnd
    const clinicianId = input.clinicianId ?? value.clinician?.id ?? null
    // Administrative text changes may correct a past scheduled booking. Moving
    // its time or clinician is a new scheduling decision and must not be past.
    validateSchedule(scheduledStart, scheduledEnd, input.scheduledStart !== undefined || input.scheduledEnd !== undefined || input.clinicianId !== undefined)
    await eligible(tx, value.patient.id, clinicianId)
    const data: Prisma.AppointmentUpdateInput = {}
    if (input.clinicianId !== undefined) data.clinician = { connect: { id: input.clinicianId } }
    if (input.scheduledStart !== undefined) data.scheduledStart = scheduledStart
    if (input.scheduledEnd !== undefined) data.scheduledEnd = scheduledEnd
    if (input.type !== undefined) data.type = input.type
    if (input.reason !== undefined) data.reason = input.reason
    if (input.notes !== undefined) data.notes = input.notes
    const result = await tx.appointment.update({ where: { id }, data, select: appointmentSelect })
    await audit(tx, auth, context, id, 'APPOINTMENT_UPDATED')
    if (clinicianId !== (value.clinician?.id ?? null)) {
      await createAppointmentNotification(tx, auth.principal.id, id, value.clinician?.id ?? null, 'reassigned')
      await createAppointmentNotification(tx, auth.principal.id, id, clinicianId, 'assigned')
    } else if (scheduledStart.getTime() !== value.scheduledStart.getTime() || scheduledEnd.getTime() !== value.scheduledEnd.getTime()) {
      await createAppointmentNotification(tx, auth.principal.id, id, clinicianId, 'rescheduled')
    }
    return result
  })
}

export function changeAppointmentStatus(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string, status: AppointmentStatusInput) {
  return transaction(db, auth, 'APPOINTMENT_STATUS_UPDATE', true, async (tx, role) => {
    const value = await current(tx, auth, role, id, true)
    if (!appointmentTransitions[value.status].includes(status)) throw invalidTransition()
    const now = Date.now()
    if ((status === 'NO_SHOW' && now < value.scheduledStart.getTime())
      || (status === 'CHECKED_IN' && now < value.scheduledStart.getTime() - 3600000)) throw invalidTransition()
    // Cancellation/no-show/completion preserve history even after deactivation.
    // Moving into an active workflow requires eligible patient and clinician.
    if (status === 'CONFIRMED' || status === 'CHECKED_IN') await eligible(tx, value.patient.id, value.clinician?.id ?? null)
    const result = await tx.appointment.update({ where: { id }, data: { status }, select: appointmentSelect })
    await audit(tx, auth, context, id, 'APPOINTMENT_STATUS_CHANGED')
    return result
  })
}

export function cancelAppointment(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string, reason?: string | null) {
  return transaction(db, auth, 'APPOINTMENT_CANCEL', true, async (tx, role) => {
    const value = await current(tx, auth, role, id, true)
    if (value.status === 'CANCELLED') return value
    if (!editable.includes(value.status)) throw invalidTransition()
    const result = await tx.appointment.update({ where: { id }, data: {
      status: 'CANCELLED', cancelledAt: new Date(), cancelledById: auth.principal.id, cancellationReason: reason ?? null,
    }, select: appointmentSelect })
    await audit(tx, auth, context, id, 'APPOINTMENT_CANCELLED')
    await createAppointmentNotification(tx, auth.principal.id, id, value.clinician?.id ?? null, 'cancelled')
    return result
  })
}
