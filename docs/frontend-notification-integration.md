# Step 13 — Notifications frontend integration

## Scope and findings

Step 13 replaces the Notifications availability panel with a notification center
backed by the existing [notification API](notifications-api.md). It does not change
the backend, and it does not start staff administration, dashboard analytics or
report integration.

At inspection, `Notifications.tsx` rendered only an "unavailable" panel. The
stabilization step had already removed the fake inbox, static badge and local
broadcast. What remained was the `defaultBroadcasts` mock and its `Broadcast`
type: a numeric ID, an audience label string and a display-time string, with no
type, target, read state or pagination. No production code imported them; three
tests asserted they still existed while the feature was deferred.

The backend contract was used as implemented, not inferred from the old mock:

| Concern | Actual contract |
|---|---|
| Inbox DTO | `id`, `type` (`DIRECT`/`BROADCAST`), `title`, `message`, `createdAt`, `target` (`{ type: 'APPOINTMENT', id }` or `null`), `readAt` |
| Broadcast result | `notification` (content DTO without `readAt`) and `recipientCount` |
| List query | `page` (default 1), `limit` (1–100, default 20), `read=true\|false`, `type`; no search, sorting or recipient keys |
| Permissions | All active roles read and manage their own inbox; only ADMIN broadcasts |
| Read state | First `readAt` uses database time; repeats keep it; mark-all returns `updated` |
| Broadcast rules | Title 1–150, message 1–2000 after trimming; no `<`, `>` or control characters; audience `ALL` or `ROLE` + `StaffRole` |
| Errors | `NOTIFICATION_NOT_FOUND` (missing and non-owned alike), `NO_NOTIFICATION_RECIPIENTS`, `NOTIFICATION_AUDIENCE_TOO_LARGE`, `VALIDATION_ERROR`, `FORBIDDEN` |

No backend defect blocked the integration, so no server code or test changed.

## Architecture

| File | Responsibility |
|---|---|
| `api/notifications.ts` | Typed transport over the shared `request`/`mutation` client |
| `features/notifications/useNotifications.ts` | `useUnreadCount` (shell-level) and `useNotificationList` (stale-safe inbox page) |
| `features/notifications/Notifications.tsx` | Inbox workspace: actions, summary, filters, list, pagination |
| `features/notifications/NotificationDetail.tsx` | Detail dialog; marks unread notices read on open |
| `features/notifications/BroadcastComposer.tsx` | ADMIN broadcast dialog |
| `features/notifications/NotificationFeedback.tsx` | Safe error, support reference and unconfirmed-write wording |
| `features/notifications/notification-utils.ts` | Labels, badge formatting, timestamps, plain-text validation, error mapping |
| `features/notifications/notifications.css` | Screen layout using the shared tokens |

`notificationsApi` exposes `list`, `get`, `unreadCount`, `markRead`, `markAllRead`
and `broadcast`. GETs carry no CSRF header and accept an `AbortSignal`. POSTs go
through the shared `mutation()` helper, so they reuse the session's CSRF token and
are never replayed. `list` encodes only `page`, `limit`, `read` and `type`.
`broadcast` rebuilds the body from an allowlist: trimmed `title` and `message`, plus
either `{ type: 'ALL' }` or `{ type: 'ROLE', role }`. Extra keys passed by a caller
are dropped. `unreadCount` rejects anything other than a non-negative integer, so
a malformed response can never appear as a number. Components never call `fetch`.

## Own-inbox model and roles

No call sends a recipient or staff identifier; the server derives the inbox from
the session. There is no user selector, recipient filter or "view staff inbox"
control. All three roles see the Notifications navigation item, their own inbox,
the unread badge, mark-read and mark-all. **New broadcast** renders only when
`role === 'ADMIN'`. A 403 from the server (for example a non-admin POST to the
broadcast endpoint) shows "You do not have permission to perform this action."
and keeps the session; a 401 uses the existing global invalidation.

