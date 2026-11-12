# Medication catalog and prescribing

Medical Officers prescribe by choosing medicines from a controlled list, the **medication
catalog**, instead of typing names. Prescribing is part of a clinical record on a patient's
current **admission**; it never depends on appointments, which are retired (see
[admissions and discharge](admissions-discharge.md)).

```text
Patient → Admission (ADMITTED) → Clinical record (draft) → Medication orders → Finalize → Medication history
                                                              ↑
                                         Medication catalog (Admin keeps the list)
```

## Medical Officer workflow

1. **Patients → Currently admitted**, open the patient, then **Open medical record**, or use
   **Medical Records**, which lists the patients currently admitted.
2. **New clinical record** (or **Edit draft** on an existing draft).
3. In **Medications**, select **Add medication**.
4. **Medicine:** type part of the name and choose it from the list (arrow keys and Enter, or tap).
   Typing alone never prescribes; only a medicine chosen from the list is accepted.
5. Enter **Strength** (optional, e.g. 500 mg), **Dose** (e.g. 1 tablet), **Route**, **Frequency**,
   **Duration** (optional, e.g. 5 days) and **Instructions** (optional), then **Add to record**.
6. Repeat for other medicines. Each order shows as a card with **Edit** and **Remove**.
7. **Save draft**. Orders can still be changed until the record is finalized.
8. **Finalize record**. The orders become permanent; corrections are added as amendments.
9. The medical record shows **Medication history**: this admission's orders first, then
   **Previous admissions**. History stays after discharge and is read-only.

## The previous system's medication workflow

The previous Medicare front end (repository `medicare-clean`, commits `d2f8851`
"Add patient medication details" and `3520b5b` "Add medication catalog") had:

- an **Assign medication** form on the patient page with a **Medication name** dropdown filled
  from a 16-item drug list;
- **Strength** (e.g. 500 mg), **Dose** (e.g. 1 tablet), **Route** (Oral, Injection, Topical,
  Inhaled, Other), **Frequency** (free text), **Duration** (e.g. 5 days), all required, and
  optional **Instructions**;
- an **Assigned medications** list per patient showing medicine, strength, time, dose, route,
  frequency, duration, instructions and who assigned it;
- **Add a drug** / **Remove selected** controls that any signed-in user could use to change the list;
- everything stored in the browser's local storage, with no server, roles, history or audit.

### Parity

| Old feature | Now |
| --- | --- |
| Drug dropdown instead of typing | **Restored**, as a searchable list (type to filter, keyboard and touch) |
| The 16 drugs of the old list | **Restored** as the initial catalog (see below) |
| Strength, dose, route, frequency, duration, instructions | **Restored**; dose, route and frequency required, strength and duration optional |
| Route choices | **Restored**, with "Injection" split into IV, IM and SC; "Other" lets the Medical Officer type a route |
| Assigned medications list | **Restored** as medication history, grouped by admission and clinical record |
| "Assigned by" | **Restored**: each record shows the prescribing Medical Officer |
| Add a drug to the list | **Restored for administrators** in **Medication Catalog** |
| Remove a drug from the list | **Replaced** by deactivate and reactivate: a medicine that was ever prescribed is never deleted |
| Anyone can change the list | **Not restored**: only administrators manage the catalog |
| Local storage | **Not restored**: everything is on the server; nothing is stored in the browser |
| Orders assigned to the patient directly | **Changed**: orders belong to a clinical record on an admission |

New in this system: catalog names are unique ignoring capitals, orders keep the medicine name as
prescribed, drafts can be edited and orders removed before finalization, finalized orders are
permanent (database-enforced), current and previous admissions are separated, the same medicine
twice on one record triggers a warning, and every catalog change is audited.

## Initial catalog

The migration seeds the old list with readable capitalisation. Two spellings were standardised
so that searching by the usual name finds them. Both are easy to reverse before release if the
hospital prefers the old wording (deactivate the entry and add the preferred name).

| Old list | Catalog name | Change |
| --- | --- | --- |
| Antacid (Aluminium hydroxide tab) | Antacid (Aluminium hydroxide tab) | none |
| LIVER SALT | Liver salt | capitalisation |
| LOPERAMIDE | Loperamide | capitalisation |
| ORS | ORS | none |
| DICLOFENAC | Diclofenac | capitalisation |
| IBUPROFEN | Ibuprofen | capitalisation |
| PARACETAMOL | Paracetamol | capitalisation |
| FOLIC ACID | Folic acid | capitalisation |
| CITIRIZINE | Cetirizine | spelling corrected to the standard name |
| HYOSCINE BUTYL BROMIDE (BUSCOLEX) | Hyoscine butylbromide (Buscolex) | standard spelling of butylbromide; brand kept |
| VITAMIN C TAB | Vitamin C tab | capitalisation |
| MULTIVITAMIN | Multivitamin | capitalisation |
| SALBUTAMOL TAB | Salbutamol tab | capitalisation |
| SALBUTAMOL INHALER | Salbutamol inhaler | capitalisation |
| ORAL GLUCOSE | Oral glucose | capitalisation |
| MEBENDAZOLE (DE WORMER) | Mebendazole (dewormer) | capitalisation and spelling |

