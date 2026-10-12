-- Required for UUID equality combined with timestamp-range GiST exclusion.
-- Existing overlaps must be reviewed before deployment; never silently discard history.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "appointment_clinician_no_overlap" EXCLUDE USING gist (
    "clinicianId" WITH =,
    tstzrange("scheduledStart", "scheduledEnd", '[)') WITH &&
  ) WHERE ("status" IN ('SCHEDULED', 'CONFIRMED', 'CHECKED_IN')),
  ADD CONSTRAINT "appointment_patient_no_overlap" EXCLUDE USING gist (
    "patientId" WITH =,
    tstzrange("scheduledStart", "scheduledEnd", '[)') WITH &&
  ) WHERE ("status" IN ('SCHEDULED', 'CONFIRMED', 'CHECKED_IN'));

ALTER TYPE "AuditAction" ADD VALUE 'APPOINTMENT_VIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'APPOINTMENT_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'APPOINTMENT_CANCELLED';
