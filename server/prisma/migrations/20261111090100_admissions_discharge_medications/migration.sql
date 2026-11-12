-- Phase 19A: admissions with room history and discharge, admission-linked clinical records and
-- medication orders. Reviewed SQL: the sequence, exclusion constraint, partial unique indexes and
-- triggers cannot be expressed in the Prisma schema, so never reproduce this with db push.
--
-- Additive only: no existing table is rewritten or dropped. Appointment rows stay as read-only
-- history (the runtime grants no longer allow writing them).

CREATE TYPE "AdmissionStatus" AS ENUM ('ADMITTED', 'DISCHARGED');

-- Human-readable admission numbers: AD-000001, AD-000002, ... (wider after AD-999999). A
-- rolled-back admission leaves a gap in the sequence; numbers are never reused.
CREATE SEQUENCE "admission_number_seq" AS bigint MINVALUE 1 START 1 NO CYCLE;
CREATE FUNCTION next_admission_number() RETURNS varchar LANGUAGE plpgsql VOLATILE AS $$
DECLARE n bigint := nextval('admission_number_seq');
BEGIN
  RETURN 'AD-' || lpad(n::text, greatest(6, length(n::text)), '0');
END;
$$;

ALTER TABLE "Encounter" ADD COLUMN "admissionId" UUID;
ALTER TABLE "IdempotencyRecord" ADD COLUMN "admissionId" UUID;

CREATE TABLE "MedicationOrder" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "encounterId" UUID NOT NULL,
    "medicine" VARCHAR(200) NOT NULL,
    "dose" VARCHAR(100),
    "route" VARCHAR(50),
    "frequency" VARCHAR(100),
    "duration" VARCHAR(100),
    "notes" VARCHAR(2000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Admission" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admissionNumber" VARCHAR(24) NOT NULL DEFAULT next_admission_number(),
    "patientId" UUID NOT NULL,
    "roomNumber" VARCHAR(100) NOT NULL,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'ADMITTED',
    "admittedAt" TIMESTAMPTZ(3) NOT NULL,
    "admittedById" UUID NOT NULL,
    "dischargedAt" TIMESTAMPTZ(3),
    "dischargedById" UUID,
    "dischargeNotes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Admission_pkey" PRIMARY KEY ("id")
);
ALTER SEQUENCE "admission_number_seq" OWNED BY "Admission"."admissionNumber";

CREATE TABLE "AdmissionRoomHistory" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admissionId" UUID NOT NULL,
    "roomNumber" VARCHAR(100) NOT NULL,
    "note" VARCHAR(500),
    "assignedAt" TIMESTAMPTZ(3) NOT NULL,
    "assignedById" UUID NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionRoomHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MedicationOrder_encounterId_idx" ON "MedicationOrder"("encounterId");
CREATE UNIQUE INDEX "Admission_admissionNumber_key" ON "Admission"("admissionNumber");
CREATE INDEX "Admission_patientId_admittedAt_idx" ON "Admission"("patientId", "admittedAt");
CREATE INDEX "Admission_status_admittedAt_idx" ON "Admission"("status", "admittedAt");
CREATE INDEX "Admission_dischargedAt_idx" ON "Admission"("dischargedAt");
CREATE INDEX "Admission_admittedById_idx" ON "Admission"("admittedById");
CREATE INDEX "Admission_dischargedById_idx" ON "Admission"("dischargedById");
CREATE UNIQUE INDEX "Admission_id_patientId_key" ON "Admission"("id", "patientId");
CREATE INDEX "AdmissionRoomHistory_admissionId_assignedAt_idx" ON "AdmissionRoomHistory"("admissionId", "assignedAt");
CREATE INDEX "AdmissionRoomHistory_assignedById_idx" ON "AdmissionRoomHistory"("assignedById");
CREATE INDEX "Encounter_admissionId_occurredAt_idx" ON "Encounter"("admissionId", "occurredAt");
CREATE UNIQUE INDEX "IdempotencyRecord_admissionId_key" ON "IdempotencyRecord"("admissionId");

