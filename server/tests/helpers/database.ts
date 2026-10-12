import { loadTestDatabaseEnvironment } from '../../src/config/env.js'
import { getPrisma } from '../../src/database/prisma.js'

export function isolatedTestEnvironment() {
  const env = loadTestDatabaseEnvironment()
  if (!/^\/medicare_test_run_[a-f0-9]{32}$/.test(new URL(env.DATABASE_URL).pathname)) {
    throw new Error('Use npm run test:database to create a disposable database')
  }
  return env
}

export function testDatabase() {
  return getPrisma(isolatedTestEnvironment())
}
