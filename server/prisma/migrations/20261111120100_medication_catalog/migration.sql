-- Phase 19B: the controlled medication catalog that Medical Officers prescribe from, and the link
-- from each new medication order to its catalog entry. Reviewed SQL: the case-insensitive unique
-- name index, checks, triggers and the initial catalog cannot be expressed in the Prisma schema,
-- so never reproduce this with db push.
--
-- Additive only: existing medication orders keep their free-text name and stay valid.

CREATE TABLE "Medication" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Medication_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MedicationOrder" ADD COLUMN "medicationId" UUID,
ADD COLUMN "strength" VARCHAR(100);

CREATE INDEX "Medication_active_name_idx" ON "Medication"("active", "name");
CREATE INDEX "MedicationOrder_medicationId_idx" ON "MedicationOrder"("medicationId");

-- RESTRICT: a medicine that was ever prescribed can never be deleted from the catalog.
ALTER TABLE "MedicationOrder" ADD CONSTRAINT "MedicationOrder_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Names are stored trimmed, with single spaces and no control characters, and are unique ignoring
-- case: "Paracetamol", "paracetamol" and "PARACETAMOL" are the same medicine.
ALTER TABLE "Medication" ADD CONSTRAINT "medication_name_format" CHECK (
  length("name") BETWEEN 1 AND 200 AND "name" = btrim("name") AND "name" NOT LIKE '%  %' AND "name" !~ '[[:cntrl:]]');
CREATE UNIQUE INDEX "medication_name_unique_ci" ON "Medication" (lower("name"));
ALTER TABLE "MedicationOrder" ADD CONSTRAINT "medication_strength_nonempty" CHECK ("strength" IS NULL OR length(btrim("strength")) > 0);

-- A catalog entry keeps its identity and name forever; only "active" changes (deactivate and
-- reactivate). Past orders also keep their own copy of the name, so history never depends on it.
CREATE FUNCTION protect_medication_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" <> OLD."id" OR NEW."name" <> OLD."name" THEN
    RAISE EXCEPTION 'A catalog medication name is permanent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER medication_identity BEFORE UPDATE ON "Medication"
  FOR EACH ROW EXECUTE FUNCTION protect_medication_identity();
CREATE TRIGGER medication_timestamps BEFORE UPDATE ON "Medication"
  FOR EACH ROW EXECUTE FUNCTION maintain_row_timestamps();

-- A new order must name a catalog entry, and "medicine" must be that entry's name: the name as it
-- was when prescribed. Orders written before the catalog existed have no entry; they can still be
-- read, and removed from a draft, but no order can be written without one.
CREATE FUNCTION validate_medication_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE catalog_name varchar;
BEGIN
  IF NEW."medicationId" IS NULL THEN
    RAISE EXCEPTION 'A medication order must name a catalog medication' USING ERRCODE = '23514';
  END IF;
  SELECT "name" INTO catalog_name FROM "Medication" WHERE "id" = NEW."medicationId";
  -- A missing entry is reported by the foreign key.
  IF catalog_name IS NOT NULL AND NEW."medicine" IS DISTINCT FROM catalog_name THEN
    RAISE EXCEPTION 'A medication order keeps its catalog medication name' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER medication_order_catalog BEFORE INSERT OR UPDATE OF "medicationId", "medicine" ON "MedicationOrder"
  FOR EACH ROW EXECUTE FUNCTION validate_medication_order();

-- The initial catalog: the sixteen medicines of the previous Medicare system's drug dropdown, with
-- readable capitalisation, standard spelling of cetirizine and hyoscine butylbromide, and no
-- other changes (see docs/medication-catalog-prescribing.md). Re-running inserts nothing twice.
INSERT INTO "Medication" ("name") VALUES
  ('Antacid (Aluminium hydroxide tab)'),
  ('Liver salt'),
  ('Loperamide'),
  ('ORS'),
  ('Diclofenac'),
  ('Ibuprofen'),
  ('Paracetamol'),
  ('Folic acid'),
  ('Cetirizine'),
  ('Hyoscine butylbromide (Buscolex)'),
  ('Vitamin C tab'),
  ('Multivitamin'),
  ('Salbutamol tab'),
  ('Salbutamol inhaler'),
  ('Oral glucose'),
  ('Mebendazole (dewormer)')
ON CONFLICT ((lower("name"))) DO NOTHING;
