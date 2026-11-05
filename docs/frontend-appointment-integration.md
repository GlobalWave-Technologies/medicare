# Step 11: appointment frontend integration

## Scope and initial findings

Step 11 completes the appointment frontend after authentication and patient
integration. It does not integrate clinical encounters, notifications, dashboards
or reports. Their existing demonstration screens remain unchanged.

The previous appointment component already called real list/create APIs through
`lib/api.ts`. It supported a week/all schedule, search, status filtering, backend
pagination, active-patient search and the appointment clinician lookup. It was
not a purely mocked feature. The correct API paths, DTO fields and enums have been
preserved behind a compatibility export.

Missing pieces were appointment detail, edit/reschedule, lifecycle actions and
cancellation. Booking controls were visible to doctors, the patient lookup was
limited to one page, lookup failures could look like empty results, list requests
were not aborted, and pagination produced an unbounded number of buttons.
The sidebar displayed a hardcoded appointment count of 8. The large appointment
component and its obsolete CSS have been replaced by focused components, retaining
the existing panel, button, color and typography conventions.

## API and DTO mapping

`client/src/api/appointments.ts` uses the existing credentialed transport. GETs
accept AbortSignal and do not acquire CSRF. Mutations use the shared in-memory
CSRF cache and never automatically replay a failed write. `lib/api.ts` re-exports
the same API/types for compatibility. Components do not call raw fetch.

| Function | Route | Accepted data |
| --- | --- | --- |
| `list` | `GET /appointments` | page, limit, search, status, type, patientId, clinicianId, dateFrom, dateTo |
| `get` | `GET /appointments/:id` | encoded internal UUID |
| `clinicians` | `GET /appointments/clinicians` | active-doctor safe summaries |
| `create` | `POST /appointments` | patientId, clinicianId, scheduledStart, scheduledEnd, type, reason, notes |
| `update` | `PATCH /appointments/:id` | clinicianId, scheduledStart, scheduledEnd, type, reason, notes |
| `changeStatus` | `PATCH /appointments/:id/status` | status only |
| `cancel` | `POST /appointments/:id/cancel` | reason only, trimmed or null |

All paths above use the existing `/api/v1` base. Runtime allowlists remove extra
properties even if a full DTO is passed into create/update at runtime.

The appointment DTO contains id/reference, a patient summary (id, patientNumber,
firstName, middleName, lastName), nullable clinician summary (id, staffNumber,
firstName, lastName), scheduledStart/End, type/status, reason/notes,
cancelledAt/cancellationReason, and createdAt/updatedAt. The UI does not expect
full patient demographics, clinician email, secrets, queue numbers or clinical
records. Null clinician and optional text fields have explicit display fallbacks.

## Listing, filtering and navigation

`Appointments` owns filter/page state; `useAppointments` owns cancellable reads.
Search waits 300 ms, and both AbortController and response-key checks prevent
late requests from replacing newer results. Search matches the backend contract:
appointment reference, patient number or individual name fields. It does not
promise full-name phrase matching or search over scheduling notes.

The screen provides status/type filters, Admin/Records clinician UUID filtering,
and This week, Today, All dates and Custom dates. Week starts Monday. Custom
ranges require two valid dates in chronological order. Date filters apply to
scheduled start, matching the backend's inclusive boundaries. Filters reset page
to 1; the server supplies total/page/totalPages. Only Previous/Next buttons are
rendered, even for large totals. A now-empty page can be navigated backward.

There are distinct loading, request-error, ordinary-empty and search-empty states,
with deliberate refresh. No request is sent for an invalid custom range. Today
and Checked in filters provide supported operational views without invented queue
positions or hospital-wide counts. The hardcoded sidebar count has been removed.

Opening a row loads its detail by UUID. The list remains mounted but hidden while
detail is open, preserving filters and page. Navigation clears selected detail.
Creating a booking opens the returned DTO directly. Edit/status/cancel responses
replace detail state and invalidate the list without reloading the app. Writes
are not optimistic. Refresh allows recovery after a concurrent state change.

## Roles and selectors

