# Step 12 — Clinical records frontend integration

## Scope and findings

Step 12 connects the existing clinical backend to the React frontend. The previous
Records screen rendered `medicalRecords` fixtures, hardcoded statistics, two-row
client pagination and a nonfunctional overflow action. It had no real clinical
detail, structured draft editor, finalization or amendment flow. Patient and
appointment details had intentionally deferred clinical placeholders, and the
navigation exposed Medical records to roles that lack backend clinical permission.

The Step 6 backend already provided every required endpoint and an appointment
filter suitable for discovering the linked encounter. No backend, schema, migration
or appointment DTO changes were necessary. The actual contract, rather than the
old mock fields, drives the new UI. In particular, finalized status is `REVIEWED`,
the display identifier is `reference`, and mutations require both clinician and
original-author identity. Doctors can read other doctors' records, including drafts.

Notification, dashboard and reporting frontend integration is **not implemented**.
Their existing demonstration data remains. Prescriptions, coding registries,
laboratory/imaging workflows, uploads and audit browsing are outside this step.

## Architecture and authorization

`api/encounters.ts` owns typed summary/detail DTOs, bounded list queries and all
clinical requests. It reuses the existing credentialed API client and in-memory
CSRF token. Components do not call `fetch` directly. Runtime mutation allowlists
strip unsupported properties, including nested complaint/diagnosis IDs. Creation
sends patient UUID and optional appointment UUID; the server supplies reference,
clinician, author, status and timestamps. Finalization sends `{}`; amendment sends
only `reason` and `content`. The draft helper rejects known non-DRAFT DTOs before
transport. Backend authorization and current status remain authoritative.

| Surface/action | Doctor in charge | Admin / Records Officer |
| --- | --- | --- |
| Clinical navigation and list | Available | Hidden; component guards prevent fetching |
| Patient history | Explicit entry from patient detail | Demographic detail only |
| Encounter detail | All encounters allowed by backend | No clinical access |
| Create unlinked draft | Active patient context | Unavailable |
| Create linked draft | Own CHECKED_IN or COMPLETED appointment | Unavailable |
| Edit/finalize | DRAFT and both clinician/author IDs match | Unavailable |
| Amend | REVIEWED and both clinician/author IDs match | Unavailable |
| VOIDED content | Read-only | Unavailable |

Role comes from the restored backend session. Navigation filtering, App-level
guards and feature wrappers prevent ordinary unauthorized UI entry and requests.
They do not replace server security. Another doctor's record, or a historical
record with no clinician, has no mutation controls. A 403 preserves authentication;
an authenticated 401 uses existing global session invalidation.

The existing in-memory navigation is retained. `ClinicalContext` carries either a
real patient or appointment DTO; displayed names/references are never API identity.
Back actions return to the selected demographic patient or appointment. The list
retains filters while a detail is open. No router or persistent clinical store was
introduced.

## DTO and endpoint mapping

| Backend contract | Frontend presentation |
| --- | --- |
| `id`, `reference` | UUID for requests; reference for display and reference-only search |
| `DRAFT`, `REVIEWED`, `VOIDED` | Draft, Finalized, Voided text labels |
| `patient`, `clinician`, `author` | Safe identity summaries; no staff email or audit internals |
| Nullable `appointment` | Linked reference or “No linked appointment” |
| `occurredAt`, `createdAt`, `reviewedAt` | Encounter, recorded and finalized local times |
| `roomLabel`, `historySummary`, `clinicalNotes`, `treatmentPlan`, `followUpAt` | Exact supported draft fields and read-only detail |
| `complaints` | Encounter-owned structured descriptions |
| `diagnoses` | Description, optional code and notes; summary only exposes description/code |
| `amendments` | Separate entries with reason, content, author and creation time |
| `voidedAt`, `voidReason` | Historical void information; no void command |

| Request | Use |
| --- | --- |
| `GET /encounters` | Standalone list and appointment-filtered discovery |
| `GET /patients/:patientId/encounters` | Explicit patient history |
| `GET /encounters/:id` | Separately loaded detail and refresh |
| `POST /encounters` | New draft |
| `PATCH /encounters/:id` | Permitted draft changes |
| `POST /encounters/:id/finalize` | Explicitly confirmed finalization |
| `POST /encounters/:id/amend` | Append-only permanent correction |

