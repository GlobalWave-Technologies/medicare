import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { disconnectDatabase } from '../src/database/prisma.js'
import { createLogger } from '../src/shared/logger/logger.js'
import { hashPassword } from '../src/shared/security/password.js'
import { createSession } from '../src/modules/auth/session.service.js'
import { isolatedTestEnvironment, testDatabase } from './helpers/database.js'
import type { StaffRole } from '../src/generated/prisma/client.js'

// Phase 19B: the medication catalog (Admin), prescribing from it (Medical Officer), and the rules
// that keep prescriptions permanent once a clinical record is finalized. Phase 19F: Medical Officers
// may add a missing medicine while prescribing; deactivating and reactivating stay Admin-only.
const db = testDatabase(), env = isolatedTestEnvironment(), base = '/api/v1/medications'
type Actor = { id: string; cookie: string; csrf: string }
const actors = new Map<StaffRole, Actor>()
const actor = (role: StaffRole = 'DOCTOR_IN_CHARGE') => actors.get(role)!
let hash: string, logs = '', app: ReturnType<typeof createApp>
// The sixteen medicines of the previous system's dropdown, as seeded by the migration.
const recovered = ['Antacid (Aluminium hydroxide tab)', 'Liver salt', 'Loperamide', 'ORS', 'Diclofenac', 'Ibuprofen', 'Paracetamol', 'Folic acid',
  'Cetirizine', 'Hyoscine butylbromide (Buscolex)', 'Vitamin C tab', 'Multivitamin', 'Salbutamol tab', 'Salbutamol inhaler', 'Oral glucose', 'Mebendazole (dewormer)']
const byName = (names: string[]) => [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))

async function newActor(role: StaffRole, mustChangePassword = false): Promise<Actor> {
  const user = await db.staffUser.create({ data: { firstName: 'Synthetic', lastName: 'Pharmacology', email: `${randomUUID()}@example.test`,
    role, status: 'ACTIVE', passwordHash: hash, passwordChangedAt: new Date(), mustChangePassword } })
  const session = await db.$transaction((tx) => createSession(tx, user.id))
  return { id: user.id, cookie: `medicare_session=${session.token}`, csrf: session.session.csrfToken }
}
function send(method: 'post' | 'patch' | 'delete', path: string, body: object = {}, who = actor()) {
  return request(app)[method](path).set('Cookie', who.cookie).set('Origin', env.CLIENT_ORIGIN).set('X-CSRF-Token', who.csrf).send(body)
}
const read = (path: string, who = actor()) => request(app).get(path).set('Cookie', who.cookie)
const catalogId = async (name: string) => (await db.medication.findFirstOrThrow({ where: { name } })).id
const create = (name: string, who = actor('ADMIN')) => send('post', base, { name }, who)
async function newMedicine(prefix = 'Synthetic medicine') {
  const response = await create(`${prefix} ${randomUUID().slice(0, 8)}`)
  expect(response.status).toBe(201)
  return response.body.data.medication as { id: string; name: string; active: boolean }
}
async function admitted() {
  const patient = await db.patient.create({ data: { firstName: 'Synthetic', lastName: `Prescribing-${randomUUID()}`, createdById: actor('ADMIN').id } })
  const at = new Date(Date.now() - 3 * 3600000)
  const admission = await db.admission.create({ data: { patientId: patient.id, roomNumber: 'Ward C - Bed 1', admittedAt: at, admittedById: actor('ADMIN').id,
    rooms: { create: { roomNumber: 'Ward C - Bed 1', assignedAt: at, assignedById: actor('ADMIN').id } } } })
  return { patient, admission }
}
async function discharge(admissionId: string) {
  const at = new Date()
  await db.$transaction([
    db.admissionRoomHistory.updateMany({ where: { admissionId, endedAt: null }, data: { endedAt: at } }),
    db.admission.update({ where: { id: admissionId }, data: { status: 'DISCHARGED', dischargedAt: at, dischargedById: actor().id } }),
  ])
}
const order = (medicationId: string, extra: object = {}) => ({ medicationId, strength: '500 mg', dose: '1 tablet', route: 'Oral', frequency: 'Three times daily', duration: '5 days', ...extra })
type Order = { id: string; medicationId: string | null; medicine: string; strength: string | null; dose: string | null; frequency: string | null; notes: string | null }
async function prescribe(admissionId: string, medications: object[], extra: object = {}) {
  const response = await send('post', '/api/v1/encounters', { admissionId, occurredAt: new Date(Date.now() - 60000).toISOString(), medications, ...extra })
  expect(response.status).toBe(201)
  return response.body.data.encounter as { id: string; status: string; medications: Order[] }
}
const finalize = async (id: string) => expect((await send('post', `/api/v1/encounters/${id}/finalize`, {})).status).toBe(200)

