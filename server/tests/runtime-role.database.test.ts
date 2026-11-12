import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Writable } from 'node:stream'
import { PrismaPg } from '@prisma/adapter-pg'
import { Client } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { disconnectDatabase } from '../src/database/prisma.js'
import { PrismaClient, type StaffRole } from '../src/generated/prisma/client.js'
import { createLogger } from '../src/shared/logger/logger.js'
import { hashPassword } from '../src/shared/security/password.js'
import { hashSessionToken, pruneExpiredSessions } from '../src/modules/auth/session.service.js'
import { pruneExpiredIdempotencyRecords } from '../src/shared/idempotency/idempotency.js'
import { isolatedTestEnvironment, testDatabase } from './helpers/database.js'

// The application runs under the role that ops/runtime-grants.sql configures: no ownership, no
// superuser, only the listed table privileges. The owner/migration identity only seeds fixtures.
const env = isolatedTestEnvironment(), owner = testDatabase()
const PASSWORD = 'Synthetic runtime role passphrase', role = `medicare_test_role_${randomBytes(8).toString('hex')}`, secret = randomBytes(24).toString('hex')
const grants = readFileSync(new URL('../ops/runtime-grants.sql', import.meta.url), 'utf8')
// psql substitutes :"runtime_role" and :'runtime_role'; node-postgres needs the names spelled out.
const scriptFor = (name: string) => grants.split('\n').filter((line) => !line.startsWith('\\')).join('\n')
  .replaceAll(':"runtime_role"', `"${name}"`).replaceAll(":'runtime_role'", `'${name}'`)
async function asOwner<T>(work: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: env.DATABASE_URL }); await client.connect()
  try { return await work(client) } finally { await client.end() }
}
let runtime: PrismaClient, runtimeSql: Client, app: ReturnType<typeof createApp>, hash: string
const url = new URL(env.DATABASE_URL); url.username = role; url.password = secret

type Actor = { id: string; cookie: string; csrf: string }
async function signIn(roleName: StaffRole): Promise<Actor> {
  const user = await owner.staffUser.create({ data: { firstName: 'Synthetic', lastName: 'Runtime', email: `${randomUUID()}@example.test`,
    role: roleName, status: 'ACTIVE', passwordHash: hash, passwordChangedAt: new Date() } })
  const response = await request(app).post('/api/v1/auth/login').set('Origin', env.CLIENT_ORIGIN).send({ email: user.email, password: PASSWORD }).expect(200)
  const cookie = String(response.headers['set-cookie']).split(';')[0]!
  const csrf = (await request(app).get('/api/v1/auth/csrf').set('Cookie', cookie).expect(200)).body.data.csrfToken as string
  return { id: user.id, cookie, csrf }
}
const send = (method: 'post' | 'patch', path: string, body: object, who: Actor, key?: string) => {
  const call = request(app)[method](`/api/v1${path}`).set('Cookie', who.cookie).set('Origin', env.CLIENT_ORIGIN).set('X-CSRF-Token', who.csrf)
  if (key) call.set('Idempotency-Key', key)
  return call.send(body)
}
const read = (path: string, who: Actor) => request(app).get(`/api/v1${path}`).set('Cookie', who.cookie)
const attempt = async (sql: string, params: unknown[] = []) => {
  try { await runtimeSql.query(sql, params); return 'ALLOWED' } catch (error) { return (error as { code?: string }).code ?? 'ERROR' }
}

