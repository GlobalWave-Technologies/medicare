# Appointment scheduling (Step 5)

Step 7 update: [internal notifications](notifications-api.md) now add required,
transactional generic notices for assignment, actual rescheduling/reassignment
and first cancellation. Eligible recipients are active doctors; null/inactive/
demoted historical assignees do not block cancellation. Notification failure rolls
back the mutation and its audit. No scheduling conflict or scope rule was changed.
The original Step 5 findings and verification below remain historical.

This phase extends the existing session, CSRF, permission, DTO, pagination,
error and append-only audit architecture. It adds six appointment endpoints.
It does not implement encounters, clinical records, diagnoses, prescriptions,
notifications, dashboard/reporting APIs or frontend integration.

## Findings and model

The existing Appointment model already has UUID identity, a PostgreSQL-generated
`reference`, patient/clinician relationships, UTC start/end, type/status, optional
reason/notes, creator, cancellation attribution and timestamps. The schema calls
the business identifier `reference`, not `appointmentReference`; the API uses
that existing name. Clinician is nullable in storage for legacy/unassigned
records, but new API bookings require an eligible clinician. No model fields,
dependencies or environment variables are added.

## Authorization and visibility

| Permission | ADMIN | RECORDS_OFFICER | DOCTOR_IN_CHARGE |
| --- | --- | --- | --- |
| APPOINTMENT_READ | All | All | Own assignment only |
| APPOINTMENT_CREATE | Yes | Yes | No |
| APPOINTMENT_UPDATE | Yes | Yes | No |
| APPOINTMENT_CANCEL | Yes | Yes | No |
| APPOINTMENT_STATUS_UPDATE | All | All | Own assignment only |

Permissions are explicit server policy, independent of clinical permissions.
ADMIN still has no automatic clinical-record permissions. `requireAuth` precedes
`requirePermission`; identity is the current ACTIVE database staff/session,
never body/query/header role claims. All routes require authentication. Writes
require the trusted Origin and the existing session-bound `X-CSRF-Token`.
GET/HEAD require no CSRF. Responses use `Cache-Control: no-store`.

Doctor list scope always intersects filters with their authenticated staff UUID.
Supplying another clinicianId returns no matches, not a broader view. Detail
and status commands for another doctor's appointment return the same 404
`APPOINTMENT_NOT_FOUND` as an absent record. A null/legacy assignment is not
visible to doctors. Scheduling administrators can read all appointments.

## API contract

All paths below are relative to `/api/v1/appointments`. All `:id` parameters are
UUIDs. Single-item success is `{success:true,data:{appointment:DTO}}`; list success
is `{success:true,data:{items:DTO[],pagination:{page,limit,total,totalPages}}}`.
Errors retain `{success:false,error:{code,message,requestId}}` and X-Request-Id.

| Method/path | Permission | Input | Success | Principal errors |
| --- | --- | --- | --- | --- |
| POST `/` | APPOINTMENT_CREATE | patientId, clinicianId, scheduledStart, scheduledEnd, type; optional reason/notes | 201 appointment | PATIENT_NOT_FOUND, PATIENT_ARCHIVED, CLINICIAN_NOT_FOUND, CLINICIAN_NOT_ACTIVE, INVALID_CLINICIAN_ROLE, INVALID_APPOINTMENT_TIME, APPOINTMENT_IN_PAST, APPOINTMENT_CONFLICT, APPOINTMENT_REFERENCE_CONFLICT |
| GET `/` | APPOINTMENT_READ | page, limit, status, type, patientId, clinicianId, dateFrom, dateTo, search | 200 items/pagination | VALIDATION_ERROR |
| GET `/:id` | APPOINTMENT_READ + visibility | UUID | 200 appointment | APPOINTMENT_NOT_FOUND |
| PATCH `/:id` | APPOINTMENT_UPDATE | Nonempty subset: clinicianId, scheduledStart, scheduledEnd, type, reason, notes | 200 appointment | APPOINTMENT_NOT_FOUND, APPOINTMENT_NOT_EDITABLE, assignment/time/conflict errors above |
| PATCH `/:id/status` | APPOINTMENT_STATUS_UPDATE + visibility | `{status: CONFIRMED \| CHECKED_IN \| COMPLETED \| NO_SHOW}` | 200 appointment | APPOINTMENT_NOT_FOUND, INVALID_APPOINTMENT_STATUS_TRANSITION, assignment/conflict errors |
| POST `/:id/cancel` | APPOINTMENT_CANCEL | Optional `{reason}`; empty/no body allowed | 200 appointment | APPOINTMENT_NOT_FOUND, INVALID_APPOINTMENT_STATUS_TRANSITION |

