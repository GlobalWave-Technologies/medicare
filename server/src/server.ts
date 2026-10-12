import { createServer } from 'node:http'
import { once } from 'node:events'
import { createApp } from './app.js'
import { ConfigurationError, loadEnvironment } from './config/env.js'
import { disconnectDatabase, getPrisma } from './database/prisma.js'
import { createLogger } from './shared/logger/logger.js'

async function main() {
  const env = loadEnvironment()
  const logger = createLogger(env.LOG_LEVEL)
  const prisma = getPrisma(env)
  let stopping = false
  const checkDatabase = async () => { await prisma.$queryRaw`SELECT 1` }
  const app = createApp({ env, logger, prisma, checkDatabase, isShuttingDown: () => stopping })
  const server = createServer(app)
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  server.keepAliveTimeout = 5000

  let startup: Promise<void> = Promise.resolve()
  const shutdown = async (reason: string, exitCode: number) => {
    if (stopping) return
    stopping = true
    logger.info({ reason }, 'Server shutting down')
    const deadline = setTimeout(() => {
      logger.fatal('Shutdown deadline exceeded')
      server.closeAllConnections()
      process.exit(1)
    }, 10000)
    deadline.unref()
    try {
      await startup.catch(() => undefined)
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve())
          server.closeIdleConnections()
        })
      }
      await disconnectDatabase()
      process.exitCode = exitCode
      logger.info('Server stopped')
    } catch {
      logger.fatal('Shutdown failed')
      process.exitCode = 1
    } finally {
      clearTimeout(deadline)
      // All HTTP/database work has drained; signal/fatal handlers must not leave
      // an unhealthy process running if another resource retains the event loop.
      logger.flush()
      process.exit(process.exitCode ?? exitCode)
    }
  }

  process.on('SIGINT', () => { void shutdown('SIGINT', 0) })
  process.on('SIGTERM', () => { void shutdown('SIGTERM', 0) })
  process.on('uncaughtException', () => { void shutdown('uncaughtException', 1) })
  process.on('unhandledRejection', () => { void shutdown('unhandledRejection', 1) })

  startup = (async () => {
    await prisma.$connect()
    await checkDatabase()
    if (stopping) return
    server.listen(env.PORT)
    await once(server, 'listening')
    logger.info({ port: env.PORT, environment: env.NODE_ENV }, 'Server listening')
    server.on('error', () => { void shutdown('httpServerError', 1) })
  })()

  try {
    await startup
  } catch {
    logger.fatal('Startup failed; verify database connectivity and listener configuration')
    await shutdown('startupFailure', 1)
  }
}

main().catch((error: unknown) => {
  const logger = createLogger('error')
  logger.fatal(error instanceof ConfigurationError ? error.message : 'Server initialization failed')
  process.exitCode = 1
})
