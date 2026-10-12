import request from 'supertest'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { isolatedTestEnvironment } from './helpers/database.js'
import { disconnectDatabase, getPrisma } from '../src/database/prisma.js'
import { createLogger } from '../src/shared/logger/logger.js'

const env = isolatedTestEnvironment()
const prisma = getPrisma(env)
beforeAll(async () => { await prisma.$connect() })
afterAll(disconnectDatabase)

it('reuses one Prisma client and verifies readiness against PostgreSQL', async () => {
  expect(getPrisma(env)).toBe(prisma)
  const app = createApp({
    env, logger: createLogger('silent'),
    checkDatabase: async () => { await prisma.$queryRaw`SELECT 1` },
  })
  const response = await request(app).get('/api/v1/health/ready').expect(200)
  expect(response.body).toEqual({ success: true, data: { status: 'ready' } })
})
