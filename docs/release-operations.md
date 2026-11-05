# Release operations runbook

Scope: the Step 14 release candidate (acceptance completed 4 November 2026). Examples are templates for a deployment operator, not commands already run against production. Keep credentials in the deployment secret store, not in this document, shell history, screenshots or source control.

## Deployment configuration

| Setting | Required deployment value/decision |
|---|---|
| `NODE_ENV` | `production` for the API |
| `PORT` | Explicit valid internal listening port, reachable only through approved infrastructure |
| `DATABASE_URL` | Dedicated runtime account and intended database; provider TLS validation and credentials supplied securely |
| `CLIENT_ORIGIN` | One exact HTTPS browser origin, no path, trailing slash or wildcard |
| `LOG_LEVEL` | Normally `info`; do not enable sensitive request-body logging in proxies or collectors |
| `TRUSTED_PROXY_CIDRS` | Empty for direct connections; otherwise only actual proxy IPs/bounded ranges. Block direct public API access behind the proxy |
| `VITE_API_URL` | Build-time setting; prefer `/api/v1` with a same-origin reverse proxy. Never put secrets in Vite variables |

Serve `client/dist` and route `/api/v1` to the built server (`node server/dist/server.js`). Vite's development proxy is not production infrastructure. Use SPA index fallback for browser routes, correct JS/CSS content types and appropriate asset caching. Do not publish source maps or `.env` files. A changed `VITE_API_URL` requires rebuilding the client.

Terminate HTTPS with a trusted certificate; verify HTTP redirection, renewal and upstream isolation. Production sessions are `Secure`, `HttpOnly`, `SameSite=Strict`, path `/`, with an eight-hour expiry. Exact CORS and credentials do not make unrelated cross-site deployment compatible with Strict cookies: prefer same-origin deployment. Test the real hostname/proxy path, cookies, login, refresh, CSRF, logout and readiness before opening access.

The 4 November acceptance run served the production build through a local HTTPS reverse proxy with a self-signed certificate, and Chrome, Edge and the Firefox engine completed the Secure-cookie round trip, refresh, CSRF and logout. That is still not evidence of the customer's certificate, renewal, hostname or proxy configuration; repeat the smoke test on the real deployment.

### Reverse proxy behaviour

- Set `TRUSTED_PROXY_CIDRS` to the proxy's actual address(es). Without it, every request appears to come from the proxy and all staff share one sign-in failure budget (10 failed attempts per 15 minutes). Staff behind one hospital NAT address also share it.
- Keep the proxy's upstream keep-alive idle timeout shorter than the API's 5-second keep-alive timeout, and do not let the proxy retry non-idempotent requests (`POST`, `PATCH`, `DELETE`) on upstream errors.
- Browsers may silently resend a request if a reused connection closes before any response arrives. Patient registration, clinical encounter creation and broadcasts from the Medicare frontend carry an `Idempotency-Key`, so a resend within 24 hours returns the original result ([mutation idempotency](idempotency.md)). The API rejects a resent identical amendment, appointment overlaps prevent duplicate bookings, and a second finalization is refused. Clients that send no key remain unprotected. Stable proxy connections still reduce the risk; staff guidance covers checking before retrying.
- Pass the `Idempotency-Key` request header and the `Idempotency-Replayed` response header through unchanged. Do not log them.

## Database identities

Separate migration ownership from the runtime login. The runtime should have `CONNECT`, schema `USAGE`, required table `SELECT`/`INSERT`/`UPDATE`, and required sequence privileges, but no superuser, role creation, database creation, schema creation, table ownership or migration-table access. Draft child replacement needs `DELETE` on `EncounterComplaint` and `Diagnosis`. Audit events and amendments need read/insert only; deny update/delete/truncate. Do not grant broad `DELETE`, `TRUNCATE` or trigger-disabling powers.

Maintain explicit grants when adding future migrations. Review notification tables separately if their APIs are used. Trigger restrictions remain necessary even when grants are restricted. A migration owner can change triggers; protect that identity and use it only during controlled deployment. Application runtime credentials must never be reused as backup administration credentials.

The following grant set was used for the complete 4 November browser acceptance (all roles, drafts, finalization, amendments, appointments, sessions) and for the restore drill. Run it as the migration/owner identity after each deployment's migrations, replacing the role name. It is a template, not a statement about any existing environment:

```sql
CREATE ROLE medicare_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; -- set its password through the secret store
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO medicare_runtime;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO medicare_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO medicare_runtime;
REVOKE ALL ON _prisma_migrations FROM medicare_runtime;
REVOKE UPDATE ON "AuditEvent", "EncounterAmendment" FROM medicare_runtime;
GRANT DELETE ON "EncounterComplaint", "Diagnosis" TO medicare_runtime;
REVOKE UPDATE ON "IdempotencyRecord" FROM medicare_runtime;
GRANT DELETE ON "IdempotencyRecord" TO medicare_runtime; -- expired retry records only
```

Re-run the grants after any migration that adds tables; `ON ALL TABLES` covers only existing tables. If the runtime account is also the table owner (for example, a single account used for both `migrate deploy` and the application), it can disable the clinical and audit immutability triggers; do not deploy that way.

The local drill uses this nonowner, nonsuperuser runtime role and verifies that audit updates, amendment deletion, audit truncation and schema creation fail. Temporary loopback-only PostgreSQL uses synthetic data and trust authentication; production must use appropriate authenticated, encrypted connections. This drill does not change a real deployment's privileges.

## Migration release sequence

