-- Phase 19D: when each session, and each staff member, last used the system. Only a time is kept:
-- never the page, request or anything typed. Existing sessions start from their sign-in time and
-- existing staff from their last sign-in, so nothing is invented.
ALTER TABLE "StaffSession" ADD COLUMN "lastActivityAt" TIMESTAMPTZ(3);
UPDATE "StaffSession" SET "lastActivityAt" = "createdAt";
ALTER TABLE "StaffSession" ALTER COLUMN "lastActivityAt" SET NOT NULL,
  ALTER COLUMN "lastActivityAt" SET DEFAULT CURRENT_TIMESTAMP;
-- A session cannot be used before it was created.
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_activity_after_creation" CHECK ("lastActivityAt" >= "createdAt");

ALTER TABLE "StaffUser" ADD COLUMN "lastActivityAt" TIMESTAMPTZ(3);
UPDATE "StaffUser" SET "lastActivityAt" = "lastLoginAt" WHERE "lastLoginAt" IS NOT NULL;