-- The composite key keeps a clinical record on an admission of its own patient.
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_admissionId_patientId_fkey" FOREIGN KEY ("admissionId", "patientId") REFERENCES "Admission"("id", "patientId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "MedicationOrder" ADD CONSTRAINT "MedicationOrder_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_admittedById_fkey" FOREIGN KEY ("admittedById") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_dischargedById_fkey" FOREIGN KEY ("dischargedById") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AdmissionRoomHistory" ADD CONSTRAINT "AdmissionRoomHistory_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AdmissionRoomHistory" ADD CONSTRAINT "AdmissionRoomHistory_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Admission facts. A stay is admitted or discharged; discharge metadata exists exactly when
-- discharged, and discharge follows admission.
ALTER TABLE "Admission"
  ADD CONSTRAINT "admission_number_format" CHECK ("admissionNumber" ~ '^AD-[0-9]{6,20}$'),
  ADD CONSTRAINT "admission_room_nonempty" CHECK ("roomNumber" = btrim("roomNumber") AND length("roomNumber") > 0),
  ADD CONSTRAINT "admission_discharge_metadata" CHECK (
    ("status" = 'ADMITTED' AND "dischargedAt" IS NULL AND "dischargedById" IS NULL AND "dischargeNotes" IS NULL)
    OR ("status" = 'DISCHARGED' AND "dischargedAt" IS NOT NULL AND "dischargedById" IS NOT NULL)),
  ADD CONSTRAINT "admission_discharge_order" CHECK ("dischargedAt" IS NULL OR "dischargedAt" > "admittedAt"),
  ADD CONSTRAINT "admission_discharge_notes" CHECK ("dischargeNotes" IS NULL OR (length(btrim("dischargeNotes")) > 0 AND length("dischargeNotes") <= 5000)),
  -- One patient's stays never overlap. An open stay runs to infinity, so a second open stay
  -- (or a back-dated one overlapping an earlier stay) is refused even if the API is bypassed.
  ADD CONSTRAINT "admission_patient_no_overlap" EXCLUDE USING gist (
    "patientId" WITH =, tstzrange("admittedAt", "dischargedAt", '[)') WITH &&);
-- At most one current admission per patient, with a clear unique violation for the API.
CREATE UNIQUE INDEX "admission_one_current_per_patient" ON "Admission" ("patientId") WHERE "status" = 'ADMITTED';

ALTER TABLE "AdmissionRoomHistory"
  ADD CONSTRAINT "admission_room_history_room" CHECK ("roomNumber" = btrim("roomNumber") AND length("roomNumber") > 0),
  ADD CONSTRAINT "admission_room_history_note" CHECK ("note" IS NULL OR length(btrim("note")) > 0),
  ADD CONSTRAINT "admission_room_history_order" CHECK ("endedAt" IS NULL OR "endedAt" >= "assignedAt");
-- Exactly one room is open per admission at any time (checked fully at commit, below).
CREATE UNIQUE INDEX "admission_room_one_open" ON "AdmissionRoomHistory" ("admissionId") WHERE "endedAt" IS NULL;

ALTER TABLE "MedicationOrder" ADD CONSTRAINT "medication_nonempty" CHECK (length(btrim("medicine")) > 0);

CREATE FUNCTION reject_admission_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Admission history is permanent' USING ERRCODE = '23514';
END;
$$;

-- A new stay starts admitted, for a patient whose record is not archived.
CREATE FUNCTION validate_new_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE archived timestamptz;
BEGIN
  IF NEW."status" <> 'ADMITTED' THEN
    RAISE EXCEPTION 'A new admission starts as admitted' USING ERRCODE = '23514';
  END IF;
  SELECT "archivedAt" INTO archived FROM "Patient" WHERE id = NEW."patientId" FOR SHARE;
  IF FOUND AND archived IS NOT NULL THEN
    RAISE EXCEPTION 'An archived patient cannot be admitted' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER admission_valid_insert BEFORE INSERT ON "Admission"
  FOR EACH ROW EXECUTE FUNCTION validate_new_admission();

