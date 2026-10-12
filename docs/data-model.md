# Hospital data model and staff identity foundation

Step 2 established storage, reviewed migrations, a first-administrator CLI and
tests. Step 3 adds StaffSession and staff authentication/administration; see
[authentication](authentication.md) for that extension and lifecycle rules.
Step 4 adds [patient demographic APIs and domain permissions](patient-api.md),
including archival/reactivation audit actions. Frontend API integration remains
deferred; the Patient storage fields are unchanged.
Step 5 adds [appointment scheduling APIs](appointment-api.md). Migration
`20261003150000_appointment_scheduling_integrity` installs `btree_gist`, adds
partial `[start,end)` exclusion constraints for both patient and clinician on
SCHEDULED/CONFIRMED/CHECKED_IN appointments, and adds VIEWED/STATUS_CHANGED/
CANCELLED appointment audit actions. These SQL-only constraints must be preserved
in future Prisma migrations. New API bookings require an active doctor, while
nullable historical assignment remains supported in storage. Existing overlaps
must be reviewed before deploying the constraints; no history is auto-deleted.

Step 6 adds [clinical encounter APIs](clinical-records-api.md), original-author
drafts/finalization, immutable reviewed history and append-only amendments.
Migration `20261004140000_clinical_encounter_integrity` adds EncounterAmendment,
three audit actions and SQL integrity triggers. Existing EncounterStatus and
reviewedAt are reused; no patient clinical columns are added.

Step 7 adds [internal staff notification APIs](notifications-api.md), own-inbox
read state, active-recipient broadcasts and required appointment notices. Migration
`20261009120000_notification_workflow` extends the existing notification models
with a typed appointment link, an inbox index, immutable content/read history and
one broadcast audit action. No new model or notification type is introduced.

## Entities and relationships

```text
StaffUser (one StaffRole; one StaffStatus)
  |-- creates Patients and Appointments
  |-- creates/receives/performs Encounters
  |-- sends Notifications
  |-- receives Notifications through NotificationRecipient
  `-- acts in AuditEvents

Patient
  |-- many Appointments -- zero or one Encounter per appointment
  `-- many Encounters (including walk-ins without an appointment)
        |-- many EncounterComplaints
        |-- many Diagnoses
        `-- many EncounterAmendments -- original author StaffUser

