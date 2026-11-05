# Production security hardening

This document records how Medicare protects accounts, sessions, clinical records and logs in
production, what the deployment must provide, and what remains a known limitation. It describes
the application as delivered; it is not a certification. Operating steps are in the
[release operations runbook](release-operations.md).

## Authentication and the password lifecycle

- **Sign-in:** email and password only. Passwords are hashed with Argon2id (64 MiB memory, three
  passes, one lane, 32-byte hash) and verified by the `argon2` library, which compares in
  constant time.
  - Unknown, pending, suspended and disabled accounts get the same answer and comparable password
    work, so the response does not reveal whether an account exists.
- **Policy:** 15 to 128 characters, counted as typed. Passwords are never trimmed or normalised,
  may not be only spaces, and may not contain NUL. There are no hints, no security questions and
  no composition rules.
- **Changing your own password** (`POST /api/v1/auth/change-password`) requires the current
  password and a new one that meets the policy and differs from it.
  - **Sessions:** the change signs out every session the account holds, including the current one.
  - **Audit:** it records `PASSWORD_CHANGED` with no password-related content.
  - **Rate limit:** refused attempts are limited to five per account per 15 minutes, so a stolen
    session cannot be used to guess the current password quickly.
  - **Concurrency:** if the password is changed or reset while a change is in progress, the later
    change is refused (`PASSWORD_CHANGED_ELSEWHERE`).
- **Administrator reset and first password** (`POST /api/v1/staff/:id/reset-password`, Admin only)
  sets a new password without needing the old one.
  - **Sessions:** it signs out every session of the target account.
  - **Pending accounts:** the reset gives a pending account its first password; activation stays a
    separate status change.
  - **Refused targets:** disabled accounts are refused (`ACCOUNT_DISABLED`). Administrators cannot
    reset their own password this way (`SELF_PASSWORD_RESET`); they use Change password, which
    asks for the current password.
  - **Audit and response:** the reset records `PASSWORD_RESET`. It does not change role or status,
    so the last-active-administrator rule is unaffected. The response contains only the safe staff
    fields.
- **Handover:** there is no emailed reset link and no self-service recovery, because the
  deployment has no approved mail service. An administrator hands a new password to the staff
  member through the hospital's approved secure channel.
- **Never kept or shown:** passwords and their confirmation are never stored in the browser,
  logged, echoed in errors, written to audit metadata or returned by the API. The confirmation
  field is checked in the browser and never sent.

## Sessions

- **Tokens:** 256-bit random tokens, stored only as SHA-256 digests. Each session has its own CSRF
  token.
- **Lifetime:** sessions expire eight hours after sign-in, with no sliding renewal.
- **What ends a session:**
  - sign-out, or "sign out everywhere";
  - a change to the account's role or status;
  - an administrator signing the account out;
  - a password change or reset.
- **Revalidation:** every request checks the session, its expiry and the account's status.
  Security-sensitive changes recheck the signed-in actor after taking a database lock.
- **Pruning:** `npm run sessions:prune --workspace @medicare/server` deletes sessions whose expiry
  has passed. Revoked sessions are deleted once their expiry passes, at most eight hours later.
  Active sessions are never touched. See the runbook for the daily schedule.

## Cookies

| Attribute | Production value |
| --- | --- |
| Name | `__Host-medicare_session` (development uses `medicare_session`) |
| `HttpOnly` | Yes; not readable by page scripts |
| `Secure` | Yes, always in production, independent of proxy headers |
| `SameSite` | `Strict` |
| `Path` | `/` |
| `Domain` | Not set (host-only) |
| Lifetime | `Expires` eight hours after sign-in |

The `__Host-` prefix makes browsers reject the cookie unless it is Secure, host-only and on `/`.
A sibling subdomain or a plain-HTTP page therefore cannot plant or overwrite it. Duplicate
session cookies are refused rather than guessed between.

`SameSite=Strict` requires a same-origin deployment: the browser application and `/api/v1` on one
HTTPS origin.

## CSRF and origin checks

- **Origin header:** every state-changing request must carry an `Origin` header equal to
  `CLIENT_ORIGIN`.
