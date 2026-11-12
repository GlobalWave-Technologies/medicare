import type { BackendRole } from '../../api/auth'
import { ApiError, authErrorMessage } from '../../api/client'
import type { CatalogStatus } from '../../api/medications'

// Catalog management (the Medication Catalog page, deactivating and reactivating) is Admin-only; it
// lists medicine names and never shows prescriptions. Medical Officers may also add a missing
// medicine, from the prescribing form only. The server enforces both.
export const canManageCatalog = (role: BackendRole) => role === 'ADMIN'
export const canAddToCatalog = (role: BackendRole) => role === 'ADMIN' || role === 'DOCTOR_IN_CHARGE'
// Names compare as the server compares them: spacing tidied, capitals ignored.
export const tidyMedicineName = (name: string) => name.replace(/\s+/g, ' ').trim()
export const sameMedicineName = (a: string, b: string) => tidyMedicineName(a).toLowerCase() === tidyMedicineName(b).toLowerCase()
export const catalogStatuses: [CatalogStatus, string][] = [['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']]
export const unconfirmed = (error: unknown) => !(error instanceof ApiError) || error.status >= 500
export function catalogError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'MEDICATION_ALREADY_EXISTS') return 'This medicine is already in the list (names are matched ignoring capitals and spacing).'
    if (error.code === 'MEDICATION_EXISTS_INACTIVE') return 'This medicine is already in the list but inactive. Find it under Inactive and reactivate it.'
    if (error.code === 'MEDICATION_NOT_FOUND') return 'This medicine could not be found. Refresh the list.'
    if (error.code === 'VALIDATION_ERROR') return 'Enter a name of up to 200 characters on one line.'
    if (error.status === 403) return 'Only administrators can change the medication list.'
  }
  return authErrorMessage(error)
}
export const nameProblem = (name: string) => !name.trim() ? 'Enter the medicine name.' : tidyMedicineName(name).length > 200 ? 'Use up to 200 characters.'
  : Array.from(name).some((character) => { const code = character.codePointAt(0)!; return code < 32 && code !== 9 || (code >= 127 && code <= 159) }) ? 'Use a single line without special control characters.' : null
