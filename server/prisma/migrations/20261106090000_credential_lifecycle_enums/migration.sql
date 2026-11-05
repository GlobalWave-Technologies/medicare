-- Audit actions for the credential lifecycle, and staff creation as an idempotent operation.
-- Enum values are added on their own: PostgreSQL cannot use a new value in the transaction
-- that adds it, so the next migration (which references STAFF_CREATE) runs separately.
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_RESET';
ALTER TYPE "IdempotentOperation" ADD VALUE 'STAFF_CREATE';