All paths use the shared `/api/v1` base. GET requests do not obtain mutation CSRF.
Read effects abort and ignore stale results. No clinical mutation is automatically
replayed or optimistically applied.

## History, list and detail

Doctor patient detail offers **View clinical history**. Opening demographic detail
does not fetch history; Admin/Records never mount the clinical component. History
uses the patient endpoint and retains the real patient context, including archived
history. An active patient's history offers a small unlinked-encounter entry point;
the standalone list directs creation through the real Patients screen. This adds
no separate walk-in registration wizard.

Both list contexts use backend pagination (20 per page), reference-only debounced
search, actual status filters, all-clinicians/assigned-to-me scope and local date
range filters. The API also supports patient, clinician and appointment UUID
filters. UI date filtering requires both dates or neither. Summaries display only
the summary DTO, including diagnosis summaries; long clinical notes are loaded
only in detail. Loading, empty history, empty filtered results and failures have
distinct states. Refresh reloads server state.

Detail shows safe identity, authorship, linked appointment, clinical fields,
complaints, diagnoses and relevant times. Successful mutations replace detail
with the server response and refresh the list. Errors use safe messages and a
support reference rather than response bodies. Unknown encounter detail is a
generic not-found state. Detail refresh failure clears stale record content.

## Appointment workflow

An own-assignment doctor appointment detail mounts `AppointmentClinicalLink`, which
queries `GET /encounters?appointmentId=<uuid>&page=1&limit=1`. An existing encounter
offers **Open clinical record**. An absent encounter offers **Start clinical
encounter** only for CHECKED_IN or COMPLETED. Discovery failure is an error, not
evidence that no encounter exists. Other doctors' assignments and Admin/Records
do not mount this lookup. CANCELLED, NO_SHOW, SCHEDULED and CONFIRMED appointments
cannot start a new encounter.

Creation is an explicit action and preserves patient/appointment UUIDs. A race
returning `APPOINTMENT_ALREADY_HAS_ENCOUNTER` offers deliberate recovery to the
existing record, with confirmation before discarding entered text. Server uniqueness
remains authoritative. Returning to the appointment performs fresh discovery.
Appointment completion does not create an encounter, and encounter finalization
does not complete the appointment.

## Drafts, complaints and diagnoses

The large, scrollable clinical editor keeps immutable identity visible and separates
occurred/follow-up times, room, history, notes, plan, complaints and diagnoses.
Manual **Save draft** submits only changed supported fields when editing. Existing
timestamps retain exact seconds/milliseconds when unchanged. Empty optional text
becomes null; internal line breaks are preserved. Failed saves preserve input.
Dirty close/Escape/backdrop prompts before discarding; draft page-unload also warns.
Pending writes disable controls/dismissal and block duplicate submissions.

Complaints support adding, editing and removing descriptions during a permitted
draft. Diagnoses support multiple descriptions with optional code and notes.
Supplied child collections replace the corresponding collection atomically; an
empty array deliberately clears it. Child IDs are not sent. There is no ICD lookup
or claim of coding-registry validation.

Validation follows existing limits: room 100; clinical text fields 20,000 each;
up to 30 complaints of 1–200 characters; up to 30 diagnoses with description
1–500, code up to 64 and notes up to 5,000. Duplicate trimmed complaints, empty
structured rows, unsupported controls, invalid local times and oversized combined
requests are rejected with safe guidance. The combined-size check allows headroom
under the server's 100 KiB limit. Backend validation remains final authority.

## Finalization, immutability and amendments

Finalization requires a separate confirmation explaining that direct editing ends
and corrections require amendments. `EMPTY_CLINICAL_RECORD` prompts for meaningful
clinical content; no placeholder is inserted. The server-returned REVIEWED record
shows **Finalized**, the finalized time and original author. Direct edit/finalize
controls disappear. VOIDED records also remain read-only.

The **Original finalized record** section stays intact. Amendments are a separate
semantic ordered list of permanent entries, each showing author, time, reason and
content in server history order. The amendment form explicitly explains that the
entry does not replace the original record. Reason (1–1,000) and content
(1–20,000) are required, with a dirty-close warning. Each successful submission
uses the server-returned history; no local merge overwrites original content or
prior amendments. There are no amendment edit/delete controls and no encounter
delete/reopen/reassign controls.

