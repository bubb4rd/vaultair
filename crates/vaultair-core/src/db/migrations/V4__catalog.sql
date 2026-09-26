-- V4__catalog.sql: the platform and game catalog and game profiles (Phase 10).
--
-- The built-in platforms and games come from catalog/default_catalog.json;
-- the migration runner seeds them in this migration's transaction, right
-- after this script (see migrate.rs). The tables themselves are from V1.

-- Deleting an account sets the profile links that point at it to NULL; these
-- keep that lookup (and the Games and Platforms pages) off a table scan.
CREATE INDEX ix_gp_platform        ON game_profile(platform_id);
CREATE INDEX ix_gp_linked_launcher ON game_profile(linked_launcher_account_id);
CREATE INDEX ix_gp_linked_console  ON game_profile(linked_console_account_id);
