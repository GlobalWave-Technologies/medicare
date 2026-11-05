# Internal staff notifications — Step 7

Notifications are persisted operational summaries, not copies of clinical records.
This module reuses Notification (shared content) and NotificationRecipient
(delivery identity and per-user read state). It provides in-app persistence only.

## Permissions and ownership

| Current active role | READ_OWN | MANAGE_OWN | BROADCAST |
| --- | --- | --- | --- |
| ADMIN | Yes | Yes | Yes |
| RECORDS_OFFICER | Yes | Yes | No |
| DOCTOR_IN_CHARGE | Yes | Yes | No |

Permission names have the `NOTIFICATION_` prefix. Every route requires an active
staff account and a valid database session. The recipient UUID always comes from
that session; request bodies/queries cannot choose an inbox. ADMIN can broadcast
but cannot inspect another user's inbox. A missing or non-owned notification
returns the same 404 NOTIFICATION_NOT_FOUND. Notifications are staff-only;
there are no authenticated patient accounts or patient delivery workflows.

Historical delivery is a snapshot. Changing a recipient's role does not remove
old notices or deliver old broadcasts to new members. Inactive staff cannot use
the API, but their rows remain stored. Reactivation restores access to their own
history through a new valid session. Staff role/status changes retain the existing
session revocation behavior.

## Routes and DTOs

All paths are relative to `/api/v1/notifications`. Responses use
`Cache-Control: no-store` and the established success/error envelope. All POSTs
require the configured exact Origin and session-bound X-CSRF-Token. GETs do not
require CSRF and do not implicitly mark notices read.

| Method/path | Input | Success |
| --- | --- | --- |
| GET / | page, limit, read, type | 200; data.items and data.pagination |
| GET /unread-count | No query | 200; data.count |
| GET /:id | Notification UUID, no query | 200; data.notification |
| POST /:id/read | Empty object or no body, no query | 200; data.notification |
| POST /read-all | Empty object or no body, no query | 200; data.updated |
| POST /broadcast | Admin broadcast body, no query | 201; data.notification and data.recipientCount |

No generic create, PATCH, DELETE, dismiss, unread/reset, recipient-list or
broadcast-history administration endpoint is provided. Broadcast creation returns
the content just submitted and a count, not recipient identities or inbox access.

An inbox notification contains exactly:

```json
{
  "id": "c7e0a15e-4471-44f3-97da-f01988183f13",
  "type": "DIRECT",
  "title": "New appointment",
  "message": "An appointment has been assigned to you.",
  "createdAt": "2026-10-10T09:00:00.000Z",
  "target": { "type": "APPOINTMENT", "id": "74131da6-ff92-4d99-8561-32dc5614c6d9" },
  "readAt": null
}
```

createdAt is the shared notification creation time, serialized in UTC. target is
null for broadcasts and legacy unlinked notices. No sender/recipient internals,
recipient lists, emails, sessions, staff secrets, patient identity or raw Prisma
objects are returned. Broadcast creation uses the same content DTO without readAt,
since the sender may not be among the selected recipients.

Existing NotificationType values DIRECT and BROADCAST are reused. Type is a
presentation filter, not authorization. Resource access must always go through
its independently authorized API; a notification link grants no appointment access.

## Listing, counts and first-read state

Pagination reuses page 1–100000 (default 1) and limit 1–100 (default 20).
Optional `read=true|false` accepts only those lowercase strings. Optional type
accepts DIRECT or BROADCAST. Unknown keys, arbitrary Prisma filters, recipientId,
search and client-selected sorting are rejected.

Ordering uses delivery createdAt descending, then delivery UUID ascending. API
delivery and content creation share the same transaction timestamp. Legacy rows
may have a later delivery time, so inbox ordering intentionally follows delivery.
Pagination returns page, limit, total and totalPages; an empty result has zero
totalPages. Count and list are separate queries and can observe concurrent changes;
this is interactive pagination, not a consistent export snapshot.

Unread count executes a scoped database COUNT on staffUserId and null readAt;
it does not fetch entire messages. The existing recipient/readAt/createdAt index
supports this. A new recipient/createdAt/id index supports unfiltered inbox order.

Read state belongs only to NotificationRecipient. A conditional update sets the
first readAt using database time; repeats preserve the original timestamp.
Mark-all updates only the current user's unread deliveries at or before one
database-time cutoff and returns the actual affected count. Already-read rows
and other users remain untouched. Delivery committed after the UPDATE statement's
snapshot remains unread, even if its transaction started earlier. Concurrent
single-read/read-all requests serialize per inbox. Newly delivered notices require
a later read operation; mark-all is not a subscription that auto-reads future mail.

