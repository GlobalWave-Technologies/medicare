import type { View } from '../../types/index'
import { UsersRound } from 'lucide-react'
import { CalendarDays } from 'lucide-react'
import { FileText } from 'lucide-react'
import { Activity } from 'lucide-react'
import { ChevronDown } from 'lucide-react'
import { ArrowUpRight } from 'lucide-react'
import { MoreHorizontal } from 'lucide-react'
import { UserRound } from 'lucide-react'
import { ShieldCheck } from 'lucide-react'
import { Plus } from 'lucide-react'
import { appointments } from '../../mocks/data'

export function Overview({ onView }: { onView: (view: View) => void }) {
  return (
    <>
      <div className="stats-grid">
        <StatCard icon={UsersRound} label="Total patients" value="2,048" change="12.5%" note="vs last month" color="blue" />
        <StatCard icon={CalendarDays} label="Appointments" value="86" change="8.2%" note="this week" color="mint" />
        <StatCard icon={FileText} label="Medical records" value="1,279" change="4.6%" note="this month" color="lilac" />
        <StatCard icon={Activity} label="Active cases" value="24" change="2.1%" note="vs last week" color="gold" />
      </div>

      <div className="dashboard-grid">
        <section className="panel chart-panel">
          <div className="panel-header">
            <div>
              <h2>Patient activity</h2>
              <p>New registrations across the last 7 days</p>
            </div>
            <button className="select-button">This week <ChevronDown size={15} /></button>
          </div>
          <div className="chart-area">
            <div className="y-axis"><span>80</span><span>60</span><span>40</span><span>20</span><span>0</span></div>
            <div className="bars">
              <div className="grid-lines"><i /><i /><i /><i /><i /></div>
              {[['Mon', 47], ['Tue', 62], ['Wed', 54], ['Thu', 75], ['Fri', 49], ['Sat', 66], ['Sun', 44]].map(([day, height]) => (
                <div className="bar-column" key={day as string}>
                  <div className="bar-value" style={{ height: `${Number(height) / 0.8}%` }}><span>{height}</span></div>
                  <small>{day}</small>
                </div>
              ))}
            </div>
          </div>
          <div className="chart-foot">
            <span><i className="legend-dot blue-dot" /> New patients</span>
            <span className="trend"><ArrowUpRight size={15} /> 12.5% compared to last week</span>
          </div>
        </section>

        <section className="panel breakdown-panel">
          <div className="panel-header">
            <div>
              <h2>Chief complaints</h2>
              <p>Patient visits by reason</p>
            </div>
            <button className="more-button"><MoreHorizontal size={20} /></button>
          </div>
          <div className="donut-wrap">
            <div className="donut"><div><strong>2048</strong><span>visits</span></div></div>
            <div className="complaint-list">
              <Legend color="blue" label="Fever" value="34%" />
              <Legend color="mint" label="Headache" value="24%" />
              <Legend color="gold" label="Chest pain" value="18%" />
              <Legend color="lilac" label="Respiratory" value="12%" />
              <Legend color="rose" label="Other" value="12%" />
            </div>
          </div>
        </section>

        <section className="panel panel-wide">
          <div className="panel-header">
            <div>
              <h2>Recent activity</h2>
              <p>Today's key updates from across the clinic</p>
            </div>
            <button className="more-button"><MoreHorizontal size={20} /></button>
          </div>
          <div className="activity-list">
            <ActivityItem icon={UserRound} text="New patient registered" by="Reception desk" time="08:42" color="blue" />
            <ActivityItem icon={CalendarDays} text="Consultation rescheduled" by="Scheduling team" time="09:15" color="mint" />
            <ActivityItem icon={ShieldCheck} text="Lab report approved" by="Clinical team" time="10:30" color="gold" />
            <ActivityItem icon={FileText} text="Medical record review completed" by="Dr. Okafor" time="11:10" color="lilac" />
          </div>
        </section>
      </div>

      <section className="panel panel-compact">
        <div className="panel-header marginless">
          <div>
            <h2>Today’s schedule</h2>
            <p>Upcoming patient visits and follow-up care</p>
          </div>
          <button className="button button-primary" onClick={() => onView('Appointments')}><Plus size={17} /> View all</button>
        </div>
        <div className="appointment-list">
          {appointments.map((appointment) => (
            <div key={appointment.time} className="appointment-item">
              <div className={`appointment-time ${appointment.color}`}> {appointment.time}</div>
              <div className="appointment-copy">
                <strong>{appointment.name}</strong>
                <span>{appointment.detail}</span>
              </div>
              <div className={`avatar avatar-${appointment.color}`}>{appointment.initials}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

export function StatCard({ icon: Icon, label, value, change, note, color }: { icon: typeof UsersRound; label: string; value: string; change: string; note: string; color: string }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${color}`}><Icon size={20} /></div>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <div className="stat-change"><span><ArrowUpRight size={13} /> {change}</span>{note}</div>
    </div>
  )
}

export function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="legend">
      <i className={`legend-dot ${color}-dot`} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function ActivityItem({ icon: Icon, text, by, time, color }: { icon: typeof UserRound; text: string; by: string; time: string; color: string }) {
  return (
    <div className="activity-item">
      <div className={`activity-icon ${color}`}><Icon size={16} /></div>
      <div>
        <strong>{text}</strong>
        <span>{by} <i /> {time}</span>
      </div>
    </div>
  )
}
