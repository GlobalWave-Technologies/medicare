import { Router } from 'express'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { requireAuth, requireCsrf } from '../../middleware/authentication.js'
import { requirePermission } from '../../middleware/authorization.js'
import { authContext, auditContext } from '../auth/auth.context.js'
import { toInboxNotification, toNotificationContent } from './notification.dto.js'
import { broadcastSchema, notificationQuerySchema, notificationIdSchema, notificationEmptySchema } from './notification.validation.js'
import { listNotifications, unreadCount, getNotification, markNotificationRead, markAllNotificationsRead, broadcastNotification } from './notification.service.js'

export function notificationRoutes(db: PrismaClient, origin: string) {
  const router = Router()
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.use(requireAuth(db), requireCsrf(origin))
  router.get('/', requirePermission('NOTIFICATION_READ_OWN'), async (req, res) => {
    const result = await listNotifications(db, authContext(req), notificationQuerySchema.parse(req.query))
    res.json({ success: true, data: { items: result.items.map(toInboxNotification), pagination: result.pagination } })
  })
  router.get('/unread-count', requirePermission('NOTIFICATION_READ_OWN'), async (req, res) => {
    notificationEmptySchema.parse(req.query)
    res.json({ success: true, data: { count: await unreadCount(db, authContext(req)) } })
  })
  router.post('/read-all', requirePermission('NOTIFICATION_MANAGE_OWN'), async (req, res) => {
    notificationEmptySchema.parse(req.query); notificationEmptySchema.parse(req.body ?? {})
    res.json({ success: true, data: { updated: await markAllNotificationsRead(db, authContext(req)) } })
  })
  router.post('/broadcast', requirePermission('NOTIFICATION_BROADCAST'), async (req, res) => {
    notificationEmptySchema.parse(req.query)
    const result = await broadcastNotification(db, authContext(req), auditContext(req), broadcastSchema.parse(req.body))
    res.status(201).json({ success: true, data: { notification: toNotificationContent(result.notification), recipientCount: result.recipientCount } })
  })
  router.get('/:id', requirePermission('NOTIFICATION_READ_OWN'), async (req, res) => {
    notificationEmptySchema.parse(req.query)
    const value = await getNotification(db, authContext(req), notificationIdSchema.parse(req.params).id)
    res.json({ success: true, data: { notification: toInboxNotification(value) } })
  })
  router.post('/:id/read', requirePermission('NOTIFICATION_MANAGE_OWN'), async (req, res) => {
    notificationEmptySchema.parse(req.query); notificationEmptySchema.parse(req.body ?? {})
    const value = await markNotificationRead(db, authContext(req), notificationIdSchema.parse(req.params).id)
    res.json({ success: true, data: { notification: toInboxNotification(value) } })
  })
  return router
}