## Broadcasts and plain text

```json
{
  "title": "Staff briefing",
  "message": "Please attend the operational briefing at 14:00.",
  "audience": { "type": "ALL" }
}
```

Alternatively use `"audience": { "type": "ROLE", "role": "RECORDS_OFFICER" }`.
ROLE accepts the three existing StaffRole values. ALL selects all ACTIVE staff,
including the sender if eligible. ROLE selects ACTIVE staff with that current
role. PENDING, SUSPENDED and DISABLED accounts receive no new broadcast. Recipient
selection takes place under the shared staff-security lock, so cooperating staff
lifecycle mutations cannot change the audience halfway through delivery.

The server creates one shared BROADCAST and one recipient row per selected user
in the same transaction as one audit event. Zero eligible recipients returns 409
NO_NOTIFICATION_RECIPIENTS without storing content/audit. Synchronous fan-out is
limited to 10,000 recipients: exceeding this returns 409
NOTIFICATION_AUDIENCE_TOO_LARGE rather than silently truncating the audience.
This is a defensive bound, not a tested throughput guarantee; existing database
timeouts can limit practical deployment size further.

Title is 1–150 characters and message 1–2000. Surrounding whitespace is trimmed;
Unicode and internal tabs/newlines are preserved. Empty/whitespace-only text,
control characters and all literal angle brackets are rejected. This deliberately
restrictive plain-text rule avoids accepting markup without claiming to be an HTML
sanitizer. There is no Markdown rendering or entity decoding. The future frontend
must render escaped text, never innerHTML or decoded HTML. Existing storage widths
(title 200, message 5000) remain unchanged for historical data; the API uses tighter
limits. The existing 100 KiB request-body bound also applies.

Broadcast text is written by an administrator. Validation cannot determine whether
arbitrary prose contains clinical facts or credentials. Administrators must use
operational summaries only: no diagnosis, complaint, clinical note, treatment,
amendment, patient history, password or token. No automated clinical-data copying
is implemented. Historical/direct-SQL content is not retroactively rewritten.

## Appointment automation

Only the requested small operational set is implemented. Staff-account, role,
patient and clinical notifications are deferred; no noisy notice is sent for every
edit or lifecycle transition.

| Appointment operation | Recipient and message behavior |
| --- | --- |
| Create | Assigned active doctor: “An appointment has been assigned to you.” |
| Actual start/end change | Current active doctor: “An appointment assigned to you has been rescheduled.” |
| Clinician change | Eligible old doctor receives generic reassignment notice; new doctor receives assignment notice |
| Time and clinician changed together | The two reassignment/assignment notices; no additional reschedule notice |
| First cancellation | Assigned active doctor receives generic cancellation notice |
| Repeat cancellation or identical schedule PATCH | No additional notice |
| Reason/notes/type-only update, confirmation/check-in/completion/no-show | No notice |

Only ACTIVE DOCTOR_IN_CHARGE assignees are eligible. Creation/rescheduling already
require an eligible new/current clinician in Step 5. Reassignment skips an
inactive/demoted old clinician. Historical cancellation still succeeds for a null,
inactive or demoted assignee, with no new delivery to that assignee. This preserves
the existing scheduling lifecycle instead of blocking historical cancellation.

All automated messages are fixed templates. They contain no patient name, phone,
clinical content, scheduling reason, notes or cancellation reason. A nullable
appointmentId FK supplies the safe DTO target; URLs and arbitrary JSON metadata
are not stored. The old clinician retains their reassignment notice, but the
appointment API still denies access after reassignment.

Eligible delivery is a **required transactional side effect**: appointment,
existing appointment audit, shared notification and recipient commit together.
If notification insertion fails, the business mutation and its audit roll back.
There is no best-effort delivery or queue in this step. Repeating a transaction
after rollback creates no duplicate surviving notification. Actual-change checks
and existing appointment locks avoid repeat reschedule/cancel notices. Broadcast
POSTs accept an optional `Idempotency-Key` ([mutation idempotency](idempotency.md)).
A resend with the same key and accepted body within 24 hours returns the original
notification and `recipientCount`. It creates no new content, deliveries or
`NOTIFICATION_BROADCAST_CREATED` audit, even if the audience has changed since. A
changed title, message or audience under the same key returns
`409 IDEMPOTENCY_KEY_REUSED`. Unkeyed repeated POSTs remain separate broadcasts.
No distributed event system has been introduced.

## Transactions, auditing and privacy

