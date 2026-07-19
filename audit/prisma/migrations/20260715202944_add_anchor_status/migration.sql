-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "anchorError" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "anchorStatus" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "anchoredAt" DATETIME;
ALTER TABLE "AuditLog" ADD COLUMN "ledgerTxnSeqNo" INTEGER;
