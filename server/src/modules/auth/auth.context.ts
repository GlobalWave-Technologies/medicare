import { isIP } from 'node:net'
import type { Request } from 'express'
import type { AuthPrincipal } from '../staff/staff.dto.js'
import { AppError } from '../../shared/errors/AppError.js'

export interface AuthContext {
  principal: AuthPrincipal
  sessionId: string
  csrfToken: string
}

declare global {
  namespace Express {
    interface Request { auth?: AuthContext }
  }
}

export function authenticationRequired() {
  return new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')
}

export function authContext(req: Request): AuthContext {
  if (!req.auth) throw authenticationRequired()
  return req.auth
}

export function auditContext(req: Request) {
  // Only a coarse browser-family classification is retained, never arbitrary
  // user-agent text (which can itself contain credentials or injected content).
  const agent = req.get('user-agent') ?? ''
  const userAgent = /Firefox\//.test(agent) ? 'Firefox' : /Edg\//.test(agent) ? 'Edge'
    : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'Other'
  return { requestId: String(req.id), ipAddress: req.ip && isIP(req.ip) ? req.ip : undefined, userAgent }
}

export type AuditContext = ReturnType<typeof auditContext>
