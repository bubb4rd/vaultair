-- V8__prospects.sql: prospective accounts on the relationship map.
--
-- An email that accounts sign in or recover with, while no email account in
-- the vault signs in with it, is drawn as an account the user could add (the
-- mailbox behind the address). Discarding that suggestion sets this; adding
-- the mailbox account makes it moot. NULL means the suggestion is shown.
ALTER TABLE contact_point ADD COLUMN mailbox_dismissed_at TEXT;
