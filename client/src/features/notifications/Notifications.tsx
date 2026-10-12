import type { Broadcast } from '../../types/index'
import { Bell } from 'lucide-react'
import { useState } from 'react'
import { X } from 'lucide-react'

export function Notifications({ broadcasts }: { broadcasts: Broadcast[] }) {
  return (
    <section className="panel page-panel">
      <div className="panel-header">
        <div>
          <h2>Notifications</h2>
          <p>Latest updates from the hospital workspace</p>
        </div>
      </div>
      <div className="activity-list">
        {broadcasts.map((broadcast) => (
          <div key={broadcast.id} className="activity-item">
            <div className="activity-icon blue"><Bell size={16} /></div>
            <div>
              <strong>{broadcast.title}</strong>
              <span>{broadcast.message}</span>
              <small>{broadcast.audience} · {broadcast.createdAt}</small>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function BroadcastModal({ onClose, onSend }: { onClose: () => void; onSend: (message: string) => void }) {
  const [message, setMessage] = useState('')

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">ADMIN BROADCAST</p><h2>Send alert to Records Officers</h2></div>
          <button className="icon-btn" onClick={onClose}><X size={19} /></button>
        </div>

        <div className="form-grid">
          <label className="wide">Message<textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write a message to all Records Officers..." rows={5} /></label>
        </div>

        <div className="modal-footer">
          <button className="button button-ghost" onClick={onClose}>Cancel</button>
          <button className="button button-primary" onClick={() => onSend(message)}>Send broadcast</button>
        </div>
      </div>
    </div>
  )
}
