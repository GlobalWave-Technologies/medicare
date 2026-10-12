import { Writable } from 'node:stream'
import { expect, it } from 'vitest'
import { createLogger } from '../src/shared/logger/logger.js'

it('redacts common secret fields and strips error messages/stacks', () => {
  let output = ''
  const logger = createLogger('info', new Writable({
    write(chunk: Buffer, _encoding, callback) { output += chunk.toString(); callback() },
  }))
  logger.info({
    report: 'report-secret', reports: 'reports-secret', dashboard: 'dashboard-secret', metrics: 'metrics-secret',
    summary: 'summary-secret', series: 'series-secret', snapshot: 'snapshot-secret',
    payload: { report: 'nested-report-secret', metrics: 'nested-metrics-secret', series: 'nested-series-secret' },
    password: 'password-secret', DATABASE_URL: 'database-secret',
    title: 'notice-title-secret', message: 'notice-message-secret', notification: { value: 'notice-payload-secret' },
    delivery: { title: 'nested-title-secret', message: 'nested-message-secret' },
    clinicalNotes: 'clinical-note-secret', historySummary: 'history-summary-secret', treatmentPlan: 'treatment-plan-secret',
    complaints: [{ description: 'complaint-secret' }], diagnoses: [{ code: 'diagnosis-secret' }],
    amendments: [{ content: 'amendment-secret' }], clinical: { content: 'clinical-content-secret', assessment: 'assessment-secret' },
    reason: 'appointment-reason-secret', notes: 'appointment-notes-secret', cancellationReason: 'cancellation-secret',
    appointment: { reason: 'appointment-payload-secret' }, scheduling: { notes: 'nested-appointment-secret' },
    firstName: 'patient-name-secret', dateOfBirth: 'dob-secret', phone: 'phone-secret', email: 'email-secret',
    demographics: { residentialAddress: 'address-secret', emergencyContact: 'contact-secret' },
    search: 'search-secret', patient: { clinicalNotes: 'patient-payload-secret' },
    sessionToken: 'session-secret', tokenHash: 'session-hash-secret', csrfToken: 'csrf-secret',
    Cookie: 'uppercase-cookie-secret', Authorization: 'uppercase-auth-secret', 'Set-Cookie': 'uppercase-set-cookie-secret',
    BOOTSTRAP_ADMIN_PASSWORD: 'bootstrap-secret', passwordHash: 'hash-secret', TEST_DATABASE_URL: 'test-db-secret',
    user: { token: 'token-secret', medicalHistory: 'medical-secret', csrfSecret: 'nested-csrf-secret', sessionToken: 'nested-session-secret' },
    req: { headers: { authorization: 'auth-secret', cookie: 'cookie-secret' }, body: { value: 'body-secret' } },
    res: { headers: { 'set-cookie': 'set-cookie-secret' } },
    err: new Error('internal-secret'),
  }, 'Redaction check')
  expect(output).toContain('[REDACTED]')
  expect(output).not.toMatch(/report-secret|reports-secret|dashboard-secret|metrics-secret|summary-secret|series-secret|snapshot-secret/)
  expect(output).not.toMatch(/notice-title-secret|notice-message-secret|notice-payload-secret|nested-title-secret|nested-message-secret/)
  expect(output).not.toMatch(/clinical-note-secret|history-summary-secret|treatment-plan-secret|complaint-secret|diagnosis-secret|amendment-secret|clinical-content-secret|assessment-secret/)
  expect(output).not.toMatch(/appointment-reason-secret|appointment-notes-secret|cancellation-secret|appointment-payload-secret|nested-appointment-secret/)
  expect(output).not.toMatch(/patient-name-secret|dob-secret|phone-secret|email-secret|address-secret|contact-secret|search-secret|patient-payload-secret/)
  expect(output).not.toMatch(/session-secret|session-hash-secret|csrf-secret|uppercase-cookie-secret|uppercase-auth-secret|uppercase-set-cookie-secret|nested-session-secret/)
  expect(output).not.toMatch(/password-secret|database-secret|token-secret|medical-secret|auth-secret|cookie-secret|body-secret|internal-secret|bootstrap-secret|hash-secret|test-db-secret/)
  expect(JSON.parse(output).err).toEqual({ type: 'Error', code: 'INTERNAL_ERROR' })
})
