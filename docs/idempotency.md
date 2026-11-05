# Mutation idempotency

## Problem

Release and notification acceptance found that some saves were stored twice.
When a connection closed after the server committed a create but before any
response byte arrived, Chrome silently resent the POST. Affected creates were:

- an admin broadcast;
- a patient registration without date of birth or phone;
- an unlinked (walk-in) clinical draft.

The application never retries writes itself, so the duplicates came from the
transport. Step 13.1 adds server-side request idempotency for those creates.
Existing duplicate-patient detection, appointment uniqueness and clinical
immutability are unchanged.

## Contract

Clients send an opaque `Idempotency-Key` request header:

- **Format:** 16–128 characters, each a letter, digit, hyphen or underscore. The
  Medicare frontend sends `crypto.randomUUID()`.
- **Absent:** the request runs exactly as before, unprotected. This keeps existing
  API consumers working. The frontend always sends a key for the protected
  operations. Requiring the header would be a separate, versioned change.
- **Malformed:** `400 INVALID_IDEMPOTENCY_KEY`, with nothing written. This covers an
  empty value, the wrong length, other characters, quoted values or several values.
- **Same key, same principal and operation, same accepted payload:** the original
  result is returned. Nothing is written again.
- **Same key with a different payload:** `409 IDEMPOTENCY_KEY_REUSED`, "This request
  key has already been used for a different operation." The response never
  includes the original payload or resource.

| Operation | Endpoint | Scope |
|---|---|---|
| `PATIENT_CREATE` | `POST /api/v1/patients` | Signed-in Admin or Records Officer |
| `NOTIFICATION_BROADCAST` | `POST /api/v1/notifications/broadcast` | Signed-in Admin |
| `ENCOUNTER_CREATE` | `POST /api/v1/encounters`, linked or walk-in | Signed-in Doctor in Charge |

Encounter creation is keyed uniformly. For a linked appointment, a replay returns
the encounter the same request created. Any other request for that appointment,
keyed or not, still receives `409 APPOINTMENT_ALREADY_HAS_ENCOUNTER`, and the
database unique key is unchanged.

Other creates are not keyed:

- **Appointment creation:** resent bookings already fail the overlap exclusion
  constraints, so no duplicate row is stored. The user sees a conflict message that
  advises refreshing the schedule.
- **Amendments:** an identical amendment is rejected.
- **Staff creation:** email and staff number are unique.

## Scope and fingerprint

A record is identified by **principal + operation + SHA-256(key)**. The same raw key
used by another staff member, or for another operation, is unrelated and never
replays or conflicts across users. Scoping is by staff account, not session, so a
retry after signing in again still replays.

The request fingerprint is an HMAC-SHA256 of the accepted, normalized input, keyed
by the raw key. That input is what the service writes after validation:

- **Patient:** trimmed names, an empty middle name as `null`, a normalized phone
  number, and absent optional fields as `null`.
- **Broadcast:** trimmed title and message, and the exact audience enum.
- **Encounter:** timestamps compared as instants (`10:00+01:00` equals `09:00Z`),
  complaints and diagnoses in entry order, and absent text as `null`.

Keys are sorted and undefined values dropped before hashing, so JSON property order
does not matter. The raw key is never stored, so a stored fingerprint cannot be
matched against guessed patient, clinical or broadcast content.

## Replay, failures and auditing

The idempotency check runs inside the create's existing transaction, after:

- `requireAuth` (valid, unrevoked session of an active account);
- `requireCsrf` (exact Origin and session-bound token);
- the route permission;
- the in-transaction current-actor recheck.

A replay therefore cannot bypass authentication, a role change, suspension,
revocation or CSRF.

A replay returns the same `201` status and DTO shape for the same resource, plus an
`Idempotency-Replayed: true` header. Because responses are not stored, it
re-reads the resource:

- **Broadcasts:** content and deliveries are immutable, so the replay is identical
  to the original, including `recipientCount`.
- **Patients and encounters:** the replay shows their current state.

A replay runs before business checks. A resent registration returns its patient
instead of `POSSIBLE_DUPLICATE_PATIENT`. A resent encounter is returned even if its
patient was archived since. A resent broadcast is returned even if the audience has
changed since.

Only committed successes are recorded:

- **Not recorded:**
  - validation, authentication, authorization and CSRF failures;
  - business-rule refusals (`POSSIBLE_DUPLICATE_PATIENT`, `PATIENT_ARCHIVED`,
    `NO_NOTIFICATION_RECIPIENTS`, `APPOINTMENT_ALREADY_HAS_ENCOUNTER` and others);
  - server errors.
- **Consequence:** a corrected or deliberate later attempt with the same key runs
  normally.

A replay writes no audit event. The original `PATIENT_CREATED`,
`NOTIFICATION_BROADCAST_CREATED` or `MEDICAL_RECORD_CREATED` remains the only
event. A replay returns the caller's own just-created resource, so it also records
no `*_VIEWED` event.

## Transactions and concurrency

The record is inserted in the same PostgreSQL transaction as the resource,
recipients and audit. Any failure rolls all of them back together, so there is
never a resource without its record or a record without its resource. Tests force
failures in each of the following tables, and each one leaves neither a resource nor
a record:

- the record itself;
- `AuditEvent`;
- `NotificationRecipient`;
- `Patient`;
- `Encounter`.

