# Frontend authentication integration — Step 9

Authentication uses the existing database-backed backend session contract. This
step changes authentication only. Patient/appointment wiring already present in
the working tree was preserved; clinical, notification and report screens retain
their existing behavior and mocks. No new domain integration is introduced here.

## Findings and architecture

The 2026-10-28 review found this Step 9 implementation already present, with
58 auth tests and a clean working tree. It preserved that implementation and the
existing patient/appointment wiring. The changes in this review add cancellation
protection before API responses affect auth state, safe validation feedback, two
frontend regression tests, and CORS exposure of Retry-After with backend regression
coverage. No authentication/session/authorization semantics changed on the server.
See [current verification and file inventory](step-9-completion.md).

The earlier integration findings recorded below describe the previous baseline,
not missing functionality at the start of the 2026-10-28 review:

At the earlier inspection, concurrent work had already replaced the original role-selector
login with email/password requests, added credentialed fetch and `/auth/me`, and
connected some patient/appointment operations. It had no shared auth lifecycle,
treated session-check failures as ordinary signed-out state, fetched CSRF before
every mutation, lacked global session-loss handling and cleared the UI even when
logout failed. App also imposed an undocumented 20-minute idle timer and corrected
role navigation through an effect that raised the existing React lint warning.
No localStorage/sessionStorage auth persistence remained in the inspected source.

The existing API entry point, `client/src/lib/api.ts`, remains compatible for
concurrent modules. Its domain definitions and methods are preserved. Common
transport is extracted into `src/api/client.ts`; auth methods and safe identity
types live in `src/api/auth.ts`. The existing `ApiError`, `authApi`, BackendRole
and StaffUser exports are re-exported through the old entry point.

`features/auth/auth-store.ts` is a small in-memory external store subscribed through
React useSyncExternalStore. Its state distinguishes `loading`, `authenticated`,
`unauthenticated` and restoration `error`. It exposes login, refreshUser, logout
and logoutAll, without cookie/token handling. There is no persisted store or new
state-management/router dependency. The store and API revision guards ignore late
responses from an earlier session or restoration attempt.

`AuthGate` performs the initial abortable `/auth/me` call, displays a loading state,
shows connection/server failures with a retry button, presents Login on 401, and
mounts the application only for a valid authenticated identity. Cleanup aborts
restoration and the store ignores superseded results, including StrictMode's
initial effect replay. Successful login stores only the safe backend user.

## API client and credentials

The central client uses `VITE_API_URL`, default `/api/v1`, with a trailing slash
removed. Every request sets `credentials: include`, JSON Accept headers and
`cache: no-store`. JSON requests set Content-Type. Headers objects and AbortSignals
are supported. Components do not issue raw auth fetches.

The client parses the backend `{ success, data/error }` envelope. ApiError preserves
HTTP status, code, message and requestId, with numeric Retry-After when available.
The backend exposes Retry-After alongside X-Request-Id for credentialed CORS;
this makes the delay readable when VITE_API_URL specifies a separate same-site origin.
Malformed/non-JSON responses fail safely. Login/restoration/logout UI uses friendly
messages and a support reference, without displaying arbitrary stacks or proxy text.
Validation errors ask the user to check their submitted details. After response
body parsing, cancellation is checked before any global 401 side effect, so an
aborted restoration cannot invalidate a newer auth check.

The browser owns the HttpOnly `medicare_session` cookie. Application JavaScript
never reads it, copies it, creates it or persists a session token. No password,
identity, authentication token or CSRF token is stored in localStorage,
sessionStorage or IndexedDB. Password state is limited to the form and cleared
after a submitted attempt. Normal password-manager autocomplete remains available.

## Login and roles

POST `/auth/login` contains **only `{ email, password }`**. Email is trimmed;
password is unchanged. Login uses trusted Origin protection, not session CSRF.
It is never automatically retried. Duplicate submissions are blocked, fields and
submit are disabled while pending, and signing-in progress is visible. Invalid
credentials use a generic message, including inactive/unknown accounts. A 429
displays a retry-later message and, if available, an approximate Retry-After delay.

The safe StaffUser includes id, staffNumber, firstName, lastName, email, role and
ACTIVE status. Runtime selection drops extra fields and rejects unknown roles,
inactive identities and malformed responses. Backend roles are exactly ADMIN,
RECORDS_OFFICER and DOCTOR_IN_CHARGE. `app/navigation.ts` centrally maps those
enums to existing presentation labels and derives an allowed view. There is no
login role input, URL/localStorage role lookup or manual role switch.

This application currently navigates with in-memory `View` state, not URL routes.
AuthGate protects the entire shell and returns to the login view on session loss.
During restoration it does not mount either login or protected content. Admin
and Doctor land on Overview; Records Officer lands on Patients, following existing
navigation. Disallowed view requests fall back to the role's first allowed view
without an effect/setState loop. The shell is keyed by staff identity/role so a
new account cannot inherit the previous user's open dialogs or navigation state.
Frontend controls are presentation only; backend authorization remains authoritative.

## CSRF lifecycle

