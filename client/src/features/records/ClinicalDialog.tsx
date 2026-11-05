import type { ReactNode } from 'react'
import { Dialog, type DialogSize } from '../../components/ui/Dialog'
import './records.css'
export function ClinicalDialog(props: { title: string; busy: boolean; onClose: () => void; children: ReactNode; size?: DialogSize }) {
  return <Dialog {...props} kind="clinical" closeLabel="Close clinical dialog" />
}
