# Step 16 — Final whole-product UI/UX review

This pass reviewed Medicare as one product, from sign-in to reports, for all three roles. It is a
consistency and polish pass. No backend contract, business rule or permission changed, and no
dependency was added.

**Later change:** the teal colour palette described here has since been replaced by the
client's original orange-and-white branding, with a matching dark theme. See
[branding and dark mode](branding-dark-mode.md). The structure, components and behaviour in this
review are unchanged; the token names stayed the same and now carry a light and a dark value.

## Areas reviewed

- **Sign-in and session screens:** sign-in, session check, session error, the render-error recovery
  screen and sign-out.
- **App shell:** desktop sidebar, mobile header and navigation drawer, breadcrumb, page header,
  page width, signed-in identity and sign-out.
- **Overview:** Admin, Records Officer and Doctor dashboards.
- **Patients:** directory, registration, detail, editing, archive and reactivation.
- **Appointments:** schedule, booking, detail, editing and rescheduling, status lifecycle and
  cancellation.
- **Medical Records:** list and history, draft editor, finalized record, amendments and
  finalization.
- **Notifications:** inbox, unread badge, detail and Admin broadcast.
- **Staff & Access:** directory, add staff, detail, role, status and session changes.
- **Reports:** patient, appointment and clinical activity reports, filters, charts and data tables.

## Before this pass

Every screen worked against the real API, but the screens had been built one module at a time
and it showed:

- **Branding:**
  - the sign-in screen said "Hospital Records System", the sidebar said "Hospital Records" and
    the browser tab said "medicare";
  - the tab icon was the Vite logo;
  - the mobile header, session screens and error screen had no wordmark.
- **Styling:** each feature stylesheet restated field, error, badge, empty-state and dialog
  styles, and the copies drifted.
- **Forms and dialogs:** fields, footers, button order and dialog sizes differed between modules.
- **Layout:** the appointment and clinical record views were flat lists of buttons and fields.
  The patient and staff views were more structured.

## Inconsistencies found

| Area | Finding |
|---|---|
| Focus | Three focus-ring colours, including an orange ring on the sign-in form only. |
| Fields | Two input border colours, both under 3:1 against white (1.3:1 and 1.7:1). The patient filter used a 15px font, so iOS zoomed in when it was focused. |
| Errors | Seven error box styles in four different reds. The support reference was as prominent as the message. Sign-in errors used an inline style. |
| Kickers and text | Section kickers used three letter-spacings at 11px. |
| Appointment statuses | No-show and Cancelled were the same red, and Confirmed and Completed the same green. Reports used different colours from the badges. |
| Badges | Patient, appointment, clinical, staff and notification badges each had their own padding and shape. |
| Dialog footers | Appointment and clinical dialogs used inline action rows instead of the shared footer, and labelled the dismiss button "Close" or "Close draft" instead of "Cancel". |
| Dialog sizes | Finalizing a record opened a 1,040px dialog for a two-line confirmation. |
| Loading | Some lists showed plain text, others a skeleton. |
| Empty states | Appointment and clinical lists used a plain sentence with no next action. |
| Pagination | Two pager designs. Empty lists still showed "0 results" with disabled buttons. |
| Required fields | The patient form marked required fields with "*"; the other forms marked optional ones. |
| Dead or loose controls | An unstyled "Retry patients" button. "Reload doctors" always showed in the schedule filters. A sign-in button with an external-link arrow. |
| Accessibility | The patient phone field announced a description that did not exist. The sign-in page had no `h1` below 900px. |
| Navigation | The menu said "Staff" while the page said "Staff & Access". Choosing Staff & Access, Medical Records or Notifications again from the menu kept the current detail view open instead of returning to the list. |
| Repetition | Every page repeated the role above its title, and the sidebar repeated the role again. The patient record showed the registration date twice. |
| Unconfirmed saves | Patient registration, new clinical drafts and broadcasts are protected against duplicates. Their messages still told staff to close the form and search before trying again. |
| Copy | Some messages used developer words: "server time", "request size limit" and "medical records module". |
| Leftovers | Template images (`hero.png`, `react.svg`, `vite.svg`), a public `icons.svg` with social-network icons, and unused components (`Unavailable`, an old `Pagination`, Google and Apple sign-in marks). |

## Visual system decisions

Shared styling lives in `client/src/styles/App.css`. Each feature stylesheet now holds only its
own layout, and a test keeps field, error and focus colours out of them.

**Tokens** (a small, named set):