beforeAll(async () => {
  hash = await hashPassword('Synthetic medication test passphrase')
  for (const role of ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) actors.set(role, await newActor(role))
})
beforeEach(() => {
  logs = ''
  app = createApp({ env, prisma: db, checkDatabase: async () => {}, logger: createLogger('info', new Writable({
    write(chunk: Buffer, _encoding, callback) { logs += chunk.toString(); callback() },
  })) })
})
afterAll(disconnectDatabase)

describe('initial catalog', () => {
  it('seeds the previous system\'s sixteen medicines, active and sorted ignoring case', async () => {
    const options = await read(`${base}/options`)
    expect(options.status).toBe(200)
    expect(options.headers['cache-control']).toBe('no-store')
    expect(options.body.data.items.map((item: { name: string }) => item.name)).toEqual(byName(recovered))
    expect(options.body.data.items.every((item: object) => Object.keys(item).sort().join() === 'id,name')).toBe(true)
    expect(await db.medication.count({ where: { active: true } })).toBe(16)
  })
  it('re-running the seed adds nothing', async () => {
    const values = recovered.map((name) => `('${name.replace(/'/g, "''")}')`).join(', ')
    expect(await db.$executeRawUnsafe(`INSERT INTO "Medication" ("name") VALUES ${values} ON CONFLICT ((lower("name"))) DO NOTHING`)).toBe(0)
    expect(await db.medication.count({ where: { name: { in: recovered } } })).toBe(16)
  })
})

describe('catalog authorization', () => {
  const id = randomUUID()
  const routes = [['get', base], ['get', `${base}/options`], ['post', base], ['post', `${base}/${id}/deactivate`], ['post', `${base}/${id}/reactivate`]] as const
  it.each(routes)('rejects anonymous %s %s', async (method, path) => expect((await request(app)[method](path)).status).toBe(401))
  it('lets Admin and Medical Officers read the catalog; the Records Officer has no access', async () => {
    for (const role of ['ADMIN', 'DOCTOR_IN_CHARGE'] as const) {
      expect((await read(base, actor(role))).status).toBe(200)
      expect((await read(`${base}/options`, actor(role))).status).toBe(200)
    }
    for (const path of [base, `${base}/options`, `${base}?status=all`]) expect((await read(path, actor('RECORDS_OFFICER'))).body.error.code).toBe('FORBIDDEN')
  })
  it('refuses every catalog change by the Records Officer', async () => {
    const medicine = await newMedicine()
    const before = await db.medication.count(), audits = await db.auditEvent.count()
    const refused = await create(`Refused medicine ${randomUUID()}`, actor('RECORDS_OFFICER'))
    expect([refused.status, refused.body.error.code]).toEqual([403, 'FORBIDDEN'])
    for (const command of ['deactivate', 'reactivate']) expect((await send('post', `${base}/${medicine.id}/${command}`, {}, actor('RECORDS_OFFICER'))).status).toBe(403)
    expect(await db.medication.count()).toBe(before)
    expect(await db.auditEvent.count()).toBe(audits)
    expect((await db.medication.findUniqueOrThrow({ where: { id: medicine.id } })).active).toBe(true)
  })
  it('lets a Medical Officer add a medicine but never deactivate or reactivate one', async () => {
    const doctor = actor('DOCTOR_IN_CHARGE'), active = await newMedicine('Kept active'), inactive = await newMedicine('Kept inactive')
    await send('post', `${base}/${inactive.id}/deactivate`, {}, actor('ADMIN'))
    const audits = await db.auditEvent.count()
    for (const [medicine, command] of [[active, 'deactivate'], [active, 'reactivate'], [inactive, 'reactivate'], [inactive, 'deactivate']] as const) {
      const response = await send('post', `${base}/${medicine.id}/${command}`, {}, doctor)
      expect([response.status, response.body.error.code]).toEqual([403, 'FORBIDDEN'])
    }
    expect((await db.medication.findUniqueOrThrow({ where: { id: active.id } })).active).toBe(true)
    expect((await db.medication.findUniqueOrThrow({ where: { id: inactive.id } })).active).toBe(false)
    expect(await db.auditEvent.count()).toBe(audits)
    expect((await create(`Officer medicine ${randomUUID().slice(0, 8)}`, doctor)).status).toBe(201)
  })
  it('keeps a temporary-password account out of the catalog until the password is changed', async () => {
    const temporary = await newActor('DOCTOR_IN_CHARGE', true), name = `Temporary medicine ${randomUUID().slice(0, 8)}`
    const response = await create(name, temporary)
    expect([response.status, response.body.error.code]).toEqual([403, 'PASSWORD_CHANGE_REQUIRED'])
    expect(await db.medication.count({ where: { name } })).toBe(0)
  })
  it('requires CSRF and the trusted origin for catalog changes', async () => {
    const admin = actor('ADMIN'), name = `CSRF medicine ${randomUUID()}`
    const missing = await request(app).post(base).set('Cookie', admin.cookie).set('Origin', env.CLIENT_ORIGIN).send({ name })
    expect([missing.status, missing.body.error.code]).toEqual([403, 'CSRF_INVALID'])
    const foreign = await request(app).post(base).set('Cookie', admin.cookie).set('Origin', 'https://attacker.example').set('X-CSRF-Token', admin.csrf).send({ name })
    expect(foreign.status).toBe(403)
    expect(await db.medication.count({ where: { name } })).toBe(0)
  })
})

