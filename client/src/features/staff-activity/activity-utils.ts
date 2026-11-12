import type { ActivityCategory, ActivityPeriod, Presence } from '../../api/staffActivity'

export const presenceLabels: Record<Presence, string> = { ACTIVE_NOW: 'Active now', RECENTLY_ACTIVE: 'Recently active', IDLE: 'Idle' }
export const presenceTones: Record<Presence, string> = { ACTIVE_NOW: 'tone-success', RECENTLY_ACTIVE: 'tone-info', IDLE: 'tone-neutral' }
export const categoryLabels: Record<ActivityCategory | 'all', string> = {
  all: 'All activity', authentication: 'Sign-in and sign-out', patients: 'Patients', admissions: 'Admissions',
  clinical: 'Clinical records', staff: 'Staff administration', catalog: 'Medication catalog',
}
export const activityPeriods: [ActivityPeriod, string][] = [['today', 'Today'], ['last7', 'Last 7 days'], ['last30', 'Last 30 days']]

// The full date and time, in the viewer's time zone.
export const fullTime = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const clock = (value: string) => new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(value))
const dayKey = (time: number) => new Date(time).toDateString()
// Recent times read as "4 min ago"; older ones as "Today, 08:12", "Yesterday, 18:30" or a date.
// Differences are measured against the server's clock (`now`), so a wrong device clock cannot mislead.
export function sinceText(value: string, now: string) {
  const at = Date.parse(value), minutes = Math.max(0, Math.floor((Date.parse(now) - at) / 60000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  return whenText(value, now)
}
export function whenText(value: string, now: string) {
  const at = Date.parse(value), today = Date.parse(now)
  if (dayKey(at) === dayKey(today)) return `Today, ${clock(value)}`
  if (dayKey(at) === dayKey(today - 86400000)) return `Yesterday, ${clock(value)}`
  return fullTime(value)
}
export const staffFullName = (staff: { firstName: string; lastName: string }) => `${staff.firstName} ${staff.lastName}`
