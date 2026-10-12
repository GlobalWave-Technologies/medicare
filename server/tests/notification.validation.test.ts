import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { broadcastSchema, notificationQuerySchema, notificationIdSchema, notificationEmptySchema } from '../src/modules/notifications/notification.validation.js'
import { hasPermission } from '../src/shared/authorization/permissions.js'

const broadcast = { title: 'Operational notice', message: 'Synthetic message', audience: { type: 'ALL' } }
describe('notification permissions and strict inputs', () => {
  for (const role of ['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'] as const) {
    it.each(['NOTIFICATION_READ_OWN', 'NOTIFICATION_MANAGE_OWN', 'NOTIFICATION_BROADCAST'] as const)(`${role} has expected %s permission`, (permission) => {
      expect(hasPermission(role, permission)).toBe(permission !== 'NOTIFICATION_BROADCAST' || role === 'ADMIN')
    })
  }
  it('trims plain Unicode text, preserving internal whitespace and line breaks', () => {
    expect(broadcastSchema.parse({ ...broadcast, title: '  Équipe – 更新  ', message: '  Line one\nLine two\t  ' })).toMatchObject({ title: 'Équipe – 更新', message: 'Line one\nLine two' })
  })
  it.each(['ADMIN', 'RECORDS_OFFICER', 'DOCTOR_IN_CHARGE'])('accepts ROLE %s', (role) => {
    expect(broadcastSchema.safeParse({ ...broadcast, audience: { type: 'ROLE', role } }).success).toBe(true)
  })
  it('accepts exact title/message limits', () => {
    expect(broadcastSchema.safeParse({ ...broadcast, title: 'a'.repeat(150), message: 'b'.repeat(2000) }).success).toBe(true)
  })
  it.each([
    { title: '' }, { title: '   ' }, { title: 'a'.repeat(151) }, { title: null }, { title: 12 },
    { message: '' }, { message: '\n\t' }, { message: 'a'.repeat(2001) }, { message: null }, { message: [] },
    { title: '<script>alert(1)</script>' }, { message: '<img src=x onerror=alert(1)>' }, { message: '<b>bold</b>' },
    { message: 'x\u0000y' }, { title: 'x\u007fy' }, { message: 'x\u009fy' },
    { audience: {} }, { audience: { type: 'EXTERNAL' } }, { audience: { type: 'ROLE' } },
    { audience: { type: 'ROLE', role: 'OWNER' } }, { audience: { type: 'ALL', role: 'ADMIN' } },
    { audience: { type: 'ALL', where: {} } }, { audience: { type: 'ROLE', role: 'ADMIN', recipientId: randomUUID() } },
    { audience: null }, { audience: [] },
  ])('rejects invalid broadcast variation %#', (variation) => {
    expect(broadcastSchema.safeParse({ ...broadcast, ...variation }).success).toBe(false)
  })
  it.each(['id', 'senderId', 'recipientId', 'recipients', 'type', 'targetRole', 'appointmentId', 'createdAt', 'readAt', 'resourceType', 'resourceId', 'where'])('rejects injected broadcast %s', (field) => {
    expect(broadcastSchema.safeParse({ ...broadcast, [field]: randomUUID() }).success).toBe(false)
  })
  it('uses bounded pagination and exact boolean filters', () => {
    expect(notificationQuerySchema.parse({})).toEqual({ page: 1, limit: 20 })
    expect(notificationQuerySchema.parse({ page: '2', limit: '100', read: 'false', type: 'DIRECT' })).toEqual({ page: 2, limit: 100, read: false, type: 'DIRECT' })
    expect(notificationQuerySchema.parse({ read: 'true' }).read).toBe(true)
  })
  it.each([
    { page: '0' }, { page: '100001' }, { page: '1.5' }, { limit: '101' }, { limit: '-1' }, { limit: 'many' },
    { read: '1' }, { read: 'TRUE' }, { read: '' }, { read: ['true', 'false'] }, { type: 'SYSTEM' },
    { recipientId: randomUUID() }, { staffUserId: randomUUID() }, { where: {} }, { orderBy: 'title' }, { search: 'text' },
  ])('rejects invalid inbox query %#', (query) => expect(notificationQuerySchema.safeParse(query).success).toBe(false))
  it.each(['invalid', '', '123', 'AP-123', '../read-all'])('rejects invalid id %s', (id) => expect(notificationIdSchema.safeParse({ id }).success).toBe(false))
  it('accepts UUID and rejects metadata on commands', () => {
    expect(notificationIdSchema.safeParse({ id: randomUUID() }).success).toBe(true)
    expect(notificationEmptySchema.safeParse({}).success).toBe(true)
    for (const field of ['readAt', 'recipientId', 'notificationId', 'where']) expect(notificationEmptySchema.safeParse({ [field]: randomUUID() }).success).toBe(false)
  })
})
