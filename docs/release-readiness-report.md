# Release readiness report

## Current decision (Step 18, 5 November 2026)

**CONDITIONAL GO.** Final release acceptance ran on a production-like staging stack, with
458 of 458 checks passing in their final runs:

- **Infrastructure:** HTTPS on a staging hostname through nginx, the production build, and PostgreSQL
  18 with separate owner, runtime and backup identities over TLS.
- **Role walkthroughs:** Admin, Records Officer and Doctor, including the full clinical workflow.
- **API and data controls:** idempotency, the password lifecycle and both prune jobs.
- **Operations:** backup and restore into a separate database, a readiness outage, and a real
  `SIGTERM`.
- **Browsers:** Chrome, Edge and the Firefox and WebKit engines, at five widths in both themes.
- **Logs:** the scan found no sensitive values.

No P0 or P1 software issue was found. Production deployment may begin only after these
operational and customer conditions are closed:

- the backup and monitoring owner decisions;
- scheduled jobs on the real platform;
- a rehearsal on the hospital's real hosting;
- the manual autofill, high-contrast, Safari and screen-reader checks;
- the hospital's acceptance of UTC reporting periods.

See [final release acceptance](final-release-acceptance.md). The sections below are the earlier
4 November acceptance and its addendum, kept as the historical record.

## Q. Final recommendation (summary, 4 November candidate)

**CONDITIONAL GO.** No P0 issue was found. Four P1 defects found during acceptance were fixed and re-verified in the browser and by new regression tests. The explicitly scoped product may proceed to controlled customer acceptance with synthetic data. Production use and customer handoff require the prerequisites listed in section Q to be closed first.

## A. Candidate and date

| Item | Value |
|---|---|
| Candidate | Step 14 working tree on `main` (uncommitted changes on top of `a9e51c7`), 4 November 2026 |
| Scope | Authentication, patients, appointments, clinical records (drafts, finalization, amendments). Staff administration, notifications, dashboard analytics and reports/exports are intentionally unavailable and shown as such |
| Environment | Windows 11 Pro, Node.js 22.16.0, disposable loopback PostgreSQL 18.6 cluster, synthetic data only |
| Production-like setup | Built API (`server/dist`) with `NODE_ENV=production`, restricted runtime database role, `TRUSTED_PROXY_CIDRS=127.0.0.1`, built client (`client/dist`) served same-origin through a local HTTPS reverse proxy (self-signed certificate) at `https://localhost:18443` |

No production, staging or real patient data was used.

## B. Current automated verification

| Command | Result |
|---|---|
| `npm install` | Passed; dependencies up to date, 0 vulnerabilities |
| `npm run prisma:generate` | Passed |
| `npm run prisma:validate` | Passed |
| `npm run typecheck` | Passed, both workspaces |
| `npm run lint` | Passed, no warnings |
| `npm test` (server, no database) | 483 passed, 12 files |
| `npm run test:client` | 387 passed, 18 files |
| `npm run test:database` | 714 passed, 10 files; every suite deployed all eight migrations twice, with no pending migrations on the second deploy |
| `npm run build` | Passed; client 321 kB JavaScript and 26 kB CSS, server compiled to `server/dist` |
| `npm audit` (all and `--omit=dev`) | 0 vulnerabilities (464 dependencies) |

**Total: 1,584 unique passing tests across 40 files** (387 frontend + 483 backend unit + 714 database). The 1,570 baseline rose to 1,573 during earlier acceptance work; this continuation added 11 focused regression tests (8 frontend, 3 database). One existing frontend expectation was tightened: it now asserts that a patient edit sends only the changed field. No test was removed, skipped or weakened.

Two intermittent test-harness failures were seen during acceptance and are recorded as P3: one server unit run where Vitest failed to load all 12 files ("failed to find the current suite"), which passed unchanged on immediate rerun; and the notification race test "rechecks revoked after a queued broadcast", which allows 2 seconds for a request to reach a database lock and failed once while browser tests were loading the machine. Neither recurred in the final run: all 12 unit files and the complete notification suite (105/105) passed on an otherwise idle machine.

## C. Browser verification

Browser acceptance continued from the earlier checkpoint (login, session restoration, patient registration, CSRF rejection and retry on registration, archive/reactivate, layout at 320/375/768/1024/1440 px, native appointment date/time editing). Automated browser scenarios drove the production build in Chrome 156 with separate contexts per role. Soft assertions recorded each check; failures were investigated and classified as product defects (fixed, section P) or test-script issues (corrected and re-run).

