import { loadDatabaseUrl, ConfigurationError } from '../config/env.js'
import { disconnectDatabase, getPrisma } from '../database/prisma.js'
import { pruneExpiredSessions } from '../modules/auth/session.service.js'

// Scheduled maintenance: exits non-zero on any failure and prints only a count or a fixed code.
async function main() {
  try {
    const url = loadDatabaseUrl()
    if (!url) throw new ConfigurationError(['DATABASE_URL'])
    const removed = await pruneExpiredSessions(getPrisma({ DATABASE_URL: url }))
    process.stdout.write(`Removed ${removed} expired session(s).\n`)
  } catch (error) {
    process.stderr.write(`Session cleanup failed: ${error instanceof ConfigurationError ? 'INVALID_CONFIGURATION' : 'CLEANUP_FAILED'}\n`)
    process.exitCode = 1
  } finally {
    try { await disconnectDatabase() } catch {
      process.stderr.write('Database cleanup failed.\n')
      process.exitCode = 1
    }
  }
}

await main()
