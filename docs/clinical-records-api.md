# Clinical records API — Step 6

Clinical encounters are historical records. This module uses the existing
Encounter, EncounterComplaint and Diagnosis schema, permission vocabulary, session
security, DTO conventions and transactional audits. It adds amendments and database
immutability protections. Frontend integration is a separate phase.

## Authorization and authorship

| Current staff role | Read | Create/draft/finalize | Amend |
| --- | --- | --- | --- |
| ADMIN | No | No | No |
| RECORDS_OFFICER | No | No | No |
| DOCTOR_IN_CHARGE | All clinical encounters | Own encounters | Own reviewed encounters |

These use CLINICAL_RECORD_READ, CLINICAL_RECORD_CREATE and CLINICAL_RECORD_AMEND.
Administrative authority grants no clinical privilege. Every operation requires
an active staff account and a valid, unexpired, unrevoked database session. Role
and session eligibility are rechecked inside the transaction after acquiring locks.
Suspension, disablement, demotion or session revocation removes access without
rewriting historical attribution.

The current product has no reliable treatment-relationship model. Active doctors
therefore read all encounters, including other doctors' drafts, archived-patient
history and legacy records. This is an explicit broad-access policy; treatment
relationship restrictions and exceptional access require a later product decision.
Appointment visibility remains restricted to each doctor's assigned appointments.

Editing, finalization and amendment require BOTH clinicianId and createdById to
match the authenticated doctor. New records derive both from the session. Legacy
records with a null clinician or a different administrative creator remain readable
but cannot be edited through this workflow. Delegation, author replacement and
correction when the original doctor is unavailable are not implemented.

## Routes and envelopes

All paths start with `/api/v1`. Responses use `Cache-Control: no-store`.
All mutations require the trusted Origin and session-bound X-CSRF-Token; GET does
not require CSRF. IDs are UUIDs; unknown fields are rejected.

| Method/path | Permission | Success |
| --- | --- | --- |
| POST /encounters | CREATE | 201, data.encounter detail |
| GET /encounters | READ | 200, data.items summaries and data.pagination |
| GET /encounters/:id | READ | 200, data.encounter detail |
| PATCH /encounters/:id | CREATE, original author, DRAFT | 200, data.encounter detail |
| POST /encounters/:id/finalize | CREATE, original author, DRAFT | 200, data.encounter detail |
| POST /encounters/:id/amend | AMEND, original author, REVIEWED | 201, data.encounter detail including amendments |
| GET /patients/:patientId/encounters | READ | 200, data.items summaries and data.pagination |

Success envelopes contain `success: true`. Errors contain `success: false` and
`error: { code, message, requestId }`; X-Request-Id is also returned. There is no
encounter DELETE, child CRUD, reassign, reopen, void or amendment-edit endpoint.
Ordinary patient demographics endpoints never embed clinical records.

## Creation and field validation

Example request (replace the patient UUID with an existing active patient):

```json
{
  "patientId": "89f788fb-b4c5-4437-a8e2-a3d16adcc5a0",
  "occurredAt": "2026-10-09T09:00:00Z",
  "complaints": [{ "description": "Example presenting complaint" }],
  "diagnoses": [{ "description": "Example finding", "code": null }],
  "clinicalNotes": "Example clinical note",
  "treatmentPlan": "Example plan"
}
```

The database generates UUIDs and independent `MR-<uppercase UUID>` references.
Initial status is always DRAFT. Only patientId is required. appointmentId is
optional/nullable; omitted occurredAt uses server time. Author, clinician, receiver,
reference, status, review/void metadata and system timestamps are not accepted.

| Editable field | Validation |
| --- | --- |
| occurredAt | Timezone-aware ISO-8601, at most 60 seconds ahead of server time |
| roomLabel | Optional/null, maximum 100 characters |
| historySummary, clinicalNotes, treatmentPlan | Optional/null, maximum 20,000 each |
| followUpAt | Optional/null, timezone-aware, at or after occurredAt |
| complaints | At most 30 objects; description required, 1–200 characters; duplicate trimmed descriptions rejected |
| diagnoses | At most 30 objects; description required, 1–500 characters; optional/null code up to 64 and notes up to 5,000 |

Text is trimmed at its edges, preserving Unicode terminology and internal line
breaks. Empty optional text becomes null. Unsafe control characters are rejected.
Codes are opaque optional labels, not validated ICD codes. All timestamps require
seconds, Z or an explicit offset, and at most millisecond precision. UTC is returned.
Historical occurredAt values support late entry; createdAt retains the actual
entry time. The global 100 KiB JSON limit also applies to combinations of fields.

Complaints and diagnoses belong to the encounter, never permanently to Patient.
No prescription, severity/duration, SOAP or coding registry model was invented.

## Appointment and patient rules