-- Identity and admission facts never change. While admitted, only the current room and the
-- one-way discharge can be written; a discharged stay is permanent; nothing is ever deleted.
-- Discharge is refused while the stay has an unfinished (draft) clinical record.
CREATE FUNCTION protect_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Admission history is permanent' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'DISCHARGED' THEN
    RAISE EXCEPTION 'A discharged admission is permanent' USING ERRCODE = '23514';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."admissionNumber" IS DISTINCT FROM OLD."admissionNumber"
     OR NEW."patientId" IS DISTINCT FROM OLD."patientId" OR NEW."admittedAt" IS DISTINCT FROM OLD."admittedAt"
     OR NEW."admittedById" IS DISTINCT FROM OLD."admittedById" THEN
    RAISE EXCEPTION 'Admission identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" = 'DISCHARGED' THEN
    IF NEW."roomNumber" IS DISTINCT FROM OLD."roomNumber" THEN
      RAISE EXCEPTION 'The room cannot change at discharge' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM "Encounter" WHERE "admissionId" = NEW."id" AND "status" = 'DRAFT') THEN
      RAISE EXCEPTION 'Admission has an unfinished clinical record' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER admission_lifecycle BEFORE UPDATE OR DELETE ON "Admission"
  FOR EACH ROW EXECUTE FUNCTION protect_admission();
CREATE TRIGGER admission_no_truncate BEFORE TRUNCATE ON "Admission"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_admission_history_mutation();
CREATE TRIGGER admission_timestamps BEFORE UPDATE ON "Admission"
  FOR EACH ROW EXECUTE FUNCTION maintain_row_timestamps();

-- Room history is append-only. The single permitted change closes the open assignment once.
-- New assignments are made only on a current admission.
CREATE FUNCTION protect_admission_room() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status "AdmissionStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Admission history is permanent' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."endedAt" IS NOT NULL OR NEW."endedAt" IS NULL
       OR NEW."id" IS DISTINCT FROM OLD."id" OR NEW."admissionId" IS DISTINCT FROM OLD."admissionId"
       OR NEW."roomNumber" IS DISTINCT FROM OLD."roomNumber" OR NEW."note" IS DISTINCT FROM OLD."note"
       OR NEW."assignedAt" IS DISTINCT FROM OLD."assignedAt" OR NEW."assignedById" IS DISTINCT FROM OLD."assignedById"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'Admission room history is permanent' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT "status" INTO parent_status FROM "Admission" WHERE id = NEW."admissionId" FOR SHARE;
  IF parent_status IS NOT NULL AND parent_status <> 'ADMITTED' THEN
    RAISE EXCEPTION 'Rooms can only be assigned on a current admission' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER admission_room_append_only BEFORE INSERT OR UPDATE OR DELETE ON "AdmissionRoomHistory"
  FOR EACH ROW EXECUTE FUNCTION protect_admission_room();
CREATE TRIGGER admission_room_no_truncate BEFORE TRUNCATE ON "AdmissionRoomHistory"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_admission_history_mutation();

-- Checked at commit, after all of a transaction's writes: an admitted stay has exactly one open
-- room assignment, matching its current room; a discharged stay has none.
CREATE FUNCTION check_admission_rooms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; current_status "AdmissionStatus"; current_room varchar; open_count integer; matching integer;
BEGIN
  IF TG_TABLE_NAME = 'Admission' THEN target := NEW."id"; ELSE target := NEW."admissionId"; END IF;
  SELECT "status", "roomNumber" INTO current_status, current_room FROM "Admission" WHERE id = target;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*), count(*) FILTER (WHERE "roomNumber" = current_room) INTO open_count, matching
    FROM "AdmissionRoomHistory" WHERE "admissionId" = target AND "endedAt" IS NULL;
  IF (current_status = 'ADMITTED' AND (open_count <> 1 OR matching <> 1))
     OR (current_status = 'DISCHARGED' AND open_count <> 0) THEN
    RAISE EXCEPTION 'Admission room history is inconsistent' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER admission_rooms_consistent AFTER INSERT OR UPDATE ON "Admission"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_admission_rooms();
