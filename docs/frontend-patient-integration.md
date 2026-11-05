# Frontend patient integration — Step 10

## Baseline and scope

The checkout already listed real patients, searched/paginated through the backend,
filtered archival status, and posted registration forms. `lib/api.ts` defined all
six patient API operations and was imported by existing appointment code. Patient
detail/edit/archive/reactivate UI was missing; the directory exposed Add patient
to doctors, request cancellation was incomplete, and registration could close while
saving. No patient localStorage/sessionStorage persistence remained.

Step 10 completes patient demographics only. Authentication and existing appointment
wiring are preserved. No clinical, notification, dashboard or report integration
was added. Real patients are never associated with unrelated clinical mock data.

## API, state and permissions

`api/patients.ts` owns the canonical Patient DTO, query/pagination/input types and
list/get/create/update/archive/reactivate methods. It uses existing credentialed
transport, error handling and CSRF. `lib/api.ts` re-exports the same API/types for
appointment compatibility. Components never use raw fetch.

The DTO matches the server: id, patientNumber, firstName, middleName, lastName,
dateOfBirth, phone, archivedAt, createdAt and updatedAt. Mutations explicitly allow
only firstName, middleName, lastName, dateOfBirth and phone—even if callers supply
a full DTO at runtime. Server-generated identity, creator, archive and timestamp
fields cannot enter the outgoing demographic body. Detail uses the internal UUID.

React state stays local to focused components and a list hook. `canManagePatients`
centralizes management rights for ADMIN and RECORDS_OFFICER. DOCTOR_IN_CHARGE can
list/search/read only. Header, directory, form, detail actions and mutation handlers
all honor this rule; server authorization remains authoritative. Global 401 handling
invalidates auth; 403 displays access feedback without logout. No new auth state,
framework, dependencies or environment variables were introduced.

## List, search and pagination

`usePatients` requests server pages of ten active patients by default. Search is
limited to 100 characters and debounced by 300 ms, using backend name/number/phone
search. Search/filter changes reset to page one. A previous debounce timer and
AbortController are cancelled, and late responses are ignored. Loading appears
immediately, including during debounce, rather than showing old results as current.

Only page, limit, search and archived parameters are sent. Active/Archived/All
filters map directly to the backend. Pagination uses returned metadata and a bounded
Previous/Next control, avoiding thousands of page buttons. An out-of-range page offers
Return to first page. Empty-directory, empty-search and empty-archive messages differ;
registration CTAs are management-only. Failures show safe messages, request IDs and
retry without a misleading simultaneous empty state.

The directory stays mounted while detail is open, preserving its filters/page.
Mutations refresh the list without reloading the app. Leaving Patients navigation
clears selection so an old create response is not reused as a cached detail later.

## Registration, detail, edit and lifecycle

PatientFormValues contains editable strings. A mapper trims names/phone and converts
blank optional fields to null. Validation covers required names, length/control
characters, dates and conservative phone syntax. Server-generated IDs/references
and normalized values remain authoritative. No fake IDs or merged mock data are used.

Successful registration opens the returned patient in detail, announces success and
refreshes the directory. It avoids an immediate duplicate detail GET. Opening an
existing row performs an abortable GET. Detail shows name/reference, DOB, age, phone,
Active/Archived status and registration/update dates. Not-found has a clean state
and Back to Patients; network failure permits retry.

Editing populates supported demographics, retains input after errors, excludes
immutable fields and immediately uses the PATCH response. The PATCH contains only
fields changed in that form, so a form opened before another user's edit cannot
revert their change to a different field; an edit with no changes is not sent.
When a save result cannot be confirmed (network failure or server error), staff
are asked to search the directory before retrying. Archived patients must
be reactivated before editing. No email, residential address, sex/gender, blood group
or emergency contact fields were added because the API cannot persist them. Older
room/personnel/complaint/history prototype fields were already absent and remain
deferred. Ghana-specific phone guidance was replaced with neutral syntax guidance;
the frontend does not infer country codes or reformat returned phone values.

Detail explicitly says clinical records are managed separately. It contains no
mock diagnoses, complaints, encounters or history for the real patient.

Archive requires a confirmation identifying the patient and explaining that they
are not deleted, history remains, and new active workflows require reactivation.
Reactivation also has explicit confirmation. Both use POST with shared CSRF and
update from the returned DTO, including idempotent responses. Status derives only
from archivedAt. No DELETE call or delete action exists.

POSSIBLE_DUPLICATE_PATIENT gets distinct guidance to search all records, including
archived patients, for create/edit/reactivation. It never echoes another patient's
details or offers a force-create override. Validation, not-found, archived-record,
CSRF and identifier errors have safe messages and support references. Unknown raw
backend messages/stacks are not shown. Mutations are never automatically replayed.
Duplicate submits are guarded; form controls/actions and dismissal are disabled
while saving. A failed CSRF operation can be retried deliberately with the shared helper.

## DOB and age

DOB is canonical; age is derived and never stored/submitted. The actual API allows
unknown DOB, so the UI keeps it optional rather than requiring an invented date.
This follows the real contract despite the generic checklist's DOB-presence suggestion.
Unknown values display Not recorded; the form says to leave unknown DOB blank.

UTC today matches backend future-date validation; edit also caps DOB at the original
UTC registration date. The submitted YYYY-MM-DD value is never shifted through a
timestamp conversion. Display formats calendar parts directly. Age compares year,
month and day against UTC today. Leap-day birthdays advance on March 1 in non-leap
years. Tests cover before/on/after birthdays, leap years, invalid/unknown/future/year-zero
dates and timezone boundaries. Registration/update timestamps are labelled UTC.

## UX, accessibility and cleanup

