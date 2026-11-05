// The same contained placeholder for every list and record: a short status line and row shapes.
export function LoadingRows({ label, rows = 3 }: { label: string; rows?: number }) {
  return <>
    <p role="status" className="loading-note">{label}</p>
    <div className="loading-rows" aria-hidden="true">{Array.from({ length: rows }, (_, row) => <div key={row}><span /><span /></div>)}</div>
  </>
}
