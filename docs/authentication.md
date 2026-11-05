# Staff authentication and administration (Step 3)

The backend now authenticates staff using PostgreSQL sessions. The existing
Argon2id password utilities, append-only audits, bootstrap CLI, request IDs,
safe errors, database pool and health/lifecycle behavior remain in use. The
frontend now uses these endpoints for email/password login, session restoration
and logout, with backend roles as its identity source. See
[frontend authentication integration](frontend-auth-integration.md). Later backend
steps add clinical permissions and domain APIs.

The Admin-only Staff & Access workspace uses the staff routes below without any
backend change. It shows only the safe staff DTO and creates accounts with the
administrator-entered staff number and initial password. It offers only the lifecycle
transitions listed here. It explains last-admin and other refusals, and returns to
sign-in after a self change ends the current session. See the
[staff administration frontend](frontend-staff-administration.md).

**Credential lifecycle:**

- **Changing your own password** (`POST /auth/change-password`, `{ currentPassword, newPassword }`)
  requires the current password. It signs out every session of the account, including this one,
  clears the cookie and records `PASSWORD_CHANGED`.
  - Refusals: `CURRENT_PASSWORD_INVALID` (400), `PASSWORD_UNCHANGED` (400) and
    `PASSWORD_CHANGED_ELSEWHERE` (409).
  - Refused attempts are limited to five per account per 15 minutes
    (`PASSWORD_CHANGE_RATE_LIMITED`, 429).
- **Administrator reset** (`POST /staff/:id/reset-password`, `{ password }`, Admin only) sets new
  credentials without the old password. It signs out every session of the target and records
  `PASSWORD_RESET`.
  - It gives a pending account its first password without activating it.
  - It refuses disabled accounts (`ACCOUNT_DISABLED`) and the administrator's own account
    (`SELF_PASSWORD_RESET`; use Change password).
- **Policy and handling:** both use the same 15–128 character policy and Argon2id. No password,
  confirmation or digest is returned, logged or audited.
- **Not available:** an emailed reset link or self-service recovery.

See [production security hardening](production-security-hardening.md).

## Sessions and cookies

`StaffSession` belongs to a `StaffUser` through a restrictive foreign key. It has
a UUID, unique SHA-256 `tokenHash`, independent random `csrfToken`, creation time,
absolute expiry and nullable revocation time. User/revocation and expiry indexes
support account revocation and eventual cleanup. There is no last-seen write,
idle timeout, session IP tracking or background cleanup worker in this step.

Each login creates a fresh 32-byte cryptographically random token, encoded as
64 hexadecimal characters. Only its SHA-256 digest is persisted. Fast hashing
is suitable for indexed lookup of a 256-bit random secret; human passwords
continue to use salted, deliberately expensive Argon2id. No password rehash
strategy is introduced. Sessions expire after **eight hours**, without sliding
renewal, and multiple simultaneous sessions are supported. Expired/revoked rows
never authenticate and may later be removed under an explicit retention policy.

The raw authentication token is issued only in the `medicare_session` cookie:

| Option | Behavior |
| --- | --- |
| HttpOnly | Always true; JavaScript cannot read authentication token |
| Secure | Always true in production, false for local development/test HTTP |
| SameSite | Strict; same-site frontend/API deployment required |
| Path | `/` |
| Domain | Unset (host-only) |
| Expires | Session's absolute expiration |

Cookie setting/clearing is centralized in `modules/auth/cookies.ts`. Duplicate
or malformed session cookies are rejected. A login ignores existing session
identifiers and issues a new one. Authentication tokens, their hashes and CSRF
tokens are excluded from logs, staff DTOs and audits. Auth/staff responses use
`Cache-Control: no-store`.

## CSRF and trusted origins

