# Step 7 implementation and verification report

Verification date: 2026-10-10. Contract and operational policies:
[notifications-api.md](notifications-api.md).

## Requested report

1. **Findings:** Notification already stored shared content; NotificationRecipient
   already held independent readAt with unique notification/user ownership and
   restrictive foreign keys. DIRECT/BROADCAST types and an unread index existed.
   The old audience check required a role for every broadcast, preventing ALL.
   There were no inbox routes. The UI used local shared broadcasts and static badges.
2. **Authorization:** All three active staff roles have NOTIFICATION_READ_OWN and
   NOTIFICATION_MANAGE_OWN; only ADMIN has NOTIFICATION_BROADCAST. Existing
   demographic, scheduling and clinical permissions remain intact.
3. **Routes:** GET /api/v1/notifications, GET /unread-count, GET /:id,
   POST /:id/read, POST /read-all and POST /broadcast. The latter paths share the
   /api/v1/notifications prefix. No generic edit/delete/send-to-user endpoint.
4. **DTO:** id, type, title, message, createdAt, target and recipient readAt.
   Creation returns content without readAt plus recipientCount. Explicit selectors
   and presenters exclude sender/recipient internals and identity lists.
5. **Ownership:** Session-derived staff UUID on every inbox lookup/count/write.
   Missing and non-owned IDs both return 404; ADMIN has no ownership bypass.
6. **Read state:** Recipient-local first readAt, conditional update and SQL
   preservation. Read/read-all serialize per inbox. Read-all uses one database
   timestamp, returns updated count and does not affect future deliveries.
7. **Unread count:** Database COUNT scoped to the current user and null readAt,
   using the existing recipient/read index without loading content.
8. **Broadcast:** One immutable shared row, an atomic recipient set and one audit.
   Empty audiences fail with NO_NOTIFICATION_RECIPIENTS; more than 10,000 eligible
   users fail with NOTIFICATION_AUDIENCE_TOO_LARGE. No partial fan-out is committed.
9. **Audience:** Strict ALL or ROLE with an existing StaffRole; ALL includes the
   sender when eligible. No arbitrary recipient/query/external-address selector.
10. **Eligibility:** Broadcasts target ACTIVE staff only. Appointment notices target
    ACTIVE DOCTOR_IN_CHARGE only. Historical delivery survives role/status changes;
    new users do not inherit old broadcasts. Inactive staff cannot access the API.
11. **Plain text/XSS:** Title 1–150, message 1–2000; trim edges, retain Unicode,
    reject control characters and literal angle brackets. No HTML/Markdown renderer
    or entity decoding. Future clients must render escaped text.
12. **Automation:** Appointment creation/assignment, actual reschedule/reassignment
    and first cancellation. No staff-account, patient or clinical notifications.
13. **Appointment behavior:** Notify current/new eligible doctor; on reassignment
    also notify eligible old doctor generically. Combined time/doctor changes emit
    assignment notices only. Repeat cancellation/identical schedule changes do not
    create extra notices. Historical inactive/unassigned cancellation still works.
14. **Sensitive data:** Fixed templates contain no patient names, diagnoses,
    complaints, notes, plans or cancellation reasons. Human-authored broadcasts
    require an operational-only content policy; validation cannot identify all
    sensitive prose. Messages/titles are excluded from logs and audit metadata.
15. **Audits:** One NOTIFICATION_BROADCAST_CREATED with source, audience and count.
    The helper and SQL validate the paired bounded metadata keys. Automated notices
    rely on the originating appointment audit. Inbox/read-state operations are
    deliberately not individually audited.
16. **Transactions:** Broadcast content/recipients/audit commit together. Eligible
    appointment notices are required side effects in the existing appointment
    transaction. Failures roll back the mutation, audit and notices. Write paths
    recheck current authorization after locks; simple reads use request authentication
    without interactive transactions. Existing overlap/lock guarantees remain.
17. **Resource linking:** Nullable Notification.appointmentId with an indexed
    RESTRICT FK; only DIRECT notices may link. DTO target is APPOINTMENT plus UUID,
    with no stored URL or copied record. Target API authorization remains mandatory.
18. **Migration:** 20261009120000_notification_workflow. It updates audience checks,
    adds the appointment link and inbox index, extends audit metadata/action, and
    protects notification content and recipient identity/first-read history.
19. **Models/enums:** Notification gains appointment relation/id/index; Appointment
    gains inverse notifications; NotificationRecipient gains an ordering index.
    AuditAction gains NOTIFICATION_BROADCAST_CREATED. No new model or notification
    type; 11 models, 8 enums and 7 migrations remain the schema totals.
20. **Created files:** Listed below.
21. **Modified files:** Listed below. Existing uncommitted work and concurrent
    frontend changes were preserved; no reset or commit was performed by this task.
22. **Dependencies:** None added or upgraded for Step 7. npm install reports
    332 packages audited with zero vulnerabilities.
23. **Environment:** No new variables; existing explicit test database settings
    and database-isolation safeguards are unchanged.
