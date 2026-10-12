import { useState, type FormEvent } from 'react'
import {
  CalendarDays,
  Phone,
  UserRound,
  X,
} from 'lucide-react'
import {
  ApiError,
  patientsApi,
  type Patient,
} from '../../lib/api'
import './patients.css'

type PatientModalProps = {
  onClose: () => void
  onCreated?: (patient: Patient) => void
}

export function PatientModal({
  onClose,
  onCreated,
}: PatientModalProps) {
  const [firstName, setFirstName] = useState('')
  const [middleName, setMiddleName] = useState('')
  const [lastName, setLastName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [phone, setPhone] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    if (saving) return

    setSaving(true)
    setError('')

    try {
      const result = await patientsApi.create({
        firstName: firstName.trim(),
        middleName: middleName.trim() || null,
        lastName: lastName.trim(),
        dateOfBirth: dateOfBirth || null,
        phone: phone.trim() || null,
      })

      onCreated?.(result.patient)
      onClose()
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 403) {
          setError(
            'You do not have permission to register patients.',
          )
        } else if (error.code === 'VALIDATION_ERROR') {
          setError(
            'Please check the patient details and try again.',
          )
        } else {
          setError(error.message)
        }
      } else {
        setError(
          'Unable to save the patient. Please check the server connection.',
        )
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="modal-backdrop patient-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="modal patient-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          <div className="modal-header patient-modal-header">
            <div>
              <p className="eyebrow">
                PATIENT REGISTRATION
              </p>

              <h2>Add a new patient</h2>

              <p className="patient-modal-subtitle">
                Create a secure hospital record. Clinical details
                can be added later during an encounter.
              </p>
            </div>

            <button
              className="icon-btn patient-modal-close"
              type="button"
              onClick={onClose}
              aria-label="Close patient registration"
            >
              <X size={19} />
            </button>
          </div>

          <div className="patient-form-section">
            <div className="patient-form-section-title">
              <UserRound size={16} />
              <span>Identity</span>
            </div>

            <div className="form-grid patient-form-grid">
              <label>
                First name

                <input
                  value={firstName}
                  onChange={(event) =>
                    setFirstName(event.target.value)
                  }
                  placeholder="e.g. Amina"
                  maxLength={100}
                  autoFocus
                  required
                />
              </label>

              <label>
                Middle name

                <input
                  value={middleName}
                  onChange={(event) =>
                    setMiddleName(event.target.value)
                  }
                  placeholder="Optional"
                  maxLength={100}
                />
              </label>

              <label>
                Last name

                <input
                  value={lastName}
                  onChange={(event) =>
                    setLastName(event.target.value)
                  }
                  placeholder="e.g. Yusuf"
                  maxLength={100}
                  required
                />
              </label>

              <label>
                Date of birth

                <div className="patient-input-icon">
                  <CalendarDays size={16} />

                  <input
                    type="date"
                    value={dateOfBirth}
                    max={new Date()
                      .toISOString()
                      .slice(0, 10)}
                    onChange={(event) =>
                      setDateOfBirth(event.target.value)
                    }
                  />
                </div>
              </label>
            </div>
          </div>

          <div className="patient-form-section">
            <div className="patient-form-section-title">
              <Phone size={16} />
              <span>Contact</span>
            </div>

            <div className="form-grid patient-form-grid">
              <label className="wide">
                Phone number

                <input
                  type="tel"
                  value={phone}
                  onChange={(event) =>
                    setPhone(event.target.value)
                  }
                  placeholder="+233 50 123 4567"
                  maxLength={64}
                />

                <small className="field-helper">
                  Ghana numbers may be entered as
                  0501234567 or +233501234567.
                </small>
              </label>
            </div>
          </div>

          {error && (
            <div
              className="patient-modal-error"
              role="alert"
            >
              {error}
            </div>
          )}

          <div className="modal-footer patient-modal-footer">
            <button
              className="button button-ghost"
              type="button"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              className="button button-primary"
              type="submit"
              disabled={saving}
            >
              {saving
                ? 'Registering patient…'
                : 'Register patient'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}