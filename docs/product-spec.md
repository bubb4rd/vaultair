The product is not intended to be a generic Bitwarden, KeePassXC, or password-manager clone. Its core differentiation is that it is purpose-built for users who manage multiple digital identities across games, platforms, launchers, and services—such as main accounts, alternate accounts, competitive accounts, casual accounts, testing accounts, and creator accounts.

The application must be local-first. User vault data must be stored locally on the user’s computer by default, with no required account, no required cloud sync, no mandatory server, and no company access to vault contents.

---

## Product Vision

Create a local encrypted vault that helps users answer questions such as:

- Which email is linked to this Call of Duty account?
- Which Steam, Battle.net, Activision, Discord, Xbox, or PlayStation account is associated with this identity?
- Does this account have 2FA enabled?
- Where are its recovery codes stored?
- Which accounts use the same email address or recovery method?
- Which accounts are old, inactive, missing MFA, or use reused passwords?
- Which account is my main account versus an alt, test, ranked, casual, or creator account?

The application should feel modern, highly organized, privacy-first, and appropriate for PC gamers and power users.

The product must only support legitimate account management. Do not build auto-login scripts, game-client injection, credential extraction, anti-cheat circumvention, ban evasion, account trading tools, or anything intended to bypass platform restrictions or game security.

---

## Core Product Promise

Display the following privacy principles clearly in onboarding and settings:

- Your vault is encrypted and stored on your computer.
- No account is required to create or use a vault.
- No remote server is required for the core application.
- The app must not upload credentials, account metadata, or vault contents by default.
- The user chooses where encrypted vault files and backups are stored.
- Optional sync, if implemented later, must be opt-in and use user-controlled storage or self-hosted infrastructure.
- The company must never possess the user’s vault encryption key or master password.
- A forgotten master password cannot be recovered by the company in a true local encrypted vault model.

---

# Target Platform

## Initial platform

Build Windows-first desktop support.

The architecture should be portable to macOS and Linux later.

## Suggested technology stack

Use:

- Tauri
- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui or an equivalent high-quality component system
- SQLite for structured local data
- SQLCipher or another proven encryption-at-rest approach for the local database
- Rust for sensitive desktop-side functionality and native integrations

Avoid Electron unless there is a clear technical need that Tauri cannot meet.

The UI should be dark-mode-first, clean, modern, responsive, and premium. It should feel closer to a polished gaming utility or high-quality developer product than an outdated enterprise password manager.

---

# Security Requirements

This is security-sensitive software. Do not implement custom cryptography primitives.

Use mature, audited libraries and established cryptographic patterns.

## Vault encryption

The application must:

- Encrypt all stored sensitive vault data at rest.
- Require a master password to decrypt and open the vault.
- Use a memory-hard password-based key derivation function such as Argon2id.
- Generate a unique cryptographically secure random salt for each vault.
- Use authenticated encryption through a vetted library.
- Never store the master password in plaintext.
- Never store decrypted credentials in SQLite, local storage, browser storage, logs, analytics, crash reports, clipboard history, or plaintext files.
- Keep decrypted secrets in memory only while the vault is unlocked.
- Clear or minimize secret lifetime in memory where practical.
- Lock the vault automatically after a configurable inactivity timeout.
- Lock the vault when the Windows session locks.
- Provide a manual “Lock Vault” action.
- Require the master password after the vault locks unless a secure OS-level unlock option is explicitly enabled.

## Operating-system integrations

Use secure operating-system storage where appropriate:

- Windows Credential Manager or DPAPI on Windows
- macOS Keychain on macOS
- Linux Secret Service where supported

These should only be used for carefully scoped device-bound secrets or user-approved convenience features. Do not use OS storage as a substitute for the master-password-protected encrypted vault.

## Clipboard behavior

When copying a username, password, recovery code, or TOTP code:

- Show a confirmation toast.
- Clear the clipboard automatically after a configurable duration, defaulting to 30 seconds.
- Allow the user to cancel clipboard clearing if needed.
- Never keep a clipboard history in the application.
- Avoid exposing secrets in screenshots, logs, or error reporting.

## Logging

Never log:

- Passwords
- Master passwords
- TOTP secrets
- Recovery codes
- Full usernames or emails unless specifically redacted
- Full vault contents
- Encryption keys
- Sensitive notes
- Attachments

Use explicit redaction utilities for diagnostic logs.

---

# Core Data Model

Design a structured model that is more useful than a generic username/password list.

## Vault

A Vault is the encrypted container for all user data.

Suggested fields:

- id
- displayName
- createdAt
- updatedAt
- encryptionVersion
- kdfConfiguration
- vaultFilePath or databasePath
- optional vault icon or color
- security settings
- auto-lock timeout
- clipboard-clear timeout

