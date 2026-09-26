-- V6__last_used.sql: when the account's password was last used from
-- Vaultair (revealed or copied). With `updated_at` and `last_verified_at`
-- it makes up the account's last activity, which the list turns into
-- Active, Stale or Dormant. Nothing is backfilled: accounts start from their
-- last edit or verification.
ALTER TABLE account ADD COLUMN last_used_at TEXT;
