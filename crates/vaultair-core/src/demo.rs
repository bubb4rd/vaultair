//! Sample data for demo vaults, so the app can be explored without real
//! accounts. Every domain is reserved for examples (RFC 2606: `example.com`,
//! `.invalid`), and every password, TOTP key and backup code is generated
//! at seeding time from OS randomness, never hardcoded. Accounts link to
//! built-in catalog platforms and games (so their logos show), but every
//! address and URL stays an example one.

use crate::clock::Clock;
use crate::crypto::{rng, totp};
use crate::domain::account::{
    AccountInput, AccountStatus, AccountType, CustomFieldInput, CustomFieldType, SecretUpdate,
};
use crate::domain::catalog::GameProfileInput;
use crate::domain::identity::{IdentityColor, IdentityInput};
use crate::domain::mfa::{MfaInput, MfaMethod};
use crate::generator::{generate_password, PasswordOptions};
use crate::service::{accounts, catalog, identities, mfa};
use crate::vault::OpenVault;
use crate::AppError;

fn rng_err(_: crate::crypto::CryptoError) -> AppError {
    AppError::Internal { context: "rng" }
}

fn password(length: u16) -> Result<SecretUpdate, AppError> {
    let options = PasswordOptions {
        length,
        ..PasswordOptions::default()
    };
    Ok(SecretUpdate::Set {
        value: generate_password(&options)?.value.clone(),
    })
}

/// A deliberately weak password (a common word and two digits), so the demo
/// shows what a weak one looks like. The digits are random; nothing here is
/// anyone's real password.
fn weak_password() -> Result<SecretUpdate, AppError> {
    const WORDS: [&str; 4] = ["dragon", "sunshine", "shadow", "monkey"];
    let [a, b, c] = *rng::secret_bytes::<3>().map_err(rng_err)?;
    let word = WORDS[usize::from(a) % WORDS.len()];
    Ok(SecretUpdate::Set {
        value: format!("{word}{}{}", b % 10, c % 10),
    })
}

fn totp_key() -> Result<SecretUpdate, AppError> {
    let bytes = rng::secret_bytes::<20>().map_err(rng_err)?;
    Ok(SecretUpdate::Set {
        value: totp::base32_encode(bytes.as_slice()).to_string(),
    })
}

fn backup_codes(count: usize) -> Result<String, AppError> {
    const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    let mut out = String::new();
    for _ in 0..count {
        let bytes = rng::secret_bytes::<8>().map_err(rng_err)?;
        let code: String = bytes
            .iter()
            .map(|b| char::from(ALPHABET[usize::from(*b) % ALPHABET.len()]))
            .collect();
        out.push_str(&code);
        out.push('\n');
    }
    Ok(out)
}

struct DemoIdentity {
    name: &'static str,
    description: &'static str,
    primary_email: &'static str,
    recovery_email: Option<&'static str>,
    phone_ref: Option<&'static str>,
    color: IdentityColor,
}

const IDENTITIES: [DemoIdentity; 3] = [
    DemoIdentity {
        name: "Main",
        description: "Everyday gaming and the accounts everything else recovers through.",
        primary_email: "nightowl@example.com",
        recovery_email: None,
        phone_ref: Some("Pixel, ends 42"),
        color: IdentityColor::Blue,
    },
    DemoIdentity {
        name: "Competitive",
        description: "Ranked and practice accounts.",
        primary_email: "nightowl.ranked@example.com",
        recovery_email: Some("nightowl@example.com"),
        phone_ref: None,
        color: IdentityColor::Rose,
    },
    DemoIdentity {
        name: "Creator",
        description: "Public-facing streaming and community accounts.",
        primary_email: "creator@example.com",
        recovery_email: Some("nightowl@example.com"),
        phone_ref: None,
        color: IdentityColor::Violet,
    },
];

struct Sample {
    title: &'static str,
    account_type: AccountType,
    purpose: &'static str,
    status: AccountStatus,
    /// The name of one of `IDENTITIES`.
    identity: Option<&'static str>,
    username: Option<&'static str>,
    email: Option<&'static str>,
    recovery_email: Option<&'static str>,
    recovery_phone: Option<&'static str>,
    website: Option<&'static str>,
    /// A built-in catalog platform id.
    platform: Option<&'static str>,
    /// A built-in catalog game id.
    game: Option<&'static str>,
    /// A game profile on the account.
    profile: Option<SampleProfile>,
    publisher: Option<&'static str>,
    region: Option<&'static str>,
    player_id: Option<&'static str>,
    tags: &'static [&'static str],
    notes: Option<&'static str>,
    strong_password: bool,
    mfa: Option<MfaMethod>,
    backup_codes: usize,
    favorite: bool,
    archived: bool,
}

struct SampleProfile {
    game: &'static str,
    gamertag: &'static str,
    rank: &'static str,
    season: Option<&'static str>,
    region: Option<&'static str>,
}

