# Customer release acceptance checklist

Release candidate: Step 14, prepared 4 November 2026; updated for admissions and discharge (Phase 19A). Hospital/customer: __________

Representative and role: __________  Demonstration date: __________

Demonstrate every row with synthetic (made-up) data, never real patients. Mark one outcome per row and record any required change, owner and due date at the end. A row left unmarked is not accepted. Signing this form does not authorize production use until the prerequisites in the [release readiness report](release-readiness-report.md) are closed.

## Authentication

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Each staff member signs in with their own account and sees only the screens for their role | [ ] | [ ] | [ ] |
| Refreshing the page keeps the user signed in; signing out returns to the sign-in screen | [ ] | [ ] | [ ] |
| When a session expires or is revoked, the next action returns to sign-in and nothing is saved by mistake | [ ] | [ ] | [ ] |
| Sign-in explains an ended session ("Your session has ended. Sign in again to continue."); a wrong password gives plain guidance without codes or references | [ ] | [ ] | [ ] |
| The temporary-password screen matches the sign-in page and cannot be skipped; Forgot your password? tells staff to contact the system administrator | [ ] | [ ] | [ ] |
| Repeated failed sign-ins are temporarily limited; correct sign-ins by many staff at shift change are not blocked | [ ] | [ ] | [ ] |

## Patient management

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Search by name or patient number; register (names and date of birth, no phone), edit, archive and reactivate a patient | [ ] | [ ] | [ ] |
| Staff search before registering; the duplicate warning needs a phone number and so rarely appears | [ ] | [ ] | [ ] |
| Archiving keeps the record; archived patients are found with the archived filter; a currently admitted patient cannot be archived | [ ] | [ ] | [ ] |
| Patients shows All patients, Currently admitted and Discharged views | [ ] | [ ] | [ ] |
| Two staff editing different details of the same patient do not overwrite each other | [ ] | [ ] | [ ] |

## Admissions and discharge

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Register & admit continues straight into the admission; the stay gets an AD- number, room and time in the workstation's local time | [ ] | [ ] | [ ] |
| Admin, Records Officer and Medical Officer can admit and change rooms; only the Medical Officer can discharge | [ ] | [ ] | [ ] |
| A second admission of an admitted patient is refused with "This patient is already admitted." and offers the current admission | [ ] | [ ] | [ ] |
| A room change keeps the earlier rooms in the room history, with the transfer note | [ ] | [ ] | [ ] |
| Discharge shows its consequence, is refused while a clinical record is a draft, and keeps the draft | [ ] | [ ] | [ ] |
| After discharge the patient shows "Not currently admitted", the stay is under Previous admissions, and nothing is deleted or archived | [ ] | [ ] | [ ] |
| Re-admission creates a new stay on the same patient record | [ ] | [ ] | [ ] |
| Appointments no longer appear anywhere; the hospital has handled the appointments that were still scheduled at upgrade | [ ] | [ ] | [ ] |

