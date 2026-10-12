ALTER TYPE "AuditAction" ADD VALUE 'LOGOUT';
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_REVOKED';
ALTER TYPE "AuditEntityType" ADD VALUE 'AUTH_ATTEMPT';

CREATE TABLE "StaffSession" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "staffUserId" UUID NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "csrfToken" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StaffSession_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "StaffSession_hash_format" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "StaffSession_csrf_format" CHECK ("csrfToken" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "StaffSession_expiry" CHECK ("expiresAt" > "createdAt")
);
CREATE UNIQUE INDEX "StaffSession_tokenHash_key" ON "StaffSession"("tokenHash");
CREATE INDEX "StaffSession_staffUserId_revokedAt_idx" ON "StaffSession"("staffUserId", "revokedAt");
CREATE INDEX "StaffSession_expiresAt_idx" ON "StaffSession"("expiresAt");