CREATE CONSTRAINT TRIGGER admission_room_history_consistent AFTER INSERT OR UPDATE ON "AdmissionRoomHistory"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_admission_rooms();

-- A currently admitted patient's record cannot be archived; discharge comes first.
CREATE FUNCTION protect_admitted_patient() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."archivedAt" IS NOT NULL AND OLD."archivedAt" IS NULL
     AND EXISTS (SELECT 1 FROM "Admission" WHERE "patientId" = NEW."id" AND "status" = 'ADMITTED') THEN
    RAISE EXCEPTION 'A currently admitted patient cannot be archived' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER patient_archive_requires_discharge BEFORE UPDATE OF "archivedAt" ON "Patient"
  FOR EACH ROW EXECUTE FUNCTION protect_admitted_patient();

-- New clinical records may only be opened on a current admission, and a record's admission
-- never changes. The share lock makes a concurrent discharge wait for this record, then see it.
-- Records made before admissions existed keep a null admission and are left as they are.
CREATE FUNCTION validate_encounter_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status "AdmissionStatus";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."admissionId" IS DISTINCT FROM OLD."admissionId" THEN
      RAISE EXCEPTION 'A clinical record''s admission is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."admissionId" IS NOT NULL THEN
    SELECT "status" INTO parent_status FROM "Admission" WHERE id = NEW."admissionId" FOR SHARE;
    IF parent_status IS NOT NULL AND parent_status <> 'ADMITTED' THEN
      RAISE EXCEPTION 'Clinical records can only be opened on a current admission' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER encounter_admission_current BEFORE INSERT OR UPDATE OF "admissionId" ON "Encounter"
  FOR EACH ROW EXECUTE FUNCTION validate_encounter_admission();

-- Medication orders follow the draft-only rule of complaints and diagnoses.
CREATE TRIGGER medication_draft_only BEFORE INSERT OR UPDATE OR DELETE ON "MedicationOrder"
  FOR EACH ROW EXECUTE FUNCTION protect_encounter_child();
CREATE TRIGGER medication_no_truncate BEFORE TRUNCATE ON "MedicationOrder"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_mutation();

-- Audit metadata may now name 'medications' as a changed field (classification only, never values).
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
      ('role', 'status', 'demographics', 'schedule', 'clinicalRecord', 'readAt', 'medications')) THEN RETURN false; END IF;
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

-- A retry record for an admission links to the admission it created, and to nothing else.
ALTER TABLE "IdempotencyRecord" DROP CONSTRAINT "idempotency_record_resource";
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "idempotency_record_resource" CHECK (
  ("operation" = 'PATIENT_CREATE' AND "patientId" IS NOT NULL AND "encounterId" IS NULL AND "notificationId" IS NULL AND "staffUserId" IS NULL AND "admissionId" IS NULL)
  OR ("operation" = 'ENCOUNTER_CREATE' AND "encounterId" IS NOT NULL AND "patientId" IS NULL AND "notificationId" IS NULL AND "staffUserId" IS NULL AND "admissionId" IS NULL)
  OR ("operation" = 'NOTIFICATION_BROADCAST' AND "notificationId" IS NOT NULL AND "patientId" IS NULL AND "encounterId" IS NULL AND "staffUserId" IS NULL AND "admissionId" IS NULL)
  OR ("operation" = 'STAFF_CREATE' AND "staffUserId" IS NOT NULL AND "patientId" IS NULL AND "encounterId" IS NULL AND "notificationId" IS NULL AND "admissionId" IS NULL)
  OR ("operation" = 'ADMISSION_CREATE' AND "admissionId" IS NOT NULL AND "patientId" IS NULL AND "encounterId" IS NULL AND "notificationId" IS NULL AND "staffUserId" IS NULL));
