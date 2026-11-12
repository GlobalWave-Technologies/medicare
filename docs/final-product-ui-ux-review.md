# Final product UI/UX review — Phase 19E

This review looked at Medicare as one product: from opening the sign-in page to signing out, for
every role, on phones, tablets and desktops, in Light, Dark and System themes. It is a refinement
pass before client testing. No business module, role, migration, API change or dependency was
added; pharmacy, billing, laboratory, inventory, ward or bed management, messaging, analytics and
appointments remain out of scope.

## 1. Method

1. **Screens captured before any change.** A scripted browser run on the production build (HTTPS,
   strict content security policy, synthetic data) captured 42 screens and dialogs per width and
   theme (sign-in, wrong password, forgot password, temporary password, install offer, and each
   role's screens and dialogs) at 1440 and 375 pixels in Light and Dark. The key screens for each
   role and theme were opened and inspected by eye; every capture was also checked automatically
   for sideways overflow, text under 12 pixels and page errors.
2. **Issues recorded and classified before fixing** (section 3): P0 blocks use, P1 serious
   usability issue, P2 visible polish or usability issue, P3 minor cosmetic issue.
3. **Fixes made**, then the same screens captured again at 1440 and 375 pixels (Light and Dark)
   and at 320, 768 and 1024 pixels (Light), and inspected again.
4. **Final browser acceptance** (section 9) on a fresh database: authentication, each role's
   complete walkthrough, PWA, privacy, every width and theme, keyboard and automated
   accessibility checks.
5. **Automated verification**: Prisma generate and validate, typecheck, lint, server, database and
   client tests, both builds and `git diff --check`.

## 2. Pages and states reviewed

| Area | Reviewed |
| --- | --- |
| Authentication | Sign in (empty, wrong password, server failure), Forgot your password?, temporary-password screen, mismatched confirmation, return to sign-in, expired and ended sessions, sign out, sign out everywhere |
| PWA | Welcome to Medicare (install offer), iPhone steps, Not now, Install Medicare in the menu, offline screen, static-only caching |
| Shell | Desktop sidebar, top bar, phone menu (drawer), theme control, account area, Change password |
| Overview | Administrator (five cards), Records Officer, Medical Officer; chart, period, data table, recent admissions and discharges |
| Patients | All patients, Currently admitted, Discharged, search (name, part of name, number, room), empty search, Register patient, Register & admit, Admit patient, Change room, patient record, previous admissions, admission record |
| Medical Records | Admitted-patient list, a medical record, filters, new clinical record, medicine picker (results and no results), medication orders, medication history, finalized record, discharge, discharge blocked by a draft |
| Administration | Staff & Access (directory, add staff, account detail), Staff Activity (active staff, recent activity, a person's sessions, End session, Sign out everywhere), Medication Catalog (add, deactivate) |
| Other | Reports (both reports, chart and table), Notifications (list, detail, broadcast) |

## 3. Issues found

**Totals: 43 issues. P0: 0. P1: 1 (fixed). P2: 23 (all fixed). P3: 19 (9 fixed, 10 remaining).**

### P1 — serious usability issue (fixed)

| # | Issue | Fix |
| --- | --- | --- |
| 1 | Dates of birth were shown as `08/09/1968`, which reads as 8 September or 9 August depending on habit, on the screen staff use to confirm identity | Written out in full: "8 September 1968" |

### P2 — visible polish or usability issues (all fixed)

| # | Area | Issue | Fix |
| --- | --- | --- | --- |
| 2 | Sign in | A wrong password showed a long "Support reference" code | References appear only for unexpected server failures; the message also tells suspended staff to contact the administrator |
| 3 | Errors | A server failure said "Unable to contact the server" although the server had answered | "Medicare could not complete this just now. Please try again in a moment." (with the support reference); network failures keep their message |
| 4 | Sign in | A generic person icon and a repeated "managed by your administrator" footer made the form look like a template | Removed; the page is brand, heading, form, forgot-password help, theme |
| 5 | Sessions | An expired or administrator-ended session dropped staff on sign-in with no reason | Sign-in says "Your session has ended. Sign in again to continue." (not after a deliberate sign-out or on a first visit) |
| 6 | Temporary password | The form sat inside an unstyled grey box (browser default border), looking unfinished | Removed for all forms; the screen now matches sign-in |
| 7 | Temporary password | "New password" was both the section title and the field label | Section reads "Choose a new password"; identity line simplified |
| 8 | Phone menu | The menu had no Sign out (only the top bar did) | Sign out at the bottom of the menu |
| 9 | Consistency | Roles read "Admin" in Staff & Access and Staff Activity but "Administrator" in the sidebar | "Administrator" everywhere |
| 10 | Overview (Admin) | The fifth card (Staff active now) sat alone on a second row | Five cards in one row on wide screens, three and two on tablets, the fifth full width on phones |
| 11 | Patient numbers | The 39-character numbers dominated lists, cards and dialog headers and wrapped on phones | Lists and summaries show the first part (`PT-5FD1FD28…`) with the full number on hover and to screen readers; the record shows it in full with **Copy patient number** |
| 12 | Patients | Rows were tall, with the number far below the name; large initials | Name and number sit together; smaller initials; denser rows |
| 13 | Patients (phone) | The view switcher dropped "Discharged" onto a row of its own | Three equal segments on one row (words wrap inside) — also Reports and Notifications |
| 14 | Admitted list (phone) | Medical record and Discharge were stacked in a narrow right column | Both share a full-width row at the bottom of each card |
| 15 | Phones | Refresh and Back took a full row each on lists and records | Refresh becomes an icon button (same name for screen readers) beside search or Back |
| 16 | Registration | One button used browser validation bubbles and the other an in-app message; fields were not marked | The form validates itself: missing names are marked on the field with a message, focus moves to the first, plus the summary |
| 17 | Registration | The difference between Register patient and Register & admit was buried in a dense paragraph | Two short lines above the buttons; the intro keeps "search first" |
| 18 | Discharge | Patient, number, admission and room were crammed into one line; the consequence was vague | A Patient / Admission / Room summary, and "…remove them from Currently admitted. Their admission, room history, clinical records and medications stay in their history." |
| 19 | Clinical form | Save draft was only at the end of a long form | **Cancel** and **Save draft** stay pinned at the bottom of the dialog while scrolling |
| 20 | Clinical form | Draft versus Finalize was one long sentence | Two lines: Save draft (still editable); Finalize record (permanent medical record, corrections by amendment) |
| 21 | Staff & Access | Seven columns; staff numbers broke mid-word ("STF-TMWDBUNG / I"); headers wrapped | Six columns: email under the name, staff numbers kept on one line |
| 22 | Reports (phone) | The second report tab was cut off ("Admissions and d…") | Both tabs share the width and wrap their words |
| 23 | Tablets | At 768–1024 pixels list cards showed one fact per half-row and Refresh took its own row, like a stretched phone | Three facts per row in each card; search, filter and Refresh on one row |
| 24 | Medical Records | The admitted-patient search showed its magnifier above the input and bold typed text (the clinical pages' stacked-label style overrode the search box). Reported after the first review | The search keeps its own row layout everywhere; shorter placeholder "Search name, number or room…" |

### P3 — minor cosmetic issues

Fixed (9):

| # | Issue | Fix |
| --- | --- | --- |
| 25 | "Registered (UTC)" / "Archived (UTC)" labels | "Registered" / "Archived" |
| 26 | Notifications showed "In this view" beside the list's own result count | Only the unread total is summarised |
| 27 | Medical Records: Refresh sat on its own row under Filter records | On the same row |
| 28 | Staff Activity: search and role filter were misaligned (label above one only) | One row, same label style |
| 29 | Forgot-password help was a plain box | Icon and clearer layout, same words |
| 30 | Admission number broke across lines in the clinical form header | Kept together |
| 31 | Clinical form "Jump to" links wrapped with large gaps on phones | Tighter rows |
| 32 | Section headings ran into the first field label (Notes, Treatment) | Spacing added |
| 33 | The phone menu's unread badge used 11-pixel text | 12 pixels like other badges |

Remaining (10), accepted for client testing:

| # | Issue | Why it remains |
| --- | --- | --- |
| 34 | Patient numbers are long | Short numbers need a migration and a decision on existing numbers (see section 8) |
| 35 | Times show the device's time-zone name (for example "Africa/Accra") | Accurate and useful when devices differ; wording could be friendlier |
| 36 | "Updated Today, 09:10" on Staff Activity versus "Updated 09:10" on Overview | Both correct; harmless |
| 37 | Each activity line repeats its category tag | Helps when scanning a mixed list |
| 38 | Unread notifications use a tint, an edge and a badge | Clear; could be reduced later |
| 39 | Date and time pickers follow the device's language setting (for example mm/dd/yyyy) | Set by the browser, not the app |
| 40 | The clinical form says "Encounter time" | Familiar clinical term; kept to match records and reports |
| 41 | The iPhone install offer's button reads "Done" | Clear in context |
| 42 | Medication Catalog's button reads "Refresh list" where others read "Refresh" | Harmless |
| 43 | Reports repeat that days are UTC days | Deliberate while the hospital's time zone is confirmed |

## 4. What changed, by area

- **Sign in:** cleaner form, plain error wording without references for expected answers, clearer
  forgot-password help, an explanation when a session ends.
- **Temporary password:** matches sign-in, no stray box, distinct section title, shorter text;
  mandatory and cannot be skipped (unchanged).
- **Navigation:** Sign out in the phone menu; same role names everywhere; menu badge text size.
- **Overview:** the administrator's five cards on one row; shorter patient numbers in recent stays.
  The chart was rechecked (legend, tooltip, keyboard, data table, empty state, periods, refresh,
  dark mode, 320 pixels) and needed no change.
- **Patients:** denser list, short numbers, phone toolbars and switcher on one row, card actions
  side by side; the record shows the full number with a copy button and a written-out date of
  birth; on phones Change room and View admission share a row.
- **Registration and admission:** inline field errors, the two buttons explained; Register & admit
  continues straight into Admit patient.
- **Discharge:** summary of patient, admission and room; what happens next; the draft block still
  names the action and the record is one step away.
- **Clinical form and medicines:** pinned actions, plain Draft/Finalize guidance, spacing; the
  medicine picker (search, keyboard, no results, phones, dark mode) needed no change.
- **Staff & Access:** six columns, no broken staff numbers, "Administrator".
- **Staff Activity:** aligned filters, compact Refresh on phones; statuses stay in words.
- **Reports and Notifications:** tabs fit phones; one summary count.
- **Tablets:** list cards show three facts per row; toolbars stay on one row.

## 5. Screenshots reviewed

About 550 screenshots were captured: the baseline (1440 and 375 pixels, Light and Dark), the
same screens after the fixes, every screen at 320, 768 and 1024 pixels, and the final acceptance
run's captures for each role at 375 and 1440 pixels in both themes. All were checked automatically
(sideways overflow, small text, page errors: none after the fixes). About 30 representative
screens (sign-in, temporary password, each Overview, patient list and record, registration,
discharge, the clinical form, Staff & Access, Staff Activity, Reports and Notifications, in both
themes and at phone, tablet and desktop widths) were opened and inspected by eye for alignment,
spacing, oversized or clipped elements, margins, hierarchy, crowding and balance; the issues in
section 3 came from that inspection. Tablet layouts (768 and 1024) use the stacked-card lists and a
two- or three-column card grid, not a stretched phone layout; desktop pages keep content within
the panel width without large empty areas (except the top bar, which holds only Sign out).

## 6. Accessibility

- Automated checks (axe) found no serious or critical issues on sign-in (with an error and the
  forgot-password help shown), the temporary-password screen, each role's Overview, the patient
  record, the medical record, the clinical form (Dark), Staff & Access, Staff Activity, Medication
  Catalog, Reports and Notifications. Automated checks do not replace a screen-reader review on
  the hospital's devices.
- Keyboard: focus starts on the page title; Skip to main content works; every control shows a
  3-pixel outline; dialogs keep focus inside and close with Escape (asking first if something
  was typed); the phone menu closes with Escape and returns focus to the menu button; the chart
  and medicine picker work with arrow keys and Enter.
- Shortened patient numbers are read in full by screen readers; the copy button announces the
  result; registration errors are tied to their fields.
- Status is never colour alone (Admitted, Draft, Finalized, Active now, Recently active, Idle, Not
  signed in all show words).

## 7. Responsive and theme findings

No screen scrolls sideways for any role at 320, 375, 768, 1024, 1280 or 1440 pixels in Light, or
at 375 and 1440 pixels in Dark. Dialogs fit at 320 pixels and scroll inside themselves; the
medicine list stays on screen; the clinical form's actions stay visible. Dark mode was inspected
on every screen: cards, tables, dialogs, drop-down lists, the medicine picker, the chart and its
tooltip, activity statuses, notification states, the pinned form footer and the sign-in error and
help boxes all use the dark theme's colours. System follows the device setting.

## 8. Unresolved limitations

- **Short patient numbers** would need a migration (and a decision on existing numbers); this
  remains a future decision. Until then lists show the first part, search accepts any part, and
  the record offers Copy patient number.
- "Today" and chart days are UTC calendar days, as in Reports.
- The P3 items in section 3 marked as remaining.
- A real screen-reader walkthrough and a check on the hospital's own phones and browsers remain
  part of client testing (see the [release acceptance checklist](release-acceptance-checklist.md)).

## 9. Verification

| Check | Result |
| --- | --- |
| Prisma generate / validate | Passed |
| Typecheck (both workspaces) | Passed |
| Lint (both workspaces) | Passed |
| Server tests | 485 passed |
| Database tests | 801 passed (16 suites) |
| Client tests | 834 passed (44 files; 11 new tests for this phase's behaviour) |
| Builds (server and client) | Passed |
| `git diff --check` | Clean |
| Final browser acceptance | 83 of 83 checks passed on a fresh database (authentication 13, Medical Officer 22, Records Officer 8, Administrator 17, PWA 6, privacy 4, widths/themes/keyboard 8, checklist and run health 5) |

No migrations, dependencies or API changes were added; this release is client-only.

## 10. Readiness verdict

Ready for client testing. No P0 or P1 issues remain; every P2 issue found was fixed; the remaining
P3 items are cosmetic and listed above.
