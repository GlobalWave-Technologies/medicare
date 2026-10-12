

export type Role = 'Admin' | 'Records Officer' | 'Doctor in Charge'

export type View = 'Overview' | 'Patients' | 'Appointments' | 'Medical records' | 'Reports' | 'Notifications'

export type Broadcast = { id: number; title: string; message: string; audience: string; createdAt: string }
