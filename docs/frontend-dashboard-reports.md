# Step 15 — Dashboard and reports frontend

## Scope and findings

Overview and Reports now use the Step 8 aggregate API
([dashboard and reports API](dashboard-reports-api.md)). The backend is unchanged.

Before this step:

- **Overview:** navigation cards and a "Dashboard analytics are being prepared" note.
  Earlier mock KPIs, growth percentages, weekday charts, complaint distributions and
  activity feeds had already been removed.
- **Reports:** a "not yet available" panel.
- **Navigation:** Records Officers had no Overview or Reports, and Doctors had no
  Reports, although the server grants both.
- **Mock data:** `client/src/mocks/data.ts` still held a fake schedule with invented
  patient names, kept "for the deferred dashboard". Nothing imported it. It is now
  deleted, and the tests that protected it assert that no mock module exists.

Contract facts that shaped the UI:

| Area | Backend behavior |
|---|---|
| Dashboard | `GET /dashboard` returns the dashboard for the session's role, with no role or scope parameter. It is counts only: no time series, and no list of upcoming appointments. |
| Dashboard period | Optional paired `from`/`to`; the default is today's UTC day. No bucket. |
| Reports | `/reports/patients` and `/reports/appointments` for Admin and Records Officer; `/reports/clinical-activity` for Doctor in Charge only. |
| Report query | Paired `from`/`to` (timezone-aware, half-open `[from, to)`, at most 366 days) and `bucket=day|week|month`. The default is the last 30 UTC calendar dates by day. Unknown keys are rejected. |
| Buckets | UTC day, Monday-start UTC week, UTC month. Labels are the bucket's UTC start date, which can precede `from`. Empty buckets are zero-filled by the server. |
| Rates | Percentages rounded to two decimals by the server; 0 for an empty denominator. |
| Appointment report | `summary` and `series` only. There is no "upcoming" field; upcoming exists only on the dashboard. |
| Clinical report | Own authored activity. Each successful read writes one `CLINICAL_REPORT_VIEWED` audit event. |
| Exports | None exist. |

## Architecture

| File | Purpose |
|---|---|
| `client/src/api/dashboard.ts` | `dashboardApi.get(query?, signal?)`. It sends only a paired `from`/`to` and validates the role-specific response into a discriminated union. |
| `client/src/api/reports.ts` | `reportsApi.patients/appointments/clinicalActivity(query?, signal?)` with `from`, `to` and `bucket`, plus the shared aggregate parsers. |
| `features/dashboard/Overview.tsx` | The role-specific Overview. |
| `features/reports/Reports.tsx` | Report types, filters and the patient, appointment and clinical views. |
| `features/reports/TrendChart.tsx` | Dependency-free SVG bar chart with summary, legend and data table. |
| `features/reports/ReportParts.tsx` | KPI card, status breakdown, feedback, skeleton and section heading. |
| `features/reports/report-time.ts` | UTC presets, custom-range validation and UTC labels. It has no imports, so tests can run it under other process time zones. |
| `features/reports/report-utils.ts` | Formatting, chart scale helpers, role report kinds, safe errors and the keyed read hook. |
| `features/reports/reports.css` | Dashboard and report styles. |

All reads use the shared credentialed `request()`, so they send no CSRF token. A 401
goes through the shared session invalidation, and a 403 keeps the session.

Every response is rebuilt from documented fields:

- counts must be non-negative safe integers;
- rates must be finite and between 0 and 100;
- ranges must be ordered and marked UTC;
- buckets must be `day`, `week` or `month`;
- period labels must be `YYYY-MM-DD`.

Anything else is rejected as `INVALID_RESPONSE`. Extra fields (lists, names, notes,
other authors) are dropped before they reach React state.

`useKeyedRead` keys each read by its query and a refresh revision. A newer key aborts
the older request, and late results are discarded. Nothing is stored in browser
storage, nothing polls, and there is no SSE or WebSocket.

