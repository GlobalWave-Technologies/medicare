import { loadBootstrapEnvironment, ConfigurationError } from '../config/env.js'
import { disconnectDatabase, getPrisma } from '../database/prisma.js'
import { BootstrapError, bootstrapAdmin } from '../modules/staff/bootstrapAdmin.js'

async function main() {
  try {
    const { databaseUrl, admin } = loadBootstrapEnvironment()
    await bootstrapAdmin(getPrisma({ DATABASE_URL: databaseUrl }), admin)
    process.stdout.write('Administrator provisioned successfully. Audit event recorded.\n')
  } catch (error) {
    const code = error instanceof BootstrapError ? error.code
      : error instanceof ConfigurationError ? 'INVALID_CONFIGURATION' : 'BOOTSTRAP_FAILED'
    process.stderr.write(`Administrator bootstrap refused: ${code}\n`)
    process.exitCode = 1
  } finally {
    try { await disconnectDatabase() } catch {
      process.stderr.write('Database cleanup failed.\n')
      process.exitCode = 1
    }
  }
}

await main()
