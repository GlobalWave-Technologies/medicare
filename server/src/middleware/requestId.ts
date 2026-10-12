import { randomUUID } from 'node:crypto'
import type { RequestHandler } from 'express'

const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id']
  req.id = typeof incoming === 'string' && safeId.test(incoming) ? incoming : randomUUID()
  res.setHeader('X-Request-Id', req.id)
  next()
}
