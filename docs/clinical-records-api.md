# Clinical records API — Step 6

Clinical encounters are historical records. This module uses the existing
Encounter, EncounterComplaint and Diagnosis schema, permission vocabulary, session
security, DTO conventions and transactional audits. It adds amendments and database
immutability protections. Frontend integration is a separate phase.

**Phase 19A.** Clinical records now belong to a hospital stay
([admissions and discharge](admissions-discharge.md)). A new record names a current admission
(`admissionId`) instead of a patient or appointment; the patient comes from the admission and the
room defaults to the admission's current room. Records carry structured **medication orders**,
handled like diagnoses. Appointment linking is gone; records created earlier keep their
appointment reference or none and remain readable, editable while still drafts, and amendable.

**Phase 19B.** Each new medication order names a medicine from the
[medication catalog](medication-catalog-prescribing.md) by `medicationId`; the server copies its
name into `medicine`. Orders add `strength`; dose, route and frequency are required. A medicine
deactivated in the catalog cannot be newly ordered (`409 MEDICATION_INACTIVE`) but may stay on a
draft that already has it. The medication history accepts `admissionId` or `excludeAdmissionId`.
"DOCTOR_IN_CHARGE" is shown as "Medical Officer" in the product.

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
| GET /patients/:patientId/medications | READ | 200, data.items medication history and data.pagination (Phase 19A) |

Success envelopes contain `success: true`. Errors contain `success: false` and
`error: { code, message, requestId }`; X-Request-Id is also returned. There is no
encounter DELETE, child CRUD, reassign, reopen, void or amendment-edit endpoint.
Ordinary patient demographics endpoints never embed clinical records.

## Creation and field validation

Example request (replace the admission UUID with a current admission):

```json
{
  "admissionId": "4b0e3f4e-7c1a-4f7e-9d55-2f1f0f6a9c21",
  "occurredAt": "2026-10-09T09:00:00Z",
  "complaints": [{ "description": "Example presenting complaint" }],
  "diagnoses": [{ "description": "Example finding", "code": null }],
  "medications": [{ "medicationId": "0f4c8a52-5d0e-4b1a-9b7e-3c2d1e0f9a87", "strength": "500 mg", "dose": "1 tablet", "route": "Oral", "frequency": "Twice daily", "duration": "5 days" }],
  "clinicalNotes": "Example clinical note",
  "treatmentPlan": "Example plan"
}
```

The database generates UUIDs and independent `MR-<uppercase UUID>` references.
Initial status is always DRAFT. Only admissionId is required; patientId and appointmentId are
not accepted. Omitted occurredAt uses server time; omitted roomLabel records the admission's
current room (an explicit null records none). Author, clinician, receiver, reference, status,
review/void metadata and system timestamps are not accepted.

| Editable field | Validation |
| --- | --- |
| occurredAt | Timezone-aware ISO-8601, at most 60 seconds ahead of server time |
| roomLabel | Optional/null, maximum 100 characters |
| historySummary, clinicalNotes, treatmentPlan | Optional/null, maximum 20,000 each |
| followUpAt | Optional/null, timezone-aware, at or after occurredAt |
| complaints | At most 30 objects; description required, 1–200 characters; duplicate trimmed descriptions rejected |
| diagnoses | At most 30 objects; description required, 1–500 characters; optional/null code up to 64 and notes up to 5,000 |
| medications | At most 30 objects; `medicationId` (an active catalog medicine, or one already on this draft), dose (1–100), route (1–50) and frequency (1–100) required; optional/null strength (100), duration (100) and notes (2,000). `medicine` is not accepted |

Text is trimmed at its edges, preserving Unicode terminology and internal line
breaks. Empty optional text becomes null. Unsafe control characters are rejected.
Codes are opaque optional labels, not validated ICD codes. All timestamps require
seconds, Z or an explicit offset, and at most millisecond precision. UTC is returned.
Historical occurredAt values support late entry; createdAt retains the actual
entry time. The global 100 KiB JSON limit also applies to combinations of fields.

Complaints, diagnoses and medication orders belong to the encounter, never permanently to
Patient. Medication orders record what was prescribed from the catalog; there is no dosing check,
dispensing or administration record. No severity/duration, SOAP or coding registry model was invented.

## Admission and patient rules

The admission must exist (`404 ADMISSION_NOT_FOUND`) and be `ADMITTED`
(`409 ADMISSION_NOT_CURRENT`); a discharged stay accepts no new records. Creation takes a shared
lock on the admission row, so a concurrent discharge waits and is then refused because the new
record is a draft. The composite foreign key `(admissionId, patientId)` keeps the record on the
admission's own patient, and a trigger refuses new records on a stay that is not current and any
change of a record's admission. patientId and admissionId cannot change after creation.

Legacy appointment links stay as stored: the composite `(appointmentId, patientId)` key and its
one-encounter-per-appointment uniqueness remain, but the API makes no new links.

Creating, editing or finalizing requires an unarchived patient. Archived history
remains readable, and its original doctor may append corrections to reviewed
records. Staff deactivation and patient archival preserve all historical rows.

## Drafts, finalization and corrections