GET `/auth/csrf` returns the backend's independent session-bound 64-hex-character
synchronizer token. The helper validates and caches it in memory for that session,
coalescing concurrent retrievals. Authenticated mutations attach it to
`X-CSRF-Token`, with credentials. GET requests do not attach CSRF. Browser Origin
is supplied by the browser; the client does not spoof it.

Login attempts, successful logout/logout-all and authenticated 401 responses clear
the token cache and advance a session revision. Old pending token requests cannot
populate the new session or dispatch a mutation after the session changes.
CSRF_INVALID clears the cached token but does not sign out or replay the mutation.
The UI explains that the user can deliberately retry; that attempt retrieves a
current token. No POST/PATCH/DELETE request is automatically retried.

## Session loss, forbidden access and logout

Authenticated 401 responses invalidate in-memory identity and CSRF, unmount the
shell, and show Login. This covers eight-hour expiry, revoked sessions and account
suspension/disablement on the next authenticated request. Login's expected
INVALID_CREDENTIALS is excluded from global invalidation. Stale responses from a
previous API revision cannot invalidate a newly established session.

403 preserves authenticated state. Auth errors show permission or CSRF feedback;
other modules continue using their existing ApiError presentation. A forbidden
response is never converted into an automatic logout or login loop.

The existing profile sign-out control calls POST `/auth/logout` with CSRF. Success
clears identity and cached CSRF. Already-expired/invalid sessions returning 401
also clear stale state. Network/server/403 failures keep the current state and
show that sign-out could not be confirmed, with an explicit retry available through
the same control. Concurrent logout clicks share one pending operation.

`authApi.logoutAll()` and the store's logoutAll method use the same behavior with
POST `/auth/logout-all`. No new settings page is added: the current Settings
control is a placeholder, not an account/security interface.

The undocumented 20-minute frontend idle logout timer is removed. The backend's
fixed eight-hour session remains authoritative; no client extension, sliding
expiry, remember-me option or independent expiry calculation is introduced.

## UX and accessibility

The orange/dark login design and responsive stylesheet are retained. Email and
password have explicit associated labels, names and autocomplete values. Enter
submits the form; the visibility control is type=button with a pressed state and
an accessible changing label. Errors use role=alert, support references and input
descriptions. The form exposes aria-busy, restoration exposes a polite status,
disabled actions are visibly distinct, and auth controls have focus-visible outlines.
The profile control has an accessible Sign out label and pending disabled state.
No role-control accessibility references or remember-me input remain.

The auth/navigation effect causing the existing set-state-in-effect warning was
replaced with a derived allowed view, without suppressing the lint rule.

## Local development and deployment

```sh
npm install
npm run dev:server
# In a second terminal:
npm run dev:client
```

Configure PostgreSQL/backend as described in [server setup](../server/README.md).
Apply reviewed migrations and explicitly bootstrap a local administrator if needed;
there are no default or committed credentials. Open `http://localhost:5173`.
Backend CLIENT_ORIGIN must exactly equal that origin. The existing Vite proxy
forwards `/api` to `http://localhost:4000` and preserves Origin (`changeOrigin:false`).
`client/.env.example` documents the existing public `VITE_API_URL=/api/v1` convention.
No backend environment variables or authentication semantics changed.

Production needs HTTPS, an exact HTTPS CLIENT_ORIGIN, and a same-site frontend/API
deployment because the cookie is SameSite=Strict. Prefer a reverse proxy routing
`/api` to the backend. If using an explicit VITE_API_URL, configure credentialed
CORS for the exact frontend origin and keep both services same-site. Vite's proxy
is development-only; VITE_* settings are public build-time values, never secrets.
Do not solve origin errors by using wildcard CORS or relaxing cookie protections.

## Tests and verification limits

`npm run test:client` runs the frontend's Vitest tests. It reuses the repository's
Vitest version and adds jsdom for DOM behavior, without a large testing stack.
Tests cover credential payloads, runtime identity filtering, loading/error/401
restoration, role mapping, protected mounting, login UX, 429, logout/logout-all,
CSRF reuse/reset/rejection, mutation non-replay, stale response races, 403 handling,
storage/cookie non-access and preservation of existing mocks. Frontend tests are
included in typechecking and linting; backend tests remain unchanged.

For the 2026-10-28 review, the browser access host was unavailable. Native Edge
windows were listed, but no disposable database was configured for a live auth
flow: TEST_DATABASE_URL failed validation even with NODE_ENV=test. No real login,
bootstrap, refresh or logout verification was performed in this review. Prior
verification notes are not counted as current results. DOM tests are not a
substitute for real layout or browser cookie/CORS verification. Before rollout,
configure the isolated database suite and manually verify
the original 14-step login/refresh/logout flow at desktop and mobile widths,
keyboard focus, and production reverse-proxy cookie behavior.

There is no cross-tab logout broadcast, background auth polling, MFA, password
recovery/reset, device/session-management screen or new account provisioning UI.
Another tab observes session loss on its next authenticated request. A local
network failure can leave server logout unconfirmed, which is surfaced explicitly.
Existing non-auth integrations and mocks remain for their separately scoped steps.
