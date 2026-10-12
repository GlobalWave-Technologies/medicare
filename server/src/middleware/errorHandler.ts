import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import { AppError } from '../shared/errors/AppError.js'

function publicError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error instanceof ZodError) return new AppError(400, 'VALIDATION_ERROR', 'Invalid request data')
  if (error instanceof Error && 'type' in error) {
    switch (error.type) {
      case 'entity.parse.failed': return new AppError(400, 'INVALID_JSON', 'Invalid JSON body')
      case 'entity.too.large': return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large')
      case 'encoding.unsupported':
      case 'charset.unsupported': return new AppError(415, 'UNSUPPORTED_ENCODING', 'Unsupported request encoding')
      case 'request.aborted':
      case 'request.size.invalid': return new AppError(400, 'INVALID_REQUEST', 'Invalid request')
    }
  }
  return new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred')
}

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  if (res.headersSent) {
    req.log.error({ code: 'RESPONSE_FAILED', requestId: req.id }, 'Response could not be completed')
    res.destroy()
    return
  }
  const exposed = publicError(error)
  if (exposed.status >= 500) {
    req.log.error({ code: exposed.code, requestId: req.id }, 'Request failed')
  }
  res.status(exposed.status).json({
    success: false,
    error: { code: exposed.code, message: exposed.message, requestId: req.id },
  })
}
