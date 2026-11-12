-- Phase 19B enum values, committed before the catalog migration (PostgreSQL refuses a new enum
-- value in the transaction that added it).
ALTER TYPE "AuditAction" ADD VALUE 'MEDICATION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'MEDICATION_DEACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'MEDICATION_REACTIVATED';

ALTER TYPE "AuditEntityType" ADD VALUE 'MEDICATION';