| Scenario | Result |
|---|---|
| Zero data: Overview, Patients, Appointments, Medical records, Staff/Reports/Notifications unavailable pages, at 1440 and 375 px for Admin, Records Officer and Doctor | 76/76 |
| Records Officer acceptance | 43/43 |
| Admin acceptance | 43/43 (two runs; the first stopped on a test-script selector) |
| Doctor acceptance and full clinical workflow | 52/56 on first run. One real defect (complaint/diagnosis order) was fixed and re-verified; the three others were test-script timing and whitespace assumptions |
| Session expiry/revocation, CSRF, network failure, uncertain writes, duplicate-action guards, stale clinical tab | All checks pass after fixes, except one P2 finding left open (section P) |
| Stale patient/appointment data and duplicate actions | 17/18; the remaining item is the open P2 duplicate-patient finding |
| Long data and responsive (remaining screens) at five widths | 124/124 |
| Cross-browser | 62/64; the two WebKit-only items are platform behaviour (section D) |
| Keyboard and automated accessibility rules | 43/44 after a contrast fix; the remaining item was a measurement artifact confirmed visible by direct inspection |
| Non-UTC time zones: booking at 10:00 in America/Chicago stored as 16:00 UTC; the same appointment displayed and pre-filled as 17:00 in Africa/Lagos | 4/4 |
| Backup/restore drill | 10/10 |

## D. Cross-browser coverage

| Browser | Version | Coverage | Result |
|---|---|---|---|
| Google Chrome | 156.0.8078.80 (installed) | Full acceptance plus representative pass | Pass |
| Microsoft Edge | 156.0.4314.58 (installed) | Sign-in, cookie flags, refresh, patient form, date field, booking via date/time field, reschedule, clinical dialog textarea, Escape/focus, storage, logout | Pass (16/16) |
| Firefox engine | Gecko 157.0 automation build | Same representative pass | Pass (16/16) |
| WebKit engine | 26.5 Windows automation build | Same representative pass | 14/16, see below |
| Mozilla Firefox (stock), Apple Safari (macOS/iOS) | Not installed / not available on Windows | **Not tested** | Unverified |

Stock Firefox is not installed; Gecko results come from the automation build of the same engine. WebKit on Windows is not Safari:

- It renders `date` and `datetime-local` as plain text fields. Typing `YYYY-MM-DD` / `YYYY-MM-DDTHH:MM` worked, but this does not represent Safari, which has native pickers.
- Its cookie store reports `SameSite=None`, although the server's `Set-Cookie` header was confirmed to carry `HttpOnly; Secure; SameSite=Strict`.
- Mouse clicks do not focus buttons there, so closing a mouse-opened dialog returns focus to the page heading. Keyboard-opened dialogs return focus to their trigger.

**Safari must be tested on the hospital's Apple devices before they are supported.**

## E. Accessibility coverage

- Keyboard-only: sign-in (Tab order, Space on the password toggle, Enter to submit), focus moved to the page heading after navigation, skip link, navigation buttons, patient form, booking dialog including the searchable patient picker (focus moves to "Clear patient selection" after choosing), clinician select and date/time arrows, clinical editor (40 Tab presses stay inside the dialog), and a keyboard-only amendment. Tab/Shift+Tab containment held in every dialog; Escape asks before discarding unsaved text; focus returned to the trigger.
- Visible focus: a 3 px outline on all tab stops. Native date fields additionally highlight the active segment.
- Automated axe-core WCAG 2.1 A/AA rules found one serious issue, insufficient contrast on the appointment schedule eyebrow text. It was fixed by using the shared muted text colour. The sign-in page, patient directory and form, appointment schedule, booking dialog, finalized record, amendment dialog and clinical editor then reported no serious or critical violations.
- **Screen reader: not tested.** NVDA is not installed and Windows Narrator was not driven. Accessibility-tree inspection confirmed named navigation, table column headers, named dialogs, `role="alert"` errors and `role="status"` notices, but this does not replace a screen-reader pass. No accessibility certification is claimed.

## F. Admin acceptance