## Clinical records

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Medical Records lists currently admitted patients; a Medical Officer opens one, writes a record on the admission, saves a draft, reloads and continues it | [ ] | [ ] | [ ] |
| Medicines are chosen from a searchable list (typing, keyboard and touch), with strength, dose, route, frequency, duration and instructions; orders are locked on finalizing | [ ] | [ ] | [ ] |
| The initial medication list (the previous system's sixteen medicines, two spellings standardised) has been reviewed and the hospital's other medicines added | [ ] | [ ] | [ ] |
| Draft orders can be edited and removed; the same medicine twice gives a warning; a deactivated medicine is no longer offered but stays in history | [ ] | [ ] | [ ] |
| Medication history shows the current admission first and previous admissions separately, with prescriber and date, after discharge too | [ ] | [ ] | [ ] |
| Only administrators manage the Medication Catalog (add, deactivate, reactivate; no delete); this gives them no access to prescriptions | [ ] | [ ] | [ ] |
| No new record can be started for a patient who is not admitted; older records remain readable | [ ] | [ ] | [ ] |
| Multiple complaints, diagnoses and medications are kept in the order entered | [ ] | [ ] | [ ] |
| Finalizing makes the original record read-only; it cannot be changed from any screen or a second tab | [ ] | [ ] | [ ] |
| Corrections are separate, permanent amendments shown alongside the unchanged original | [ ] | [ ] | [ ] |
| Clinical history opens from the patient record; other Medical Officers can read but not change it | [ ] | [ ] | [ ] |

## Privacy and security expectations

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Administrators and Records Officers cannot see clinical content, medications or discharge notes | [ ] | [ ] | [ ] |
| No patient or clinical information, password or session token is stored in the browser | [ ] | [ ] | [ ] |
| Unsaved clinical text is discarded on session loss rather than kept on the workstation | [ ] | [ ] | [ ] |
| Shared-workstation practice agreed (sign out, own account only) | [ ] | [ ] | [ ] |
| When a save cannot be confirmed, staff are told to check the record before trying again | [ ] | [ ] | [ ] |

## Responsive usability

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Workflows are usable on the hospital's actual phones, tablets and desktops | [ ] | [ ] | [ ] |
| Keyboard-only use works for sign-in, forms, dialogs and the clinical editor | [ ] | [ ] | [ ] |
| Staff who use assistive technology have tried the workflows on deployment devices | [ ] | [ ] | [ ] |
| Named browser versions used by the hospital have been tried (list below) | [ ] | [ ] | [ ] |
| Screens look and behave as one product: the same Medicare wordmark, buttons, badges, dialogs and messages in every module | [ ] | [ ] | [ ] |
| Admission, clinical, patient, staff and notification statuses read the same way wherever they appear | [ ] | [ ] | [ ] |
| After an unconfirmed save, staff follow the on-screen instruction: resubmit the unchanged form where it says that is safe, otherwise check first | [ ] | [ ] | [ ] |
| Light, Dark and System themes are readable on hospital devices, including saved-password autofill on the sign-in screen in Dark | [ ] | [ ] | [ ] |
| Phone menu lists every workspace for the role and has Sign out; segment controls and report tabs stay on one row; no screen scrolls sideways at 320 px | [ ] | [ ] | [ ] |
| Long patient numbers are readable: lists show the first part (full number on hover and to screen readers), the patient record shows it in full with Copy patient number | [ ] | [ ] | [ ] |
| Dates of birth are written out (for example 8 September 1968) and match the patient's documents | [ ] | [ ] | [ ] |
| Missing registration names are marked on the field; the clinical form keeps Cancel and Save draft visible while scrolling | [ ] | [ ] | [ ] |
| Roles read Administrator, Records Officer and Medical Officer on every screen | [ ] | [ ] | [ ] |

## Notifications

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Each staff member sees only their own notifications, with an unread count that matches the inbox | [ ] | [ ] | [ ] |
| Opening a notice marks it read; mark all as read keeps every notice in the inbox | [ ] | [ ] | [ ] |
| Admissions, room changes and discharges send no notices; older appointment notices show as Past appointment and open nothing | [ ] | [ ] | [ ] |
| Only administrators can send broadcasts, to all active staff or one role, with the recipient count shown | [ ] | [ ] | [ ] |
| New notices appear on refresh or navigation; there is no automatic live update | [ ] | [ ] | [ ] |

## Staff administration

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Only administrators see Staff & Access; Records Officers and Medical Officers cannot open it or use the staff API | [ ] | [ ] | [ ] |
| An administrator adds a staff account with the institution staff number and an initial password delivered through the approved secure channel | [ ] | [ ] | [ ] |
| A duplicate email or staff number is refused with a clear message and nothing is created | [ ] | [ ] | [ ] |
| Changing a role signs the person out everywhere, and they sign in again with the new role's screens | [ ] | [ ] | [ ] |
| Suspending signs the person out and blocks sign-in; reactivating lets them sign in again | [ ] | [ ] | [ ] |
| Sign out all sessions signs the person out on every device without changing their status | [ ] | [ ] | [ ] |
| Staff Activity (administrators only) lists who is signed in with Active now / Recently active / Idle, matching the agreed 5- and 30-minute definitions | [ ] | [ ] | [ ] |
| Recent staff activity shows actions in plain words and never shows clinical details, medicines, rooms or which patient was involved | [ ] | [ ] | [ ] |
| An administrator can end one session (that device must sign in again) or sign a person out everywhere, after confirmation | [ ] | [ ] | [ ] |
| Staff & Access shows Last active and Last signed in, or Never signed in, for each account | [ ] | [ ] | [ ] |
| The hospital agrees Staff Activity is used for operations and support, in line with its staff privacy policy | [ ] | [ ] | [ ] |
| Disabling asks for explicit confirmation, is permanent, and the account cannot sign in again | [ ] | [ ] | [ ] |
| The last active administrator cannot be demoted, suspended or disabled | [ ] | [ ] | [ ] |
| An administrator resets a forgotten password and sets a pending account's first password; the person is signed out everywhere and only the new password works | [ ] | [ ] | [ ] |
| Staff change their own password from the menu with their current password and are asked to sign in again | [ ] | [ ] | [ ] |
| A new or reset account signs in only to "Change your temporary password"; no workspace is reachable until a personal password is chosen, then sign-in works normally | [ ] | [ ] | [ ] |
| "Forgot your password?" on sign-in shows the contact-your-administrator guidance, and the hospital's identity-check procedure for resets is agreed | [ ] | [ ] | [ ] |
| After the first sign-in with a personal password, Medicare offers installation once; Not now goes straight to the workspace | [ ] | [ ] | [ ] |
| Medicare installs and opens in its own window on the hospital's devices (Chrome/Edge install; iPhone/iPad Add to Home Screen) | [ ] | [ ] | [ ] |
| With the network off, Medicare shows the connection-required screen and no records; Retry works after reconnecting | [ ] | [ ] | [ ] |
| An update notice appears after a release and never reloads over an open form | [ ] | [ ] | [ ] |
| Missing name/email edits, staff search and emailed password reset are understood and covered by a local procedure | [ ] | [ ] | [ ] |

## Overview and reports

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Each role's Overview shows four cards for today: Currently admitted, Admissions today and Discharges today for all; Total patients for Admin and Records; My unfinished records for Medical Officers | [ ] | [ ] | [ ] |
| The admissions and discharges chart matches the Patients lists for a known week (Last 7 days, Last 30 days and This month checked) | [ ] | [ ] | [ ] |
| The chart and cards update by themselves within a minute of an admission or discharge (or at once with Refresh), and contain counts only | [ ] | [ ] | [ ] |
| The chart can be read without colour (solid line with dots for admissions, dashed line with squares for discharges), with the keyboard and as a data table | [ ] | [ ] | [ ] |
| Patient search finds a patient by full name (for example first and last name together) and by patient number, so staff check before registering | [ ] | [ ] | [ ] |
| The patient record shows name, number, Admitted/Not admitted and the room at the top, with Open medical record, Change room and Discharge patient right below | [ ] | [ ] | [ ] |
| Patient registration and admissions report figures were checked against the Patients views for a known period | [ ] | [ ] | [ ] |
| Admissions count by admission time and discharges by discharge time, so one stay can fall in two periods | [ ] | [ ] | [ ] |
| Reporting periods use UTC calendar dates, with Monday-start weeks; this suits the hospital's reporting | [ ] | [ ] | [ ] |
| The Medical Officer has no Reports menu; their unfinished records count is on their Overview | [ ] | [ ] | [ ] |
| Report exports, printing and downloads are understood to be not delivered | [ ] | [ ] | [ ] |

## Known limitations

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Same-field edits by two people: the later save wins, with no warning | [ ] | [ ] | [ ] |
| After an interrupted connection, saving the same open form again returns the first record rather than a duplicate patient, admission, draft or broadcast; a new form is a new request | [ ] | [ ] | [ ] |
| All limitations in the readiness report reviewed, with an owner and date for each | [ ] | [ ] | [ ] |
| The remaining interface limitations in the [final product UI/UX review](final-product-ui-ux-review.md) (long patient numbers pending a migration decision, UTC days, browser-locale date pickers) are accepted | [ ] | [ ] | [ ] |

## Training

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Staff guide issued and supervised practice completed with synthetic data | [ ] | [ ] | [ ] |
| Support contact, escalation route and downtime procedure agreed | [ ] | [ ] | [ ] |

## Operations prerequisites

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Secure deployment (HTTPS, separate restricted database account, proxy settings) verified on the real hostname | [ ] | [ ] | [ ] |
| Runtime grants applied with `server/ops/runtime-grants.sql`; the runtime account owns nothing and is not the migration owner | [ ] | [ ] | [ ] |
| Frontend served with the runbook's Content-Security-Policy and cache headers; the session cookie shows `__Host-`, HttpOnly, Secure and SameSite=Strict | [ ] | [ ] | [ ] |
| Daily `sessions:prune` and `idempotency:prune` jobs scheduled, with alerts on failure | [ ] | [ ] | [ ] |
| `/sw.js`, `/manifest.webmanifest` and `/icons/*` served with `no-cache` (manifest as `application/manifest+json`); browser storage holds only static `medicare-static-*` caches, never API data | [ ] | [ ] | [ ] |
| Monitoring and alert recipients in place | [ ] | [ ] | [ ] |
| Backup owner named and the runbook's backup decisions table completed; a restore from a real backup rehearsed and verified with `restore-check.sql` | [ ] | [ ] | [ ] |
| Retention, legal hold and disposal decisions assigned to named hospital owners | [ ] | [ ] | [ ] |

## Customer acceptance

Required changes / exceptions / owner / due date:

________________________________________________________________

Named supported browser/device combinations: ______________________

Support contact and escalation route: ____________________________

Backup/restore owner and approved recovery objectives: ____________

Customer decision: [ ] Accept the scoped release once prerequisites are closed  [ ] Needs changes

Representative signature: __________  Date: __________

Delivery owner confirmation that prerequisites are closed: __________  Date: __________
