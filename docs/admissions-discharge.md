# Admissions and discharge

Medicare records hospital stays. A patient is a permanent identity; each time they are admitted
they get a new admission (a stay) with its own number, room history and clinical records, and the
stay ends with a discharge. Discharge closes the stay only: the patient record, the stay and every
clinical record stay available.

```text
Patient (permanent identity)
  └─ Admission AD-000001  (ADMITTED → DISCHARGED, one way)
       ├─ Room history     (append-only: Room 4 → Ward A – Bed 6)
       ├─ Clinical records (drafts, finalized records, amendments)
       │    ├─ Diagnoses
       │    └─ Medication orders
       └─ Discharge        (time, staff, discharge note)
  └─ Admission AD-000014  (a later re-admission is a new stay)
```

Appointments are no longer part of the product. See [Appointments retired](#appointments-retired).

## Roles

| Action | Admin | Records Officer | Medical Officer |
| --- | --- | --- | --- |
| Register a patient, "Register & admit" | Yes | Yes | Yes |
| Admit or re-admit | Yes | Yes | Yes |
| Change room | Yes | Yes | Yes |
| Discharge | No | No | Yes |
| View stays and room history | Yes | Yes | Yes |
| Read the discharge note | No | No | Yes |
| Clinical records, diagnoses, medications | No | No | Yes |
| Manage the medication catalog ([Phase 19B](medication-catalog-prescribing.md)) | Yes | No | No |
| Edit or archive demographics | Yes | Yes | No |

"Medical Officer" is the display name of the stored role code `DOCTOR_IN_CHARGE`; the code is
unchanged so existing accounts, sessions and audit history keep working. The permissions are
`ADMISSION_READ`, `ADMISSION_CREATE`, `ADMISSION_UPDATE` (room changes) and `ADMISSION_DISCHARGE`
(Medical Officer only) in `server/src/shared/authorization/permissions.ts`.

Navigation by role:

- Medical Officer: Overview, Patients, Medical Records, Notifications.
- Records Officer: Overview, Patients, Notifications, Reports.
- Admin: Overview, Patients, Staff & Access, Notifications, Reports.

## Rules

- **One current stay.** A patient has at most one `ADMITTED` admission. A second admission is
  refused with `409 PATIENT_ALREADY_ADMITTED` ("This patient is already admitted."); the admit
  dialog then offers **Open current admission**.
- **No overlap.** A re-admission cannot start before the previous discharge
  (`409 ADMISSION_OVERLAPS_PREVIOUS`). Admission time defaults to now and may be back-dated, but
  not set more than a minute in the future (`400 INVALID_ADMISSION_TIME`).
- **Archived patients** must be reactivated before admission (`409 PATIENT_ARCHIVED`), and a
  patient who is currently admitted cannot be archived (`409 PATIENT_CURRENTLY_ADMITTED`).
- **Rooms** are short free-text labels ("Room 4", "Ward A – Bed 6"), 1–100 printable characters;
  no ward structure is imposed. A room change closes the open room entry and opens a new one with
  an optional transfer note (up to 500 characters). Changing to the same room is refused
  (`409 ROOM_UNCHANGED`); a discharged stay cannot change room (`409 ADMISSION_DISCHARGED`).
- **Clinical records belong to a current stay.** A new clinical record must name an `ADMITTED`
  admission (`409 ADMISSION_NOT_CURRENT` otherwise) and starts in the stay's current room. Records
  created before this release have no admission; they remain readable, existing drafts can still
  be completed, and finalized ones can still be amended. There are no new walk-in records.
- **Discharge is blocked by drafts.** While any clinical record on the stay is a draft, discharge
  is refused with `409 ADMISSION_HAS_DRAFT_RECORDS` ("This admission has an unfinished clinical
  record."). Nothing is discarded; finalize the draft and discharge again.
- **Discharge is atomic and one way.** One transaction sets the status, discharge time, the staff
  member and the optional discharge note (up to 5,000 characters), and closes the open room at the
  discharge time. The discharge time defaults to now; it must follow the admission and the latest
  room change and cannot be in the future (`400 INVALID_DISCHARGE_TIME`). A second discharge is
  refused (`409 ADMISSION_ALREADY_DISCHARGED`).
- **Nothing is deleted.** Discharge never archives the patient or removes a record. A discharged
  stay is read-only; clinical corrections are added as amendments. Re-admission creates a new stay.

## API

All routes are under `/api/v1/admissions`, require a session, send `Cache-Control: no-store`, and
require the CSRF header on writes. Responses use the usual `{ success, data }` envelope.

| Method and path | Permission | Purpose |
| --- | --- | --- |
| `POST /` | `ADMISSION_CREATE` | Admit or re-admit. Body `{ patientId, roomNumber, admittedAt? }`. Accepts `Idempotency-Key`. `201` |
| `GET /` | `ADMISSION_READ` | List stays. Query `page`, `limit`, `status` (`ADMITTED`/`DISCHARGED`), `patientId`, `search` |
| `GET /:id` | `ADMISSION_READ` | One stay with its room history. Audited as `ADMISSION_VIEWED` |
| `POST /:id/room` | `ADMISSION_UPDATE` | Change room. Body `{ roomNumber, note? }` |
| `POST /:id/discharge` | `ADMISSION_DISCHARGE` | Discharge. Body `{ dischargedAt?, dischargeNotes? }` |

`search` matches the admission number, room, patient number and patient names (since Phase 19C,
several words match when each word is found in one of them, as for patient search). Current stays are
listed newest admission first; discharged stays newest discharge first.

A stay summary contains `id`, `admissionNumber`, `status`, `roomNumber`, `admittedAt`,
`dischargedAt`, the patient's identity (number and names) and `admittedBy` / `dischargedBy` (staff
number and names). The detail adds `createdAt`, `updatedAt` and `rooms` (each with `roomNumber`,
`note`, `assignedAt`, `endedAt`, `assignedBy`). **`dischargeNotes` is included only for clinical
readers**; for Admin and Records Officer the field is absent, not empty.

Patient responses include `currentAdmission` (`{ id, admissionNumber, roomNumber, admittedAt }`
or `null`). Clinical records carry `admission { id, admissionNumber }` and their `medications`.

### Medication orders

Medication orders are structured rows on a clinical record, handled like diagnoses: they are sent
as a `medications` array (up to 30) when a record is created or a draft is edited, are replaced as a
set while the record is a draft, and are locked when it is finalized. Since Phase 19B each new order
names a medicine from the [medication catalog](medication-catalog-prescribing.md) and adds a
strength; the history separates the current admission from previous ones. As first built, each order has `medicine`
(required, up to 200 characters) and optional `dose` (100), `route` (50), `frequency` (100),
`duration` (100) and `notes` (2,000).

`GET /api/v1/patients/:patientId/medications?page&limit` (`CLINICAL_RECORD_READ`) returns the
patient's orders across all stays, newest record first, each with its record's reference, status,
time, clinician and admission. Opening it is audited as `MEDICAL_HISTORY_VIEWED` with
`changedFields: ["medications"]`.

### Retries

Admission accepts an `Idempotency-Key` ([idempotency](idempotency.md)): resending the same request
returns the original stay instead of admitting twice. Room changes and discharges are safe to
resend because a repeat is refused (`ROOM_UNCHANGED`, `ADMISSION_ALREADY_DISCHARGED`). When the
browser cannot confirm an outcome, the dialogs say so and ask staff to check the patient record
before trying again.

## Database guarantees

The rules hold even for writes that bypass the API. Migrations
`20261111090000_admission_enums` and `20261111090100_admissions_discharge_medications` add:

- `Admission` with `admissionNumber` drawn from `next_admission_number()` (sequence
  `admission_number_seq`, `AD-` plus at least six digits); `AdmissionRoomHistory`;
  `MedicationOrder`; and `Encounter.admissionId`, with a composite foreign key so a record's
  admission always belongs to the same patient.
- A partial unique index (`admission_one_current_per_patient`) for one current stay per patient,
  and a GiST exclusion constraint (`admission_patient_no_overlap`) so a patient's stays never
  overlap in time.
- Checks that a discharged stay has its time and staff, that discharge follows admission, and that
  rooms are trimmed and notes bounded.
- Triggers that make stays permanent (no delete or truncate; status only `ADMITTED → DISCHARGED`;
  identity and admission time immutable), refuse discharge while drafts exist, keep room history
  append-only (only closing the open entry is allowed), refuse room entries on a discharged stay,
  refuse archiving an admitted patient, allow new clinical records only on a current stay and never
  move a record to another stay, and allow medication changes only on drafts.
- Deferred constraint triggers that check, at commit, that a current stay has exactly one open
  room entry matching its room and a discharged stay has none.

Concurrency: admission locks the patient row, room change and discharge lock the stay row, and
record creation takes a shared lock on the stay, so a discharge cannot slip between a record's
admission check and its insert. Admission, room and clinical writes take the shared patient-write
advisory lock; demographic edits and archiving take it exclusively.

## Audit and privacy

| Event | Action |
| --- | --- |
| First admission | `PATIENT_ADMITTED` |
| Any later admission | `PATIENT_READMITTED` |
| Room change | `ADMISSION_ROOM_CHANGED` |
| Discharge | `PATIENT_DISCHARGED` |
| Opening a stay | `ADMISSION_VIEWED` |
| Medication orders written | `MEDICAL_RECORD_CREATED` / `MEDICAL_RECORD_UPDATED` with `changedFields` including `medications` |

Each event has entity type `ADMISSION` (or the clinical record) and metadata `{ "source": "API" }`
only. Room names, transfer notes, discharge notes and medicines are never written to audit
metadata or to the API log; the logger redacts those fields. The audit row is written in the same
transaction as the change, so a failed audit rolls the change back.

There are no automatic notifications for admissions, room changes or discharges.

## Screens

- **Patients** has three views: **All patients**, **Currently admitted** and **Discharged**.
  Every role can **Register patient**. The registration form asks for names and date of birth (the
  phone number is no longer collected), and **Register & admit** continues straight into the
  admission form.
- **Patient record** shows the identity, then either the current admission (room, admitted time
  and staff, with **Open medical record**, **Change room** and **Discharge patient** as the role
  allows) or "Not currently admitted" with **Admit patient**, then **Previous admissions** with
  **View record**.
- **Admission record** is the read-only view of a stay: room history, staff and times; for the
  Medical Officer also the discharge note, the stay's clinical records and its medication orders.
- **Medical Records** (Medical Officer) opens on the currently admitted patients. A patient's
  medical record is scoped to their admission, with **New clinical record**, the record list,
  medication orders and **Discharge patient**.
- **Discharge** asks for confirmation: "Discharging this patient will close the current admission.
  Their medical history will remain available." If a draft exists the dialog explains why and
  offers to open the medical record.

## Dashboards and reports

The Overview shows current admissions and, for the selected period, admissions and discharges.
The Medical Officer's Overview adds their own drafts and clinical activity; Admin and Records
Officer add patient counts and registrations; Admin also sees active staff.

Reports (Admin and Records Officer) has **Patient registrations** and **Admissions and
discharges** (`GET /api/v1/reports/admissions`): the live count of current admissions, admissions
by admission time and discharges by discharge time for the period, charted together. See
[dashboard and reports API](dashboard-reports-api.md).

## Appointments retired

Appointments have been removed from the screens, navigation, dashboards, reports, notifications
and API (`/api/v1/appointments` now returns `404`). The `Appointment` table and its rows are kept
as read-only history: the runtime role has `SELECT` only. Clinical records that were linked to an
appointment keep that link, and the record still shows the appointment reference. Past appointment notifications stay in inboxes, labelled "Past
appointment", and no longer open anything. [appointment-api.md](appointment-api.md) and
[frontend-appointment-integration.md](frontend-appointment-integration.md) describe the retired
feature for reference only.

## Deploying

1. Back up the database.
2. Run `npm run prisma:migrate:deploy` from the repository root (two new migrations).
3. Re-run `server/ops/runtime-grants.sql` as the migration owner. It now grants `INSERT, SELECT,
   UPDATE` on `Admission` and `AdmissionRoomHistory`, `INSERT, SELECT, DELETE` on
   `MedicationOrder`, `USAGE` on `admission_number_seq`, and reduces `Appointment` to `SELECT`.
4. Run `server/ops/restore-check.sql` and check the new tables and the sequence position appear.

See [release operations](release-operations.md).

## Known limits

- The duplicate-patient warning at registration only compares patients with a phone number, so it
  rarely fires now that phone is not collected.
- There is no ward, bed or capacity model; a room is a label.
- There is no "patients under my care" assignment: every Medical Officer sees every current stay.
- A discharge cannot be undone; a patient discharged by mistake is re-admitted as a new stay.
