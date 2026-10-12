import { ChevronLeft } from 'lucide-react'
import { ChevronRight } from 'lucide-react'

export function Pagination({ currentPage, pageCount, total, pageSize, onPageChange }: { currentPage: number; pageCount: number; total: number; pageSize: number; onPageChange: (page: number) => void }) {
  const firstItem = total === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const lastItem = Math.min(currentPage * pageSize, total)

  return (
    <div className="pagination">
      <span>Showing {firstItem}-{lastItem} of {total}</span>
      <div>
        <button className="pagination-button" disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
        {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
          <button className={`pagination-button ${page === currentPage ? 'active' : ''}`} key={page} onClick={() => onPageChange(page)}>{page}</button>
        ))}
        <button className="pagination-button" disabled={currentPage === pageCount} onClick={() => onPageChange(currentPage + 1)} aria-label="Next page"><ChevronRight size={15} /></button>
      </div>
    </div>
  )
}
