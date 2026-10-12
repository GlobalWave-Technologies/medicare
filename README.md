# Medicare - Hospital Records

React and TypeScript frontend for hospital records, patients, appointments,
reports, and notifications, with an Express/PostgreSQL backend foundation.
Frontend authentication, role selection, and data still demonstrate the intended
UI; frontend integration is deferred. The backend includes staff authentication
and patient demographic APIs, plus [appointment scheduling](docs/appointment-api.md).
The [clinical records API](docs/clinical-records-api.md) adds doctor-authored drafts,
finalization, immutable history and append-only amendments.
The [notification API](docs/notifications-api.md) adds personal staff inboxes,
read state, admin broadcasts and transactional appointment notices. Notification
frontend integration remains a separate phase.

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
    mocks/        Demonstration data
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
safe bootstrap, isolated database tests, and deferred frontend integration.
The [authentication guide](docs/authentication.md) covers database sessions,
CSRF, staff administration, routes, lifecycle rules and deployment requirements.
The [patient API guide](docs/patient-api.md) documents demographic permissions,
registration, search, updates, reversible archival and duplicate handling.
