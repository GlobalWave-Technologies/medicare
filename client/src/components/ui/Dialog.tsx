import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export type DialogSize = 'compact' | 'standard' | 'wide'
// Open dialogs, innermost last. A dialog can open another on top of it (adding a medicine from the
// clinical record editor); only the innermost one handles Escape, Tab and focus. The page stays
// locked from the first dialog until the last one closes, whatever order they unmount in.
const openDialogs: HTMLElement[] = []
let pageOverflow = ''
export function Dialog({ title, busy = false, onClose, children, kind = 'shared', closeLabel = 'Close dialog', describedBy, size = 'standard' }: {
  title: string; busy?: boolean; onClose: () => void; children: ReactNode; kind?: string; closeLabel?: string; describedBy?: string; size?: DialogSize
}) {
  const ref = useRef<HTMLDivElement>(null), backdrop = useRef<HTMLDivElement>(null), titleId = useId()
  const latest = useRef({ busy, onClose })
  useLayoutEffect(() => { latest.current = { busy, onClose } }, [busy, onClose])
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = ref.current!
    const siblings: HTMLElement[] = []
    let branch: HTMLElement | null = backdrop.current
    while (branch?.parentElement) {
      siblings.push(...Array.from(branch.parentElement.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== branch))
      branch = branch.parentElement
    }
    const inert = siblings.map((node) => [node, node.inert] as const)
    inert.forEach(([node]) => { node.inert = true })
    if (!openDialogs.length) { pageOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden' }
    openDialogs.push(dialog)
    const innermost = () => openDialogs.at(-1) === dialog
    dialog.focus()
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex="0"]'))
      .filter((element) => !element.hasAttribute('disabled') && !element.closest('fieldset[disabled], [hidden]') && element.tabIndex >= 0)
    const keydown = (event: KeyboardEvent) => {
      if (!innermost()) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!latest.current.busy) latest.current.onClose() }
      if (event.key !== 'Tab') return
      const items = focusable(), first = items[0], last = items.at(-1)
      if (!first) { event.preventDefault(); dialog.focus(); return }
      const outside = !dialog.contains(document.activeElement)
      if (event.shiftKey && (outside || document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (outside || document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus() }
    }
    const focusin = () => { if (innermost() && !dialog.contains(document.activeElement)) dialog.focus() }
    document.addEventListener('keydown', keydown)
    document.addEventListener('focusin', focusin)
    return () => {
      document.removeEventListener('keydown', keydown); document.removeEventListener('focusin', focusin)
      const index = openDialogs.indexOf(dialog)
      if (index >= 0) openDialogs.splice(index, 1)
      inert.forEach(([node, value]) => { node.inert = value })
      if (!openDialogs.length) document.body.style.overflow = pageOverflow
      if (previous !== document.body && previous?.isConnected && !previous.closest('[hidden], [inert]') && !previous.hasAttribute('disabled')) previous.focus()
      else document.querySelector<HTMLElement>('[data-page-title]')?.focus()
    }
  }, [])
  return <div ref={backdrop} className={`modal-backdrop ${kind}-modal-backdrop`} onClick={(event) => {
    if (event.target === event.currentTarget && !busy) onClose()
  }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={describedBy} aria-busy={busy} tabIndex={-1} className={`modal ${kind}-modal${size === 'standard' ? '' : ` modal-${size}`}`}>
      <div className={`modal-header ${kind}-modal-header`}><h2 id={titleId}>{title}</h2>
        <button type="button" className={`icon-btn ${kind}-modal-close`} disabled={busy} onClick={onClose} aria-label={closeLabel}><X size={20} aria-hidden="true" /></button>
      </div>{children}
    </div>
  </div>
}