- **Surfaces:** `bg`, `surface`, `surface-muted`, `surface-sunken`.
- **Text:** `deep` for headings and values, `ink` for body text, `muted` for supporting text.
- **Lines:** `line`, `line-strong`, and `field-border` (3:1 or more in both themes).
- **Brand:** `brand`, `brand-strong`, `brand-soft`, `brand-line` and `link`, now orange, plus
  `brand-accent` for marks and `brand-mark` for the logo.
- **Status:** `success`, `warning`, `danger`, `info` and `neutral`, each with a background and a
  border colour.
- **Focus:** one focus colour everywhere.
- **Shape and depth:** radii of 8, 12 and 16px, 6px badges, and two shadows.
- **Type sizes:** 12, 13 and 14px. Body text is 15px.

A test checks the contrast of every text token on every surface (at least 4.5:1) and of the field
border (at least 3:1), in both the light and the dark theme.

**Typography:**

| Element | Size | Weight |
|---|---|---|
| Page title | 26–32px | 700 |
| Section title | 20px | 700 |
| Card or sub-section title | 16px | 700 |
| Body | 15px | normal |
| Supporting copy and labels | 14px | labels 600 |
| Helper text and metadata | 13px | normal |
| Table headers, kickers and status labels | 12px | 700, uppercase where they label |

Clinical narrative is set at a 76-character measure with 1.7 line height.

**Buttons:**

- **Primary:** filled brand.
- **Secondary:** outlined.
- **Tertiary:** underlined link style.
- **Danger:** filled rose-crimson, clearly different from the orange primary, used for the final
  confirmation only.
- **Quiet danger:** red outline, used to start a destructive action.
- **Caution:** amber outline, used for staff suspension and signing out sessions.
- **Icon:** 44px square.

Every control is at least 44px tall and shares the focus ring and disabled state. Pending
buttons change their label, for example "Saving…" or "Finalizing…".

**Badges:** a 6px-radius badge with the status word, a small marker and a semantic tone. Staff
badges keep their icons. Tags (role, notification type, "Your account") are outlined.

| Tone | Statuses |
|---|---|
| Success | Active patient or staff account, Completed, Finalized |
| Info | Scheduled, Pending, Unread |
| Warning | Draft, Suspended, No-show |
| Danger | Cancelled, Disabled |
| Neutral | Archived, Read, Voided |
| Teal | Confirmed |
| Violet | Checked in |

The appointment report's status markers use the same six tones, and a test enforces that.

**Cards:** dashboard, report, staff and workspace cards share a 12px radius, the line border and
16–20px padding. On narrow screens, patient and appointment table rows become bordered cards that
match the staff cards.

**Tables:** one header treatment (muted background, 12px uppercase labels), the same row padding,
hover and focus row highlight, and wrapping instead of truncation.

**Dialogs:**

- **Sizes:** compact (540px) for confirmations, standard (680px) for forms, wide (980px) for the
  clinical editor.
- **Footer:** every dialog uses the shared footer, with Cancel (or Keep appointment) first and one
  primary or danger action last. On phones the action stacks above Cancel at full width.
- **Warnings:** shown in the same warning callout across modules.

**Feedback:**

- **Errors:** one box with a left accent; the support reference is smaller and grey.
- **Success:** one green notice style with specific wording, such as "Patient registered.",
  "Appointment booked.", "Draft saved.", "Clinical record finalized." and "Broadcast sent to 5
  active staff members." (the count comes from the server)
- **Callouts:** information, warning, danger, neutral and brand callouts share one shape.
- **Loading:** one contained placeholder, a short status line with row shapes. Its gentle pulse
  stops when reduced motion is requested.
- **Empty states:** a dashed panel with an icon, a message and, where the role allows, a next
  action.

**Brand:** one `Brand` lockup, "Medicare" with "Hospital Records" beneath, used on sign-in, in the
sidebar, the mobile header, the session check and error screens, and the recovery screen. The
favicon is the same mark, in the client's original orange (`#f97316`), and the tab title is
"Medicare – Hospital Records". Nothing loads from a remote server.

## Fixes by area

**Shell and navigation:**

- Menu, breadcrumb and page title use the same names, including "Staff & Access" and "Medical
  Records".
- The breadcrumb shows detail views, for example "Patients / Patient record".
- Page headers are a title and one sentence, phrased for the role where it differs.
- The active item has a left indicator, and badges sit at the end of the row.
- The sidebar ends with the signed-in person's initials, name and role. The mobile header shows
  the wordmark, and the mobile drawer shows the same identity.
- Choosing a workspace from the menu always opens its main view.

**Sign-in:**