Before the lookup, the transaction takes `pg_advisory_xact_lock(1296385108,
hashtext(principal:operation:keyHash))`. A concurrent request with the same scope
waits. If the first commits, the second then sees the record and replays; if the
first rolls back, the second proceeds. The lock is taken after the existing auth and
patient locks, and no other code takes it, so lock ordering is unchanged. A hash
collision only serializes two unrelated requests. The unique index on (principal,
operation, keyHash) is the database backstop. In tests, five or six simultaneous
same-key requests produced one resource, one audit and identical successful
responses.

## Storage

Migration `20261104120000_mutation_idempotency` adds:

- **Enum:** `IdempotentOperation`.
- **Table:** `IdempotencyRecord`, with:
  - the principal (foreign key to `StaffUser`);
  - `operation`, `keyHash` and `requestHash`;
  - exactly one of `patientId`, `encounterId` or `notificationId`, each a unique
    `RESTRICT` foreign key;
  - `createdAt` and `expiresAt`.
- **Indexes:** a unique index on (principal, operation, keyHash) and an index on
  `expiresAt`.
- **Check constraints:**
  - both digests must be 64 lowercase hex characters;
  - the populated foreign key must match the operation;
  - `expiresAt` must be later than `createdAt`.
- **Trigger:** rejects `UPDATE`; records are written once and only deleted on
  expiry.

The table holds no request body, response body, demographics, clinical text,
broadcast text or raw key. Existing tables and the previous eight migrations are
unchanged, apart from Prisma back-relations that need no SQL.

## Retention

A record replays for **24 hours** (`expiresAt = createdAt + 24 h`). This is a
technical retry window, not a hospital record-retention rule. After expiry, the same
key starts a new request: the expired record is deleted in the same transaction and
a new one is written.

Expired rows are removed by `npm run idempotency:prune --workspace @medicare/server`,
which runs `node dist/cli/pruneIdempotency.js` against `DATABASE_URL`. Schedule it
at least daily. It deletes only rows whose `expiresAt` has passed. The runtime role
needs `DELETE` on this table; see the [release operations runbook](release-operations.md).

## Frontend key lifecycle

`mutation()` accepts an optional `idempotencyKey` and sends it as a header. The shared
transport never generates a key and never retries. `api/idempotency.ts` provides:

- `newIdempotencyKey()`: `crypto.randomUUID()`, falling back to 16 bytes from
  `crypto.getRandomValues` if needed.
- `submissionKeys()`, used by the patient registration form, the broadcast composer
  and the clinical draft creation form:
  - `key(payload)` returns the current key while the payload is unchanged, and a new
    key as soon as it changes;
  - `settle(error?)` discards the key after success or any definite server answer
    (status below 500). It keeps the key after a network failure or 5xx, so
    deliberately resubmitting the unchanged form replays the original result.

Keys live only in component memory and are never written to browser storage.
Closing the form, reloading or signing out discards them. Patient edits, draft
saves, amendments, appointment actions and notification read-state writes send no
key.

The careful unconfirmed-save messages are unchanged. Resubmitting the same open form
is now safe. After closing it, staff should still check existing records before
starting again, because a new form uses a new key.

## CORS, logging and privacy

CORS adds only `Idempotency-Key` to the allowed request headers. It still requires
the exact `CLIENT_ORIGIN`, still sends credentials, and still rejects untrusted,
`null` and `*` origins. HTTP logs still omit headers, bodies and URLs. The logger
also redacts `idempotencyKey` and the `idempotency-key` request header if they ever
appear in a log object. A replay logs one `info` entry, "Idempotent request
replayed", containing only `requestId`, `operation` and `idempotencyReplayed`. It
never logs a key, digest, payload or resource content.

## Verification

- **Server unit tests:** 22 in `idempotency.test.ts`, covering header validation, the
  digests, canonicalization, operation fingerprints, the CORS preflight and log
  redaction.
- **Database tests:** 47 in `idempotency.database.test.ts`, covering:
  - backward compatibility and malformed keys;
  - patient, broadcast and encounter replays (single row, recipient set and audit);
  - payload mismatches;
  - the probable-duplicate policy;
  - concurrency;
  - linked appointment uniqueness;
  - cross-user scope, role, revocation and suspension;
  - CSRF;
  - rollbacks in each table;
  - privacy, logs, constraints and retention.

  With key handling disabled, 30 of the 47 fail.
- **Frontend tests:** 17 in `idempotency.test.tsx`, covering key format and fallback,
  the lifecycle rules, headers on the three creates only, retry reuse, a new key for
  changed payloads and definite failures, linked recovery and no storage.
- **Full automated run:** 1,757 tests across 47 files (491 client, 505 server unit,
  761 database), all passing.
- **Live run:** 43/43 checks against the production build behind the HTTPS proxy, on
  a fresh disposable database with the restricted runtime role.
  - API-level replays and conflicts worked for all three operations.
  - In Chrome, each create was run twice:
    - with one dropped response (Chrome resent it automatically);
    - with two dropped responses followed by a deliberate retry.

    Each case stored exactly one patient, broadcast (with one recipient set) or
    walk-in draft, with one audit and the same key on every attempt.

## Limitations

- **Unkeyed clients stay unprotected.** Other API consumers that send no key behave
  as before.
- **Replays last 24 hours.** A retry after the window creates a new resource.
- **Protection is per open form.** A retry from a new form, page or device is a new
  request, and the probable-duplicate check still applies.
- **Patient and encounter replays show current state.** They are not byte-identical
  copies of the original response.
- **Appointment booking is not keyed.** A resent booking still reports a conflict
  with the user's own booking instead of replaying it.
- **Records restrict deletion.** They reference resources with `RESTRICT`. A future
  workflow that deletes patients, encounters or notifications must delete their
  records first.
- **Pruning is not automatic.** It needs a scheduled job.