## Identity

An Identity represents a broader digital identity that can be connected to many accounts.

Examples:

- Personal primary identity
- Competitive gaming identity
- Creator identity
- Testing identity
- Secondary identity

Suggested fields:

- id
- name
- description
- primaryEmail
- recoveryEmail
- phone number reference
- notes
- tags
- color
- icon
- createdAt
- updatedAt

The application should allow a user to connect multiple accounts to one identity.

## Account

An Account is an individual login or platform profile.

Examples:

- Steam account
- Battle.net account
- Activision account
- Riot Games account
- Epic Games account
- Discord account
- Xbox account
- PlayStation Network account
- Twitch account
- EA account
- Ubisoft account
- Game-specific account
- Website login
- App login
- Email account

Suggested fields:

- id
- title
- accountType
- accountPurpose
- identityId
- username
- email
- password
- websiteUrl
- loginUrl
- platform
- publisher
- game
- region
- playerId
- displayName
- accountStatus
- createdAt
- updatedAt
- lastVerifiedAt
- lastPasswordChangedAt
- passwordStrength metadata
- tags
- notes
- favorite
- archived

### Account purpose options

Provide defaults:

- Main
- Competitive
- Ranked
- Casual
- Alt
- Smurf
- Creator
- Testing
- Work
- Shared household
- Recovery
- Other

Allow users to create custom purpose labels.

### Account status options

Provide defaults:

- Active
- Dormant
- Locked
- Suspended
- Retired
- Archived
- Unknown

Do not include account selling or transfer workflows.

## Game Profile

A Game Profile is a gaming-specific record associated with an account.

Suggested fields:

- id
- gameName
- franchise
- publisher
- platform
- accountId
- username or gamer tag
- player ID
- region
- rank or competitive tier
- current season
- game notes
- linked launcher
- linked console account
- createdAt
- updatedAt

Game-specific fields must remain private and stored within the encrypted vault.

## Platform Connection

A Platform Connection shows a relationship between accounts.

Examples:

- Activision account connected to Battle.net
- Activision account connected to PlayStation Network
- Steam account connected to Discord
- Primary email connected to Riot Games
- Xbox account connected to EA

Suggested fields:

- id
- sourceAccountId
- destinationAccountId
- relationshipType
- linkedAt
- verifiedAt
- notes

Relationship types:

- Linked login
- Recovery email
- Shared email
- Shared authenticator
- Shared phone number
- Connected console
- Connected launcher
- Connected social account
- Parent or child relationship
- Custom

## MFA / 2FA Data

Support secure MFA metadata.

Suggested fields:

- id
- accountId
- enabled
- method
- totpSecret
- backupCodes
- recoveryInstructions
- lastVerifiedAt
- notes

MFA method options:

- Authenticator app
- TOTP
- Hardware security key
- SMS
- Email
- Recovery codes only
- Unknown

The TOTP secret and recovery codes must be encrypted as highly sensitive data.

## Attachments

Allow encrypted attachments later in the roadmap.

Examples:

- Account purchase receipts
- Recovery PDFs
- Screenshots of important account information
- Official support correspondence
- Backup code documents

Suggested fields:

- id
- accountId
- encryptedBlobPath
- fileName
- fileType
- fileSize
- createdAt

Do not store attachments unencrypted.

---

# MVP Features

## 1. Vault onboarding

Create a first-run onboarding flow:

1. Welcome screen
2. Explain local-first model
3. Explain that the master password cannot be recovered
4. Prompt user to create a vault name
5. Prompt user to choose a vault storage location
6. Prompt user to create and confirm a master password
7. Show password-strength guidance
8. Offer an optional recovery checklist, not a recovery backdoor
9. Explain local backup recommendations
10. Enter the dashboard

The onboarding should be visually polished and confidence-inspiring.

## 2. Vault dashboard

Create a dashboard with:

- Total account count
- Main vs alternate account count
- Number of games represented
- Number of connected identities
- Recent entries
- Favorite accounts
- Accounts needing attention
- Missing MFA count
- Missing recovery-code count
- Reused password count
- Weak password count
- Dormant account count
- Recently modified accounts
- Quick actions:
  - Add account
  - Add game profile
  - Add identity
  - Search vault
  - Lock vault

## 3. Account management

Users must be able to:

- Create accounts
- Edit accounts
- Archive accounts
- Permanently delete accounts with confirmation
- Duplicate accounts to create alt-account templates
- Add custom fields
- Add tags
- Mark accounts as favorites
- Add notes
- Store URLs
- Open official login pages in the browser
- Copy username
- Copy password
- Copy TOTP code when available
- Copy recovery codes when available
- Reveal a password only after intentional user interaction
- Generate a new password
- Track last password change date
- Search and filter accounts