## Privacy, time, errors and accessibility

Clinical state exists in component memory only. No localStorage, sessionStorage,
IndexedDB, persisted store, clinical analytics or payload logging is introduced.
Clinical payloads do not enter navigation URLs or notification UI. Query strings
contain only supported filters, never full notes/complaints/amendment content.
Reload requires fetching from the backend. Clinical mocks are not combined with
real patients. Production clinical code contains no `any`, raw `fetch` or console
calls. The obsolete `medicalRecords` export was removed; dashboard appointments
and notification broadcasts remain unchanged.

Encounter/finalization/amendment values are instants, displayed in the browser's
local timezone using existing appointment time helpers. New local datetime input
is converted to an ISO instant with timezone. Nonexistent DST times are rejected;
newly entered repeated times choose the first occurrence, as explained in the form.
DOB date-only conversion is not used. Existing unchanged instants retain their
original precision and DST occurrence. Occurred time allows the backend's one-minute
future tolerance for draft save; finalization remains subject to the server clock.
Follow-up must not precede occurrence.

Safe error mappings cover authorship, archived patients, ineligible/duplicate
appointments, reference conflicts, noneditable/finalized status, empty content,
invalid times, generic missing records, network failures and request size. No raw
clinical server text is shown or logged. Server changes require refresh; stale
draft/finalization conflicts retain input for deliberate resolution.

The layout uses responsive cards/grids, wrapping long text, preserved line breaks,
large textareas, visible status text and separate original/amendment sections.
Fields have labels and associated instructions; errors use alerts and progress/
success use status regions. Dialogs have accessible titles, modal semantics,
keyboard focus trapping, Escape handling and focus restoration. Buttons support
keyboard activation. Browser/mobile rendering and assistive-technology behavior
still require real-device verification; DOM tests alone do not establish that.

## Verification

Step 12 adds **119 frontend tests across five test files**, plus shared clinical
fixtures. API tests cover paths, query scope, runtime allowlists, CSRF, status
guards and auth behavior. Utility tests cover role/status/authorship rules, field
diffs, validation, dates and safe errors. DOM and whole-App tests cover restricted
navigation/fetching, explicit patient history, linked discovery, draft create/edit,
structured collections, dirty close, pending actions, finalization, separate
amendments, refresh, focus and unchanged original content. Privacy tests check
storage/logging and preservation of deferred mocks. Existing authentication,
patient and appointment suites remain included.

Frontend verification passed **356 tests in 17 files**, including the 119 new
clinical tests and the prior 237 authentication/patient/appointment tests. Server
unit verification passed **483 tests in 12 files**. Repeated runs are not added
to the unique test total. Database verification passed **711 tests in 10 files**.
Combined result: **1,550 unique passing tests across 39 files**, an increase of
119 over the Step 11 baseline of 1,431.

| Command/check | Result |
| --- | --- |
| `npm install` | Passed; no new dependency required |
| `npm run prisma:generate` | Passed |
| `npm run prisma:validate` | Passed |
| `npm run typecheck` | Passed in both workspaces |
| Additional client `tsc --strict --noEmit --incremental false` | Passed |
| `npm run lint` | Passed in both workspaces |
| `npm test` | 483 passed / 12 files |
| `npm run test:client` | 356 passed / 17 files |
| `npm run test:database` | 711 passed / 10 files; exit status 0 |
| `npm run build` | Passed for client and server |
| `git diff --check` | Passed; only existing Windows line-ending notices |

The existing PostgreSQL driver concurrent-query deprecation warning appeared in
clinical verification and did not fail the checks. PowerShell renders Prisma's
informational stderr as a NativeCommandError record in redirected logs; the
commands themselves completed with exit status zero. Neither required a backend
change for this frontend step.

Database suite totals: appointment 139, authentication 99, bootstrap 6, domain 14,
encounter 147, lifecycle 3, notification 105, patient 102, readiness 1 and report 95.
The guarded runner created a fresh database for each suite, validated the schema,
deployed all eight migrations, repeated deployment with no pending migrations,
and removed that database. Its safety checks were unchanged.