Booking with patient lookup and an active-doctor-only clinician lookup; a scheduling conflict refused in the dialog with values kept and no write; reschedule; confirm; early check-in blocked in the UI and by the server; check-in allowed within 60 minutes of start; separate cancellation with a reason, history retained after refresh and listed under the Cancelled filter. No Medical records navigation, no clinical link on appointment or patient detail. Clinical API calls return 403 and the session stays valid. Staff, Reports and Notifications pages are honest "not yet available" panels with no controls or figures.

## G. Records Officer acceptance

Lands on Patients; navigation is Patients, Appointments and Notifications only. Covered: registration with long names, search by surname, number and zero results, edit, archive with non-deletion wording, archived filter, reactivate, pagination; appointment listing, booking, reschedule, confirm, check-in, complete; search, status, type, clinician and custom-date filters and pagination. Clinical list, history and create calls return 403 while the session remains valid. No clinical content, staff administration, reports or simulated notifications. Logout ends the server session.

## H. Doctor acceptance

Doctor navigation; "My appointments" shows own assignments only. Another doctor's appointment is absent from lists and search and returns 404 when requested directly. No booking, reschedule or cancellation controls, and the server forbids all three (403). Full clinical workflow:

1. Confirm and check in own appointment, start the encounter.
2. Enter a 6,800-character history, notes, plan, three complaints and three diagnoses.
3. Save draft, reload, reopen; content persisted with line breaks.
4. Edit the draft, then finalize: editing controls disappear and the record is read-only.
5. Add amendment 1, reload: original unchanged, amendment separate.
6. Add amendment 2: amendment 1 unchanged and both displayed independently.
7. Open the record through patient clinical history.

Forbidden behaviour was refused: editing or re-finalizing a finalized record (409), amendment edit/delete and encounter delete routes (404), direct SQL updates to finalized content or amendments (blocked by triggers, even for the database superuser), and a second doctor amending or editing (403/409, no mutation controls shown).

## I. Session, CSRF and recovery tests

- **Session loss:** expiry (controlled `expiresAt` change) during unsaved amendment text, and administrator revocation during an unsaved registration. Both produced 401, a return to sign-in, removal of protected content, no write, no false success and no replay. No clinical or demographic text reached browser storage. Limitation: unsaved text is deliberately discarded on session loss for privacy.
- **CSRF:** invalid token on an appointment status change and on a clinical amendment, and a missing token on cancellation. Each was rejected with "security token needs refreshing", nothing was written, there was no automatic replay, typed text was kept, and a deliberate retry fetched a fresh token and succeeded.
- **Read failure:** 503 on the appointment list and clinical detail, a dropped patient-list connection, and a 503 on session restoration. Each stopped loading with a useful message and support reference and offered a retry that worked; the user stayed signed in.
- **Uncertain writes:** with responses dropped after commit, clinical writes show "could not be confirmed … refresh before submitting again". Patient and appointment writes now give equivalent check-first guidance (previously "Please try again"). Chrome was observed to resend a POST automatically when a reused connection closed before any response byte. The application never retries by itself, but this transport resend created a duplicate amendment (fixed, P1-3) and can create duplicate patients or walk-in drafts (open, P2-1).
- **Duplicate actions:** six synchronous activations of Save draft (create and edit), Confirm finalization, Add amendment, Create appointment, status change, archive and reactivate each sent exactly one request and wrote once.
- **Stale and concurrent data:** a stale patient detail refreshes correctly, and a stale patient edit form no longer reverts another user's change (fixed, P1-2). Same-field edits are last-save-wins with no warning (documented). A stale appointment status action and a stale edit after external cancellation are rejected with refresh guidance and recover on refresh. **Clinical: a second tab that still showed draft controls after finalization elsewhere could not overwrite the finalized record** (409, clear message; content verified unchanged). A stale draft tab changing one field did not revert other fields. There is no clinical revision token; drafts are last-save-wins per field.

## J. Production configuration