## 4. Identity management

Users must be able to:

- Create multiple identities
- Assign accounts to identities
- View all accounts connected to an identity
- View shared emails, recovery methods, and platforms
- Add identity-specific notes
- Filter the dashboard by identity
- View potential account dependencies during recovery

## 5. Relationship map

Build a polished account relationship graph.

The user should be able to select an identity, account, email, platform, or game and visually understand connected accounts.

Example:

Primary Gaming Identity ├── Primary Email │ ├── Battle.net │ │ └── Activision / Call of Duty Main Account │ ├── Steam │ │ └── CS2 Main Account │ ├── Discord │ └── Twitch ├── Recovery Email └── Authenticator / MFA Entry

The graph should:

- Show nodes for identities, emails, accounts, platforms, games, MFA methods, and recovery methods.
- Display relationship types with visual labels or colors.
- Allow clicking a node to open the related record.
- Support a simplified list fallback for accessibility and performance.
- Never expose passwords directly in the graph.

## 6. Search and organization

Implement fast local full-text search.

Search should support:

- Account title
- Username
- Email
- Game
- Platform
- Publisher
- Tag
- Identity
- Account purpose
- Notes
- Region
- Player ID

Implement filters:

- Game
- Platform
- Publisher
- Identity
- Account purpose
- Account status
- MFA enabled or disabled
- Has recovery codes
- Favorite
- Archived
- Last verified date
- Tag

## 7. Password generator

Include a strong password generator with:

- Configurable length
- Uppercase
- Lowercase
- Numbers
- Symbols
- Exclude ambiguous characters
- Memorable passphrase mode
- Strength indicator
- Copy-to-clipboard action
- Ability to save generated password directly to an account record

The generator must use cryptographically secure randomness from the operating system.

## 8. Account health dashboard

Build local-only account health checks.

Initially include:

- Weak passwords
- Reused passwords
- Missing MFA
- Missing recovery codes
- Missing recovery email
- Long time since password change
- Long time since account verification
- Dormant accounts
- Accounts with incomplete required fields
- Multiple accounts tied to the same email
- Multiple accounts tied to the same recovery method

Do not send vault data to a server for these checks.

A future privacy-preserving breach-check feature may be planned, but do not implement it in the first MVP unless its privacy model is fully specified and reviewed.

## 9. Backup and export

Implement backup safeguards.

Requirements:

- Allow users to choose an encrypted backup destination.
- Allow creation of dated encrypted vault backups.
- Show backup age and last successful backup in settings.
- Warn users that CSV exports are plaintext and dangerous.
- Require clear user confirmation before creating plaintext exports.
- If CSV export is included, keep it disabled or buried behind strong warnings during MVP.
- Support encrypted vault-file backup as the standard backup method.
- Allow importing from common password-manager CSV formats later, with strong warnings that CSV files are plaintext.

Do not claim a deleted plaintext CSV can be securely erased on all operating systems.

---

# Information Architecture

## Primary navigation

Use a left sidebar with:

- Dashboard
- All Accounts
- Identities
- Games
- Platforms
- Relationship Map
- Security Health
- Favorites
- Archived
- Settings

Include a global search field at the top.

## Main list views

Account lists should support:

- Table view
- Card view
- Compact view
- Sorting
- Multi-select
- Bulk tagging
- Bulk archiving
- Bulk delete with strong confirmation
- Filter chips
- Saved views

Suggested saved views:

- Main accounts
- Alternate accounts
- Accounts missing MFA
- Accounts missing recovery codes
- Accounts using a primary email
- Recently updated
- Dormant accounts
- High-priority accounts

## Account detail page

Use a clean two-column detail layout.

### Left column

- Account icon
- Account title
- Game/platform/publisher
- Account purpose
- Account status
- Favorite control
- Identity association
- Tags
- Last verified date

### Right column

Sections:

- Login credentials
- Linked accounts
- Game details
- MFA and recovery
- Security health
- Notes
- Attachments
- Activity history

Sensitive values must remain hidden by default.

---

# Design Direction

The UI should be dark-mode-first and highly polished.

Avoid:

- Excessive neon effects
- Generic gamer clichés
- Loud gradients everywhere
- Cluttered dashboards
- Password values displayed in plain view
- Dense enterprise-form styling
- Overly playful visual treatment that harms trust

The product should feel secure, premium, and modern—not childish or intimidating.

## Account status colors

Use accessible colors and labels:

- Green: Active / secure
- Yellow: Needs attention
- Orange: Warning
- Red: High risk / missing critical protection
- Gray: Dormant / archived / unknown
- Blue or purple: Linked / informational