describe('catalog administration', () => {
  it('adds a medicine with a tidy name, audited by entry only', async () => {
    const response = await send('post', base, { name: '  Amoxicillin   capsule  ' }, actor('ADMIN'))
    expect(response.status).toBe(201)
    const value = response.body.data.medication
    expect(Object.keys(value).sort()).toEqual(['id', 'name', 'active', 'createdAt', 'updatedAt'].sort())
    expect(value).toMatchObject({ name: 'Amoxicillin capsule', active: true })
    const events = await db.auditEvent.findMany({ where: { requestId: response.headers['x-request-id'] } })
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.actorId, event.metadata]))
      .toEqual([['MEDICATION_CREATED', 'MEDICATION', value.id, actor('ADMIN').id, { source: 'API' }]])
    expect((await read(`${base}/options`)).body.data.items.map((item: { name: string }) => item.name)).toContain('Amoxicillin capsule')
  })
  it.each(['Paracetamol', 'paracetamol', 'PARACETAMOL', '  paraCETAMOL ', 'Paracetamol'])('refuses %j as a duplicate, ignoring case and spacing', async (name) => {
    const before = await db.medication.count(), audits = await db.auditEvent.count()
    const response = await create(name)
    expect([response.status, response.body.error.code]).toEqual([409, 'MEDICATION_ALREADY_EXISTS'])
    expect(await db.medication.count()).toBe(before)
    expect(await db.auditEvent.count()).toBe(audits)
  })
  it('refuses a duplicate of an inactive medicine with its own code, and never reactivates it', async () => {
    const medicine = await newMedicine('Inactive duplicate')
    await send('post', `${base}/${medicine.id}/deactivate`, {}, actor('ADMIN'))
    const audits = await db.auditEvent.count()
    for (const who of [actor('ADMIN'), actor('DOCTOR_IN_CHARGE')]) {
      const response = await create(medicine.name.toUpperCase(), who)
      expect([response.status, response.body.error.code]).toEqual([409, 'MEDICATION_EXISTS_INACTIVE'])
    }
    expect((await db.medication.findUniqueOrThrow({ where: { id: medicine.id } })).active).toBe(false)
    expect(await db.medication.count({ where: { name: { equals: medicine.name, mode: 'insensitive' } } })).toBe(1)
    expect(await db.auditEvent.count()).toBe(audits)
    expect((await read(`${base}/options`)).body.data.items.map((item: { id: string }) => item.id)).not.toContain(medicine.id)
  })
  it.each([['two administrators', 'ADMIN'], ['an administrator and a Medical Officer', 'DOCTOR_IN_CHARGE']] as const)('creates one entry when %s add the same medicine at once', async (_label, role) => {
    const second = await newActor(role), name = `Concurrent medicine ${randomUUID().slice(0, 8)}`
    const results = await Promise.all([create(name), create(name.toLowerCase(), second)])
    expect(results.map((result) => result.status).sort()).toEqual([201, 409])
    expect(await db.medication.count({ where: { name: { equals: name, mode: 'insensitive' } } })).toBe(1)
  })
  it.each([{}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(201) }, { name: 'Line\nbreak' }, { name: 'Bell\u0007' }, { name: 'Valid', active: false },
    { name: 'Valid', id: randomUUID() }, { name: 42 }])('validates new medicines %j', async (body) => {
    expect((await send('post', base, body, actor('ADMIN'))).body.error.code).toBe('VALIDATION_ERROR')
  })
  it('deactivates and reactivates, audited once per real change', async () => {
    const medicine = await newMedicine('Toggle'), admin = actor('ADMIN')
    const off = await send('post', `${base}/${medicine.id}/deactivate`, {}, admin)
    expect(off.body.data.medication).toMatchObject({ id: medicine.id, name: medicine.name, active: false })
    expect((await read(`${base}/options`)).body.data.items.map((item: { id: string }) => item.id)).not.toContain(medicine.id)
    const again = await send('post', `${base}/${medicine.id}/deactivate`, {}, admin)
    expect(again.status).toBe(200)
    expect(await db.auditEvent.count({ where: { requestId: again.headers['x-request-id'] } })).toBe(0)
    const on = await send('post', `${base}/${medicine.id}/reactivate`, {}, admin)
    expect(on.body.data.medication.active).toBe(true)
    expect((await read(`${base}/options`)).body.data.items.map((item: { id: string }) => item.id)).toContain(medicine.id)
    const events = await db.auditEvent.findMany({ where: { entityId: medicine.id }, orderBy: { createdAt: 'asc' } })
    expect(events.map((event) => [event.action, event.entityType, event.metadata])).toEqual([
      ['MEDICATION_CREATED', 'MEDICATION', { source: 'API' }], ['MEDICATION_DEACTIVATED', 'MEDICATION', { source: 'API' }], ['MEDICATION_REACTIVATED', 'MEDICATION', { source: 'API' }]])
  })
  it('refuses unknown or malformed commands', async () => {
    const admin = actor('ADMIN'), medicine = await newMedicine()
    expect((await send('post', `${base}/${randomUUID()}/deactivate`, {}, admin)).body.error.code).toBe('MEDICATION_NOT_FOUND')
    expect((await send('post', `${base}/not-a-uuid/deactivate`, {}, admin)).status).toBe(400)
    expect((await send('post', `${base}/${medicine.id}/deactivate`, { active: false }, admin)).status).toBe(400)
    expect((await send('patch', `${base}/${medicine.id}`, { name: 'Renamed' }, admin)).status).toBe(404)
    expect((await send('delete', `${base}/${medicine.id}`, {}, admin)).status).toBe(404)
    expect((await db.medication.findUniqueOrThrow({ where: { id: medicine.id } })).name).toBe(medicine.name)
  })
  it('lists by status and search, sorted ignoring case and paged', async () => {
    const tag = randomUUID().slice(0, 6), admin = actor('ADMIN')
    const names = [`zeta ${tag}`, `Alpha ${tag}`, `beta ${tag}`, `Gamma 50% ${tag}`]
    const created = []
    for (const name of names) created.push((await create(name)).body.data.medication)
    await send('post', `${base}/${created[2].id}/deactivate`, {}, admin)
    const list = async (query: string) => (await read(`${base}?${query}`, admin)).body.data
    expect((await list(`search=${tag}&status=all`)).items.map((item: { name: string }) => item.name)).toEqual(byName(names))
    expect((await list(`search=${tag}`)).items.map((item: { name: string }) => item.name)).toEqual(byName(names.filter((name) => !name.startsWith('beta'))))
    expect((await list(`search=${tag}&status=inactive`)).items.map((item: { name: string }) => item.name)).toEqual([`beta ${tag}`])
    expect((await list(`search=${tag.toUpperCase()}&status=all`)).pagination.total).toBe(4)
    expect((await list(`search=${encodeURIComponent('50%')}&status=all`)).items.map((item: { name: string }) => item.name)).toEqual([`Gamma 50% ${tag}`])
    expect(await list(`search=${tag}&status=all&limit=2&page=2`)).toMatchObject({ pagination: { page: 2, limit: 2, total: 4, totalPages: 2 } })
    for (const query of ['status=deleted', 'limit=101', 'page=0', 'search=' + 'x'.repeat(101), 'active=true']) expect((await read(`${base}?${query}`, admin)).status).toBe(400)
  })
})

