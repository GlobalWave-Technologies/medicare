ALTER TYPE "AuditAction" ADD VALUE 'NOTIFICATION_BROADCAST_CREATED';

-- A null targetRole on BROADCAST means ALL active staff. DIRECT has no role audience.
ALTER TABLE "Notification" DROP CONSTRAINT "notification_audience";
ALTER TABLE "Notification" ADD CONSTRAINT "notification_audience"
  CHECK ("type" = 'BROADCAST' OR "targetRole" IS NULL);
ALTER TABLE "Notification" ADD COLUMN "appointmentId" UUID;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Notification" ADD CONSTRAINT "notification_appointment_direct"
  CHECK ("appointmentId" IS NULL OR "type" = 'DIRECT');
CREATE INDEX "Notification_appointmentId_idx" ON "Notification"("appointmentId");
CREATE INDEX "NotificationRecipient_staffUserId_createdAt_id_idx"
  ON "NotificationRecipient"("staffUserId", "createdAt", "id");

CREATE OR REPLACE FUNCTION audit_metadata_is_safe(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(value) <> 'object' THEN RETURN false; END IF;
  IF (value - 'source' - 'changedFields' - 'audience' - 'recipientCount') <> '{}'::jsonb THEN RETURN false; END IF;
  IF NOT (value ? 'source') OR jsonb_typeof(value->'source') <> 'string'
     OR value->>'source' NOT IN ('CLI', 'API', 'SYSTEM') THEN RETURN false; END IF;
  IF value ? 'changedFields' THEN
    IF jsonb_typeof(value->'changedFields') <> 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(value->'changedFields') > 6 THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(value->'changedFields') AS item
      WHERE jsonb_typeof(item) <> 'string' OR item #>> '{}' NOT IN
      ('role', 'status', 'demographics', 'schedule', 'clinicalRecord', 'readAt')) THEN RETURN false; END IF;
  END IF;
  IF (value ? 'audience') <> (value ? 'recipientCount') THEN RETURN false; END IF;
  IF value ? 'audience' THEN
    IF jsonb_typeof(value->'audience') <> 'string' OR value->>'audience' NOT IN ('ALL', 'ROLE') THEN RETURN false; END IF;
    IF jsonb_typeof(value->'recipientCount') <> 'number' THEN RETURN false; END IF;
    IF (value->>'recipientCount')::numeric NOT BETWEEN 1 AND 10000
      OR trunc((value->>'recipientCount')::numeric) <> (value->>'recipientCount')::numeric THEN RETURN false; END IF;
  END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION reject_notification_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Notification history is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER notification_immutable BEFORE UPDATE OR DELETE ON "Notification"
  FOR EACH ROW EXECUTE FUNCTION reject_notification_mutation();
CREATE TRIGGER notification_no_truncate BEFORE TRUNCATE ON "Notification"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_notification_mutation();

CREATE FUNCTION protect_notification_recipient() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."notificationId" IS DISTINCT FROM OLD."notificationId"
    OR NEW."staffUserId" IS DISTINCT FROM OLD."staffUserId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR (OLD."readAt" IS NOT NULL AND NEW."readAt" IS DISTINCT FROM OLD."readAt") THEN
    RAISE EXCEPTION 'Notification delivery identity and first read time are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER notification_recipient_read_once BEFORE UPDATE ON "NotificationRecipient"
  FOR EACH ROW EXECUTE FUNCTION protect_notification_recipient();
CREATE TRIGGER notification_recipient_no_delete BEFORE DELETE ON "NotificationRecipient"
  FOR EACH ROW EXECUTE FUNCTION reject_notification_mutation();
CREATE TRIGGER notification_recipient_no_truncate BEFORE TRUNCATE ON "NotificationRecipient"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_notification_mutation();
