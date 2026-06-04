-- AddColumn: is_super_admin on users (KAN-49 first-run-bootstrap MEDIUM-1)
-- Additive migration — DEFAULT false means existing rows are unaffected.
-- Set atomically alongside ownerUserId in claimInstance() so /me can derive
-- isSuperAdmin from a single user-row read (no InstanceSettings JOIN needed).
ALTER TABLE "users" ADD COLUMN "is_super_admin" BOOLEAN NOT NULL DEFAULT false;
