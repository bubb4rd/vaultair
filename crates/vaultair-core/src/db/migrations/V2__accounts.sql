-- V2__accounts.sql: what account CRUD needs (Phase 7).

-- When an account was starred. The sidebar lists favorites in starring order
-- (ADR-0004 decision 20); `favorite` stays the flag the index and filters use.
ALTER TABLE account ADD COLUMN favorited_at TEXT;

-- Built-in purposes. Every account needs one (account.purpose_id is NOT NULL).
-- Not seeded: "Smurf" (ADR-0004 decision 1, custom only) and "Shared household"
-- (still open; decided before Phase 9). Built-in ids are stable so tests and
-- the demo seed can refer to them. INSERT OR IGNORE: a vault that already has
-- a purpose with one of these slugs keeps its own row.
INSERT OR IGNORE INTO purpose_label (id, slug, name, is_builtin, sort_order, created_at, updated_at) VALUES
  ('builtin-main',        'main',        'Main',        1, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('builtin-competitive', 'competitive', 'Competitive', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('builtin-ranked',      'ranked',      'Ranked',      1, 2, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('builtin-casual',      'casual',      'Casual',      1, 3, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('builtin-alt',         'alt',         'Alt',         1, 4, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('builtin-creator',     'creator',     'Creator',     1, 5, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('builtin-testing',     'testing',     'Testing',     1, 6, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('builtin-work',        'work',        'Work',        1, 7, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('builtin-recovery',    'recovery',    'Recovery',    1, 8, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('builtin-other',       'other',       'Other',       1, 9, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

CREATE INDEX ix_account_favorited ON account(favorited_at) WHERE favorite = 1;
CREATE INDEX ix_cf_account ON account_custom_field(account_id);