All bodies/queries are strict Zod objects; unknown fields and invalid UUIDs/enums
return 400 VALIDATION_ERROR. No request object is spread into Prisma writes.
There is no DELETE route. Initial status is server-controlled SCHEDULED;
reference uses the existing independent `AP-<uppercase UUID v4>` database default
and unique constraint. Creator/canceller IDs come from the session. Client-supplied
reference, status on creation, creator and cancellation metadata are rejected.

401 AUTHENTICATION_REQUIRED, 403 FORBIDDEN/CSRF_INVALID/ORIGIN_NOT_ALLOWED and safe
500 INTERNAL_ERROR use the shared handler. Missing resources use 404; archival,
clinician eligibility, conflicts, past schedules and lifecycle errors use 409.
INVALID_APPOINTMENT_TIME uses 400. Reference collisions use safe 409
APPOINTMENT_REFERENCE_CONFLICT, allowing retry. Conflict responses reveal no
other appointment ID, patient, clinician details or constraint name.

Example booking (choose a future date when exercising the API):

```json
{
  "patientId": "00000000-0000-4000-8000-000000000001",
  "clinicianId": "00000000-0000-4000-8000-000000000002",
  "scheduledStart": "2026-10-15T09:30:00+00:00",
  "scheduledEnd": "2026-10-15T10:00:00+00:00",
  "type": "CONSULTATION",
  "reason": "Scheduled consultation",
  "notes": null
}
```

Those illustrative UUIDs must be replaced with existing patient/clinician IDs.
Supported types: CONSULTATION, FOLLOW_UP, ROUTINE_CHECKUP, EMERGENCY_REVIEW.
Reason/cancellation reason are at most 500 characters; notes at most 5000.
Optional text is trimmed, blank becomes null, Unicode and line breaks remain,
and non-text controls are rejected. Text is administrative and still sensitive;
these fields are not clinical-note endpoints. Treat content as plain text when
rendering later, and never put it in telemetry or audit metadata.

## DTO

The explicit select/presenter returns only:

```text
id, reference,
patient: {id, patientNumber, firstName, middleName, lastName},
clinician: {id, staffNumber, firstName, lastName} | null,
scheduledStart, scheduledEnd, type, status, reason, notes,
cancelledAt, cancellationReason, createdAt, updatedAt
```

All timestamps are ISO UTC strings. No clinician email, password/session data,
creator/canceller internals, patient DOB/phone, audit records, encounters or
medical content are joined into responses. Both list and detail use the same
administrative DTO, including booking text, within the role/assignment scope.

## Time, assignment and rescheduling

Storage uses PostgreSQL `timestamptz(3)` instants; API output is UTC. Inputs must
be valid ISO dates with seconds and `Z` or an explicit `+/-HH:MM` offset, with
at most three fractional digits. Local timestamps, date-only values, invalid
calendar dates and leap seconds are rejected. No server/facility timezone is
assumed. The later UI must convert selected local date/time using an explicitly
chosen timezone and display timestamps in the appropriate client/local zone.

Duration must be 5 minutes through 12 hours inclusive: these endpoints schedule
bounded visits, not admissions or multi-day resources. Start must not be more
than 60 seconds before server time when creating or changing time/clinician.
This small tolerance accommodates request/clock skew, not historical backfill.
Trusted import tooling will need separate reviewed rules.

The patient must exist and be unarchived. Assigned staff must exist, be ACTIVE,
and have DOCTOR_IN_CHARGE role. Shared authorization/patient locks protect these
checks from cooperating staff-role/status and patient-archive changes until
commit. Schema-null clinician remains supported for historical reads only.

Only SCHEDULED and CONFIRMED appointments can be administratively edited.
PATCH cannot change patientId, UUID, reference, creator, status, cancellation
metadata or timestamps. For a wrong patient, cancel and create a new booking.
Partial time changes are validated against the latest other endpoint. All PATCHes
recheck patient/clinician eligibility and duration. Text/type-only corrections
may edit a past scheduled/confirmed booking; time/clinician changes may not move
or reassign a past visit. CHECKED_IN and terminal records cannot be rewritten.

## Conflicts and concurrency

SCHEDULED, CONFIRMED and CHECKED_IN block both the clinician and the patient.
COMPLETED, CANCELLED and NO_SHOW release the interval. Overlap means
`existing.start < requested.end AND existing.end > requested.start`.
Intervals are `[start,end)`, so adjacent bookings are allowed.