## Inbox, filters and pagination

The page heading (from the shell) is **Notifications** with "Stay up to date with
appointments and hospital operations." The panel header offers **Refresh**
(accessible name "Refresh notifications"), **Mark all as read** and, for ADMIN,
**New broadcast**. Two small summary pills show the server unread count and the
backend `total` for the current filter. Neither is an organization-wide figure.

Filters are an All / Unread / Read segmented group (`aria-pressed` buttons in a
labelled group) and a Type select (All types / Direct notice / Staff broadcast).
Every change returns to page 1 and requests that page from the server. There is no
search, because the API has none. Pagination reuses the existing Previous / page
state / Next control with backend metadata, shown only when there are results.

Each item is a list entry with a type icon, the title as an `h3` button, a local
timestamp, a two-line preview and text tags: **Unread** or **Read**, the type, and
**Linked appointment** when applicable. Unread items have a slightly stronger
background, a thin left rule and a bolder title. Read items stay visible. The
whole card is the click target. The title button's description references the
tags and timestamp, so assistive technology hears the read state and time.

Empty states are distinct: an empty inbox says "You’re all caught up. New
operational notifications will appear here."; an empty Unread view says "No unread
notifications."; any other empty filter says "No notifications match this filter."
While loading, a static skeleton and "Loading notifications…" status replace the
list, never an empty-state message. List failures show the safe message, the
support reference and **Try again**.

`useNotificationList` keys each response to its query and revision, and aborts the
previous request. An older filter or page response can never replace a newer one.

## Unread count and badge

`useUnreadCount` lives in the application shell, so the badge and the inbox summary
share one server value. It loads after authentication without blocking the
workspace, and again on every navigation, on **Refresh**, and after mark-read,
mark-all and a sent broadcast. There is no interval, WebSocket or event stream. The
count is never derived from the loaded page.

The Notifications navigation item shows the exact count from 1 to 99 and `99+`
above that. The visible number is `aria-hidden`, and a visually hidden span gives
the exact text, for example "120 unread notifications". Chrome computes the button
name as "Notifications 6 unread notifications". At zero the badge is absent. At
widths where the sidebar collapses (900 px and below), the menu button carries the
same badge, described through `aria-describedby`.

If the count request fails, the badge is removed rather than left stale, no global
alert appears, and the rest of the application continues. The inbox summary shows
"Unavailable" with **Retry unread count**.

## Detail and read state

Opening an item shows a detail dialog titled with the notification title. It shows
the type and read tags, the full message (line breaks preserved), the received
time and the read time. Opening an unread notice is the one action that marks it
read: a single `POST /:id/read`, guarded against double submission and StrictMode
double effects. The dialog, the list item and the count then use the server's
returned notification, including its `readAt`. Opening an already-read notice
sends no write; it re-reads `GET /:id` and keeps the original read time. If that
refresh fails for another reason, the inbox copy stays on screen with a short note.

A 404 from either call shows only "Notification not found." The dialog hides the
content and gives no ownership detail. An unconfirmed read (network failure or
5xx) says "The read status could not be confirmed. Refresh notifications to see the
current state." and offers **Mark as read**. Nothing retries automatically.

**Mark all as read** needs no confirmation because it deletes nothing. It is
disabled while pending and when the server count is zero. On success it reports
the server's `updated` value ("3 notifications marked as read."), reloads page 1 of
the current filter (an Unread view becomes "No unread notifications.") and
refreshes the count. Notices remain in the inbox.

## Appointment targets

Only `target.type === 'APPOINTMENT'` produces an action. **View appointment** closes
the dialog and opens the existing `AppointmentDetail` for that ID. It uses the
normal appointment API and authorization, with a **Back to Notifications** button.
The notification flow fetches no patient, encounter or other details to decorate
cards. The appointment screen's own behavior (including a doctor's linked-record
lookup) starts only after the explicit navigation. An inaccessible target, such as
an appointment since reassigned to another doctor, shows the appointment screen's
"Appointment not found." without signing out. Unknown target types render normally
with no action.