const fn sample(title: &'static str, account_type: AccountType, purpose: &'static str) -> Sample {
    Sample {
        title,
        account_type,
        purpose,
        status: AccountStatus::Active,
        identity: None,
        username: None,
        email: None,
        recovery_email: None,
        recovery_phone: None,
        website: None,
        platform: None,
        game: None,
        profile: None,
        publisher: None,
        region: None,
        player_id: None,
        tags: &[],
        notes: None,
        strong_password: true,
        mfa: None,
        backup_codes: 0,
        favorite: false,
        archived: false,
    }
}

fn samples() -> Vec<Sample> {
    vec![
        Sample {
            username: Some("nightowl"),
            email: Some("nightowl@example.com"),
            website: Some("https://store.example.com/login"),
            tags: &["pc", "library"],
            mfa: Some(MfaMethod::AuthenticatorApp),
            backup_codes: 10,
            favorite: true,
            notes: Some("Main game library. Family sharing is on for the second PC."),
            identity: Some("Main"),
            recovery_phone: Some("Pixel, ends 42"),
            platform: Some("builtin-pl-steam"),
            profile: Some(SampleProfile {
                game: "builtin-game-cs2",
                gamertag: "nightowl",
                rank: "Premier 14,200",
                season: None,
                region: Some("Europe"),
            }),
            ..sample("Game store (main)", AccountType::Launcher, "main")
        },
        Sample {
            username: Some("NightOwl#2231"),
            email: Some("nightowl@example.com"),
            website: Some("https://launcher.example.com"),
            platform: Some("builtin-pl-battlenet"),
            profile: Some(SampleProfile {
                game: "builtin-game-overwatch2",
                gamertag: "NightOwl#2231",
                rank: "Platinum 3",
                season: Some("Season 14"),
                region: Some("Europe"),
            }),
            region: Some("Europe"),
            tags: &["pc", "competitive"],
            mfa: Some(MfaMethod::AuthenticatorApp),
            backup_codes: 8,
            favorite: true,
            identity: Some("Main"),
            ..sample("Launcher account", AccountType::Launcher, "main")
        },
        Sample {
            username: Some("n1ghtowl"),
            email: Some("nightowl.ranked@example.com"),
            website: Some("https://arena.example.com"),
            platform: Some("builtin-pl-riot"),
            game: Some("builtin-game-valorant"),
            profile: Some(SampleProfile {
                game: "builtin-game-valorant",
                gamertag: "NightOwl#EUW",
                rank: "Diamond 2",
                season: Some("Episode 9, Act 2"),
                region: Some("EU"),
            }),
            region: Some("EUW"),
            player_id: Some("NightOwl#EUW"),
            tags: &["ranked"],
            mfa: Some(MfaMethod::Email),
            identity: Some("Competitive"),
            recovery_email: Some("nightowl@example.com"),
            ..sample("Arena ranked (EUW)", AccountType::Game, "ranked")
        },
        Sample {
            username: Some("owl_alt_02"),
            email: Some("owl.alt@example.com"),
            website: Some("https://arena.example.com"),
            platform: Some("builtin-pl-riot"),
            game: Some("builtin-game-valorant"),
            region: Some("EUW"),
            tags: &["ranked"],
            strong_password: false,
            notes: Some("Practice account for trying new roles."),
            identity: Some("Competitive"),
            recovery_email: Some("nightowl.ranked@example.com"),
            ..sample("Arena alt", AccountType::Game, "alt")
        },
        Sample {
            username: Some("nightowl.tv"),
            email: Some("creator@example.com"),
            website: Some("https://chat.example.com"),
            platform: Some("builtin-pl-discord"),
            tags: &["creator"],
            mfa: Some(MfaMethod::Totp),
            backup_codes: 6,
            identity: Some("Creator"),
            recovery_email: Some("nightowl@example.com"),
            ..sample("Community chat", AccountType::Social, "creator")
        },
        Sample {
            username: Some("nightowl_live"),
            email: Some("creator@example.com"),
            website: Some("https://stream.example.com"),
            platform: Some("builtin-pl-twitch"),
            tags: &["creator"],
            identity: Some("Creator"),
            ..sample("Streaming channel", AccountType::Streaming, "creator")
        },
        Sample {
            email: Some("creator@example.com"),
            website: Some("https://mail.example.com"),
            tags: &["creator"],
            identity: Some("Creator"),
            notes: Some("The creator accounts reset through this mailbox, and it has no MFA yet."),
            ..sample("Creator email", AccountType::Email, "creator")
        },
        Sample {
            email: Some("nightowl@example.com"),
            website: Some("https://mail.example.com"),
            tags: &["recovery"],
            mfa: Some(MfaMethod::HardwareKey),
            backup_codes: 10,
            favorite: true,
            notes: Some("Recovery email for most game accounts. Keep it the most protected."),
            identity: Some("Main"),
            recovery_phone: Some("Pixel, ends 42"),
            ..sample("Primary email", AccountType::Email, "recovery")
        },
        Sample {
            username: Some("owl2014"),
            email: Some("old.owl@example.invalid"),
            platform: Some("builtin-pl-epic"),
            status: AccountStatus::Dormant,
            strong_password: false,
            notes: Some("Not used since 2019. Consider closing it."),
            ..sample("Old launcher", AccountType::Launcher, "casual")
        },
        Sample {
            username: Some("owl_test"),
            email: Some("owl.test@example.invalid"),
            status: AccountStatus::Retired,
            archived: true,
            ..sample("Beta test account", AccountType::Game, "testing")
        },
    ]
}