- One `h1` at every width.
- Plain "Sign in" and "Signing in…" button text.
- No inline styles, and the shared focus ring and error box.

**Overview:**

- **Admin and Records Officer:** the sections are "Current status" and "Hospital activity".
- **Doctor:** the sections are "My current workload" and "My activity".
- **Current-status cards:** an accent line, so the live snapshot reads differently from the period
  figures.
- **Shortcuts:** grouped under "Your workspaces".

**Patients:**

- **Record header:** a "Patient record" header with the archive status beside the name and the
  patient number as an identifier chip.
- **Archived patients:** an explanatory note.
- **Demographics:** one card.
- **Doctors:** a highlighted "View clinical history" entry point.
- **Actions:** separated by a rule.
- **Archive confirmation:** a compact warning dialog.

**Appointments:**

- **Toolbar:** Refresh and Reset share one row, and empty results offer a reset or a booking.
- **Detail header:** reference and status, then the date and time with duration, type and time zone.
- **Facts:** patient, clinician, reason and notes.
- **Next step:** guidance with the lifecycle actions. The main step is primary and No-show is a
  quiet danger button.
- **Manage booking:** a separate section for editing and cancelling.
- **Booking form:** "Book appointment" with Cancel.

**Medical Records:**

- **List:** a card per record, with its status beside the reference, under the same section
  label as the other module panels.
- **New encounter button:** hidden while a record is open, so the record's own action is the only
  primary one.
- **Record view:**
  - a header with the patient and time, and its actions in the header;
  - read-only state shown as a callout;
  - content in clinical order (complaints, history summary, clinical notes, diagnoses, treatment
    plan), each in its own labelled block;
  - amendments shown as a separate permanent history.
- **Editor:** wide, with Cancel and Save draft.
- **Confirmations:** finalization uses a compact warning dialog.

**Notifications:**

- Same badge and segmented-control styles as the rest of the product.
- Unread items keep a restrained left indicator.
- The broadcast wording is updated (see below).

**Staff & Access:**

- The identity card no longer repeats the role and status, which the header and sections already
  show.
- Risky actions keep their caution and danger styling in separate sections.

**Reports:**

- "Show data table" is a disclosure with a chevron, and the data table matches the other tables.
- Charts are slightly shorter, with consistent 12px axis labels.
- The two report sections are separated by a rule.

### Unconfirmed saves

| Save | Message after a network failure or server error |
|---|---|
| Patient registration | Select **Register patient** again without changing anything; the patient will not be registered twice. |
| New clinical draft | Select **Save draft** again without changing anything; the draft will not be saved twice. |
| Broadcast | Select **Send broadcast** again without changing anything; it will not be sent twice. |
| Amendment | Select **Add permanent amendment** again without changing anything; an identical amendment is never added twice. |
| Finalization | Refresh the record to check its status. A record cannot be finalized twice. |
| Patient changes, patient status, draft edits, appointments | The save may already have happened. Check before trying again (unchanged). |

## Mock, placeholder and dead-control audit

Production client code was searched for mock, dummy, sample, placeholder, TODO, "coming soon"
and "not available":

- The remaining hits are the word "demographic", one real appointment error message, and five
  input placeholder hints, which are legitimate.