| Setting | Finding |
|---|---|
| `NODE_ENV` | `production` enables Secure cookies; production has no fallback for port, origin, database URL or log level |
| `PORT` | Required in production (missing value rejected) |
| `DATABASE_URL` | Required; acceptance used a restricted runtime role (section N) |
| `CLIENT_ORIGIN` | Production requires one exact HTTPS origin; HTTP, `*`, paths and trailing slashes are rejected. CORS allows only that origin, with credentials and no wildcard |
| `LOG_LEVEL` | Required; `info` verified |
| `TRUSTED_PROXY_CIDRS` | Only explicit addresses or bounded ranges; `/0` rejected. Must be set to the real proxy so sign-in limiting sees client addresses |
| `VITE_API_URL` | Build uses relative `/api/v1`; the bundle contains no localhost or development URLs, no source maps and no secrets |
| Cookies | `medicare_session`: `HttpOnly; Secure; SameSite=Strict; Path=/`, eight-hour expiry; not readable by JavaScript; cleared on logout (verified in Chrome, Edge and the Firefox engine) |
| Secrets | None in tracked or untracked project files; `server/.env` is ignored and untracked; no credential appears in git history |

The real hospital hostname, certificate, renewal and proxy were not available and remain prerequisites.

## K. Migration readiness

All eight migrations applied from scratch to a fresh database; a second `migrate deploy` reported no pending migrations and `migrate status` reported the schema up to date. The built server started against the migrated database with the runtime role and reported ready. Review found no destructive data changes. Risk points for a real deployment: the `btree_gist` extension (provider support and privileges), GiST exclusion constraints that fail if overlapping active appointments already exist, enum value additions, trigger and function installation, and index/constraint builds that can lock tables. Rehearse on a copy of the target database and PostgreSQL version. Historical migrations were not modified.

## L. Backup and restore

`pg_dump` 18.6 custom format of the acceptance database (4 staff, 36 patients, 39 appointments, 11 encounters, 61 complaints, 48 diagnoses, 25 amendments, 496 audit events), restored with `pg_restore --no-owner --no-acl --single-transaction` into a fresh database.

- Row counts and SHA-256 row digests matched for all eight tables.
- Migration records and trigger counts matched.
- Finalized-record and audit immutability triggers were active after restore.
- Runtime grants re-applied; the built production server started, a doctor signed in, finalized content and amendments matched, edits to finalized records were still refused, and Records Officer clinical access was still denied.
- 69 unexpired synthetic sessions were carried into the restored copy. The runbook now gives the revocation step.

This proves the dump/restore method on this data size only, not the customer's backup schedule, storage, encryption or recovery objectives.

## M. Logging and monitoring

The production log (1,094 entries) was scanned for every synthetic clinical marker, patient name, email, phone, password, cookie, CSRF value and token pattern: **zero matches**. Entries are JSON with timestamp, level, service, request ID, method, status and response time; URLs, bodies and headers are omitted. A render failure logged only a fixed non-sensitive message.

During a controlled database outage, `GET /api/v1/health` stayed 200 while `GET /api/v1/health/ready` returned 503 in under 0.2 s and recovered without a restart; an error-level entry with code `SERVICE_UNAVAILABLE` was written. Monitoring should cover process availability and restarts, readiness, database connectivity, and sustained error-level entries or 5xx responses. No monitoring provider was integrated.

## N. Security review

- Authorization: every role boundary tested in browser and API was enforced server-side (section F–H); 403 never ended a session.
- Clinical integrity: finalized records and amendments are protected in the UI, the API and the database (triggers block even privileged SQL while enabled).
- Database privileges: the full browser acceptance ran under a non-superuser, non-owner role that cannot create databases, roles or schemas, cannot update audit events or amendments, and has DELETE only on draft complaints and diagnoses. The verified grant set is now in the [release operations runbook](release-operations.md). The repository's example configuration uses a single account; if the runtime account owns the tables it can disable the immutability triggers, so separate identities are a deployment prerequisite.
- Sign-in limiting: fixed so successful sign-ins no longer count (P1-4). Failures remain limited to 10 per address per 15 minutes; the store is per process.
- Browser storage: no `localStorage` or `sessionStorage` keys, IndexedDB databases, Cache Storage entries or service workers in any browser; the session cookie is HttpOnly.
- Dependencies: `npm audit` reports 0 vulnerabilities.

## O. Known limitations

1. No optimistic concurrency token: same-field edits to drafts and demographics are last-save-wins without a warning.
2. Browser transport resends after a dropped connection could create a duplicate patient (when date of birth or phone is missing) or a duplicate walk-in draft. Resolved after acceptance in Step 13.1 for requests carrying an `Idempotency-Key`, which the Medicare frontend always sends (see the addendum). API clients that send no key remain exposed, and duplicates still cannot be removed through the application.
3. No void or delete workflow for drafts; no patient merge.
4. Duplicate-patient detection requires both date of birth and phone.
5. Times follow the workstation time zone; workstation clocks and zones must be correct.
6. The sign-in limiter is in-process: single API instance only until a shared store is added.
7. Unsaved text is discarded on session loss; there is no autosave.
8. Safari, stock Firefox and screen readers were not tested.
9. Staff administration, notifications, dashboard analytics and reports/exports are not delivered.