describe('adding a medicine while prescribing (Medical Officer)', () => {
  it('adds a medicine with a tidy name, audited by entry only, and prescribes it straight away', async () => {
    const doctor = actor('DOCTOR_IN_CHARGE'), tag = randomUUID().slice(0, 8)
    const response = await create(`  Zinc   sulfate ${tag} `, doctor)
    expect(response.status).toBe(201)
    const value = response.body.data.medication
    expect(value).toMatchObject({ name: `Zinc sulfate ${tag}`, active: true })
    const events = await db.auditEvent.findMany({ where: { requestId: response.headers['x-request-id'] } })
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.actorId, event.metadata]))
      .toEqual([['MEDICATION_CREATED', 'MEDICATION', value.id, doctor.id, { source: 'API' }]])
    expect((await read(`${base}/options`, doctor)).body.data.items).toContainEqual({ id: value.id, name: value.name })
    const { admission } = await admitted(), encounter = await prescribe(admission.id, [order(value.id, { strength: '20 mg' })])
    expect(encounter.medications.map((item) => [item.medicationId, item.medicine, item.strength])).toEqual([[value.id, value.name, '20 mg']])
  })
  it.each(['Paracetamol', 'paracetamol', 'PARACETAMOL', '  paraCETAMOL '])('refuses %j as a duplicate of an active medicine', async (name) => {
    const before = await db.medication.count(), audits = await db.auditEvent.count()
    const response = await create(name, actor('DOCTOR_IN_CHARGE'))
    expect([response.status, response.body.error.code]).toEqual([409, 'MEDICATION_ALREADY_EXISTS'])
    expect(await db.medication.count()).toBe(before)
    expect(await db.auditEvent.count()).toBe(audits)
  })
  it('validates names the same way as for administrators', async () => {
    for (const body of [{ name: '' }, { name: 'x'.repeat(201) }, { name: 'Line\nbreak' }, { name: 'Valid', active: false }]) {
      expect((await send('post', base, body, actor('DOCTOR_IN_CHARGE'))).body.error.code).toBe('VALIDATION_ERROR')
    }
  })
  it('requires CSRF and the trusted origin', async () => {
    const doctor = actor('DOCTOR_IN_CHARGE'), name = `Officer CSRF medicine ${randomUUID()}`
    expect((await request(app).post(base).set('Cookie', doctor.cookie).set('Origin', env.CLIENT_ORIGIN).send({ name })).body.error.code).toBe('CSRF_INVALID')
    expect((await request(app).post(base).set('Cookie', doctor.cookie).set('Origin', 'https://attacker.example').set('X-CSRF-Token', doctor.csrf).send({ name })).status).toBe(403)
    expect(await db.medication.count({ where: { name } })).toBe(0)
  })
  it('re-checks the role on every request: a Medical Officer moved to Records Officer is refused', async () => {
    const moved = await newActor('DOCTOR_IN_CHARGE'), name = `Moved officer medicine ${randomUUID().slice(0, 8)}`
    await db.staffUser.update({ where: { id: moved.id }, data: { role: 'RECORDS_OFFICER' } })
    expect((await create(name, moved)).status).toBe(403)
    expect(await db.medication.count({ where: { name } })).toBe(0)
  })
})

