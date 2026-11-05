import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { disconnectDatabase } from '../src/database/prisma.js'
import { appendAuditEvent } from '../src/shared/audit/audit.js'
import { testDatabase } from './helpers/database.js'

const prisma = testDatabase()
afterAll(disconnectDatabase)
let authorId: string
let doctorId: string
let patientId: string
let appointmentId: string
let encounterId: string

const staffInput = (label: string) => ({
  firstName: 'Synthetic', lastName: label, email: `${label.toLowerCase()}-${randomUUID()}@example.test`,
  role: 'RECORDS_OFFICER' as const,
})

beforeAll(async () => {
  const author = await prisma.staffUser.create({ data: staffInput('Records') })
  const doctor = await prisma.staffUser.create({ data: { ...staffInput('Clinician'), role: 'DOCTOR_IN_CHARGE' } })
  authorId = author.id
  doctorId = doctor.id
  const patient = await prisma.patient.create({ data: {
    firstName: 'Synthetic', lastName: 'Patient', dateOfBirth: new Date('2000-01-01T00:00:00Z'), createdById: authorId,
  } })
  patientId = patient.id
  const appointment = await prisma.appointment.create({ data: {
    patientId, clinicianId: doctorId, createdById: authorId, type: 'FOLLOW_UP',
    scheduledStart: new Date('2030-01-01T10:00:00Z'), scheduledEnd: new Date('2030-01-01T10:30:00Z'),
  } })
  appointmentId = appointment.id
  const encounter = await prisma.encounter.create({ data: {
    patientId, appointmentId, clinicianId: doctorId, createdById: authorId, receivedById: authorId,
  } })
  encounterId = encounter.id
})

