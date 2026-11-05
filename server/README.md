# Medicare API foundation

Node.js, strict TypeScript, Express 5, PostgreSQL, Prisma 7, Zod, Pino, Helmet,
CORS, Vitest, and Supertest. The foundation now includes the hospital domain
schema, reviewed migrations, an explicit first-administrator CLI, database-backed
staff authentication, staff administration, patient demographics, appointment scheduling,
clinical encounters, persistent internal staff notifications, and role-scoped dashboard/report aggregates.
See [dashboard and reports API](../docs/dashboard-reports-api.md) for the four GET routes,
UTC ranges, metric definitions, permissions, clinical access audits and frontend gaps.
Step 8 adds no report exports or dashboard/report frontend integration.
See [notification API](../docs/notifications-api.md) for own-inbox access, read state,
admin broadcasts, generic appointment notices and transactional delivery. Step 7
does not integrate notification screens or change frontend code.
See [clinical records API](../docs/clinical-records-api.md) for doctor-only clinical
access, draft/finalization rules, immutable history, amendments and audit behavior.
See [appointment API and scheduling policy](../docs/appointment-api.md) for doctor
scope, lifecycle, UTC inputs, conflict constraints and PostgreSQL extension requirements.
See [patient API and permission policy](../docs/patient-api.md) for the six patient
routes, validation, duplicate handling, archival, audit and frontend differences.
See [authentication](../docs/authentication.md)
for the session/CSRF design, complete route contract, lifecycle, audit and limits.

See the [data model and identity guide](../docs/data-model.md) for all entities,
relationships, roles/lifecycles, identifiers, indexes, deletion policies,
UTC timestamps, audit protections, sensitive-data considerations and UI mismatches.

## Local setup

Use Node.js 22.12+ on the 22.x line, or a supported newer LTS release, and npm 10+.
Install PostgreSQL locally or use a dedicated development PostgreSQL instance.
The database and its role must already exist, with credentials you control.
Use a separate test database for the opt-in connectivity suite. Never run
development migrations against a production database.

From the repository root:

```sh
npm install
```

Copy `server/.env.example` to `server/.env` and replace `CHANGE_ME` and the
connection details with your local database credentials. In PowerShell:

```powershell
Copy-Item server/.env.example server/.env
```

Then run:

```sh
npm run prisma:generate
npm run prisma:migrate:deploy
npm run dev:server
```

The API defaults to port 4000. Run `npm run dev:client` in another terminal for
the frontend. `npm run dev` retains the existing frontend-only behavior.
Frontend login now uses real sessions; see [frontend authentication](../docs/frontend-auth-integration.md).
Use `CLIENT_ORIGIN=http://localhost:5173` with the existing Vite proxy. CORS exposes
`Retry-After` so an explicit same-site API URL can show login rate-limit delays.
Authentication, patients, appointments and clinical records use the server APIs.
Staff management, notifications, dashboard analytics and reports/exports remain
explicitly unavailable in the frontend. See the [release readiness report](../docs/release-readiness-report.md)
for deployment prerequisites and the verified release scope.

## Configuration

All application environment reads are centralized in `src/config/env.ts`.
It loads `server/.env` without overriding existing process variables, regardless
of the current working directory. Validation errors report variable names only.

| Variable | Development/test | Production |
| --- | --- | --- |
| `NODE_ENV` | Defaults to `development`; use `test` for database tests | Set `production` |
| `PORT` | Defaults to `4000`; integer 1-65535 | Required |
| `DATABASE_URL` | Required PostgreSQL URL including a database name | Required |
| `CLIENT_ORIGIN` | Defaults to `http://localhost:5173` | Required exact HTTPS origin |
| `LOG_LEVEL` | Defaults to `info` | Required |
| `TRUSTED_PROXY_CIDRS` | Empty; no proxy trust | Optional comma-separated actual proxy IPs/CIDRs; no blanket trust |

