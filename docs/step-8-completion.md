# Step 8 completion report

This report covers the dashboard/aggregate-report backend changes only. Existing
concurrent frontend and appointment integration work was preserved. Full API
contracts and metric definitions are in [dashboard-reports-api.md](dashboard-reports-api.md).

1. **Pre-implementation findings.** The existing session, role, permission, audit,
   PostgreSQL integrity and disposable-test foundations supported this step.
   Overview and Reports were mock screens, with mixed operational/clinical cards,
   static growth percentages and unsupported export/complaint/census concepts.
   Existing indexes were reviewed before choosing aggregate queries.
2. **Authorization.** Added three role-specific dashboard permissions plus
   REPORT_OPERATIONAL_VIEW and REPORT_CLINICAL_AGGREGATE_VIEW. Operational reports
   belong to ADMIN/RECORDS_OFFICER; personal clinical reports belong only to doctors.
3. **Dashboard route.** GET `/api/v1/dashboard` selects the response from the current
   authenticated role. A shared authorization lock and session/role recheck protect
   queued access. Client-supplied roles/scope selectors are rejected.
4. **Role contracts.** ADMIN gets current patients/staff, own unread count, upcoming
   appointments and period operational activity. RECORDS_OFFICER gets patient and
   appointment aggregates plus own unread count. DOCTOR gets own assigned appointment
   metrics, authored drafts/clinical activity and own unread count.
5. **Report routes.** GET `/api/v1/reports/patients`, `/appointments`, and
   `/clinical-activity`. All require authentication, enforce permission, return
   no-store JSON, and need no CSRF token.
6. **Patient metrics.** Current active/archived snapshots and registrations by
   Patient.createdAt. Archived records remain in historical registrations.
7. **Appointment metrics.** Total and six current statuses for scheduledStart in
   range, plus cancellation/no-show percentages. Upcoming counts only future
   SCHEDULED/CONFIRMED rows, independent of the selected range.
8. **Clinical metrics.** Current authored drafts, own encounter activity by
   occurredAt, own REVIEWED/finalized activity by reviewedAt, and own amendments by
   createdAt. No updatedAt counting or clinical-text breakdowns.
9. **Date policy.** Both endpoints or neither; strictly ordered half-open [from,to)
   intervals, maximum 366 days. Dashboard defaults to UTC today; reports to 30 UTC
   calendar dates ending today. Future appointment ranges are supported.
10. **Timezone policy.** Require timezone-aware timestamps; normalize to UTC. Raw
    SQL binds ISO UTC strings with explicit timestamptz casts and groups explicitly
    in UTC. Report transactions set LOCAL TIME ZONE UTC for ORM comparisons.
    Database tests caught and verified the fix for adapter Date parameter behavior
    under Honolulu and Tokyo session timezones.
11. **Buckets.** day/week/month only. Weeks begin Monday; months begin on day one.
    UTC date labels sort ascending; partial edge buckets keep exact range filtering.
12. **Zero filling.** Missing buckets/statuses are explicit numeric zeros. Maximum
    367 buckets includes both partial day edges of a 366-day interval.
13. **Percentages.** Status count / total appointments × 100, rounded to two decimal
    places; empty denominator gives 0. Overall rates use overall counts.
14. **Snapshots versus periods.** Current staff/patients/unread/drafts/upcoming
    values ignore historical range selection. Period counts use named lifecycle
    timestamps. Current statuses can change historical appointment reports.
15. **Doctor scope.** Appointment clinicianId, encounter createdById and amendment
    authorId must match the current principal for personal metrics. Broad Step 6
    clinical read access does not widen these reports. Doctors cannot use the
    organization-wide appointment report.
16. **DTOs.** Every response has generatedAt and normalized range metadata.
    Dashboard adds role/snapshot/period; reports add summary/series and relevant
    snapshot fields. Explicit fields exclude entity IDs, demographics, clinical
    detail, notification content and secrets. Bigint counts become safe JSON numbers.
17. **Aggregation.** Fixed-count PostgreSQL count/group queries return bounded
    grouped rows; Node calculates rates and fills bucket gaps. No source-record
    collection, pagination or N+1 counting.
18. **Raw SQL.** Tagged parameterized SQL handles UTC time groups, status groups,
    clinical UNION ALL and patient snapshot counts. Dates, bucket units and doctor
    identities are bound values; SQL expressions/identifiers remain fixed code.
19. **Indexes.** No new indexes. Existing createdAt, scheduledStart, clinician/date,
    author, amendment author/date, inbox unread and staff role/status indexes were
    reviewed. Author-based encounter reports may still scan an author's history;
    representative query plans should guide future compound indexes.
20. **Audits.** One CLINICAL_REPORT_VIEWED per successful personal clinical report,
    referencing the requesting STAFF_USER with source-only metadata. Audit failure
    prevents the result. Ordinary dashboard/operational reads, invalid requests and
    denials do not emit report audits.
