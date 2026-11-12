import type { ActivityItem, Presence } from '../../api/staffActivity'
import { roleLabel } from '../staff/staff-utils'
import { categoryLabels, fullTime, presenceLabels, presenceTones, sinceText, staffFullName, whenText } from './activity-utils'

// A time in words, with the exact date and time for assistive technology and on hover.
export function When({ value, now, relative = true }: { value: string; now: string; relative?: boolean }) {
  const shown = relative ? sinceText(value, now) : whenText(value, now), exact = fullTime(value)
  return <time dateTime={value} title={exact}>{shown}{!shown.includes(exact) && <span className="visually-hidden"> ({exact})</span>}</time>
}
// Status always in words; the colour only reinforces it.
export function PresenceBadge({ status }: { status: Presence | 'SIGNED_OUT' }) {
  return status === 'SIGNED_OUT' ? <span className="status tone-neutral">Not signed in</span>
    : <span className={`status ${presenceTones[status]}`}>{presenceLabels[status]}</span>
}

export function ActivityList({ items, now, showActor = true, label }: { items: ActivityItem[]; now: string; showActor?: boolean; label: string }) {
  return <ol className={`activity-list${showActor ? '' : ' activity-list-own'}`} aria-label={label}>{items.map((item) => <li key={item.id}>
    <span className="activity-time"><When value={item.occurredAt} now={now} relative={false} /></span>
    {showActor && <span className="activity-who"><strong>{staffFullName(item.actor)}</strong><span>{roleLabel(item.actor.role)} · {item.actor.staffNumber}</span></span>}
    <span className="activity-what">{item.text}</span>
    <span className="tag activity-category">{categoryLabels[item.category]}</span>
  </li>)}</ol>
}
