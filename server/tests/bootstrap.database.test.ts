import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import { disconnectDatabase } from '../src/database/prisma.js'
import { bootstrapAdmin } from '../src/modules/staff/bootstrapAdmin.js'
import { verifyPassword } from '../src/shared/security/password.js'
import { isolatedTestEnvironment, testDatabase } from './helpers/database.js'

const env = isolatedTestEnvironment()
const prisma = testDatabase()
afterAll(disconnectDatabase)

const intended = {
  firstName: 'Synthetic', lastName: 'Bootstrap', staffNumber: 'STF-BOOTSTRAP01',
  email: 'synthetic-bootstrap@example.test', password: `synthetic bootstrap ${randomUUID()}`,
}

function runCli(input: typeof intended) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    // The guarded database runner rebuilds first: exercise the deployed CLI,
    // without charging TypeScript loader startup against the process deadline.
    const child = spawn(process.execPath, ['dist/cli/bootstrapAdmin.js'], {
      cwd: new URL('../', import.meta.url), windowsHide: true,
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: env.DATABASE_URL,
        BOOTSTRAP_ADMIN_FIRST_NAME: input.firstName, BOOTSTRAP_ADMIN_LAST_NAME: input.lastName,
        BOOTSTRAP_ADMIN_EMAIL: input.email, BOOTSTRAP_ADMIN_STAFF_NUMBER: input.staffNumber,
        BOOTSTRAP_ADMIN_PASSWORD: input.password },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Bootstrap subprocess timed out')) }, 15000)
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.on('error', () => { clearTimeout(timer); reject(new Error('Bootstrap subprocess could not start')) })
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, output }) })
  })
}

describe('controlled first administrator bootstrap', { concurrent: false }, () => {
  it('rejects invalid passwords before provisioning and prints no submitted values', async () => {
    const invalid = { ...intended, password: 'bad-secret' }
    const result = await runCli(invalid)
    expect(result.code).toBe(1)
    expect(result.output).toContain('INVALID_ADMIN_INPUT')
    expect(result.output).not.toContain(invalid.password)
    expect(await prisma.staffUser.count({ where: { role: 'ADMIN' } })).toBe(0)
  })

  it('serializes concurrent CLI runs, creates exactly one intended administrator and one audit event', async () => {
    const results = await Promise.all([runCli(intended), runCli(intended)])
    expect(results.map((result) => result.code).sort()).toEqual([0, 1])
    for (const result of results) {
      expect(result.output).not.toContain(intended.password)
      expect(result.output).not.toContain(intended.email)
      expect(result.output).not.toContain('$argon2id$')
    }
    const users = await prisma.staffUser.findMany({ where: { role: 'ADMIN' } })
    expect(users).toHaveLength(1)
    const admin = users[0]!
    expect(admin).toMatchObject({ email: intended.email, staffNumber: intended.staffNumber, status: 'ACTIVE' })
    expect(admin.passwordChangedAt).toBeInstanceOf(Date)
    expect(await verifyPassword(intended.password, admin.passwordHash!)).toBe(true)
    const audit = await prisma.auditEvent.findMany({ where: { action: 'ADMIN_BOOTSTRAPPED' } })
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actorId: admin.id, entityId: admin.id, metadata: { source: 'CLI' } })
    expect(JSON.stringify(audit)).not.toContain(intended.password)
  })

  it('refuses duplicate emails after normalization', async () => {
    await expect(bootstrapAdmin(prisma, { ...intended, email: ` ${intended.email.toUpperCase()} `,
      staffNumber: 'STF-OTHER001' })).rejects.toMatchObject({ code: 'DUPLICATE_EMAIL' })
  })

  it('refuses duplicate staff numbers after normalization', async () => {
    await expect(bootstrapAdmin(prisma, { ...intended, email: 'different@example.test',
      staffNumber: intended.staffNumber.toLowerCase() })).rejects.toMatchObject({ code: 'DUPLICATE_STAFF_NUMBER' })
  })

  it('never provisions additional admins or treats a disabled admin as a fresh installation', async () => {
    const second = { ...intended, email: 'second-admin@example.test', staffNumber: 'STF-SECOND01' }
    await expect(bootstrapAdmin(prisma, second)).rejects.toMatchObject({ code: 'ADMIN_ALREADY_EXISTS' })
    await prisma.staffUser.update({ where: { email: intended.email }, data: { status: 'DISABLED' } })
    const denied = await runCli(second)
    expect(denied.code).toBe(1)
    expect(denied.output).toContain('ADMIN_ALREADY_EXISTS')
    expect(denied.output).not.toContain(second.password)
    expect(await prisma.staffUser.count({ where: { role: 'ADMIN' } })).toBe(1)
    const original = await prisma.staffUser.update({ where: { email: intended.email }, data: { role: 'RECORDS_OFFICER' } })
    await expect(bootstrapAdmin(prisma, second)).rejects.toMatchObject({ code: 'ADMIN_ALREADY_EXISTS' })
    await prisma.staffUser.update({ where: { id: original.id }, data: { role: 'ADMIN' } })
  })

  it('rolls back a staff write when its audit write fails', async () => {
    const email = 'rollback-synthetic@example.test'
    await expect(prisma.$transaction(async (tx) => {
      const user = await tx.staffUser.create({ data: { email, firstName: 'Synthetic', lastName: 'Rollback', role: 'RECORDS_OFFICER' } })
      await tx.auditEvent.create({ data: { actorId: user.id, entityId: user.id,
        action: 'STAFF_CREATED', entityType: 'STAFF_USER', metadata: { password: 'forbidden' } } })
    })).rejects.toThrow()
    expect(await prisma.staffUser.findUnique({ where: { email } })).toBeNull()
  })
})
