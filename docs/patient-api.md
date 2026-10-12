# Patient demographics and domain authorization (Step 4)

This step adds patient registration, demographic reads/updates and reversible
archival. It preserves the existing session, CSRF, staff-administration, audit,
database and error architecture. There are no appointment, encounter, diagnosis,
prescription, notification, reporting or dashboard APIs in this step. The
frontend continues to use mocks and simulated login.

## Findings and scope

The existing Patient model has UUID identity, a database-generated patient number,
first/middle/last names, optional DOB and phone, creator, archival time and creation/
update timestamps. It has no patient email, sex/gender, address, emergency contact
or blood group. Those fields are not invented or accepted by these endpoints.
The existing DTO/error/session patterns are suitable to extend; no repository
abstraction or new framework/dependency is needed.

The frontend registration modal collects names/phone together with room,
received-by/personnel text, complaints and history. Its Save currently persists
only received-by/personnel text in localStorage. The patient list searches mock
name, short ID and complaint, shows age strings and Active/Pending care-queue
labels, and paginates locally by two. Its status selector and overflow button
are placeholders. There is no implemented standalone patient-demographic detail
screen. Clinical records/visits are separate concepts from this API.

## Permission boundary

`shared/authorization/permissions.ts` defines a closed Permission vocabulary and
explicit role mapping. `requirePermission` uses only the authenticated current
database role established by `requireAuth`; missing authentication yields 401,
missing permission yields 403 `FORBIDDEN`. No body/query/header can select roles
or permissions. Staff-administration `requireRole('ADMIN')` remains unchanged.

| Permission | ADMIN | RECORDS_OFFICER | DOCTOR_IN_CHARGE |
| --- | --- | --- | --- |
| PATIENT_READ | Yes | Yes | Yes |
| PATIENT_CREATE | Yes | Yes | No |
| PATIENT_UPDATE | Yes | Yes | No |
| PATIENT_ARCHIVE | Yes | Yes | No |
| CLINICAL_RECORD_READ | No | No | Reserved for future clinical routes |
| CLINICAL_RECORD_CREATE | No | No | Reserved for future clinical routes |
| CLINICAL_RECORD_AMEND | No | No | Reserved for future clinical routes |

