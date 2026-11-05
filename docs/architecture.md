# Architecture

The repository separates the browser application (`client/`) from the backend
(`server/`) using npm workspaces. Each workspace owns its runtime dependencies;
shared TypeScript and lint tooling live at the root with the single lockfile.
Root scripts delegate to each workspace. `npm run dev` still starts only the UI.

## Backend foundation

The selected stack is Node.js, strict TypeScript, Express 5, PostgreSQL, Prisma 7,
Zod, Pino, Vitest, and Supertest. `app.ts` exports a testable Express factory;
`server.ts` owns validated startup, database connectivity, and graceful shutdown.
Health routes exist under `/api/v1/health`; staff authentication and administration
now live under `/api/v1/auth` and `/api/v1/staff`.
Patient demographics now live under `/api/v1/patients`; see the
[patient API and domain permission policy](patient-api.md). Administrative patient
access is separate from clinical-record access; ADMIN has no implicit
clinical permissions. Patient services use explicit DTOs and transactional audits.
Appointment scheduling lives under `/api/v1/appointments`; see the
[appointment API](appointment-api.md). Doctors see only their assigned appointments.
PostgreSQL GiST exclusion constraints enforce patient and clinician scheduling
conflicts, while shared authorization/patient locks and appointment row locks
coordinate eligibility and lifecycle changes. Appointment writes and detail views
use transactional audits and explicit administrative DTOs.

Clinical encounters live under `/api/v1/encounters`, with patient history under
`/api/v1/patients/:patientId/encounters`; see [clinical records API](clinical-records-api.md).
Only active doctors have clinical permissions. They currently read all clinical
history, while only the original author may edit drafts, finalize or append
corrections. DRAFT becomes REVIEWED using reviewedAt. SQL triggers protect
finalized parent/child content and append-only amendments; mutations and audits
commit together. The service reuses authorization/patient advisory locks and
parent row locks. Broad doctor visibility and unavailable-author corrections
remain explicit policy decisions for later hardening. The timestamp validator is
shared with scheduling without changing appointment input behavior.

Internal notifications live under `/api/v1/notifications`; see the
[notification API](notifications-api.md). Each active staff account reads/manages
only its own delivery rows, while ADMIN may create ALL/ROLE broadcasts. Shared
content and recipient read state remain separate. Broadcasts snapshot active staff
under the authorization lock and commit content, recipients and one audit together.
Read-state mutations serialize per inbox and preserve the first read time. Simple
reads/counts avoid interactive transactions. Appointment assignment, actual
rescheduling/reassignment and cancellation create generic notices within their
existing transactions. A typed restrictive appointment FK supplies navigation
without patient data or extra resource privileges. There is no external delivery
or background worker. The
[notification frontend](frontend-notification-integration.md) consumes this API.

Patient registration, encounter creation, broadcasts and staff creation accept an optional
`Idempotency-Key` ([mutation idempotency](idempotency.md)). `shared/idempotency`
validates the header and stores only a key digest and a keyed digest of the
accepted input in `IdempotencyRecord`. Each record is scoped to the signed-in
staff account and operation, and links to the created resource. It is written in
the same transaction as the resource and audit, after the existing auth, CSRF and
permission checks. A per-scope advisory lock and a unique index make concurrent
resends replay instead of writing twice. Replays return the same resource with
`201` and `Idempotency-Replayed: true`, and write no audit. Records expire after
24 hours and are pruned by `npm run idempotency:prune`. The frontend's
`submissionKeys()` keeps one in-memory key per payload, reuses it only after an
unconfirmed outcome and never retries on its own.

The credential lifecycle adds `POST /api/v1/auth/change-password` (own password; signs out every
session) and `POST /api/v1/staff/:id/reset-password` (Admin; signs out the target). Scheduled
maintenance commands live in `server/src/cli/`:

- `bootstrap:admin`;
- `sessions:prune`;
- `idempotency:prune`.

Operator SQL lives in `server/ops/`: `runtime-grants.sql` for the restricted runtime role and
`restore-check.sql` for restore verification. See
[production security hardening](production-security-hardening.md).

Configuration is centralized in `server/src/config/env.ts`. The singleton Prisma
client uses the PostgreSQL adapter. The domain schema now separates staff,
patient demographics, appointments, encounters, complaints/diagnoses/amendments,
notifications/recipients, and append-only audit history. See
[data model and identity foundation](data-model.md) for relationships, constraints,
identifier/deletion policies, bootstrap, test isolation, and frontend mismatches.
Request IDs, restricted CORS, Helmet, bounded JSON parsing, safe errors, and
metadata-only logs form the shared HTTP foundation. Database-backed sessions,
session-bound CSRF and server-derived staff roles extend it; see
[authentication and administration](authentication.md). No regulatory compliance
is implied. See [server documentation](../server/README.md)
for setup, commands, response contracts, and operational behavior.

Dashboard/report aggregates live in `modules/reports`, exposed through
`/api/v1/dashboard` and `/api/v1/reports`. The server chooses the dashboard from the
current authenticated role. Operational reports are ADMIN/RECORDS_OFFICER only;
clinical activity is doctor-only and scoped to that doctor's authorship. Count/group
queries and parameterized PostgreSQL UTC buckets return aggregate DTOs without
patient or clinical detail. Half-open ranges are limited to 366 days, with at most
367 partial daily buckets. Shared authorization locking and a session/role recheck
protect queued reads. Clinical report views require a transactional audit; ordinary
dashboard and operational report reads do not emit audits. See
[dashboard/report contracts and limitations](dashboard-reports-api.md).
There is no reporting cache, worker, export, realtime channel or UI integration.

