import { loadDatabaseUrl, ConfigurationError } from '../config/env.js'
import { disconnectDatabase, getPrisma } from '../database/prisma.js'
import { pruneExpiredIdempotencyRecords } from '../shared/idempotency/idempotency.js'

async function main() {
  try {
    const url = loadDatabaseUrl()
    if (!url) throw new ConfigurationError(['DATABASE_URL'])
    const removed = await pruneExpiredIdempotencyRecords(getPrisma({ DATABASE_URL: url }))
    process.stdout.write(`Removed ${removed} expired idempotency record(s).\n`)
  } catch (error) {
    process.stderr.write(`Idempotency cleanup failed: ${error instanceof ConfigurationError ? 'INVALID_CONFIGURATION' : 'CLEANUP_FAILED'}\n`)
    process.exitCode = 1
  } finally {
    try { await disconnectDatabase() } catch {
      process.stderr.write('Database cleanup failed.\n')
      process.exitCode = 1
    }
  }
}

await main()
