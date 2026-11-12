# First-login security: temporary passwords

Audience: the product owner, administrators and the hospital's IT and security reviewers.

A password chosen by an administrator is **temporary**. The staff member can sign in with it, but
until they replace it with a password of their own, Medicare shows only a "Change your temporary
password" screen. The API refuses every other request, so the change cannot be skipped by using
the interface differently or by calling the API directly.

## When a password is temporary

The state is stored in the database, as `StaffUser.mustChangePassword`.

| Event | `mustChangePassword` |
| --- | --- |
| An administrator creates an account with an initial password (`POST /api/v1/staff`) | Set to `true`, even though the account starts Active |
| An administrator resets a password (`POST /api/v1/staff/:id/reset-password`) | Set to `true` |
| An administrator gives a Pending account its first password (same endpoint) | Set to `true`; the account stays Pending until activated |
| The staff member changes their own password (`POST /api/v1/auth/change-password`) | Set to `false`, in the same transaction that replaces the password and signs out every session |
| A wrong current password, a refused new password or any other failed change | Unchanged |

**The first administrator** is created by the deployment operator with the bootstrap command. That
password comes from the protected deployment environment and is chosen by the person who will use
it, so it is not marked temporary. If that password was shared, change it with **Change password**
after the first sign-in.

**Disabled and suspended accounts** still cannot sign in. The flag never overrides account status.

## Migration and existing accounts

Migration `20261107090000_staff_temporary_password` adds
`"mustChangePassword" BOOLEAN NOT NULL DEFAULT false`:

- **Existing accounts:** keep their established passwords and are not interrupted. Only creations
  and resets made after the upgrade are marked temporary.
- **Locking:** PostgreSQL adds a column with a constant default without rewriting the table, so the
  migration is quick.
- **Grants:** the runtime role already has `SELECT, INSERT, UPDATE` on `StaffUser`, so the grant
  script needs no change. Rerun it after the migration as usual.
- **Earlier releases:** the previous API ignores the extra column.

## What the server allows while the password is temporary

Every protected route checks the flag inside the shared authentication middleware. The check is
on by default: a new protected route is restricted automatically. Only the account's own auth
routes opt in:

| Allowed | Purpose |
| --- | --- |
| `GET /api/v1/auth/me` | Reads the identity, including `mustChangePassword` |
| `GET /api/v1/auth/csrf` | Gets the CSRF token needed to change the password or sign out |
| `POST /api/v1/auth/change-password` | Replaces the temporary password (still CSRF-protected, trusted origin only, five refused attempts per 15 minutes) |
| `POST /api/v1/auth/logout`, `POST /api/v1/auth/logout-all` | Signs out |
| `GET /api/v1/health`, `GET /api/v1/health/ready` | Public; unchanged |