Seeding is part of migration `20261111120100_medication_catalog` (`INSERT … ON CONFLICT DO
NOTHING` on the case-insensitive name index), so it runs once with the migration and can never
create duplicates; the application never seeds at start-up.

## Data model

**`Medication`**: `id`, `name` (1–200 characters), `active`, `createdAt`, `updatedAt`. No
strength, category, stock, price, supplier or inventory fields; this is not a pharmacy system.

- **Unique ignoring capitals.** A unique index on `lower(name)` makes "Paracetamol",
  "paracetamol" and "PARACETAMOL" one medicine. The API also checks first so it can return a clear
  `409 MEDICATION_ALREADY_EXISTS`; the index is the final guard against concurrent adds. Names are
  stored trimmed with single spaces (a check constraint refuses anything else). With a `C`
  database collation, `lower()` folds ASCII letters only; the seeded and expected names are ASCII.
- **Permanent.** A trigger refuses any change to a medicine's name. Entries are deactivated, not
  deleted: the runtime role has no `DELETE` on the table, and a foreign key refuses deleting any
  medicine that was ever prescribed.

**`MedicationOrder`** (from Phase 19A) gains `medicationId` (foreign key to the catalog) and
`strength`. Existing fields are kept: `medicine`, `dose`, `route`, `frequency`, `duration`,
`notes` (instructions), `createdAt`, and the parent clinical record `encounterId`.

- **Historical names.** `medicine` is the catalog name **copied when the order is written**, a
  snapshot. A trigger requires every new order to name a catalog entry and checks that `medicine`
  equals that entry's name. History therefore always reads as prescribed, even after the medicine
  is deactivated, and catalog names are additionally permanent. Both safeguards were chosen
  because renaming is not offered; a future rename feature could rely on the snapshot alone.
- **Prescriber and date.** The prescriber is the clinical record's author (only the author can
  edit a draft), so no separate column is kept. History shows the record's clinical time as the
  prescribed time and its finalization status.
- **Orders from before the catalog** (written during Phase 19A testing) keep `medicationId = null`
  and their typed name. They stay readable; on a draft they must be re-chosen from the list or
  removed before that draft's medications can be saved.

## Rules

| Rule | Enforced by |
| --- | --- |
| A new order names an active catalog medicine | API (`MEDICATION_NOT_FOUND` 404, `MEDICATION_INACTIVE` 409) and trigger (catalog entry required, name must match) |
| A medicine already on a draft may stay after it is deactivated | API (only newly added orders must be active) |
| Dose, route and frequency are required; strength, duration and instructions optional | API validation |
| Orders change only while the record is a draft | API and the `medication_draft_only` trigger (insert, update and delete refused once finalized) |
| Finalized orders are permanent; corrections are amendments | Trigger and API (`ENCOUNTER_FINALIZED`) |
| Discharge does not change or hide orders | Admission rules; history stays readable |
| Only the record's author edits its orders | API (`ENCOUNTER_AUTHOR_REQUIRED`) |

Orders on a draft are saved as a set: the editor sends the whole list when it changed, and the
server replaces the draft's orders in one transaction under the record's lock. The same medicine
may appear twice (for example, a regular dose and an as-needed dose); the editor warns
"… is already ordered on this record. Add it again only for a separate dosing plan." and marks
both orders, but does not merge or block them.

Routes offered: Oral, Intravenous (IV), Intramuscular (IM), Subcutaneous (SC), Topical, Inhaled,
and Other (typed). Frequencies offered: Once daily, Twice daily, Three times daily, Four times
daily, As needed, Stat, and Other (typed). The old system's frequency was free text, so "Other"
keeps that possible.

## Permissions

| | Admin | Records Officer | Medical Officer |
| --- | --- | --- | --- |
| Read the catalog (`MEDICATION_CATALOG_READ`) | Yes | No | Yes |
| Add, deactivate, reactivate (`MEDICATION_CATALOG_MANAGE`) | Yes | No | No |
| Prescribe (`CLINICAL_RECORD_CREATE`) | No | No | Yes |
| Read prescriptions and medication history (`CLINICAL_RECORD_READ`) | No | No | Yes |

Managing the catalog gives no access to prescriptions: catalog responses contain names and
status only.

## API