The audit browsing module remains future work. Create module directories as code is added.
Keep HTTP controllers thin and business rules in services. Frontend authentication
is integrated; see [frontend authentication](frontend-auth-integration.md).
Patient demographics UI is integrated; see [frontend patient integration](frontend-patient-integration.md).
The patient API module uses shared transport and keeps compatibility exports for
existing appointment callers. Appointment UI integration is complete; see
[frontend appointment integration](frontend-appointment-integration.md).
`api/appointments.ts` owns typed DTOs and read/mutation transport, with runtime
mutation field allowlists and compatibility re-exports from `lib/api.ts`.
Focused appointment list, form, lookup, detail and cancellation components use
server responses, abort stale reads and refresh affected lists after writes.
The patient picker reuses the active-patient API with bounded backend pagination;
the dedicated appointment clinician lookup returns active doctors to Admin/Records.
Doctors receive an own-assignment view and status actions only. Local timestamp
conversion is separate from patient DOB helpers and tested across DST changes.
Clinical UI integration is complete; see
[frontend clinical integration](frontend-clinical-integration.md).
`api/encounters.ts` maps the existing summary/detail DTOs and allowlists mutations
through shared credentialed, CSRF-protected transport. Doctor-only component and
navigation guards prevent Admin/Records clinical fetching. Patient history loads
only after explicit entry; own appointment detail discovers a linked record using
the existing `appointmentId` encounter filter. In-memory navigation retains patient
and appointment context. Draft editing requires both clinician and author identity;
`REVIEWED` is presented as Finalized and original content stays read-only.
Amendments are separate permanent entries, never replacement notes. Clinical state
is memory-only, with manual saves, server-confirmed writes and no payload logging.
The notification center reads only the signed-in account's inbox. One unread-count
hook in the application shell feeds the navigation badge and the inbox summary; it
refreshes on sign-in, navigation, deliberate refresh and read-state changes, never by
polling. Opening an unread notice marks it read and shows the server's `readAt`.
Appointment targets open the existing authorized appointment detail. Broadcast
composition is ADMIN-only. Notification text renders as plain React text.
Overview and Reports are described under Backend integration below.

## Frontend conventions

- `app/` owns application composition, navigation derived from backend roles, and the theme
  preference (`app/theme.ts`: Light, Dark or System, stored only as `medicare-theme`).
  `public/theme-init.js` applies the same preference before the first paint.
- `api/` owns credentialed transport, in-memory CSRF and safe auth DTOs;
  `features/auth/` owns the auth store, login and protected application gate.
- `features/<domain>/` owns feature screens and forms. Add feature-specific
  hooks, API calls, and tests alongside their implementations.
- `components/` contains UI reused across features: the `Brand` wordmark, `Dialog`
  (compact, standard and wide sizes), `Pagination`, `LoadingRows`, `ThemeControl` and the error boundary.
- `types/` contains shared frontend types, not a server API contract.
- `styles/App.css` owns the design system: colour tokens for the light theme on `:root` and the
  dark theme on `[data-theme="dark"]`, radius, shadow and type tokens, and the
  shared shell, button, field, badge, feedback, empty, loading, table, card, segmented-control,
  pager and dialog styles. Feature stylesheets hold only their own layouts. Appointment
  status tones are shared by badges and report markers (see the
  [final UI/UX review](final-ui-ux-review.md) and [branding and dark mode](branding-dark-mode.md)).

Use direct imports, PascalCase component files, and camelCase utilities. Create
directories when they have real contents. Run `npm run lint` and `npm run build`
before submitting changes.

## Backend integration

Keep database access, authorization, secrets, and business rules on the server.
Browser navigation rules only control presentation. Login accepts email/password
only and restores identity from `/auth/me`; no browser storage is trusted for
authentication. AuthGate waits for restoration before displaying protected content.
The API client invalidates auth on authenticated 401 responses and preserves it
on 403. Patient list/detail/forms use real demographic DTOs, role-aware actions and
shared CSRF; clinical mocks are never attached to real patient details. Appointments and clinical encounters use their integrated API workflows.
Notifications use the integrated inbox and broadcast API. Staff & Access is an
Admin-only workspace over the staff API: it is gated before any staff request, keeps
only the safe staff DTO fields, never stores the directory or initial passwords, waits
for the server before showing any role, status or session change, and returns to sign-in
when an administrator's change ends their own session (see
[staff administration frontend](frontend-staff-administration.md)). Overview and Reports use the aggregate API through
read-only, runtime-validated `dashboardApi`/`reportsApi` modules. The server chooses the
dashboard from the session, and the frontend sends only a paired UTC `from`/`to` and a
bucket. Responses are rebuilt from documented counts and rates, reads are keyed and
abortable, and nothing is cached in browser storage or polled. UTC reporting dates are
formatted with `timeZone: 'UTC'`, and charts are dependency-free SVG with text summaries
and data tables (see [dashboard and reports frontend](frontend-dashboard-reports.md)). Shared dialogs
provide focus management, background inertness and scroll locking. The root error
boundary offers recovery and logs only a fixed non-sensitive failure message. Choosing a
workspace from the navigation always opens its landing view.
See [product stabilization audit](product-ui-ux-audit.md).

Commit safe `.env.example` placeholders when configuration is introduced.
Local `.env` files are ignored. Never put secrets in browser-exposed configuration.
Document API and deployment decisions here as implementation progresses.