beforeAll(async () => {
  hash = await hashPassword(PASSWORD)
  await asOwner((client) => client.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${secret}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`))
  await asOwner((client) => client.query(scriptFor(role)))
  runtime = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.href, max: 5 }) })
  runtimeSql = new Client({ connectionString: url.href }); await runtimeSql.connect()
  app = createApp({ env, prisma: runtime, checkDatabase: async () => { await runtime.$queryRaw`SELECT 1` },
    logger: createLogger('info', new Writable({ write(_chunk, _encoding, callback) { callback() } })) })
})
afterAll(async () => {
  await runtimeSql?.end(); await runtime?.$disconnect()
  await asOwner(async (client) => { await client.query(`DROP OWNED BY "${role}"`); await client.query(`DROP ROLE IF EXISTS "${role}"`) })
  await disconnectDatabase()
})

describe('runtime grants script', () => {
  it('refuses a role that is the owner, a superuser, an object owner, a member of the owner role or missing', async () => {
    const probe = `medicare_test_probe_${randomBytes(6).toString('hex')}`
    const refusal = (name: string) => asOwner((client) => client.query(scriptFor(name)).then(() => 'APPLIED', (error: Error) => error.message))
    try {
      const self = await asOwner(async (client) => (await client.query<{ name: string }>('SELECT current_user AS name')).rows[0]!.name)
      expect(await refusal(self)).toBe('Run this script as the migration owner, not as the runtime role')
      expect(await refusal(`${probe}_absent`)).toMatch(/does not exist/)
      await asOwner((client) => client.query(`CREATE ROLE "${probe}" LOGIN SUPERUSER`))
      expect(await refusal(probe)).toMatch(/must not be a superuser/)
      await asOwner(async (client) => { await client.query(`ALTER ROLE "${probe}" NOSUPERUSER`); await client.query('CREATE TABLE test_probe_owned (id int)'); await client.query(`ALTER TABLE test_probe_owned OWNER TO "${probe}"`) })
      expect(await refusal(probe)).toMatch(/owns schema objects/)
      await asOwner(async (client) => { await client.query('DROP TABLE test_probe_owned'); await client.query(`GRANT "${self}" TO "${probe}"`) })
      expect(await refusal(probe)).toMatch(/member of the table owner role/)
      await asOwner((client) => client.query(`REVOKE "${self}" FROM "${probe}"`))
    } finally {
      await asOwner(async (client) => { await client.query('DROP TABLE IF EXISTS test_probe_owned'); await client.query(`DROP OWNED BY "${probe}"`).catch(() => undefined); await client.query(`DROP ROLE IF EXISTS "${probe}"`) })
    }
  })

  it('grants exactly the documented privileges and no ownership', async () => {
    const rows = (await asOwner((client) => client.query<{ table_name: string; privileges: string }>(`SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants WHERE grantee = $1 GROUP BY table_name ORDER BY table_name`, [role]))).rows
    expect(Object.fromEntries(rows.map((row) => [row.table_name, row.privileges]))).toEqual({
      Admission: 'INSERT,SELECT,UPDATE', AdmissionRoomHistory: 'INSERT,SELECT,UPDATE',
      // Appointments are read-only history now: no API route writes them.
      Appointment: 'SELECT', AuditEvent: 'INSERT,SELECT', Diagnosis: 'DELETE,INSERT,SELECT', Encounter: 'INSERT,SELECT,UPDATE',
      EncounterAmendment: 'INSERT,SELECT', EncounterComplaint: 'DELETE,INSERT,SELECT', IdempotencyRecord: 'DELETE,INSERT,SELECT',
      Medication: 'INSERT,SELECT,UPDATE', MedicationOrder: 'DELETE,INSERT,SELECT',
      Notification: 'INSERT,SELECT', NotificationRecipient: 'INSERT,SELECT,UPDATE', Patient: 'INSERT,SELECT,UPDATE',
      StaffSession: 'DELETE,INSERT,SELECT,UPDATE', StaffUser: 'INSERT,SELECT,UPDATE',
    })
    // Admission numbers: nextval only (USAGE), never setval (UPDATE) or anything else.
    const sequence = (await asOwner((client) => client.query<{ usage: boolean; update: boolean; select: boolean }>(`SELECT has_sequence_privilege($1, 'admission_number_seq', 'USAGE') AS usage,
      has_sequence_privilege($1, 'admission_number_seq', 'UPDATE') AS update, has_sequence_privilege($1, 'admission_number_seq', 'SELECT') AS select`, [role]))).rows[0]
    expect(sequence).toEqual({ usage: true, update: false, select: false })
    const owned = await asOwner((client) => client.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = $1`, [role]))
    expect(owned.rows[0].n).toBe(0)
    // Rerunning after a migration is safe and leaves the same grants.
    await asOwner((client) => client.query(scriptFor(role)))
  })
})

