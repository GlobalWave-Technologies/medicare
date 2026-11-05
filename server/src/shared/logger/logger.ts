import { pino, type DestinationStream } from 'pino'
import type { Environment } from '../../config/env.js'

export function createLogger(level: Environment['LOG_LEVEL'], destination?: DestinationStream) {
  const options = {
    level,
    base: { service: 'medicare-api' },
    redact: {
      paths: [
        'report', 'reports', 'dashboard', 'metrics', 'summary', 'series', 'snapshot',
        '*.report', '*.reports', '*.dashboard', '*.metrics', '*.summary', '*.series', '*.snapshot',
        'notification', 'notifications', 'title', 'message', '*.notification', '*.notifications', '*.title', '*.message',
        'encounter', 'encounters', 'complaints', 'diagnoses', 'clinicalNotes', 'historySummary', 'treatmentPlan', 'amendments', 'content', 'description', 'assessment',
        '*.encounter', '*.encounters', '*.complaints', '*.diagnoses', '*.clinicalNotes', '*.historySummary', '*.treatmentPlan', '*.amendments', '*.content', '*.description', '*.assessment',
        'appointment', 'appointments', 'reason', 'notes', 'cancellationReason',
        '*.appointment', '*.appointments', '*.reason', '*.notes', '*.cancellationReason',
        'patient', 'patients', 'firstName', 'middleName', 'lastName', 'dateOfBirth', 'phone', 'email',
        'address', 'residentialAddress', 'emergencyContact', 'search',
        '*.patient', '*.patients', '*.firstName', '*.middleName', '*.lastName', '*.dateOfBirth', '*.phone', '*.email',
        '*.address', '*.residentialAddress', '*.emergencyContact', '*.search',
        'sessionToken', 'tokenHash', 'csrfToken', 'csrfSecret', 'Cookie', 'Authorization', '["Set-Cookie"]', '["set-cookie"]',
        '*.sessionToken', '*.tokenHash', '*.csrfToken', '*.csrfSecret', '*.Cookie', '*.Authorization', '*["Set-Cookie"]', '*["set-cookie"]',
        'req.headers["x-csrf-token"]', 'req.headers["idempotency-key"]', 'req.auth', 'idempotencyKey', '*.idempotencyKey',
        'password', 'token', 'accessToken', 'refreshToken', 'authorization',
        'cookie', 'DATABASE_URL', 'TEST_DATABASE_URL', 'BOOTSTRAP_ADMIN_PASSWORD', 'passwordHash', 'body', 'medicalHistory', 'medicalRecords',
        '*.password', '*.token', '*.accessToken', '*.refreshToken',
        '*.authorization', '*.cookie', '*.DATABASE_URL', '*.TEST_DATABASE_URL', '*.BOOTSTRAP_ADMIN_PASSWORD', '*.passwordHash', '*.body',
        '*.medicalHistory', '*.medicalRecords',
        'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
      ],
      censor: '[REDACTED]',
    },
    // Error messages/stacks can contain SQL, credentials, or patient information.
    serializers: { err: () => ({ type: 'Error', code: 'INTERNAL_ERROR' }) },
  }
  return destination ? pino(options, destination) : pino(options)
}