/// Fills a freshly created demo vault with sample identities and accounts.
pub fn seed(vault: &mut OpenVault, clock: &dyn Clock) -> Result<(), AppError> {
    let mut identity_ids = Vec::new();
    for i in &IDENTITIES {
        let created = identities::create(
            vault,
            clock,
            &IdentityInput {
                name: i.name.into(),
                description: Some(i.description.into()),
                primary_email: Some(i.primary_email.into()),
                recovery_email: i.recovery_email.map(Into::into),
                phone_ref: i.phone_ref.map(Into::into),
                notes: None,
                color: Some(i.color),
                tags: Vec::new(),
            },
        )?;
        identity_ids.push((i.name, created.id));
    }
    let identity_id = |name: Option<&str>| {
        name.and_then(|n| {
            identity_ids
                .iter()
                .find(|(k, _)| *k == n)
                .map(|(_, id)| id.clone())
        })
    };

    let purposes = accounts::purposes(vault)?;
    let purpose_id = |slug: &str| {
        purposes
            .iter()
            .find(|p| p.slug == slug)
            .map(|p| p.id.clone())
            .ok_or(AppError::Internal {
                context: "demo purposes",
            })
    };

    for s in samples() {
        let custom_fields = if s.favorite && s.account_type == AccountType::Launcher {
            vec![
                CustomFieldInput {
                    id: None,
                    label: "Security answer".into(),
                    field_type: CustomFieldType::Secret,
                    value: None,
                    secret: password(12)?,
                },
                CustomFieldInput {
                    id: None,
                    label: "Created".into(),
                    field_type: CustomFieldType::Date,
                    value: Some("2016-03-12".into()),
                    secret: SecretUpdate::Unchanged,
                },
            ]
        } else {
            Vec::new()
        };
        let input = AccountInput {
            title: s.title.into(),
            account_type: s.account_type,
            purpose_id: purpose_id(s.purpose)?,
            status: s.status,
            identity_id: identity_id(s.identity),
            username: s.username.map(Into::into),
            email: s.email.map(Into::into),
            recovery_email: s.recovery_email.map(Into::into),
            recovery_phone: s.recovery_phone.map(Into::into),
            password: if s.strong_password {
                password(20)?
            } else {
                weak_password()?
            },
            website_url: s.website.map(Into::into),
            login_url: None,
            platform_id: s.platform.map(Into::into),
            game_id: s.game.map(Into::into),
            publisher: s.publisher.map(Into::into),
            region: s.region.map(Into::into),
            player_id: s.player_id.map(Into::into),
            display_name: None,
            notes: s.notes.map(Into::into),
            sensitive_notes: SecretUpdate::Unchanged,
            tags: s.tags.iter().map(|t| (*t).to_owned()).collect(),
            custom_fields,
        };
        let account = accounts::create(vault, clock, &input)?;

        if let Some(p) = &s.profile {
            catalog::create_profile(
                vault,
                clock,
                &account.id,
                &GameProfileInput {
                    game_id: p.game.into(),
                    platform_id: s.platform.map(Into::into),
                    gamertag: Some(p.gamertag.into()),
                    player_id: None,
                    region: p.region.map(Into::into),
                    rank_tier: Some(p.rank.into()),
                    current_season: p.season.map(Into::into),
                    notes: None,
                    linked_launcher_account_id: None,
                    linked_console_account_id: None,
                },
            )?;
        }

        if let Some(method) = s.mfa {
            let with_totp = matches!(method, MfaMethod::AuthenticatorApp | MfaMethod::Totp);
            let saved = mfa::upsert(
                vault,
                clock,
                &account.id,
                &MfaInput {
                    id: None,
                    method,
                    enabled: true,
                    totp_secret: if with_totp {
                        totp_key()?
                    } else {
                        SecretUpdate::Unchanged
                    },
                    recovery_instructions: SecretUpdate::Unchanged,
                    notes: None,
                },
            )?;
            if s.backup_codes > 0 {
                if let Some(m) = saved.mfa.first() {
                    let codes = zeroize::Zeroizing::new(backup_codes(s.backup_codes)?);
                    mfa::set_backup_codes(vault, clock, &m.id, Some(&codes))?;
                    // Two codes already used, so the remaining count is visible.
                    mfa::mark_code_used(vault, clock, &m.id, 0, true)?;
                    mfa::mark_code_used(vault, clock, &m.id, 1, true)?;
                }
            }
        }
        if s.favorite {
            accounts::set_favorite(vault, clock, &account.id, true)?;
        }
        if s.archived {
            accounts::set_archived(vault, clock, &account.id, true)?;
        }
    }
    tracing::info!("demo vault seeded");
    Ok(())
}