Never rely on color alone. Include text labels and icons.

---

# Privacy and Threat Model

The app must clearly explain its boundaries.

## Protect against

- Loss of account organization
- Reused passwords
- Forgotten recovery-code locations
- Confusion across game identities
- Casual local access when the vault is locked
- Unencrypted local data exposure from normal app usage
- Accidental clipboard exposure through automatic clearing
- Lack of account recovery preparedness

## Do not claim protection against

- Malware controlling an unlocked computer
- Keyloggers
- Screen capture malware
- Compromised operating systems
- A user revealing their master password
- A user losing their master password without a backup or recovery material
- Platform-level bans, account restrictions, or game enforcement actions

Write this clearly and honestly in the security documentation.

---

# Future Roadmap

Do not build all of these in the first MVP, but architect for them.

## Phase 2

- Encrypted file attachments
- Import from KeePass, Bitwarden, 1Password, Enpass, and CSV
- Custom templates for specific games and platforms
- TOTP code generation
- Passkey management exploration
- More advanced password-health reports
- Vault activity history stored locally
- Secure shareable encrypted vault exports
- Local Wi-Fi or peer-to-peer sync between user-owned devices
- User-controlled cloud folder sync for encrypted vault files
- NAS/WebDAV/SFTP sync for advanced users
- macOS support
- Linux support
- Mobile companion app

## Phase 3

- Browser extension for website login autofill
- Hardware security key support
- Secure desktop autofill where safe and technically feasible
- Privacy-preserving breach monitoring
- Household or trusted-contact vault-sharing model
- Emergency-access model, only after careful cryptographic and UX design
- Self-hosted sync server
- Local API for power users
- Encrypted backup verification and restore testing
- Security audit integrations

Browser extensions and autofill features must not be prioritized over core vault correctness and security.

---

# Explicit Non-Goals

Do not implement:

- Game cheats
- Game memory reading
- Anti-cheat bypasses
- Credential harvesting
- Credential stuffing
- Automated login attempts
- Auto-login scripting for game clients
- Ban evasion tools
- Account selling or transfer workflows
- Marketplace integrations for accounts
- Shared password databases without encryption and access controls
- Any mandatory cloud account requirement
- Tracking, ad targeting, or analytics that expose user account metadata

---

# Development Expectations

Build the MVP in a modular, production-oriented way.

## Code quality

- Use TypeScript strict mode.
- Use clear domain models.
- Keep UI components reusable.
- Separate UI, application logic, database access, encryption adapters, and native integrations.
- Use repository or service layers for vault operations.
- Validate all inputs.
- Use defensive error handling.
- Add meaningful empty states.
- Avoid hardcoded game lists where possible.
- Create a seed/demo mode that does not use real credentials.
- Never place real secrets in source code, fixtures, screenshots, or documentation.

## Testing

Add tests for:

- Vault creation
- Master-password validation
- Lock and unlock flows
- Encryption/decryption persistence behavior
- Automatic vault lock behavior
- Clipboard auto-clear behavior
- Account CRUD
- Identity-to-account relationships
- Search and filters
- Relationship graph data mapping
- Password generator constraints
- Health-check logic
- Backup creation
- Import/export warning flows
- Sensitive-data redaction in logs

Include negative tests around incorrect master passwords, corrupted vaults, missing fields, and invalid imports.

## Documentation

Create:

- README with setup instructions
- Architecture document
- Threat-model document
- Security assumptions document
- Local data-storage explanation
- Backup and restore guide
- Privacy statement draft
- User-facing “What happens if I forget my master password?” help document
- Development checklist for future browser-extension or sync work

---

# Initial Deliverables

Build the following first:

1. Windows desktop shell using Tauri, React, and TypeScript.
2. Dark-mode application shell with sidebar navigation.
3. Local vault setup flow with master-password creation.
4. Encrypted local persistence using a vetted approach.
5. Account CRUD with encrypted secrets.
6. Identity CRUD.
7. Account-purpose labels: main, competitive, ranked, casual, alt, creator, testing, and custom.
8. Game/platform fields and filtering.
9. Global search and account list views.
10. Password generator.
11. Copy-to-clipboard with automatic clearing.
12. Vault auto-lock.
13. Security-health checks for weak passwords, duplicate passwords, missing MFA, and missing recovery codes.
14. Relationship-map MVP using account and identity connections.
15. Encrypted backup flow.
16. Settings for vault, privacy, lock timeout, and clipboard timeout.

Prioritize correctness, local privacy, trustworthy UX, and high-quality data organization over adding too many integrations.

The primary customer value is not simply storing passwords. The primary customer value is helping users understand, secure, and manage their entire gaming and online-account ecosystem in one encrypted local workspace.
