# Dashboard and aggregate reports — Step 8

All routes below require an active staff session, return `Cache-Control: no-store`,
and use `{ success: true, data: ... }`. GET requests do not require CSRF. The
server derives role and identity from the session; clients cannot choose them.
Existing authentication, authorization and safe error envelopes apply.

**Phase 19A** replaced appointment figures with admissions and discharges
([admissions and discharge](admissions-discharge.md)). The appointment report and the separate
personal clinical-activity report were removed; the Medical Officer's own clinical activity now
appears only on their Overview. Sections below describe the current contracts; the historical
appointment report is kept at the end for reference.

**Phase 19C** reshaped the dashboard around a live chart: it now returns today's admissions and
discharges and a daily admissions/discharges series for the chart period (last 7 UTC days by
default, at most 31 days). The Medical Officer's period clinical counts (`period.clinical`), the
administrator's active-staff counts and the period registration count were removed from the
dashboard; registrations remain in the patient report. See
[final UI/UX audit](final-ui-ux-audit.md).

## Permissions and routes

| GET route | ADMIN | RECORDS_OFFICER | DOCTOR_IN_CHARGE |
| --- | --- | --- | --- |
| `/api/v1/dashboard` | Administrative dashboard | Records dashboard | Medical Officer dashboard |
| `/api/v1/reports/patients` | Allowed | Allowed | Forbidden |
| `/api/v1/reports/admissions` | Organization aggregate | Organization aggregate | Forbidden |

Permissions are `DASHBOARD_VIEW_ADMIN`, `DASHBOARD_VIEW_RECORDS`,
`DASHBOARD_VIEW_CLINICAL` and `REPORT_OPERATIONAL_VIEW`. Each role gets only its
corresponding dashboard permission. ADMIN/RECORDS_OFFICER get operational reporting; the
Medical Officer has no Reports screen. ADMIN has no implicit clinical privileges.
`/api/v1/reports/appointments` and `/api/v1/reports/clinical-activity` now return 404 to signed-in staff.

The service takes a shared authorization lock and rechecks the current session,
account status and role after waiting. This prevents a queued report from using
stale privileges after a cooperating suspension, revocation or role change.

## Ranges and UTC

Dashboard query: optional `from` and `to` only. Report queries: optional `from`,
`to`, and `bucket=day|week|month` (default `day`). If either endpoint is supplied,
both are required. Examples:

```text
/api/v1/dashboard
/api/v1/reports/patients?from=2024-02-01T00:00:00Z&to=2024-03-01T00:00:00Z&bucket=week
/api/v1/reports/admissions?bucket=month
```

Endpoints must be real ISO calendar timestamps with seconds and an explicit `Z`
or numeric offset; up to three fractional digits are accepted. URL-encode `+`
offsets as `%2B`. Endpoints normalize to UTC. Timezone-less timestamps, invalid
calendar dates, arrays, objects and repeated parameters are rejected.

Ranges are **half-open `[from, to)`**: include the lower instant, exclude the
upper instant. `from < to` is required, with a maximum duration of 366 elapsed
24-hour days. Supported UTC endpoint years are 1–9999. Future ranges are allowed;
they simply count nothing yet.