describe('catalog database rules', () => {
  it('refuses duplicate names ignoring case, untidy names and renames, even for direct writes', async () => {
    await expect(db.medication.create({ data: { name: 'IBUPROFEN' } })).rejects.toThrow()
    for (const name of [' Padded', 'Double  space', 'Tab\tname', '']) await expect(db.medication.create({ data: { name } })).rejects.toThrow()
    const medicine = await newMedicine('Permanent')
    await expect(db.medication.update({ where: { id: medicine.id }, data: { name: 'Renamed medicine' } })).rejects.toThrow(/permanent/)
    const before = await db.medication.findUniqueOrThrow({ where: { id: medicine.id } })
    const after = await db.medication.update({ where: { id: medicine.id }, data: { active: false } })
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
    await expect(db.medication.update({ where: { id: medicine.id }, data: { createdAt: new Date('2020-01-01') } })).rejects.toThrow()
  })
  it('never deletes a medicine that was prescribed', async () => {
    const medicine = await newMedicine('Prescribed'), { admission } = await admitted()
    await prescribe(admission.id, [order(medicine.id)])
    await expect(db.medication.delete({ where: { id: medicine.id } })).rejects.toThrow()
    expect(await db.medication.count({ where: { id: medicine.id } })).toBe(1)
  })
  it('requires a catalog entry and its exact name on every new order', async () => {
    const { admission } = await admitted(), encounter = await prescribe(admission.id, [], { clinicalNotes: 'Draft for direct writes' })
    const paracetamol = await catalogId('Paracetamol')
    await expect(db.medicationOrder.create({ data: { encounterId: encounter.id, medicine: 'Typed medicine' } })).rejects.toThrow(/catalog medication/)
    await expect(db.medicationOrder.create({ data: { encounterId: encounter.id, medicationId: paracetamol, medicine: 'Panadol' } })).rejects.toThrow(/catalog medication name/)
    await expect(db.medicationOrder.create({ data: { encounterId: encounter.id, medicationId: randomUUID(), medicine: 'Paracetamol' } })).rejects.toThrow()
    await expect(db.medicationOrder.create({ data: { encounterId: encounter.id, medicationId: paracetamol, medicine: 'Paracetamol', strength: ' ' } })).rejects.toThrow()
    const stored = await db.medicationOrder.create({ data: { encounterId: encounter.id, medicationId: paracetamol, medicine: 'Paracetamol' } })
    await expect(db.medicationOrder.update({ where: { id: stored.id }, data: { medicine: 'Panadol' } })).rejects.toThrow()
  })
})