1. Confirm target identity, approved maintenance window, tested backup and restore target.
2. On a disposable copy representative of deployment size, run `npm run prisma:migrate:deploy`, then rerun it and confirm no pending migrations.
3. Verify the nine expected migration records and application readiness. Review migration duration and locks before the real deployment.
4. Deploy using the migration identity; switch the application back to its runtime identity. Smoke-test all roles.
5. If deployment fails, stop writes and use the approved recovery procedure. Do not reverse immutable history or casually edit historical migration files.

Migration review: the initial migration creates tables/indexes/foreign keys; domain integrity adds validating checks and audit/timestamp triggers; authentication adds the session table and enum values; patient audit adds enum values; scheduling installs `btree_gist` and GiST exclusion constraints; clinical integrity creates amendments and immutability triggers; notifications replaces an audience constraint and adds a nullable appointment reference, indexes and integrity triggers; reporting adds an audit enum value; mutation idempotency adds one enum and one new table with unique indexes, check constraints, an update-rejecting trigger and `RESTRICT` foreign keys to staff, patients, encounters and notifications. It alters no existing table, but creating those foreign keys briefly locks the referenced tables against writes. There is no table/column data deletion migration. Constraint validation, exclusion-index construction, ordinary index creation and `ALTER TABLE` can scan tables and block concurrent writes. Existing invalid values or overlapping active appointments can prevent deployment. The extension requires provider support and suitable deployment permissions. New nullable columns do not establish that the whole migration is lock-free. Enum additions and trigger/function installation need staging rehearsal on the target PostgreSQL version. No large-data lock-duration benchmark was performed locally.

## Backup and restore

The tested local strategy is PostgreSQL 18 `pg_dump` custom format and `pg_restore` to a fresh disposable database. Use the provider's approved version-compatible tools, a protected password file/secret injection, and restricted backup storage. Example commands (replace every placeholder; no embedded credentials):

```sh
pg_dump --host=DB_HOST --port=DB_PORT --username=BACKUP_ROLE --format=custom --file=release.dump SOURCE_DATABASE
createdb --host=RESTORE_HOST --port=DB_PORT --username=DEPLOY_ROLE RESTORE_DATABASE
pg_restore --host=RESTORE_HOST --port=DB_PORT --username=DEPLOY_ROLE --no-owner --no-acl --single-transaction --dbname=RESTORE_DATABASE release.dump
```

Use a new named target rather than overwriting an active hospital database. `--no-owner --no-acl` intentionally requires recreating ownership/grants securely afterward. A database dump does not contain cluster roles, deployment secrets, certificates, monitoring configuration or external files; recover those through separately protected infrastructure procedures. Do not attach backups to ordinary support tickets.

Verify row counts and deterministic row digests for staff, patients, appointments, encounters, complaints, diagnoses, amendments and audit events before accepting a restore. Start the built application against the restored database with runtime privileges; check readiness, login, final original content, amendment history and authorization. Preserve evidence without patient data. Restored copies contain the source's unexpired sessions (the 4 November drill carried 69 synthetic sessions across). Unless the restore is a planned continuation of service, revoke them before reopening access, as the migration/owner identity: `UPDATE "StaffSession" SET "revokedAt" = now() WHERE "revokedAt" IS NULL;`. Staff then sign in again.

The hospital/provider must name a backup owner, set recovery time/point objectives, backup cadence, encryption/access controls, offsite/immutable copies where appropriate, retention, expiry verification and recurring restore rehearsals. Managed snapshots/PITR are provider responsibilities only when contracted and verified; a successful local dump is not proof of those services or disaster recovery capacity.

## Monitoring, logs and support

Schedule `npm run idempotency:prune --workspace @medicare/server` (runs the built `dist/cli/pruneIdempotency.js` with `DATABASE_URL`) at least daily. It deletes only idempotency records past their 24-hour window and reports how many it removed. Alert if it fails repeatedly.

Monitor process uptime/restarts, `GET /api/v1/health`, `GET /api/v1/health/ready`, HTTP 5xx and latency, database connectivity/pool pressure, storage capacity, certificate expiry and backup-job/restore-check outcomes. Health indicates process liveness; readiness includes a bounded database probe and returns 503 when unavailable or shutting down. In the acceptance drill, blocking database connections turned readiness to 503 within 0.2 seconds while health stayed 200, an error-level `Request failed` entry with code `SERVICE_UNAVAILABLE` was logged, and readiness recovered without a restart once connections were allowed again. Do not route normal traffic to an unready instance. Alert on repeated readiness failure, process restarts and any sustained rate of error-level entries or 5xx responses.

The login limiter's counters are held in process memory: a restart resets them and multiple API instances do not share them. Run a single instance, or add a shared store before scaling out. Assign alert recipients, response times and an escalation/downtime procedure before handoff.

Application HTTP logs deliberately allowlist timestamp, level, request ID, method and response status with safe error classification. Raw URLs/query strings are omitted to avoid identifiers/search text. If route-level aggregation is required, use sanitized route templates; do not enable raw URL or request-body collection. Protect log access and retention. Correlate support references to server logs; do not request passwords, cookies, tokens or clinical text over ordinary support channels. Proxy/access logs need a separate privacy review.

## Retention decisions

Patients archive/reactivate. Cancelled appointments remain. Finalized encounters cannot be edited; amendments append. Audit events are append-only. There is no delivered customer retention/disposal workflow. The hospital must decide retention, lawful holds, authorized access, backup expiry and eventual controlled disposal for each class of record and audit, with appropriate policy/legal review. This runbook specifies no legal retention period and authorizes no deletion of hospital records. `IdempotencyRecord` rows are technical retry records (hashes and a resource reference, no content) kept for 24 hours and then pruned; they are not part of the hospital record.
