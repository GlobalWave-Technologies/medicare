import { useRef, useState } from 'react'
import { Bell, CalendarDays, CheckCheck, Megaphone, RefreshCw } from 'lucide-react'
import type { StaffUser } from '../../api/auth'
import { notificationsApi, type BroadcastAudience, type BroadcastResult, type InboxNotification, type NotificationType } from '../../api/notifications'
import { Pagination } from '../../components/ui/Pagination'
import { displayTime, localTimezone } from '../appointments/appointment-time'
import { useAppointmentClock } from '../appointments/useAppointments'
import { BroadcastComposer } from './BroadcastComposer'
import { NotificationDetail } from './NotificationDetail'
import { NotificationFeedback } from './NotificationFeedback'
import { appointmentTarget, audienceRoles, canBroadcast, notificationTime, typeLabels } from './notification-utils'
import { useNotificationList, type UnreadCount } from './useNotifications'
import './notifications.css'

type ReadFilter = 'all' | 'unread' | 'read'
const readFilters: [ReadFilter, string][] = [['all', 'All'], ['unread', 'Unread'], ['read', 'Read']]

export function Notifications({ user, unread, onOpenAppointment }: { user: StaffUser; unread: UnreadCount; onOpenAppointment: (id: string) => void }) {
  const [filter, setFilter] = useState<ReadFilter>('all'), [type, setType] = useState<NotificationType | ''>(''), [page, setPage] = useState(1), [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<InboxNotification | null>(null), [composing, setComposing] = useState(false)
  const [notice, setNotice] = useState(''), [actionError, setActionError] = useState<unknown>(), [marking, setMarking] = useState(false)
  const markPending = useRef(false), now = useAppointmentClock()
  const { data, loading, error, replace } = useNotificationList({ page, limit: 20, read: filter === 'all' ? undefined : filter === 'read', type: type || undefined }, revision)
  const reload = () => setRevision((n) => n + 1)
  function refresh() { setNotice(''); setActionError(undefined); reload(); unread.refresh() }
  function read(notification: InboxNotification) { replace(notification); unread.refresh() }
  async function markAll() {
    if (markPending.current) return
    markPending.current = true; setMarking(true); setActionError(undefined); setNotice('')
    try {
      const { updated } = await notificationsApi.markAllRead()
      setNotice(updated ? `${updated} notification${updated === 1 ? '' : 's'} marked as read.` : 'All notifications were already marked as read.')
      setPage(1); reload()
    } catch (caught) { setActionError(caught) }
    finally { markPending.current = false; setMarking(false); unread.refresh() }
  }
  function sent(result: BroadcastResult, audience: BroadcastAudience) {
    const people = `${result.recipientCount} active staff member${result.recipientCount === 1 ? '' : 's'}`
    const group = audience.type === 'ROLE' ? ` (${audienceRoles.find(([role]) => role === audience.role)?.[1]})` : ''
    setActionError(undefined); setNotice(`Broadcast sent to ${people}${group}.`); reload(); unread.refresh()
  }
  const filtered = filter !== 'all' || type !== ''
  const empty = filter === 'unread' && !type ? 'No unread notifications.' : filtered ? 'No notifications match this filter.' : 'You’re all caught up. New operational notifications will appear here.'
  return <section className="panel notification-workspace">
    <div className="notification-header">
      <div><p className="notification-kicker">Staff inbox</p><h2>Your notifications</h2><p>Only notifications delivered to your account are shown. Times in {localTimezone()}.</p></div>
      <div className="notification-toolbar">
        <button type="button" className="button button-ghost" aria-label="Refresh notifications" onClick={refresh}><RefreshCw size={17} aria-hidden="true" />Refresh</button>
        <button type="button" className="button button-ghost" disabled={marking || unread.count === 0} onClick={() => void markAll()}><CheckCheck size={17} aria-hidden="true" />{marking ? 'Marking all as read…' : 'Mark all as read'}</button>
        {canBroadcast(user.role) && <button type="button" className="button button-primary" onClick={() => { setNotice(''); setComposing(true) }}><Megaphone size={17} aria-hidden="true" />New broadcast</button>}
      </div>
    </div>
    <div className="notification-summary">
      <dl>
        <div><dt>Unread</dt><dd>{unread.count !== undefined ? unread.count : unread.loading ? 'Loading…' : 'Unavailable'}</dd></div>
        <div><dt>In this view</dt><dd>{data ? data.pagination.total : loading ? 'Loading…' : 'Unavailable'}</dd></div>
      </dl>
      {unread.count === undefined && !unread.loading && <button type="button" className="button button-ghost" onClick={unread.refresh}>Retry unread count</button>}
    </div>
    {marking && <p role="status" className="loading-note">Marking all notifications as read…</p>}
    {notice && <p role="status" className="notification-notice">{notice}</p>}
    {actionError !== undefined && <NotificationFeedback error={actionError} mutation="read" />}
    <div className="notification-filters">
      <div role="group" aria-label="Read status" className="notification-segments">
        {readFilters.map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1) }}>{label}</button>)}
      </div>
      <label>Type<select name="notificationType" value={type} onChange={(event) => { setType(event.target.value as NotificationType | ''); setPage(1) }}>
        <option value="">All types</option>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    {loading && <><p role="status" className="loading-note">Loading notifications…</p><div className="notification-skeleton" aria-hidden="true">{[0, 1, 2].map((row) => <div key={row}><span /><span /></div>)}</div></>}
    {error !== undefined && <div className="notification-recovery"><NotificationFeedback error={error} /><button type="button" className="button button-ghost" onClick={reload}>Try again</button></div>}
    {data && (data.items.length ? <ul className="notification-list" aria-label="Notifications">{data.items.map((item) => {
      const target = appointmentTarget(item), ids = `notification-${item.id}`
      return <li key={item.id} className={`notification-item ${item.readAt ? 'is-read' : 'is-unread'}`}>
        <span className={`notification-icon type-${item.type.toLowerCase()}`} aria-hidden="true">{item.type === 'BROADCAST' ? <Megaphone size={18} /> : target ? <CalendarDays size={18} /> : <Bell size={18} />}</span>
        <div className="notification-body">
          <div className="notification-line">
            <h3><button type="button" className="notification-open" aria-describedby={`${ids}-tags ${ids}-time`} onClick={() => setSelected(item)}>{item.title}</button></h3>
            <time id={`${ids}-time`} dateTime={item.createdAt} title={displayTime(item.createdAt)}>{notificationTime(item.createdAt, now)}</time>
          </div>
          <p className="notification-preview">{item.message}</p>
          <div id={`${ids}-tags`} className="notification-tags">
            <span className={`notification-state ${item.readAt ? 'is-read' : 'is-unread'}`}>{item.readAt ? 'Read' : 'Unread'}</span>
            <span className="notification-type">{typeLabels[item.type] ?? 'Notification'}</span>
            {target && <span className="notification-type">Linked appointment</span>}
          </div>
        </div>
      </li>
    })}</ul> : <div className="notification-empty" role="status"><Bell size={22} aria-hidden="true" /><p>{empty}</p></div>)}
    {data && data.pagination.page > Math.max(1, data.pagination.totalPages) && <button type="button" className="button button-ghost" onClick={() => setPage(1)}>Return to first page</button>}
    {data && data.pagination.total > 0 && <Pagination label="Notification pages" pagination={data.pagination} onPage={setPage} />}
    {selected && <NotificationDetail notification={selected} onRead={read} onClose={() => setSelected(null)} onOpenAppointment={(id) => { setSelected(null); onOpenAppointment(id) }} />}
    {composing && <BroadcastComposer onClose={() => setComposing(false)} onSent={sent} />}
  </section>
}