| Role | Schedule view | Create/edit/cancel | Status changes |
| --- | --- | --- | --- |
| ADMIN | Hospital schedule | Yes | Yes |
| RECORDS_OFFICER | Hospital schedule | Yes | Yes |
| DOCTOR_IN_CHARGE | My appointments | No | Own assignments only |

Identity comes from the existing authenticated backend user. The doctor list
does not render clinician filters or booking controls, does not request the
clinician lookup, and strips clinicianId from its query before transport. Detail
actions additionally check the assigned clinician UUID against the doctor UUID.
Backend permissions and resource scope remain authoritative. Hidden appointments
return the same generic not-found message as unknown appointments.

The patient picker uses `patientsApi.list` with `archived=false`, a 300 ms search
debounce and ten-item backend pages. It never loads the entire patient directory.
Each result is a native keyboard-operable button showing name and patient number.
Archived rows are also excluded defensively from display. Selection retains the
server UUID and safe summary; Clear selection returns to search. Typing a name
does not create a valid patient identity. Loading, empty, failure and retry states
are distinct; stale/cancelled patient searches cannot replace newer results.

The existing dedicated `/appointments/clinicians` route is preferable to the
admin-only staff directory: it is available to both Admin and Records, and the
server filters role=DOCTOR_IN_CHARGE/status=ACTIVE before returning safe summaries.
There is no client hardcoded staff list or email display. Native select values are
real UUIDs; no doctor is automatically selected. Lookup failures, loading and
empty results are visible, with Reload doctors. Historical/ineligible selection
is not silently replaced by another doctor. Eligibility rejection clears the
selection so the user can deliberately reload/reselect while retaining form text.

## Booking and editing

The form submits only the documented create fields. The server allocates reference,
initial SCHEDULED status and metadata. Obvious invalid local times, reversed or
out-of-range durations, missing patient/clinician and past schedules are blocked.
Allowed duration is 5 minutes through 12 hours, inclusive. The past check follows
the server's 60-second tolerance, but the server clock and database concurrency
constraints make the final decision. Reason allows 500 characters and scheduling
notes 5,000; unsupported text control characters are rejected.

Only SCHEDULED/CONFIRMED appointments expose edit/reschedule and cancellation.
Patient identity is immutable in the edit UI and PATCH allowlist. A wrong-patient
booking must be cancelled and recreated. Edit sends only changed fields, including
explicit null when an optional text field is cleared. It does not resend unchanged
timestamps or clinicianId. Consequently a text/type correction to a past scheduled
booking remains possible, while changing its time or clinician requires a current
schedule. No-change submissions show feedback rather than sending an empty PATCH.

Pending writes block duplicate submissions and dialog dismissal. Server rejection
preserves useful field values. No automatic rebooking or reassignment is performed.

## Timezone policy

Appointment timestamps are instants; patient DOB date-only helpers are not reused.
`appointment-time.ts` owns API-to-local display, datetime-local input formatting,
local-input-to-UTC ISO conversion, duration labels and local calendar boundaries.
The screen and form name the browser timezone. Requests always include a timezone
through `toISOString()`; timezone-less input strings are never sent to the API.

Round-trip validation rejects impossible calendar dates and nonexistent local
times during spring-forward. Newly entered repeated fall-back times use JavaScript's
earlier occurrence; the form explicitly discloses that choice. There is no explicit
offset selector for choosing the later occurrence. Existing unchanged server
timestamps retain their exact instants, including seconds/milliseconds and a later
fall-back occurrence, during unrelated edits.

Today/custom date ranges start at the day's first existing instant and end one
millisecond before the next local calendar day's first instant. They do not assume
a day is 24 hours or that local midnight exists. A completely skipped calendar
date is rejected. Tests run separate Node processes with America/New_York,
Asia/Kathmandu, America/Havana and Pacific/Apia, covering spring gaps, repeated
hours, 23/25-hour days, non-whole-hour offsets, midnight transitions, skipped dates
and UTC/local date rollover. Node 22 tests
use its explicit TypeScript stripping flag; no dependency was added for this.

The clock refreshes every 15 seconds and on focus/visibility changes, updating
date presets and timing-based action availability. Lists are not realtime queues;
users can refresh for external changes. Server-side timing rejection is handled.