The existing lifecycle is `DRAFT -> REVIEWED`, using reviewedAt as the explicit
server-generated finalization timestamp. There is no new FINALIZED enum or
finalizedAt column. VOIDED is an existing terminal historical state, readable but
not editable or amendable through this API; this step provides no void operation.

PATCH accepts only the editable fields above and requires a nonempty object.
Omitted fields remain unchanged. A supplied complaints, diagnoses or medications array replaces
that entire collection atomically; an empty array clears it. Replacement can change
child IDs. Complaints, diagnoses and medication orders are returned in the order they were supplied;
each written child receives a distinct creation timestamp in entry order. This
applies only to drafts; prior draft content is not versioned, although each
successful edit records an audit event.

Finalization accepts an empty object or no body. At least one nonempty clinical
note, history summary, treatment plan, complaint, diagnosis or medication order is required. Room
and follow-up metadata alone are insufficient. occurredAt must have been reached
before finalization, even within the creation clock tolerance. The transaction sets
REVIEWED and reviewedAt, records an audit event and preserves clinical authorship.
Repeated finalization returns ENCOUNTER_FINALIZED. A medication order counts as clinical
content. Finalizing every draft on a stay is what allows the stay to be discharged.

Reviewed and voided parent records cannot be updated or deleted by normal SQL
while integrity triggers are enabled. Their complaints/diagnoses/medication orders cannot be added,
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
Distinct amendment POSTs create separate entries; an identical resend is rejected
(see below). Amendments take no `Idempotency-Key`.

`POST /encounters` accepts an optional `Idempotency-Key`; see
[mutation idempotency](idempotency.md). The same doctor resending the same accepted
draft with the same key within 24 hours receives the encounter it created (`201`,
`Idempotency-Replayed: true`). No second `MEDICAL_RECORD_CREATED` and no view audit
are written. Changed content under the same key returns `409 IDEMPOTENCY_KEY_REUSED`.
Only a keyed HMAC of the accepted fields (including the admission and medication orders) is
stored, never clinical text.

## Queries and DTOs

Both list routes accept page (default 1, maximum 100,000), limit (default 20,
maximum 100), clinicianId, admissionId, status, dateFrom, dateTo and search.
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
- admission (nullable for legacy records): id, admissionNumber.
- appointment (nullable; legacy records only): id, reference.
- diagnoses: id, description, code.

Detail adds roomLabel, historySummary, clinicalNotes, treatmentPlan, followUpAt,
updatedAt, voidedAt, voidReason; complaints with id/description/createdAt;
diagnosis notes/createdAt; medications with id/medicine/dose/route/frequency/duration/notes/createdAt;
amendments with id/reason/content/createdAt and minimal
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
| Medication history page | One MEDICAL_HISTORY_VIEWED event with changedFields `medications` |

History records one event even for an empty existing-patient page, not one event
per encounter. General collection browsing creates no per-row view events.
Audit metadata contains only source API and applicable changedFields classification
(clinicalRecord, status, or medications when orders were written). It never contains clinical
content, medicine names, search strings,
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
checked after these locks. Creation locks the admission FOR SHARE; mutations lock
the encounter FOR UPDATE; detail uses FOR SHARE. Child changes and their audit
commit together. Standard lock order is authorization, patient state, admission
where applicable, then encounter/children. Cooperating direct writers must observe
this order; parent-locking triggers protect historical content but do not turn
arbitrary SQL into authorized API operations. Transactions use READ COMMITTED and
a 10-second deadline, within the existing bounded connection pool.

## Errors

Authentication/CSRF errors use the existing auth contract. Role denial is 403
FORBIDDEN; another doctor's mutation is 403 ENCOUNTER_AUTHOR_REQUIRED. Missing
resources use 404 PATIENT_NOT_FOUND, ADMISSION_NOT_FOUND or ENCOUNTER_NOT_FOUND.
Invalid schemas use 400 VALIDATION_ERROR; invalid clinical times use 400
INVALID_ENCOUNTER_TIME. Business conflicts use 409 PATIENT_ARCHIVED, ADMISSION_NOT_CURRENT,
ENCOUNTER_REFERENCE_CONFLICT, ENCOUNTER_FINALIZED, ENCOUNTER_NOT_EDITABLE,
EMPTY_CLINICAL_RECORD, ENCOUNTER_NOT_FINALIZED or DUPLICATE_AMENDMENT. An
amendment whose author, reason and content exactly match an existing amendment on
the same encounter is rejected, so a resent request (including a browser resend
after a dropped connection) cannot append the same permanent correction twice.
Unexpected failures use the existing safe 500 INTERNAL_ERROR envelope.

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
histories, idempotency for clients that send no key, deployment privileges, retention, encrypted
backups and operational monitoring. Patient/staff display names are current related
identity fields rather than historical name snapshots. The detail endpoint returns
all amendments, so its size can grow. Database owners can disable triggers; use
separate migration/runtime roles and restricted grants. reviewedAt is application
finalization metadata, not a regulatory or legal-signature certification.

This step does not implement prescriptions, notifications, reports, dashboards,
uploads, laboratory/imaging integrations, password reset/MFA or frontend wiring.
Next: review the clinical access and correction policies with the product owner
before choosing the next implementation phase. Stop at Step 6.
