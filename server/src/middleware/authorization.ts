import type { RequestHandler } from 'express'
import { authContext } from '../modules/auth/auth.context.js'
import { assertPermission, type Permission } from '../shared/authorization/permissions.js'

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    assertPermission(authContext(req).principal.role, permission)
    next()
  }
}
