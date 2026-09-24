-- V1__init.sql: initial schema (docs/implementation-plan.md §3).
-- IDs are UUIDv7 text, timestamps ISO-8601 UTC text, enums TEXT + CHECK.
-- *_enc columns hold field envelopes (crypto/envelope.rs) and are NEVER indexed.
CREATE TABLE vault_meta (
  id TEXT PRIMARY KEY CHECK (id = 'singleton'),
  vault_id TEXT NOT NULL,                -- mirrors header, for display/consistency check
  display_name TEXT NOT NULL,
  icon TEXT, color TEXT,
  encryption_version INTEGER NOT NULL,   -- mirror of header field_envelope_version (read-only in UI)
  kdf_summary TEXT NOT NULL,             -- mirror for display ("Argon2id 128 MiB / t3 / p4")
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE vault_settings (           -- one row per key; typed in Rust
  key TEXT PRIMARY KEY,                 -- auto_lock_minutes, clipboard_clear_seconds, reveal_hide_seconds,
  value TEXT NOT NULL,                  -- lock_on_session_lock, lock_on_sleep, lock_on_minimize,
  updated_at TEXT NOT NULL              -- backup_dir, last_backup_at, last_backup_status, health thresholds
);

CREATE TABLE purpose_label (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,            -- 'main','competitive',... stable for built-ins
  name TEXT NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  color TEXT, icon TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE platform (                  -- Steam, Battle.net, Discord, Xbox, PSN, email providers...
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('launcher','console','publisher','social','streaming','email','website','app','other')),
  publisher TEXT, default_login_url TEXT, icon TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE game (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  franchise TEXT, publisher TEXT, icon TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE identity (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  primary_email TEXT, recovery_email TEXT,
  phone_ref TEXT,                        -- reference/masked by default (see §8)
  notes TEXT, color TEXT, icon TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Emails, phones, authenticators, hardware keys as first-class nodes (graph + "shared recovery" health)
CREATE TABLE contact_point (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email','phone','authenticator_app','hardware_key','other')),
  value_normalized TEXT,                 -- lowercased email; phone ref; device label
  label TEXT,
  identity_id TEXT REFERENCES identity(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (kind, value_normalized)
);

CREATE TABLE account (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('platform','launcher','game','console','social','streaming','email','website','app','other')),
  purpose_id TEXT NOT NULL REFERENCES purpose_label(id),
  identity_id TEXT REFERENCES identity(id) ON DELETE SET NULL,
  username TEXT, email TEXT,
  password_enc BLOB,                     -- field envelope; NEVER indexed
  password_fp BLOB,                      -- HMAC fingerprint; never leaves Rust
  password_strength INTEGER CHECK (password_strength BETWEEN 0 AND 4),
  password_changed_at TEXT,
  website_url TEXT, login_url TEXT,
  platform_id TEXT REFERENCES platform(id) ON DELETE SET NULL,
  game_id TEXT REFERENCES game(id) ON DELETE SET NULL,
  publisher TEXT, region TEXT, player_id TEXT, display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','dormant','locked','suspended','retired','archived','unknown')),
  notes TEXT,                            -- indexed (non-sensitive notes)
  sensitive_notes_enc BLOB,              -- field envelope; NEVER indexed
  favorite INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  last_verified_at TEXT,                 -- set only by explicit user action
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE account_contact (           -- login email, recovery email/phone, authenticator
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  contact_point_id TEXT NOT NULL REFERENCES contact_point(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('login_email','recovery_email','recovery_phone','authenticator','hardware_key','other')),
  PRIMARY KEY (account_id, contact_point_id, role)
);

CREATE TABLE account_custom_field (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('text','secret','url','email','number','date')),
  value_text TEXT,                       -- used when not secret
  value_enc BLOB,                        -- used when field_type='secret'; NEVER indexed
  sort_order INTEGER NOT NULL DEFAULT 0,
  CHECK ((field_type = 'secret' AND value_text IS NULL) OR (field_type <> 'secret' AND value_enc IS NULL))
);

CREATE TABLE tag (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, color TEXT);
CREATE TABLE account_tag  (account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
                           tag_id TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE, PRIMARY KEY (account_id, tag_id));
CREATE TABLE identity_tag (identity_id TEXT NOT NULL REFERENCES identity(id) ON DELETE CASCADE,
                           tag_id TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE, PRIMARY KEY (identity_id, tag_id));

CREATE TABLE game_profile (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES game(id),
  platform_id TEXT REFERENCES platform(id) ON DELETE SET NULL,
  gamertag TEXT, player_id TEXT, region TEXT, rank_tier TEXT, current_season TEXT, notes TEXT,
  linked_launcher_account_id TEXT REFERENCES account(id) ON DELETE SET NULL,
  linked_console_account_id  TEXT REFERENCES account(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE platform_connection (
  id TEXT PRIMARY KEY,
  source_account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  destination_account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('linked_login','recovery_email','shared_email',
     'shared_authenticator','shared_phone','connected_console','connected_launcher','connected_social','parent_child','custom')),
  custom_label TEXT,
  linked_at TEXT, verified_at TEXT, notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (source_account_id <> destination_account_id),
  CHECK (relationship_type <> 'custom' OR custom_label IS NOT NULL),
  UNIQUE (source_account_id, destination_account_id, relationship_type)
);

CREATE TABLE mfa_method (                -- many per account
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  method TEXT NOT NULL CHECK (method IN ('authenticator_app','totp','hardware_key','sms','email','recovery_codes_only','unknown')),
  contact_point_id TEXT REFERENCES contact_point(id) ON DELETE SET NULL,  -- phone/email/device used
  totp_secret_enc BLOB,                  -- NEVER indexed
  totp_algorithm TEXT, totp_digits INTEGER, totp_period INTEGER,
  backup_codes_enc BLOB,                 -- NEVER indexed
  backup_codes_remaining INTEGER NOT NULL DEFAULT 0,
  backup_codes_updated_at TEXT,
  recovery_instructions_enc BLOB,        -- NEVER indexed
  last_verified_at TEXT, notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE saved_view (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT,
  filter_json TEXT NOT NULL,             -- versioned filter DSL, validated in Rust
  is_builtin INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Indexes
CREATE INDEX ix_account_identity   ON account(identity_id);
CREATE INDEX ix_account_purpose    ON account(purpose_id);
CREATE INDEX ix_account_platform   ON account(platform_id);
CREATE INDEX ix_account_game       ON account(game_id);
CREATE INDEX ix_account_status     ON account(status);
CREATE INDEX ix_account_updated    ON account(updated_at DESC);
CREATE INDEX ix_account_fav        ON account(favorite) WHERE favorite = 1;
CREATE INDEX ix_account_archived   ON account(archived_at);
CREATE INDEX ix_account_email_norm ON account(lower(email));
CREATE INDEX ix_account_pwfp       ON account(password_fp) WHERE password_fp IS NOT NULL;
CREATE INDEX ix_account_verified   ON account(last_verified_at);
CREATE INDEX ix_acctag_tag         ON account_tag(tag_id);
CREATE INDEX ix_acccontact_cp      ON account_contact(contact_point_id, role);
CREATE INDEX ix_gp_account         ON game_profile(account_id);
CREATE INDEX ix_gp_game            ON game_profile(game_id);
CREATE INDEX ix_conn_src           ON platform_connection(source_account_id);
CREATE INDEX ix_conn_dst           ON platform_connection(destination_account_id);
CREATE INDEX ix_mfa_account        ON mfa_method(account_id);
CREATE INDEX ix_cp_identity        ON contact_point(identity_id);

-- Full-text search (plan §3.1). Maintained by the repository layer inside the
-- same transaction as each write. Never contains secrets or fingerprints.
CREATE VIRTUAL TABLE search_index USING fts5(
  entity_type UNINDEXED, entity_id UNINDEXED,
  title, username, email, game, platform, publisher, tags, identity, purpose, notes, region, player_id,
  tokenize = 'trigram case_sensitive 0'
);
