import type { RequestHandler } from 'express'
import { AppError } from '../shared/errors/AppError.js'

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', 'Route not found'))
}
