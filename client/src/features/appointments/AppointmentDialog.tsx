import type { ReactNode } from 'react'
import { Dialog, type DialogSize } from '../../components/ui/Dialog'
import './appointments.css'
export function AppointmentDialog(props: { title: string; busy: boolean; onClose: () => void; children: ReactNode; size?: DialogSize }) {
  return <Dialog {...props} kind="appointment" closeLabel="Close appointment dialog" />
}
