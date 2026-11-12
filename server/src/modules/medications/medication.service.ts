import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import type { AuditContext, AuthContext } from '../auth/auth.context.js'
import { assertCurrentActor } from '../auth/security.transaction.js'
import { assertPermission, type Permission } from '../../shared/authorization/permissions.js'
import { appendAuditEvent } from '../../shared/audit/audit.js'
import { AppError } from '../../shared/errors/AppError.js'
import type { MedicationRow } from './medication.dto.js'
import type { CreateMedicationInput, MedicationQuery } from './medication.validation.js'

// The prescribing dropdown loads every active medicine at once; the catalog is a short list.
export const OPTION_LIMIT = 1000
const select = { id: true, name: true, active: true, createdAt: true, updatedAt: true } as const
const notFound = () => new AppError(404, 'MEDICATION_NOT_FOUND', 'Medication not found')
const alreadyExists = () => new AppError(409, 'MEDICATION_ALREADY_EXISTS', 'A medicine with this name is already in the catalog')
// Adding never reactivates: only Admin can bring an inactive medicine back.
const existsInactive = () => new AppError(409, 'MEDICATION_EXISTS_INACTIVE', 'A medicine with this name is already in the catalog but is inactive')
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')

function catalogTransaction<T>(db: PrismaClient, auth: AuthContext, permission: Permission, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(1296385106, 1)`
    assertPermission(await assertCurrentActor(tx, auth), permission)
    return operation(tx)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000 })
}

// Sorted ignoring case, so "ORS" sits with "Oral glucose" rather than before every lowercase name.
export async function listMedications(db: PrismaClient, query: MedicationQuery) {
  const conditions: Prisma.Sql[] = []
  if (query.status !== 'all') conditions.push(Prisma.sql`"active" = ${query.status === 'active'}`)
  if (query.search) conditions.push(Prisma.sql`"name" ILIKE ${`%${escapeLike(query.search)}%`}`)
  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty
  const items = await db.$queryRaw<MedicationRow[]>`SELECT "id", "name", "active", "createdAt", "updatedAt" FROM "Medication" ${where}
    ORDER BY lower("name"), "id" LIMIT ${query.limit}::int OFFSET ${(query.page - 1) * query.limit}::int`
  const [{ total }] = await db.$queryRaw<[{ total: bigint }]>`SELECT count(*) AS total FROM "Medication" ${where}`
  const count = Number(total)
  return { items, pagination: { page: query.page, limit: query.limit, total: count, totalPages: Math.ceil(count / query.limit) } }
}

export function listMedicationOptions(db: PrismaClient) {
  return db.$queryRaw<Array<Pick<MedicationRow, 'id' | 'name'>>>`SELECT "id", "name" FROM "Medication" WHERE "active"
    ORDER BY lower("name"), "id" LIMIT ${OPTION_LIMIT}::int`
}

export async function createMedication(db: PrismaClient, auth: AuthContext, context: AuditContext, input: CreateMedicationInput) {
  try {
    return await catalogTransaction(db, auth, 'MEDICATION_CATALOG_ADD', async (tx) => {
      // A clear refusal first; the case-insensitive unique index is the final guard for concurrent adds.
      const [existing] = await tx.$queryRaw<Array<{ id: string; active: boolean }>>`SELECT "id", "active" FROM "Medication" WHERE lower("name") = lower(${input.name})`
      if (existing) throw existing.active ? alreadyExists() : existsInactive()
      const value = await tx.medication.create({ data: { name: input.name }, select })
      await appendAuditEvent(tx, { ...context, actorId: auth.principal.id, action: 'MEDICATION_CREATED', entityType: 'MEDICATION',
        entityId: value.id, metadata: { source: 'API' } })
      return value
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw alreadyExists()
    throw error
  }
}

// Repeating the current state changes nothing and records no second event. Deactivation only hides
// the medicine from new prescriptions: every order that names it stays as written.
function setActive(db: PrismaClient, auth: AuthContext, context: AuditContext, id: string, active: boolean) {
  return catalogTransaction(db, auth, 'MEDICATION_CATALOG_MANAGE', async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Medication" WHERE "id" = ${id}::uuid FOR UPDATE`
    const current = await tx.medication.findUnique({ where: { id }, select })
    if (!current) throw notFound()
    if (current.active === active) return current
    const value = await tx.medication.update({ where: { id }, data: { active }, select })
    await appendAuditEvent(tx, { ...context, actorId: auth.principal.id, action: active ? 'MEDICATION_REACTIVATED' : 'MEDICATION_DEACTIVATED',
      entityType: 'MEDICATION', entityId: id, metadata: { source: 'API' } })
    return value
  })
}
export const deactivateMedication = (db: PrismaClient, auth: AuthContext, context: AuditContext, id: string) => setActive(db, auth, context, id, false)
export const reactivateMedication = (db: PrismaClient, auth: AuthContext, context: AuditContext, id: string) => setActive(db, auth, context, id, true)
