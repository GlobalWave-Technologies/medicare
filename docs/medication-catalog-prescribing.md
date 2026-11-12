# Medication catalog and prescribing

Medical Officers prescribe by choosing medicines from a controlled list, the **medication
catalog**, instead of typing names. Prescribing is part of a clinical record on a patient's
current **admission**; it never depends on appointments, which are retired (see
[admissions and discharge](admissions-discharge.md)).

```text
Patient → Admission (ADMITTED) → Clinical record (draft) → Medication orders → Finalize → Medication history
                                                              ↑
                    Medication catalog (Admin keeps the list; Medical Officers can add a missing medicine)
```

## Medical Officer workflow

1. **Patients → Currently admitted**, open the patient, then **Open medical record**, or use
   **Medical Records**, which lists the patients currently admitted.
2. **New clinical record** (or **Edit draft** on an existing draft).
3. In **Medications**, select **Add medication**.
4. **Medicine:** type part of the name and choose it from the list (arrow keys and Enter, or tap).
   Typing alone never prescribes; only a medicine chosen from the list is accepted.
   If the medicine is not in the list, select **Add “…” to catalog** below the field, check the
   name and select **Save medication**: it is added and chosen for the order (see
   [Adding a missing medicine](#adding-a-missing-medicine-while-prescribing)).
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
| Add a drug to the list | **Restored** for administrators in **Medication Catalog**, and for Medical Officers while prescribing (Phase 19F) |
| Remove a drug from the list | **Replaced** by deactivate and reactivate: a medicine that was ever prescribed is never deleted |
| Anyone can change the list | **Not restored**: Medical Officers can only add; only administrators deactivate and reactivate |
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
  `409 MEDICATION_ALREADY_EXISTS` (or `409 MEDICATION_EXISTS_INACTIVE` when the existing entry is
  inactive; adding never reactivates it); the index is the final guard against concurrent adds. Names are
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

## Adding a missing medicine while prescribing

Since Phase 19F a Medical Officer does not need an administrator to add a missing medicine. If
the medicine is not available, a Medical Officer may add it to the catalog during prescribing.
Administrators retain control over deactivation and reactivation.

1. In the order form, type the medicine's name in **Medicine**. When nothing matches, the field
   says "No medicines match “…”. Check the spelling, or add it to the catalog." with the action
   **Add “…” to catalog**. It is brought into view above the record's pinned Cancel / Save draft
   bar, and stays below the field after the list closes, so it can be reached with Tab.
2. The **Add medication to catalog** dialog opens over the record, with **Medication name**
   filled in from the search. Check the spelling and capitals (names cannot be changed later;
   strength, dose and directions belong on the order), then select **Save medication**.
3. The medicine is added, chosen for the order ("… was added to the catalog and chosen for this
   order."), and focus moves to **Strength**. It is in the list for the next order and for every
   Medical Officer straight away.
4. Continue with dose, route, frequency, duration and instructions, then **Add to record**.

The dialog opens on top of the clinical record and outside its form: complaints, notes,
diagnoses, the treatment plan and orders already added are untouched, nothing is submitted with
it, and **Cancel** or Escape closes only the dialog, returning focus to where it was. Only the
name is sent.

| Situation | What the Medical Officer sees |
| --- | --- |
| Name already in the catalog, active (any capitals or spacing) | "This medication already exists in the catalog." and **Use …** to choose the existing entry |
| Name in the catalog but inactive | "This medication already exists but is inactive. Contact an Administrator to reactivate it." Nothing is reactivated |
| Empty or too long a name | "Enter the medicine name." / "Use up to 200 characters." on the field |
| Permission refused | "Your account cannot add medicines to the catalog. Contact an Administrator." |
| Network or server failure | The usual connection or server message, plus "Trying again is safe; a medicine is never added twice." |

No raw database or server error text is shown. The catalog stays a prescribing list: no strength,
category, stock, quantity, price, supplier, inventory or dispensing fields were added.

## Permissions

| | Admin | Records Officer | Medical Officer |
| --- | --- | --- | --- |
| Read the catalog (`MEDICATION_CATALOG_READ`) | Yes | No | Yes |
| Add a medicine (`MEDICATION_CATALOG_ADD`) | Yes (Medication Catalog) | No | Yes (while prescribing, Phase 19F) |
| Deactivate, reactivate; the Medication Catalog page (`MEDICATION_CATALOG_MANAGE`) | Yes | No | No |
| Prescribe (`CLINICAL_RECORD_CREATE`) | No | No | Yes |
| Read prescriptions and medication history (`CLINICAL_RECORD_READ`) | No | No | Yes |

The server enforces each permission on the route and again inside the catalog transaction
against the account's current role; hiding controls in the browser is not relied on. A
temporary-password account is refused (`403 PASSWORD_CHANGE_REQUIRED`) until the password is
changed, as everywhere else. Managing or adding to the catalog gives no access to prescriptions:
catalog responses contain names and status only.

## API

| Method and path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/medications` | `MEDICATION_CATALOG_READ` | List: `status` (`active` default, `inactive`, `all`), `search` (case-insensitive part of the name), `page`, `limit` ≤ 100; sorted by name ignoring capitals |
| `GET /api/v1/medications/options` | `MEDICATION_CATALOG_READ` | Every active medicine (`id`, `name`), for the prescribing list; at most 1,000 |
| `POST /api/v1/medications` | `MEDICATION_CATALOG_ADD` | Add `{ name }` (Admin or Medical Officer). `201`; `409 MEDICATION_ALREADY_EXISTS` for an existing active name in any capitals; `409 MEDICATION_EXISTS_INACTIVE` for an existing inactive one (never reactivated) |
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
- **Add medication to catalog (Medical Officer, from the order form):** a compact dialog with
  **Medication name**, **Cancel** and **Save medication**, as described above. Records Officers
  never see the prescribing form, so they never see this action.
- **Medication Catalog (Admin menu):** add a medicine, search, show Active / Inactive / All,
  **Deactivate** (with a confirmation that explains past prescriptions are unchanged) and
  **Reactivate**. Status is shown in words with an icon, not by colour alone.

The list is an ARIA combobox: labelled "Medicine", arrow keys move through matches, Enter
chooses, Escape closes, a polite status announces the number of matches and the chosen medicine,
and "No medicines match …" explains what to do (with **Add “…” to catalog** for Medical Officers). Options are at least 44 px tall and the list
stays within the screen at 320 px. All colours are theme tokens, so Light, Dark and System work
unchanged; orange stays the brand colour and is not used for medication status.

## Audit, privacy and logging

| Event | Audit action | Metadata |
| --- | --- | --- |
| Medicine added (by an administrator or a Medical Officer) | `MEDICATION_CREATED` (entity `MEDICATION`, actor = who added it) | `{ "source": "API" }` |
| Medicine deactivated / reactivated | `MEDICATION_DEACTIVATED` / `MEDICATION_REACTIVATED` | `{ "source": "API" }` |
| Orders written on a record | `MEDICAL_RECORD_CREATED` / `MEDICAL_RECORD_UPDATED` | `changedFields` includes `"medications"` |
| Medication history opened | `MEDICAL_HISTORY_VIEWED` | `changedFields: ["medications"]` |

Dose, strength, frequency, duration, instructions and medicine names never appear in audit
metadata; nor does any patient or prescription detail when a Medical Officer adds a medicine while
prescribing. Staff Activity shows the addition as "Added a medicine to the catalog", without the name. Request logs carry no bodies, and the logger additionally redacts `medications`,
`medicine`, `dose`, `strength`, `frequency`, `duration`, `instructions` and `notes`.

## Deploying

1. Back up, then `npm run prisma:migrate:deploy` (two migrations: `20261111120000_medication_catalog_enums`
   and `20261111120100_medication_catalog`). A second run reports nothing pending.
2. Re-run `server/ops/runtime-grants.sql`: it adds `SELECT, INSERT, UPDATE` on `Medication` (no `DELETE`).
3. `server/ops/restore-check.sql` now includes the `Medication` table.
4. Ask an administrator to review the initial catalog and add the hospital's other medicines
   before Medical Officers start prescribing (Medical Officers can also add a missing one later).

Phase 19F (Medical Officers adding medicines) has no migration and no grant change: the runtime
role already has `INSERT` on `Medication`. Deploy the server and client together; the new
permission exists only in the server's code.

## Known limits

- A missing medicine is added by name only; there is no "unlisted medicine" entry. A misspelt
  addition cannot be renamed: an administrator deactivates it and the correct name is added.
- Administrators are not notified when a Medical Officer adds a medicine; additions appear in
  the Medication Catalog list and in Staff Activity.
- No dosing checks, interactions, allergies, dispensing, administration records, stock or prices.
- Medicine names cannot be renamed; a wrong name is deactivated and the right one added.
- Catalog sorting and case-insensitive matching follow PostgreSQL `lower()`; with a `C`
  collation non-ASCII capitals are not folded.