## P. Findings

### P0: release blockers

None found.

### P1: fixed during this continuation

| ID | Finding | Fix and verification |
|---|---|---|
| P1-1 | Complaints and diagnoses written together shared one timestamp, so they were returned in random UUID order. A finalized record could permanently show diagnoses in a different order from the one the doctor entered, and the reopened editor renumbered them | Children now receive distinct, increasing creation timestamps in entry order (no schema change). New database test fails on the old code and passes now; browser re-verified create, edit, display and editor numbering |
| P1-2 | The patient edit form sent every field, so a form opened before another user's change silently reverted that change (verified: a concurrent phone update was overwritten by an unrelated middle-name edit) | The edit now sends only fields changed in the form; an unchanged form is not sent. Tests updated (the full-body expectation now asserts only the edited field) and added; browser re-verified that the concurrent change survives |
| P1-3 | A browser transport resend after a dropped response stored the same permanent amendment twice (verified in Chrome) | The server rejects an amendment identical in author, reason and content to an existing one on the same encounter (409 `DUPLICATE_AMENDMENT`, serialized by the existing row lock), and the UI explains that the amendment is already recorded. New database test (sequential and concurrent resends) fails on the old code; browser re-verified exactly one amendment |
| P1-4 | Login limiting counted successful sign-ins: the 11th valid sign-in from one address within 15 minutes was refused (verified). Behind a proxy without `TRUSTED_PROXY_CIDRS`, or behind a shared hospital NAT address, a shift change would lock staff out | `skipSuccessfulRequests` enabled; failed attempts are still limited. New database test fails on the old code; full auth suite passes; documentation updated |

### P2: should fix before general release

| ID | Finding | Status |
|---|---|---|
| P2-1 | Browser resend after a dropped response can create a duplicate patient (no date of birth or phone) or a duplicate walk-in draft (both verified) | Resolved in Step 13.1: server-side `Idempotency-Key` replay for patient, encounter and broadcast creation, verified in Chrome with dropped responses (see the addendum) |
| P2-2 | Patient and appointment writes with an unconfirmed result said "Please try again", inviting blind resubmission | Fixed: check-first messages; tests added |
| P2-3 | After an interrupted booking, the browser's resend showed a conflict with the user's own booking | Mitigated: conflict message now advises refreshing the schedule first |
| P2-4 | Appointment schedule eyebrow text below WCAG AA contrast | Fixed |
| P2-5 | No optimistic concurrency warning for same-field edits (drafts, demographics) | Open, documented |
| P2-6 | Safari, stock Firefox and screen readers untested | Open, test on customer devices |

### P3: post-release improvements

| ID | Finding |
|---|---|
| P3-1 | An earlier success notice stayed visible while a later amendment attempt failed. **Fixed**: the notice clears when a clinical dialog opens; test added |
| P3-2 | Form-level validation errors are announced (`role="alert"`) but not linked to the specific field (`aria-invalid` / `aria-describedby`) |
| P3-3 | The sign-in page's `h1` is marketing copy; the form heading is `h2` |
| P3-4 | Browsers log "Failed to load resource: 401" for the session check on the sign-in screen |
| P3-5 | `pg` prints a deprecation warning at server start (future `pg@9` incompatibility); keep the `^8` range until the Prisma adapter is updated |
| P3-6 | Error log entries repeat the `requestId` key |
| P3-7 | Two timing-sensitive test-harness flakes (section B) |
| P3-8 | Developer-tooling metadata (`server/skills-lock.json`) is tracked; decide whether it belongs in delivered source. **Resolved in Step 18:** removed from the working tree and ignored |

## Q. Final recommendation

**CONDITIONAL GO.** Prerequisites before customer handoff:

