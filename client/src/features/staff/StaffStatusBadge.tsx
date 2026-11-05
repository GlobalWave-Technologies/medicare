import { Ban, CircleCheck, CirclePause, Clock3 } from 'lucide-react'
import type { StaffStatus } from '../../api/staff'
import { statusLabels } from './staff-utils'

const icons = { PENDING: Clock3, ACTIVE: CircleCheck, SUSPENDED: CirclePause, DISABLED: Ban } satisfies Record<StaffStatus, typeof Ban>
// Status is always given in words; the icon and colour only reinforce it.
export function StaffStatusBadge({ status }: { status: StaffStatus }) {
  const Icon = icons[status]
  return <span className={`staff-status status-${status.toLowerCase()}`}><Icon size={14} aria-hidden="true" />{statusLabels[status]}</span>
}
