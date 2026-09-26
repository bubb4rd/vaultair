-- V7__saved_views.sql: built-in saved views for the account list (Phase 11).
--
-- filter_json is the versioned filter language in `search::filters`
-- (ViewSpec). Built-in ids are stable so the UI and tests can refer to
-- them; built-ins can't be edited or deleted. "Archived" is the view behind
-- the sidebar's Archived entry. Purpose ids are the V2 built-ins.
INSERT OR IGNORE INTO saved_view (id, name, icon, filter_json, is_builtin, sort_order, created_at, updated_at) VALUES
  ('builtin-view-main',          'Main',                    'crown',     '{"v":1,"filter":{"purposeIds":["builtin-main"]}}', 1, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('builtin-view-alts',          'Alts',                    'users',     '{"v":1,"filter":{"purposeIds":["builtin-alt"]}}', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('builtin-view-high-priority', 'High-priority',           'flag',      '{"v":1,"filter":{"highPriority":true}}', 1, 2, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('builtin-view-missing-mfa',   'Missing MFA',             'shield',    '{"v":1,"filter":{"mfa":false}}', 1, 3, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('builtin-view-missing-codes', 'Missing recovery codes',  'lifebuoy',  '{"v":1,"filter":{"recoveryCodes":false}}', 1, 4, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('builtin-view-primary-email', 'Uses primary email',      'envelope',  '{"v":1,"filter":{"usesPrimaryEmail":true}}', 1, 5, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('builtin-view-recent',        'Recently updated',        'clock',     '{"v":1,"filter":{"updatedInDays":30},"sort":{"key":"updated","descending":true}}', 1, 6, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('builtin-view-dormant',       'Dormant',                 'moon',      '{"v":1,"filter":{"statuses":["dormant"]}}', 1, 7, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('builtin-view-archived',      'Archived',                'archive',   '{"v":1,"filter":{"archived":true}}', 1, 8, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

CREATE INDEX ix_saved_view_order ON saved_view(is_builtin DESC, sort_order, name);
