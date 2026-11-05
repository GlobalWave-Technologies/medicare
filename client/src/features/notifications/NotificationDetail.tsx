import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { ApiError } from '../../api/client'
import { notificationsApi, type InboxNotification } from '../../api/notifications'
import { Dialog } from '../../components/ui/Dialog'
import { displayTime } from '../appointments/appointment-time'
import { NotificationFeedback } from './NotificationFeedback'
import { appointmentTarget, typeLabels } from './notification-utils'

export function NotificationDetail({ notification, onClose, onRead, onOpenAppointment }: {
  notification: InboxNotification; onClose: () => void; onRead: (notification: InboxNotification) => void; onOpenAppointment: (id: string) => void
}) {
  const [current, setCurrent] = useState(notification), [marking, setMarking] = useState(false)
  const [failure, setFailure] = useState<{ error: unknown; during: 'read' | 'load' }>()
  const pending = useRef(false), opened = useRef(false), latest = useRef({ notification, onRead })
  useLayoutEffect(() => { latest.current = { notification, onRead } }, [notification, onRead])
  const missing = failure?.error instanceof ApiError && failure.error.status === 404
  async function markRead() {
    if (pending.current) return
    pending.current = true; setMarking(true); setFailure(undefined)
    try {
      const result = await notificationsApi.markRead(latest.current.notification.id)
      setCurrent(result.notification); latest.current.onRead(result.notification)
    } catch (error) { setFailure({ error, during: 'read' }) }
    finally { pending.current = false; setMarking(false) }
  }
  useEffect(() => {
    const { notification: opening } = latest.current
    if (!opening.readAt) {
      // Opening an unread notice is the action that marks it read, exactly once.
      if (!opened.current) { opened.current = true; void markRead() }
      return
    }
    const controller = new AbortController()
    notificationsApi.get(opening.id, controller.signal).then((result) => {
      if (!controller.signal.aborted) setCurrent(result.notification)
    }).catch((error: unknown) => { if (!controller.signal.aborted) setFailure({ error, during: 'load' }) })
    return () => controller.abort()
  }, [])
  const target = appointmentTarget(current)
  return <Dialog title={missing ? 'Notification not found' : current.title} onClose={onClose} kind="notification" closeLabel="Close notification">
    {missing ? <NotificationFeedback error={failure.error} /> : <div className="notification-detail">
      <div className="notification-tags">
        <span className="notification-type">{typeLabels[current.type] ?? 'Notification'}</span>
        <span className={`notification-state ${current.readAt ? 'is-read' : 'is-unread'}`}>{current.readAt ? 'Read' : 'Unread'}</span>
      </div>
      <p className="notification-message">{current.message}</p>
      <dl className="notification-detail-grid">
        <div><dt>Received</dt><dd><time dateTime={current.createdAt}>{displayTime(current.createdAt)}</time></dd></div>
        <div><dt>Read</dt><dd>{current.readAt ? <time dateTime={current.readAt}>{displayTime(current.readAt)}</time> : 'Not yet read'}</dd></div>
      </dl>
      {marking && <p role="status" className="loading-note">Marking as read…</p>}
      {failure?.during === 'read' && <NotificationFeedback error={failure.error} mutation="read" />}
      {failure?.during === 'load' && <p role="status" className="notification-note">The latest status could not be loaded. These details are from your inbox list.</p>}
    </div>}
    <div className="modal-footer">
      {failure?.during === 'read' && !missing && !current.readAt && <button type="button" className="button button-ghost" disabled={marking} onClick={() => void markRead()}>Mark as read</button>}
      <button type="button" className="button button-ghost" onClick={onClose}>Close</button>
      {!missing && target && <button type="button" className="button button-primary" onClick={() => onOpenAppointment(target)}><CalendarDays size={17} aria-hidden="true" />View appointment</button>}
    </div>
  </Dialog>
}