Migration `20261003150000_appointment_scheduling_integrity` installs
`btree_gist` using `CREATE EXTENSION IF NOT EXISTS` and adds two partial GiST
exclusion constraints combining UUID equality and `tstzrange` overlap. These
constraints arbitrate concurrent creates/reschedules across instances and also
protect direct database writes. A clinician-null legacy row still blocks its
patient. The implementation follows PostgreSQL's
[range exclusion guidance](https://www.postgresql.org/docs/current/rangetypes.html#RANGETYPES-CONSTRAINT).

Prisma does not represent these exclusion constraints in the schema; preserve
the reviewed SQL migration, including predicates and half-open bounds. Do not
use `db push`. Deployment credentials must be permitted to install `btree_gist`,
or operators must preinstall it. Verify hosted-provider support before deployment;
there is no silent fallback to an unsafe SELECT/INSERT check. Existing blocking
overlaps cause migration failure and need reviewed correction before rollout;
the migration does not cancel or erase existing bookings. Deployment is managed
by Prisma's migration ledger; a second `migrate deploy` has no pending work.

The service maps the adapter's preserved SQLSTATE 23P01 to a generic
APPOINTMENT_CONFLICT outside the aborted transaction, without parsing/exposing
database messages. Identifier uniqueness remains database-enforced too.

Appointment transactions take shared auth lock `(1296385106,1)`; writes then
take shared patient lock `(1296385106,2)`. Existing security writers and patient
archival take their respective keys exclusively. Updating an appointment locks
its row before rereading its current assignment/status. Lock order is auth,
patient, appointment. This prevents stale lifecycle overwrites and preserves
independent concurrent PATCH fields without globally serializing bookings.
Actor/session permissions are rechecked after advisory-lock waits. The existing
10-second transaction and database query limits remain.

## Lifecycle and cancellation

| Current status | Allowed status command | Cancellation command |
| --- | --- | --- |
| SCHEDULED | CONFIRMED, NO_SHOW | CANCELLED |
| CONFIRMED | CHECKED_IN, NO_SHOW | CANCELLED |
| CHECKED_IN | COMPLETED | Not allowed |
| COMPLETED | None | Not allowed |
| NO_SHOW | None | Not allowed |
| CANCELLED | None | Idempotent success |

Repeated status commands are conflicts. NO_SHOW requires server time at or after
scheduledStart. CHECKED_IN requires server time within 60 minutes before start
or later. There is no automatic queue, working-hours rule or late check-in cutoff.
COMPLETED requires CHECKED_IN, and never creates an encounter. A future clinical
phase can deliberately link an encounter to a checked-in/completed booking.

Only administrators/records officers may cancel. Cancellation sets server time,
current actor, optional reason and CANCELLED atomically. Repeating cancellation
returns the original representation without replacing reason, timestamp or actor,
and without a second cancellation audit. Cancellation cannot be routed through
the doctor's status permission. Terminal-state corrections/reopening need a
future deliberate, audited workflow.

Archiving a patient does not auto-cancel existing bookings; they remain readable
and blocking until an allowed lifecycle action releases them. Creation and all
administrative edits require an unarchived patient. CONFIRMED/CHECKED_IN transitions
also recheck patient and clinician eligibility. Cancellation, due NO_SHOW and
CHECKED_IN-to-COMPLETED may preserve/close history after patient or clinician
deactivation. Suspending/disabling/demoting a clinician does not rewrite assignment;
operations staff must review affected future appointments and reassign when valid.

## Listing, audit and privacy

Pagination reuses page 1-100000 and limit 1-100; defaults page=1/limit=20.
Ordering is scheduledStart ascending, then UUID ascending. There is no arbitrary
sort or Prisma operator input. Lists include historical and upcoming appointments
unless filtered, including archived patients and inactive historical clinicians.
dateFrom/dateTo inclusively filter scheduledStart (not interval intersection),
require timezone-aware inputs, and validate from <= to by instant. No date-only
or hidden local-time conversion is accepted.

Other exact filters: status, type, patientId, clinicianId. Literal case-insensitive
substring search covers reference, patientNumber and individual patient names;
LIKE wildcards are escaped. It does not search reason/notes or combine name
fields. Search is limited to 100 characters. Zero matches yields totalPages=0;
out-of-range pages are empty. Count/page use READ COMMITTED reads, so totals may
change between them under concurrent writes. Substring scans/large offsets need
workload profiling and possibly additional indexes in a later optimization phase.

Create/update/status/cancel each commit with APPOINTMENT_CREATED/UPDATED/
STATUS_CHANGED/CANCELLED audit events. Detail GET (and Express HEAD) commits
APPOINTMENT_VIEWED before disclosure; failure returns a safe error. Lists create
no per-item events and retain no raw search text. Events contain actor, entity
UUID, request ID, sanitized IP/coarse browser family and existing safe metadata:
source=API, with changedFields=[schedule] or [status] where appropriate. Status
values are not copied into metadata in this phase; the existing allowlist remains
unchanged. No reason, notes, names or cancellation text are copied into audits.

The migration adds VIEWED, STATUS_CHANGED and CANCELLED audit enum values;
CREATED/UPDATED already existed. Append-only protections remain intact. Logs
continue to omit bodies, URLs, query strings and headers; appointment/reason/notes/
cancellationReason fields receive additional structured redaction. Arbitrary
log-message strings must never contain sensitive content.

## Frontend differences and remaining limits

The appointment page is a static calendar placeholder with a fixed date and
"86 appointments" count. Its booking modal collects a patient name, date, local
time, clinician display name, visit-type label and notes; Book simply closes it.
The dashboard mocks contain time/name/detail/colour/initials without persistent
IDs, clinician assignment, end time or lifecycle status. Existing Active/Pending
patient queue labels and Reviewed/Pending medical-record labels are separate
concepts and must not be mapped blindly to appointment status.

Later integration needs patient/clinician selection by UUID, explicit end/duration,
timezone conversion, enum mapping, authenticated sessions/CSRF, server pagination,
conflict feedback and lifecycle commands. A records-accessible clinician picker
is still needed; the existing staff administration list remains ADMIN-only.
Frontend source, forms, mocks, login and queue handling are unchanged here.

There is no appointment recurrence, facility/room allocation, working-hours or
leave calendar, reminder delivery, bulk import, override/reopen flow, search audit,
or general clinical access model. Broad scheduling-administrator access and
booking text still require operational privacy controls. Privileged SQL can
bypass application lifecycle/eligibility checks, though exclusion constraints
still prevent overlap. Audit retention, encryption at rest, backups, monitoring,
least-privilege runtime credentials and deployment capacity remain operational
responsibilities. No regulatory compliance is asserted.

## Files and verification

Created:

```text
server/src/modules/appointments/appointment.validation.ts
server/src/modules/appointments/appointment.dto.ts
server/src/modules/appointments/appointment.service.ts
server/src/modules/appointments/appointment.routes.ts
server/prisma/migrations/20261003150000_appointment_scheduling_integrity/migration.sql
server/tests/appointment.validation.test.ts
server/tests/appointment.database.test.ts
docs/appointment-api.md
```

Modified:

```text
README.md
server/src/shared/authorization/permissions.ts
server/src/shared/logger/logger.ts
server/src/app.ts
server/prisma/schema.prisma
server/tests/patient.validation.test.ts
server/tests/domain.database.test.ts
server/tests/logger.test.ts
server/README.md
docs/architecture.md
docs/data-model.md
```

The patient permission test retains every original patient/clinical case; new
appointment permissions are tested in the appointment suite. Database suites
continue to use guarded disposable databases, all migrations and a second
deployment, never resetting a normal DATABASE_URL.

Verification on 2026-10-04:

| Check | Result |
| --- | --- |
| `npm install` | Passed; 332 packages audited, 0 reported vulnerabilities |
| Prisma generation / `npm run prisma:validate` | Passed |
| `npm run typecheck` | Passed for both workspaces, including server tests |
| `npm run lint` | Passed; backend clean, existing frontend `react(set-state-in-effect)` warning at App.tsx:45 |
| `npm run test` | 232 passed across 8 files |
| Database tests | 364 passed across 7 files |
| Total | **596 passed across 15 files** |
| `npm run build` | Client and server production builds passed |
| Migration deployment | All 5 migrations applied fresh; repeat deploy had no pending work |
| `git diff --check` | Passed |

Database breakdown: appointment 139, auth 99, bootstrap 6, domain 14, lifecycle 3,
patient 102, readiness 1. The 230 added cases comprise 91 appointment unit tests
and 139 database tests; all 366 prior tests remain passing. Existing logger privacy
assertions were also expanded. Coverage includes role/assignment boundaries,
validation, direct-SQL and concurrent scheduling conflicts, adjacent/released
slots, lifecycle timing, idempotency, audit rollback, sensitive-output protection,
and queued authorization/eligibility checks after cooperating changes commit.

An initial typecheck generation collided with a concurrent Prisma generation;
the sequential rerun passed without suppressing errors or changing type safety.
The temporary cluster required recovery after the interrupted session. Application
databases and their data were not reset. The temporary PostgreSQL cluster was
stopped and removed after verification. No frontend source was changed.

Next: define encounter authorization, lifecycle, amendment/history rules and
appointment linkage for a separately requested clinical-record phase. Stop here;
do not begin that phase automatically.
