import type { Broadcast } from '../types/index'

export const appointments = [{ time: '09:00', name: 'Amina Yusuf', detail: 'Follow-up consultation', color: 'mint', initials: 'AY' }, { time: '10:30', name: 'Marcus Johnson', detail: 'General body pain', color: 'gold', initials: 'MJ' }, { time: '11:15', name: 'Sofia Martins', detail: 'Routine check-up', color: 'lilac', initials: 'SM' }, { time: '13:00', name: 'Daniel Kim', detail: 'Chest pains', color: 'rose', initials: 'DK' }]

export const recentPatients = [{ id: 'PT-2048', name: 'Amina Yusuf', age: '28 yrs', complaint: 'Allergic Reaction', status: 'Active', seen: 'Today, 08:42', initials: 'AY', color: 'mint' }, { id: 'PT-2047', name: 'Marcus Johnson', age: '45 yrs', complaint: 'General Body Pain', status: 'Active', seen: 'Today, 08:15', initials: 'MJ', color: 'gold' }, { id: 'PT-2046', name: 'Sofia Martins', age: '32 yrs', complaint: 'Headache', status: 'Pending', seen: 'Yesterday, 16:20', initials: 'SM', color: 'lilac' }, { id: 'PT-2045', name: 'Daniel Kim', age: '51 yrs', complaint: 'Chest Pains', status: 'Active', seen: 'Yesterday, 14:08', initials: 'DK', color: 'rose' }]

export const medicalRecords = [{ patient: 'Amina Yusuf', recordId: 'MR-7842', visit: 'Today, 08:42', diagnosis: 'Allergic Reaction', clinician: 'Dr. Okafor', status: 'Reviewed', color: 'mint', initials: 'AY' }, { patient: 'Marcus Johnson', recordId: 'MR-7841', visit: 'Today, 08:15', diagnosis: 'General Body Pain', clinician: 'Dr. Okafor', status: 'Reviewed', color: 'gold', initials: 'MJ' }, { patient: 'Sofia Martins', recordId: 'MR-7839', visit: 'Yesterday, 16:20', diagnosis: 'Headache', clinician: 'Dr. Bello', status: 'Pending', color: 'lilac', initials: 'SM' }, { patient: 'Daniel Kim', recordId: 'MR-7836', visit: 'Yesterday, 14:08', diagnosis: 'Chest Pains', clinician: 'Dr. Mensah', status: 'Reviewed', color: 'rose', initials: 'DK' }]

export const defaultBroadcasts: Broadcast[] = [
  { id: 1, title: 'Staff briefing', message: 'Please review all checked-in patients before 10:00 AM.', audience: 'All Records Officers', createdAt: '08:30 AM' },
  { id: 2, title: 'Bed update', message: 'Ward 3 is now ready for new admissions.', audience: 'All Records Officers', createdAt: '09:05 AM' },
]
