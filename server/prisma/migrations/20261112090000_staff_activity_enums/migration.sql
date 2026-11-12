-- Phase 19D: an administrator ending one of another staff member's sessions is audited on its own.
-- Enum additions only; the value is first used by the application, never in this transaction.
ALTER TYPE "AuditAction" ADD VALUE 'STAFF_SESSION_REVOKED';