## Lifecycle, cancellation and errors

Status/type labels are centralized. The only offered transitions are:

- Scheduled → Confirmed.
- Confirmed → Checked in, enabled from 60 minutes before scheduled start.
- Checked in → Completed.
- Scheduled/Confirmed → No-show, enabled at or after scheduled start.

Disabled timing actions include visible explanations. Terminal statuses expose
no administrative editing, cancellation or further status transition controls.
Completing an appointment calls only its status endpoint; it creates no encounter.
Detail's clinical area is a plain module placeholder with no mock clinical data.

Cancellation requires a dialog confirmation and an optional 500-character reason.
The UI explains that history remains and uses cancellation terminology. It never
sends cancelledAt. The entire server-returned DTO is retained, including the
original reason/time on an idempotent cancellation response. Once cancelled,
cancellation controls disappear and cancellation metadata is displayed.

Error mapping distinguishes scheduling conflicts, past/invalid times, uneditable
state, invalid/timed transitions, reference allocation conflicts, unavailable or
archived patients, and missing/inactive/non-doctor clinicians. Conflict feedback
does not disclose another patient's details and covers both patient and clinician
overlaps. Archived-patient feedback directs reactivation, without altering patient
identity. Safe generic network/validation errors and support references remain
available. Shared auth invalidates on 401; 403 preserves authentication. A 404
never explains that a resource belongs to another doctor.

## UI, accessibility and mock boundaries

The appointment feature uses responsive filter/detail grids, a contained horizontal
table scroller, wrapping names/text, textual status badges, 44-pixel controls and
bounded scrollable dialogs. Appointment styles are scoped to avoid changing other
modules. Native labeled inputs/selects/buttons support keyboard use. Dialogs are
named, modal, trap Tab/Shift+Tab including textareas, restore prior focus, and allow
Escape/backdrop dismissal only while idle. Errors use alerts, loading/success use
status announcements, and busy controls are disabled. Patient selection moves
focus to Clear selection; clearing moves it back to search. The dialog also
recaptures Tab when a removed control leaves focus outside its content.

Static source inspection found no appointment-screen imports from mocks, raw
fetch, `any`, or local/session storage persistence. The shared `appointments` mock
export remains because Overview still consumes it; removing it would change the
explicitly deferred dashboard. Clinical, broadcast/notification and report mocks
remain intact. There is no fake queue position or appointment badge count.

Responsive CSS and accessibility behavior were reviewed in source and DOM tests.
This is not a substitute for rendered desktop/mobile or assistive-technology QA.
Real-browser manual verification remains a pre-deployment item; no browser success
is claimed for Step 11.

## Verification record

Frontend: **237 tests / 12 files passed**, comprising 60 auth, 73 patient and
**104 new appointment tests / 5 files**:

| Appointment test file | Cases | Coverage |
| --- | ---: | --- |
| appointment-api.test.ts | 12 | Paths, filters, field allowlists, real UUIDs, credentials, CSRF, cancellation, auth 401/403 |
| appointment-utils.test.ts | 42 | Roles, transitions, timing/duration limits, edit diffs, date ranges, safe errors |
| appointment-timezone.test.ts | 7 | New York/Havana DST, Kathmandu offsets and Apia skipped date in isolated timezone processes |
| appointment-ui.test.tsx | 40 | List/search/page/staleness, pickers, create/edit/detail/actions/cancel, focus and pending writes |
| appointment-app.test.tsx | 3 | Actual App navigation and complete Admin/Records/Doctor workflows |

Backend unit suite: **483 tests / 12 files passed**. The guarded database suite
passed **711 tests / 10 files**, with exit code 0. No backend source, schema, migration or
backend test changes were required for Step 11. Earlier uncommitted Step 9/10 work
was preserved, including the existing auth CORS and patient changes.

