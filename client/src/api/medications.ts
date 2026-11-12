import { mutation, request } from './client'
import type { Pagination } from './common'

// The medication catalog: medicine names only. Prescriptions are part of clinical records.
export type CatalogMedication = { id: string; name: string; active: boolean; createdAt: string; updatedAt: string }
export type MedicationOption = { id: string; name: string }
export type CatalogStatus = 'active' | 'inactive' | 'all'
export type CatalogQuery = { page?: number; limit?: number; status?: CatalogStatus; search?: string }
export type CatalogPage = { items: CatalogMedication[]; pagination: Pagination }
type Result = { medication: CatalogMedication }
const path = (id: string) => `/medications/${encodeURIComponent(id)}`

export const medicationsApi = {
  list(query: CatalogQuery = {}, signal?: AbortSignal) {
    const params = new URLSearchParams({ page: String(query.page ?? 1), limit: String(query.limit ?? 20), status: query.status ?? 'active' })
    if (query.search?.trim()) params.set('search', query.search.trim())
    return request<CatalogPage>(`/medications?${params}`, { signal })
  },
  // Every active medicine, loaded once when the prescribing form opens.
  options: (signal?: AbortSignal) => request<{ items: MedicationOption[] }>('/medications/options', { signal }),
  create: (name: string) => mutation<Result>('/medications', { method: 'POST', body: JSON.stringify({ name }) }),
  deactivate: (id: string) => mutation<Result>(`${path(id)}/deactivate`, { method: 'POST', body: '{}' }),
  reactivate: (id: string) => mutation<Result>(`${path(id)}/reactivate`, { method: 'POST', body: '{}' }),
}