- **CSRF token:** every state-changing request also needs an `X-CSRF-Token` header matching the
  session's token, compared in constant time.
- **Sign-in:** requires the trusted origin.
- **Order of checks:** authentication, CSRF, role and permission checks all run before any write
  or retry-record lookup. A refused request never consumes an `Idempotency-Key`.

## CORS

- **Allowed origin:** exactly one, `CLIENT_ORIGIN`, which must be HTTPS in production. There is
  no wildcard. `null`, other schemes, ports, suffixes and trailing slashes are refused with `403`
  and no CORS headers.
- **Credentials:** allowed only for that origin.
- **Methods:** `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`.
- **Request headers:** `Content-Type`, `X-CSRF-Token`, `Idempotency-Key`, `X-Request-Id`.
- **Exposed response headers:** `X-Request-Id`, `Retry-After`, `Idempotency-Replayed`.

## Proxy trust and client addresses

- **Required setting:** production refuses to start without `TRUSTED_PROXY_CIDRS`. Use the
  reverse proxy's exact addresses or bounded ranges, or `none` for direct connections.
  - `true`, `*`, `/0` ranges and hostnames are rejected.
- **Untrusted peers:** forwarding headers from an untrusted peer are ignored, so a client cannot
  choose its own address for sign-in limiting or audit records. This was verified live:
  rotating `X-Forwarded-For` values sent straight to an API with no trusted proxy did not escape
  the limit.
- **HTTPS:** the API does not use `X-Forwarded-Proto` to decide anything; cookies are always
  `Secure` in production. HTTPS termination, redirection and HSTS for the browser application
  belong to the reverse proxy.

## Rate limiting

- **Sign-in:** 10 refused attempts per client address per 15 minutes. Successful sign-ins do not
  count.
- **Password change:** 5 refused attempts per account per 15 minutes.
- **Single instance only:** counters are held in each API process. A restart resets them, and
  separate instances do not share them.
  - The supported deployment is one API instance. Running several instances multiplies the
    effective limits, so add a shared limiter store before scaling out.
- **Shared addresses:** staff behind one hospital NAT address share a sign-in budget.
- **No account lockout:** guessing against one account from many addresses is slowed only by
  Argon2id cost and per-address limits.

## Security headers

**API responses (Helmet):**

- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Cross-Origin-Resource-Policy: same-origin`
- `Cache-Control: no-store` on authentication, staff and health routes
- No `X-Powered-By`

**Browser application:** the web server that serves `client/dist` sets its headers (exact values
in the runbook). The tested policy is:

```text
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self';
object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
```

There is no `unsafe-inline` and no `unsafe-eval`. The theme bootstrap `theme-init.js` is a
same-origin file, so `script-src 'self'` allows it.

- **Browsers:** Chrome, Edge and the Firefox engine ran the application under this policy with no
  violations.
- **Script-set styles:** the application sets a few styles from script (chart positions, report bar
  widths and the dialog scroll lock), which CSP allows. It writes no `style` attribute in markup.
- **WebKit:** the Windows WebKit engine reports `style-src-attr` refusals for those script-set
  styles, but staging showed it applies them exactly as Chrome does. Safari must be checked on
  Apple devices.
- **Correction:** this corrects an earlier statement that the application sets no inline styles.

## Database roles and immutability

| Identity | Privileges | Used for |
| --- | --- | --- |
| Migration / owner | Owns the schema and tables | `prisma migrate deploy` and `server/ops/runtime-grants.sql`, during controlled deployment only |
| Runtime | Exactly the privileges `server/ops/runtime-grants.sql` grants | The API and the maintenance commands |

**Runtime role:** not a superuser, no `CREATEROLE`, `CREATEDB`, `REPLICATION` or `BYPASSRLS`, and
no membership in the owner role. The grant script refuses to run if any of these is wrong.

**Runtime table privileges:**

| Privilege | Tables |
| --- | --- |
| `SELECT` | Every application table |
| `INSERT, UPDATE` | Staff, sessions, patients, appointments, encounters, notification recipients |
| `INSERT` only | Audit events, amendments, notifications, retry records, complaints, diagnoses |
| `DELETE` | Draft complaints and diagnoses, expired retry records, expired sessions |
| None | The migration history |

**Database protections that apply whatever the privileges:**

- triggers keep finalized encounters and their complaints and diagnoses unchangeable;
- amendments, audit events and notifications are append-only;
- a notification is marked read only once;
- retry records are never updated.

**Attack check under the runtime role** (repeated on a restored copy). These attempts were all
refused:

- editing, deleting or truncating a finalized record;
- adding or deleting its complaints and diagnoses;
- changing or deleting amendments;
- changing, deleting or truncating audit events;
- changing retry records or notifications;
- disabling or dropping triggers, or replacing a trigger function;
- setting `session_replication_role`;
- creating tables;
- reading the migration history;
- granting itself superuser or `BYPASSRLS`.

The owner identity can still disable triggers, so protect it and never use it for the
application.

## Logging and redaction

- **What is logged:** HTTP logs are an allowlist of timestamp, level, service, request ID, method,
  status and response time. URLs, query strings, headers, cookies and bodies are never logged.
- **Errors:** error entries carry only a fixed classification code, never messages or stacks.
- **Redaction:** the logger also removes these fields wherever they appear:
  - passwords (`password`, `currentPassword`, `newPassword`, `confirmPassword`) and password
    hashes;
  - session tokens, CSRF values, `Idempotency-Key`, cookies and `Authorization`;
  - database URLs;
  - patient demographics, clinical text, complaints, diagnoses, amendments, appointment reasons
    and notes, and notification titles and bodies.
- **Live scan:** after the hardening walkthrough, the API logs contained none of the synthetic
  passwords, session tokens, CSRF values, idempotency keys, clinical text, broadcast body, phone
  numbers or emails used.
- **Support references:** every response carries `X-Request-Id`, and error bodies repeat it as
  `requestId`. The browser shows it as a support reference, and the matching log entry has the
  same ID. Stack traces are never sent to the browser.

## Idempotency

- **Covered operations:** patient registration, encounter creation, broadcasts and staff creation
  accept an `Idempotency-Key`. The Medicare frontend sends one for each.
- **Replay rules:** a resend with the same key and the same accepted input, by the same staff
  account, returns the original result (`Idempotency-Replayed: true`) and writes nothing.
  Changed input under the same key is refused (`IDEMPOTENCY_KEY_REUSED`).
- **Concurrency:** concurrent identical requests produce one record.
- **What is stored:** a digest of the key and a keyed digest of the accepted input. For staff
  creation the input includes only a SHA-256 digest of the password, and the stored value is an
  HMAC keyed by the raw key, which is never stored. Neither the password nor a testable digest
  of it is stored.
- **Pruning:** records expire after 24 hours and are pruned daily
  (`npm run idempotency:prune --workspace @medicare/server`).

## Secret handling

- **Secret store only:** keep `DATABASE_URL`, the bootstrap administrator password and database
  role passwords in the deployment secret store.
  - Never in source control, Vite variables, tickets, screenshots or shell history.
- **Local configuration:** `server/.env` is ignored by Git and must not be copied into a delivered
  build.
- **Review result:** the repository and its whole history contain no real credentials, keys or
  tokens; test files use synthetic values only. One local, ignored development file holds a local
  database password (location in the hardening report). Rotate it if that password is used
  anywhere other than the developer's own machine.
- **Delivered source:** scratch QA files from earlier acceptance runs (`.release-*` in the
  repository root) are tracked and should be removed from the delivered source by the project
  owner.

## Known limitations

1. **Rate limiting:** in-process only, single API instance.
2. **Account recovery:** no self-service recovery, email reset or multi-factor authentication.
   Resets are administrator-mediated.
3. **Retry protection:** clients that send no `Idempotency-Key` get none. Appointment booking,
   edits and status changes rely on conflict checks instead.
4. **Browsers:** Safari and stock Firefox were not tested; the Firefox and WebKit engines were.
   Saved-password autofill in both themes and Windows high-contrast mode need a manual check on
   hospital devices.
5. **Assistive technology:** no screen-reader test was performed.
6. **Provider services:** encryption at rest, network isolation, TLS certificates, backups,
   monitoring and alerting are deployment responsibilities. The repository provides commands and
   checks, not those services.
