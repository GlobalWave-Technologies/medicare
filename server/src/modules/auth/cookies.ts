import type { CookieOptions, Request, Response } from 'express'
import type { Environment } from '../../config/env.js'
import { tokenPattern } from './session.service.js'

export const SESSION_COOKIE = 'medicare_session'
// In production the __Host- prefix makes the browser refuse the cookie unless it is Secure, has
// Path=/ and no Domain, so a sibling subdomain or plain-HTTP page cannot plant or overwrite it.
export const PRODUCTION_SESSION_COOKIE = `__Host-${SESSION_COOKIE}`
export const sessionCookieName = (environment: Environment['NODE_ENV'] | undefined) =>
  environment === 'production' ? PRODUCTION_SESSION_COOKIE : SESSION_COOKIE

export function sessionCookieOptions(environment: Environment['NODE_ENV']): CookieOptions {
  return { httpOnly: true, secure: environment === 'production', sameSite: 'strict', path: '/' }
}

export function setSessionCookie(res: Response, environment: Environment['NODE_ENV'], token: string, expires: Date) {
  res.cookie(sessionCookieName(environment), token, { ...sessionCookieOptions(environment), expires })
}

export function clearSessionCookie(res: Response, environment: Environment['NODE_ENV']) {
  res.clearCookie(sessionCookieName(environment), sessionCookieOptions(environment))
}

// Only our fixed hex token is accepted. Reject duplicate cookies to avoid
// ambiguous path/domain cookies; no decoding or general-purpose cookie parser.
// The name follows the application environment set by createApp.
export function readSessionCookie(req: Request): string | undefined {
  const name = sessionCookieName(req.app.get('env') as Environment['NODE_ENV'] | undefined)
  const values = (req.headers.cookie ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
  if (values.length !== 1) return undefined
  const token = values[0]!.slice(name.length + 1)
  return tokenPattern.test(token) ? token : undefined
}
