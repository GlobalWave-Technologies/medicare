import { useId, useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { PasswordChangeForm } from './PasswordChangeForm'

// The menu's Change password dialog. On success the server has signed out every session,
// so the caller returns to sign-in.
export function ChangePasswordDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false), id = useId()
  return <Dialog title="Change password" busy={busy} onClose={onClose} kind="staff" size="compact" closeLabel="Close change password" describedBy={`${id}-intro`}>
    <PasswordChangeForm introId={`${id}-intro`} onChanged={onChanged} onBusyChange={setBusy}
      intro="After the change you’ll be signed out on all devices, including this one, and sign in again with the new password."
      secondary={(pending) => <button type="button" className="button button-ghost" disabled={pending} onClick={onClose}>Cancel</button>} />
  </Dialog>
}