describe('prescribing from the catalog', () => {
  it('stores the catalog medicine, its name as prescribed and the dosing fields', async () => {
    const { admission } = await admitted(), paracetamol = await catalogId('Paracetamol')
    const encounter = await prescribe(admission.id, [order(paracetamol, { notes: 'Private: after meals' })])
    expect(encounter.medications).toEqual([expect.objectContaining({ medicationId: paracetamol, medicine: 'Paracetamol', strength: '500 mg', dose: '1 tablet',
      route: 'Oral', frequency: 'Three times daily', duration: '5 days', notes: 'Private: after meals' })])
    const stored = await db.medicationOrder.findFirstOrThrow({ where: { encounterId: encounter.id } })
    expect(stored).toMatchObject({ medicationId: paracetamol, medicine: 'Paracetamol', strength: '500 mg' })
  })
  it('refuses unknown medicines, typed names and inactive medicines for new orders, writing nothing', async () => {
    const { admission } = await admitted(), inactive = await newMedicine('Withdrawn')
    await send('post', `${base}/${inactive.id}/deactivate`, {}, actor('ADMIN'))
    const before = await db.encounter.count({ where: { admissionId: admission.id } })
    const attempt = (medications: object[]) => send('post', '/api/v1/encounters', { admissionId: admission.id, medications })
    expect((await attempt([order(randomUUID())])).body.error.code).toBe('MEDICATION_NOT_FOUND')
    expect((await attempt([order(inactive.id)])).body.error.code).toBe('MEDICATION_INACTIVE')
    expect((await attempt([{ medicine: 'Typed medicine', dose: '1 tablet', route: 'Oral', frequency: 'Once daily' }])).body.error.code).toBe('VALIDATION_ERROR')
    expect((await attempt([{ medicationId: await catalogId('Ibuprofen') }])).body.error.code).toBe('VALIDATION_ERROR')
    expect(await db.encounter.count({ where: { admissionId: admission.id } })).toBe(before)
  })
  it('adds, edits and removes orders while the record is a draft; the same medicine may be ordered twice', async () => {
    const { admission } = await admitted(), [paracetamol, ibuprofen] = [await catalogId('Paracetamol'), await catalogId('Ibuprofen')]
    const encounter = await prescribe(admission.id, [order(paracetamol)])
    const path = `/api/v1/encounters/${encounter.id}`
    // Add a second medicine, then the first again with a different plan: both kept, in entered order.
    let response = await send('patch', path, { medications: [order(paracetamol), order(ibuprofen, { strength: '400 mg', frequency: 'Twice daily', duration: '3 days' }),
      order(paracetamol, { dose: '2 tablets', frequency: 'As needed', duration: null })] })
    expect(response.status).toBe(200)
    expect(response.body.data.encounter.medications.map((item: Order) => [item.medicine, item.dose, item.frequency]))
      .toEqual([['Paracetamol', '1 tablet', 'Three times daily'], ['Ibuprofen', '1 tablet', 'Twice daily'], ['Paracetamol', '2 tablets', 'As needed']])
    // Edit one and remove another.
    response = await send('patch', path, { medications: [order(paracetamol, { dose: '2 tablets' }), order(ibuprofen, { strength: '400 mg', frequency: 'Twice daily' })] })
    expect(response.body.data.encounter.medications.map((item: Order) => [item.medicine, item.dose, item.strength])).toEqual([['Paracetamol', '2 tablets', '500 mg'], ['Ibuprofen', '1 tablet', '400 mg']])
    expect(await db.medicationOrder.count({ where: { encounterId: encounter.id } })).toBe(2)
    const event = await db.auditEvent.findFirstOrThrow({ where: { requestId: response.headers['x-request-id'] } })
    expect(event.metadata).toEqual({ source: 'API', changedFields: ['clinicalRecord', 'medications'] })
    // Other edits leave the orders untouched.
    expect((await send('patch', path, { clinicalNotes: 'Private ward round' })).body.data.encounter.medications).toHaveLength(2)
  })
  it('keeps a medicine already on the draft after it is deactivated, but refuses adding it newly', async () => {
    const medicine = await newMedicine('Phasing out'), { admission } = await admitted()
    const encounter = await prescribe(admission.id, [order(medicine.id)]), path = `/api/v1/encounters/${encounter.id}`
    await send('post', `${base}/${medicine.id}/deactivate`, {}, actor('ADMIN'))
    const kept = await send('patch', path, { medications: [order(medicine.id, { dose: '2 tablets' }), order(await catalogId('ORS'), { strength: null, dose: '1 sachet' })] })
    expect(kept.status).toBe(200)
    expect(kept.body.data.encounter.medications.map((item: Order) => [item.medicine, item.dose])).toEqual([[medicine.name, '2 tablets'], ['ORS', '1 sachet']])
    const other = await prescribe(admission.id, [], { clinicalNotes: 'Second draft' })
    expect((await send('patch', `/api/v1/encounters/${other.id}`, { medications: [order(medicine.id)] })).body.error.code).toBe('MEDICATION_INACTIVE')
  })
  it('freezes orders when the record is finalized, through the API and directly', async () => {
    const { admission } = await admitted(), paracetamol = await catalogId('Paracetamol')
    const encounter = await prescribe(admission.id, [order(paracetamol)]), path = `/api/v1/encounters/${encounter.id}`
    await finalize(encounter.id)
    const before = await db.medicationOrder.findMany({ where: { encounterId: encounter.id } })
    for (const medications of [[], [order(paracetamol, { dose: '3 tablets' })]]) {
      expect((await send('patch', path, { medications })).body.error.code).toBe('ENCOUNTER_FINALIZED')
    }
    const stored = before[0]!
    await expect(db.medicationOrder.update({ where: { id: stored.id }, data: { dose: 'rewritten' } })).rejects.toThrow(/immutable/)
    await expect(db.medicationOrder.delete({ where: { id: stored.id } })).rejects.toThrow(/immutable/)
    await expect(db.medicationOrder.create({ data: { encounterId: encounter.id, medicationId: paracetamol, medicine: 'Paracetamol' } })).rejects.toThrow(/immutable/)
    expect(await db.medicationOrder.findMany({ where: { encounterId: encounter.id } })).toEqual(before)
    // Corrections are amendments; the order itself stays as written.
    expect((await send('post', `${path}/amend`, { reason: 'Dose correction', content: 'Private: give 1 tablet, not 2.' })).status).toBe(201)
    expect(await db.medicationOrder.findMany({ where: { encounterId: encounter.id } })).toEqual(before)
  })
  it('keeps finalized orders readable after the medicine is deactivated', async () => {
    const medicine = await newMedicine('Historical'), { patient, admission } = await admitted()
    const encounter = await prescribe(admission.id, [order(medicine.id)])
    await finalize(encounter.id)
    await send('post', `${base}/${medicine.id}/deactivate`, {}, actor('ADMIN'))
    const detail = await read(`/api/v1/encounters/${encounter.id}`)
    expect(detail.body.data.encounter.medications[0]).toMatchObject({ medicationId: medicine.id, medicine: medicine.name, dose: '1 tablet' })
    const history = (await read(`/api/v1/patients/${patient.id}/medications`)).body.data.items
    expect(history.map((item: Order) => item.medicine)).toEqual([medicine.name])
  })
})