Existing patient panel/form styles remain, with scoped improvements for wrapping
long names/references, readable inputs, mobile cards/single-column forms, responsive
demographic grids, wrapping pagination/actions, focus outlines, text status badges
and 44px action targets. Loading remains inside the patient section.

Labels are associated, buttons have explicit types, errors use alerts, progress and
success use status roles, and pending work exposes aria-busy. Dialogs have accessible
titles, modal semantics, initial focus, Tab containment, Escape dismissal when idle,
and focus restoration. A focus-trap defect found by the new test was fixed before
the final passing run. Real visual/mobile/browser keyboard QA remains pending.

Removed unused `recentPatients` after confirming no consumers. Patient screens do
not depend on patient mocks or storage. There was no remaining storage code to remove;
no browser keys were cleared. Appointment, medicalRecords and defaultBroadcasts mocks
remain intact and tested.

## Files and tests

Created:

- `client/src/api/patients.ts`
- `client/src/features/patients/patient-utils.ts`
- `client/src/features/patients/usePatients.ts`
- `client/src/features/patients/PatientDetail.tsx`
- `client/src/features/patients/PatientDialog.tsx`
- `client/src/features/patients/PatientFeedback.tsx`
- `client/src/features/patients/PatientPagination.tsx`
- `client/tests/patient-api.test.ts`
- `client/tests/patient-utils.test.ts`
- `client/tests/patient-ui.test.tsx`
- `client/tests/patient-app.test.tsx`
- `docs/frontend-patient-integration.md`

Modified: `client/src/app/App.tsx`, `client/src/lib/api.ts`,
`client/src/features/patients/Patients.tsx`, `PatientModal.tsx`, `patients.css`,
`client/src/mocks/data.ts`, `README.md`, and `docs/architecture.md`.
No backend APIs/tests/migrations or authentication behavior changed in Step 10.
Earlier Step 9 working-tree changes were preserved.

The 73 new patient tests cover API payload allowlisting, CSRF, query encoding,
cancellation, age/calendar rules, permission controls, validation/duplicates,
loading/empty/error/retry/pagination, detail/404, edit persistence, archive confirmation,
reactivation, focus, storage non-use and mock preservation. Actual App composition
tests exercise management flows for Admin/Records and Doctor read-only behavior.
All 60 existing frontend auth tests remain passing, including cancelled restoration,
rate-limit feedback and 401-versus-403 behavior.

## Verification

Final verification closure: 2026-10-29.

| Check | Result |
| --- | --- |
| `npm install` | Passed; dependencies up to date, no dependencies added |
| `npm run prisma:generate` | Passed |
| `npm run prisma:validate` | Passed |
| `npm run typecheck` | Passed for both workspaces and tests |
| `npm run lint` | Passed without lint warnings |
| `npm test` | 483 passed across 12 backend unit test files |
| `npm run test:client` | 133 passed across 7 files: 60 existing auth + 73 new patient tests |
| `npm run test:database` | 711 passed across 10 isolated suites; exit code 0 |
| `npm run build` | Passed for both workspaces |
| `git diff --check` | Passed |
| Live patient HTTP checks | Passed against a disposable database |
| Real browser/manual checks | Pending; no browser success claimed |

There are **1,327 unique passing tests across 29 files**, without double counting.
Backend unit tests exclude database suites, and each database suite runs once.
Database counts: appointments 139, auth 99, bootstrap 6, domain 14, encounters 147,
lifecycle 3, notifications 105, patients 102, readiness 1, reports 95. The encounter
suite emits the pre-existing pg concurrent-query deprecation warning; no tests or
checks were disabled to suppress it. No backend tests were changed in Step 10.

The existing guarded runner used NODE_ENV=test and process-scoped
`TEST_DATABASE_URL=postgresql://qa_admin@127.0.0.1:16439/medicare_test_control`
against a newly initialized PostgreSQL 18 cluster under the OS temporary directory.
It listened only on loopback and used local trust solely in that temporary cluster.
No existing database configuration or normal application DATABASE_URL was reused.
Each generated suite database applied all eight migrations from scratch, deployed
again with no pending migrations, and was dropped by the runner. Safety checks and
migrations were unchanged.

A separate `medicare_test_patient_http` database was migrated twice for a temporary
loopback HTTP server using the compiled application. Synthetic accounts and patients
verified Admin and Records Officer creation/search/detail/edit/archive/reactivation,
server-generated IDs and normalized phone, duplicate and future-DOB rejection,
active/archived filtering and idempotent reactivation. Doctor could list/search/read;
create/edit/archive/reactivate returned 403, followed by successful `/auth/me`.
Invalid CSRF, unknown patient and post-logout 401 behavior also passed. Credentials
were generated in memory and never printed or committed. These HTTP assertions are
additional verification, not extra tests in the formal total.

All generated suite databases were removed. The HTTP/control databases were then
dropped, and a query confirmed zero remaining `medicare_test_*` databases. The
temporary HTTP server disconnected, PostgreSQL stopped successfully, and its cluster
directory plus the temporary verification script/path marker were removed. No
production, staging, shared or normal application database/data/credentials were used.

## Remaining limitations and next step

Real-browser/manual verification remains a pre-deployment QA item: login refresh,
storage, mobile layout, long names, keyboard focus, network recovery and duplicate
feedback against disposable data. The prior browser-access limitation remains;
HTTP/DOM tests do not establish actual browser execution.

The backend provides no optimistic-concurrency version field, so this step adds no
conflict-resolution scheme. No appointment, clinical, notification, dashboard or
report integration was expanded. Next: manual patient/auth QA, then the separately
scoped appointment frontend step. This task stops after Step 10.
