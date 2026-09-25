-- V3__identities.sql: identities and contact points (Phase 8).

-- A contact point's value as first entered, for display. `value_normalized`
-- (ASCII-lowercased, see `domain::identity::normalize_contact`) is what
-- matching and the UNIQUE constraint use.
ALTER TABLE contact_point ADD COLUMN value_display TEXT;

-- Accounts saved before this migration have emails but no contact points.
-- Every account save upserts its login email from now on; this does the same
-- once for existing rows. SQLite's lower() folds ASCII only, exactly like
-- `normalize_contact`, so these rows match the ones Rust creates later. Ids
-- here are random rather than UUIDv7; ids are opaque, so that's fine.
INSERT OR IGNORE INTO contact_point (id, kind, value_normalized, value_display, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), 'email', lower(trim(email)), lower(trim(email)),
         strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  FROM account
  WHERE email IS NOT NULL AND trim(email) <> ''
  GROUP BY lower(trim(email));

INSERT OR IGNORE INTO account_contact (account_id, contact_point_id, role)
  SELECT a.id, c.id, 'login_email'
  FROM account a
  JOIN contact_point c ON c.kind = 'email' AND c.value_normalized = lower(trim(a.email))
  WHERE a.email IS NOT NULL;

CREATE INDEX ix_identity_archived ON identity(archived_at);