With no endpoints, the dashboard chart covers the 7 UTC calendar dates ending with today
(today minus 6 days through tomorrow's UTC midnight); a dashboard range longer than 31 days is
rejected with `REPORT_RANGE_TOO_LARGE`. Reports default to the 30 UTC calendar dates ending with
today (today minus 29 days through tomorrow). The server OS timezone is never used for calendar
grouping. A requested range replaces the dashboard's default chart period; the `today` counts always
cover today's UTC date.

Day buckets begin at UTC midnight, week buckets on Monday at UTC midnight, and
month buckets on the first at UTC midnight. The label `period` is the bucket's
UTC start date, formatted `YYYY-MM-DD`. Partial first/last buckets count only
events in the requested interval; their label can precede `from`. Series sort
ascending and include zero rows for missing periods. A 366-day interval with
partial edges can touch 367 daily buckets; allocation is capped at 367. Week and
month series use the same cap, though the range bound yields fewer buckets.

Unknown query keys are errors, including `role`, `clinicianId`, `authorId`,
`patientId`, `status`, `timezone`, `includeClinical`, Prisma filters, sort and
pagination keys. There are no optional status filters in Step 8. Schema errors
use existing `VALIDATION_ERROR`; ordered-range errors use `INVALID_REPORT_RANGE`,
overlong ranges use `REPORT_RANGE_TOO_LARGE`, and authorization uses `FORBIDDEN`.
Suspended/disabled/pending accounts and expired/revoked sessions receive 401.

## Common contracts

`generatedAt` is an ISO UTC request-generation timestamp. `range` always contains
`{ from, to, bucket, timezone: "UTC" }`, with normalized ISO endpoints. Numeric
counts are nonnegative JSON numbers; raw PostgreSQL bigint counts are checked for
safe integer conversion. Impossible overflow fails safely rather than rounding.
No raw entity arrays, patient/staff IDs, demographics, diagnoses, complaints,
clinical text, notification content, session data or password fields are returned.

`snapshot` fields describe current state when queried, regardless of the selected
date range. `period`/`summary`/`series` describe activity within the range. These
are live operational aggregates, not historical as-of snapshots. Admissions and discharges
are permanent and their times never change, so a past period's counts only change if a stay is
back-dated into it.

## Dashboard contracts

All dashboards return `{ role, generatedAt, range, snapshot, today, activity }`:

```json
{
  "role": "RECORDS_OFFICER",
  "generatedAt": "2026-11-12T09:30:00.000Z",
  "range": { "from": "2026-11-06T00:00:00.000Z", "to": "2026-11-13T00:00:00.000Z", "bucket": "day", "timezone": "UTC" },
  "snapshot": { "currentAdmissions": 5, "unreadNotifications": 1, "activePatients": 14, "archivedPatients": 0 },
  "today": { "admissions": 2, "discharges": 1 },
  "activity": { "admissions": 8, "discharges": 5, "series": [
    { "period": "2026-11-06", "admissions": 1, "discharges": 1 },
    { "period": "2026-11-12", "admissions": 2, "discharges": 1 }
  ] }
}
```

(The series is shortened here; it has one zero-filled row per UTC day of the range.)

| Field | Meaning |
| --- | --- |
| `snapshot.currentAdmissions` | Stays with status `ADMITTED` now, hospital-wide |
| `snapshot.unreadNotifications` | The signed-in user's own unread notifications |
| `snapshot.activePatients`, `archivedPatients` | ADMIN and RECORDS_OFFICER only |
| `snapshot.staffActiveNow`, `staffSignedInToday` | ADMIN only (Phase 19D): staff who made a request in the last 5 minutes, and staff who signed in since UTC midnight; counts only |
| `snapshot.currentAuthoredDrafts` | DOCTOR_IN_CHARGE only: their own clinical records still in draft |
| `today.admissions`, `today.discharges` | Today's UTC date, by `admittedAt` and `dischargedAt` |
| `activity` | The chart period: totals and one row per UTC day, admissions by `admittedAt`, discharges by `dischargedAt` |

Every figure is an aggregate count; no patient, staff or clinical record is returned. Admission
figures cover the whole hospital for every role. The range bucket is always `day` and cannot be
client-selected.

`unreadNotifications` counts only current
principal delivery rows with `readAt = null`; reports do not mark anything read.
Active staff counts require `StaffUser.status = ACTIVE`, grouped by role.

## Patient report

```json
{
  "generatedAt": "2026-10-10T12:00:00.000Z",
  "range": { "from": "2024-02-28T00:00:00.000Z", "to": "2024-03-02T00:00:00.000Z", "bucket": "day", "timezone": "UTC" },
  "snapshot": { "activePatients": 12, "archivedPatients": 2 },
  "summary": { "registrationsInRange": 2 },
  "series": [
    { "period": "2024-02-28", "registrations": 1 },
    { "period": "2024-02-29", "registrations": 1 },
    { "period": "2024-03-01", "registrations": 0 }
  ]
}
```

Example numbers are illustrative. Registrations use `Patient.createdAt`, including
patients later archived. Current active means `archivedAt IS NULL`; archived means
non-null. Archival never subtracts historical registrations. The API provides no
department, age, sex, identity or demographic breakdown.

## Admissions report

```json
{
  "generatedAt": "2026-11-11T12:00:00.000Z",
  "range": { "from": "2026-11-09T00:00:00.000Z", "to": "2026-11-12T00:00:00.000Z", "bucket": "day", "timezone": "UTC" },
  "snapshot": { "currentAdmissions": 7 },
  "summary": { "admissionsInRange": 3, "dischargesInRange": 2 },
  "series": [
    { "period": "2026-11-09", "admissions": 1, "discharges": 0 },
    { "period": "2026-11-10", "admissions": 0, "discharges": 2 },
    { "period": "2026-11-11", "admissions": 2, "discharges": 0 }
  ]
}
```

Example numbers are illustrative. Admissions are counted by `admittedAt` and discharges by
`dischargedAt` within the range, so a stay admitted in one period and discharged in another
counts in both. Re-admissions count as admissions. `currentAdmissions` is live and independent of
the range. No patient, room or staff detail is returned.

## Appointment report (retired)

Removed in Phase 19A; kept for reference. It returned `{ generatedAt, range, summary, series }`. Both `summary` and each series
row contain `totalAppointments`, `scheduled`, `confirmed`, `checkedIn`,
`completed`, `cancelled`, `noShow`, `cancellationRate`, and `noShowRate`. Series
rows additionally contain `period`.

All six current statuses are counted by **scheduledStart within the range**,
never appointment creation/update/cancellation time. Totals include all statuses.
Rates are percentages: `cancelled / totalAppointments * 100` and
`noShow / totalAppointments * 100`, rounded to two decimal places. Empty
denominators produce numeric 0. Overall rates use overall counts, not averages of
bucket rates. Missing statuses/buckets produce zeros. There is no pagination.

## Clinical activity

Since Phase 19C only the Medical Officer dashboard's `snapshot.currentAuthoredDrafts` remains
(Phase 19A had also kept `period.clinical` on the dashboard; the separate report route with its
series was removed then). The definitions below are kept for reference. The former report returned
`{ generatedAt, range, snapshot, summary, series }`:

- `snapshot.currentAuthoredDrafts`: current DRAFT encounters with `createdById`
  equal to the authenticated doctor, regardless of occurredAt/range.
- `summary.encountersInRange`: own authored encounters by `occurredAt`, including
  DRAFT, REVIEWED and VOIDED records.
- `summary.finalizedEncountersInRange`: own authored REVIEWED encounters by
  `reviewedAt`, the existing finalization timestamp.
- `summary.amendmentsInRange`: own amendments by `authorId` and `createdAt`.
- `series`: `{ period, encounters, finalized, amendments }` for each bucket.

Encounter ownership is `createdById`, appointment assignment is `clinicianId`,
and amendment authorship is `authorId`; these concepts are not interchangeable.
Broader Step 6 doctor access to clinical history does not broaden personal reports.
No metric uses `updatedAt`. Finalization and amendment dates may differ from the
encounter date. Archived patients remain in authorized historical counts; inactive
staff are not joined to exclude history. There is no chief-complaint/diagnosis
frequency report and no clinician comparison or organization clinical analytics.

## Queries, indexes and consistency

Known, reviewed queries live in `report.queries.ts`. PostgreSQL aggregates counts;
Node only converts bounded grouped rows, computes rates and fills missing buckets.
The admissions UNION ALL yields at most two rows per bucket, and clinical UNION ALL
at most three per bucket. SQL count/filter combines active/archived snapshots.
Prisma count/groupBy handles unread, upcoming, draft and active-staff counts.
Query count is fixed per endpoint and does not grow with source rows or buckets.
No full patient, admission or encounter collections are fetched for counting.

Time grouping uses tagged `$queryRaw`/`Prisma.sql` because UTC date_trunc grouping
is not directly expressed by the existing Prisma groupBy API. Dates, identities
and even the whitelisted bucket unit are bound parameters. Identifiers, expressions,
UNION branches and optional ownership predicate are fixed server code; no
user-derived SQL text or unsafe raw query is used. Explicit `AT TIME ZONE 'UTC'`
makes grouping independent of the database session timezone. Raw range endpoints
bind ISO UTC strings with explicit timestamptz casts, avoiding the adapter's
timestamp-without-zone Date parameter behavior. Transactions also set the local
timezone to UTC for ORM timestamp comparisons. Exact timestamp
range predicates remain on the original columns, preserving index eligibility.

Existing indexes reviewed: Patient.createdAt; Admission.dischargedAt, (status, admittedAt),
the partial current-stay index (used by the current count); Encounter.createdById
and (clinicianId, occurredAt); EncounterAmendment.(authorId, createdAt);
NotificationRecipient.(staffUserId, readAt, createdAt); StaffUser.(role, status).
The clinician encounter index does not directly satisfy author-based reporting;
the author index narrows those rows. There is no reviewedAt compound index or
Patient.archivedAt index, and no standalone Admission.admittedAt index, so admissions by
period may scan the stays. No new indexes are added without representative evidence.
Current snapshot counts still scale with source data, and each doctor's clinical
range queries may scan that author's history. Production-size EXPLAIN ANALYZE and
load testing should guide any future compound/partial index or cache.

Transactions use READ COMMITTED and a shared authorization advisory lock. Counts
and series from a single grouped query agree; different queries in one response
may see concurrent commits. `generatedAt` is not an MVCC as-of guarantee. The
existing database statement/query timeouts and a 10-second transaction timeout
bound failures. These tests establish correctness, not throughput targets.

## Audits, privacy and migration

Before Phase 19A, each successful clinical-activity GET appended one `CLINICAL_REPORT_VIEWED`
event inside the same transaction; the route is gone, so the value now appears only in history. `entityType=STAFF_USER` and `entityId=actorId` identify
the personal report scope; metadata is only `{ source: "API" }`. Existing request
ID, IP and user-agent handling applies. If auditing fails, no result is returned.
Ordinary dashboards (including doctor dashboards), operational reports, denied
requests and invalid queries do not generate report-access audit noise. Express
HEAD handling follows the GET authorization/audit path.

Request logging remains metadata-only with safe errors; response bodies, raw
query parameters and aggregate results are not logged. Defensive root/nested
redaction additionally covers `report`, `reports`, `dashboard`, `metrics`,
`summary`, `series`, and `snapshot`, alongside existing sensitive field protection.

Migration `20261010120000_reporting_query_support` adds only the audit enum value.
No tables, data backfills, indexes, dependencies or environment variables are added.
Deploy reviewed migrations before running this API version. Existing append-only
audit protections remain intact.

## Frontend findings and deferred work

Step 15 integrated these endpoints into Overview and Reports; see the
[dashboard and reports frontend](frontend-dashboard-reports.md). The findings below
describe the frontend as it was inspected in Step 8.

The inspected Overview is shared by Admin and Doctor; Records has no Overview
navigation. Records also lacks Reports navigation despite server operational-report
permission, while Doctors have no dedicated clinical report screen. Navigation
must later follow server permissions and the role-specific dashboard contracts.

Overview currently displays mock Total patients 2,048, Appointments 86, Medical
records 1,279 and Active cases 24, with hardcoded +12.5%, +8.2%, +4.6%, +2.1%
comparisons. The API does not define active cases, all-record clinical totals for
administrators, or previous-period growth percentages. Patient activity has seven
fixed Mon–Sun bars (47, 62, 54, 75, 49, 66, 44); API series use UTC date labels and
can contain different numbers of day/week/month buckets. The “This week” control
is a placeholder, not an actual range filter.

The mock chief-complaint donut shows 2,048 visits and Fever/Headache/Chest pain/
Respiratory/Other shares of 34/24/18/12/12%. These clinical breakdowns are deliberately
absent. Recent activity and today's schedule contain mock names/details; aggregate
endpoints return neither activity feeds nor patient schedule details. The displayed
lab approval activity has no supported lab workflow in this backend.

Reports contains placeholder Patient census, Appointment summary, Chief complaint
breakdown and Staff activity log cards with static update labels. Department and
demographic census, complaint analytics, audit-log browsing, and Export all have
no Step 8 implementation. Existing concurrent authentication/patient/appointment
frontend changes are separate; this step edits no frontend files or mock data.

Exports (CSV/PDF/Excel), scheduling/email of reports, BI, billing, WebSockets/SSE,
Redis, in-process caching, diagnosis analytics and frontend integration are deferred.
No small-cell suppression or statistical disclosure mechanism is implemented;
aggregate access is limited by the explicit operational/personal permissions.
Production volume, operational privacy policy, backup/retention/encryption and
treatment-relationship authorization need separate review. Step 8 stops here.
