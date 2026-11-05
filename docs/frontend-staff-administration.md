# Step 14 — Staff administration frontend

## Scope and findings

Staff & Access previously showed a "not yet available" panel. It is now an Admin-only
workspace built on the existing staff API:

- a staff directory with server totals, role and status filters and pagination;
- an Add staff member form;
- an account detail page with separate Role, Account access and Sessions sections;
- confirmation dialogs for every access change.

No backend code changed. The contract differs from some earlier assumptions:

| Area | Actual backend behavior |
|---|---|
| Staff number | Entered by the administrator (`STF-` plus 6–32 letters or digits). The server trims and uppercases it and enforces uniqueness. It is not generated. |
| Initial status | `POST /staff` always creates the account `ACTIVE` with the administrator-supplied initial password. `PENDING` accounts only come from other provisioning paths. |
| DTO | `id`, `staffNumber`, `firstName`, `lastName`, `email`, `role`, `status`. There are no created, updated or last sign-in timestamps, so none are shown. |
| Search | None. The list supports exact `role` and `status` filters, `page` (1–100000) and `limit` (1–100). |
| Pagination | `{ page, limit, total }`. The client derives the page count. |
| Editing | No name, email or staff-number edits, and no deletion. Access is managed through role and status only. |
| Side effects | Every role or status change, and every session revocation, revokes all of the target's sessions. Changing your own account also clears your session cookie. |

## Architecture

| File | Purpose |
|---|---|
| `client/src/api/staff.ts` | `staffApi.list/get/create/changeRole/changeStatus/revokeSessions` over the shared credentialed transport. GETs send no CSRF; mutations use the shared `mutation()` CSRF path. |
| `features/staff/StaffAdministration.tsx` | Non-admin guard, directory, totals, filters, pagination and the list/detail switch. |
| `features/staff/StaffDetail.tsx` | Account detail and its three administrative sections. |
| `features/staff/AddStaffDialog.tsx` | The new-account form. |
| `features/staff/StaffActions.tsx` | Role, status and session confirmation dialogs. |
| `features/staff/StaffStatusBadge.tsx`, `StaffFeedback.tsx` | Status in words with an icon, and safe error or uncertain-outcome messages. |
| `features/staff/staff-utils.ts` | Labels, role access summaries, status meanings, allowed transitions, form validation and error mapping. |
| `features/staff/useStaff.ts` | Keyed, abortable list, totals and detail reads. |
| `features/staff/staff.css` | Workspace styles, including the table-to-card switch. |

`App.tsx` renders the workspace only for `ADMIN`. The shared `Dialog` gained an
optional `describedBy`, so a confirmation's warning is read out when it opens. The
Overview card for Admins now describes the real workspace.

## Access

- **Admin:** sees Staff in the navigation and can do everything below.
- **Records Officer and Doctor in Charge:** never see Staff. `allowedView` redirects a
  requested Staff view to their first permitted view.
- **Component guard:** if `StaffAdministration` is ever rendered for a non-admin, it
  shows "Administrator access required" and returns before its data hooks run, so no
  staff request is sent.
- **Server:** `requireRole('ADMIN')` and the in-transaction actor recheck stay
  authoritative.
- **Session handling:** a `403` keeps the session and shows a safe message. A `401`
  goes through the shared invalidation and returns to sign-in.

## Staff DTO

`staffApi` rebuilds every staff object from the seven documented fields. It rejects a
response with an unknown role or status, a missing field or a malformed page as
`INVALID_RESPONSE`, rather than displaying it. Any other property the server might
return, such as a password hash or session data, is dropped before it reaches React
state. Nothing is written to `localStorage`, `sessionStorage` or IndexedDB; the
directory and details live only in component memory.

## Directory

- **Header:** Refresh and Add staff member.
- **Accounts by status:** Active, Pending, Suspended and Disabled totals. Each comes
  from the server's `total` for `?status=X&limit=1`, so totals never depend on the
  visible page or filters. If they fail, the directory still works and the totals area
  offers Try again. They are independent reads and can briefly disagree with the list
  during concurrent changes.
- **Filters:** Role and Status selects map to the server's exact filters and reset to
  page 1. Clear filters restores the full list. There is no search box, because the
  API has none and a page-only filter would mislead.
- **Pagination:** the shared bounded Previous/Next control, 20 per page. A page past the
  end offers Return to first page.
- **Table (wider than 1100px):** Staff member, Staff number, Email, Role, Status and
  Actions columns. Each row has a Manage button named "Manage {name}". The signed-in
  account is tagged "Your account".
