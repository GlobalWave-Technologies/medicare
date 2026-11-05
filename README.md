# Medicare - Hospital Records

React and TypeScript frontend for hospital records, patients, appointments,
reports, and notifications, with an Express/PostgreSQL backend.
[Frontend authentication](docs/frontend-auth-integration.md) uses real staff
credentials, HttpOnly sessions, backend roles and CSRF-protected logout.
The [patient frontend](docs/frontend-patient-integration.md) supports listing,
search, registration, detail, editing, archive and reactivation with role-aware actions.
The [appointment frontend](docs/frontend-appointment-integration.md) supports real
schedule search, filters, booking, detail, rescheduling, status changes and
cancellation, with local-time conversion and doctor own-assignment scope.
The [clinical frontend](docs/frontend-clinical-integration.md) supports doctor-only
history, encounters, draft editing, finalization and permanent amendments.
The [notification frontend](docs/frontend-notification-integration.md) provides each
staff member's own inbox, a server-backed unread badge, read state, appointment links
and administrator broadcasts.
The [staff administration frontend](docs/frontend-staff-administration.md) gives
administrators a Staff & Access workspace to add accounts, change roles, suspend,
reactivate or permanently disable access and sign out a person's sessions.
The [dashboard and reports frontend](docs/frontend-dashboard-reports.md) gives each role a
server-chosen Overview and the reports it may read. Admins and Records Officers get patient
and appointment activity; doctors get their own clinical activity. Periods use UTC calendar
dates, and every figure comes from the aggregate API, with no demonstration data or exports.
See the [product stabilization audit](docs/product-ui-ux-audit.md) for fixes, verification and remaining release requirements.
The [final UI/UX review](docs/final-ui-ux-review.md) records the whole-product consistency pass:
one shared visual system, one Medicare wordmark, consistent dialogs, statuses, forms and
feedback, and the responsive and accessibility results.
The backend includes staff authentication and patient demographic APIs, plus
[appointment scheduling](docs/appointment-api.md).
The [clinical records API](docs/clinical-records-api.md) adds doctor-authored drafts,
finalization, immutable history and append-only amendments.
The [notification API](docs/notifications-api.md) adds personal staff inboxes,
read state, admin broadcasts and transactional appointment notices.
Patient registration, encounter creation and broadcasts accept an
[Idempotency-Key](docs/idempotency.md) so a resent request cannot write twice.

## Development

Run from the repository root using Node.js 22.12+:

```sh
npm ci
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the frontend development server |
| `npm run dev:client` | Start the frontend explicitly |
| `npm run dev:server` | Start the API (requires server configuration and PostgreSQL) |
| `npm run build` | Build both applications into their own `dist/` directories |
| `npm run build:client` / `npm run build:server` | Build one application |
| `npm run lint` | Check both workspaces |
| `npm run typecheck` | Check both TypeScript projects and server tests/configuration |
| `npm run test` | Run server tests without a database |
| `npm run test:client` | Run frontend authentication, patient, appointment and clinical tests |
| `npm run test:database` | Run isolated PostgreSQL integration tests |
| `npm run preview` | Preview the built frontend |
| `npm run start:server` | Start the compiled API |
| `npm run bootstrap:admin` | Explicit first-administrator provisioning after migrations |

## Layout

```text
client/
  public/         Static public assets
  src/
    app/          Application composition and navigation
    assets/       Bundled assets
    components/   Shared UI and branding
    features/     Auth, dashboard, patients, appointments, records,
                  reports, and notifications
    mocks/        Historical test fixtures (not imported by the app)
    styles/       Application and global styles
    types/        Shared frontend types
    main.tsx      Browser entry point
  index.html
  vite.config.ts
  tsconfig*.json
server/           API foundation, Prisma configuration, and tests
docs/            Architecture and conventions
package.json      Root commands and current dependencies
package-lock.json Reproducible dependency versions
```

Install dependencies once at the root; npm manages the client/server workspaces
using one lockfile. See [architecture](docs/architecture.md) and
[backend setup, environment variables, and Prisma commands](server/README.md).
The [data model and identity guide](docs/data-model.md) documents the schema,
safe bootstrap and isolated database tests.
The [authentication guide](docs/authentication.md) covers database sessions,
CSRF, staff administration, routes, lifecycle rules and deployment requirements.
The [patient API guide](docs/patient-api.md) documents demographic permissions,
registration, search, updates, reversible archival and duplicate handling.