Origins must have no path, credentials, trailing slash, or wildcard. Log levels:
`fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. Production has no
database, port, origin, or log-level fallback. Keep secrets in the deployment
environment; `.env` files are ignored. Only the example is tracked.

## Commands

These root commands delegate to the appropriate npm workspace:

| Command | Purpose |
| --- | --- |
| `npm run dev:server` | Generate Prisma client, then watch the API with tsx |
| `npm run build:server` | Generate Prisma client and compile to `server/dist/` |
| `npm run start:server` | Run the compiled API |
| `npm run typecheck` | Check frontend, backend, tests, and configuration |
| `npm run lint` | Lint both workspaces, excluding generated code |
| `npm run test` | Run database-independent server tests |
| `npm run test:database` | Run isolated PostgreSQL domain, authentication, bootstrap and lifecycle suites |
| `npm run prisma:generate` | Generate the local typed client |
| `npm run prisma:validate` | Validate Prisma schema/configuration |
| `npm run prisma:migrate -- --name <name>` | Create/apply a development migration |
| `npm run prisma:migrate:deploy` | Apply committed migrations during deployment |
| `npm run prisma:studio` | Open Prisma's database browser locally |
| `npm run bootstrap:admin` | Explicitly provision the first administrator using protected environment input |

Server-only checks are also available as `npm run typecheck --workspace
@medicare/server` and `npm run lint --workspace @medicare/server`. Use
`npm run test:watch --workspace @medicare/server` for interactive testing.

Prisma uses `prisma.config.ts` for the connection URL and a `prisma-client`
generator with explicit output and the PostgreSQL driver adapter. Generated
code is ignored and recreated by build/typecheck/dev. Generation and validation
do not require database credentials; commands that connect to PostgreSQL do.
The migrations create eleven related models, eight enums and database
integrity checks/triggers. Health readiness still uses `SELECT 1`.
The singleton client has a bounded pool of 10 connections, three-second
connection/query timeouts, and disconnects during shutdown.

The root manifest narrowly overrides Prisma tooling's `deepmerge-ts` to 8.0.2
and `mysql2` to 3.24.5 to resolve dependency advisories. The application uses
PostgreSQL only; MySQL2 is a transitive CLI dependency. Reassess these overrides
when upgrading Prisma, and verify generation, validation, and migration tooling.

## Endpoints and response contracts

`GET /api/v1/health` returns HTTP 200 with process liveness only:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "medicare-api",
    "environment": "development",
    "timestamp": "2026-10-01T00:00:00.000Z",
    "uptime": 123
  }
}
```

`GET /api/v1/health/ready` runs `SELECT 1` through Prisma. It returns HTTP 200
with `{"success":true,"data":{"status":"ready"}}`, or HTTP 503 when the
database is unavailable, a 3.5-second probe deadline is exceeded, or shutdown
has started. Both endpoints set `Cache-Control: no-store`.