- **Cards (1100px and narrower):** a list of `article` cards, each labelled by the
  person's name, showing staff number, role, status and email, with a full-width Manage
  button. CSS shows only one of the two layouts; the hidden one is `display: none` and
  out of the accessibility tree.
- **States:**
  - loading shows a status message and a decorative skeleton;
  - a failed list shows a safe message, the support reference and Try again;
  - a filter with no matches offers Clear filters;
  - when the only account is the signed-in administrator, a callout says "No additional
    staff accounts have been added yet." with Add staff member.

## Add staff member

- **Fields:** first name, last name, work email, staff number, role, initial password
  and confirmation. These match the strict create schema. The body is rebuilt from the
  six accepted fields, so a stray `status`, `id` or hash can never be sent.
- **Role:** three radio choices with plain-language access summaries. None is
  preselected, so the role is always a deliberate choice.
- **Client validation:** mirrors the server rules (the server stays authoritative):
  - names: required, at most 100 characters, no control characters;
  - email: plausible shape, at most 254 characters;
  - staff number: `STF-` plus 6–32 letters or digits after trimming and uppercasing;
  - password: 15–128 Unicode code points, not blank, no NUL, with a matching
    confirmation.

  Errors are linked to their fields with `aria-describedby`, and focus moves to the
  first problem.
- **Password handling:**
  - masked by default, with one Show passwords / Hide passwords toggle (`aria-pressed`,
    `aria-controls`) for both fields;
  - masked again on every submit;
  - `autocomplete="new-password"`, with a live code-point count;
  - sent exactly as typed, never trimmed, logged, stored, placed in a URL or shown
    after creation; the success message does not repeat it;
  - the form tells the administrator to deliver it through the hospital's approved
    secure channel.
- **Success:** the dialog closes and the new account's detail opens from the
  server-returned DTO. The notice shows the server's staff number, for example
  "Account created for Nia Newhire (STF-NEW00007)". The directory and totals refresh.
- **Duplicates:** `EMAIL_ALREADY_EXISTS` and `STAFF_NUMBER_ALREADY_EXISTS` are shown on
  their field, which receives focus once the form is enabled again. The rest of the
  form is kept. `STAFF_IDENTITY_CONFLICT` (a race) appears as a general message.
- **Uncertain outcome:** staff creation sends an `Idempotency-Key` (Step 17). After a network
  failure or 5xx the form keeps the key and says to select Create account again without changing
  anything; the server then returns the account it already created. Changing a field starts a new
  key. If a later attempt still reports a duplicate, the form adds that the earlier attempt may
  have succeeded and to check the directory.
- **Safety:** a pending create locks the form and ignores further submits. Escape and
  backdrop clicks are ignored while it is pending. A partly completed form asks before
  discarding, including on page unload.

## Staff detail

- **Loading:** the page opens with the directory row's details and immediately re-reads
  the account with `GET /staff/:id`, abortable. Actions appear only once that fresh copy
  has loaded, so a stale status is never acted on.
- **Read failures:** a failed read keeps actions hidden and offers Try again. `404` shows
  "Staff account not found".
- **Header and identity:** name, role and status tags, "Your account" when applicable,
  then staff number, work email, role and account status.
- **Sections:** separate Role, Account access and Sessions sections. Each explains its
  effect beside its actions instead of hiding them in a row menu.
- **Results:** every result shown comes from the server response. Nothing is updated
  optimistically. Refresh account re-reads the account.
- **Focus:** opening the page focuses its heading. Back to staff directory returns focus
  to the same person's Manage button.

## Role changes

- **Dialog:** Change role lists the three roles with their access. The current role is
  marked "(current role)" and disabled, so a pointless re-assertion (which the server
  would still execute and audit) is not offered. A choice is required.
- **Warning:** "Changing {name}'s role updates the areas they can access and signs them
  out of all current sessions." For an active Admin target, it adds that the change is
  refused if they are the last active administrator.
- **Success:** "Role updated to {role}. Existing sessions have been signed out."
- **Disabled accounts:** role changes are not offered, since the account can never sign
  in again.

## Status lifecycle

| Current | Offered actions | Style |
|---|---|---|
| Pending | Activate account, Disable account | positive, high-risk |
| Active | Suspend account, Disable account | security (amber), high-risk |
| Suspended | Reactivate account, Disable account | positive, high-risk |
| Disabled | none; "Disabled is permanent" | — |

These are exactly the server's `statusTransitions`; impossible transitions are never
shown.

