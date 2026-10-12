-- Database guarantees not expressible in the Prisma schema. Keep these in
-- reviewed migrations; db push cannot reproduce them.
ALTER TABLE "StaffUser"
  ADD CONSTRAINT "staff_email_canonical" CHECK ("email" = lower(btrim("email")) AND "email" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  ADD CONSTRAINT "staff_number_format" CHECK ("staffNumber" ~ '^STF-[A-Z0-9]{6,32}$'),
  ADD CONSTRAINT "staff_names_nonempty" CHECK (length(btrim("firstName")) > 0 AND length(btrim("lastName")) > 0),
  ADD CONSTRAINT "staff_password_hash" CHECK ("passwordHash" IS NULL OR left("passwordHash", 10) = '$argon2id$'),
  ADD CONSTRAINT "staff_password_timestamp" CHECK (("passwordHash" IS NULL) = ("passwordChangedAt" IS NULL)),
  ADD CONSTRAINT "active_staff_credentials" CHECK ("status" <> 'ACTIVE' OR "passwordHash" IS NOT NULL);

ALTER TABLE "Patient"
  ADD CONSTRAINT "patient_number_format" CHECK ("patientNumber" ~ '^PT-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$'),
  ADD CONSTRAINT "patient_names_nonempty" CHECK (length(btrim("firstName")) > 0 AND length(btrim("lastName")) > 0),
  ADD CONSTRAINT "patient_birth_not_future" CHECK ("dateOfBirth" IS NULL OR "dateOfBirth" <= ("createdAt" AT TIME ZONE 'UTC')::date);

ALTER TABLE "Appointment"
  ADD CONSTRAINT "appointment_reference_format" CHECK ("reference" ~ '^AP-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$'),
  ADD CONSTRAINT "appointment_time_order" CHECK ("scheduledEnd" > "scheduledStart"),
  ADD CONSTRAINT "appointment_cancellation_metadata" CHECK (
    ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL)
    OR ("status" <> 'CANCELLED' AND "cancelledAt" IS NULL AND "cancelledById" IS NULL AND "cancellationReason" IS NULL)
  );

ALTER TABLE "Encounter"
  ADD CONSTRAINT "encounter_reference_format" CHECK ("reference" ~ '^MR-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$'),
  ADD CONSTRAINT "encounter_review_metadata" CHECK (
    ("status" <> 'REVIEWED' OR ("clinicianId" IS NOT NULL AND "reviewedAt" IS NOT NULL))
    AND ("status" <> 'DRAFT' OR "reviewedAt" IS NULL)
    AND ("reviewedAt" IS NULL OR "reviewedAt" >= "occurredAt")
  ),
  ADD CONSTRAINT "encounter_void_metadata" CHECK (
    ("status" = 'VOIDED' AND "voidedAt" IS NOT NULL AND "voidReason" IS NOT NULL AND length(btrim("voidReason")) > 0)
    OR ("status" <> 'VOIDED' AND "voidedAt" IS NULL AND "voidReason" IS NULL)
  ),
  ADD CONSTRAINT "encounter_follow_up_order" CHECK ("followUpAt" IS NULL OR "followUpAt" >= "occurredAt");

ALTER TABLE "EncounterComplaint" ADD CONSTRAINT "complaint_nonempty" CHECK ("description" = btrim("description") AND length("description") > 0);
ALTER TABLE "Diagnosis" ADD CONSTRAINT "diagnosis_nonempty" CHECK (length(btrim("description")) > 0);
ALTER TABLE "Notification"
  ADD CONSTRAINT "notification_nonempty" CHECK (length(btrim("title")) > 0 AND length(btrim("message")) > 0),
  ADD CONSTRAINT "notification_audience" CHECK (("type" = 'BROADCAST') = ("targetRole" IS NOT NULL));
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "notification_read_order" CHECK ("readAt" IS NULL OR "readAt" >= "createdAt");

-- Audit metadata holds classifications/field names, never field values.
CREATE UNIQUE INDEX "single_admin_bootstrap" ON "AuditEvent" ("action") WHERE "action" = 'ADMIN_BOOTSTRAPPED';
CREATE FUNCTION audit_metadata_is_safe(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(value) <> 'object' THEN RETURN false; END IF;
  IF (value - 'source' - 'changedFields') <> '{}'::jsonb THEN RETURN false; END IF;
  IF NOT (value ? 'source') OR jsonb_typeof(value->'source') <> 'string'
     OR value->>'source' NOT IN ('CLI', 'API', 'SYSTEM') THEN RETURN false; END IF;
  IF value ? 'changedFields' THEN
    IF jsonb_typeof(value->'changedFields') <> 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(value->'changedFields') > 6 THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(value->'changedFields') AS item
      WHERE jsonb_typeof(item) <> 'string' OR item #>> '{}' NOT IN
      ('role', 'status', 'demographics', 'schedule', 'clinicalRecord', 'readAt')) THEN RETURN false; END IF;
  END IF;
  RETURN true;
END;
$$;
ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "audit_metadata_allowlist" CHECK (audit_metadata_is_safe("metadata")),
  ADD CONSTRAINT "audit_request_id_format" CHECK ("requestId" IS NULL OR "requestId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$');

CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER audit_no_update_delete BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

-- Consistent behavior for both Prisma and direct SQL maintenance tools.
CREATE FUNCTION maintain_row_timestamps() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'createdAt is immutable' USING ERRCODE = '23514';
  END IF;
  NEW."updatedAt" = clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER staff_timestamps BEFORE UPDATE ON "StaffUser" FOR EACH ROW EXECUTE FUNCTION maintain_row_timestamps();
CREATE TRIGGER patient_timestamps BEFORE UPDATE ON "Patient" FOR EACH ROW EXECUTE FUNCTION maintain_row_timestamps();
CREATE TRIGGER appointment_timestamps BEFORE UPDATE ON "Appointment" FOR EACH ROW EXECUTE FUNCTION maintain_row_timestamps();
CREATE TRIGGER encounter_timestamps BEFORE UPDATE ON "Encounter" FOR EACH ROW EXECUTE FUNCTION maintain_row_timestamps();
CREATE TRIGGER diagnosis_timestamps BEFORE UPDATE ON "Diagnosis" FOR EACH ROW EXECUTE FUNCTION maintain_row_timestamps();