Linked appointments must exist, belong to the same patient, be assigned to the
session's doctor, and be CHECKED_IN or COMPLETED. SCHEDULED, CONFIRMED, CANCELLED
and NO_SHOW are rejected. The appointment row is locked before eligibility checks.
The existing composite foreign key `(appointmentId, patientId)` prevents patient
mismatch; its unique pair permits at most one encounter per non-null appointment.
Concurrent creation is protected by this database uniqueness as well as locking.
Multiple null appointment links are allowed for walk-ins/emergencies; no artificial
appointment is created. appointmentId and patientId cannot change after creation.

Creating, editing or finalizing requires an unarchived patient. Archived history
remains readable, and its original doctor may append corrections to reviewed
records. Staff deactivation and patient archival preserve all historical rows.

## Drafts, finalization and corrections

The existing lifecycle is `DRAFT -> REVIEWED`, using reviewedAt as the explicit
server-generated finalization timestamp. There is no new FINALIZED enum or
finalizedAt column. VOIDED is an existing terminal historical state, readable but
not editable or amendable through this API; this step provides no void operation.

PATCH accepts only the editable fields above and requires a nonempty object.
Omitted fields remain unchanged. A supplied complaints or diagnoses array replaces
that entire collection atomically; an empty array clears it. Replacement can change
child IDs. This applies only to drafts; prior draft content is not versioned,
although each successful edit records an audit event.

Finalization accepts an empty object or no body. At least one nonempty clinical
note, history summary, treatment plan, complaint or diagnosis is required. Room
and follow-up metadata alone are insufficient. occurredAt must have been reached
before finalization, even within the creation clock tolerance. The transaction sets
REVIEWED and reviewedAt, records an audit event and preserves clinical authorship.
Repeated finalization returns ENCOUNTER_FINALIZED. Appointment status is unchanged;
appointment completion remains an explicit scheduling operation.

Reviewed and voided parent records cannot be updated or deleted by normal SQL
while integrity triggers are enabled. Their complaints/diagnoses cannot be added,
changed, moved or removed. Triggers lock the parent to coordinate direct child
writes with finalization. TRUNCATE is blocked for all clinical-history tables.
Draft parent deletion is not universally blocked by SQL (existing restrictive
foreign keys still apply), but no API permits it.

Corrections append a new EncounterAmendment using:

```json
{ "reason": "Reason for correction", "content": "Correction or additional information" }
```

Both fields must be nonempty; reason is limited to 1,000 characters and content
to 20,000. The server sets author and timestamp. The database verifies the reviewed
parent and original author. Amendments themselves cannot be updated, deleted or
truncated. Original encounter content, review time and even updatedAt remain
unchanged. Detail responses include the full ordered amendment history. An
amendment is additional text, not a silent replacement of structured diagnoses.
Repeated successful amendment POSTs create separate entries; no idempotency key
or automatic text deduplication is implemented.

## Queries and DTOs