- **Suspend:** warns "{name} will be signed out on all devices and unable to access
  Medicare until an administrator reactivates the account."
- **Reactivate and Activate:** reviewed with positive styling. Reactivation notes that
  the person is not signed in automatically.
- **Disable:** a stronger dialog, "Disable account permanently", in danger tone: it
  permanently disables the account under the current system policy and cannot be
  reversed. It requires ticking "I understand this account can't be reactivated."
  before the request is sent.
- **Refusals:** `INVALID_STATUS_TRANSITION` and `CREDENTIALS_REQUIRED` (activating a
  pending account with no password) are explained without changing the shown status.

## Session revocation

- **Availability:** Sign out all sessions is offered only for Active accounts. Only an
  Active account can hold a usable session, and status changes already revoke the rest;
  for other statuses the section explains this.
- **Confirmation:** "This immediately signs {name} out on all devices." The dialog says
  the account stays Active and can sign in again.
- **Success:** "All sessions for {name} have been signed out. The account is still
  Active." No session identifiers, counts or tokens are shown; the API exposes none.
- **Uncertain outcome:** an uncertain revocation says repeating it is safe.

## Last active administrator and self-actions

The UI does not predict last-admin protection; the server's serialized check decides.
`LAST_ADMIN_PROTECTION` shows "You can't remove the last active administrator. Make
another account an active Admin first.". The session, role and status remain unchanged.

The signed-in administrator's own account shows extra warnings:

- **Role change:** you'll be signed out immediately and lose Staff & Access.
- **Suspension:** another administrator must reactivate you.
- **Disabling:** you permanently lose access.
- **Session sign-out:** includes this browser.

After the server accepts a self change, the server has already revoked the current
session and cleared its cookie. The workspace does not refresh the directory. It calls
the auth store's `refreshUser()`, which confirms the session with `/auth/me`; that
returns `401` and the app shows sign-in. A refused self change leaves the session
untouched.

## Errors and feedback

| Code | Message |
|---|---|
| `STAFF_NOT_FOUND` / 404 | This staff account was not found. Return to the staff directory and refresh it. |
| `EMAIL_ALREADY_EXISTS` | Another staff account already uses this email address. |
| `STAFF_NUMBER_ALREADY_EXISTS` | This staff number is already assigned to another account. |
| `STAFF_IDENTITY_CONFLICT` | This email address or staff number is already assigned to another account. |
| `INVALID_STATUS_TRANSITION` | This status change isn't allowed from the account's current status. Refresh the account to see its latest status. |
| `CREDENTIALS_REQUIRED` | This account has no sign-in credentials yet, so it can't be activated here. |
| `LAST_ADMIN_PROTECTION` | You can't remove the last active administrator. Make another account an active Admin first. |
| `FORBIDDEN` | Only administrators can manage staff accounts. |
| `VALIDATION_ERROR` | Check the details and try again. Some information wasn't accepted. |
| `CSRF_INVALID`, `SESSION_CHANGED`, 401, network | Shared authentication messages. |

Network failures and 5xx responses on mutations get a "could not be confirmed"
message specific to the action instead. Raw server messages are never shown. The
request ID appears as "Support reference". No mutation is retried automatically. After
`CSRF_INVALID`, the next deliberate attempt fetches a fresh token.

## Responsive behavior and accessibility

- **Widths:** checked at 320, 375, 768, 1024 and 1440px. Above 1100px the directory is
  a fixed-layout table; at 1100px and below it becomes cards (two columns at 1024, one
  on phones). Identity details and sections stack, and toolbars and dialog actions go
  full width. Long names and emails wrap (`overflow-wrap: anywhere`).
- **Headings and labels:**
  - the h1 page heading, then h2 directory or account, then h3 sections;
  - table headers use `scope="col"`, and cards are labelled by name;
  - filters, radios and the checkbox have visible labels;
  - field errors and password requirements are associated with their inputs.
- **Status:** always shown in words with a decorative (`aria-hidden`) icon; colour only
  reinforces it.
- **Dialogs:** named by their title and described by their warning. Focus is trapped
  and restored to the opener; Escape and the close button are disabled while a request
  is pending.
- **Controls:** every control is a native button, select or input, at least 44px tall.

## Verification