## Admin broadcasts

**New staff broadcast** uses the shared `Dialog`: focus trap, Escape, background
inertness, scroll lock and focus restoration to **New broadcast**. The form has:

- An Audience radio group ("All active staff" / "Specific role"), with "Broadcasts
  are delivered to active staff accounts." When a role is chosen, a Staff role
  select sends the exact enum (`ADMIN`, `RECORDS_OFFICER`, `DOCTOR_IN_CHARGE`).
- A Title input (`maxLength` 150) and a Message textarea (`maxLength` 2000), each
  with an associated character count.
- The privacy reminder "Do not include confidential patient or clinical
  information. A sent broadcast cannot be edited or withdrawn.", associated with
  the message field.

Client validation mirrors the server: required after trimming, length limits,
no angle brackets and no control characters. Errors appear beside the field with
`aria-invalid`/`aria-describedby`, and focus moves to the first problem. While
sending, the fieldset and buttons are disabled, Escape and backdrop dismissal are
ignored, and a second submit is dropped. Closing a form with text asks "Discard
this unsent broadcast?", and page unload is guarded, matching other forms.

Success closes the dialog and reports the server count: "Broadcast sent to 14 active
staff members." or "Broadcast sent to 1 active staff member (Records Officers)."
No recipient list is shown. The inbox and count refresh, because the sender may be
in the audience. `NO_NOTIFICATION_RECIPIENTS` shows "No active staff accounts match
this audience. Choose a different audience." `NOTIFICATION_AUDIENCE_TOO_LARGE`
shows "This audience is too large for a single broadcast. Choose a specific role, or
contact system support." For both, the draft stays open. An unconfirmed send warns
that the broadcast may already have been sent and asks the administrator to check
before sending again.

## Privacy and plain text

Title and message are rendered as ordinary React text. There is no
`dangerouslySetInnerHTML`, `innerHTML`, Markdown or entity decoding. Legacy rows
containing `<img onerror>` or `<script>` display as literal text and do not
execute. Notification content and read state live only in component memory. There
is no localStorage, sessionStorage, IndexedDB, cache or service worker use, and no
logging. The notification mock and the `Broadcast` type are removed. The dashboard
`appointments` mock remains for the deferred Overview work.

## Timestamps

Times use the browser's time zone, which the panel states. A notice from the same
local day reads "Today, 14:32", from the previous day "Yesterday, 09:15", and
otherwise uses the medium date with a short time, through `Intl` with no new
dependency. The full date is in each `<time>` element's `title`, and `dateTime`
holds the UTC value. The existing appointment clock re-renders the labels across
midnight.

## Responsive behavior and accessibility

Below 650 px the header actions share the row width, the filter group and Type
select take the full width, and cards tighten. Timestamps wrap under the title
instead of colliding with it. Below 400 px the type icon is hidden. Dialogs fit the
viewport, and the message textarea keeps at least 150 px height.

Semantics: the shell `h1`, a panel `h2` and an `h3` per notice; a labelled list;
read state as text, not only color; labelled filter controls; associated helper,
count and error text; errors in `role="alert"`; loading, success, mark-all and
sending messages in `role="status"`. Touch targets are at least 44 px, including
each radio's full label.

## Verification

Client tests (87 new, across 4 files):