## Navigation and roles

| Role | Navigation | Overview | Reports |
|---|---|---|---|
| Admin | Overview, Patients, Appointments, Staff, Reports, Notifications | Hospital operations | Patient activity, Appointment activity |
| Records Officer | Overview, Patients, Appointments, Reports, Notifications | Registration and appointments | Patient activity, Appointment activity |
| Doctor in Charge | Overview, Patients, Appointments, Medical records, Reports, Notifications | Own workload | My clinical activity |

- **Landing:** every role now lands on Overview. Records Officers previously landed on
  Patients.
- **Server-chosen dashboard:** there is no role selector or "view as" control. The UI
  renders the dashboard the server returns.
- **Report access:** `reportKinds(role)` mirrors the server permissions, and a report
  outside a role's list can never become active.

## Overview

- **Header:** "Overview", with a role-specific description.
- **Toolbar:** a Today / Last 7 days / Last 30 days period control.
  - Today sends nothing, so the server's UTC day applies.
  - The other options send explicit UTC calendar ranges ending today.
- **Refresh:** "Last refreshed {generatedAt in local time}" and a Refresh button.
- **Current status:** live counts that don't depend on the period.
  - **Admin:** active patients, archived patients, active staff (with the per-role
    breakdown), upcoming appointments and your unread notifications.
  - **Records Officer:** the same without staff.
  - **Doctor:** my upcoming appointments, my open drafts and unread notifications.
