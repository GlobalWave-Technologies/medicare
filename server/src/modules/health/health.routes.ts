import { Router } from 'express'
import { healthController, type HealthDependencies } from './health.controller.js'

export function healthRoutes(dependencies: HealthDependencies) {
  const router = Router()
  const controller = healthController(dependencies)
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  router.get('/', controller.health)
  router.get('/ready', controller.ready)
  return router
}
