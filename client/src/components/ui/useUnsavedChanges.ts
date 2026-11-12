import { useEffect } from 'react'

// Forms with unsaved text register here, so an app update never reloads over them.
const dirtyForms = new Set<symbol>()

export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const token = Symbol('unsaved form')
    dirtyForms.add(token)
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => { dirtyForms.delete(token); window.removeEventListener('beforeunload', warn) }
  }, [dirty])
}

// True while any form may hold unsaved work: a registered dirty form, or any open dialog with a form.
export const hasUnsavedWork = (root: ParentNode = document) => dirtyForms.size > 0 || Boolean(root.querySelector('[role="dialog"] form'))