24. **Tests:** 74 new notification validation/permission tests, 105 notification
    database tests and 9 additional cases from the expanded existing permission
    matrix. Logger assertions and migration expectations were extended. No prior
    test was removed or disabled.
25. **Exact totals:** 398 database-independent tests in 10 files and 616 PostgreSQL
    tests in 9 files: **1,014 passed across 19 files, zero failed**. All 826 prior
    tests remain passing, with 188 additional cases. The final readiness test was
    rerun with the guarded disposable runner after an interruption lost its result.
26. **Typecheck:** Passed across both workspaces, server tests and configuration.
27. **Lint:** Passed; backend clean. The existing React set-state-in-effect warning
    remains, now at client/src/app/App.tsx:214 after concurrent frontend edits.
28. **Build:** Frontend Vite and backend TypeScript production builds passed.
29. **Frontend differences:** Numeric mock IDs, local display times/audience labels,
    fixed Records Officer broadcast audience/title, shared local state, static badge
    3/dot and no read-state/detail/navigation/pagination contracts. See API guide.
30. **Limits:** Synchronous delivery with existing deadlines, no mutation idempotency
    keys, queue, realtime transport, retention/dismissal or moderation. Arbitrary
    administrator prose still needs content policy. Database owners bypass triggers;
    runtime grants, backup encryption and deployment policies remain operational.
31. **External delivery:** No email, SMS, push or messaging provider implemented.
32. **Reports/dashboards:** No dashboard or report APIs implemented.
33. **Frontend preservation:** No frontend file was edited by this Step 7 work;
    notification components, mocks, types and badges were preserved. Authentication
    and appointment-booking wiring changed concurrently outside this work, so the whole frontend is not
    claimed identical to the initial snapshot. Those edits were left intact.
34. **Next step:** Review own-inbox, audience and operational-content policies with
    the product owner, then choose a separately authorized next phase. Stop after
    Step 7; no automatic frontend notification, dashboard or reporting work.

## Files created

- server/src/modules/notifications/notification.validation.ts
- server/src/modules/notifications/notification.dto.ts
- server/src/modules/notifications/notification.service.ts
- server/src/modules/notifications/notification.routes.ts
- server/prisma/migrations/20261009120000_notification_workflow/migration.sql
- server/tests/notification.validation.test.ts
- server/tests/notification.database.test.ts
- docs/notifications-api.md
- docs/step-7-completion.md

## Files modified

- server/prisma/schema.prisma
- server/src/app.ts
- server/src/shared/authorization/permissions.ts
- server/src/shared/audit/audit.ts
- server/src/shared/logger/logger.ts
- server/src/modules/appointments/appointment.service.ts
- server/tests/domain.database.test.ts
- server/tests/patient.validation.test.ts
- server/tests/logger.test.ts
- README.md
- server/README.md
- docs/architecture.md
- docs/data-model.md
- docs/appointment-api.md

Generated Prisma/build outputs remain ignored reproducible artifacts. The existing
workspace manifests/lockfile already contain prior-phase uncommitted changes;
Step 7 introduces no dependency requirement.

## Verification

| Command/check | Result |
| --- | --- |
| npm install | Passed, zero vulnerabilities |
| npm run prisma:generate | Passed, Prisma 7.10.0 |
| npm run prisma:validate | Passed |
| npm run typecheck | Passed |
| npm run lint | Passed with the existing frontend warning |
| npm run test | 398 passed in 10 files |
| npm run test:database | 616 passed in 9 files; final readiness result recovered by a guarded rerun |
| npm run build | Both production builds passed |
| git diff --check | Passed; normal LF/CRLF conversion notices only |

The initial unit run exposed the old permission-matrix expectation for newly
added notification permissions. Extending its expected policy preserved all old
cases and added nine new checks; the complete rerun passed. PostgreSQL startup
required the approved Windows process path after the sandbox denied pg_ctl startup.
The guarded runner creates its own random database for each test file, deploys all
seven migrations twice and drops only that generated database. Application
databases are never reset or migrated by this verification.

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
| **Total** | **616** |

The original run emitted the previously observed non-failing pg warning about
queuing queries on a busy client, deprecated for pg 9. Current pg 8 tests passed;
adapter/driver compatibility should be rechecked before a future major upgrade.

After the interruption, the final readiness test passed in a newly generated
database. Concurrent appointment-route/frontend changes prompted a focused rerun:
all 139 appointment and 105 notification tests passed again, along with current
workspace typecheck, lint and both builds. These repeated cases do not increase
the 1,014 distinct-test total. All seven migrations applied successfully to fresh
databases; every second deployment reported no pending migrations.

The temporary copies of the guarded runner changed only the selected suite names;
loopback/control-database validation, generated-name guards and cleanup were
retained. Those temporary files were removed. Cleanup verified zero generated
test databases remaining, then stopped and removed the exact standalone PostgreSQL
cluster created for this task. No application database was reset or migrated.