21. **Logging/privacy.** Metadata-only HTTP logs, safe correlated errors, no result
    or query logging, and extra report/dashboard/metrics/summary/series/snapshot
    redaction. Regression tests cover content and identifier exclusion.
22. **Migration.** `20261010120000_reporting_query_support` adds only the audit enum
    value. Eight migrations are deployed to fresh disposable databases and deployed
    again. Application databases are not reset or migrated by test verification.
23. **Files created.** Five `server/src/modules/reports/report.*.ts` files
    (routes/service/queries/validation/DTOs), the reporting migration,
    `report.validation.test.ts`, `report.queries.test.ts`, `report.database.test.ts`,
    `docs/dashboard-reports-api.md` and this completion report.
24. **Files modified.** Prisma schema, app route wiring, shared permissions/logger,
    existing domain migration/permission/logger tests, server README,
    docs/architecture.md and docs/data-model.md. Other working-tree edits belong to
    separate work and were preserved.
25. **Dependencies.** None added. Required npm install completed with zero reported
    vulnerabilities; no dependency upgrade was introduced.
26. **Environment variables.** None added. Tests retained explicit loopback
    TEST_DATABASE_URL and generated-database safeguards.
27. **Tests added.** 180 distinct cases: 64 validation/DTO, 6 query behavior,
    15 expanded role-permission cases and 95 PostgreSQL/HTTP cases. Existing logger
    and migration assertions were extended without removing prior cases.
28. **Exact test results.** **1,194 tests passed across 22 files**: 483 unit tests
    across 12 files plus 711 database tests across 10 files. All previous 1,014
    cases remain passing, with 180 additions. A focused reporting rerun also
    passed all 95 cases; repeated runs do not inflate the distinct-test total.
29. **Typecheck.** Passed for both workspaces, including new tests and strict server
    TypeScript. Prisma client generation and schema validation passed.
30. **Lint.** Passed with one pre-existing frontend react(set-state-in-effect)
    warning at client/src/app/App.tsx:214. Server lint is clean.
31. **Build.** Both frontend Vite and backend TypeScript production builds passed.
32. **Frontend mismatches.** Shared mock Overview differs from three server contracts;
    Records lacks Overview/Reports navigation and doctors lack a clinical report
    screen. Static KPIs/growth percentages, seven weekday bars, complaint donut,
    activity feed, census/audit cards and Export all do not map directly to this API.
33. **Remaining limits.** No production-size performance benchmark, historical
    as-of snapshots, small-cell suppression, reporting cache or dedicated report
    throttle. READ COMMITTED can observe concurrent changes between separate
    queries. Current snapshots scale with data volume; clinical author history may
    need measured index improvements. Operational privacy, retention, backups,
    encryption and narrower clinical access remain separate deployment work.
34. **Exports.** CSV/PDF/Excel exports, scheduled/email reports and BI were NOT implemented.
35. **Frontend integration.** Dashboard/report integration was NOT implemented.
    No frontend files or mocks were edited by this reporting step.
36. **Recommended next step.** Review/accept these metric contracts, then explicitly
    scope frontend integration as the next step. Before deployment, apply reviewed
    migrations and validate production-size performance and operational controls.
    Stop after Step 8; do not start integration automatically.

## Verification record

| Required command | Result |
| --- | --- |
| `npm install` | Passed; 332 packages audited, zero reported vulnerabilities |
| `npm run prisma:generate` | Passed |
| `npm run prisma:validate` | Passed |
| `npm run typecheck` | Passed, both workspaces |
| `npm run lint` | Passed; one existing frontend warning, server clean |
| `npm run test` | 483 passed, 12 files |
| `npm run test:database` | 711 passed, 10 files |
| `npm run build` | Passed, frontend and backend |

| PostgreSQL suite | Passed |
| --- | ---: |
| Appointment | 139 |
| Authentication/staff | 99 |
| Bootstrap | 6 |
| Domain | 14 |
| Clinical encounters | 147 |
| Lifecycle | 3 |
| Notifications | 105 |
| Patients | 102 |
| Readiness | 1 |
| Reports | 95 |
| **Total** | **711** |

The guarded runner used a new disposable database per file, applied all eight
migrations, ran deploy again with no pending migrations, and removed only its
generated database. Its loopback/control-name and generated-name safeguards were
unchanged. A temporary focused runner retained those safeguards and was removed.
The existing non-failing pg warning about concurrent client.query calls appeared
in the clinical suite; assess adapter compatibility before a future pg major upgrade.

Cleanup confirmed zero generated test databases remained, stopped the standalone
PostgreSQL instance and removed its exact verified temporary cluster directory.
No application database was reset or migrated. Step 8 is complete.
