import type {
  Role,
  View,
} from '../types/index'
import type { BackendRole } from '../api/auth'

// DOCTOR_IN_CHARGE is the stored role code; staff see it as Medical Officer.
export const toUiRole = (role: BackendRole): Role => ({
  ADMIN: 'Admin', RECORDS_OFFICER: 'Records Officer', DOCTOR_IN_CHARGE: 'Medical Officer',
} as const)[role]

export function allowedView(role: BackendRole, requested: View): View {
  const items = navItemsByRole[toUiRole(role)]
  return items.some((item) => item.label === requested) ? requested : items[0].label
}

import {
  Activity,
  Bell,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Pill,
  UsersRound,
  ShieldCheck,
} from 'lucide-react'

type NavItem = {
  label: View
  icon: typeof LayoutDashboard
}

export const navItemsByRole: Record<
  Role,
  NavItem[]
> = {
  Admin: [
    { label: 'Overview', icon: LayoutDashboard },
    { label: 'Patients', icon: UsersRound },
    { label: 'Staff', icon: ShieldCheck },
    { label: 'Activity', icon: Activity },
    { label: 'Medicines', icon: Pill },
    { label: 'Notifications', icon: Bell },
    { label: 'Reports', icon: ClipboardList },
  ],

  'Records Officer': [
    { label: 'Overview', icon: LayoutDashboard },
    { label: 'Patients', icon: UsersRound },
    { label: 'Notifications', icon: Bell },
    { label: 'Reports', icon: ClipboardList },
  ],

  'Medical Officer': [
    { label: 'Overview', icon: LayoutDashboard },
    { label: 'Patients', icon: UsersRound },
    { label: 'Medical records', icon: FileText },
    { label: 'Notifications', icon: Bell },
  ],
}

// Display names for each workspace. View keys stay stable; people see these names in navigation and headings.
export const viewLabels: Record<View, string> = {
  Overview: 'Overview', Patients: 'Patients', 'Medical records': 'Medical Records',
  Staff: 'Staff & Access', Activity: 'Staff Activity', Medicines: 'Medication Catalog', Reports: 'Reports', Notifications: 'Notifications',
}

export const roleLabels: Record<
  Role,
  string
> = {
  Admin: 'Administrator',

  'Records Officer':
    'Records Officer',

  'Medical Officer':
    'Medical Officer',
}

export const roles: Role[] = [
  'Admin',
  'Records Officer',
  'Medical Officer',
]
