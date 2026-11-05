-- Restore verification: run against the source database and against the restored copy, then
-- compare the two outputs line by line. Every row count and digest must match.
--
--   psql -v ON_ERROR_STOP=1 -A -F ' ' -t -f server/ops/restore-check.sql "<connection>" > restore-check.txt
--
-- Digests are MD5 fingerprints of each table's rows in primary-key order, used only to compare
-- two copies. The output contains no row content, so it can be kept as drill evidence.
SELECT 'table' AS kind, name, rows, digest FROM (
  SELECT 'StaffUser' AS name, count(*) AS rows, md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) AS digest FROM "StaffUser" t
  UNION ALL SELECT 'StaffSession', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM "StaffSession" t
  UNION ALL SELECT 'Patient', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM "Patient" t
  UNION ALL SELECT 'Appointment', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM "Appointment" t
  UNION ALL SELECT 'Encounter', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM "Encounter" t
  UNION ALL SELECT 'EncounterComplaint', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM "EncounterComplaint" t
  UNION ALL SELECT 'Diagnosis', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM "Diagnosis" t
  UNION ALL SELECT 'EncounterAmendment', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM "EncounterAmendment" t
  UNION ALL SELECT 'Notification', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM "Notification" t
  UNION ALL SELECT 'NotificationRecipient', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM "NotificationRecipient" t
  UNION ALL SELECT 'AuditEvent', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM "AuditEvent" t
  UNION ALL SELECT 'IdempotencyRecord', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM "IdempotencyRecord" t
) tables
UNION ALL SELECT 'schema', 'migrations', count(*), md5(coalesce(string_agg(migration_name || ':' || checksum || ':' || (finished_at IS NOT NULL)::text, ',' ORDER BY migration_name), ''))
  FROM _prisma_migrations WHERE rolled_back_at IS NULL
UNION ALL SELECT 'schema', 'triggers', count(*), md5(coalesce(string_agg(c.relname::text || '.' || t.tgname::text || ':' || t.tgenabled::text, ',' ORDER BY c.relname, t.tgname), ''))
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
UNION ALL SELECT 'schema', 'constraints', count(*), md5(coalesce(string_agg(c.relname::text || '.' || k.conname::text || ':' || k.contype::text || ':' || k.convalidated::text, ',' ORDER BY c.relname, k.conname), ''))
  FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
ORDER BY kind DESC, name;