Errors use the same envelope, including the request ID returned in
`X-Request-Id`:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Route not found",
    "requestId": "a-correlation-id"
  }
}
```

Other codes include `INVALID_JSON` (400), `VALIDATION_ERROR` (400),
`ORIGIN_NOT_ALLOWED` (403), `PAYLOAD_TOO_LARGE` (413),
`UNSUPPORTED_ENCODING` (415), `SERVICE_UNAVAILABLE` (503), and
`INTERNAL_ERROR` (500). Responses never include stacks, SQL, or caught internal
error messages. Use `AppError` only with deliberately public messages.

## Security and logging

Helmet sets security headers. CORS permits the configured origin and requests
without an Origin header (such as probes and CLI clients). Other browser origins
receive a controlled 403. CORS is not authentication or an authorization boundary.
JSON bodies are limited to 100 KiB. Authentication login and authenticated
mutations require the trusted Origin header; mutations also require CSRF.
Proxy trust defaults to none; configure only actual proxy IPs/CIDRs through
`TRUSTED_PROXY_CIDRS`. Production session cookies always require HTTPS.

Incoming request IDs must be 1-128 ASCII letters/digits/dots/underscores/hyphens,
starting with a letter or digit; invalid values are replaced with a UUID.
Pino writes JSON to stdout. HTTP logs include method, request ID, status, and
timing, but omit URLs, query strings, IPs, headers, and bodies. Common sensitive
fields are redacted as a second layer; caught errors are not serialized with
their messages or stacks. Do not add patient payloads or secret-bearing strings
to log messages. No regulatory compliance claim is made by these controls.

## Startup and shutdown

`app.ts` exports `createApp`, a factory that configures middleware and routes
without a listener or database connection. Tests inject the readiness probe.
`server.ts` validates configuration, obtains the shared Prisma client, connects
and probes PostgreSQL, then opens the HTTP listener. Startup failure exits
nonzero with a safe diagnostic and closes database resources.

SIGINT/SIGTERM mark the process unready, stop accepting connections, drain
active requests, close idle connections, and disconnect Prisma. Fatal runtime
errors use the same cleanup path and exit nonzero. Shutdown has a ten-second
deadline before forced termination. HTTP request/header/keep-alive timeouts
are 15/10/5 seconds. Run the built server directly under a process supervisor
that forwards termination signals and restarts failed processes.

## Tests

`npm run test` uses Supertest against the app factory and injected probes, with
no database requirement. Tests cover health contracts, readiness success/failure,
shutdown readiness, request IDs, 404s, malformed JSON, payload limits, CORS,
security headers, production error privacy, environment validation, safe logs,
and probe timeout cleanup. Clinical tests also cover strict inputs, clinical
permissions and clinical-field log redaction.

For database tests, explicitly configure `NODE_ENV=test` and `TEST_DATABASE_URL`
to a loopback control database named `medicare_test_*`. Its role needs CREATEDB.
The command rebuilds first; CLI and server subprocess tests use those current
production artifacts. The runner creates a fresh random database per test file, applies migrations
twice, runs that suite, and removes only that generated database. It never resets the configured
database and never falls back to normal `DATABASE_URL`.

The tests include relational integrity, uniqueness, timestamp behavior, protected
history, audit immutability, clinical authorship/finalization/amendments,
concurrent encounter creation, audit rollback, real CLI bootstrap/concurrency, and the existing
readiness and lifecycle checks. The default database-independent suite covers
password hashing, input/test-configuration safety, HTTP behavior and logs.
See [test isolation details](../docs/data-model.md#migrations-and-tests).

## Administrator bootstrap

After migrations, supply `DATABASE_URL` and `BOOTSTRAP_ADMIN_FIRST_NAME`,
`BOOTSTRAP_ADMIN_LAST_NAME`, `BOOTSTRAP_ADMIN_EMAIL`,
`BOOTSTRAP_ADMIN_STAFF_NUMBER`, `BOOTSTRAP_ADMIN_PASSWORD` through a protected
environment, then run `npm run bootstrap:admin`. In a production install without development
dependencies, run the compiled `node server/dist/cli/bootstrapAdmin.js` instead. There are no
default credentials.
Staff numbers use `STF-` plus 6-32 alphanumeric characters, normalized uppercase.
Passwords support 15-128 Unicode characters and use salted Argon2id (64 MiB,
three iterations, parallelism one). No password is printed. Clear bootstrap
variables after use; never pass secrets as command-line arguments.

The CLI atomically creates an active ADMIN and an immutable audit marker under
a database lock. It refuses duplicate identities and repeat provisioning, even
if the first admin is disabled or demoted. Recovery remains deferred; additional
staff are now provisioned by ADMIN through `POST /api/v1/staff`. This command
is never run at API startup.

## Organization

```text
src/
  app.ts                  Express factory and middleware wiring
  server.ts               Infrastructure, listener, shutdown
  config/env.ts           Environment loading and validation
  database/prisma.ts      Reusable client and disconnect
  middleware/             Authentication, roles, CSRF, request IDs and safe errors
  modules/auth/           Sessions, cookies, login/logout and security transactions
  modules/health/         Health controller and router
  modules/staff/          Validation, safe DTOs, administration and first-admin CLI service
  modules/patients/       Demographic validation, DTOs, services and routes
  modules/appointments/   Scheduling, lifecycle, scoped DTOs and transactional audits
  modules/encounters/     Clinical drafts, finalization, amendments and safe DTOs
  modules/notifications/  Own inbox, read state, broadcasts and appointment notices
  modules/reports/        Role dashboards, bounded UTC aggregates and report DTOs
  cli/                    Explicit administrator bootstrap entry point
  shared/errors/          Public application error type
  shared/logger/          Pino setup and redaction
  shared/security/        Password validation, Argon2id hashing and verification
  shared/authorization/   Explicit demographic, appointment and clinical permissions
  shared/audit/           Transactional audit helper with allowlisted metadata
  shared/validation/      Shared timezone-aware timestamp validation
  shared/utils/           Bounded asynchronous operations
  generated/prisma/       Generated output, not tracked
prisma/schema.prisma      Domain models, enums, relations, and indexes
prisma/migrations/        Reviewed DDL and database integrity rules
prisma.config.ts          Prisma CLI configuration
tests/                    HTTP, configuration, logging, timeout, database tests
```

The audit browsing module remains future work. Keep routes, validation, controllers, services, repositories,
and module tests together. Controllers translate HTTP requests; services enforce
business rules; repositories isolate persistence. Add these directories only
when their implementations are introduced.
