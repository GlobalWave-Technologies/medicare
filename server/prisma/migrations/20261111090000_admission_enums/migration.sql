-- Phase 19A enum values. They are committed here, before the next migration uses them in
-- constraints (PostgreSQL refuses a new enum value in the transaction that added it).
ALTER TYPE "AuditAction" ADD VALUE 'PATIENT_ADMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'PATIENT_READMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMISSION_VIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMISSION_ROOM_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'PATIENT_DISCHARGED';

ALTER TYPE "AuditEntityType" ADD VALUE 'ADMISSION';

ALTER TYPE "IdempotentOperation" ADD VALUE 'ADMISSION_CREATE';
