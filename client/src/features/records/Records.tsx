import { useState } from 'react'
import { medicalRecords } from '../../mocks/data'
import { ShieldCheck } from 'lucide-react'
import { HeartPulse } from 'lucide-react'
import { Stethoscope } from 'lucide-react'
import { Clock3 } from 'lucide-react'
import { statusMeaning } from '../patients/constants'
import { MoreHorizontal } from 'lucide-react'
import { Pagination } from '../../components/ui/Pagination'

export function Records() {
  const pageSize = 2
  const [currentPage, setCurrentPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(medicalRecords.length / pageSize))
  const visibleRecords = medicalRecords.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return (
    <section className="panel page-panel">
      <div className="panel-header table-header">
        <div>
          <h2>Medical records</h2>
          <p>Clinical records restricted to authorised staff</p>
        </div>
        <div className="access-badge"><ShieldCheck size={16} /> Clinical access</div>
      </div>
      <div className="record-cards">
        <div className="record-card"><div className="record-icon blue-bg"><HeartPulse size={22} /></div><strong>1,279</strong><span>Records updated this month</span></div>
        <div className="record-card"><div className="record-icon mint-bg"><Stethoscope size={22} /></div><strong>98.4%</strong><span>Complete patient profiles</span></div>
        <div className="record-card"><div className="record-icon gold-bg"><Clock3 size={22} /></div><strong>18 min</strong><span>Average review time</span></div>
      </div>
      <div className="patient-table records-table">
        <div className="table-row table-head"><span>Patient</span><span>Record ID</span><span>Last visit</span><span>Diagnosis</span><span>Clinician</span><span>Status</span><span /></div>
        {visibleRecords.map((record) => (
          <div className="table-row" key={record.recordId}>
            <div className="patient-name"><div className={`avatar avatar-${record.color}`}>{record.initials}</div><strong>{record.patient}</strong></div>
            <span>{record.recordId}</span>
            <span>{record.visit}</span>
            <span>{record.diagnosis}</span>
            <span>{record.clinician}</span>
            <span title={statusMeaning[record.status] ?? record.status}><em className={`status ${record.status.toLowerCase()}`}>{record.status}</em></span>
            <button className="more-button"><MoreHorizontal size={18} /></button>
          </div>
        ))}
      </div>
      <Pagination currentPage={currentPage} pageCount={pageCount} total={medicalRecords.length} pageSize={pageSize} onPageChange={setCurrentPage} />
    </section>
  )
}
