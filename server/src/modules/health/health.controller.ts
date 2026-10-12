import type { RequestHandler } from 'express'
import type { Environment } from '../../config/env.js'
import { AppError } from '../../shared/errors/AppError.js'
import { withTimeout } from '../../shared/utils/withTimeout.js'

export interface HealthDependencies {
  environment: Environment['NODE_ENV']
  checkDatabase: () => Promise<void>
  isShuttingDown: () => boolean
}

export function healthController(dependencies: HealthDependencies) {
  const health: RequestHandler = (_req, res) => {
    res.json({
      success: true,
      data: {
        status: 'ok',
        service: 'medicare-api',
        environment: dependencies.environment,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      },
    })
  }

  const ready: RequestHandler = async (_req, res) => {
    try {
      if (dependencies.isShuttingDown()) throw new Error('Shutting down')
      await withTimeout(dependencies.checkDatabase(), 3500)
      if (dependencies.isShuttingDown()) throw new Error('Shutting down')
    } catch {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Service is not ready')
    }
    res.json({ success: true, data: { status: 'ready' } })
  }

  return { health, ready }
}