Cleanup verified zero generated-suite or live QA databases remained, dropped the
disposable control database, stopped the exact temporary cluster, and removed its
validated temporary directory. Temporary HTTP scripts and verification logs were
removed from the workspace after these results were recorded. No task-created QA
service or database directory remains; ordinary development services were not
stopped or modified.

Live HTTP verification used a fresh, explicitly guarded
`medicare_test_step12_live` database on a disposable PostgreSQL 18 cluster at
127.0.0.1:16439. The compiled app listened on an ephemeral loopback port, with
synthetic staff/patient data and random temporary passwords held only in memory.
Bootstrap, login, staff provisioning, patient registration, appointment creation,
confirmation/check-in and clinical workflows used real HTTP requests. Additional
synthetic appointment states were inserted directly to exercise linking boundaries.
The run passed **120 HTTP/status/integrity assertions**, separately from the unit
test count. These verified role-denied endpoints with retained sessions, broad
doctor reads and author-only writes, discovery/duplicate protection, draft reload,
finalization, two append-only amendments with unchanged original notes and
timestamps, unlinked/empty records, invalid dates, appointment status boundaries,
archived history and permitted amendments, and 401 after logout.

Browser verification was attempted using the computer-use skill. The browser
control inventory timed out. The Windows fallback identified Chrome but stopped
when its URL could not be determined reliably enough for policy enforcement.
No browser acceptance success is claimed. The user-authorized DOM/API/live HTTP
fallback was used. Screen-reader, mobile layout, real-browser storage/console and
keyboard acceptance remain pre-deployment work.

## File inventory

Created product files:

- `client/src/api/encounters.ts`
- `client/src/features/records/AppointmentClinicalLink.tsx`
- `client/src/features/records/ClinicalCommands.tsx`
- `client/src/features/records/ClinicalDialog.tsx`
- `client/src/features/records/ClinicalFeedback.tsx`
- `client/src/features/records/EncounterDetail.tsx`
- `client/src/features/records/EncounterForm.tsx`
- `client/src/features/records/EncounterList.tsx`
- `client/src/features/records/clinical-utils.ts`
- `client/src/features/records/records.css`
- `client/src/features/records/useEncounters.ts`

Created verification/documentation files:

- `client/tests/clinical-api.test.ts`
- `client/tests/clinical-app.test.tsx`
- `client/tests/clinical-fixtures.ts`
- `client/tests/clinical-privacy.test.ts`
- `client/tests/clinical-ui.test.tsx`
- `client/tests/clinical-utils.test.ts`
- `docs/frontend-clinical-integration.md` (this report)

Modified for Step 12: `client/src/app/App.tsx`, `client/src/app/navigation.ts`,
`client/src/features/records/Records.tsx`,
`client/src/features/patients/PatientDetail.tsx`,
`client/src/features/appointments/AppointmentDetail.tsx`,
`client/src/mocks/data.ts`, `client/tests/patient-ui.test.tsx`, `README.md` and
`docs/architecture.md`. The patient test's obsolete clinical-fixture assertion was
removed while preserving checks for deferred dashboard/notification mocks.
Earlier uncommitted Step 9–11 files were retained; the full working-tree diff is
not exclusively Step 12. No backend tests were changed in this step.

No dependencies or persistent environment variables were added. Existing API base,
credentialed transport, CSRF and CORS configuration are reused. Disposable database
URLs and test environment values were process-local, with no normal DATABASE_URL
fallback. No development, staging or production records were used.

## Limitations and next step

Real-browser desktop/mobile and assistive-technology QA remains required. There is
no institutional timezone override or selector for the second repeated DST time.
The backend has no optimistic revision token: concurrent draft edits can still
overwrite each other under its existing semantics. No autosave, offline persistence,
realtime refresh or automatic mutation retry is added. An interrupted amendment
response can require refresh to establish whether it committed before retrying.
Archived status is not included in encounter detail's patient summary, so a stale
or standalone draft action may be rejected by the server; patient history disables
new creation when its demographic context is known to be archived. Closing an
appointment's initial creation dialog can be recovered by returning to its detail
and starting again. These preserve the existing API/product scope.

Step 12 stops here. Recommended next work is the real-browser acceptance pass,
followed by separately authorized notification integration. Dashboard/report
integration also remains deferred and has not been started.
