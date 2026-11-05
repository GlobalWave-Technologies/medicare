# Final release acceptance (staging)

Audience: the product owner, the hospital's IT owner and whoever approves the release.

Date: 5 November 2026. Candidate: `main` at `6e60b6d` with the uncommitted Step 16.1, 17 and 18
changes. All data was synthetic. No customer system, DNS, credential or production database was
touched, and nothing was deployed to production.

## Decision: CONDITIONAL GO

The software showed no P0 or P1 issue under production-like deployment. Every role workflow worked,
and every security, data-integrity and recovery control held:

- TLS, the proxy and CORS;
- cookies and headers;
- the database roles;
- idempotency and the password lifecycle;
- pruning, backup, restore, outage recovery and shutdown.

The release is **not yet a GO**, because operational and customer prerequisites remain open (see
[Conditions](#conditions-before-production-deployment)):

- no backup owner or backup decisions;
- no monitoring owner or alert recipients;
- the recurring jobs are not scheduled on the real platform;
- the deployment has not been rehearsed on the hospital's own hosting;
- several manual device checks are not done;
- the hospital has not accepted UTC reporting periods.

**Production deployment may begin only after those conditions are closed.**

## 1. Staging architecture

Staging was built as a production-like stack of Linux containers on the release-test workstation.
It mirrors the runbook's same-origin design. **It is not the hospital's hosting:** the certificate
came from a private staging authority and the hostname is a reserved `.test` name.

| Layer | Staging implementation |
| --- | --- |
| Hostname | `https://staging.medicare.test` (one origin for the browser application and `/api/v1`) |
| Reverse proxy | nginx 1.28. TLS 1.2/1.3 only, with a certificate for the hostname. Plain HTTP only redirects (301). It serves `client/dist` with the runbook's headers and proxies `/api/` with `X-Forwarded-For` appended, and never retries upstream. Its access log has no query strings, cookies or keys |
| API | Node.js 22.16, production install without development dependencies, `node server/dist/server.js`. It runs as an unprivileged user on a read-only filesystem with no outbound internet. One instance |
| Database | PostgreSQL 18. TLS plus SCRAM is required for every network connection, and non-TLS connections are refused. The cluster superuser cannot log in over the network |
| Database identities | `medicare_owner` owns the schema (no superuser). `medicare_runtime` has only the grant script's privileges and `NOINHERIT`. `medicare_backup` is read-only (`pg_read_all_data`) |
| Networks | Client network (browsers and client machines to the proxy); internal application network with no internet access (proxy to API to database); operations network (migration, grant, backup and restore jobs to the database) |
| Process manager | The container runtime. It sends `SIGTERM` with a 15-second grace period |
| Jobs | One-off containers from the API image using the runtime `DATABASE_URL` (`sessions:prune`, `idempotency:prune`, first-administrator bootstrap) |

No application setting refers to `localhost`. The API reaches the database as `db:5432` with
`sslmode=verify-full`. Browsers and client containers reached the proxy by the staging hostname.

## 2. Deployment configuration and order

| Variable | Staging value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `4000`, reachable only on the internal network |
| `DATABASE_URL` | Runtime identity, `sslmode=verify-full` against the staging authority (value kept in the secret files only) |
| `CLIENT_ORIGIN` | `https://staging.medicare.test` |
| `LOG_LEVEL` | `info` |
| `TRUSTED_PROXY_CIDRS` | `172.31.251.10`, the proxy's address on the internal network |
| `VITE_API_URL` | `/api/v1` at build time |

**First deployment (rc1)** followed the runbook order:

1. **Backup:** the database was empty, so there was nothing to back up.
2. **Migrate:** as the owner, then again with nothing pending; then the grants were applied.
3. **First administrator:** bootstrapped as the runtime role.
4. **API:** started.
5. **Readiness:** checked before any traffic was routed.
6. **Frontend:** published, assets first and `index.html` last; then the proxy started.
7. **Checks:** static headers, then smoke tests.

**Redeployment (rc2)** used the same order. The backup came first because the database then held
synthetic data:

- **Database:** migrations reported nothing pending and the grants were re-applied.
- **API:** the container was recreated and became ready.
- **Frontend:** a release with new asset fingerprints was published.
- **Checks:** the headers, stale-page test and smoke test passed (13/13).

**Production configuration refusals:** the production build refused to start, exiting 1 with the
variable named, when given:

- an `http://` origin;
- an origin with a trailing slash;
- an empty `TRUSTED_PROXY_CIDRS`;
- a `0.0.0.0/0` proxy range.

**Finding (fixed in the runbook):** `npm run bootstrap:admin` fails in a production install. It
needs `prisma generate`, `tsx` and the TypeScript sources. The compiled
`node server/dist/cli/bootstrapAdmin.js` worked as the runtime role, and a second run was refused.

## 3. Release-artifact cleanup

- **Removed:**
  - 24 tracked QA scratch files at the repository root (`.release-*`: a QA script, exit-code files,
    audit outputs and a local path pointer);
  - `server/skills-lock.json`, which is development-tool metadata.

  Git history is unchanged, and both are now in `.gitignore`.
- **Dropped:** two leftover databases (`medicare_test_release`, `medicare_test_restored`) on the
  local disposable test cluster.
- **Kept:** product documentation, the audit screenshots the UI/UX audit references, operations
  scripts, migrations and test infrastructure.

## 4. Results by area

All results are from the staging stack. "Checks" are automated assertions against the browser, the
API and the database.

| Area | Result |
| --- | --- |
| Migrations | All eleven applied as the non-superuser owner over TLS. A second deploy had nothing pending, `migrate status` was up to date, and the owner owns every object. 11/11 |
| Runtime role | Exact documented grant map; connects over TLS. 25 bypass attempts were refused and the protected data was byte-for-byte unchanged (detail below). 27/27 |
| HTTPS and proxy | Certificate verified (TLS 1.3); TLS 1.1 refused; HTTP only redirects; nginx version hidden. The API port is unreachable from the client network; the API has no internet access. 7/7 |
| Plain-HTTP misconfiguration | The same site served over plain HTTP could not sign anyone in: the origin was refused and no session cookie was stored. The production build refuses an HTTP origin (above) |
| Cookies | `__Host-medicare_session=…; Path=/; Expires≈8 h; HttpOnly; Secure; SameSite=Strict`, with no Domain. Stored host-only by the browsers and not readable by script |
| CORS | The trusted origin is allowed with credentials and the client headers. These are refused with 403: an unrelated domain, `http://`, a trailing slash, an alternate port, `null`, three lookalike hosts and an uppercase host. A credentialed write from another origin, or with no Origin, was refused and wrote nothing. 12/12 |
| Security headers | The frontend's CSP, HSTS, nosniff, `no-referrer`, `DENY` framing, COOP and Permissions-Policy are on every static response. API responses deny all resources and framing and are `no-store`. `index.html` has no inline script or style; `theme-init.js` runs under `script-src 'self'` |
| Static cache | `assets/*` is `immutable` for a year. `index.html`, SPA routes, `theme-init.js` and the favicon are `no-cache`, with ETag 304 revalidation. A missing asset returns 404, never HTML. `.env` and `.map` paths return 404. 20/20 |
| Redeploy | A revalidating tab received the new `index.html` with a new ETag, not a stale 304. The previous release's asset stayed available. An open tab reloaded onto the new release still signed in, and deep links loaded the new release |
| Themes | Light, Dark and System all work. System follows the OS, including a live change; a manual choice overrides it and is stored. The first paint already has the right theme with no flash, sign-out keeps the device theme, and switching makes no API request. 14/14 |
| Admin | Sign-in, refresh, session restored in a new tab. Overview figures matched the database. Patients: create, edit, archive, archived filter, reactivate, search. Appointments: book, reschedule, confirm, check in, cancel with reason. Notifications: broadcast, inbox, read. Staff: create three accounts (one account and one audit each), change role, suspend (sign-in refused), reactivate, sign out all sessions, reset password. Reports: patient and appointment activity, last-90-days weekly, custom dates daily, with no export or clinical report. Then change own password, sign in again and sign out. 37/37 |
| Records Officer | Navigation is Overview, Patients, Appointments, Reports and Notifications only. Covered: register a patient, book and confirm, read the inbox and mark all read, and both reports with no clinical report. Clinical, staff and clinical-report APIs return 403 without signing out. Then change password and sign out. 13/13 |
| Doctor | Navigation includes Medical Records and no Staff & Access. Workflow steps: (1) eligible own appointment, (2) check in, (3) start encounter, (4) save draft, (5) refresh, (6) finalize, (7) add amendment, (8) reload, (9) original read-only and the API refuses edits, (10) amendment separate, (11) patient clinical history, (12) sign out. Also: “My clinical activity” with no clinical text, and change password. 23/23 |
| Idempotency | Patient, encounter, broadcast and staff creation. An identical resend replays (`Idempotency-Replayed: true`) with exactly one record and one audit event. A changed payload under the same key gives `409 IDEMPOTENCY_KEY_REUSED` and writes nothing. Five concurrent identical requests through the proxy make one record. Retry records hold only hashes. 21/21 |
| Passwords | **Self change:** a wrong current password is refused; the correct one works and every session ends; the old password fails and the new one works. **Admin reset:** target sessions end; old fails, new works. Five refusals per account then 429, which survives the reset. **Pending account:** cannot be activated without credentials; it keeps `PENDING` after a first password and signs in only after activation. **Refused:** reset of a disabled account (`ACCOUNT_DISABLED`) and an administrator resetting their own account. 16/16 |
| Session pruning | `sessions:prune` as the runtime role removed the expired session and kept the active seeded session and a real signed-in session. A second run removed 0. 3/3 |
| Retry-record pruning | `idempotency:prune` removed the expired record and kept valid ones. A second run removed 0. 3/3 |
| Backup | See [section 5](#5-backup-and-restore) |
| Restore | See [section 5](#5-backup-and-restore) |
| Health and readiness | **Outage:** with the database stopped, readiness returned 503 within 0.66 s while health stayed 200. The 503 had no infrastructure detail, and its request ID appeared in the API error log. **Recovery:** readiness was back 0.73 s after the database started, without an API restart. 8/8 |
| Graceful shutdown | A real `SIGTERM` from the container runtime arrived while four sign-ins were running. Every sign-in that succeeded committed exactly one session and one audit event. The API logged a drained shutdown and exited 0; the proxy then gave a gateway error, never a partial response. The restart became ready, and retrying in-flight creates with the same key gave exactly one patient each. 5/5 |
| Rate limiting | Through the proxy, client A was limited after 10 refusals (429 with `Retry-After`) while client B was unaffected. A cannot escape by sending its own `X-Forwarded-For`. Twelve successful sign-ins did not count. Audit events and the proxy log record each client's real address. 6/6 |
| Logging | See [section 6](#6-logging-and-monitoring) |
| Responsive | 320, 375, 768, 1024 and 1440 px, in Light and Dark. Sign-in, Overview, Patients, Appointments, a clinical record, Notifications, Staff and Reports had no page-level horizontal overflow and no `undefined` or `NaN`. 90/90 |

**The runtime role was refused when it tried to:**

- alter tables;
- create tables or schemas;
- disable triggers or drop the trigger function;
- set `session_replication_role`;
- edit, un-finalize or delete a finalized record;
- change its complaints or diagnoses;
- update, delete or truncate audit events;
- change amendments, retry records or notifications;
- read the migration history;
- grant itself privileges, superuser or the owner role;
- take ownership.

## 5. Backup and restore

**Backup:**

| Item | Value |
| --- | --- |
| Time | 2026-11-05 12:41:53 UTC |
| Method | `pg_dump --format=custom medicare_staging`, run as the read-only backup role over TLS `verify-full` from the operations network |
| Artifact | `medicare-staging-20261105-1241.dump` in the staging backup directory, 101,027 bytes |
| SHA-256 | `c26d06c4c7ee81b5d5c69ddd8ddecf61a88b45e5f113dbfb73c34cd68f4adcfa` |
| Result | Success. The database was unchanged during the dump (`restore-check.sql` identical before and after). The backup role cannot write. The archive lists every table, the trigger functions and the migration history |

**Restore:**

- **Method:** `createdb medicare_verify`, then `pg_restore --no-owner --no-acl --single-transaction`,
  then `runtime-grants.sql`, all as the migration owner. Staging was never touched.
- **Comparison:** `restore-check.sql` matched the source on every table count and digest, plus the
  migration, trigger and constraint fingerprints.
- **Restored rows:**

  | Table | Rows |
  | --- | --- |
  | Staff | 8 |
  | Sessions | 51 |
  | Patients | 8 |
  | Appointments | 5 |
  | Encounters | 3 |
  | Complaints | 1 |
  | Diagnoses | 1 |
  | Amendments | 1 |
  | Notifications | 10 |
  | Recipients | 21 |
  | Audit events | 147 |
  | Retry records | 19 |

- **Behaviour:** a second API instance on the copy, as the runtime role, reported ready and accepted
  sign-in.
- **Protections held:** the finalized record and its amendment were present. Editing the record
  was still refused (23514). Audit and amendment changes and trigger disabling were still refused
  (42501).

**Disaster-recovery sessions:** the documented statement revoked every carried-over live session
before reopening. A session cookie issued by staging before the backup was then refused (401) by
the restored instance.

**Cleanup:** the verification sessions were revoked, the verification API removed and the copy
dropped. Nothing restored was left usable.

## 6. Logging and monitoring

**Logs scanned:** the API (1,457 JSON lines), proxy and database logs were scanned for every
synthetic value used:

- 21 passphrases;
- session tokens and CSRF tokens;
- 40 Idempotency-Key values;
- phone numbers;
- 39 clinical notes, complaints, diagnoses and amendment bodies;
- broadcast bodies;
- database credentials;
- staff emails.

**Result:** none appeared (33/33). API entries carry a request ID, method, status and timing, with
no URL, headers, cookies or bodies. Every proxy request ID in the current API container's lifetime
matched an API log entry, which supports correlation from a support reference. The database log
records refused privileged statements and refused connections by role, which is useful for
security monitoring and must itself be access-controlled.

**Monitoring readiness:** no provider is integrated. Each runbook signal was shown to be observable
in staging:

| Signal | Shown in staging |
| --- | --- |
| Uptime and readiness | A probe polling readiness raised an alert after 5 s of 503 and recorded the recovery. The runbook suggests 1 minute in production |
| 5xx rate | Countable from the proxy log |
| Database availability | Readiness |
| Restarts | Container start times and states |
| Backup failure and age | Exit status and artifact age |
| Storage | Database size and volume usage |
| Scheduled-job failure | A job with a bad credential exits 1 with a fixed code and no URL |
| TLS expiry | Days remaining read from the live certificate; the staging certificate had 29 |

Owner, recipients and escalation are not decided.

## 7. Browsers, accessibility and manual checks

| Browser | Version | Result |
| --- | --- | --- |
| Google Chrome (installed) | 156.0.8078.80 | 14/14: sign-in, cookie, Light/Dark, form fields, date and date-time inputs, dialog, notification, administrator reset, reports, own password change, clinical editor, sign-out, storage |
| Microsoft Edge (installed) | 156.0.4314.58 | 14/14, same flows |
| Firefox engine (test build) | 157.0 | 14/14, same flows. **Not stock Firefox** |
| WebKit engine (Windows test build) | 26.5 | 13/13, same flows. **Not Safari.** See the note below |
| Apple Safari, stock Firefox | — | **Unverified** |

**WebKit note:**

- **Cookies:** the Windows WebKit build reports the cookie as `SameSite=None`. It does not implement
  SameSite; the server sends `Strict`.
- **CSP reports:** it reports `style-src-attr` refusals when the application sets styles from
  script.
- **What the application sets:** chart positions, report bar widths and the dialog scroll lock.
- **Effect:** a side-by-side probe showed those styles still applied exactly as in Chrome.
- **Risk for Safari:** if Safari blocked them, report bars and chart labels would lose their
  geometry. The figures and data tables would remain. Check it on the hospital's Apple devices.
- **Correction:** this replaces the Step 17 statement that the application sets no inline styles.

**Other checks:**

- **Screen reader: unverified.** NVDA is not installed and Narrator could not be driven here.
- **Automated scan (not a screen reader):** an axe-core scan found no serious or critical issue on:
  - sign-in and Overview;
  - Patients, Appointments, Notifications, Staff and Reports;
  - the patient form dialog and a finalized clinical record.

  The finalized record's accessibility tree exposes its heading structure and amendments.
- **High contrast: unverified on Windows.** Only Chrome's forced-colours emulation was used. In it,
  sign-in, navigation, forms, status badges and dialogs stayed readable, with outlined controls and
  a visible focus ring. The current navigation item was not visually distinguished, although it is
  still announced as the current page.
- **Saved-password autofill: unverified.** It cannot be automated. A person must check it on
  hospital devices in Light and in Dark.

## 8. Customer scope

**Included:**

- authentication and the password lifecycle;
- staff access management;
- patients;
- appointments;
- clinical records (drafts, finalization, permanent amendments);
- notifications and broadcasts;
- role dashboards;
- patient, appointment and clinical-activity reports.

**Intentionally absent:**

- exports and printing;
- pharmacy;
- laboratory;
- billing;
- inventory;
- a patient portal;
- real-time updates (pages refresh on request);
- emailed password reset;
- MFA;
- staff search and staff name or email editing.

**Reporting time zone:** dashboards and reports use UTC calendar periods, with Monday-start weeks.
The documentation and the screens say so. This needs the hospital's acceptance. If it needs
Ghana-local or another institutional time zone, record that as a separate backend requirement
before production. It was not changed here.

## 9. Findings

| Level | Finding | Status |
| --- | --- | --- |
| P0 | None | — |
| P1 | None | — |
| P2 | `npm run bootstrap:admin` does not work in a production install without development tools | Runbook now gives `node server/dist/cli/bootstrapAdmin.js` |
| P2 | The earlier statement that the application sets no inline styles was wrong; the Safari behaviour is unknown | Documents corrected; check Safari |
| P2 | Safari, stock Firefox, screen readers, Windows high contrast and saved-password autofill are unverified | Open; hospital devices |
| P2 | Sign-in and password-change limits are held per process | Open by design; run a single API instance |
| P3 | The shutdown log line shows `reason: [REDACTED]` (redaction is too broad), so logs alone cannot tell a planned stop from a crash; the exit status still can | Open |
| P3 | A database created with `createdb` lets `PUBLIC` connect | Runbook now says to revoke it on restored copies |
| P3 | In forced colours, the current navigation item is not visually distinct | Open; check on Windows high contrast |
| P3 | With the API stopped, nginx answered 504 after its 5-second connect timeout | Proxy tuning note |
| P3 | Concurrent sign-ins from one address near the limit can briefly get 429, because requests count until they succeed | Expected limiter behaviour; noted |

Every first-run failure in the staging scripts was a test-script problem: a selector, an exact
message, a schema name or a test key format. Each was corrected and the scenario rerun. No product
change was made in this step.

## 10. Automated regression

| Command | Result |
| --- | --- |
| `npm install` | Passed, 0 vulnerabilities |
| `npm run prisma:generate` / `prisma:validate` | Passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | 509 passed (13 files) |
| `npm run test:client` | 807 passed (38 files) |
| `npm run test:database` | 779 passed (13 suites, each deploying eleven migrations twice with nothing pending the second time) |
| `npm run build` | Passed |
| `git diff --check` | Clean |

**Total: 2,095 tests across 64 files**, unchanged from the baseline; no test was weakened.

**Staging acceptance:** 458 checks passed in their final runs.

| Area | Checks |
| --- | --- |
| Infrastructure | 62 |
| Roles | 73 |
| API and database | 76 |
| Operations | 42 |
| Browsers, themes, responsive and accessibility | 172 |
| Logs | 33 |

## Conditions before production deployment

1. **Commit:** the owner reviews and commits Steps 16.1–18, including the deleted QA artifacts, then
   reruns the full suite on the committed revision.
2. **Backup decisions:** the hospital completes the runbook's backup table with named roles: owner,
   schedule and method, recovery objectives, retention, encryption and keys, off-site copy,
   rehearsal frequency and escalation.
3. **Monitoring:** the hospital names the monitoring owner, alert recipients and escalation process,
   and configures the runbook's checks.
4. **Scheduled jobs:** daily `sessions:prune`, `idempotency:prune` and backups are scheduled on the
   real platform, with failure alerts.
5. **Real infrastructure:** repeat this deploy order and smoke test on the hospital's real hosting:
   - the real hostname and certificate (with renewal);
   - the real proxy, with `TRUSTED_PROXY_CIDRS`;
   - separate owner, runtime and backup database identities;
   - the frontend headers;
   - a single API instance.
6. **Manual device checks:** saved-password autofill in Light and in Dark; Windows high contrast if
   staff use it; Safari on any Apple devices; a screen reader if staff rely on one.
7. **Time zone:** the hospital accepts UTC reporting periods, or records a time-zone requirement.
8. **Sign-off:** staff training and the signed [acceptance checklist](release-acceptance-checklist.md).

## Appendix: tested nginx settings

```nginx
upstream medicare_api { server api:4000; keepalive 8; keepalive_timeout 4s; }
server { listen 80; return 301 https://<host>$request_uri; }
server {
  listen 443 ssl; http2 on; ssl_protocols TLSv1.2 TLSv1.3; server_tokens off; root /srv/medicare/frontend;
  location /api/ { proxy_pass http://medicare_api; proxy_http_version 1.1; proxy_set_header Connection "";
    proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https; proxy_next_upstream off; }
  location /assets/        { try_files $uri =404; <security headers>; add_header Cache-Control "public, max-age=31536000, immutable" always; }
  location = /theme-init.js { <security headers>; add_header Cache-Control "no-cache" always; }
  location = /favicon.svg   { <security headers>; add_header Cache-Control "no-cache" always; }
  location ~ \.(map|env)$   { return 404; }
  location /               { try_files $uri /index.html; <security headers>; add_header Cache-Control "no-cache" always; }
}
# access_log format: $remote_addr [$time_iso8601] "$request_method $uri" $status $body_bytes_sent rid=$upstream_http_x_request_id rt=$request_time
```

`<security headers>` is the runbook's header block, repeated in each location with `always`.
nginx does not inherit `add_header` into a location that sets its own.
