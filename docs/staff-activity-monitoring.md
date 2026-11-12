# Staff Activity — Phase 19D

**Staff Activity** lets an administrator answer operational questions: who is signed in now, who
signed in recently, when each person last used the system, and what major actions they took. It is
for running the hospital system (for example finding a browser left signed in on a shared
computer, or following up a workflow problem), not for watching individuals. It shows no clinical
content and no patient identifiers.

Only administrators can see it. The server enforces this on every route; hiding the menu item is
not the protection.

## What an administrator sees

**Staff Activity** sits in the administrator's menu after Staff & Access.

- **Active staff**: one row per signed-in person with name, staff number, role, when they signed
  in, when they were last active, a status and the number of sessions (browsers or devices).
  **View activity** opens that person.
- **Recent staff activity**: plain sentences such as "Signed in", "Registered a patient", "Admitted
  a patient", "Finalized a clinical record", "Reset Kofi Asante’s password", newest first, 25 per
  page. Choose **Today** (default), **Last 7 days** or **Last 30 days**, and a kind of activity: all,
  Sign-in and sign-out, Patients, Admissions, Clinical records, Staff administration or Medication
  catalog.
- **Search and role** at the top filter both lists by staff name, staff number or role.
- **A person's activity**: role, account status, **Last signed in** (or "Never signed in"),
  **Last active**, each current session with its sign-in time, last activity and end time, their
  recent activity, **End session** for one session and **Sign out everywhere**.
