import { Writable } from 'node:stream'
import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createApp } from '../src/app.js'
import { errorHandler } from '../src/middleware/errorHandler.js'
import { requestId } from '../src/middleware/requestId.js'
import { createLogger } from '../src/shared/logger/logger.js'

function setup(options: { checkDatabase?: () => Promise<void>; stopping?: boolean; logging?: boolean } = {}) {
  let logs = ''
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) { logs += chunk.toString(); callback() },
  })
  const logger = createLogger(options.logging ? 'info' : 'silent', destination)
  const checkDatabase = options.checkDatabase ?? vi.fn(async () => undefined)
  const app = createApp({
    env: { NODE_ENV: 'production', CLIENT_ORIGIN: 'https://client.example.test' },
    logger,
    checkDatabase,
    isShuttingDown: () => options.stopping ?? false,
  })
  return { app, logger, checkDatabase, logs: () => logs }
}

describe('health and HTTP foundation', () => {
  it('returns the liveness contract without querying the database', async () => {
    const { app, checkDatabase } = setup()
    const response = await request(app).get('/api/v1/health').expect(200)
    expect(response.body).toEqual({
      success: true,
      data: { status: 'ok', service: 'medicare-api', environment: 'production', timestamp: expect.any(String), uptime: expect.any(Number) },
    })
    expect(Number.isNaN(Date.parse(response.body.data.timestamp))).toBe(false)
    expect(response.body.data.uptime).toBeGreaterThanOrEqual(0)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(checkDatabase).not.toHaveBeenCalled()
  })

  it('returns a standard 404 with a generated correlation ID', async () => {
    const { app } = setup()
    const response = await request(app).get('/missing').expect(404)
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    expect(response.body).toEqual({ success: false, error: {
      code: 'NOT_FOUND', message: 'Route not found', requestId: response.headers['x-request-id'],
    } })
  })

  it('preserves a safe request ID', async () => {
    const { app } = setup()
    const response = await request(app).get('/api/v1/health').set('X-Request-Id', 'trace-123_ABC.456').expect(200)
    expect(response.headers['x-request-id']).toBe('trace-123_ABC.456')
  })

  it.each(['unsafe request id', 'x'.repeat(129), '<script>'])('replaces an unsafe request ID: %s', async (id) => {
    const { app } = setup()
    const response = await request(app).get('/api/v1/health').set('X-Request-Id', id).expect(200)
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reports readiness when the database probe succeeds', async () => {
    const { app, checkDatabase } = setup()
    const response = await request(app).get('/api/v1/health/ready').expect(200)
    expect(response.body).toEqual({ success: true, data: { status: 'ready' } })
    expect(checkDatabase).toHaveBeenCalledOnce()
  })

  it('reports 503 without exposing infrastructure details when the probe fails', async () => {
    const { app } = setup({ checkDatabase: async () => { throw new Error('postgresql://admin:secret@private-db/patients') } })
    const response = await request(app).get('/api/v1/health/ready').expect(503)
    expect(response.body).toEqual({ success: false, error: {
      code: 'SERVICE_UNAVAILABLE', message: 'Service is not ready', requestId: response.headers['x-request-id'],
    } })
    expect(response.text).not.toMatch(/secret|private-db|stack|postgresql/)
  })

  it('is not ready while shutting down and does not query the database', async () => {
    const { app, checkDatabase } = setup({ stopping: true })
    await request(app).get('/api/v1/health/ready').expect(503)
    expect(checkDatabase).not.toHaveBeenCalled()
  })

  it('allows only the configured browser origin and exposes support and rate-limit headers', async () => {
    const { app } = setup()
    const response = await request(app).options('/api/v1/health')
      .set('Origin', 'https://client.example.test').set('Access-Control-Request-Method', 'GET').expect(204)
    expect(response.headers['access-control-allow-origin']).toBe('https://client.example.test')
    expect(response.headers['access-control-expose-headers']).toBe('X-Request-Id,Retry-After,Idempotency-Replayed')
    expect(response.headers['access-control-allow-credentials']).toBe('true')
    const blocked = await request(app).get('/api/v1/health').set('Origin', 'https://untrusted.example.test').expect(403)
    expect(blocked.body.error.code).toBe('ORIGIN_NOT_ALLOWED')
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('answers CORS preflight only for the exact trusted origin, allowing the headers the client sends', async () => {
    const { app } = setup()
    const allowed = await request(app).options('/api/v1/staff').set('Origin', 'https://client.example.test')
      .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type,x-csrf-token,idempotency-key').expect(204)
    expect(allowed.headers['access-control-allow-origin']).toBe('https://client.example.test')
    expect(allowed.headers['access-control-allow-credentials']).toBe('true')
    expect(allowed.headers['access-control-allow-methods']).toContain('POST')
    for (const header of ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key']) expect(allowed.headers['access-control-allow-headers']).toContain(header)
    for (const origin of ['https://untrusted.example.test', 'null', 'https://client.example.test/', 'http://client.example.test',
      'https://client.example.test.evil.test', 'https://client.example.test:444', 'not a url']) {
      const refused = await request(app).options('/api/v1/staff').set('Origin', origin).set('Access-Control-Request-Method', 'POST')
      expect([origin, refused.status, refused.headers['access-control-allow-origin']]).toEqual([origin, 403, undefined])
    }
  })

  it('denies every resource, frame and form on API responses and asks for HTTPS', async () => {
    const { app } = setup()
    const response = await request(app).get('/api/v1/health').expect(200)
    expect(response.headers['content-security-policy']).toBe("default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'")
    expect(response.headers['x-frame-options']).toBe('DENY')
    expect(response.headers['strict-transport-security']).toMatch(/^max-age=31536000; includeSubDomains$/)
    expect(response.headers['referrer-policy']).toBe('no-referrer')
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin')
  })

  it('sets security headers and removes framework disclosure', async () => {
    const { app } = setup()
    const response = await request(app).get('/api/v1/health').expect(200)
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['content-security-policy']).toBeDefined()
    expect(response.headers['x-powered-by']).toBeUndefined()
  })

  it('returns a safe 400 for malformed JSON', async () => {
    const { app } = setup()
    const response = await request(app).post('/api/v1/health').type('json').send('{"password":"sensitive",').expect(400)
    expect(response.body).toEqual({ success: false, error: {
      code: 'INVALID_JSON', message: 'Invalid JSON body', requestId: response.headers['x-request-id'],
    } })
    expect(response.text).not.toMatch(/sensitive|stack|SyntaxError/)
  })

  it('enforces the body size limit', async () => {
    const { app } = setup()
    const response = await request(app).post('/api/v1/health').send({ content: 'x'.repeat(110 * 1024) }).expect(413)
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('logs correlation metadata without headers, path/query, or request bodies', async () => {
    const { app, logs } = setup({ logging: true })
    await request(app).post('/private-patient-path?token=query-secret')
      .set('X-Request-Id', 'logging-test').set('Authorization', 'Bearer token-secret')
      .set('Cookie', 'session=cookie-secret').send({ password: 'password-secret', medicalHistory: 'medical-secret' }).expect(404)
    expect(logs()).toContain('logging-test')
    expect(logs()).toContain('medicare-api')
    expect(logs()).not.toMatch(/private-patient-path|query-secret|token-secret|cookie-secret|password-secret|medical-secret/)
    for (const line of logs().trim().split('\n')) expect(() => JSON.parse(line)).not.toThrow()
  })
})

describe('central error handler in production', () => {
  function errorApp(error: unknown) {
    const { logger } = setup()
    const app = express()
    app.set('env', 'production')
    app.use(requestId)
    app.use((req, _res, next) => { req.log = logger; next(error) })
    app.use(errorHandler)
    return app
  }

  it('replaces internal errors with a stable generic 500', async () => {
    const response = await request(errorApp(new Error('SQL password=secret patient medical history'))).get('/').expect(500)
    expect(response.body).toEqual({ success: false, error: {
      code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: response.headers['x-request-id'],
    } })
    expect(response.text).not.toMatch(/stack|SQL|secret|medical history/)
  })

  it('logs an unexpected failure under the same request ID the response gives, without its message', async () => {
    let logs = ''
    const logger = createLogger('info', new Writable({ write(chunk: Buffer, _encoding, callback) { logs += chunk.toString(); callback() } }))
    const app = express()
    app.use(requestId)
    app.use((req, _res, next) => { req.log = logger; next(new Error('synthetic failure with clinical text')) })
    app.use(errorHandler)
    const response = await request(app).get('/').set('X-Request-Id', 'support-ref-1701').expect(500)
    expect([response.headers['x-request-id'], response.body.error.requestId]).toEqual(['support-ref-1701', 'support-ref-1701'])
    const entry = JSON.parse(logs.trim())
    expect([entry.level, entry.requestId, entry.code]).toEqual([50, 'support-ref-1701', 'INTERNAL_ERROR'])
    expect(logs + response.text).not.toMatch(/synthetic failure|clinical text|stack/)
  })

  it('does not expose Zod issue details or submitted values', async () => {
    const result = z.object({ password: z.string().min(12) }).safeParse({ password: 'secret' })
    if (result.success) throw new Error('Expected validation failure')
    const response = await request(errorApp(result.error)).get('/').expect(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
    expect(response.text).not.toMatch(/password|secret|stack|issues/)
  })
})
