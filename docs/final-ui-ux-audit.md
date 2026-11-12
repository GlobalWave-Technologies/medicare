# Final UI/UX audit — Phase 19C

This phase restored a live dashboard chart and reviewed every screen as a Medical Officer, a
Records Officer, an Administrator and a first-time member of staff. The aim was a simpler, more
consistent interface before client testing. No business features were added: there is no pharmacy,
billing, laboratory, inventory, bed management or appointment replacement, and no database
migration.

## 1. Screens reviewed

Every screen was checked in a real browser (production build behind HTTPS) at 320, 375, 768, 1024,
1280 and 1440 pixels for each role it applies to, in light mode, and at 375 and 1440 pixels in dark
mode. Screenshots of each were inspected, not only DOM assertions.

| Area | Screens |
| --- | --- |
| Authentication | Sign in, forgot-password message, temporary-password (change) screen, install prompt |
| Overview | Admin, Records Officer and Medical Officer dashboards, cards, chart, recent stays |
| Patients | All patients, Currently admitted, Discharged, search, Register patient, Register & admit, Admit, patient record, Change room, previous admissions, admission record, discharge |
| Medical Records | Admitted-patient list, a patient's medical record, record list and filters, new and edited drafts, complaints, diagnoses, treatment, medications and the medicine list, medication history, finalized record, amendments |
| Medication Catalog | Search, Active/Inactive/All, add, deactivate, reactivate, empty states |
| Staff & Access | Directory, status totals, add staff, reset password, activate/deactivate, roles, confirmations |
| Notifications | List, unread state, detail, empty state, broadcast |
| Reports | Period, grouping, both reports, chart and table |
| Navigation | Desktop sidebar, phone navigation drawer, sign out, change password, theme |

## 2. The live dashboard chart

**What it shows.** "Admissions and discharges": one line for admissions (solid, round markers) and
one for discharges (dashed, square markers), one point per day. Periods: **Last 7 days** (default),
**Last 30 days** and **This month**. A sentence above the chart gives the totals in words and the
busiest admission day; **Show data table** lists every day.

**Data source.** The counts come from the `Admission` table on the server, never from the browser:
admissions by `admittedAt`, discharges by `dischargedAt`, grouped by UTC calendar day (the same
rules as the Reports page). There are no demo, random or fixed numbers. `GET /api/v1/dashboard`
now returns `today` (today's admissions and discharges) and `activity` (the chart totals and daily
series) for the requested period, at most 31 days; see
[dashboard and reports API](dashboard-reports-api.md).

**Live behaviour.** The Overview loads the latest figures when it opens and every time staff return
to it, refreshes by itself one minute after the last load while the page is visible, and has a
**Refresh** button. A hidden browser tab makes no requests and catches up once when shown again.
No WebSockets are used.

**Roles and privacy.** Every role sees the same hospital-wide chart, which contains only counts. No
patient names, rooms, clinical text or staff details reach the dashboard. Administrators and Records
Officers still cannot open clinical records or medication history.

**States.** While loading, the cards and chart show grey placeholders of the same size, so nothing
jumps. When a period has no stays, the chart is replaced by "No admission activity recorded for this
period." If a refresh fails, the last figures stay on screen with a note and **Try again**; if the
first load fails, a plain error with a support reference is shown. Changing the period keeps the
previous chart visible (dimmed) until the new one arrives.

**Accessibility.** The chart has a title and summary in words, a legend, and series that differ by
line style and marker shape as well as colour (the two colours were checked for colour-blind
separation and contrast in both themes). With the keyboard, focus the chart and use the left and
right arrow keys (Home and End for the first and last day); each day is shown in a tooltip and read
out politely by screen readers. The data table is the full text equivalent.

**Size and performance.** The chart is plain SVG with no charting library; the client bundle grew by
about 1.5 kB compressed. It redraws to the width of its panel from 320 pixels upwards.

## 3. Dashboard cards

