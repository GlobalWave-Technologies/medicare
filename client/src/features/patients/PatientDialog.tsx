import type { ReactNode } from 'react'
import { Dialog, type DialogSize } from '../../components/ui/Dialog'
import './patients.css'
export function PatientDialog(props: { title: string; busy: boolean; onClose: () => void; children: ReactNode; size?: DialogSize }) {
  return <Dialog {...props} kind="patient" closeLabel="Close patient dialog" />
}
