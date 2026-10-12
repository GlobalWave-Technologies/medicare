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
without patient data or extra resource privileges. There is no external delivery,
background worker or frontend notification integration in Step 7.

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
Keep HTTP controllers thin, business rules in services, and persistence in
repositories. Frontend integration remains deferred.

## Frontend conventions

- `app/` owns application composition, navigation, and demo session state.
- `features/<domain>/` owns feature screens and forms. Add feature-specific
  hooks, API calls, and tests alongside their implementations.
- `components/` contains UI and branding reused across features.
- `types/` contains shared frontend types, not a server API contract.
- `mocks/` contains demonstration data to replace during API integration.
- `styles/` preserves existing global styles.

Use direct imports, PascalCase component files, and camelCase utilities. Create
directories when they have real contents. Run `npm run lint` and `npm run build`
before submitting changes.

## Backend integration

Keep database access, authorization, secrets, and business rules on the server.
Browser navigation rules only control presentation. The current login accepts
a selected role without authentication, patient registration stores partial data
in local storage, and several actions are placeholders. These behaviors are
unchanged by this reorganization and must be replaced during integration.

Commit safe `.env.example` placeholders when configuration is introduced.
Local `.env` files are ignored. Never put secrets in browser-exposed configuration.
Document API and deployment decisions here as implementation progresses.