describe('application under the runtime role', () => {
  let encounterId: string, amendmentText: string, admissionId: string, patientId: string
  it('runs every workflow: sign-in, staff, patients, admission, clinical records and medications, discharge, notifications, reports, credentials and pruning', async () => {
    const admin = await signIn('ADMIN'), records = await signIn('RECORDS_OFFICER'), doctor = await signIn('DOCTOR_IN_CHARGE')
    const recruit = { firstName: 'Synthetic', lastName: 'Recruit', email: `${randomUUID()}@example.test`, staffNumber: `STF-RT${randomBytes(4).toString('hex').toUpperCase()}`, role: 'RECORDS_OFFICER', password: PASSWORD }
    const staffKey = `runtime-${randomUUID()}`
    const createdStaff = await send('post', '/staff', recruit, admin, staffKey).expect(201)
    expect((await send('post', '/staff', recruit, admin, staffKey).expect(201)).headers['idempotency-replayed']).toBe('true')
    const patient = (await send('post', '/patients', { firstName: 'Synthetic', lastName: `Runtime-${randomUUID()}` }, records, `runtime-${randomUUID()}`).expect(201)).body.data.patient
    await send('patch', `/patients/${patient.id}`, { phone: '+233200550000' }, records).expect(200)
    patientId = patient.id
    // Admission draws its number from the sequence (USAGE grant) and records the first room.
    const admissionKey = `runtime-${randomUUID()}`
    const admission = (await send('post', '/admissions', { patientId: patient.id, roomNumber: 'Ward A - Bed 6' }, records, admissionKey).expect(201)).body.data.admission
    expect(admission.admissionNumber).toMatch(/^AD-\d{6,}$/)
    expect((await send('post', '/admissions', { patientId: patient.id, roomNumber: 'Ward A - Bed 6' }, records, admissionKey).expect(201)).headers['idempotency-replayed']).toBe('true')
    admissionId = admission.id
    await send('post', `/admissions/${admission.id}/room`, { roomNumber: 'Private Room 3', note: 'Synthetic transfer' }, records).expect(200)
    // The medication catalog: Admin adds, deactivates and reactivates; Medical Officers prescribe from it.
    const added = (await send('post', '/medications', { name: `Synthetic runtime medicine ${randomUUID().slice(0, 8)}` }, admin).expect(201)).body.data.medication
    await send('post', `/medications/${added.id}/deactivate`, {}, admin).expect(200)
    await send('post', `/medications/${added.id}/reactivate`, {}, admin).expect(200)
    await read('/medications?status=all', admin).expect(200)
    const options = (await read('/medications/options', doctor).expect(200)).body.data.items as { id: string; name: string }[]
    const paracetamol = options.find((item) => item.name === 'Paracetamol')!.id
    const encounter = (await send('post', '/encounters', { admissionId: admission.id, occurredAt: new Date(Date.now() - 60000).toISOString(),
      clinicalNotes: 'Synthetic runtime notes', complaints: [{ description: 'Synthetic complaint' }], diagnoses: [{ description: 'Synthetic diagnosis', code: 'R-1' }],
      medications: [{ medicationId: paracetamol, strength: '500 mg', dose: '1 tablet', route: 'Oral', frequency: 'Twice daily' }] },
    doctor, `runtime-${randomUUID()}`).expect(201)).body.data.encounter
    encounterId = encounter.id
    // Editing a draft replaces its complaints, diagnoses and medication orders: the runtime role's only clinical deletes.
    await send('patch', `/encounters/${encounter.id}`, { complaints: [{ description: 'Revised complaint' }, { description: 'Second complaint' }], diagnoses: [{ description: 'Revised diagnosis' }],
      medications: [{ medicationId: added.id, dose: '1 tablet', route: 'Oral', frequency: 'Twice daily' }] }, doctor).expect(200)
    await send('post', `/encounters/${encounter.id}/finalize`, {}, doctor).expect(200)
    amendmentText = `Synthetic amendment ${randomUUID()}`
    await send('post', `/encounters/${encounter.id}/amend`, { reason: 'Clarify', content: amendmentText }, doctor).expect(201)
    expect((await read(`/patients/${patient.id}/medications`, doctor).expect(200)).body.data.items).toHaveLength(1)
    await send('post', `/admissions/${admission.id}/discharge`, { dischargeNotes: 'Synthetic discharge summary' }, doctor).expect(200)
    await read(`/admissions/${admission.id}`, records).expect(200)
    for (const who of [admin, records]) await read('/reports/admissions', who).expect(200)
    await send('post', '/notifications/broadcast', { title: 'Synthetic runtime notice', message: 'Synthetic runtime broadcast body', audience: { type: 'ALL' } }, admin, `runtime-${randomUUID()}`).expect(201)
    const inbox = (await read('/notifications', doctor).expect(200)).body.data.items as { id: string }[]
    await send('post', `/notifications/${inbox[0]!.id}/read`, {}, doctor).expect(200)
    for (const who of [admin, records, doctor]) await read('/dashboard', who).expect(200)
    await send('post', `/staff/${createdStaff.body.data.user.id}/reset-password`, { password: 'Runtime reset synthetic passphrase' }, admin).expect(200)
    await send('post', '/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Runtime changed synthetic passphrase' }, records).expect(200)
    await send('post', '/auth/logout', {}, admin).expect(200)
    // Maintenance commands use the same role: each needs only DELETE on its own table.
    const past = new Date(Date.now() - 10 * 3600000)
    await owner.staffSession.create({ data: { staffUserId: doctor.id, tokenHash: hashSessionToken(randomBytes(32).toString('hex')), csrfToken: randomBytes(32).toString('hex'), createdAt: past, expiresAt: new Date(past.getTime() + 3600000) } })
    const spare = await owner.patient.create({ data: { firstName: 'Synthetic', lastName: 'Expired retry', createdById: admin.id } })
    await owner.idempotencyRecord.create({ data: { principalId: admin.id, operation: 'PATIENT_CREATE', keyHash: 'a'.repeat(64), requestHash: 'b'.repeat(64), patientId: spare.id, createdAt: past, expiresAt: new Date(past.getTime() + 60000) } })
    expect(await pruneExpiredSessions(runtime)).toBeGreaterThanOrEqual(1)
    expect(await pruneExpiredIdempotencyRecords(runtime)).toBe(1)
    await request(app).get('/api/v1/health/ready').expect(200)
  })

  it('cannot bypass finalized-record, admission, medication, amendment, audit, notification or retry-record protections', async () => {
    const before = await owner.encounter.findUniqueOrThrow({ where: { id: encounterId }, include: { complaints: true, diagnoses: true, amendments: true } })
    const audits = await owner.auditEvent.count(), denied = ['42501', '23514']
    const admissionBefore = await owner.admission.findUniqueOrThrow({ where: { id: admissionId }, include: { rooms: true } })
    const appointment = await owner.appointment.create({ data: { patientId, createdById: admissionBefore.admittedById, type: 'CONSULTATION', status: 'COMPLETED',
      scheduledStart: new Date('2026-01-05T09:00:00Z'), scheduledEnd: new Date('2026-01-05T09:30:00Z') } })
    const attacks: [string, unknown[]?][] = [
      ['UPDATE "Encounter" SET "clinicalNotes" = \'tampered\' WHERE id = $1', [encounterId]],
      ['DELETE FROM "Encounter" WHERE id = $1', [encounterId]],
      ['INSERT INTO "EncounterComplaint" ("encounterId", description) VALUES ($1, \'added later\')', [encounterId]],
      ['DELETE FROM "EncounterComplaint" WHERE "encounterId" = $1', [encounterId]],
      ['DELETE FROM "Diagnosis" WHERE "encounterId" = $1', [encounterId]],
      ['DELETE FROM "MedicationOrder" WHERE "encounterId" = $1', [encounterId]],
      ['UPDATE "MedicationOrder" SET dose = \'tampered\' WHERE "encounterId" = $1', [encounterId]],
      ['INSERT INTO "MedicationOrder" ("encounterId", medicine) VALUES ($1, \'added later\')', [encounterId]],
      ['TRUNCATE "MedicationOrder"'],
      ['UPDATE "Medication" SET name = \'Renamed medicine\' WHERE name = \'Paracetamol\''],
      ['DELETE FROM "Medication" WHERE name = \'Paracetamol\''], ['TRUNCATE "Medication" CASCADE'],
      ['UPDATE "Admission" SET "dischargeNotes" = \'rewritten\' WHERE id = $1', [admissionId]],
      ['UPDATE "Admission" SET status = \'ADMITTED\', "dischargedAt" = NULL, "dischargedById" = NULL, "dischargeNotes" = NULL WHERE id = $1', [admissionId]],
      ['DELETE FROM "Admission" WHERE id = $1', [admissionId]], ['TRUNCATE "Admission" CASCADE'],
      ['UPDATE "AdmissionRoomHistory" SET "roomNumber" = \'rewritten\' WHERE "admissionId" = $1', [admissionId]],
      ['DELETE FROM "AdmissionRoomHistory" WHERE "admissionId" = $1', [admissionId]], ['TRUNCATE "AdmissionRoomHistory"'],
      ['SELECT setval(\'admission_number_seq\', 1)'], ['ALTER SEQUENCE admission_number_seq RESTART'],
      ['UPDATE "Appointment" SET status = \'CANCELLED\' WHERE id = $1', [appointment.id]],
      ['INSERT INTO "Appointment" ("patientId", "createdById", type, "scheduledStart", "scheduledEnd") SELECT "patientId", "createdById", type, "scheduledStart" + interval \'1 day\', "scheduledEnd" + interval \'1 day\' FROM "Appointment" WHERE id = $1', [appointment.id]],
      ['UPDATE "EncounterAmendment" SET content = \'rewritten\' WHERE "encounterId" = $1', [encounterId]],
      ['DELETE FROM "EncounterAmendment" WHERE "encounterId" = $1', [encounterId]],
      ['TRUNCATE "EncounterAmendment"'], ['TRUNCATE "Encounter" CASCADE'],
      ['UPDATE "AuditEvent" SET metadata = NULL'], ['DELETE FROM "AuditEvent"'], ['TRUNCATE "AuditEvent"'],
      ['UPDATE "IdempotencyRecord" SET "expiresAt" = now() + interval \'1 day\''],
      ['UPDATE "Notification" SET title = \'rewritten\''], ['DELETE FROM "Notification"'], ['DELETE FROM "NotificationRecipient"'],
      ['ALTER TABLE "Encounter" DISABLE TRIGGER ALL'], ['ALTER TABLE "AuditEvent" DISABLE TRIGGER audit_no_update_delete'],
      ['DROP TRIGGER encounter_finalized_immutable ON "Encounter"'],
      ['CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$'],
      ['SET session_replication_role = replica'], ['CREATE TABLE public.runtime_probe (id int)'],
      ['SELECT migration_name FROM _prisma_migrations'], [`ALTER ROLE "${role}" SUPERUSER`], [`ALTER ROLE "${role}" BYPASSRLS`],
    ]
    for (const [sql, params] of attacks) {
      const result = await attempt(sql, params)
      expect([sql, denied.includes(result)]).toEqual([sql, true])
    }
    const after = await owner.encounter.findUniqueOrThrow({ where: { id: encounterId }, include: { complaints: true, diagnoses: true, amendments: true } })
    expect(after).toEqual(before)
    expect(after.amendments.map((amendment) => amendment.content)).toEqual([amendmentText])
    expect(await owner.auditEvent.count()).toBe(audits)
    expect(await owner.admission.findUniqueOrThrow({ where: { id: admissionId }, include: { rooms: true } })).toEqual(admissionBefore)
    expect(await owner.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).toEqual(appointment)
    expect((await asOwner((client) => client.query<{ n: number }>('SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = \'O\''))).rows[0]!.n)
      .toBe((await asOwner((client) => client.query<{ n: number }>('SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal'))).rows[0]!.n)
  })
})