| Role | Cards (each answers one question) |
| --- | --- |
| Administrator | Currently admitted · Total patients · Admissions today · Discharges today |
| Records Officer | Currently admitted · Total patients · Admissions today · Discharges today |
| Medical Officer | Currently admitted · Admissions today · Discharges today · My unfinished records |

Removed from the Overview: the unread-notifications card (the navigation badge already shows it), the
administrator's active-staff card (Staff & Access shows it), period registration and personal clinical
counts (Reports and the record lists cover them), and the "Your workspaces" cards that repeated the
navigation. Card links open the matching list directly (for example **View admitted patients** opens
Patients on *Currently admitted*). **Register patient** is the Overview's one primary action.

## 4. Issues found and fixes made

| Area | Issue found | Fix |
| --- | --- | --- |
| Search | Typing a full name such as "Kojo Appiah" found nothing: the whole text had to match one field | Patient and admission search now also match when every word (up to five) is found in a name, number or room |
| Overview | Seven to nine cards across two period panels, plus shortcut cards repeating the navigation | Four cards for today, one chart, recent stays, one primary action |
| Header | "Medicare / Overview" repeated the page title | The trail now appears only inside a record (for example "Patients / Patient record") |
| Headings | Small capital labels above most section titles ("PATIENTS AND ADMISSIONS", "STAFF ADMINISTRATION", "PRESCRIBING", "MEDICATIONS") | Removed on list pages; kept only where they name a kind of record |
| Patient list | A separate "Record: Active" column on every row; orange initials on every row | One **Status** column (Admitted with room, Not admitted, or Archived record); neutral initials; Refresh beside the search |
| Patient record | Actions were below the identity and admission details; "Active record" badge on every patient | Name, number, Admitted/Not admitted, room and age at the top; **Open medical record**, **Change room**, **View admission** and, set apart on the right, **Discharge patient** directly below; details and previous admissions after |
| Admitted list | Row actions stacked; Discharge looked like an ordinary button | Actions side by side; Discharge uses the danger style |
| Status colours | Admitted used the brand orange | Admitted is blue and Discharged/Not admitted grey everywhere; Draft amber, Finalized green; always with words |
| Medical record | Five filters open on every record list; records titled by a long reference | Filters folded under **Filter records** (open automatically while in use); each record is titled by when it was written, reference kept small |
| Clinical form | Technical notes ("Repeated clock times use the first occurrence…", "no coding registry validation"); notes before complaints | Plain guidance on Draft versus Finalized; order is Complaints, Notes, Diagnoses, Treatment, Medications; "Jump to" links |
| Medication history | A long record reference as the link text wrapped on phones | Link reads **Open record** |
| Discharge | "Confirm discharge" button; blocking message did not say what to do | Button reads **Discharge patient**; the block reads "This admission has an unfinished clinical record. Finalize or complete the draft record before discharging the patient." |
| Registration | The difference between the two buttons was not explained; no reminder to search first | The form explains **Register patient** (record only) and **Register & admit** (then asks for the room) and reminds staff to search Patients first |
| Medication Catalog | Each status had a dot and an icon; decorative pill icon | One marker per status; decorative icon removed |
| Phones | Dashboard card links wrapped awkwardly; patient cards one fact per line | Links wrap with their arrow; two facts per row down to 340 pixels |
| Dead code | Appointment status colours, tokens and old dashboard styles still shipped | Removed (see section 8) |

## 5. Responsive findings

No screen scrolls sideways at any tested width for any role, in either theme, and no text or button
is clipped or off screen. The chart, its tooltip and the medicine list stay inside their panels at
320 pixels. Dialogs fit the screen at 320 pixels and scroll inside themselves. The phone navigation
drawer lists every workspace and Sign out, and closes with Escape. Tables become stacked cards below
1100 pixels.

## 6. Accessibility findings

- Automated checks (axe) found no serious or critical issues on the Overview (all roles), patient
  and admission records, Medical Records, Staff & Access, Medication Catalog, Reports,
  Notifications, sign-in and the temporary-password screen. Automated checks do not replace a
  screen-reader review.
