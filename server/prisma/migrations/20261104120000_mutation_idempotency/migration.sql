-- CreateEnum
CREATE TYPE "IdempotentOperation" AS ENUM ('PATIENT_CREATE', 'ENCOUNTER_CREATE', 'NOTIFICATION_BROADCAST');

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "principalId" UUID NOT NULL,
    "operation" "IdempotentOperation" NOT NULL,
    "keyHash" CHAR(64) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "patientId" UUID,
    "encounterId" UUID,
    "notificationId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_patientId_key" ON "IdempotencyRecord"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_encounterId_key" ON "IdempotencyRecord"("encounterId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_notificationId_key" ON "IdempotencyRecord"("notificationId");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_principalId_operation_keyHash_key" ON "IdempotencyRecord"("principalId", "operation", "keyHash");

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Only hex SHA-256/HMAC digests are stored; never a raw key or request content.
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "idempotency_record_digests"
  CHECK ("keyHash" ~ '^[0-9a-f]{64}$' AND "requestHash" ~ '^[0-9a-f]{64}$');
-- Exactly the resource type created by the operation is referenced.
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "idempotency_record_resource" CHECK (
  ("operation" = 'PATIENT_CREATE' AND "patientId" IS NOT NULL AND "encounterId" IS NULL AND "notificationId" IS NULL)
  OR ("operation" = 'ENCOUNTER_CREATE' AND "encounterId" IS NOT NULL AND "patientId" IS NULL AND "notificationId" IS NULL)
  OR ("operation" = 'NOTIFICATION_BROADCAST' AND "notificationId" IS NOT NULL AND "patientId" IS NULL AND "encounterId" IS NULL));
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "idempotency_record_window"
  CHECK ("expiresAt" > "createdAt");

-- Records are written once with their resource; expiry removes them, nothing edits them.
CREATE FUNCTION reject_idempotency_record_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Idempotency records are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER idempotency_record_immutable BEFORE UPDATE ON "IdempotencyRecord"
  FOR EACH ROW EXECUTE FUNCTION reject_idempotency_record_update();