1. Product owner reviews and commits this working tree, then re-runs the full suite on the committed revision.
2. Deploy to the customer's real HTTPS hostname behind the real reverse proxy, with `TRUSTED_PROXY_CIDRS` set, and repeat the smoke test: sign-in, refresh, CSRF, logout, readiness.
3. Provision separate migration and runtime database identities using the documented grant set; confirm the runtime account is not the table owner.
4. Name a backup owner, set recovery objectives, and rehearse a restore from the real backup mechanism.
5. Configure monitoring and alert recipients (readiness, restarts, 5xx/error-level entries, database connectivity).
6. Test on the hospital's actual browsers and devices, including Safari if Apple devices will be used, and with any assistive technology staff rely on.
7. Hospital decisions on retention, legal holds, access review and disposal (below).
8. Complete staff training with the [staff release guide](staff-release-guide.md) and sign the [acceptance checklist](release-acceptance-checklist.md).
9. Accept or schedule the remaining open P2 items; P2-1 is resolved. Schedule the daily idempotency record prune (see the runbook).

### Data retention: current semantics and customer decisions

Current behaviour: patients are archived, never deleted; appointments keep their history, including cancellations; finalized clinical records are immutable; amendments only append; audit events are append-only; sessions are retained as revoked or expired rows; backups contain all of these. The hospital must define, with appropriate legal and policy review: retention periods for patient, appointment, clinical, amendment and audit records; legal-hold handling; when archived patients may be disposed of and by what controlled process; session-row retention; backup retention, expiry and destruction; log retention and access; and who approves any disposal. No retention period is implied by this release.

## Addendum: changes after this acceptance run

The decision above was made on the 4 November candidate. Eight changes followed. Repeat the affected parts of customer acceptance before relying on this report for them.

- **Step 13, notifications frontend:** the Notifications screen is a real inbox with an unread badge, read state, appointment links and administrator broadcasts. It passed 138/138 live checks; see [notification frontend integration](frontend-notification-integration.md).
- **Step 13.1, mutation idempotency:** patient registration, clinical encounter creation and broadcasts accept an `Idempotency-Key`, and the frontend sends one for every submission. A resent request within 24 hours returns the original result instead of writing again. Migration `20261104120000_mutation_idempotency` adds one table; nine migrations now deploy. In Chrome, one dropped response followed by an automatic browser resend, and two dropped responses followed by a deliberate retry, each stored exactly one patient, broadcast or walk-in draft (43/43 live checks). See [mutation idempotency](idempotency.md).
- **Step 14, staff administration frontend:** Staff & Access is an Admin-only workspace over the existing staff API, with no backend change. It covers the directory with server totals, role and status filters, adding accounts, role changes, suspend, reactivate, permanent disable and session sign-out. Every change is confirmed and none is shown optimistically. It passed 114/114 live checks, including target sign-out after role, status and session changes, last-admin refusals and self-action sign-out; see [staff administration frontend](frontend-staff-administration.md). Known limitation 9 now applies only to dashboard analytics and reports/exports.
- **Step 15, dashboard and reports frontend:** every role lands on a server-chosen Overview that separates current status from period activity, and Reports offers the reports each role may read. Admins and Records Officers get patient and appointment activity; doctors get their own clinical activity. Periods are UTC calendar dates with day, Monday-week or month grouping, and charts include text summaries and data tables. There is no backend change and no export. The unused mock data module was removed. It passed 96/96 live checks, where every displayed figure matched values computed from the database, including UTC-midnight boundaries and identical labels in far-west and far-east browser time zones; see [dashboard and reports frontend](frontend-dashboard-reports.md). Known limitation 9 now applies only to report exports.
- **Step 16, final UI/UX consistency pass:** the frontend now uses one shared design system and one Medicare wordmark. Dialogs, footers, statuses, forms, loading and empty states, feedback and pagination are consistent across modules. Field borders and text meet contrast minimums, and appointment and clinical detail views are restructured for scanning. Unconfirmed-save messages tell staff when resubmitting the unchanged form is safe (registration, new drafts, broadcasts and amendments). Choosing a workspace in the navigation always opens its landing view. Unused template assets and components were removed. There is no backend, contract or business-rule change. The live walkthrough covered three roles, every major screen and five widths; see [final UI/UX review](final-ui-ux-review.md).
- **Step 16.1, orange-and-white branding and dark mode:** the client's original orange palette was recovered from the first frontend (commit `1e93826`) and restored, with darker steps from the same family wherever text or marks need contrast. A Light, Dark and System theme choice sits in the navigation footer, the mobile menu and on sign-in. It is stored only as `medicare-theme` in the browser and applied before the first paint by `client/public/theme-init.js`, which must be served with revalidation. Status colours keep their meanings in both themes; destructive actions moved to rose-crimson so they cannot be mistaken for orange primary actions. There is no backend, contract or business-rule change. The Chrome walkthrough passed 1,117/1,117 checks across three roles, both themes and five widths; see [branding and dark mode](branding-dark-mode.md).
- **Step 17, production and security hardening:** see [production security hardening](production-security-hardening.md) and the rewritten [release operations runbook](release-operations.md).
  - **Accounts and credentials:**
    - staff creation is idempotency-keyed;
    - staff can change their own password, which signs them out everywhere;
    - administrators can reset passwords and set a pending account's first password.
  - **Maintenance and database roles:**
    - expired sessions are pruned by a scheduled command;
    - `server/ops/runtime-grants.sql` grants the runtime role exactly what it uses and refuses an unsafe role;
    - every attempt by that role to bypass clinical, amendment, audit, notification or retry-record protection was refused.
  - **Production configuration:**
    - production cookies use the `__Host-` prefix;
    - production refuses to start without `TRUSTED_PROXY_CIDRS`;
    - API responses deny all resources and framing;
    - the frontend Content-Security-Policy and cache headers are specified and were verified in the browser.
  - **Migrations:** two were added (eleven now deploy), affecting only enum values and the small `IdempotencyRecord` table.
  - **Live check:** the production-build walkthrough passed 93 of 95 checks across Chrome, Edge, and the Firefox and WebKit engines. It covered cookies, headers, CORS, proxy trust, rate limiting, a readiness outage and recovery, maintenance commands, password flows, a log scan and a backup/restore drill whose `restore-check.sql` comparison matched exactly.
    - The two failures are one observation: the Windows WebKit build reports Content-Security-Policy refusals. **Corrected in Step 18:** these refusals come from styles the application sets from script, not from native drop-down rendering. Those styles are chart positions, report bar widths and the dialog scroll lock. CSP permits them, and a side-by-side probe showed the WebKit engine applies them exactly as Chrome does. Safari must be checked on Apple devices.
