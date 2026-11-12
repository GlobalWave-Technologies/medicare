# Medicare - Hospital Records

React and TypeScript frontend for hospital records: patients, admissions and discharge,
clinical records, reports and notifications, with an Express/PostgreSQL backend.
[Frontend authentication](docs/frontend-auth-integration.md) uses real staff
credentials, HttpOnly sessions, backend roles and CSRF-protected logout.
The [patient frontend](docs/frontend-patient-integration.md) supports listing,
search, registration, detail, editing, archive and reactivation with role-aware actions.
[Admissions and discharge](docs/admissions-discharge.md) covers hospital stays: register and
admit, room changes with history, the Medical Officer's admission-scoped medical record, structured
medication orders and an atomic discharge that never deletes anything. Appointments have been retired.
[Medication catalog and prescribing](docs/medication-catalog-prescribing.md) covers the controlled medicine
list Medical Officers prescribe from (searchable dropdown, strength, dose, route, frequency, duration),
draft-only editing, permanent finalized orders, medication history by admission and the Admin-managed
Medication Catalog (Medical Officers can add a missing medicine while prescribing; only administrators
deactivate or reactivate). Prescribing is admission- and clinical-record-based, never appointment-based.
The [final UI/UX audit](docs/final-ui-ux-audit.md) describes the live admissions and discharges chart
on the Overview (counted from the database, refreshed every minute while open), the simplified
dashboard cards, full-name patient search and the screen-by-screen polish before client testing.
The [final product UI/UX review](docs/final-product-ui-ux-review.md) records the whole-product
refinement before client testing: the issues found (P0–P3), the fixes, screenshots, accessibility,
responsive and dark-mode results and the readiness verdict.
[Staff Activity](docs/staff-activity-monitoring.md) gives administrators a privacy-safe view of who is
signed in, when staff last used the system and recent actions in plain words, with ending sessions;
it never shows clinical content or patient identifiers.
The [clinical frontend](docs/frontend-clinical-integration.md) supports Medical Officer-only
history, clinical records on a current admission, draft editing, finalization and permanent amendments.
The [notification frontend](docs/frontend-notification-integration.md) provides each
staff member's own inbox, a server-backed unread badge, read state and administrator broadcasts.
The [staff administration frontend](docs/frontend-staff-administration.md) gives
administrators a Staff & Access workspace to add accounts, change roles, suspend,
reactivate or permanently disable access and sign out a person's sessions.
The [dashboard and reports frontend](docs/frontend-dashboard-reports.md) gives each role a
server-chosen Overview with current admissions, admissions and discharges. Admins and Records
Officers also get the patient registration and admissions reports; Medical Officers see their own
clinical activity on the Overview. Periods use UTC calendar dates, and every figure comes from the
aggregate API, with no demonstration data or exports.
See the [product stabilization audit](docs/product-ui-ux-audit.md) for fixes, verification and remaining release requirements.
The [final UI/UX review](docs/final-ui-ux-review.md) records the whole-product consistency pass:
one shared visual system, one Medicare wordmark, consistent dialogs, statuses, forms and
feedback, and the responsive and accessibility results.
[Branding and dark mode](docs/branding-dark-mode.md) records the client's original orange
palette recovered from the first frontend, its accessible adjustments, the Light, Dark and
System theme choice and how the themes were verified.
[Production security hardening](docs/production-security-hardening.md) covers the password
lifecycle, sessions, cookies, proxy trust, headers, database roles and logging; the
[release operations runbook](docs/release-operations.md) gives the deploy order, runtime grants
(`server/ops/runtime-grants.sql`), scheduled maintenance, backups, restores and monitoring.
[Final release acceptance](docs/final-release-acceptance.md) records the staging acceptance, its
results, the open conditions and the release decision.
[First-login security](docs/first-login-security.md) covers temporary passwords and
administrator-assisted recovery; [installing Medicare](docs/pwa-installation.md) covers the
installable app, its static-only service worker, offline behaviour and updates.
The backend includes staff authentication, patient demographic and admission APIs.
The [clinical records API](docs/clinical-records-api.md) adds Medical Officer-authored drafts,
finalization, immutable history and append-only amendments.
The [notification API](docs/notifications-api.md) adds personal staff inboxes,
read state and admin broadcasts.
Patient registration, admission, encounter creation and broadcasts accept an
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
| `npm run test:client` | Run frontend tests |
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
    api/          API calls with response checks
    components/   Shared UI and branding
    features/     Auth, dashboard, patients, admissions, records, medications,
                  reports, notifications, staff and staff activity
    lib/          Shared formatting and validation helpers
    pwa/          Install offer, offline screen and update notice
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