describe('medication history across admissions', () => {
  it('separates the current admission from earlier stays, and keeps everything after discharge', async () => {
    const { patient, admission: first } = await admitted(), paracetamol = await catalogId('Paracetamol'), salbutamol = await catalogId('Salbutamol inhaler')
    const earlier = await prescribe(first.id, [order(paracetamol)])
    await finalize(earlier.id)
    await discharge(first.id)
    const at = new Date()
    const second = await db.admission.create({ data: { patientId: patient.id, roomNumber: 'Ward D - Bed 3', admittedAt: at, admittedById: actor('ADMIN').id,
      rooms: { create: { roomNumber: 'Ward D - Bed 3', assignedAt: at, assignedById: actor('ADMIN').id } } } })
    await prescribe(second.id, [order(salbutamol, { strength: '100 micrograms per puff', dose: '2 puffs', route: 'Inhaled', frequency: 'As needed' })])
    const history = (query = '') => read(`/api/v1/patients/${patient.id}/medications${query}`).then((response) => response.body.data.items as Array<Order & { encounter: { status: string; admission: { id: string; status: string } } }>)
    expect((await history()).map((item) => [item.medicine, item.encounter.admission.id, item.encounter.admission.status]))
      .toEqual([['Salbutamol inhaler', second.id, 'ADMITTED'], ['Paracetamol', first.id, 'DISCHARGED']])
    expect((await history(`?admissionId=${second.id}`)).map((item) => item.medicine)).toEqual(['Salbutamol inhaler'])
    expect((await history(`?excludeAdmissionId=${second.id}`)).map((item) => [item.medicine, item.encounter.status])).toEqual([['Paracetamol', 'REVIEWED']])
    expect((await history(`?admissionId=${first.id}`)).map((item) => item.medicine)).toEqual(['Paracetamol'])
    expect((await read(`/api/v1/patients/${patient.id}/medications?admissionId=${first.id}&excludeAdmissionId=${second.id}`)).status).toBe(400)
  })
  it('keeps orders written before the catalog: readable, and removable from a draft', async () => {
    const { patient, admission } = await admitted()
    const encounter = await prescribe(admission.id, [], { clinicalNotes: 'Draft with an older order' })
    await db.$executeRawUnsafe('ALTER TABLE "MedicationOrder" DISABLE TRIGGER medication_order_catalog')
    try {
      await db.medicationOrder.create({ data: { encounterId: encounter.id, medicine: 'Older free-text medicine', dose: '5 ml' } })
    } finally { await db.$executeRawUnsafe('ALTER TABLE "MedicationOrder" ENABLE TRIGGER medication_order_catalog') }
    const item = (await read(`/api/v1/patients/${patient.id}/medications`)).body.data.items[0]
    expect(item).toMatchObject({ medicationId: null, medicine: 'Older free-text medicine', dose: '5 ml' })
    const path = `/api/v1/encounters/${encounter.id}`
    expect((await send('patch', path, { clinicalNotes: 'Other changes keep it' })).body.data.encounter.medications).toHaveLength(1)
    const replaced = await send('patch', path, { medications: [order(await catalogId('Multivitamin'), { strength: null, dose: '10 ml' })] })
    expect(replaced.body.data.encounter.medications.map((value: Order) => value.medicine)).toEqual(['Multivitamin'])
  })
})

