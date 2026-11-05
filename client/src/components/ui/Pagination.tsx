import { ChevronLeft, ChevronRight } from 'lucide-react'

export type PageInfo = { page: number; limit: number; total: number; totalPages: number }
// One pager for every list: the count always reads the same way, and page controls appear only when there is more than one page.
export function Pagination({ pagination, onPage, label }: { pagination: PageInfo; onPage: (page: number) => void; label: string }) {
  if (pagination.total === 0) return null
  const pages = Math.max(1, pagination.totalPages)
  return <nav className="pagination" aria-label={label}>
    <span>{pagination.total.toLocaleString()} result{pagination.total === 1 ? '' : 's'} · Page {pagination.page} of {pages}</span>
    {(pages > 1 || pagination.page > 1) && <>
      <button type="button" className="button button-ghost" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}><ChevronLeft size={17} aria-hidden="true" />Previous</button>
      <button type="button" className="button button-ghost" disabled={pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)}>Next<ChevronRight size={17} aria-hidden="true" /></button>
    </>}
  </nav>
}
