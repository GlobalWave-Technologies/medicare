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

  'Records Officer': [
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
      label: 'Notifications',
      icon: Bell,
    },
  ],
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
