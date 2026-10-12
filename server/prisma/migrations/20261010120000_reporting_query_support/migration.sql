-- Clinical aggregate access is audited separately from record/history views.
ALTER TYPE "AuditAction" ADD VALUE 'CLINICAL_REPORT_VIEWED';
