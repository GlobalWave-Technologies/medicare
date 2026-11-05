-- Medicare application runtime role: the exact privileges the API and its maintenance commands use.
--
-- Run as the migration/owner identity after every `prisma migrate deploy` (grants on new tables
-- are not automatic). It is safe to rerun: it revokes everything first, then grants again.
--
--   psql -v ON_ERROR_STOP=1 -v runtime_role=medicare_runtime -f server/ops/runtime-grants.sql "<owner connection>"
--
-- Create the role once beforehand, with its password from the deployment secret store:
--   CREATE ROLE medicare_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
--
-- The script stops without changing anything if the runtime role could bypass the clinical and
-- audit immutability triggers: a superuser, a role with CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS,
-- the identity running this script, an owner of schema objects, or a member of the owner role.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL medicare.runtime_role = :'runtime_role';
DO $$
DECLARE
  runtime text := current_setting('medicare.runtime_role');
  owner_role text := (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = '"AuditEvent"'::regclass);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime) THEN
    RAISE EXCEPTION 'Runtime role % does not exist', runtime;
  END IF;
  IF runtime = current_user OR runtime = session_user THEN
    RAISE EXCEPTION 'Run this script as the migration owner, not as the runtime role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime
      AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    RAISE EXCEPTION 'Runtime role % must not be a superuser or hold CREATEROLE, CREATEDB, REPLICATION or BYPASSRLS', runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = runtime)
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = runtime)
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public' AND pg_get_userbyid(nspowner) = runtime) THEN
    RAISE EXCEPTION 'Runtime role % owns schema objects; an owner can disable the immutability triggers', runtime;
  END IF;
  IF pg_has_role(runtime, owner_role, 'MEMBER') THEN
    RAISE EXCEPTION 'Runtime role % is a member of the table owner role %', runtime, owner_role;
  END IF;
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM :"runtime_role";
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"runtime_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM :"runtime_role";
GRANT USAGE ON SCHEMA public TO :"runtime_role";

-- Read access to every application table. The migration history (_prisma_migrations) stays private.
GRANT SELECT ON "StaffUser", "StaffSession", "Patient", "Appointment", "Encounter", "EncounterComplaint",
  "Diagnosis", "EncounterAmendment", "Notification", "NotificationRecipient", "AuditEvent", "IdempotencyRecord"
  TO :"runtime_role";

-- Rows the application edits: accounts and sessions, demographics, schedules, draft encounters
-- (finalized ones are refused by trigger) and notification read state (set once, by trigger).
GRANT INSERT, UPDATE ON "StaffUser", "StaffSession", "Patient", "Appointment", "Encounter", "NotificationRecipient"
  TO :"runtime_role";

-- Written once and never changed: audit history, amendments, notifications, retry records, and
-- draft complaints and diagnoses (replaced as a set while the encounter is a draft).
GRANT INSERT ON "AuditEvent", "EncounterAmendment", "Notification", "IdempotencyRecord", "EncounterComplaint", "Diagnosis"
  TO :"runtime_role";

-- The only deletes: replacing draft complaints and diagnoses (triggers refuse them once finalized),
-- and the scheduled pruning of expired retry records and expired sessions.
GRANT DELETE ON "EncounterComplaint", "Diagnosis", "IdempotencyRecord", "StaffSession" TO :"runtime_role";
COMMIT;
