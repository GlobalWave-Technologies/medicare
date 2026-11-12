-- A password issued by an administrator (account creation, reset or first credentials) is
-- temporary: the account must replace it before normal access. Existing accounts keep their
-- established passwords, so the column defaults to false; the application sets it to true.
ALTER TABLE "StaffUser" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