ADMIN manages staff and administrative demographics; that technical authority
does not imply access to clinical notes. The doctor's future clinical permissions
are policy vocabulary only: no clinical endpoint is introduced. There are no
speculative ward, facility, department or per-doctor ownership rules. Future
clinical routes must deliberately select permissions and record lifecycle rules.
This explicit approach follows [OWASP's authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

All patient endpoints require an ACTIVE, unexpired, non-revoked staff session.
Mutations additionally require the existing trusted Origin and session-bound
`X-CSRF-Token`. GET/HEAD do not require CSRF; browser preflight follows the existing
CORS policy. The strict login rate limiter is not applied to patient operations.
Patient responses use `Cache-Control: no-store`.

## Input and response contract

Registration requires `firstName` and `lastName` because both are required by the
existing schema. `middleName`, `dateOfBirth` and `phone` are optional/nullable.
Surrounding name whitespace is trimmed; spelling, case, Unicode, punctuation and
internal spacing are preserved. Names are limited to 100 characters and reject
control characters. No automatic case conversion, transliteration, fabricated
surname or Western name splitting is performed. Supporting a single legal name
without a surname requires a later explicit schema/product decision.

DOB is a real calendar date in `YYYY-MM-DD`, not an age or timestamp. Invalid
dates and future UTC dates are rejected. No arbitrary maximum age is imposed;
year zero is rejected. An update also rejects DOB after original registration,
consistent with the existing database constraint. Blank/whitespace optional
strings become null; omitted PATCH fields are left unchanged. Empty required
names and an empty PATCH are rejected.

Phone handling removes spaces, parentheses, dots and hyphens, and converts a
leading `00` international prefix to `+`. It accepts 7-15 digits, with an optional
leading `+` whose first digit must be nonzero. National leading zeroes are retained.
There is no Ghana-only restriction, country inference, extension parsing, carrier
lookup or claim that a syntactically valid number is assigned/reachable. For
example `024 123 4567` stays `0241234567`; it is not guessed to equal
`+233241234567`. Choose international form when staff know the country code.

All bodies/queries use strict Zod schemas. Even a syntactically valid patient
email is rejected because the field does not exist. Existing `VALIDATION_ERROR`
handling avoids echoing rejected values. Mutation data is constructed explicitly
from the allowed fields; request objects are never spread into Prisma writes.

`toPatientResponse` explicitly selects/maps only:

```text
id, patientNumber, firstName, middleName, lastName, dateOfBirth,
phone, archivedAt, createdAt, updatedAt
```

DOB is a date-only string or null. Timestamps are UTC ISO strings, with nullable
`archivedAt`. There is no createdBy relation/ID, audit metadata, helper field,
appointment, encounter, diagnosis or clinical content in the response. Adding a
future Prisma field will not automatically expose it through this DTO.

## Endpoint reference

All paths below are relative to `/api/v1/patients`. Success envelopes use
`{success:true,data:...}`. Errors use
`{success:false,error:{code,message,requestId}}`; the same ID is in X-Request-Id.
Every `:id` is the internal UUID, not the display patient number.

| Method/path | Permission | Body/query | Success | Relevant errors |
| --- | --- | --- | --- | --- |
| POST `/` | PATIENT_CREATE | Required firstName/lastName; optional middleName/dateOfBirth/phone | 201; `data.patient` DTO | VALIDATION_ERROR, POSSIBLE_DUPLICATE_PATIENT, PATIENT_IDENTIFIER_CONFLICT |
| GET `/` | PATIENT_READ | page, limit, search, archived | 200; `data.items` DTOs and `data.pagination` | VALIDATION_ERROR |
| GET `/:id` | PATIENT_READ | UUID; no clinical expansions | 200; `data.patient` DTO | VALIDATION_ERROR, PATIENT_NOT_FOUND |
| PATCH `/:id` | PATIENT_UPDATE | Nonempty subset of demographic input fields | 200; `data.patient` DTO | VALIDATION_ERROR, INVALID_PATIENT_DATA, PATIENT_NOT_FOUND, PATIENT_ARCHIVED, POSSIBLE_DUPLICATE_PATIENT |
| POST `/:id/archive` | PATIENT_ARCHIVE | Empty object or no body | 200; `data.patient` DTO | VALIDATION_ERROR, PATIENT_NOT_FOUND |
| POST `/:id/reactivate` | PATIENT_ARCHIVE | Empty object or no body | 200; `data.patient` DTO | VALIDATION_ERROR, PATIENT_NOT_FOUND, POSSIBLE_DUPLICATE_PATIENT |

All routes may also return AUTHENTICATION_REQUIRED (401), FORBIDDEN (403),
ORIGIN_NOT_ALLOWED (403), and safe INTERNAL_ERROR (500). Mutations require valid
CSRF or return CSRF_INVALID (403). VALIDATION_ERROR and INVALID_PATIENT_DATA use
400; PATIENT_NOT_FOUND uses 404; duplicate/archival/identifier conflicts use 409.
Database and internal exception details are never returned.

Example registration body:

```json
{
  "firstName": "Ama",
  "middleName": null,
  "lastName": "Example",
  "dateOfBirth": "1990-02-28",
  "phone": "+233241234567"
}
```

The server derives `createdById` exclusively from the session. Patient numbers
reuse PostgreSQL's independent `PT-<uppercase UUID v4>` default and unique index.
Controllers never generate them, and clients cannot supply them. A database
uniqueness collision maps to a safe retryable PATIENT_IDENTIFIER_CONFLICT; there
is no race-prone count-based number allocation.

## List/search and pagination

Defaults are `page=1`, `limit=20`, `archived=false`. Page is 1-100000 and limit
1-100. Results sort by createdAt descending, then UUID ascending. There is no
client-selected column/sort or unbounded export. An out-of-range page returns an
empty items array. Zero matches means totalPages=0. The shape is:

```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
  }
}
```

The staff and patient schemas reuse the same pagination bounds/window helper;
the existing staff response shape is preserved. Count and page are separate
reads, so concurrent registrations can change the total between those reads.
Offset pagination is intentionally bounded, not a consistent export snapshot.

Search is a trimmed, maximum-100-character literal substring across patientNumber,
firstName, middleName and lastName, case-insensitively. A phone-like query is also
searched against normalized phone digits. SQL LIKE wildcard characters are
escaped; no user-controlled raw SQL or arbitrary Prisma filters are used. This
does not combine name fields into a synthetic full name or search symptoms,
diagnoses, notes or unsupported email fields. Existing btree indexes help ordering
and exact lookup; substring searches can still scan. Trigram/full-text indexing
and query cost controls should follow measured workload requirements.

`archived=false` returns only unarchived identities; `true` returns only archived
identities; `all` returns both. These values are independent of care/queue state.
Authorized detail access includes archived patients.

## Probable duplicates

There is no uniqueness constraint on names, DOB or phone. Family members can
share contact numbers, and different people can share names and birth dates.

When DOB and phone are both present, registration checks the combination of
case-insensitive first/middle/last names, identical DOB and normalized phone.
Middle name must match too (including null); no accent folding or transliteration
is attempted. The same check applies to the merged demographic update, excluding
the current UUID, and to reactivation. Archived identities are included so staff
can find/reactivate existing history instead of creating another record.

A match returns 409 POSSIBLE_DUPLICATE_PATIENT with a generic review message and
request ID only. It never returns another patient's ID, number or demographics.
Staff must use their separately authorized search/detail workflow to review the
possible match. The system does not automatically merge people. A formal reviewed
override/merge workflow is deferred; a rare legitimate exact match needs that
future workflow, not invented demographic values to bypass detection.

No match is inferred from phone alone or name+DOB alone. Missing DOB/phone means
the check cannot identify a probable duplicate. National/international variants,
spelling variations and unnormalized legacy/direct-SQL records may not match;
this is a conservative signal, not proof of identity or comprehensive deduplication.
Future importers must use the same normalization/policy or deliberately migrate
legacy values. These limits should be considered during staff review.

## Transactions, authorization races and history

Patient creation, demographic update, archive and reactivation each combine the
mutation with its audit insertion in one READ COMMITTED transaction. Detail reads
also transact with PATIENT_VIEWED and fail closed if the audit cannot be recorded.
List/search is read-only and creates no per-result audits, avoiding an audit row
for every patient returned. Raw search strings are not retained in logs/audits.
A dedicated minimal search-access audit can be designed later if required.

Patient transactions take a shared transaction advisory lock on the existing
auth/security key `(1296385106, 1)`. Role/status/session writers take that key
exclusively. Patient writers then take a second exclusive transaction lock
`(1296385106, 2)` before rechecking the actor's active session/current permission.
This prevents queued stale authorization from writing after revocation, and
serializes the probable-duplicate check plus insert/update across API instances.
PATCH merges against the latest record; concurrent changes to separate fields
are preserved. Lock order is always auth then patient. See
[PostgreSQL's transaction advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS).

The patient write lock is deliberately coarse. It protects this bounded phase
without adding false identity uniqueness constraints, but limits write throughput.
Profile before large deployments and retain consistent lock ordering in future
writers. Database query/transaction timeouts still apply. Direct privileged SQL
can bypass application duplicate and permission rules; only true identifiers
have database uniqueness guarantees. List requests already in progress are not
cancelled retroactively by a subsequent revocation.

PATCH permits only names, DOB and phone. UUID, patientNumber, creator, createdAt,
updatedAt and archivedAt cannot be supplied. Archived patients must be reactivated
before demographic editing; edits return 409 PATIENT_ARCHIVED otherwise.

Archive sets archivedAt; reactivation clears it on the same patient UUID/number.
Both commands are idempotent: repeating the current state returns unchanged data,
without updating timestamps or emitting a second mutation audit. Archival never
deletes appointments, encounters or identity/history. There is no DELETE route.
Future appointment/encounter creation must reject archived patients; those APIs
and that future invariant are not implemented here.

## Audits, migration and privacy

Patient writes audit PATIENT_CREATED, PATIENT_UPDATED, PATIENT_ARCHIVED and
PATIENT_REACTIVATED. Detail reads audit PATIENT_VIEWED (including HEAD routed
through the detail handler). Events contain actor, patient UUID, request ID,
sanitized IP and coarse browser-family label through the existing audit context.
Metadata contains only source=API and, for updates, changedFields=[demographics].
There are no copied names, phone numbers, DOB, search values or clinical content.
Failure to insert an audit rolls back its mutation or prevents detail disclosure.
Existing append-only triggers and metadata checks remain unchanged.

`20261003120000_patient_audit_actions` adds only PATIENT_ARCHIVED and
PATIENT_REACTIVATED to AuditAction. Patient storage/identifier fields and indexes
are unchanged. No dependency or environment variable is added.

HTTP logging continues to omit request bodies, headers, URLs and query strings.
Additional redaction covers patient objects, names, DOB, phone, email, address,
emergency contacts and search fields as defense in depth. Never put sensitive
content into arbitrary log-message strings. Responses themselves are sensitive;
future UI caches, browser storage, exports and telemetry require deliberate rules.

All active roles currently have broad demographic read access within this single
application. There is no facility/ownership segmentation or break-glass flow.
Clinical access still requires a separate future endpoint/lifecycle design.
Retention, external audit monitoring, encryption at rest, backups and operating
permissions remain deployment responsibilities. No compliance claim is made.

## Frontend integration differences

| Current UI | API contract / later integration work |
| --- | --- |
| Mock short PT identifiers | Separate UUID route identity and database-generated patientNumber |
| Age strings | Optional dateOfBirth; derive age later, never infer DOB from mock ages |
| Active/Pending labels | Care/queue state, not archival; no such demographic status field |
| Symptom search | This API searches demographics/number/phone only |
| Room, history, complaints | Future encounter payloads and clinical permissions |
| Received-by/personnel text | Creator is current session identity; clarify other staff/encounter roles later |
| No DOB/middle-name capture | Optional API fields; frontend integration is deferred |
| Local two-row pagination | Server page/limit/total/totalPages |
| No standalone patient detail | Future demographics-only detail using UUID; clinical records need separate APIs |
| LocalStorage Save and simulated login | Replace in the later integration step, not in this change |

## Files and tests

Created:

```text
server/src/shared/authorization/permissions.ts
server/src/middleware/authorization.ts
server/src/shared/utils/pagination.ts
server/src/modules/patients/patient.validation.ts
server/src/modules/patients/patient.dto.ts
server/src/modules/patients/patient.service.ts
server/src/modules/patients/patient.routes.ts
server/prisma/migrations/20261003120000_patient_audit_actions/migration.sql
server/tests/patient.validation.test.ts
server/tests/patient.database.test.ts
docs/patient-api.md
```

Modified:

```text
server/src/app.ts
server/src/modules/auth/security.transaction.ts
server/src/modules/staff/staff.validation.ts
server/src/modules/staff/staff.service.ts
server/src/shared/logger/logger.ts
server/prisma/schema.prisma
server/tests/domain.database.test.ts
server/tests/logger.test.ts
README.md
server/README.md
docs/architecture.md
docs/data-model.md
```

Tests use the existing guarded, fresh-per-file PostgreSQL runner. Coverage includes
the role/permission matrix, strict validation, DTO/privacy boundaries, duplicate
races, identifiers, pagination/search/archival filtering, every lifecycle command,
linked history preservation, CSRF, suspended/revoked identities, authorization
after lock waits and transaction rollback on injected audit failure. Previous
authentication/bootstrap/domain/readiness/process-lifecycle suites remain required.

Verification completed on 2026-10-03:

| Check | Result |
| --- | --- |
| `npm install` | Passed; 0 reported vulnerabilities; no Step 4 dependencies added |
| Prisma generation and validation | Passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed; existing frontend `react(set-state-in-effect)` warning in `client/src/app/App.tsx:45` remains |
| `npm run test` | 141 tests passed across 7 files |
| `npm run test:database` | 225 tests passed across 6 files |
| `npm run build` | Client and server production builds passed |
| Fresh migration deployment | All 4 migrations applied; second deployment had no pending migrations |

The total is **366 passing tests across 13 files**. Database totals are auth 99,
bootstrap 6, domain 14, lifecycle 3, patient 102 and readiness 1. Step 4 adds
80 patient validation/permission tests and 102 patient database tests, and extends
the existing logger privacy assertions. All 184 previous tests remain passing.
Database verification used an isolated temporary PostgreSQL cluster and the
guarded runner's disposable databases, never the normal application database.

Next: define appointment scheduling rules and permissions for the next bounded
phase. Do not begin appointment or clinical-record APIs automatically.
