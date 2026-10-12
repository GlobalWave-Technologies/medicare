import { Download } from 'lucide-react'
import { ClipboardList } from 'lucide-react'
import { ArrowUpRight } from 'lucide-react'

export function Reports() {
  return (
    <section className="panel page-panel">
      <div className="panel-header">
        <div>
          <h2>Reports & insights</h2>
          <p>Generate operational reports from your hospital data</p>
        </div>
        <button className="button button-primary"><Download size={17} /> Export all</button>
      </div>
      <div className="report-grid">
        <ReportCard title="Patient census" detail="Patient counts by department and demographic" date="Updated today" />
        <ReportCard title="Appointment summary" detail="Bookings, cancellations and attendance trends" date="Updated today" />
        <ReportCard title="Chief complaint breakdown" detail="Visit reasons filtered by date range" date="Updated yesterday" />
        <ReportCard title="Staff activity log" detail="User sign-ins and protected actions" date="Updated 18 min ago" />
      </div>
    </section>
  )
}

export function ReportCard({ title, detail, date }: { title: string; detail: string; date: string }) {
  return (
    <button className="report-card">
      <div className="report-card-icon"><ClipboardList size={19} /></div>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
        <small>{date}</small>
      </div>
      <ArrowUpRight size={17} />
    </button>
  )
}