Notification -- many NotificationRecipients -- StaffUser
AuditEvent -- optional actor StaffUser; typed entity UUID reference
```

| Model | Responsibility |
| --- | --- |
| `StaffUser` | Staff identity, one authorization role, account status, password hash and lifecycle timestamps |
| `StaffSession` | Hashed opaque session credential, independent CSRF token, absolute expiry and revocation |
| `Patient` | Demographics: names, optional date of birth and phone, creator, archival timestamp |
| `Appointment` | Patient, optional assigned clinician, creator, start/end, type, status, reason/notes and cancellation attribution |
| `Encounter` | One visit: patient, optional appointment/clinician, creator and receiver, room, history summary, notes, plan and follow-up |
| `EncounterComplaint` | Multiple structured complaint descriptions for a visit; duplicate descriptions within that visit are rejected |
| `Diagnosis` | Findings within an encounter, optional opaque code and notes; no ICD registry or coding-system claim |
| `EncounterAmendment` | Append-only correction: reviewed encounter, original author, reason, content and creation time; no updatedAt |
| `Notification` | Shared immutable direct/broadcast title and message, sender, optional target role and restrictive appointment link |
| `NotificationRecipient` | Snapshot of recipients and each recipient's read timestamp |
| `AuditEvent` | Append-only action record, optional actor, typed entity UUID, correlation metadata and time |

There is no role lookup table: the three supported roles form the stable
`StaffRole` enum. There is no prescription model because the current UI has no
medication or prescription fields. Pharmacy inventory is out of scope.

The appointment/encounter composite foreign key includes both appointment ID
and patient ID. An encounter cannot reference another patient's appointment.
The unique pair also permits at most one encounter per appointment. Multiple
walk-in encounters are allowed because a null appointment is not a unique value.

## Enums and lifecycle

- `StaffRole`: `ADMIN`, `RECORDS_OFFICER`, `DOCTOR_IN_CHARGE`.
- `StaffStatus`: `PENDING`, `ACTIVE`, `SUSPENDED`, `DISABLED`.
- `AppointmentStatus`: `SCHEDULED`, `CONFIRMED`, `CHECKED_IN`, `COMPLETED`,
  `CANCELLED`, `NO_SHOW`.
- `AppointmentType`: `CONSULTATION`, `FOLLOW_UP`, `ROUTINE_CHECKUP`, `EMERGENCY_REVIEW`.
- `EncounterStatus`: `DRAFT`, `REVIEWED`, `VOIDED`.
- `NotificationType`: `DIRECT`, `BROADCAST`.
- `AuditEntityType`: `STAFF_USER`, `PATIENT`, `APPOINTMENT`, `ENCOUNTER`, `NOTIFICATION`, `AUTH_ATTEMPT`.
- `AuditAction`: `ADMIN_BOOTSTRAPPED`, `STAFF_CREATED`, `STAFF_ROLE_CHANGED`,
  `STAFF_STATUS_CHANGED`, `PATIENT_CREATED`, `PATIENT_VIEWED`, `PATIENT_UPDATED`,
  `MEDICAL_RECORD_CREATED`, `MEDICAL_RECORD_VIEWED`, `MEDICAL_RECORD_UPDATED`,
  `APPOINTMENT_CREATED`, `APPOINTMENT_UPDATED`, `NOTIFICATION_SENT`,
  `LOGIN_SUCCEEDED`, `LOGIN_FAILED`, `LOGOUT`, `SESSION_REVOKED`,
  `PATIENT_ARCHIVED`, `PATIENT_REACTIVATED`, `APPOINTMENT_VIEWED`,
  `APPOINTMENT_STATUS_CHANGED`, `APPOINTMENT_CANCELLED`,
  `MEDICAL_RECORD_FINALIZED`, `MEDICAL_RECORD_AMENDED`, `MEDICAL_HISTORY_VIEWED`,
  `NOTIFICATION_BROADCAST_CREATED`.
  Clinical writes/detail access and patient-history views now use transactional audits.

Pending staff may have no password yet. Active staff must have an Argon2id hash
and password-change time. There is no redundant `isActive`. Suspension can be
reversed through ADMIN staff administration; disablement is terminal in this API
and retains identity for history. The authentication guide defines allowed
transitions and last-admin safeguards. Recovery remains deferred.
Roles never come from a login request.

Appointments normally progress through scheduling, confirmation, check-in and
completion, with cancellation/no-show alternatives. End time must exceed start.
Cancellation requires a timestamp and staff actor. Step 5 now enforces the
documented lifecycle and rescheduling rules in services, with SQL exclusion
constraints preventing overlapping blocking appointments for either patient or
clinician. See [appointment scheduling](appointment-api.md) for the exact policy.

Legacy storage permits unassigned drafts; new API encounters always derive
clinician and creator from the authenticated doctor. Only that original author
can edit a DRAFT or finalize it to REVIEWED, with server reviewedAt and nonempty
clinical content. Appointment completion remains separate. REVIEWED and VOIDED
parents and their complaints/diagnoses are immutable under SQL triggers. VOIDED
requires existing reason/time metadata but has no transition API in Step 6.
Corrections append EncounterAmendment rows to REVIEWED records; neither original
content nor amendments can be overwritten. Active doctors can read all clinical
history, including archived patients, while administrators/records officers have
no clinical privileges. Creation/edit/finalization require an unarchived patient;
historical corrections remain allowed after archival. See the clinical guide for
limitations on legacy authorship, inactive doctors and broad visibility.

## Identifiers and uniqueness

All primary keys are PostgreSQL-generated UUID v4 values. Independent business
references are generated by PostgreSQL defaults, not by counting rows:

- Patient: `PT-<uppercase UUID v4>`.
- Appointment: `AP-<uppercase UUID v4>`.
- Encounter: `MR-<uppercase UUID v4>`.
- Staff: an institution-assigned `STF-` plus 6-32 uppercase alphanumeric
  characters. The default is `STF-` plus 32 UUID hex characters. Bootstrap
  deliberately requires an operator-supplied staff number.

These references contain no name, diagnosis or other clinical content. Database
unique constraints reject any collision, including concurrent writes; a future
writer may retry a generated-reference collision. References are not access
tokens and never substitute for authorization.

Email is trimmed and lowercased by staff input validation. A database check
requires canonical lowercase, whitespace-free email and the unique constraint
enforces uniqueness. Direct SQL with mixed-case email is rejected rather than
silently creating a second identity. Staff numbers are normalized at input and
have both format and unique constraints. Names cannot be blank.

## Historical continuity and time

All foreign keys use `ON DELETE RESTRICT` and `ON UPDATE RESTRICT`. Deleting a
referenced staff member, patient, appointment or encounter fails; nothing
cascade-deletes clinical history. Use staff status, patient `archivedAt`, or
historical retention instead. No clinical delete/void API is exposed. Reviewed
and voided encounters and amendments are protected even when unreferenced;
unreferenced draft rows are not universally undeletable in SQL;
future APIs must apply an explicit retention/deletion policy.

Every timestamp is `timestamptz(3)`, representing an absolute instant; write UTC
and serialize ISO 8601 UTC in the APIs. PostgreSQL session display timezone
does not change the stored instant. The frontend will convert for presentation.
Date of birth is a calendar `date`, not an age string or timestamp. Unknown DOB
stays null; future-date DOB is rejected relative to creation in UTC.

Mutable core entities use `createdAt` and `updatedAt`. Prisma updates the latter;
database triggers also update it for direct SQL and reject changing creation
time. Audit records and amendments have only creation time. Recipient read state uses its
dedicated `readAt` rather than a redundant last-updated timestamp.

## Indexes and integrity

Unique identifiers already have indexes. Additional indexes cover staff
role/status; ordered patient names, phone and creation time; patient/clinician
appointment timelines, appointment status/time and facility schedule; patient/
clinician encounter timelines; recipient/unread/time queries; and audit actor,
entity, action and timestamp queries. Foreign-key lookup indexes cover creators,
receivers and cancellers. The appointment `(id, patientId)` unique index is
necessary for the cross-patient protection FK, despite the UUID primary key.
Amendment indexes cover encounter/creation time and author/creation time, with
restrictive foreign keys. Parent-locking triggers prevent concurrent child edits
from bypassing finalized-record protection. All clinical tables reject TRUNCATE;
amendments also reject UPDATE/DELETE. No speculative full-text/trigram search
indexes are added.

Custom SQL checks enforce canonical identities, reference formats, account
credential consistency, time ordering, cancellation/review/void metadata,
nonempty complaints/diagnoses/messages, broadcast audience and read-time order.
Prisma's schema cannot represent all checks/triggers: preserve the SQL migrations.

## Notifications and audit

Message text is stored once. Recipient rows provide a unique notification/user
pair with independent first-read state. BROADCAST targetRole selects a role;
null now means ALL. DIRECT must have no role audience. API delivery selects only
ACTIVE staff, with appointment notices additionally requiring DOCTOR_IN_CHARGE.
Recipients are a send-time snapshot; role/status changes never rewrite history.
All active roles have own-inbox access; ADMIN broadcast permission grants no
cross-inbox access. Content cannot be edited/deleted and readAt cannot be reset.
SQL triggers also protect delivery identity and reject notification truncation.

Notification.appointmentId is a nullable RESTRICT FK with an index and only
allowed for DIRECT messages. The API maps it to a minimal APPOINTMENT target;
the target's own authorization remains mandatory. The existing recipient/readAt/
createdAt index supports unread counts; recipient/createdAt/id supports inbox
ordering. See the API guide for active-recipient exclusions, plain-text rules,
transactional appointment automation and synchronous fan-out limits.

Audit actors have a real staff FK, nullable for system/unknown actors. The typed
entity UUID is deliberately polymorphic and has no FK to every domain table;
future writers must supply the correct entity. `appendAuditEvent` is intended
for the same transaction as the action. Bootstrap already uses this transaction.

Audit metadata is the only JSON column. It allows `source` (`CLI`, `API`,
`SYSTEM`) and optional `changedFields` containing only `role`, `status`,
`demographics`, `schedule`, `clinicalRecord`, `readAt`. Step 7 additionally permits
paired `audience` (ALL or ROLE) and `recipientCount` (integer 1–10000). Broadcasts
record one NOTIFICATION_BROADCAST_CREATED event; automated notices rely on their
appointment audit. Inbox reads/read-state changes create no per-read audits.
Both the utility and database reject other keys/values. It contains classifications, never field
values, request bodies, credentials or clinical text. Optional IP/user-agent
columns are sensitive operational data and are not populated by bootstrap.

Database triggers reject audit UPDATE, DELETE and TRUNCATE. A partial unique
index permits only one `ADMIN_BOOTSTRAPPED` event. The database owner/superuser
can bypass such controls; this is not tamper-proof external audit storage.
Use restricted runtime database privileges and separate migration credentials
in deployment. Those accounts and grants are not provisioned by this step.

## First administrator and password storage

`npm run bootstrap:admin` is an explicit CLI, never a startup hook or public API.
After migrations, supply these environment variables through a protected
terminal or secret-injection mechanism:

```text
DATABASE_URL
BOOTSTRAP_ADMIN_FIRST_NAME
BOOTSTRAP_ADMIN_LAST_NAME
BOOTSTRAP_ADMIN_EMAIL
BOOTSTRAP_ADMIN_STAFF_NUMBER
BOOTSTRAP_ADMIN_PASSWORD
```

No credentials are supplied by default. Do not put the password in command-line
arguments or shell history. Environment variables still require operating-system
access controls; clear the bootstrap variables after use. A compiled deployment
can run `node server/dist/cli/bootstrapAdmin.js` after building, without tsx.

Validation normalizes identity fields and permits 15-128 Unicode code-point
passphrases, without trimming passwords or imposing arbitrary symbol rules.
Blank/NUL passwords are rejected. The reusable utility uses maintained `argon2`
with Argon2id, random salt, 64 MiB memory, three iterations, parallelism one,
and a 32-byte hash. See [OWASP's password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
No password, hash, email, or raw database error is printed by the CLI.

Hashing happens before the transaction. A transaction-scoped PostgreSQL advisory
lock serializes concurrent bootstrap invocations. Under READ COMMITTED, a waiting
invocation sees committed identities before checking duplicate email/staff number,
existing administrators, and the immutable bootstrap audit marker. It creates
one active ADMIN plus its self-attributed audit event atomically. Duplicate or
repeat provisioning exits nonzero; it never updates/promotes an existing user.
Disabled/demoted administrators do not reopen bootstrap. Recovery is a separate
future administrative workflow.

CLI failure codes are `INVALID_CONFIGURATION`, `INVALID_ADMIN_INPUT`,
`DUPLICATE_EMAIL`, `DUPLICATE_STAFF_NUMBER`, `DUPLICATE_IDENTITY`,
`ADMIN_ALREADY_EXISTS`, and `BOOTSTRAP_FAILED`. Investigate configuration or
database availability privately; raw SQL/errors and submitted values are omitted.

There is no development data seed and no fake medical data in application startup.
Only disposable tests create clearly labelled synthetic data.

## Migrations and tests

Migrations: `20261002090000_initial_hospital_domain` (tables, enums, keys/indexes)
and `20261002090100_domain_integrity` (checks, timestamp/audit triggers, bootstrap
uniqueness), followed by `20261002120000_staff_auth_sessions` (sessions and audit
enum extensions), and `20261003120000_patient_audit_actions` (archive/reactivate
audit values), `20261003150000_appointment_scheduling_integrity` (btree_gist,
overlap exclusions and appointment audit actions), and
`20261004140000_clinical_encounter_integrity` (amendments, immutable clinical
history and clinical audit actions), and `20261009120000_notification_workflow`
(notification delivery/audience/resource integrity and broadcast audit metadata).
Apply with `npm run prisma:migrate:deploy`. Develop new migrations
with `npm run prisma:migrate -- --name descriptive_name`, review SQL, then run
generation, validation and tests. Do not use `db push` for schema management.
In PowerShell quote the argument separator if needed: `npm run prisma:migrate
'--' '--name' 'descriptive_name'`.

`npm run test` needs no database. `npm run test:database` requires explicit
`NODE_ENV=test` and `TEST_DATABASE_URL`. The URL must point to a loopback control
database named `medicare_test_*`, with no URL options; the role needs CREATEDB.
The runner never falls back to normal `DATABASE_URL`, resets the control database,
or drops a database named by user configuration. It creates a random
`medicare_test_run_<32 hex>` database per test file, validates the schema, deploys all migrations
twice to verify repeatability, runs tests, and drops only that generated database
in cleanup. Direct execution of database test files also requires the generated
name. Interrupted processes may require operator cleanup of their test database.

Tests cover constraints, relationships, archival/deactivation, audit immutability,
timestamp behavior, unique references under concurrent inserts, bootstrap input,
duplicate identities, concurrent CLI runs, exactly-one admin/audit, secret-free
output, password hashing/verification and transaction rollback. Existing health
and startup/shutdown tests remain in the suite. No production fixtures are used.

## Frontend mismatches and deferred integration

| Existing UI | Future integration requirement |
| --- | --- |
| Display role labels and user-selected login role | Map labels to `StaffRole`; server-controlled authorization later |
| Age strings such as `28 yrs` | Capture optional DOB and derive age; never infer DOB from a rounded mock age |
| Patient `Active`/`Pending` with a complaint | Visit/queue state and encounter complaints, separate from patient archival |
| Room and medical-history summary on patient form | Persist on that encounter; not permanent patient demographics |
| Free-text received-by/personnel/clinician names | Resolve staff UUIDs; clarify the ambiguous personnel field before integration |
| Appointment date/time without end or zone | Require duration/end and explicit facility/user timezone conversion |
| One diagnosis string and `Reviewed`/`Pending` labels | Multiple encounter diagnoses; explicit DRAFT/REVIEWED lifecycle, with Pending meaning clarified |
| No clinical detail/editor or amendment UI | Separate doctor-only drafting/finalization and visible append-only corrections |
| Broadcast audience label, local read/display state | Persist shared message and recipient delivery/read records |
| Numeric mock IDs and short PT/MR numbers | Use the independent business references and UUID relationships |

Sex/gender, address, emergency contact, patient email and blood group are not
currently collected; their exact semantics and collection requirements are
deferred rather than guessed. Prescriptions and pharmacy tables are also deferred.
Frontend source, forms, mock data, login behavior and API wiring are unchanged.

Patient identity/contact data, clinical notes, diagnoses, notification text,
password hashes, and operational audit identifiers are sensitive. Clinical authorization is enforced in the API. Narrower treatment-relationship
access, retention, backup policies, encryption at rest and compliance review
remain implementation and operational decisions. PostgreSQL alone does not
provide encryption-at-rest or regulatory certification. Never put clinical content
in logs, business identifiers, URLs or audit metadata.

## Step 8 aggregate reporting

Reporting reuses these models and their existing indexes; it creates no reporting
tables or materialized views. Migration `20261010120000_reporting_query_support`
adds `CLINICAL_REPORT_VIEWED` to AuditAction. A personal clinical report access
event references the requesting STAFF_USER, with only `source: API` metadata.
Dashboard and operational aggregate reads are not individually audited.

Patient registrations use createdAt; appointment activity uses scheduledStart;
clinical author activity uses occurredAt, reviewedAt and amendment createdAt.
Current snapshots are explicitly separate from period metrics. Reviewed timestamps
retain their existing finalization meaning. See [dashboard/report contracts](dashboard-reports-api.md)
for UTC range boundaries, doctor scoping, query/index review and privacy limits.
This reporting step does not alter frontend code; concurrent integration work is
separate from the historical UI observations above.
