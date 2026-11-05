-- A staff-creation retry record links to the account it created. The table holds only
-- 24 hours of short retry records, so the column, index and constraint swap are brief.
ALTER TABLE "IdempotencyRecord" ADD COLUMN "staffUserId" UUID;

CREATE UNIQUE INDEX "IdempotencyRecord_staffUserId_key" ON "IdempotencyRecord"("staffUserId");

ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Exactly the resource type created by the operation is referenced, now including staff accounts.
ALTER TABLE "IdempotencyRecord" DROP CONSTRAINT "idempotency_record_resource";
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "idempotency_record_resource" CHECK (
  ("operation" = 'PATIENT_CREATE' AND "patientId" IS NOT NULL AND "encounterId" IS NULL AND "notificationId" IS NULL AND "staffUserId" IS NULL)
  OR ("operation" = 'ENCOUNTER_CREATE' AND "encounterId" IS NOT NULL AND "patientId" IS NULL AND "notificationId" IS NULL AND "staffUserId" IS NULL)
  OR ("operation" = 'NOTIFICATION_BROADCAST' AND "notificationId" IS NOT NULL AND "patientId" IS NULL AND "encounterId" IS NULL AND "staffUserId" IS NULL)
  OR ("operation" = 'STAFF_CREATE' AND "staffUserId" IS NOT NULL AND "patientId" IS NULL AND "encounterId" IS NULL AND "notificationId" IS NULL));