Both list routes accept page (default 1, maximum 100,000), limit (default 20,
maximum 100), clinicianId, appointmentId, status, dateFrom, dateTo and search.
The general collection also accepts patientId; the history route rejects that
query parameter so it cannot override its path scope. Dates filter occurredAt
inclusively and dateFrom cannot exceed dateTo. Search is a maximum 100-character,
case-insensitive literal reference substring, including literal `%`, `_` and `\`.
It does not search names, notes, diagnoses or amendments. An unknown history
patient returns 404; an existing patient with no encounters returns an empty page.

Ordering is occurredAt descending, createdAt descending, then id ascending.
Pagination contains page, limit, total and totalPages. Offset pagination and
READ COMMITTED totals are intended for interactive browsing, not snapshot exports.

Summary DTO fields:

- id, reference, status, occurredAt, reviewedAt, createdAt.
- patient: id, patientNumber, firstName, middleName, lastName.
- clinician (nullable) and author: id, staffNumber, firstName, lastName.
- appointment (nullable): id, reference.
- diagnoses: id, description, code.

Detail adds roomLabel, historySummary, clinicalNotes, treatmentPlan, followUpAt,
updatedAt, voidedAt, voidReason; complaints with id/description/createdAt;
diagnosis notes/createdAt; amendments with id/reason/content/createdAt and minimal
author identity. Child collections are ordered by createdAt then id ascending.
Explicit selectors and presenters exclude credentials, sessions, staff email,
patient contact details, audit rows and internal fields used only for authorization.
Summary diagnosis labels are clinical data and remain protected by READ permission;
long notes and amendment text are not included in list payloads.

## Audits, privacy and transactions

| Action | Event |
| --- | --- |
| Create | MEDICAL_RECORD_CREATED |
| Draft update | MEDICAL_RECORD_UPDATED |
| Detail access | MEDICAL_RECORD_VIEWED |
| Finalize | MEDICAL_RECORD_FINALIZED |
| Append correction | MEDICAL_RECORD_AMENDED |
| Patient history page | One MEDICAL_HISTORY_VIEWED event for the patient |

History records one event even for an empty existing-patient page, not one event
per encounter. General collection browsing creates no per-row view events.
Audit metadata contains only source API and applicable changedFields classification
(clinicalRecord or status). It never contains clinical content, search strings,
old/new values or amendment bodies. Actor/entity IDs and request correlation
identify the operation. Audit insertion shares the operation's transaction; audit
failure rolls back writes and prevents audited detail/history disclosure.

HTTP logs omit URLs, query strings, request/response bodies, headers and IPs.
Clinical field redaction adds defense in depth to the existing secret redaction.
Operational errors expose stable codes and request IDs, never SQL, Prisma details,
internal messages or stack traces. Do not log arbitrary clinical strings; key-based
redaction cannot make arbitrary log-message text safe.

Transactions reuse the shared authorization advisory lock (key 1), with a shared
patient-state lock (key 2) for writes. Current account/session permissions are
checked after these locks. Linked creation locks the appointment; mutations lock
the encounter FOR UPDATE; detail uses FOR SHARE. Child changes and their audit
commit together. Standard lock order is authorization, patient state, appointment
where applicable, then encounter/children. Cooperating direct writers must observe
this order; parent-locking triggers protect historical content but do not turn
arbitrary SQL into authorized API operations. Transactions use READ COMMITTED and
a 10-second deadline, within the existing bounded connection pool.

## Errors

Authentication/CSRF errors use the existing auth contract. Role denial is 403
FORBIDDEN; another doctor's mutation is 403 ENCOUNTER_AUTHOR_REQUIRED. Missing
resources use 404 PATIENT_NOT_FOUND, APPOINTMENT_NOT_FOUND or ENCOUNTER_NOT_FOUND.
Invalid schemas use 400 VALIDATION_ERROR; invalid clinical times use 400
INVALID_ENCOUNTER_TIME. Business conflicts use 409 PATIENT_ARCHIVED,
APPOINTMENT_NOT_ELIGIBLE_FOR_ENCOUNTER, APPOINTMENT_ALREADY_HAS_ENCOUNTER,
ENCOUNTER_REFERENCE_CONFLICT, ENCOUNTER_FINALIZED, ENCOUNTER_NOT_EDITABLE,
EMPTY_CLINICAL_RECORD or ENCOUNTER_NOT_FINALIZED. Unexpected failures use the
existing safe 500 INTERNAL_ERROR envelope.

## Migration and verification

`20261004140000_clinical_encounter_integrity` adds EncounterAmendment (UUID key,
restrictive encounter/author foreign keys, reason, content, createdAt, and
encounter/time and author/time indexes), content checks, immutability triggers and
three audit enum values: MEDICAL_RECORD_FINALIZED, MEDICAL_RECORD_AMENDED and
MEDICAL_HISTORY_VIEWED. StaffUser and Encounter gain amendment relations.
EncounterStatus and existing encounter fields are unchanged. No new extension is
needed; the prior scheduling migration still requires btree_gist. There are now
11 models, 8 enums and 6 migrations. Existing reviewed/voided history is frozen
without rewriting it. Preserve the SQL migrations; do not substitute db push.

No runtime dependencies or environment variables were added. The lockfile updates
the transitive source-map-js to 1.2.2 to resolve
[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

Run npm install, prisma:generate, prisma:validate, typecheck, lint, test,
test:database and build through the root npm scripts. Database tests retain the
loopback-only, named-control-database safeguards and synthetic fixtures. Each
suite gets a generated disposable database; all six migrations deploy twice.
Tests cover authorization, session changes, drafts, eligibility, time validation,
concurrent uniqueness/finalization, immutable SQL history, audit rollback, CSRF,
DTO privacy and logging. See the [Step 6 completion report](step-6-completion.md) for exact results.

## Frontend findings and remaining limits

The Records page uses mock short MR identifiers, patient/clinician display names,
relative visit text, one diagnosis string, Reviewed/Pending labels, static metrics
and local pagination. Its overflow action is a placeholder. There is no encounter
detail/editor, finalization or amendment UI. Pending must not be assumed to mean
DRAFT without product review.

PatientModal mixes patient registration with room/history/complaint fields and
free-text received-by/personnel names. Its save persists only partial local data;
it does not create an encounter or persist the selected complaints. Patients lists
show symptoms as patient attributes and use Active/Pending queue labels. Future
integration must separate demographics from clinical access, resolve staff/patient
UUIDs, show multiple diagnoses and immutable corrections, and convert timestamps
explicitly. Frontend files, mocks, forms, authentication and behavior are unchanged.

Remaining decisions include narrower doctor visibility, delegated correction when
an author is unavailable, draft revision history, pagination of large amendment
histories, idempotent mutation retries, deployment privileges, retention, encrypted
backups and operational monitoring. Patient/staff display names are current related
identity fields rather than historical name snapshots. The detail endpoint returns
all amendments, so its size can grow. Database owners can disable triggers; use
separate migration/runtime roles and restricted grants. reviewedAt is application
finalization metadata, not a regulatory or legal-signature certification.

This step does not implement prescriptions, notifications, reports, dashboards,
uploads, laboratory/imaging integrations, password reset/MFA or frontend wiring.
Next: review the clinical access and correction policies with the product owner
before choosing the next implementation phase. Stop at Step 6.