**Everything else is refused** with `403 PASSWORD_CHANGE_REQUIRED` ("Change your temporary password
to continue"):

- patients, admissions, encounters and medications, the medication catalog, notifications, staff, dashboard and reports;
- reads and writes alike.

Nothing is written.

**Defence in depth:** administrative security transactions recheck the flag after taking their
lock. An administrator holding a temporary password therefore cannot change roles, statuses,
passwords or sessions.

**The identity** returned by sign-in and `/auth/me` adds one boolean, `mustChangePassword`. No other
credential detail is exposed. Staff-administration responses are unchanged and do not carry the
flag.

## Changing the temporary password

The staff member enters the temporary password as the current password, then a new one twice:

- **Policy:** 15 to 128 characters, spaces allowed, never trimmed, stored with Argon2id. This is the
  existing policy, with no added complexity rules.
- **On success, in one transaction:**
  - the password is replaced;
  - the flag is cleared;
  - every session of the account is revoked;
  - `PASSWORD_CHANGED` is recorded.
- **Afterwards:** the browser returns to sign-in with "Password changed successfully. Sign in again
  with your new password." The temporary password no longer works, and the new password opens the
  normal workspace.

**Audit:** the existing events record the lifecycle.

- **Events:** `STAFF_CREATED` and `PASSWORD_RESET` (always a temporary credential), and
  `PASSWORD_CHANGED` (always a personal one).
- **Metadata:** stays `{ "source": "API" }`. The database's audit-metadata allowlist accepts nothing
  else.
- **Never recorded:** old, temporary or new passwords, hashes or the confirmation field, whether in
  audit events, logs or responses.

## The change screen

While the flag is set, the browser shows a full-screen page in the sign-in layout, with the
orange-and-white branding and theme control.

- **Wording:** the heading is "Change your temporary password", with the line "Your temporary
  password must be replaced before you can access Medicare."
- **Form:** "Current password", "New password" and "Confirm new password". The confirmation is
  checked in the browser and never sent.
- **Actions:** **Change password** and **Sign out** only. There is no Skip, Later or Continue.
- **Nothing else:** no navigation, workspace, install offer or hospital data is rendered. A deep
  link such as `/patients` still shows only this screen.
- **Mid-session:** if any request is refused with `PASSWORD_CHANGE_REQUIRED`, the browser re-reads
  the identity and switches to this screen.

## Forgotten passwords

The sign-in page has a **Forgot your password?** link. It shows "Contact your system administrator
to reset your password." and nothing else:

- no request is sent;
- nothing reveals whether an account exists;
- there is no email reset (not part of this release).

**Administrator-assisted recovery:**

1. The staff member reports the forgotten password.
2. The hospital verifies their identity with its approved internal procedure.
3. An administrator opens the person in **Staff & Access** and selects **Reset password**. This signs
   them out everywhere.
4. The administrator gives the temporary password through the hospital's approved secure channel.
   Medicare never shows it again.
5. The staff member signs in with it.
6. Medicare requires a new password before anything else.
7. The staff member signs in again with their own password.

## Verification

**Automated tests:**

- **`server/tests/first-login.database.test.ts` (11 tests, fresh database, all twelve
  migrations):**
  - every way a password becomes temporary, and the migration default for existing accounts;
  - audit content;
  - the identity flag;
  - refusal of every application route and write (patients, appointments, encounters,
    notifications, staff, dashboard, reports);
  - the allowed auth routes;
  - CSRF and origin on the change;
  - disabled and suspended accounts;
  - wrong, invalid and unchanged passwords leaving the flag set;
  - the atomic clear with session revocation;
  - the reset cycle, and a flagged administrator.
- **`server/tests/auth.database.test.ts`:** new accounts are now asserted to start temporary.
- **`client/tests/first-login-ui.test.tsx` (10 tests):**
  - the change screen with no workspace, menu or skip;
  - sign-out;
  - local validation, with the confirmation never sent;
  - the wrong-password state;
  - the success message, then the normal workspace on the next sign-in;
  - the 403 switch;
  - Forgot your password? (no request, no enumeration);
  - no install offer before the change;
  - strict identity parsing.

**Live, on the production build** (HTTPS gateway with the runbook headers, production API on the
restricted runtime role, synthetic data):

- **New account (21 of 21 checks):**
  - an administrator created it in the UI;
  - the temporary password reached only the change screen, including from a deep link;
  - direct API calls from the signed-in page were refused and wrote nothing;
  - after the change the old session cookie and the temporary password were refused;
  - the personal password opened the workspace.
- **Administrator reset (6 of 6):**
  - the person's working session stopped at once;
  - the reset password reached only the change screen;
  - a wrong current password kept the requirement;
  - after the change, sign-in was normal and the role was unchanged.
- **Browsers:** Chrome, Edge and the Firefox engine each completed the forgot-password guidance,
  the change screen, the API refusal, the change and re-login.
- **Logs:** no temporary, reset or personal password appeared in the API log, and audit metadata
  held none.

## Limitations

- Administrators still type the temporary password and must deliver it securely. Medicare does not
  generate or send it.
- There is no expiry on an unused temporary password. An administrator can reset again at any time.
- No emailed reset link, MFA or self-service recovery.
- The bootstrap administrator's password is not marked temporary (see above).
- The flag is not shown in the staff directory.