| Method and path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/medications` | `MEDICATION_CATALOG_READ` | List: `status` (`active` default, `inactive`, `all`), `search` (case-insensitive part of the name), `page`, `limit` ≤ 100; sorted by name ignoring capitals |
| `GET /api/v1/medications/options` | `MEDICATION_CATALOG_READ` | Every active medicine (`id`, `name`), for the prescribing list; at most 1,000 |
| `POST /api/v1/medications` | `MEDICATION_CATALOG_MANAGE` | Add `{ name }`. `201`; `409 MEDICATION_ALREADY_EXISTS` for any existing name in any capitals, active or not |
| `POST /api/v1/medications/:id/deactivate` | `MEDICATION_CATALOG_MANAGE` | Hide from new prescriptions. Repeating changes nothing |
| `POST /api/v1/medications/:id/reactivate` | `MEDICATION_CATALOG_MANAGE` | Offer again |

All routes require a session and send `Cache-Control: no-store`; changes require the CSRF token.
There is no rename or delete route. Catalog additions take no `Idempotency-Key`: a resent add is
refused as a duplicate, so it never creates two entries.

A medication order in `POST /api/v1/encounters` or a draft `PATCH`:

```json
{ "medicationId": "…catalog id…", "strength": "500 mg", "dose": "1 tablet", "route": "Oral",
  "frequency": "Three times daily", "duration": "5 days", "notes": "After meals" }
```

`medicine` cannot be sent; the server copies the catalog name. Responses add `medicationId` and
`strength` to each order.

`GET /api/v1/patients/:patientId/medications` (Medical Officer) accepts `admissionId` (one
admission's orders) or `excludeAdmissionId` (every other order, including records from before
admissions existed), not both. Each item includes its record's reference, status, clinical
time, finalization time, author, and admission number, status and dates.

## Screens

- **Clinical record editor → Medications:** order cards with **Edit** and **Remove** (accessible
  names include the medicine and order number), and an inline order form with the searchable
  **Medicine** list, the dosing fields, **Add to record** / **Update medication** and **Cancel**.
  While an order form is open, **Save draft** asks to finish or cancel it first. The medicine
  list loads once when the editor opens and is filtered in the browser as you type; nothing is
  stored in the browser.
- **Record detail:** medications show medicine and strength, then dose, route, frequency,
  duration and instructions; a finalized record says "Locked when the record was finalized.
  Corrections are added as amendments."
- **Medication history:** in a medical record, **Current admission · AD-…** first, then
  **Previous admissions** grouped by admission ("Admission AD-… · admitted …, discharged …") and
  by clinical record ("Prescribed … by … · Finalized · MR-…"). A past stay's record view shows
  only that stay. Records from before admissions are grouped as "Recorded before admissions".
- **Medication Catalog (Admin menu):** add a medicine, search, show Active / Inactive / All,
  **Deactivate** (with a confirmation that explains past prescriptions are unchanged) and
  **Reactivate**. Status is shown in words with an icon, not by colour alone.

The list is an ARIA combobox: labelled "Medicine", arrow keys move through matches, Enter
chooses, Escape closes, a polite status announces the number of matches and the chosen medicine,
and "No medicines match …" explains what to do. Options are at least 44 px tall and the list
stays within the screen at 320 px. All colours are theme tokens, so Light, Dark and System work
unchanged; orange stays the brand colour and is not used for medication status.

## Audit, privacy and logging

| Event | Audit action | Metadata |
| --- | --- | --- |
| Medicine added | `MEDICATION_CREATED` (entity `MEDICATION`) | `{ "source": "API" }` |
| Medicine deactivated / reactivated | `MEDICATION_DEACTIVATED` / `MEDICATION_REACTIVATED` | `{ "source": "API" }` |
| Orders written on a record | `MEDICAL_RECORD_CREATED` / `MEDICAL_RECORD_UPDATED` | `changedFields` includes `"medications"` |
| Medication history opened | `MEDICAL_HISTORY_VIEWED` | `changedFields: ["medications"]` |

Dose, strength, frequency, duration, instructions and medicine names never appear in audit
metadata. Request logs carry no bodies, and the logger additionally redacts `medications`,
`medicine`, `dose`, `strength`, `frequency`, `duration`, `instructions` and `notes`.

## Deploying

1. Back up, then `npm run prisma:migrate:deploy` (two migrations: `20261111120000_medication_catalog_enums`
   and `20261111120100_medication_catalog`). A second run reports nothing pending.
2. Re-run `server/ops/runtime-grants.sql`: it adds `SELECT, INSERT, UPDATE` on `Medication` (no `DELETE`).
3. `server/ops/restore-check.sql` now includes the `Medication` table.
4. Ask an administrator to review the initial catalog and add the hospital's other medicines
   before Medical Officers start prescribing.

## Known limits

- A medicine missing from the catalog cannot be prescribed until an administrator adds it;
  there is no "unlisted medicine" entry. Medical Officers can note it in the treatment plan meanwhile.
- No dosing checks, interactions, allergies, dispensing, administration records, stock or prices.
- Medicine names cannot be renamed; a wrong name is deactivated and the right one added.
- Catalog sorting and case-insensitive matching follow PostgreSQL `lower()`; with a `C`
  collation non-ASCII capitals are not folded.