- **Staff & Access** shows a **Last active** column (with the last sign-in under it, or "Never
  signed in"), and each account shows Last signed in, Last active and **View activity and
  sessions**.
- The administrator's **Overview** has a **Staff active now** card with the number signed in today.

The page refreshes itself once a minute while it is open and visible, and has a **Refresh** button.

## Status definitions

| Status | Meaning |
| --- | --- |
| **Active now** | The person made a request to the system in the last **5 minutes** |
| **Recently active** | Their last request was 5 to **30 minutes** ago |
| **Idle** | Still signed in, but no request for more than 30 minutes |
| **Not signed in** | No valid session: signed out, signed out by an administrator, expired (8 hours), or the account is no longer active |

A person with several sessions takes the most recent status. Being signed in does not mean
someone is at the screen, and the page says so.

## How last activity is recorded

- Each session and each staff account has a `lastActivityAt` time. It is the only thing stored:
  never the page, the request or anything typed.
- It is updated when a signed-in person makes a request, **at most once a minute per session**
  (one small database update a minute during use, not one per request). Statuses are therefore
  accurate to about a minute.
- **Automatic refreshes do not count.** The Overview and Staff Activity refresh themselves once a
  minute; those requests carry an `X-Background-Refresh: 1` header and do not update last activity.
  An unattended open page therefore does not keep someone "Active now". The header can only lower
  what is recorded; it grants nothing.
- Signing in sets the last sign-in (`StaffUser.lastLoginAt`) and last activity. Last sign-in is set
  only by a successful sign-in.
- Recording activity can never refuse or delay a request; a failure is logged as
  `ACTIVITY_NOT_RECORDED` without details.

## Where the activity sentences come from

The existing audit log (`AuditEvent`). No new tracking was added, and no request or response
bodies are recorded. Only these actions are shown:

| Category | Actions (as shown) |
| --- | --- |
| Sign-in and sign-out | Signed in · Signed out · Signed out on all devices · Signed *name* out on all devices (administrator) · Ended a session for *name* (administrator) · Changed their password |
| Patients | Registered a patient · Updated a patient’s details · Archived / Reactivated a patient record |
| Admissions | Admitted / Readmitted a patient · Changed a patient’s room · Discharged a patient |
| Clinical records | Created / Updated a draft clinical record · Finalized a clinical record · Added an amendment to a clinical record |
| Staff administration | Created a staff account for *name* · Changed *name*’s role / account status · Reset *name*’s password · Sent a notice to staff |
| Medication catalog | Added a medicine to the catalog · Deactivated / Reactivated a medicine in the catalog |

Never shown: record views (who opened which patient or clinical record), failed sign-in attempts
(they belong to security monitoring, have no confirmed person and are not shown here), retired
appointment events and system set-up. Only staff names appear in sentences, and only for actions
on staff accounts. Patients are never named or numbered; diagnoses, complaints, notes, medicines,
doses, rooms, discharge notes, IP addresses, browsers, request identifiers and audit metadata are
never read into a response.

Roles shown are each person's current role.

## Ending sessions

- **End session** ends one session; that browser or device must sign in again, and the person's
  other sessions continue. A session that has already ended is refused ("This session has already
  ended") and nothing is recorded.
- **Sign out everywhere** ends every session of the person (the existing Staff & Access action).
- Both need confirmation, use the existing session service, require CSRF and a trusted origin, and
  are audited in the same transaction: `STAFF_SESSION_REVOKED` (one session) and `SESSION_REVOKED`
  (everywhere), each with the administrator as actor and the staff member as subject.
- Ending your own session from here signs you out, and the dialog says so. The current session is
  marked "this browser, you" and has no End session button.
- Reading Staff Activity is not audited, in line with the existing policy for administrative
  reads.

## API

All routes require an administrator session, return `Cache-Control: no-store`, and never return
session tokens, CSRF tokens, passwords, IP addresses or browsers.

| Route | Purpose |
| --- | --- |
| `GET /api/v1/staff-activity/active` | `{ generatedAt, thresholds: { activeNowMinutes, recentMinutes }, summary: { activeNow, signedIn, signedInToday }, staff: [{ staff, signedInAt, lastActivityAt, status, sessions }] }` |
| `GET /api/v1/staff-activity/events` | Query `page`, `limit` (1–50, default 25), `period` (`today`, `last7`, `last30`), `category` (`all`, `authentication`, `patients`, `admissions`, `clinical`, `staff`, `catalog`), `search` (staff name or number), `role`. Returns `{ generatedAt, range, items: [{ id, occurredAt, event, category, text, actor, subject }], pagination }` |
| `GET /api/v1/staff-activity/staff/:id` | `{ generatedAt, staff: { …, status, lastLoginAt, lastActivityAt }, sessions: [{ id, signedInAt, lastActivityAt, expiresAt, status, current }], activity: { items, pagination } }` (query `page`) |
| `POST /api/v1/staff/:id/sessions/:sessionId/revoke` | Ends one session; body `{}`; `404 SESSION_NOT_FOUND` if it has already ended |
| `DELETE /api/v1/staff/:id/sessions` | Existing: signs the person out everywhere |

`staff`, `actor` and `subject` contain only `id`, `staffNumber`, `firstName`, `lastName` and
`role`. Days are UTC calendar days, as in Reports. Unknown query fields are refused (`400`).

## Data model and performance

- Migrations `20261112090000_staff_activity_enums` (the `STAFF_SESSION_REVOKED` audit action) and
  `20261112090100_staff_session_activity` add `StaffSession.lastActivityAt` (not null, defaults to
  the sign-in time, never before it) and `StaffUser.lastActivityAt` (null until first use). Existing
  sessions start from their sign-in time and existing staff from their last sign-in.
- **No new indexes.** The activity list uses `AuditEvent (action, createdAt)` and `(createdAt)`; a
  person's activity uses `(actorId, createdAt)` and `(entityType, entityId, createdAt)`; active
  sessions use `StaffSession (staffUserId, revokedAt)` and `(expiresAt)`. Sessions are removed after
  they expire, so that table stays small.
- No grant changes: the runtime role already reads and updates `StaffUser` and `StaffSession`.
- The audit log keeps everything as before; the page reads at most 50 entries at a time.

## Known limitations

- Statuses are accurate to about a minute; a request within the last minute may not show yet.
- A page left open is not counted as activity, but a person reading one page for a long time
  without clicking also becomes Recently active and then Idle.
- Roles shown are current roles, not the role at the time of an old action.
- There is no device or location information by design; sessions are numbered instead.
- Failed sign-in attempts are not shown here.
