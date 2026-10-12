import { PrismaPg } from '@prisma/adapter-pg'
import type { Environment } from '../config/env.js'
import { PrismaClient } from '../generated/prisma/client.js'

let prisma: PrismaClient | undefined

export function getPrisma(env: Pick<Environment, 'DATABASE_URL'>): PrismaClient {
  prisma ??= new PrismaClient({
    adapter: new PrismaPg({
      connectionString: env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      statement_timeout: 3000,
      query_timeout: 3000,
    }),
    log: [],
    errorFormat: 'minimal',
  })
  return prisma
}

export async function disconnectDatabase(): Promise<void> {
  await prisma?.$disconnect()
  prisma = undefined
}