- **Activity {today | in the last N days}:** labelled with the UTC dates and its
  scope ("Across the whole hospital" or "Only appointments assigned to you and your own
  clinical work").
  - **Admin and Records Officer:** patients registered, appointments, and the server's
    cancellation and no-show rates (for example "1 of 12 appointments cancelled").
  - **Doctor:** my appointments, encounters documented, encounters finalized and
    amendments added.
  - **All roles:** "Appointments by current status", listing all six statuses.
- **Card actions:** View patients, Manage staff, View appointments, View my
  appointments, Open medical records and Open notifications open the existing screens.
  Upcoming appointments is a count, so its action opens the schedule. Nothing extra is
  fetched to decorate the dashboard.
- **Go to:** the existing shortcut cards, now role-appropriate. Records Officers get
  Reports instead of Staff & Access.
- **No fabricated figures:** no growth arrows, comparisons, activity feed, schedule,
  chart or "updated N minutes ago". Zero values show 0 and 0%.
- **Unread count:** the dashboard shows its own unread snapshot. The navigation badge
  keeps using the notification API; the two aren't forced into shared state, and
  opening Overview again fetches a fresh dashboard.

## Reports

- **Admin and Records Officer:** Patient activity and Appointment activity, as an ARIA
  tablist with arrow, Home and End keys and roving `tabIndex`.
- **Doctor:** a single "My clinical activity" report with no tabs.
- **Filters:**
  - Reporting period: Last 7 days, Last 30 days (default, matching the API default),
    Last 90 days, or Custom dates.
  - Group by: Day, Week or Month.
  - Apply and Refresh buttons.
- **When reports load:**
  - Changing the report type loads it immediately, with the applied period.
  - Period and bucket changes wait for Apply; until then "Select Apply to update the
    report." is shown.
  - Refresh re-reads the applied report.

  This keeps clinical-report reads, and their audit events, deliberate. In the live run,
  two clinical views produced exactly two reads and two audits.
- **Result header:** the server's reporting period as inclusive UTC dates, for example
  "7 Oct 2026 – 5 Nov 2026 (UTC) · grouped by day", and "Generated {local time}".
- **Patient activity:**
  - "Current status" shows active and archived patients, independent of the period.
  - "In this reporting period" shows patients registered (by registration date,
    including patients archived since) and a "Patients registered per {bucket}" chart.
  - No registrations: "No patients were registered in this period." instead of an
    empty chart.
- **Appointment activity:**
  - Appointments, Completed, Cancellation rate and No-show rate, the six-status
    breakdown, and an "Appointments per {bucket}" chart.
  - Its data table has a column for every status.
  - The copy explains that appointments count by scheduled start using their current
    status, and that upcoming appointments are on the Overview.
  - No appointments: "No appointment activity was recorded in this period."
- **My clinical activity:**
  - A scope note: only your own work, no clinical text, diagnoses or patient details,
    and opening the report is audited.
  - "Current status" shows my open drafts.
  - The period shows encounters documented (by encounter date), encounters finalized
    (by finalization date) and amendments added (by amendment date), with a
    three-series chart.
  - "Finalized" is used throughout; REVIEWED never appears.
  - No activity: "No clinical activity was recorded in this period."
- **Not provided:** exports, print, downloads, diagnosis or complaint analytics, and
  comparisons between clinicians.

## Dates, UTC and buckets

- **Presets:** "Last N days" is the last N UTC calendar dates including today, sent as
  `[today − (N−1) days 00:00Z, tomorrow 00:00Z)`. The client computes today in UTC, so
  the browser's time zone never changes the range.
- **Custom dates:** inclusive UTC calendar dates ("From (UTC date)", "To (UTC date,
  inclusive)"). The end date is sent as the following UTC midnight. Choosing the same
  date for both reports that single day, so the API never receives `from >= to`.
- **Client validation:** before sending, the client rejects a missing start, a missing
  end, an end before the start, impossible dates and periods over 366 days. The error
  is linked to the field and focus moves there. The server stays authoritative;
  `INVALID_REPORT_RANGE`, `REPORT_RANGE_TOO_LARGE` and `VALIDATION_ERROR` have safe
  messages.
- **Labels:** bucket labels are parsed as UTC dates and formatted with
  `timeZone: 'UTC'` ("5 Nov 2026", "Week of 2 Nov 2026", "November 2026"). Only
  `generatedAt` uses the browser's local time.
- **Charts:** they state "Each bar is one UTC calendar day", or that weeks start on
  Monday (UTC) and months are UTC calendar months, with the first and last possibly
  partial.
- **Series:** the server's series is used exactly as returned, with no client
  zero-filling or smoothing.

## Charts and accessibility

- **No chart library:** none is installed and none was added. `TrendChart` draws plain
  SVG bars, grouped for the three clinical measures, using restrained tones.
- **Axes:** gridlines use whole-number steps. Axis labels are HTML, so they don't shrink.
  Up to seven x-axis labels are rendered; a container query keeps only the first,
  middle and last when the chart is narrower than 560px. Visible labels never overlap
  at any tested width.
- **Accessible description:** each chart is a `figure` with a heading and a text
  summary, for example "34 appointments across 30 days. Highest: 5 on 5 Nov 2026."
  The plot is `role="img"`, named by that heading and summary; the SVG is hidden from
  assistive technology.
- **Data table:** "Show data table" opens a captioned table with row and column
  headers in a focusable scroll region. Every period is listed, up to 367 rows.
- **Status breakdown:** a list of words and counts. The coloured dot and bar are
  decorative.
- **Other details:**
  - KPI cards are articles labelled by their heading;
  - loading text uses `role="status"` and errors use `role="alert"`;
  - all controls are native buttons, selects, inputs and radios, at least 44px tall;
  - axe WCAG 2.1 A/AA checks found no serious or critical violations on the admin and
    doctor overviews, the filters with a date error, the appointment report with its
    table open, and the clinical report.

## Loading, errors and empty states

- **Loading:** a contained skeleton. The filters and period controls stay usable.
- **Errors:** a safe message, the support reference and Try again. A 403 says "You
  don't have access to this report." (or dashboard) and offers no retry, and the user
  stays signed in.
- **No raw messages:** server error text and SQL are never displayed.
- **Empty periods:** valid results, not errors. Zero cards stay visible.

## Responsive behavior

KPI grids use `auto-fit` columns: five across at 1440px, two or three at 1024px and
one on phones. At 650px and below:

- the period control and the report filters stack;
- buttons stretch;
- status rows put the bar under the label.

Charts scale to their container and never cause page-level horizontal scrolling. Long
tables scroll inside their own region.

## Verification

- **Client tests:** 138 new tests in six files.

  | File | Tests | Covers |
  |---|---|---|
  | `report-api.test.ts` | 29 | Endpoints, no role or scope parameter, paired ranges only, `+` offset encoding, no CSRF, abort signals, per-role field allowlists, malformed DTOs rejected, clinical extras dropped, 403/401 semantics, source hygiene. |
  | `report-time.test.ts` | 30 | Presets, UTC midnight edges, custom ranges and every validation case, the 366-day limit across a leap year, labels, rates, chart scales, role report kinds, error mapping, and child processes in Honolulu, New York, Tokyo and Kiritimati producing identical UTC output. |
  | `dashboard-ui.test.tsx` | 28 | Each role's cards and values, the snapshot/period separation, all six statuses, `generatedAt`, period presets, refresh without polling, stale-response handling, errors, 403, zeros, card actions, no fake growth/feed/chart, no storage. |
  | `reports-ui.test.tsx` | 34 | Tabs and keyboard, the doctor's single report, each report's content and empty state, presets, custom ranges and validation, buckets, week/month labels, stale responses, loading, errors, 403, refresh, a 367-day series, zero and single-point charts, no export controls, no storage. |
  | `reports-app.test.tsx` | 14 | Navigation and landing per role, reports per role, card navigation, no enrichment fetches, refetch on revisit, badge independence, navigation while the dashboard fails. |
  | `report-session.test.tsx` | 3 | Real AuthGate: a dashboard 401 returns to sign-in; a report 403 keeps the session; a report 401 signs out. |

- **Updated tests:**
  - navigation and landing expectations (`auth-state`);
  - the Overview heading and a dashboard mock (`notification-app`);
  - the Reports assertion and dashboard/report mocks (`product-stabilization`);
  - the three mock-module assertions (`auth-ui`, `patient-ui`, `clinical-privacy`).
- **Live run: 96/96** in Chrome against the production build behind the HTTPS gateway,
  on a fresh disposable database with the restricted runtime role.
  - **Seeded data:** patients over 120 days, including UTC-midnight boundary rows;
    appointments in all six statuses over 80 days for two doctors, plus a booking at
    tomorrow 00:00Z; encounters, finalizations and amendments for two doctors.
  - **Verification method:** every displayed figure was compared with values computed
    in the harness from raw rows. This covered:
    - snapshots, staff by role, upcoming and unread counts;
    - today and 7- and 30-day registrations, appointment totals, all six statuses and
      rates;
    - day, Monday-week and month series and their labels;
    - the doctor's own drafts, encounters, finalizations and amendments, including a
      week series where each measure uses its own date.
  - **Other checks:** zero data, an empty custom period, refused ranges, 403s on other
    roles' reports with the session kept, identical labels in Honolulu and Kiritimati
    browsers, five widths, keyboard, axe, storage, console and request counts.

## Limitations

- **No dashboard history or comparison:** the dashboard has no series and no
  previous-period comparison, so it shows no trends or deltas.
- **Upcoming appointments are a count only:** its action opens the full schedule
  rather than a pre-filtered list.
- **Live, not historical, counts:** they reflect current statuses, so later changes can
  alter past periods. Snapshot and period figures come from separate reads and may
  briefly disagree during concurrent edits.
- **Client clock:** presets use the client's clock for "today" in UTC. A badly wrong
  clock shifts the range; the server's returned range is shown so this is visible.
- **No organization-wide clinical or diagnosis analytics,** no exports, scheduling or
  printing of reports.
- **Clinical report audits:** every clinical report view is audited, including Refresh
  and Apply.
- **Browser coverage:** live checks ran in Chrome only for this step.
