import { useEffect, useId, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Brand } from '../../components/branding/BrandMarks'
import { ThemeControl } from '../../components/ui/ThemeControl'
import { ApiError, authErrorMessage } from '../../api/client'
import type { StaffUser } from '../../api/auth'
import { PasswordChangeForm } from './PasswordChangeForm'
import '../../pwa/pwa.css'

// Shown instead of the workspace while the account holds a temporary password. The server refuses
// every application route meanwhile; there is deliberately no way to skip or postpone the change.
export function TemporaryPasswordScreen({ user, onChanged, onSignOut }: { user: StaffUser; onChanged: () => void; onSignOut: () => Promise<void> }) {
  const [signingOut, setSigningOut] = useState(false), [signOutError, setSignOutError] = useState<unknown>(), [busy, setBusy] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null), id = useId()
  useEffect(() => { heading.current?.focus() }, [])
  async function signOut() {
    setSigningOut(true); setSignOutError(undefined)
    try { await onSignOut() } catch (error) { setSignOutError(error); setSigningOut(false) }
  }
  return <div className="login-page security-page">
    <div className="login-visual">
      <div className="login-orbit orbit-one" />
      <div className="login-orbit orbit-two" />
      <Brand inverse tagline="Hospital Records" />
      <div className="login-visual-copy">
        <p className="eyebrow">Account security</p>
        <p className="login-headline">Your account,<br /><em>your password.</em></p>
        <p>New and reset accounts start with a temporary password. Choosing your own keeps your access personal.</p>
        <div className="login-trust"><ShieldCheck size={17} aria-hidden="true" /><span>Access for authorized hospital staff</span></div>
      </div>
    </div>
    <main className="login-form-wrap">
      <div className="login-form security-form">
        <p className="eyebrow">First sign-in</p>
        <h1 ref={heading} tabIndex={-1}>Change your temporary password</h1>
        <p className="login-helper">Replace the temporary password you were given before you use Medicare.</p>
        <p className="security-identity"><span className="visually-hidden">Signed in as </span>{user.firstName} {user.lastName} · {user.email}</p>
        <PasswordChangeForm introId={`${id}-intro`} onBusyChange={setBusy}
          intro="Enter the temporary password as your current password, then choose your own. You’ll then sign in again with the new one."
          onChanged={onChanged}
          secondary={(pending) => <button type="button" className="button button-ghost" disabled={pending || busy || signingOut} onClick={() => void signOut()}>{signingOut ? 'Signing out…' : 'Sign out'}</button>} />
        {signOutError !== undefined && <div role="alert" className="auth-error">Sign-out could not be confirmed. {authErrorMessage(signOutError)}
          {signOutError instanceof ApiError && signOutError.requestId && <p>Support reference: {signOutError.requestId}</p>}</div>}
      </div>
      <div className="login-meta">
        <ThemeControl />
        <div className="login-copyright">© 2026 Medicare Hospital Records</div>
      </div>
    </main>
  </div>
}
