# Customer release acceptance checklist

Release candidate: Step 14, prepared 4 November 2026. Hospital/customer: __________

Representative and role: __________  Demonstration date: __________

Demonstrate every row with synthetic (made-up) data, never real patients. Mark one outcome per row and record any required change, owner and due date at the end. A row left unmarked is not accepted. Signing this form does not authorize production use until the prerequisites in the [release readiness report](release-readiness-report.md) are closed.

## Authentication

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Each staff member signs in with their own account and sees only the screens for their role | [ ] | [ ] | [ ] |
| Refreshing the page keeps the user signed in; signing out returns to the sign-in screen | [ ] | [ ] | [ ] |
| When a session expires or is revoked, the next action returns to sign-in and nothing is saved by mistake | [ ] | [ ] | [ ] |
| Repeated failed sign-ins are temporarily limited; correct sign-ins by many staff at shift change are not blocked | [ ] | [ ] | [ ] |

## Patient management

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Search by name, patient number or phone; register, edit, archive and reactivate a patient | [ ] | [ ] | [ ] |
| Duplicate warning appears when name, date of birth and phone match an existing patient | [ ] | [ ] | [ ] |
| Archiving keeps the record; archived patients are found with the archived filter | [ ] | [ ] | [ ] |
| Two staff editing different details of the same patient do not overwrite each other | [ ] | [ ] | [ ] |

## Appointments

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Book with patient and doctor lookup; times shown and saved in the workstation's local time | [ ] | [ ] | [ ] |
| Overlapping bookings for a doctor or patient are refused with a clear message | [ ] | [ ] | [ ] |
| Reschedule, confirm, check in (from 60 minutes before start) and complete a visit | [ ] | [ ] | [ ] |
| Cancellation keeps the appointment and its reason in the history | [ ] | [ ] | [ ] |
| Doctors see only their own appointments and cannot book, reschedule or cancel | [ ] | [ ] | [ ] |

## Clinical records

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| A doctor starts a record from a checked-in appointment, saves a draft, reloads and continues it | [ ] | [ ] | [ ] |
| Multiple complaints and diagnoses are kept in the order entered | [ ] | [ ] | [ ] |
| Finalizing makes the original record read-only; it cannot be changed from any screen or a second tab | [ ] | [ ] | [ ] |
| Corrections are separate, permanent amendments shown alongside the unchanged original | [ ] | [ ] | [ ] |
| Clinical history opens from the patient record; other doctors can read but not change it | [ ] | [ ] | [ ] |

## Privacy and security expectations

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Administrators and Records Officers cannot see clinical content | [ ] | [ ] | [ ] |
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
| Appointment, clinical, patient, staff and notification statuses read the same way wherever they appear | [ ] | [ ] | [ ] |
| After an unconfirmed save, staff follow the on-screen instruction: resubmit the unchanged form where it says that is safe, otherwise check first | [ ] | [ ] | [ ] |

## Notifications

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Each staff member sees only their own notifications, with an unread count that matches the inbox | [ ] | [ ] | [ ] |
| Opening a notice marks it read; mark all as read keeps every notice in the inbox | [ ] | [ ] | [ ] |
| A doctor's appointment notice opens the correct appointment, and a reassigned appointment is refused safely | [ ] | [ ] | [ ] |
| Only administrators can send broadcasts, to all active staff or one role, with the recipient count shown | [ ] | [ ] | [ ] |
| New notices appear on refresh or navigation; there is no automatic live update | [ ] | [ ] | [ ] |

## Staff administration

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Only administrators see Staff & Access; Records Officers and Doctors cannot open it or use the staff API | [ ] | [ ] | [ ] |
| An administrator adds a staff account with the institution staff number and an initial password delivered through the approved secure channel | [ ] | [ ] | [ ] |
| A duplicate email or staff number is refused with a clear message and nothing is created | [ ] | [ ] | [ ] |
| Changing a role signs the person out everywhere, and they sign in again with the new role's screens | [ ] | [ ] | [ ] |
| Suspending signs the person out and blocks sign-in; reactivating lets them sign in again | [ ] | [ ] | [ ] |
| Sign out all sessions signs the person out on every device without changing their status | [ ] | [ ] | [ ] |
| Disabling asks for explicit confirmation, is permanent, and the account cannot sign in again | [ ] | [ ] | [ ] |
| The last active administrator cannot be demoted, suspended or disabled | [ ] | [ ] | [ ] |
| Missing password reset, name/email edits and staff search are understood and covered by a local procedure | [ ] | [ ] | [ ] |

## Overview and reports

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Each role's Overview shows only its own figures; doctors see only their own appointments and clinical work | [ ] | [ ] | [ ] |
| Current status counts are understood to be live and separate from the selected activity period | [ ] | [ ] | [ ] |
| Patient and appointment report figures were checked against the patient directory and schedule for a known period | [ ] | [ ] | [ ] |
| Cancellation and no-show rates, and counts by current appointment status, are understood | [ ] | [ ] | [ ] |
| Reporting periods use UTC calendar dates, with Monday-start weeks; this suits the hospital's reporting | [ ] | [ ] | [ ] |
| A doctor's clinical activity report shows only their own counts, with no clinical text, and its views are audited | [ ] | [ ] | [ ] |
| Report exports, printing and downloads are understood to be not delivered | [ ] | [ ] | [ ] |

## Known limitations

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Same-field edits by two people: the later save wins, with no warning | [ ] | [ ] | [ ] |
| After an interrupted connection, saving the same open form again returns the first record rather than a duplicate patient, walk-in draft or broadcast; a new form is a new request | [ ] | [ ] | [ ] |
| All limitations in the readiness report reviewed, with an owner and date for each | [ ] | [ ] | [ ] |

## Training

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Staff guide issued and supervised practice completed with synthetic data | [ ] | [ ] | [ ] |
| Support contact, escalation route and downtime procedure agreed | [ ] | [ ] | [ ] |

## Operations prerequisites

| Acceptance statement | Accepted | Needs change | Not applicable |
|---|:---:|:---:|:---:|
| Secure deployment (HTTPS, separate restricted database account, proxy settings) verified on the real hostname | [ ] | [ ] | [ ] |
| Monitoring and alert recipients in place | [ ] | [ ] | [ ] |
| Backup owner named; a restore from a real backup rehearsed and verified | [ ] | [ ] | [ ] |
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