Broadcast and read-state writes use a READ COMMITTED transaction with the existing
10-second transaction deadline and shared authorization advisory lock
`(1296385106, 1)`. They recheck active session/current permissions after lock waits.
Inbox writes also serialize on `(1296385107, hashtext(staff UUID))`; hash collisions
only serialize unrelated inboxes and do not change ownership. Broadcast delivery
does not take inbox locks, keeping mark-all a bounded snapshot operation.

Simple inbox reads/counts use the freshly authenticated request context and do not
open interactive transactions or audit each read. A revocation does not cancel a
read already in progress. Appointment automation executes inside the existing
appointment transaction and retains auth -> patient -> appointment lock ordering,
overlap constraints, actor rechecks and conflict semantics.

Each broadcast writes one NOTIFICATION_BROADCAST_CREATED audit with actor,
notification UUID, request correlation and metadata containing source=API,
audience=ALL|ROLE and recipientCount (integer 1–10000). The latter two keys must
appear together. Existing source/changedFields classifications are preserved.
Both the helper and database enforce the strict allowlist. No title/message,
recipient identity list or clinical values appear in metadata. Automated appointment
notices use the originating appointment audit rather than creating redundant events.
Read/list/count/read-all operations create no audit noise.

HTTP logs retain only operational request metadata; bodies, URLs/query strings,
headers and responses remain excluded. Additional root/nested redaction covers
notification objects, title and message fields. Never place sensitive text in
arbitrary log-message strings. Errors retain safe messages and X-Request-Id without
Prisma details, SQL or stack traces.

## Storage migration and errors

`20261009120000_notification_workflow`:

- Allows BROADCAST with null targetRole to mean ALL; DIRECT must still have no role.
- Adds nullable Notification.appointmentId with an indexed RESTRICT foreign key;
  linked resources are allowed only on DIRECT messages. Appointment gains the
  inverse relation. This typed relation avoids an unchecked generic resource UUID.
- Adds the inbox ordering index without duplicating the existing unread index.
- Adds NOTIFICATION_BROADCAST_CREATED to AuditAction and narrowly extends the
  existing audit metadata validation function.
- Rejects notification UPDATE/DELETE/TRUNCATE and recipient DELETE/TRUNCATE.
  Recipient identity/creation time and the first non-null readAt are immutable;
  only the initial unread-to-read change remains allowed. Owners can bypass triggers.

Existing rows are preserved; no content backfill, enum replacement, new model or
extension is required. There are still 11 models and 8 enums, now with 7 migrations.
Use migrate deploy, preserving all SQL integrity rules; never substitute db push.
No new dependency, environment variable or external provider is required.

Invalid input uses existing 400 VALIDATION_ERROR. Missing/non-owned resources use
404 NOTIFICATION_NOT_FOUND. Role denial uses 403 FORBIDDEN. Empty/oversized audiences
use the 409 codes above. Existing auth/CSRF/Origin codes, payload limits and safe
500 INTERNAL_ERROR behavior apply. Rejected input is not echoed.

## Frontend findings and limits

The findings below describe the frontend as inspected in Step 7. The local mock
inbox and static badge have since been replaced by the real integration described in
[notification frontend integration](frontend-notification-integration.md).

At initial inspection, Notifications rendered the shared local broadcasts array.
Broadcast has a numeric ID, title, message, audience label and display-time string;
it has no recipient readAt, type, target or pagination. BroadcastModal collects only
message, fixes the audience to Records Officers and uses a generated “Admin
broadcast” title. App assigns Date.now() IDs and a local-time label. Sidebar badge
3 and the topbar dot are static, not unread counts. Notifications have no detail
navigation, mark-read, mark-all, error/loading handling or server persistence.

This step makes no frontend edits. Concurrent changes outside this work added
frontend authentication/booking API wiring and an appointment clinician lookup
route during verification; those changes were
preserved. Notification mocks, broadcasts and badges remain local. Future
notification integration must independently connect ownership-scoped inboxes,
UTC dates, UUID targets, CSRF mutations, pagination, counts and admin audiences.

Remaining limits: no idempotency for unkeyed broadcast clients, delivery receipts beyond
readAt, retention/dismiss flow, asynchronous fan-out, external delivery, polling or
realtime transport, full-text search or broadcast moderation. Read state is not
proof a person understood a message. Content policy for human-authored broadcasts,
least-privilege runtime grants, encrypted backups and retention remain operational
responsibilities. Database triggers do not constrain owners/superusers. No legal
or regulatory certification is implied.

See [Step 7 completion report](step-7-completion.md) for verification and files.
The next step is review of audience/privacy rules and the API contract before
separately authorizing another phase. This work stops at Step 7: no email/SMS/push,
dashboards, reports, MFA, password-reset delivery or frontend notification wiring.