- No customer-visible unfinished feature remains.
- Every visible control works, or is disabled with a reason beside it (for example "Available at
  the scheduled start time").
- The unused template images, the social-icon sprite, the `Unavailable` panel, the old pagers and
  the Google and Apple marks were deleted.

## Removed and replaced files

Earlier step documents list some files that this pass removed or replaced:

| Removed | Replacement |
|---|---|
| `features/appointments/AppointmentPagination.tsx` | `components/ui/Pagination.tsx`, used by every list |
| `features/patients/PatientPagination.tsx` | `components/ui/Pagination.tsx`, used by every list |
| `components/ui/Unavailable.tsx` | Removed. Every module is now real. |
| `src/assets/hero.png`, `react.svg`, `vite.svg` | Removed. They were unused template files. |
| `public/icons.svg` | Removed. It was an unused template sprite. |

The template `public/favicon.svg` is replaced by the Medicare mark. `components/ui/LoadingRows.tsx`
and the `Brand` lockup in `components/branding/BrandMarks.tsx` are new.

## Responsive results

The live walkthrough opened every major screen for each role at 320, 375, 768, 1024 and 1440px:

- **Admin (12 screens):** Overview, Patients, patient record, Appointments, appointment detail,
  Notifications, notification detail, broadcast, Staff & Access, staff detail, Add staff and
  Reports.
- **Records Officer (6):** Overview, the registration form, archive confirmation, the booking
  form, cancellation and Reports.
- **Doctor (9):** Overview, appointments, the checked-in appointment with its clinical link, the
  patient record, Medical Records, the finalized record, the draft editor, finalize confirmation
  and Reports.
- **Sign-in.**

On each one it checked:

- no horizontal page scroll and no element outside the viewport;
- no "undefined" or "NaN" text;
- every control at least 44px tall;
- dialogs inside the viewport, with every control reachable.

The phone drawer was checked for each role: it is anchored to the left edge at full height, shows
every workspace, marks the active one and shows the signed-in identity. The page behind it is
inert, and Escape closes it and returns focus to the menu button.

## Accessibility results

- **Automated check:** axe-core (WCAG 2.0, 2.1 A and AA) ran on every screen above at 1440px and
  320px, and on sign-in at 1440px and 375px. It reported no serious or critical violations.
- **Regression tests:**
  - every announced field description must exist;
  - sign-in has one `h1`;
  - every dialog footer is ordered Cancel first, with the right size;
  - text and field-border contrast meets the minimums.
- **Earlier keyboard work still applies:** the focus trap, background inertness, report tab arrow
  keys and focus returning after dialogs.
- **Screen readers:** chart summaries and data tables are unchanged. No screen-reader
  certification is claimed; the product has not been tested with a screen reader in this pass.

## Role walkthrough results

All runs used disposable synthetic data on a fresh database (`medicare_test_polish`). The seed was
5 staff accounts besides the bootstrap administrator, 12 patients (one with a very long name,
one archived), appointments in all six statuses, a linked draft, a finalized walk-in record with
three complaints, two diagnoses and two amendments, another doctor's draft, and a broadcast.

| Role | Walked through | Result |
|---|---|---|
| Admin | Overview, Patients, Appointments, Notifications and broadcast, Staff & Access, Reports, sign-out | Coherent. No dead controls, no fake figures, and no clinical content anywhere. |
| Records Officer | Overview, Patients (register, archive), Appointments (book, cancel), Reports, sign-out | Coherent. No clinical content, and no Staff & Access. |
| Doctor | Overview, own appointments, appointment-to-clinical entry, patient clinical entry, Medical Records, finalized record, editor, finalization, Reports, sign-out | Coherent. Clinical actions are easy to find, and authorship and finalization rules are unchanged. |

The walkthrough also checked request hygiene:

- signing in loads the dashboard once and the unread count once;
- Reports and Staff & Access read once, with no refetch loop;
- sixteen idle seconds send no requests;
- the console shows no warnings or errors;
- no page errors, failed requests, unexpected HTTP errors or browser storage.

The final full run passed 448/448 checks on the production build behind HTTPS, using the
restricted runtime database role. After two last Medical Records adjustments, the doctor screens
were run again: 154/154. Midway through, the operating system stopped the test processes and the
database server together. The cluster was restarted, recovered cleanly and kept the seeded data,
and the walkthrough was repeated in full.

Screenshots of every screen at 1440px and 375px were reviewed. These issues were caught in review
and fixed before the final runs:

- a second primary button ("Choose patient for new encounter") above an open clinical record;
- the registration date shown twice on the patient record;

- segmented buttons had dropped to 40px during the restyle;
- the phone navigation drawer floated in the centre instead of sliding from the left, also
  introduced by the restyle.

## Verification

- **Tests:** 2,050 tests across 60 files: 784 client (36 files), 505 server unit (13) and 761
  database (11). The baseline was 2,028 across 59.
- **New tests:** 22, in `client/tests/ui-consistency.test.tsx`.
- **Updated tests:** existing tests were updated only where labels or wording changed on purpose.
  None were removed or weakened.
- **Checks:** install, Prisma generate and validate, typecheck, lint (no warnings), build and
  `git diff --check` pass. Every database suite deploys all nine migrations twice.

## Remaining cosmetic issues

- Server-generated patient numbers and appointment references are long and wrap inside narrow
  cards. The identifier chip keeps them readable, but shorter references would be a backend
  decision.
- Date and time inputs use the browser's own picker and format, which differ between browsers.
- On phones the menu badge can overlap the menu button's corner by design. It stays inside the
  header.

## Remaining product limitations

These are unchanged by this pass:

- no exports or printing;
- reports use UTC calendar dates only;
- the dashboard shows no trends or comparisons;
- unsaved text is held only in memory;
- no realtime updates;
- only Chrome was walked through live in this pass, although earlier steps also covered Firefox,
  WebKit and Edge;
- see the [release readiness report](release-readiness-report.md) for operational requirements.
