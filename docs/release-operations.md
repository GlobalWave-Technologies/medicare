# Release operations runbook

Audience: the deployment operator and the hospital's IT owner.

Every command here is a template. None has been run against a production system. Keep
credentials in the deployment secret store, never in this document, shell history, screenshots,
tickets or source control. The security design behind these steps is in
[production security hardening](production-security-hardening.md).

## Deploy order

Follow this order for every release:

1. **Back up.** Take a fresh backup of the production database and confirm it completed (see
   [Backups](#backups)). Record its time and location.
2. **Migrate.** Using the migration/owner identity:
   - run `npm run prisma:migrate:deploy --workspace @medicare/server`;
   - run it again and confirm `No pending migrations to apply`;
   - apply the runtime grants (see [Database roles](#database-roles)).
3. **Deploy the API.** Build with `npm run build`. Start `node server/dist/server.js` with the
   production environment and the runtime identity's `DATABASE_URL`.
4. **Check health and readiness.** `GET /api/v1/health` must return 200 and
   `GET /api/v1/health/ready` must return 200 before any traffic is routed to the instance.
5. **Deploy the frontend.** Publish `client/dist` with the headers in
   [Static cache policy](#static-cache-policy). Publish the fingerprinted `assets/` first and
   `index.html` last, so no page refers to a file that is not there yet.
6. **Smoke test.** On the real hostname, through the real proxy:
   - sign in as each role;
   - refresh;
   - make one write;
   - check the session cookie's attributes;
   - check readiness;
   - sign out.

Before the first production release, rehearse steps 1–6 on a disposable copy representative of the
production data size, and review migration duration and locks.

**Staging rehearsal:** the order was rehearsed twice on 5 November 2026 on a production-like staging
stack (first deployment, then a redeployment with a backup first). See
[final release acceptance](final-release-acceptance.md). That stack ran on a test workstation with
a private certificate authority, so repeat the order on the hospital's real hosting.

## Deployment configuration

The API validates its environment at start-up and refuses to start with a missing or unsafe value.
Production has no silent defaults.

| Variable | Required production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | The internal listening port, reachable only through the approved proxy or network |
| `DATABASE_URL` | The **runtime** identity's connection, with the provider's TLS settings. Never the migration owner |
| `CLIENT_ORIGIN` | The one exact HTTPS browser origin: no path, trailing slash or wildcard |
| `LOG_LEVEL` | Normally `info` |
| `TRUSTED_PROXY_CIDRS` | The reverse proxy's exact IP addresses or bounded CIDR ranges, comma separated, or `none` when the API is reached directly. Production refuses to start without it |
| `VITE_API_URL` | A build-time setting for the frontend. Use `/api/v1` for a same-origin deployment. Never put secrets in Vite variables; changing it requires a rebuild |

The bootstrap command also reads `BOOTSTRAP_ADMIN_*` variables. It creates the first
administrator once and refuses to run again. Supply them only for that run, from the secret store.

**In a production install** (installed with `--omit=dev`), run the compiled command
`node server/dist/cli/bootstrapAdmin.js` with the runtime `DATABASE_URL`. `npm run bootstrap:admin`
is the development form: it regenerates the Prisma client and runs the TypeScript source, so it
fails without development dependencies (seen in staging). `sessions:prune` and `idempotency:prune`
run compiled code and work in either install.

## Database roles

Use two database identities:

| Identity | Holds | Used for |
| --- | --- | --- |
| Migration owner | Owns the schema and tables; DDL rights | `prisma migrate deploy`, the grant script, restores, during deployment windows only |
| Runtime | Only the grants below; no ownership | The API, `sessions:prune`, `idempotency:prune`, the first-administrator bootstrap |
| Backup | Read-only (`pg_read_all_data`) | `pg_dump` only |

**Create the runtime and backup roles once**, with passwords from the secret store, and allow only
the named identities to connect:

```sql
CREATE ROLE medicare_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
CREATE ROLE medicare_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT pg_read_all_data TO medicare_backup;
REVOKE ALL ON DATABASE <database> FROM PUBLIC;
GRANT CONNECT ON DATABASE <database> TO medicare_runtime, medicare_backup;
```

Staging used exactly these roles, a non-superuser owner (with `CREATEDB` for restores), TLS with
`sslmode=verify-full` for the runtime connection, and a server that refuses non-TLS connections.
The owner can create `btree_gist` itself, because it is a trusted extension.

**Apply the grants after every migration deploy and after every restore**, as the migration owner.
New tables get no privileges automatically.

```sh
psql -v ON_ERROR_STOP=1 -v runtime_role=medicare_runtime -f server/ops/runtime-grants.sql "$MIGRATION_OWNER_DATABASE_URL"
```

**What the script checks:** it stops without changing anything if the runtime role is any of the
following, because such a role could switch off the clinical and audit protection triggers:

- a superuser;
- a role that can create roles or databases, replicate or bypass row security;
- the identity running the script;
- an owner of any schema object;
- a member of the owner role.

**What it grants:** it revokes everything, then grants exactly:

| Privilege | Tables |
| --- | --- |
| `SELECT` | Every application table |
| `INSERT, UPDATE` | `StaffUser`, `StaffSession`, `Patient`, `Appointment`, `Encounter`, `NotificationRecipient` |
| `INSERT` only | `AuditEvent`, `EncounterAmendment`, `Notification`, `IdempotencyRecord`, `EncounterComplaint`, `Diagnosis` |
| `DELETE` | `EncounterComplaint`, `Diagnosis`, `IdempotencyRecord`, `StaffSession` |
| None | `_prisma_migrations`; no `TRUNCATE`, `TRIGGER`, schema `CREATE` or ownership |

It is safe to rerun.

**Verified:** the full application and both maintenance commands ran under this role. Every
attempt by that role to bypass finalized-record, amendment, audit, notification or retry-record
protection was refused (`server/tests/runtime-role.database.test.ts`).

**Protect the owner.** It can disable triggers. Never give its credentials to the application or to
the backup job.

## Migrations

| Migration | Adds |
| --- | --- |
| Initial domain | Tables, indexes and foreign keys |
| Domain integrity | Validating checks, plus audit and timestamp triggers |
| Staff authentication | The session table and enum values |
| Patient audit | Enum values |
| Scheduling | The `btree_gist` extension and GiST exclusion constraints |
| Clinical integrity | Amendments and immutability triggers |
| Notifications | A replaced audience constraint, a nullable appointment reference, indexes and triggers |
| Reporting | An audit enum value |
| Mutation idempotency | One enum and the `IdempotencyRecord` table with its checks, trigger and foreign keys |
| Credential lifecycle enums | `PASSWORD_CHANGED` and `PASSWORD_RESET` audit actions and the `STAFF_CREATE` operation. Enum additions only |
| Staff creation idempotency | A nullable `staffUserId` column, a unique index and a foreign key on `IdempotencyRecord`, and its resource check replaced |

The last two migrations touch only the small `IdempotencyRecord` table, which holds at most 24
hours of rows. The new foreign key briefly takes a lock on `StaffUser` while it validates, which
blocks staff changes for a moment.

No migration deletes data. Other risk points:

- the extension needs provider support;
- existing overlapping active appointments would block the scheduling constraint;
- index and constraint builds can lock tables on large data.

Rehearse on the target PostgreSQL version. Never edit an applied migration.

## Recurring jobs

Schedule these with the hospital's scheduler (cron, a systemd timer, Windows Task Scheduler or the
platform's job runner). Run each with the runtime `DATABASE_URL` and the built server in place.

| Job | Command | Suggested schedule | Notes |
| --- | --- | --- | --- |
| Expired session cleanup | `npm run sessions:prune --workspace @medicare/server` | Daily, 02:15 local | Deletes only sessions past their expiry. Prints `Removed N expired session(s).` |
| Retry record cleanup | `npm run idempotency:prune --workspace @medicare/server` | Daily, 02:30 local | Deletes only retry records past their 24-hour window. Prints `Removed N expired idempotency record(s).` |
| Database backup | Provider snapshot or the `pg_dump` command below | At least daily (owner to set) | See [Backups](#backups) |
| Restore rehearsal | The [Restores](#restores) procedure into a disposable database | Owner to set; at least before go-live and after major changes | Record the result |

Example crontab entries (run from the deployed checkout; the paths are placeholders):

```text
15 2 * * * cd /srv/medicare && npm run sessions:prune --workspace @medicare/server >> /var/log/medicare/maintenance.log 2>&1
30 2 * * * cd /srv/medicare && npm run idempotency:prune --workspace @medicare/server >> /var/log/medicare/maintenance.log 2>&1
```

**Both commands are safe to rerun:**

- they delete in batches of 1,000, so a long gap between runs is safe;
- a second run removes nothing;
- they print only a count, or a fixed failure code (`INVALID_CONFIGURATION` or `CLEANUP_FAILED`)
  with exit status 1, never a URL or credential.

**Alerting:** alert on any non-zero exit, and on a job that has not reported success for two days.

## Backups

The tested method is PostgreSQL `pg_dump` in custom format, with version-compatible tools:

```sh
pg_dump --host=DB_HOST --port=DB_PORT --username=BACKUP_ROLE --format=custom --file=medicare-YYYYMMDD-HHMM.dump PRODUCTION_DATABASE
```

**The backup role** needs read access only. It must not be the runtime role or the migration owner.

**What a backup holds:** every table, including sessions and retry records, plus all functions,
triggers and constraints. It does not include cluster roles, passwords, certificates, the
deployment's secrets or monitoring configuration. Recover those through their own protected
procedures.

**Storage and encryption:** encrypt and restrict where backups are stored. Never attach a backup
to a ticket or e-mail.

**Owner decisions.** The hospital or deployment owner must fill in this table. No values have been
assumed, and this runbook sets no legal retention period.

| Decision | Owner's value |
| --- | --- |
| Backup owner (role or team) | ________ |
| Schedule and method (dump, managed snapshots, point-in-time recovery) | ________ |
| Recovery point objective / recovery time objective | ________ |
| Retention period and expiry check | ________ (set with policy and legal review) |
| Encryption at rest and in transit; who holds the keys | ________ |
| Off-site or immutable copy | ________ |
| Restore-rehearsal frequency and who signs it off | ________ |
| Escalation contact when a backup or rehearsal fails | ________ |

## Restores

Always restore into a **new, empty database**; never overwrite a live one. Run each command as the
migration owner:

```sh
createdb --host=RESTORE_HOST --port=DB_PORT --username=MIGRATION_OWNER RESTORE_DATABASE
pg_restore --host=RESTORE_HOST --port=DB_PORT --username=MIGRATION_OWNER --no-owner --no-acl --single-transaction --dbname=RESTORE_DATABASE medicare-YYYYMMDD-HHMM.dump
psql -v ON_ERROR_STOP=1 -v runtime_role=medicare_runtime -f server/ops/runtime-grants.sql "$RESTORE_OWNER_DATABASE_URL"
```

`createdb` lets every role connect to the new database. Before it serves the application, run
`REVOKE ALL ON DATABASE RESTORE_DATABASE FROM PUBLIC` and grant `CONNECT` to the runtime and
backup roles, as for the primary database.

**Verify the copy before using it:**

1. Run `server/ops/restore-check.sql` against the source (or a copy taken at the same time) and
   against the restore, then compare the outputs line by line. It prints, for each table, the row
   count and a digest in primary-key order, plus fingerprints of the migrations, triggers and
   constraints. It prints no row content, so the output can be kept as evidence.

   ```sh
   psql -X -v ON_ERROR_STOP=1 -A -F ' ' -t -f server/ops/restore-check.sql "<connection>" > restore-check.txt
   ```

2. Start the built API against the restore with the runtime identity. Readiness must report 200.
3. Sign in as each role. Open a finalized record and its amendments.
4. Confirm the protections still hold: editing a finalized record is still refused.

**Sessions after disaster recovery:** a restore carries over every session that had not expired at
backup time. Unless the restore is a planned continuation of the same service, revoke them before
reopening access, as the migration owner:

```sql
UPDATE "StaffSession" SET "revokedAt" = now() WHERE "revokedAt" IS NULL;
```

Staff then sign in again. Retry records in the restore expire on their own within 24 hours.

**Drill on synthetic data (6 November 2026):** dumped a database that used every table, restored it
into a fresh database, and compared `restore-check.sql` output. All counts, digests, triggers,
constraints and migrations matched. With the grants re-applied, the API started and reported ready,
and the carried-over sessions were revoked. Sign-in then worked, and the runtime role still could
not edit a finalized record or change or delete amendments and audit events. This proves the method
on this data size only, not the customer's schedule, storage, encryption or recovery objectives.

**Staging rehearsal (5 November 2026):** the documented order was followed on a production-like
staging stack: a backup by the read-only backup role over TLS, then a restore by the owner into a
separate verification database.

- **Comparison:** `restore-check.sql` matched exactly.
- **Sessions:** carried-over sessions were revoked, and a staging session cookie was then refused.
- **Protections:** a second API instance on the copy accepted sign-in, and finalized-record and
  audit protection still held.
- **Cleanup:** the copy was dropped afterwards.

See [final release acceptance](final-release-acceptance.md).

## Reverse proxy, CORS and HTTPS

- **Same origin:** serve the browser application and `/api/v1` from one HTTPS origin.
  `SameSite=Strict` cookies require it, and CORS is then unused by the application.
- **Proxy trust:** set `TRUSTED_PROXY_CIDRS` to the proxy's actual addresses and block direct
  public access to the API port.
  - Without it, every request appears to come from the proxy, and one outsider's ten failed
    sign-ins would lock everyone out for 15 minutes.
  - Forwarding headers from untrusted peers are ignored.
- **HTTPS:** terminate it with a trusted certificate. Redirect HTTP to HTTPS, and monitor
  certificate expiry.
- **Retries and timeouts:** keep the proxy's upstream keep-alive idle timeout below the API's 5
  seconds. Do not let the proxy retry `POST`, `PATCH` or `DELETE` on upstream errors.
- **Headers to pass through unchanged:** `Idempotency-Key`, `Idempotency-Replayed`, `X-Request-Id`
  and `Retry-After`. Do not log `Idempotency-Key`, cookies or request bodies at the proxy.
- **CORS:** the API allows exactly `CLIENT_ORIGIN` with credentials and refuses every other origin,
  including `null`, with `403`. Allowed request headers are `Content-Type`, `X-CSRF-Token`,
  `Idempotency-Key` and `X-Request-Id`.

## Cookies and HTTPS

In production the session cookie is
`__Host-medicare_session=…; Path=/; Expires=<8 hours>; HttpOnly; Secure; SameSite=Strict`, with no
`Domain`.

- **Secure is always set** in production, whatever the proxy sends, so the site must be HTTPS
  end-to-end for browsers.
- **Smoke-test check:** on the real hostname, the browser's cookie store should show the cookie as
  HttpOnly, Secure and host-only.
- **Verified:** the attributes were checked on the server's `Set-Cookie` in Chrome, Edge and the
  Firefox engine. In staging this was repeated over real HTTPS on the staging hostname, through
  nginx: the cookie was stored host-only and could not be read by script. The Windows WebKit build stores the cookie but does not implement `SameSite`, so
  check Safari on the hospital's Apple devices.

## Static cache policy

Serve `client/dist` with these headers. The acceptance gateway used exactly these values.

| Path | `Cache-Control` | Why |
| --- | --- | --- |
| `/assets/*` (fingerprinted JS and CSS) | `public, max-age=31536000, immutable` | Names change on every build |
| `/index.html`, `/` and every SPA fallback route | `no-cache` | Must pick up new asset names immediately |
| `/theme-init.js` | `no-cache` | Not fingerprinted; runs before the first paint |
| `/favicon.svg` | `no-cache` | Not fingerprinted |

Send an `ETag` or `Last-Modified` so `no-cache` files revalidate cheaply (304). Do not add a
service worker, and do not publish source maps or `.env` files.

Set these response headers on the frontend:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

- **The policy works as-is:** `theme-init.js` is same-origin, so this policy needs no
  `unsafe-inline`.
  - **Browsers:** Chrome, Edge and the Firefox engine ran the whole application under it with no
    violations.
  - **Script-set styles:** the application sets a few styles from script (chart positions, report
    bar widths and the dialog scroll lock). CSP allows these.
  - **WebKit:** the Windows WebKit engine reports `style-src-attr` refusals for them, yet applies
    them. Confirm on Safari that report bars and chart labels keep their geometry.
- **`connect-src 'self'`:** needs the same-origin API. A different API origin would have to be
  added explicitly.
- **HSTS `includeSubDomains`:** affects every subdomain of the Medicare host. Confirm that is
  acceptable before enabling it.

## Health, readiness and shutdown

- **Health and readiness endpoints:**
  - `GET /api/v1/health` reports that the process is alive. It never queries the database.
  - `GET /api/v1/health/ready` runs a bounded database check and returns 503 when the database is
    unusable or the process is shutting down.
- **Outage drill result:** readiness returned 503 while the database was unavailable, while health
  stayed 200. The error log entry carried the same request ID as the response. Readiness recovered
  without a restart once the database was back.
  - Route traffic only to ready instances.
  - Public health responses contain no infrastructure detail.
- **Shutdown:** on `SIGTERM` or `SIGINT` the API stops accepting connections and lets in-flight
  requests finish. It then closes the database pool and exits. A 10-second deadline forces exit if
  draining hangs.
  - A write in progress during shutdown completes and commits exactly once. This was tested on
    Windows and, in staging, with a real `SIGTERM` from a Linux container runtime: in-flight
    sign-ins committed once and the process exited 0.
  - Allow at least 10 seconds of shutdown grace in the process manager.
  - While the API is down, the proxy answers with a gateway error. Keep its upstream connect timeout
    short (staging used 5 seconds).

## Monitoring

No monitoring provider is integrated. Configure the following in the hospital's own tooling:

| Check | Alert condition (suggested; tune locally) |
| --- | --- |
| API uptime: `GET /api/v1/health` | Two consecutive failures, or more than 30 seconds unreachable |
| Readiness: `GET /api/v1/health/ready` | 503 for more than 1 minute |
| HTTP 5xx rate (proxy or error-level log entries) | Above the normal baseline for 5 minutes |
| Database availability, connections and storage | Unreachable; connection saturation; storage over 80% |
| Process restarts | More than one unplanned restart in 15 minutes |
| Backup job | Any failure; newest successful backup older than the agreed schedule |
| Restore rehearsal | Overdue against the agreed frequency |
| `sessions:prune`, `idempotency:prune` | Non-zero exit, or no success for two days |
| TLS certificate | Less than 21 days to expiry |
| Disk and log volume | Over 80% |

Name alert recipients, response times and an escalation and downtime procedure before handoff.

## Logs and support

Application logs are JSON lines and contain only:

- timestamp, level and service;
- request ID, method and status;
- response time;
- a fixed error code.

URLs, query strings, headers, cookies and request bodies are never logged, and sensitive fields are
redacted (details in the security document).

Every response carries `X-Request-Id`, which the browser shows as a support reference; search the
logs by that ID. Never ask staff for passwords, cookies, tokens or clinical text through ordinary
support channels. Protect log access and set log retention. Proxy and access logs need their own
privacy review.

The sign-in and password-change limiters keep their counters in process memory. Run a **single API
instance**, or add a shared limiter store before scaling out.

## Rollback

1. Stop writes: take the API out of the proxy, or show the downtime notice.
2. **Frontend-only problem:** republish the previous `client/dist`. The old `index.html` still
   references its own fingerprinted assets, as long as you kept them.
3. **API problem with no migration in the release:** redeploy the previous API build.
4. **Release that included migrations:** migrations are forward-only; there are no down scripts.
   Either redeploy the previous API build against the migrated schema, or restore the backup taken
   in step 1 of the deploy order into a new database and point the previous build at it.
   - The previous build tolerates both migrations added in this release: an extra nullable column
     and extra enum values.
   - Restoring loses every change made after that backup. Decide with the hospital, and revoke
     restored sessions.
5. Re-run readiness and the smoke test, then record what happened.

Never reverse immutable history by hand, edit applied migrations, or disable triggers to repair
data.

## Manual release checks

Automation could not cover these. Complete them on hospital devices before approval:

- **Autofill:** saved-password autofill on the sign-in screen, in Light and in Dark: the filled
  email and password stay readable.
- **Two notes:** the orange information note and the amber warning stay distinguishable on the
  hospital's displays.
- **High contrast:** Windows high-contrast mode, if staff use it. Medicare has no dedicated styling
  for it, so record whether it is usable.
- **Safari:** the core workflows on the hospital's Apple devices, if any are used.
- **Screen reader:** any screen reader staff rely on, across sign-in, navigation, a patient form,
  an appointment form, a dialog, a finalized record, a notification, a staff action and a report.

## Retention decisions

Current behaviour:

- **Hospital records:** patients are archived, never deleted. Appointments keep their history,
  including cancellations. Finalized encounters cannot be edited; amendments append. Audit events
  are append-only.
- **Technical rows that are pruned:** sessions are deleted after they expire, and retry records
  after 24 hours. Neither is part of the hospital record.

The hospital must decide retention, lawful holds, authorized access, backup expiry and eventual
controlled disposal for each class of record, with policy and legal review. This runbook authorizes
no deletion of hospital records.