This implementation uses the session-bound synchronizer pattern described in
[OWASP's CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
Every session stores an independent random 32-byte CSRF token, retrievable through
authenticated `GET /api/v1/auth/csrf`. It returns
`{ "success": true, "data": { "csrfToken": "..." } }`. This token is deliberately
readable by the frontend and cannot authenticate a request by itself.
It contains neither the session authentication token nor its hash. It is stored
as a synchronizer value, not a password or authentication bearer token.

The frontend uses credentialed fetch, retains CSRF in memory,
and sends it in `X-CSRF-Token` on authenticated POST/PUT/PATCH/DELETE requests.
The server checks format and constant-time equality against the current session.
The token remains stable for that session, so concurrent tabs do not invalidate
each other's tokens. No readable CSRF cookie, server-wide signing secret or
token rotation endpoint is needed. GET/HEAD/OPTIONS do not require CSRF.

All authenticated mutations additionally require an exact `Origin` equal to
`CLIENT_ORIGIN`. Login separately requires that Origin before credential
verification; it does not need a pre-authentication session. CLI clients must
also send the configured Origin for these actions. CORS allows credentials
only for the configured exact origin and allows `X-CSRF-Token`; it never uses
a wildcard origin. Probes and non-browser safe requests may omit Origin.
Production configuration requires an HTTPS client origin. SameSite is an
additional protection, not a replacement for explicit CSRF checks.

## Login, identity and authorization

Login accepts only `{email, password}`. Strict Zod validation rejects role,
status, user ID or other extra fields. Email is trimmed/lowercased consistently
with bootstrap/provisioning. Passwords are not trimmed or normalized. Unknown
email, incorrect password and PENDING/SUSPENDED/DISABLED accounts all return
401 `INVALID_CREDENTIALS` with the same message. A random dummy password hash
provides comparable verification work for unknown accounts; this is not a
claim of perfectly constant end-to-end timing.

Password work happens outside the transaction/lock. The transaction then
rechecks current credentials and ACTIVE status before atomically creating the
session, updating `lastLoginAt`, and appending `LOGIN_SUCCEEDED`. A failed audit
write rolls back the entire change. Only after commit is the cookie issued.

`requireAuth` reads/hashes the cookie, checks expiry/revocation, and selects the
current ACTIVE staff member from PostgreSQL on every request. Its dedicated
principal contains only `id`, `staffNumber`, `firstName`, `lastName`, `email`,
`role`, `status`. It never contains a password hash. The same explicit select
defines all staff responses. The internal request auth context separately holds
the session ID and CSRF value and is redacted from logs.

`requireRole` supports the existing ADMIN, RECORDS_OFFICER and DOCTOR_IN_CHARGE
enums. ADMIN alone can administer staff. All three active roles can read their
own identity/CSRF and log out. Roles never come from headers, query strings,
login input or cached browser state. Unauthenticated access returns 401;
authenticated access without the role returns 403 `FORBIDDEN`.

## Routes

All paths below are prefixed by `/api/v1`. Success responses preserve
`{success:true,data:...}`; errors preserve `{success:false,error:{code,message,requestId}}`.

| Method/path | Permission | Request/result |
| --- | --- | --- |
| POST `/auth/login` | Trusted Origin; rate limited | Email/password; returns `data.user`, sets cookie |
| GET `/auth/me` | Any active session | `data.user` from session identity |
| GET `/auth/csrf` | Any active session | `data.csrfToken` |
| POST `/auth/logout` | Session + Origin + CSRF | Revoke current session, clear cookie; `data.loggedOut` |
| POST `/auth/logout-all` | Session + Origin + CSRF | Revoke all own sessions including current, clear cookie |
| POST `/staff` | ADMIN + Origin + CSRF | Create account; 201 with `data.user` |
| GET `/staff` | ADMIN | `data.users`, `data.pagination` |
| GET `/staff/:id` | ADMIN | `data.user`; UUID validated |
| PATCH `/staff/:id/role` | ADMIN + Origin + CSRF | Strict `{role}`; `data.user` |
| PATCH `/staff/:id/status` | ADMIN + Origin + CSRF | Strict `{status}`; `data.user` |
| DELETE `/staff/:id/sessions` | ADMIN + Origin + CSRF | Revoke all target sessions; `data.revoked` |

Logout replay returns 401 without further state changes or duplicate audits;
the first successful call revokes the server record and clears the cookie. A
failed persistence/audit write does not clear the cookie or pretend success.
Logout-all never revokes another account's sessions.

Staff creation requires `staffNumber`, `firstName`, `lastName`, `email`, `role`
and `password`. The institution staff-number format and 15-128-code-point
password policy are reused. The account is created ACTIVE with the admin-assigned
initial password; `passwordChangedAt` records this provisioning time. Passwords
are neither returned nor logged. Secure delivery of the initial password remains
an operational responsibility. Creation accepts an `Idempotency-Key`: an identical resend by the
same administrator returns the original account (see [mutation idempotency](idempotency.md)).
Administrators can reset passwords and set a pending account's first password (above). Forced
password change, self-service recovery, email verification and MFA are not implemented or
implied. The out-of-band CLI remains
the sole first-admin bootstrap mechanism; there is no public registration API.

List defaults: `page=1&limit=20`; limit 1-100 and page 1-100000. Optional exact
`role` and `status` filters are supported; no search endpoint is introduced.
Ordering is creation time descending, then UUID ascending. Count and page are
independent reads and may reflect concurrent changes; no snapshot guarantee is
claimed. No arbitrary staff PATCH or delete-account API exists.

## Lifecycle, concurrency and revocation

| Current status | Allowed next status |
| --- | --- |
| PENDING | ACTIVE (requires existing credentials), DISABLED |
| ACTIVE | SUSPENDED, DISABLED |
| SUSPENDED | ACTIVE, DISABLED |
| DISABLED | None; terminal in this API |

Same-status requests return `INVALID_STATUS_TRANSITION`. Roles must be one of
the three supported values; submitting the existing role is an explicit
reassertion that still revokes sessions and audits the role command.

All role/status commands revoke every target session, including the current
one for self changes. A fresh login is required after reactivation. Admin session
revocation also revokes all target sessions and clears the caller's cookie if
targeting themselves. The actor session/status/role is rechecked inside the
transaction after waiting for the security lock.

An ACTIVE ADMIN cannot be demoted, suspended or disabled if this would leave
zero ACTIVE ADMIN accounts. Pending/disabled administrators do not count. Self
demotion/suspension is allowed when another active administrator remains.

Every authentication/security write and the existing bootstrap share PostgreSQL
transaction advisory lock `(1296385106, 1)`, under READ COMMITTED. Each waiter
sees the preceding transaction's committed changes before checking actor and
last-admin conditions. This serializes competing counts/mutations across API
instances and prevents a login racing a role/status revocation from retaining
stale privileges. Mutation, revocation and audit commit together. Expensive
Argon2 hashing/verification stays outside the lock.

This invariant applies to cooperating application paths; privileged direct SQL
can bypass it. Future administrative writers must use the same strategy. The
global lock favors simple correctness at this stage; it limits security-write
throughput and should be load-tested before large deployments. Existing bounded
database query/transaction timeouts fail safely under contention. Already-running
read requests are not cancelled retroactively by revocation.

## Abuse protection, auditing and operations

`express-rate-limit` 8.7 provides **10 failed login requests per IP per 15 minutes**,
with temporary 429 `LOGIN_RATE_LIMITED`, standard rate-limit headers and
`Retry-After`. Successful sign-ins are not counted, so staff who share a proxy or
NAT address are not blocked at shift change; repeated failures from that shared
address still affect everyone behind it. IPv6 grouping uses the package's
default /56 subnet. There is no permanent account lockout or per-account failure
counter. The current store is in-process: restart resets it and multiple API
instances do not share it. **A shared backing store is required before scaling
the API to multiple instances.** Edge-level limits should supplement this layer.

`TRUSTED_PROXY_CIDRS` is the only added environment variable. In development, empty (the
default) means no proxy trust. Production refuses to start without it: give the proxy addresses,
or `none` for direct connections. Set a comma-separated list of actual reverse-proxy IPs or
CIDRs; booleans, numeric hop counts and /0 networks are rejected. Do not trust
all peers. The reverse proxy must overwrite forwarded headers and restrict direct
access to the API. Untrusted forwarding headers cannot select the rate-limit key.
Trust configuration must match the deployment topology; large trusted ranges
remain an operator responsibility.

HTTP audits include request ID, a syntactically valid IP address and only a
coarse browser-family classification (Chrome/Edge/Firefox/Safari/Other), avoiding
arbitrary user-agent content. Neither IP nor browser family is trusted identity.
Treat IPs as sensitive operational data with an explicit retention/access policy.

Audited actions: LOGIN_SUCCEEDED, LOGIN_FAILED, LOGOUT, SESSION_REVOKED,
STAFF_CREATED, STAFF_ROLE_CHANGED and STAFF_STATUS_CHANGED. Logout-all and admin
revocation use SESSION_REVOKED; role/status audit events also represent their
atomic automatic revocation. LOGIN_FAILED has no actor or attempted email;
`AUTH_ATTEMPT` identifies a random attempt UUID rather than a real staff identity.
Rejected input, origin, CSRF, authorization and rate-limit responses are recorded
in metadata-only HTTP logs, not fabricated as credential-failure audits.

Existing append-only triggers and metadata allowlists are preserved. Audit
failure fails the associated write closed. Logs omit bodies/URLs/headers and
redact password/hash, session/hash, CSRF, Cookie/Set-Cookie and authorization
fields. Do not log arbitrary strings containing credentials: field redaction
cannot sanitize secrets embedded in a log message.

Deploy with HTTPS, same-site UI/API and explicit CLIENT_ORIGIN. TLS termination,
database TLS/encryption at rest, least-privilege runtime credentials, separate
migration credentials, protected backups, monitoring, retention and incident
response remain deployment responsibilities. The Prisma pool remains bounded
at ten connections per process; size total connections across replicas and check
any transaction-pooler's behavior with interactive transactions/advisory locks.
No certification or regulatory compliance claim is made.

## Migration and verification

`20261002120000_staff_auth_sessions` adds StaffSession, the StaffUser relation,
hash/CSRF/expiry checks and indexes; extends AuditAction with LOGOUT and
SESSION_REVOKED; and extends AuditEntityType with AUTH_ATTEMPT. Apply reviewed
migrations with `npm run prisma:migrate:deploy`; never substitute `db push`.

`npm run test:database` rebuilds the backend first so subprocess tests exercise
the current compiled production CLI/server, with the original assertions and
startup time limits. It gives each database test file its own generated
`medicare_test_run_<32 hex>` database. It validates, deploys all migrations twice,
runs the suite and drops only that generated database. Existing loopback,
explicit NODE_ENV=test, test-only naming and no-DATABASE_URL-fallback guards
remain. This keeps new admin fixtures from interfering with bootstrap tests.
The control database is never reset. Interrupted runs may leave generated test
databases for operator cleanup.

Integration coverage includes cookies and hash-only authentication storage,
expiry/account enforcement, CSRF/session binding, all roles/routes, lifecycle,
concurrent last-admin removal, actor revalidation after lock waits, atomic
rollback on injected audit failure, duplicate identities, secret-free outputs,
rate limits and production error privacy. Existing domain, bootstrap, readiness
and process lifecycle tests remain required.

Next: design the clinical authorization/record-change rules and approve the next
bounded API phase. Frontend integration and password management remain separate
steps; this change does not start them.

## Changed files

Created:

```text
server/src/middleware/authentication.ts
server/src/modules/auth/auth.context.ts
server/src/modules/auth/auth.routes.ts
server/src/modules/auth/auth.service.ts
server/src/modules/auth/cookies.ts
server/src/modules/auth/security.transaction.ts
server/src/modules/auth/session.service.ts
server/src/modules/staff/staff.dto.ts
server/src/modules/staff/staff.routes.ts
server/src/modules/staff/staff.service.ts
server/prisma/migrations/20261002120000_staff_auth_sessions/migration.sql
server/tests/auth.database.test.ts
docs/authentication.md
```

Modified:

```text
server/src/app.ts
server/src/server.ts
server/src/config/env.ts
server/src/modules/staff/staff.validation.ts
server/src/shared/audit/audit.ts
server/src/shared/logger/logger.ts
server/prisma/schema.prisma
server/tests/env.test.ts
server/tests/logger.test.ts
server/tests/domain.database.test.ts
server/tests/bootstrap.database.test.ts
server/tests/lifecycle.database.test.ts
server/tests/runDatabaseTests.ts
server/.env.example
server/package.json
package-lock.json
README.md
server/README.md
docs/architecture.md
docs/data-model.md
```

Generated Prisma client/build outputs are recreated by the existing scripts and
remain ignored. The only added direct dependency is `express-rate-limit`.

## Verification results (2026-10-03)

| Check | Result |
| --- | --- |
| Dependency installation | Passed; npm reported zero vulnerabilities |
| Prisma generation and validation | Passed |
| Typecheck | Passed for both workspaces and server tests |
| Lint | Passed; backend clean, one pre-existing frontend `react(set-state-in-effect)` warning at `client/src/app/App.tsx:45` |
| Database-independent tests | 61 passed across 6 files |
| Authentication/staff database tests | 99 passed |
| Bootstrap database tests | 6 passed |
| Domain database tests | 14 passed |
| Server lifecycle database tests | 3 passed |
| Readiness database test | 1 passed |
| Total | 184 passed across 11 files; 110 additional test cases since Step 2 |
| Production build | Both frontend and backend passed |
| Fresh migration deployment | All three migrations applied to each disposable database |
| Migration reapplication | No pending migrations for each database |
| Whitespace check | `git diff --check` passed |

The final complete `npm run test:database` run passed all 123 database tests.
Earlier runs encountered environment-related process startup timeouts; the
successful run retained the original bootstrap/lifecycle deadlines and assertions.
Process tests now exercise freshly compiled production artifacts. The temporary
PostgreSQL cluster was stopped and removed after verification; no configured
application database was reset. Frontend source and simulated behavior remain
unchanged, and no clinical/domain CRUD or frontend integration was added.
