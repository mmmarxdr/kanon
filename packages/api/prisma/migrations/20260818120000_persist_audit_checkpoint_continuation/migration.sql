ALTER TABLE "integration_audit_checkpoints"
  ADD COLUMN "page_checkpoint_updated_at" TIMESTAMP(3),
  ADD COLUMN "page_checkpoint_remote_id" TEXT,
  ADD COLUMN "page_checkpoint_token" TEXT,
  ADD COLUMN "checkpoint_version" INTEGER,
  ADD COLUMN "previous_pass_fingerprint" TEXT,
  ADD COLUMN "pass_complete" BOOLEAN;