- Keyboard walkthroughs: focus starts on the page title; **Skip to main content** works; every
  control shows a 3-pixel focus outline; dialogs keep focus inside, close with Escape and ask before
  discarding typed text; the medicine list and the chart work with arrow keys.
- On phones the visual order of the Overview buttons now matches the keyboard order.
- Status is never shown by colour alone.

## 7. Dark mode

All screens were inspected in dark mode. Cards, tables, dialogs, drop-down lists, the medicine list,
the chart, its tooltip and grid lines, focus rings and form fields all use the dark theme's colours;
no white panels remain. Chart colours were checked against the dark surface.

## 8. Appointment remnants removed

The appointment status colour tokens (six marker colours and two extra badge tones), their badge and
report styles, the appointment entries in shared style rules, the unused report styles and the old
dashboard card styles were deleted. No appointment navigation, route, label or screen remains. Past
appointment references on old clinical records and notifications are still shown as history, and the
`Appointment` table is kept read-only; it is not dropped in this phase.

## 9. Client feedback regression checklist

| Previous complaint | Result |
| --- | --- |
| Medical Officer can register a patient | Yes, from the Overview or Patients |
| Medical Officer can admit a patient | Yes (Register & admit, or Admit patient on the record) |
| No mandatory phone field | Yes: there is no phone field on registration |
| Room assigned during admission | Yes: the room is part of admitting |
| Room can change | Yes: **Change room** on the patient record, kept in room history |
| Medication dropdown restored | Yes: searchable list from the catalog |
| Medication list manageable | Yes: Administrators add, deactivate and reactivate medicines |
| Medications remain in history | Yes, after finalizing and after discharge |
| Proper discharge exists | Yes, with confirmation, note and a clear block while a draft is open |
| Discharged patients leave the current list | Yes |
| Previous history remains | Yes: previous admissions, room history, discharge note and medications |
| Appointments absent | Yes: no menu, screen or route |
| Interface simpler than before | Fewer cards and headings, actions at the top of the patient record, one primary action per screen, full-name search, filters out of the way |

## 10. Verification

Server, database and client test suites, typecheck, lint and both builds were run after the
changes. A new browser acceptance run on the production build covered the live chart against the
database (all three periods, refresh, automatic update, failure and loading), each role's dashboard
and privacy, complete Medical Officer, Records Officer and Administrator walkthroughs, all widths and
both themes, dialogs, keyboard use, error messages and the checklist above.

## 10a. Phase 19D re-audit: Staff & Access, Staff Activity and the administrator's Overview

Staff Activity was added as one page with two sections (Active staff, Recent staff activity) and a
shared search, rather than a dashboard of charts. It reuses the Overview's toolbar, status badges
(words with colour), segmented period control, stacked phone layout and one-minute visible-only
refresh. Staff & Access gained one column (**Last active**, with the last sign-in in small type
under it) instead of two, and its account view gained Last signed in, Last active and one link to
the person's sessions. The administrator's Overview gained one card (**Staff active now**, with the
number signed in today) linking to Staff Activity; other roles' Overviews are unchanged. Both pages
were checked at 320 to 1440 pixels in light mode and at 375 and 1440 in dark mode with no sideways
scrolling, and with automated accessibility checks.

## 11. Known limitations

- **Patient numbers are long** (`PT-` followed by 36 characters). They are shown in full in a smaller
  type and wrap cleanly, and search accepts part of a number, but they are hard to read aloud or
  type. Short sequential numbers (like the `AD-000001` admission numbers) would need a migration
  and a decision on existing numbers; this is recommended as the next change.
- "Today" and the chart's days are **UTC calendar days**, as in Reports. For a hospital on UTC this
  is the local day.
- The chart labels its lines through the legend, tooltip and data table rather than text at the end
  of each line, which would collide on phones.
- Reports keep their bar chart; only the Overview uses the new line chart.
- Search matches whole words and parts of words but does not correct spelling mistakes.
- Tables are not sortable; lists keep their fixed order (latest first).
- The Overview refreshes once a minute; changes made in the last minute appear on the next refresh or
  when **Refresh** is selected.
