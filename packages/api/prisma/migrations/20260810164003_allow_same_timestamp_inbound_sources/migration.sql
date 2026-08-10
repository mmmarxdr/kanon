-- DropIndex
SET lock_timeout = '5s';
DROP INDEX "uq_inbound_application_remote_timestamp";
RESET lock_timeout;
