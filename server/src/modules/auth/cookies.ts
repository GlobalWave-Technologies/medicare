import type { CookieOptions, Request, Response } from 'express'
import type { Environment } from '../../config/env.js'
import { tokenPattern } from './session.service.js'

export const SESSION_COOKIE = 'medicare_session'

export function sessionCookieOptions(environment: Environment['NODE_ENV']): CookieOptions {
  return { httpOnly: true, secure: environment === 'production', sameSite: 'strict', path: '/' }
}

export function setSessionCookie(res: Response, environment: Environment['NODE_ENV'], token: string, expires: Date) {
  res.cookie(SESSION_COOKIE, token, { ...sessionCookieOptions(environment), expires })
}

export function clearSessionCookie(res: Response, environment: Environment['NODE_ENV']) {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions(environment))
}

// Only our fixed hex token is accepted. Reject duplicate cookies to avoid
// ambiguous path/domain cookies; no decoding or general-purpose cookie parser.
export function readSessionCookie(req: Request): string | undefined {
  const values = (req.headers.cookie ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`))
  if (values.length !== 1) return undefined
  const token = values[0]!.slice(SESSION_COOKIE.length + 1)
  return tokenPattern.test(token) ? token : undefined
}