| File | Tests | Coverage |
|---|---:|---|
| `notification-api.test.ts` | 18 | Endpoints, pagination and filter encoding, body and audience allowlists, no CSRF on GETs, shared CSRF on POSTs, no replay, invalid counts rejected, 403 keeps and 401 ends the session, and a source scan for markup injection, storage, mocks, raw `fetch`, recipient fields and enrichment |
| `notification-utils.test.ts` | 18 | `99+` formatting, accessible labels, Today/Yesterday/date, plain-text rules, role gate, target detection, safe error wording |
| `notification-ui.test.tsx` | 39 | Loading, rendering, unread/read indication, All/Unread/Read and type filters, pagination, empty states, error and retry, stale responses, single read on open (StrictMode), stable repeat read, generic not-found, unconfirmed read with deliberate retry, inert markup, unsupported target, appointment action, mark-all, no polling, count retry, role-gated broadcast, ALL/ROLE/exact enum, required fields and limits, privacy text, recipient count, both 409 codes, 403, unconfirmed send, pending guard, dirty-close prompt and focus restoration |
| `notification-app.test.tsx` | 12 | Shell integration for all roles, zero/exact/`99+` badge with accessible text, failed count without a badge, count refresh after read and mark-all, non-blocking load and navigation refresh, View appointment and Back to Notifications, inaccessible target, no patient/clinical enrichment, no storage |

Updated existing tests:

- The stabilization test now expects the real inbox, no badge at zero and a
  broadcast control for ADMIN only.
- Three mock-preservation tests now assert that the notification mock is removed
  and that the deferred dashboard mock is kept.
- `AppointmentDetail` gained an optional `backLabel` (default unchanged).

Totals and commands are recorded in the release verification for this step:
1,671 tests across 44 files (474 client, 483 server unit, 714 database), with
install, Prisma generate/validate, typecheck, lint, build and `git diff --check`
passing.

Live acceptance (138/138 checks) ran against the production build behind a local
HTTPS proxy. It used a fresh disposable database, a restricted runtime database
role and synthetic accounts only.

- **Chrome:**
  - Admin: empty state and validation; ALL broadcast stored once per active
    account; ROLE broadcasts with the exact enum; read-on-open; mark-all; dirty
    discard.
  - Real empty-audience 409, found by suspending all doctors.
  - Stale CSRF token refused, then a deliberate resend succeeded.
  - Records: badge matches the database; filters; 403 broadcast without sign-out;
    no requests during 20 s idle; new broadcast appears only on refresh; legacy
    markup inert; no browser storage.
  - Doctor: four appointment notices in order; keyboard open; View appointment
    lands on the right reference; reassigned target refused safely; no
    patient/clinical requests from the inbox.
  - Five widths: no overflow, no title/time collision, dialogs fit, controls
    reachable, menu badge below 900 px.
- **Edge, the Firefox engine and WebKit:** badge, read-on-open, unread empty state
  and composer validation.
- **Accessibility and console:** axe-core WCAG A/AA found no violations on the
  inbox and composer. There were no page errors; console entries were only the
  expected 401/403/404 resource notices.

## Limitations

- **No realtime delivery.** New notices appear after navigation, Refresh or a
  read action; there is no polling, WebSocket or server-sent events.
- **Duplicate broadcasts on a dropped connection (resolved in Step 13.1).** When
  a broadcast response was dropped, Chrome silently resent the POST and the server
  stored two broadcasts. The composer now sends an `Idempotency-Key`, so a resend
  returns the original broadcast; see [mutation idempotency](idempotency.md).
- **Unread view keeps opened items.** In the Unread view, an opened notice stays
  listed, marked Read, until the next refresh or filter change. Paging forward
  after reading items can skip notices, because the server's offset window has
  shifted; Refresh or returning to page 1 shows them.
- **No broadcast history.** There is no sent-broadcast history, dismissal,
  deletion, search or retention workflow, because the API provides none.
- **Not tested with screen readers or stock browsers.** The inbox has not been
  tried with a screen reader, on Safari or on stock Firefox; WebKit and Firefox
  were automation builds.
- **Content policy is human.** Validation cannot detect clinical facts in
  administrator-written text.

The next step is owner review of this integration, followed by a decision on the
next deferred module. Staff administration and dashboard/report integration were
not started.