describe('migrated relational domain', () => {
  it('applies all reviewed migrations to the disposable database', async () => {
    const migrations = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY migration_name`
    expect(migrations.map((migration) => migration.migration_name)).toEqual([
      '20261002090000_initial_hospital_domain', '20261002090100_domain_integrity',
      '20261002120000_staff_auth_sessions',
      '20261003120000_patient_audit_actions',
      '20261003150000_appointment_scheduling_integrity',
      '20261004140000_clinical_encounter_integrity',
      '20261009120000_notification_workflow',
      '20261010120000_reporting_query_support',
      '20261104120000_mutation_idempotency',
    ])
    expect(migrations.every((migration) => migration.finished_at instanceof Date)).toBe(true)
  })

  it('enforces staff email and staff number uniqueness', async () => {
    const original = await prisma.staffUser.findUniqueOrThrow({ where: { id: authorId } })
    await expect(prisma.staffUser.create({ data: { ...staffInput('Duplicate'), email: original.email } })).rejects.toMatchObject({ code: 'P2002' })
    await expect(prisma.staffUser.create({ data: { ...staffInput('Duplicate'), staffNumber: original.staffNumber } })).rejects.toMatchObject({ code: 'P2002' })
    await expect(prisma.staffUser.create({ data: { ...staffInput('Uppercase'), email: original.email.toUpperCase() } })).rejects.toThrow()
  })

  it('rejects malformed staff numbers, plaintext hashes, and active accounts without credentials', async () => {
    await expect(prisma.staffUser.create({ data: { ...staffInput('Invalid'), staffNumber: 'invalid' } })).rejects.toThrow()
    await expect(prisma.staffUser.create({ data: { ...staffInput('Invalid'), passwordHash: 'plaintext', passwordChangedAt: new Date() } })).rejects.toThrow()
    await expect(prisma.staffUser.create({ data: { ...staffInput('Invalid'), status: 'ACTIVE' } })).rejects.toThrow()
  })

  it('generates independent patient references safely under concurrent inserts and rejects duplicates', async () => {
    const patients = await Promise.all(Array.from({ length: 12 }, () => prisma.patient.create({ data: {
      firstName: 'Synthetic', lastName: 'Concurrency', createdById: authorId,
    } })))
    expect(new Set(patients.map((patient) => patient.patientNumber)).size).toBe(12)
    const first = patients[0]!
    expect(first.patientNumber).toMatch(/^PT-[0-9A-F-]{36}$/)
    expect(first.patientNumber.slice(3)).not.toBe(first.id.toUpperCase())
    await expect(prisma.patient.create({ data: { firstName: 'Synthetic', lastName: 'Duplicate',
      createdById: authorId, patientNumber: first.patientNumber } })).rejects.toMatchObject({ code: 'P2002' })
  })

  it('preserves appointment/patient and encounter/patient/clinician relationships', async () => {
    const encounter = await prisma.encounter.findUniqueOrThrow({ where: { id: encounterId },
      include: { patient: true, clinician: true, appointment: true } })
    expect(encounter.patient.id).toBe(patientId)
    expect(encounter.clinician?.id).toBe(doctorId)
    expect(encounter.appointment?.patientId).toBe(patientId)
    expect(encounter.appointment?.reference).toMatch(/^AP-/)
    expect(encounter.reference).toMatch(/^MR-/)
  })

  it('allows walk-in encounters and prevents cross-patient or duplicate appointment linkage', async () => {
    const walkIn = await prisma.encounter.create({ data: { patientId, createdById: authorId } })
    expect(walkIn.appointmentId).toBeNull()
    const other = await prisma.patient.create({ data: { firstName: 'Synthetic', lastName: 'Other', createdById: authorId } })
    await expect(prisma.encounter.create({ data: { patientId: other.id, appointmentId, createdById: authorId } })).rejects.toMatchObject({ code: 'P2003' })
    await expect(prisma.encounter.create({ data: { patientId, appointmentId, createdById: authorId } })).rejects.toMatchObject({ code: 'P2002' })
  })

  it('rejects missing related patients, clinicians, and authors', async () => {
    await expect(prisma.encounter.create({ data: { patientId: randomUUID(), createdById: authorId } })).rejects.toMatchObject({ code: 'P2003' })
    await expect(prisma.encounter.create({ data: { patientId, clinicianId: randomUUID(), createdById: authorId } })).rejects.toMatchObject({ code: 'P2003' })
    await expect(prisma.patient.create({ data: { firstName: 'Synthetic', lastName: 'Orphan', createdById: randomUUID() } })).rejects.toMatchObject({ code: 'P2003' })
  })

  it('enforces appointment time order and cancellation metadata', async () => {
    await expect(prisma.appointment.update({ where: { id: appointmentId }, data: { scheduledEnd: new Date('2029-01-01') } })).rejects.toThrow()
    await expect(prisma.appointment.update({ where: { id: appointmentId }, data: { status: 'CANCELLED' } })).rejects.toThrow()
    const cancelled = await prisma.appointment.create({ data: {
      patientId, createdById: authorId, type: 'CONSULTATION', status: 'CANCELLED',
      scheduledStart: new Date('2030-01-01T11:00:00Z'), scheduledEnd: new Date('2030-01-01T11:30:00Z'),
      cancelledById: authorId, cancelledAt: new Date(),
    } })
    expect(cancelled.status).toBe('CANCELLED')
  })

  it('supports multiple complaints and diagnoses per encounter with protected history', async () => {
    await prisma.encounterComplaint.create({ data: { encounterId, description: 'Synthetic complaint A' } })
    await prisma.encounterComplaint.create({ data: { encounterId, description: 'Synthetic complaint B' } })
    await expect(prisma.encounterComplaint.create({ data: { encounterId, description: 'Synthetic complaint A' } })).rejects.toMatchObject({ code: 'P2002' })
    await prisma.diagnosis.create({ data: { encounterId, description: 'Synthetic finding A' } })
    await prisma.diagnosis.create({ data: { encounterId, description: 'Synthetic finding B' } })
    expect(await prisma.diagnosis.count({ where: { encounterId } })).toBe(2)
    await expect(prisma.diagnosis.create({ data: { encounterId: randomUUID(), description: 'Orphan' } })).rejects.toMatchObject({ code: 'P2003' })
    await expect(prisma.encounter.delete({ where: { id: encounterId } })).rejects.toMatchObject({ code: 'P2003' })
  })

  it('requires review attribution and explicit void metadata', async () => {
    await expect(prisma.encounter.update({ where: { id: encounterId }, data: { status: 'REVIEWED' } })).rejects.toThrow()
    const reviewed = await prisma.encounter.update({ where: { id: encounterId }, data: { status: 'REVIEWED', reviewedAt: new Date() } })
    expect(reviewed.clinicianId).toBe(doctorId)
    await expect(prisma.encounter.update({ where: { id: encounterId }, data: { status: 'VOIDED' } })).rejects.toThrow()
  })

  it('blocks staff/patient/appointment deletion and preserves history on deactivation/archival', async () => {
    await expect(prisma.staffUser.delete({ where: { id: authorId } })).rejects.toMatchObject({ code: 'P2003' })
    await expect(prisma.staffUser.delete({ where: { id: doctorId } })).rejects.toMatchObject({ code: 'P2003' })
    await expect(prisma.patient.delete({ where: { id: patientId } })).rejects.toMatchObject({ code: 'P2003' })
    await expect(prisma.appointment.delete({ where: { id: appointmentId } })).rejects.toMatchObject({ code: 'P2003' })
    await prisma.staffUser.update({ where: { id: doctorId }, data: { status: 'DISABLED' } })
    await prisma.patient.update({ where: { id: patientId }, data: { archivedAt: new Date() } })
    expect(await prisma.encounter.count({ where: { id: encounterId, clinicianId: doctorId, patientId } })).toBe(1)
  })

  it('maintains timestamps through Prisma and SQL, preserves creation time, and uses timezone-safe columns', async () => {
    const original = await prisma.patient.findUniqueOrThrow({ where: { id: patientId } })
    await prisma.$executeRaw`UPDATE "Patient" SET "phone" = '+000000000' WHERE id = ${patientId}::uuid`
    const updated = await prisma.patient.findUniqueOrThrow({ where: { id: patientId } })
    expect(updated.createdAt).toEqual(original.createdAt)
    expect(updated.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime())
    expect(updated.dateOfBirth?.toISOString()).toBe('2000-01-01T00:00:00.000Z')
    await expect(prisma.patient.update({ where: { id: patientId }, data: { createdAt: new Date('1990-01-01') } })).rejects.toThrow()
    const columns = await prisma.$queryRaw<Array<{ data_type: string }>>`
      SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'createdAt'`
    expect(columns).toHaveLength(12)
    expect(columns.every((column) => column.data_type === 'timestamp with time zone')).toBe(true)
  })

  it('stores broadcast content once and per-recipient read state without duplicates', async () => {
    const notification = await prisma.notification.create({ data: { senderId: authorId, type: 'BROADCAST',
      targetRole: 'RECORDS_OFFICER', title: 'Synthetic notice', message: 'Synthetic test notice only',
      recipients: { create: [{ staffUserId: authorId }, { staffUserId: doctorId }] },
    }, include: { recipients: true } })
    expect(notification.recipients).toHaveLength(2)
    await expect(prisma.notificationRecipient.create({ data: { notificationId: notification.id, staffUserId: authorId } })).rejects.toMatchObject({ code: 'P2002' })
    await expect(prisma.notificationRecipient.create({ data: { notificationId: notification.id, staffUserId: randomUUID() } })).rejects.toMatchObject({ code: 'P2003' })
    const recipient = notification.recipients.find((item) => item.staffUserId === authorId)!
    await prisma.notificationRecipient.update({ where: { id: recipient.id }, data: { readAt: new Date() } })
    expect(await prisma.notificationRecipient.count({ where: { notificationId: notification.id, readAt: null } })).toBe(1)
  })

  it('relates audit actors, restricts metadata, and prevents update/delete/truncate', async () => {
    const event = await prisma.$transaction((tx) => appendAuditEvent(tx, {
      actorId: authorId, action: 'PATIENT_VIEWED', entityType: 'PATIENT', entityId: patientId,
      requestId: 'test-audit', metadata: { source: 'API' },
    }))
    expect(event.actorId).toBe(authorId)
    await expect(prisma.auditEvent.update({ where: { id: event.id }, data: { action: 'PATIENT_UPDATED' } })).rejects.toThrow()
    await expect(prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow()
    await expect(prisma.$executeRaw`TRUNCATE TABLE "AuditEvent"`).rejects.toThrow()
    await expect(prisma.auditEvent.create({ data: { actorId: randomUUID(), action: 'PATIENT_VIEWED', entityType: 'PATIENT', entityId: patientId } })).rejects.toMatchObject({ code: 'P2003' })
    for (const metadata of [{ password: 'must-not-be-stored' }, { source: 'API', changedFields: ['clinical-secret'] }]) {
      await expect(prisma.auditEvent.create({ data: { action: 'PATIENT_VIEWED', entityType: 'PATIENT', entityId: patientId, metadata } })).rejects.toThrow()
    }
    expect(await prisma.auditEvent.findUnique({ where: { id: event.id } })).not.toBeNull()
  })
})