describe('medication privacy', () => {
  it('shows prescriptions to Medical Officers only; catalog managers see names, never orders', async () => {
    const { patient, admission } = await admitted(), encounter = await prescribe(admission.id, [order(await catalogId('Diclofenac'), { notes: 'Private instruction text' })])
    for (const role of ['ADMIN', 'RECORDS_OFFICER'] as const) {
      expect((await read(`/api/v1/patients/${patient.id}/medications`, actor(role))).status).toBe(403)
      expect((await read(`/api/v1/encounters/${encounter.id}`, actor(role))).status).toBe(403)
    }
    const catalog = JSON.stringify((await read(`${base}?status=all&limit=100`, actor('ADMIN'))).body)
    expect(catalog).not.toMatch(/Private instruction text|Three times daily|1 tablet|encounter|patient/i)
  })
  it('keeps prescription text out of logs and audit metadata', async () => {
    const { patient, admission } = await admitted()
    const encounter = await prescribe(admission.id, [order(await catalogId('Loperamide'), { strength: '2 mg secret-strength', dose: 'secret-dose', duration: 'secret-duration', notes: 'secret-instruction' })])
    await send('patch', `/api/v1/encounters/${encounter.id}`, { medications: [order(await catalogId('Loperamide'), { frequency: 'secret-frequency' })] })
    await read(`/api/v1/patients/${patient.id}/medications`)
    await create(`Logged medicine ${randomUUID().slice(0, 6)}`)
    await create(`Officer logged medicine ${randomUUID().slice(0, 6)}`, actor('DOCTOR_IN_CHARGE'))
    expect(logs).not.toMatch(/secret-|Loperamide|Logged medicine|logged medicine/)
    const metadata = await db.auditEvent.findMany({ where: { OR: [{ entityId: encounter.id }, { entityType: 'MEDICATION' }] }, select: { metadata: true } })
    expect(metadata.length).toBeGreaterThan(0)
    expect(JSON.stringify(metadata)).not.toMatch(/secret-|Loperamide|mg|tablet/)
  })
})