- **New operational prerequisites:**
  - apply `server/ops/runtime-grants.sql` after every migration and restore;
  - schedule `sessions:prune` and `idempotency:prune` daily;
  - set `TRUSTED_PROXY_CIDRS` (or `none`);
  - serve `client/dist` with the runbook's headers;
  - complete the runbook's backup decisions table.
- **Automated totals after these changes:** 2,095 tests across 64 files (807 client, 509 server unit, 779 database). Install, Prisma generate/validate, typecheck, lint, build and `git diff --check` pass, and every database suite deploys all eleven migrations twice.
- **New operational prerequisite:** grant the runtime role `DELETE` (not `UPDATE`) on `IdempotencyRecord` and schedule `npm run idempotency:prune --workspace @medicare/server` at least daily.
- **Step 18, final release acceptance on staging:** no product code changed. See [final release acceptance](final-release-acceptance.md).
  - **Staging stack:**
    - nginx with TLS on `staging.medicare.test`;
    - the production API build as an unprivileged, read-only container with no internet access;
    - PostgreSQL 18 requiring TLS and SCRAM, with separate owner, runtime and backup identities.
  - **Deploy order:** run twice, the first deployment then a redeployment with a backup first. Eleven migrations applied as the non-superuser owner, with nothing pending on the second run.
  - **Results:** 458/458 checks in their final runs. They covered cookies, CORS, headers, cache, a stale-page redeploy, themes, three role walkthroughs, idempotency, passwords, pruning, rate limiting with real client addresses, 25 refused runtime-role attacks, backup and restore with disaster-recovery session revocation, outage recovery, a real `SIGTERM`, four browser engines, five widths in both themes, and a log scan.
  - **Cleanup:** 24 tracked `.release-*` QA files and `server/skills-lock.json` were removed from the working tree and added to `.gitignore`.
  - **Documentation corrections:**
    - the production first-administrator command is `node server/dist/cli/bootstrapAdmin.js`;
    - database `CONNECT` privileges and the backup role are now specified;
    - the WebKit/CSP statement above is corrected.
  - **Still unverified:** Safari, stock Firefox, screen readers, Windows high contrast and saved-password autofill.
  - **Automated totals:** unchanged at 2,095 tests across 64 files.

