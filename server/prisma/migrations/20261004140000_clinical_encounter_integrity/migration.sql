ALTER TYPE "AuditAction" ADD VALUE 'MEDICAL_RECORD_FINALIZED';
ALTER TYPE "AuditAction" ADD VALUE 'MEDICAL_RECORD_AMENDED';
ALTER TYPE "AuditAction" ADD VALUE 'MEDICAL_HISTORY_VIEWED';

-- REVIEWED/reviewedAt already represent finalization. The existing composite
-- unique key plus FK already permits only one encounter per non-null appointment.
CREATE TABLE "EncounterAmendment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "encounterId" UUID NOT NULL,
  "authorId" UUID NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EncounterAmendment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EncounterAmendment_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "EncounterAmendment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "amendment_nonempty" CHECK (length(btrim("reason")) > 0 AND length(btrim("content")) BETWEEN 1 AND 20000)
);
CREATE INDEX "EncounterAmendment_encounterId_createdAt_idx" ON "EncounterAmendment"("encounterId", "createdAt");
CREATE INDEX "EncounterAmendment_authorId_createdAt_idx" ON "EncounterAmendment"("authorId", "createdAt");

CREATE FUNCTION reject_clinical_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Clinical history is immutable' USING ERRCODE = '23514';
END;
$$;

CREATE FUNCTION protect_finalized_encounter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Clinical history is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER encounter_finalized_immutable BEFORE UPDATE OR DELETE ON "Encounter"
  FOR EACH ROW EXECUTE FUNCTION protect_finalized_encounter();
CREATE TRIGGER encounter_no_truncate BEFORE TRUNCATE ON "Encounter"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_mutation();

-- Parent locking serializes child changes with finalization, including direct
-- SQL. Missing parents are left to the existing restrictive foreign keys.
CREATE FUNCTION protect_encounter_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; parent_status "EncounterStatus";
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."encounterId" IS DISTINCT FROM OLD."encounterId" THEN
    RAISE EXCEPTION 'Clinical child identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN parent_id := OLD."encounterId"; ELSE parent_id := NEW."encounterId"; END IF;
  SELECT "status" INTO parent_status FROM "Encounter" WHERE id = parent_id FOR UPDATE;
  IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Clinical history is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER complaint_draft_only BEFORE INSERT OR UPDATE OR DELETE ON "EncounterComplaint"
  FOR EACH ROW EXECUTE FUNCTION protect_encounter_child();
CREATE TRIGGER diagnosis_draft_only BEFORE INSERT OR UPDATE OR DELETE ON "Diagnosis"
  FOR EACH ROW EXECUTE FUNCTION protect_encounter_child();
CREATE TRIGGER complaint_no_truncate BEFORE TRUNCATE ON "EncounterComplaint"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_mutation();
CREATE TRIGGER diagnosis_no_truncate BEFORE TRUNCATE ON "Diagnosis"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_mutation();

CREATE FUNCTION validate_encounter_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status "EncounterStatus"; clinician uuid; creator uuid;
BEGIN
  SELECT "status", "clinicianId", "createdById" INTO parent_status, clinician, creator
    FROM "Encounter" WHERE id = NEW."encounterId" FOR UPDATE;
  IF parent_status IS NOT NULL AND (parent_status <> 'REVIEWED'
      OR clinician IS DISTINCT FROM NEW."authorId" OR creator IS DISTINCT FROM NEW."authorId") THEN
    RAISE EXCEPTION 'Invalid clinical amendment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER amendment_valid_parent BEFORE INSERT ON "EncounterAmendment"
  FOR EACH ROW EXECUTE FUNCTION validate_encounter_amendment();
CREATE TRIGGER amendment_append_only BEFORE UPDATE OR DELETE ON "EncounterAmendment"
  FOR EACH ROW EXECUTE FUNCTION reject_clinical_history_mutation();
CREATE TRIGGER amendment_no_truncate BEFORE TRUNCATE ON "EncounterAmendment"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_history_mutation();