The live disposable-data HTTP run passed **61 requests** against the real compiled
Express application and PostgreSQL. It exercised Admin/Records login, active-doctor
lookup, create, list/search/filter/pagination, conflict, reschedule, confirm and
cancel; repeated cancellation preserved the original reason/time. Doctor checks
covered own-only list, attempted clinician-scope widening, hidden detail/status
404s, forbidden create/edit/cancel, continued session validity after 403, and
Confirm → Check in → Complete. Further checks covered premature check-in/no-show,
valid no-show, archived-patient rejection and active-patient lookup exclusion,
suspended/non-doctor clinician rejection, lookup exclusion and appointment audits.
The final encounter count was zero.

Both initial verification failures were in the new test harnesses: Node's explicit
TypeScript loading flag was missing from timezone subprocesses, and the live helper
initially used INACTIVE instead of the actual SUSPENDED staff status. Both helpers
were corrected; frontend tests and live checks then passed in full.

`npm install`, Prisma generate/validate, full typecheck, lint, unit/client tests and
production build passed. An additional `tsc -p client/tsconfig.app.json --strict
--noEmit --incremental false` check also passed. No packages were added and the dependency lock has no
semantic changes. No persistent environment configuration was changed. Tests use
only a fresh loopback PostgreSQL 18 cluster on port 16439, disposable test databases,
and an ephemeral HTTP port. Ordinary application services/data are not used.

Database regressions passed with these exact per-suite totals:

| Database suite | Passed |
| --- | ---: |
| Appointment | 139 |
| Authentication | 99 |
| Bootstrap | 6 |
| Domain | 14 |
| Encounter | 147 |
| Lifecycle | 3 |
| Notification | 105 |
| Patient | 102 |
| Readiness | 1 |
| Report | 95 |
| **Total** | **711** |

Combined result: **1,431 unique passing tests across 34 files**, an increase of
104 over the Step 10 baseline of 1,327. Repeated verification runs are not counted
again. The database runner retained all safeguards: fresh generated database per
suite, schema validation, deployment of all eight migrations, repeat deployment
with no pending migrations, and removal of each generated database.

The first run's terminal session was lost after a machine interruption. The final
database command was rerun with a saved log and exit status, which confirmed all
ten suites passed. The existing encounter-suite pg concurrent-query deprecation
warning remains; it did not fail the suite and was not changed in this frontend
step. A Vite plugin timing warning during a slow intermediate build was likewise
non-fatal; the final client build passed.

Final cleanup verified the temporary PostgreSQL process was stopped, removed the
validated Step 11 cluster directory (including its disposable control database),
and removed the temporary HTTP helper, test inventory and verification logs.
No temporary QA service or task-created database directory remains. Production,
staging and ordinary development data were not modified.

## File inventory and next step

Created:

- `client/src/api/appointments.ts`
- `client/src/features/appointments/AppointmentCancellation.tsx`
- `client/src/features/appointments/AppointmentDetail.tsx`
- `client/src/features/appointments/AppointmentDialog.tsx`
- `client/src/features/appointments/AppointmentFeedback.tsx`
- `client/src/features/appointments/AppointmentForm.tsx`
- `client/src/features/appointments/AppointmentPagination.tsx`
- `client/src/features/appointments/AppointmentPickers.tsx`
- `client/src/features/appointments/appointment-time.ts`
- `client/src/features/appointments/appointment-utils.ts`
- `client/src/features/appointments/useAppointments.ts`
- The five appointment test files above and `client/tests/appointment-fixtures.ts`.
- `docs/frontend-appointment-integration.md` (this report).

Modified for Step 11: `client/src/app/App.tsx`,
`client/src/features/appointments/Appointments.tsx`,
`client/src/features/appointments/appointments.css`, `client/src/lib/api.ts`,
`README.md`, and `docs/architecture.md`. Temporary QA helpers/data are not product
files and are removed after verification.

Remaining limitations: real-browser desktop/mobile and assistive-technology QA;
no institutional timezone override or later-occurrence DST selector; no realtime
queue, queue positions or free-slot discovery; external changes require refresh;
server clock, eligibility and concurrency rules remain authoritative. List search
uses the documented backend field matching rather than full-name phrase matching.

Step 11 stops here. Recommended next work is the real-browser acceptance pass,
followed by separately authorized clinical frontend integration. Clinical,
notification and dashboard/report integration was not implemented in this step.
