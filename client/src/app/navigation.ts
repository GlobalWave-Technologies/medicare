import type {
  Role,
  View,
} from '../types/index'
import type { BackendRole } from '../api/auth'

export const toUiRole = (role: BackendRole): Role => ({
  ADMIN: 'Admin', RECORDS_OFFICER: 'Records Officer', DOCTOR_IN_CHARGE: 'Doctor in Charge',
} as const)[role]

export function allowedView(role: BackendRole, requested: View): View {
  const items = navItemsByRole[toUiRole(role)]
  return items.some((item) => item.label === requested) ? requested : items[0].label
}

import {
  Bell,
  CalendarDays,
  ClipboardList,
  FileText,
  LayoutDashboard,
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
    {
      label: 'Overview',
      icon: LayoutDashboard,
    },
    {
      label: 'Patients',
      icon: UsersRound,
    },
    {
      label: 'Appointments',
      icon: CalendarDays,
    },
    {
      label: 'Staff',
      icon: ShieldCheck,
    },
    {
      label: 'Reports',
      icon: ClipboardList,
    },
    {
      label: 'Notifications',
      icon: Bell,
    },
  ],

  'Records Officer': [
    {
      label: 'Overview',
      icon: LayoutDashboard,
    },
    {
      label: 'Patients',
      icon: UsersRound,
    },
    {
      label: 'Appointments',
      icon: CalendarDays,
    },
    {
      label: 'Reports',
      icon: ClipboardList,
    },
    {
      label: 'Notifications',
      icon: Bell,
    },
  ],

  'Doctor in Charge': [
    {
      label: 'Overview',
      icon: LayoutDashboard,
    },
    {
      label: 'Patients',
      icon: UsersRound,
    },
    {
      label: 'Appointments',
      icon: CalendarDays,
    },
    {
      label: 'Medical records',
      icon: FileText,
    },
    {
      label: 'Reports',
      icon: ClipboardList,
    },
    {
      label: 'Notifications',
      icon: Bell,
    },
  ],
}

// Display names for each workspace. View keys stay stable; people see these names in navigation and headings.
export const viewLabels: Record<View, string> = {
  Overview: 'Overview', Patients: 'Patients', Appointments: 'Appointments', 'Medical records': 'Medical Records',
  Staff: 'Staff & Access', Reports: 'Reports', Notifications: 'Notifications',
}

export const roleLabels: Record<
  Role,
  string
> = {
  Admin: 'Administrator',

  'Records Officer':
    'Records Officer',

  'Doctor in Charge':
    'Doctor in Charge',
}

export const roles: Role[] = [
  'Admin',
  'Records Officer',
  'Doctor in Charge',
]
