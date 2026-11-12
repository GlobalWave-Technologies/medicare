import type { BackendRole } from '../../api/auth'
import { ApiError, authErrorMessage } from '../../api/client'
import type { CatalogStatus } from '../../api/medications'

// Catalog management is Admin-only; it lists medicine names and never shows prescriptions.
export const canManageCatalog = (role: BackendRole) => role === 'ADMIN'
export const catalogStatuses: [CatalogStatus, string][] = [['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']]
export const unconfirmed = (error: unknown) => !(error instanceof ApiError) || error.status >= 500
export function catalogError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'MEDICATION_ALREADY_EXISTS') return 'This medicine is already in the list (names are matched ignoring capitals and spacing). If it is inactive, find it under Inactive and reactivate it.'
    if (error.code === 'MEDICATION_NOT_FOUND') return 'This medicine could not be found. Refresh the list.'
    if (error.code === 'VALIDATION_ERROR') return 'Enter a name of up to 200 characters on one line.'
    if (error.status === 403) return 'Only administrators can change the medication list.'
  }
  return authErrorMessage(error)
}
export const nameProblem = (name: string) => !name.trim() ? 'Enter the medicine name.' : name.replace(/\s+/g, ' ').trim().length > 200 ? 'Use up to 200 characters.'
  : Array.from(name).some((character) => { const code = character.codePointAt(0)!; return code < 32 && code !== 9 || (code >= 127 && code <= 159) }) ? 'Use a single line without special control characters.' : null
