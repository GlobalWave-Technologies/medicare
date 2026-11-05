import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import type { Logger } from 'pino'
import type { Environment } from './config/env.js'
import { requestId } from './middleware/requestId.js'
import { notFound } from './middleware/notFound.js'
import { errorHandler } from './middleware/errorHandler.js'
import { healthRoutes } from './modules/health/health.routes.js'
import { AppError } from './shared/errors/AppError.js'
import type { PrismaClient } from './generated/prisma/client.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { staffRoutes } from './modules/staff/staff.routes.js'
import { patientRoutes } from './modules/patients/patient.routes.js'
import { appointmentRoutes } from './modules/appointments/appointment.routes.js'
import { encounterRoutes } from './modules/encounters/encounter.routes.js'
import { notificationRoutes } from './modules/notifications/notification.routes.js'
import { dashboardRoutes, reportRoutes } from './modules/reports/report.routes.js'

export interface AppDependencies {
  env: Pick<Environment, 'NODE_ENV' | 'CLIENT_ORIGIN'> & Partial<Pick<Environment, 'TRUSTED_PROXY_CIDRS'>>
  logger: Logger
  checkDatabase: () => Promise<void>
  isShuttingDown?: () => boolean
  prisma?: PrismaClient
}

// Construction is side-effect free: no environment loading, database connection,
// or network listener. Tests inject a database probe; startup supplies Prisma.
export function createApp(dependencies: AppDependencies) {
  const app = express()
  app.set('env', dependencies.env.NODE_ENV)
  app.set('trust proxy', dependencies.env.TRUSTED_PROXY_CIDRS ?? [])
  app.disable('x-powered-by')
  app.disable('etag')
  app.use(requestId)
  app.use(pinoHttp({
    logger: dependencies.logger,
    genReqId: (req) => req.id,
    wrapSerializers: false,
    serializers: {
      // Allowlist only metadata: no headers, body, URL/query, or IP address.
      req: (req) => ({ id: req.id, method: req.method }),
      res: (res) => ({ statusCode: res.statusCode }),
      err: () => ({ type: 'Error', code: 'INTERNAL_ERROR' }),
    },
    customProps: (req) => ({ requestId: req.id }),
  }))
  app.use(helmet())
  app.use(cors({
    origin: (origin, callback) => {
      if (origin === undefined || origin === dependencies.env.CLIENT_ORIGIN) callback(null, true)
      else callback(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed'))
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Request-Id', 'X-CSRF-Token', 'Idempotency-Key'],
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  }))
  app.use(express.json({ limit: '100kb', strict: true }))
  app.use('/api/v1/health', healthRoutes({
    environment: dependencies.env.NODE_ENV,
    checkDatabase: dependencies.checkDatabase,
    isShuttingDown: dependencies.isShuttingDown ?? (() => false),
  }))
  if (dependencies.prisma) {
    app.use('/api/v1/auth', authRoutes(dependencies.prisma, dependencies.env))
    app.use('/api/v1/staff', staffRoutes(dependencies.prisma, dependencies.env))
    app.use('/api/v1/patients', patientRoutes(dependencies.prisma, dependencies.env.CLIENT_ORIGIN))
    app.use('/api/v1/appointments', appointmentRoutes(dependencies.prisma, dependencies.env.CLIENT_ORIGIN))
    app.use('/api/v1/encounters', encounterRoutes(dependencies.prisma, dependencies.env.CLIENT_ORIGIN))
    app.use('/api/v1/notifications', notificationRoutes(dependencies.prisma, dependencies.env.CLIENT_ORIGIN))
    app.use('/api/v1/dashboard', dashboardRoutes(dependencies.prisma))
    app.use('/api/v1/reports', reportRoutes(dependencies.prisma))
  }
  app.use(notFound)
  app.use(errorHandler)
  return app
}
