-- AlterTable: add time_confirmed_at to issues (KAN-157 reconciliation gate)
ALTER TABLE "issues" ADD COLUMN "time_confirmed_at" TIMESTAMP(3);