- **Client tests:** 133 new tests in six files:

  | File | Tests | Covers |
  |---|---|---|
  | `staff-api.test.ts` | 22 | Endpoints, query allowlist, encoded paths, CSRF only on mutations, the create body allowlist with the password unchanged, DTO allowlist and rejection, no replay, deliberate CSRF refresh, 403/401 semantics, source hygiene. |
  | `staff-utils.test.ts` | 38 | Labels, role access text, exact transitions and tones, session and role availability, notices, validation including code-point passwords, error mapping without raw text, uncertainty. |
  | `staff-directory.test.tsx` | 33 | Guard without fetch, loading, rows and labels, status without colour, totals, pagination, filters, empty and first-run states, list errors, stale responses, cards and wrapping, the full create workflow, password visibility, duplicates and focus after them, pending lock, dirty close, uncertain create, no storage or logging. |
  | `staff-detail.test.tsx` | 29 | Safe fields, focus, fresh-read gating, not-found and read errors, actions per status, the disabled terminal state, role change and last-admin refusal, self actions, suspend, reactivate, activate, credentials, disable acknowledgement, refused, uncertain and forbidden changes, session revocation, dialog focus, keyboard semantics, no storage. |
  | `staff-app.test.tsx` | 7 | Navigation for each role, overview card, no staff requests by non-admins, mobile navigation, contained 403, reset on navigation. |
  | `staff-session.test.tsx` | 4 | The real AuthGate and auth store with routed `fetch`: self role change and self revocation return to sign-in; revoking another account keeps you signed in; a 401 on a staff read signs out without stale data. |

  One stabilization test changed its expectation from the unavailable panel to the
  real workspace.
- **Full run:** see the release readiness addendum for current totals. All server and
  database suites are unchanged and passing.
- **Live run:** 114 of 114 checks in Chrome against the production build behind the
  HTTPS gateway, on a fresh database with the restricted runtime role. The run covered:
  - **UI creation:** a Records Officer, a Doctor in Charge and test accounts, with the
    stored, normalized staff numbers displayed; a duplicate email refused on its field;
    the discard prompt.
  - **Role change:** the target's next request returned it to sign-in, and it signed in
    again with the new role.
  - **Suspension and reactivation:** a suspended target was signed out and could not
    sign in; after reactivation it could.
  - **Session revocation:** both of the target's browsers were signed out, while the
    account stayed Active.
  - **Disabling:** required the acknowledgement; the account could not sign in, and the
    server still refused reactivating it.
  - **Pending activation:** with credentials it succeeded; without them it was refused
    with a clear message.
  - **Last active administrator:** the sole active administrator's own demotion and
    suspension were refused, with no session, role or audit change.
  - **Self-actions:** a second administrator's self demotion, and the administrator's
    own session sign-out, both returned to sign-in.
  - **Non-admins:** a Records Officer and a Doctor had no Staff navigation; list,
    detail, role and revocation calls returned 403 and kept them signed in.
  - **Audit and logs:**
    - exactly 4 `STAFF_CREATED`, 2 `STAFF_ROLE_CHANGED`, 4 `STAFF_STATUS_CHANGED` and
      2 `SESSION_REVOKED` events;
    - no password, hash or email in audit metadata;
    - no password, email, hash or staff number in API logs.
  - **Layout and accessibility:**
    - no overflow, the right layout and 44px controls at all five widths;
    - keyboard open, Tab trap, Escape and focus restoration;
    - axe WCAG 2.1 A/AA on the first-run and populated directories, the form with an
      error, the disable confirmation and the detail, with no violations;
    - empty browser storage, no unexpected console errors and no page errors.

## Limitations

- **No search:** the API has none; only role and status filters exist.
- **No identity edits:** names, emails and staff numbers can't be edited, and accounts
  can't be deleted.
- **Credentials:** the detail view has a **Password** section.
  - **Reset password** (active and suspended accounts) and **Set password** (pending accounts)
    open a dialog with a new and a confirm field. The confirmation is checked in the browser and
    never sent.
  - The dialog warns that a reset signs the person out everywhere, and says the password is never
    shown again.
  - Disabled accounts and your own account have no action; you use Change password in the menu
    instead.
  - There is no forced change or MFA.
- **Initial password delivery:** the administrator types it and must deliver it out of
  band.
- **No timestamps:** the DTO has no created, updated or last sign-in times.
- **No audit history:** the API does not expose one.
- **No session list:** sign-out can't report how many sessions existed.
- **Totals are separate reads:** they can briefly differ from the list during
  concurrent changes.
- **No proactive last-admin prediction:** the server's refusal is shown instead.
- **Disabled accounts:** role changes are hidden, although the API would accept them.
- **No sign-in explanation:** after a self change the sign-in screen does not say why
  the session ended.
- **Browser coverage:** live checks ran in Chrome only for this step.
