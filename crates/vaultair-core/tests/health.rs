#![allow(clippy::unwrap_used)] // test helpers
//! Health rules (Phase 12): weak passwords, reused passwords, missing MFA,
//! missing recovery codes and dormant accounts. Archived accounts are left
//! out, and fingerprints never leave the database.

use std::collections::HashSet;
use std::path::Path;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use secrecy::SecretString;
use time::format_description::well_known::Rfc3339;
use time::Duration;
use vaultair_core::clock::{Clock, ManualClock};
use vaultair_core::crypto::kdf::KdfParams;
use vaultair_core::domain::account::{AccountInput, AccountStatus, AccountType, SecretUpdate};
use vaultair_core::domain::health::{HealthFix, HealthIssue, HealthRule, HealthSeverity};
use vaultair_core::domain::identity::IdentityInput;
use vaultair_core::domain::mfa::{MfaInput, MfaMethod};
use vaultair_core::health::thresholds::DORMANT_AFTER_DAYS;
use vaultair_core::service::{accounts, health, identities, mfa};
use vaultair_core::vault::{create_vault, CreateOptions, OpenVault};
use vaultair_core::AppError;

const PASSWORD: &str = "orbit lantern cactus mosaic";

fn new_vault(parent: &Path, clock: &dyn Clock) -> OpenVault {
    create_vault(
        &CreateOptions {
            parent_dir: parent.to_path_buf(),
            name: "Health".into(),
            kdf: KdfParams::MINIMUM,
            demo: false,
        },
        &SecretString::from(PASSWORD),
        clock,
    )
    .unwrap()
}

fn set(value: &str) -> SecretUpdate {
    SecretUpdate::Set {
        value: value.into(),
    }
}

fn input(title: &str) -> AccountInput {
    AccountInput {
        title: title.into(),
        account_type: AccountType::Launcher,
        purpose_id: "builtin-casual".into(),
        status: AccountStatus::Active,
        identity_id: None,
        username: None,
        email: None,
        password: SecretUpdate::Unchanged,
        recovery_email: None,
        recovery_phone: None,
        website_url: None,
        login_url: None,
        platform_id: None,
        game_id: None,
        publisher: None,
        region: None,
        player_id: None,
        display_name: None,
        notes: None,
        sensitive_notes: SecretUpdate::Unchanged,
        tags: Vec::new(),
        custom_fields: Vec::new(),
    }
}

fn protect(v: &mut OpenVault, clock: &dyn Clock, id: &str) {
    let saved = mfa::upsert(
        v,
        clock,
        id,
        &MfaInput {
            id: None,
            method: MfaMethod::HardwareKey,
            enabled: true,
            totp_secret: SecretUpdate::Unchanged,
            recovery_instructions: SecretUpdate::Unchanged,
            notes: None,
        },
    )
    .unwrap();
    mfa::set_backup_codes(v, clock, &saved.mfa[0].id, Some("aaaa-bbbb")).unwrap();
}

fn strength(v: &OpenVault, id: &str, score: i64) {
    v.conn()
        .execute(
            "UPDATE account SET password_strength = ?2 WHERE id = ?1",
            (id, score),
        )
        .unwrap();
}

fn stamp(t: time::OffsetDateTime) -> String {
    t.format(&Rfc3339).unwrap()
}

fn activity(v: &OpenVault, id: &str, at: &str) {
    v.conn()
        .execute(
            "UPDATE account SET updated_at = ?2, last_verified_at = NULL, last_used_at = NULL
             WHERE id = ?1",
            (id, at),
        )
        .unwrap();
}

fn find<'a>(issues: &'a [HealthIssue], title: &str, rule: HealthRule) -> Option<&'a HealthIssue> {
    issues.iter().find(|i| i.title == title && i.rule == rule)
}

#[test]
fn each_rule_includes_its_boundary_and_excludes_archived() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let c = &clock;
    let mut v = new_vault(tmp.path(), c);

    let make = |v: &mut OpenVault, title: &str, password: Option<&str>, status: AccountStatus| {
        let mut form = input(title);
        form.status = status;
        if let Some(password) = password {
            form.password = set(password);
        }
        accounts::create(v, c, &form).unwrap()
    };

    let score_one = make(
        &mut v,
        "Score one",
        Some("pw-score-one"),
        AccountStatus::Active,
    );
    strength(&v, &score_one.id, 1);
    protect(&mut v, c, &score_one.id);

    let score_two = make(
        &mut v,
        "Score two",
        Some("pw-score-two"),
        AccountStatus::Active,
    );
    strength(&v, &score_two.id, 2);
    protect(&mut v, c, &score_two.id);

    let none = make(&mut v, "No password", None, AccountStatus::Active);
    protect(&mut v, c, &none.id);

    let shared_a = make(&mut v, "Shared A", Some("pw-shared"), AccountStatus::Active);
    let shared_b = make(&mut v, "Shared B", Some("pw-shared"), AccountStatus::Active);
    strength(&v, &shared_a.id, 3);
    strength(&v, &shared_b.id, 3);
    protect(&mut v, c, &shared_a.id);
    protect(&mut v, c, &shared_b.id);

    let only = make(
        &mut v,
        "Only copy",
        Some("pw-archived-twin"),
        AccountStatus::Active,
    );
    let twin = make(
        &mut v,
        "Archived twin",
        Some("pw-archived-twin"),
        AccountStatus::Active,
    );
    strength(&v, &only.id, 3);
    strength(&v, &twin.id, 3);
    protect(&mut v, c, &only.id);
    protect(&mut v, c, &twin.id);
    accounts::set_archived(&mut v, c, &twin.id, true).unwrap();

    let no_mfa = make(&mut v, "No MFA", Some("pw-no-mfa"), AccountStatus::Active);
    strength(&v, &no_mfa.id, 3);

    let mfa_off = make(&mut v, "MFA off", Some("pw-mfa-off"), AccountStatus::Active);
    strength(&v, &mfa_off.id, 3);
    mfa::upsert(
        &mut v,
        c,
        &mfa_off.id,
        &MfaInput {
            id: None,
            method: MfaMethod::Email,
            enabled: false,
            totp_secret: SecretUpdate::Unchanged,
            recovery_instructions: SecretUpdate::Unchanged,
            notes: None,
        },
    )
    .unwrap();

    let codes_none = make(
        &mut v,
        "Codes none",
        Some("pw-codes-none"),
        AccountStatus::Active,
    );
    strength(&v, &codes_none.id, 3);
    mfa::upsert(
        &mut v,
        c,
        &codes_none.id,
        &MfaInput {
            id: None,
            method: MfaMethod::Email,
            enabled: true,
            totp_secret: SecretUpdate::Unchanged,
            recovery_instructions: SecretUpdate::Unchanged,
            notes: None,
        },
    )
    .unwrap();

    let codes_one = make(
        &mut v,
        "Codes one",
        Some("pw-codes-one"),
        AccountStatus::Active,
    );
    strength(&v, &codes_one.id, 3);
    protect(&mut v, c, &codes_one.id);

    let now = clock.now_utc();
    let cutoff = now - Duration::days(i64::from(DORMANT_AFTER_DAYS));
    let idle_exact = make(
        &mut v,
        "Idle ninety",
        Some("pw-idle-90"),
        AccountStatus::Active,
    );
    let idle_past = make(
        &mut v,
        "Idle past",
        Some("pw-idle-past"),
        AccountStatus::Active,
    );
    let idle_89 = make(
        &mut v,
        "Idle eighty nine",
        Some("pw-idle-89"),
        AccountStatus::Active,
    );
    for account in [&idle_exact, &idle_past, &idle_89] {
        strength(&v, &account.id, 3);
        protect(&mut v, c, &account.id);
    }
    activity(&v, &idle_exact.id, &stamp(cutoff));
    activity(&v, &idle_past.id, &stamp(cutoff - Duration::seconds(1)));
    activity(&v, &idle_89.id, &stamp(now - Duration::days(89)));

    let marked = make(
        &mut v,
        "Marked dormant",
        Some("pw-marked"),
        AccountStatus::Dormant,
    );
    strength(&v, &marked.id, 3);
    protect(&mut v, c, &marked.id);

    let archived_weak = make(
        &mut v,
        "Archived weak",
        Some("pw-archived-weak"),
        AccountStatus::Active,
    );
    strength(&v, &archived_weak.id, 0);
    accounts::set_archived(&mut v, c, &archived_weak.id, true).unwrap();

    let now = clock.now_utc();
    let issues = health::issues(&v, None, None, now).unwrap();
    let summary = health::summary(&v, None, now).unwrap();

    let expect = [
        (
            "Score one",
            HealthRule::Weak,
            true,
            HealthSeverity::High,
            HealthFix::EditAccount,
        ),
        (
            "Score two",
            HealthRule::Weak,
            false,
            HealthSeverity::High,
            HealthFix::EditAccount,
        ),
        (
            "No password",
            HealthRule::Weak,
            false,
            HealthSeverity::High,
            HealthFix::EditAccount,
        ),
        (
            "Shared A",
            HealthRule::Reused,
            true,
            HealthSeverity::High,
            HealthFix::EditAccount,
        ),
        (
            "Shared B",
            HealthRule::Reused,
            true,
            HealthSeverity::High,
            HealthFix::EditAccount,
        ),
        (
            "Only copy",
            HealthRule::Reused,
            false,
            HealthSeverity::High,
            HealthFix::EditAccount,
        ),
        (
            "Archived twin",
            HealthRule::Reused,
            false,
            HealthSeverity::High,
            HealthFix::EditAccount,
        ),
        (
            "No MFA",
            HealthRule::MissingMfa,
            true,
            HealthSeverity::Medium,
            HealthFix::MfaSection,
        ),
        (
            "MFA off",
            HealthRule::MissingMfa,
            true,
            HealthSeverity::Medium,
            HealthFix::MfaSection,
        ),
        (
            "Codes none",
            HealthRule::MissingRecoveryCodes,
            true,
            HealthSeverity::Low,
            HealthFix::MfaSection,
        ),
        (
            "Codes one",
            HealthRule::MissingRecoveryCodes,
            false,
            HealthSeverity::Low,
            HealthFix::MfaSection,
        ),
        (
            "Idle ninety",
            HealthRule::Dormant,
            false,
            HealthSeverity::Info,
            HealthFix::Account,
        ),
        (
            "Idle past",
            HealthRule::Dormant,
            true,
            HealthSeverity::Info,
            HealthFix::Account,
        ),
        (
            "Idle eighty nine",
            HealthRule::Dormant,
            false,
            HealthSeverity::Info,
            HealthFix::Account,
        ),
        (
            "Marked dormant",
            HealthRule::Dormant,
            true,
            HealthSeverity::Info,
            HealthFix::Account,
        ),
        (
            "Archived weak",
            HealthRule::Weak,
            false,
            HealthSeverity::High,
            HealthFix::EditAccount,
        ),
    ];
    for (title, rule, present, severity, fix) in expect {
        match find(&issues, title, rule) {
            Some(issue) => {
                assert!(present, "{title} should not be {rule:?}");
                assert_eq!(issue.severity, severity, "{title}");
                assert_eq!(issue.fix, fix, "{title}");
                assert!(!issue.reason.is_empty(), "{title}");
            }
            None => assert!(!present, "{title} should be {rule:?}"),
        }
    }

    let shared = find(&issues, "Shared A", HealthRule::Reused).unwrap();
    assert_eq!(shared.reason, "Same password as 1 other account.");
    assert_eq!(
        find(&issues, "Idle past", HealthRule::Dormant)
            .unwrap()
            .reason,
        format!("No activity for {DORMANT_AFTER_DAYS} days or more.")
    );
    assert_eq!(
        find(&issues, "Marked dormant", HealthRule::Dormant)
            .unwrap()
            .reason,
        "Marked dormant."
    );
    assert!(issues
        .iter()
        .all(|i| i.title != "Archived weak" && i.title != "Archived twin"));
    assert_eq!(
        issues.first().map(|i| i.severity),
        Some(HealthSeverity::High)
    );

    assert_eq!(
        summary.weak, 1,
        "only score 1; score 2 and a missing password are not weak"
    );
    assert_eq!(summary.reused, 2);
    assert_eq!(summary.missing_mfa, 2);
    assert_eq!(summary.missing_recovery_codes, 1);
    assert_eq!(summary.dormant, 2);

    let weak_only = health::issues(&v, None, Some(HealthRule::Weak), now).unwrap();
    assert!(weak_only.iter().all(|i| i.rule == HealthRule::Weak));
    assert_eq!(weak_only.len(), 1);

    // Mark verified is activity, so the idle account stops being dormant.
    accounts::mark_verified(&mut v, c, &idle_past.id).unwrap();
    let after = health::issues(&v, None, Some(HealthRule::Dormant), clock.now_utc()).unwrap();
    assert!(find(&after, "Idle past", HealthRule::Dormant).is_none());
    assert!(find(&after, "Marked dormant", HealthRule::Dormant).is_some());

    let json = serde_json::to_string(&issues).unwrap();
    assert!(!json.contains("pw-shared"));
    assert!(!json.contains("password_fp") && !json.contains("passwordFp"));
    let fps: Vec<Vec<u8>> = {
        let mut stmt = v
            .conn()
            .prepare("SELECT password_fp FROM account WHERE password_fp IS NOT NULL")
            .unwrap();
        stmt.query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    };
    assert!(!fps.is_empty());
    for fp in fps {
        assert!(!json.contains(&B64.encode(fp)));
    }

    assert_eq!(
        health::summary(&v, Some("no-such-identity"), now).unwrap_err(),
        AppError::NotFound
    );
}

#[test]
fn reuse_is_vault_wide_while_the_list_follows_the_identity() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let c = &clock;
    let mut v = new_vault(tmp.path(), c);
    let mut ident = |name: &str| {
        identities::create(
            &mut v,
            c,
            &IdentityInput {
                name: name.into(),
                description: None,
                primary_email: None,
                recovery_email: None,
                phone_ref: None,
                notes: None,
                color: None,
                tags: Vec::new(),
            },
        )
        .unwrap()
        .id
    };
    let a = ident("Competitive");
    let b = ident("Creator");
    let make = |v: &mut OpenVault, title: &str, identity: &str, password: &str| {
        let mut form = input(title);
        form.identity_id = Some(identity.into());
        form.password = set(password);
        let account = accounts::create(v, c, &form).unwrap();
        protect(v, c, &account.id);
        account
    };
    make(&mut v, "Inside", &a, "pw-shared-across");
    make(&mut v, "Outside", &b, "pw-shared-across");
    make(&mut v, "Unique", &a, "pw-only-inside");

    let now = clock.now_utc();
    let one = health::summary(&v, Some(&a), now).unwrap();
    assert_eq!(
        one.reused, 1,
        "only the account in this identity is counted"
    );
    assert_eq!(health::summary(&v, None, now).unwrap().reused, 2);

    let listed = health::issues(&v, Some(&a), Some(HealthRule::Reused), now).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].title, "Inside");
    assert_eq!(listed[0].reason, "Same password as 1 other account.");
}

#[test]
fn demo_vault_shows_each_rule_and_skips_archived() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);
    vaultair_core::demo::seed(&mut v, &clock).unwrap();

    let now = clock.now_utc();
    let issues = health::issues(&v, None, None, now).unwrap();
    let rules: HashSet<_> = issues.iter().map(|i| i.rule).collect();
    for rule in [
        HealthRule::Weak,
        HealthRule::Reused,
        HealthRule::MissingMfa,
        HealthRule::MissingRecoveryCodes,
        HealthRule::Dormant,
    ] {
        assert!(rules.contains(&rule), "demo vault has no {rule:?}");
    }
    assert!(issues.iter().all(|i| i.title != "Beta test account"));

    let reused: Vec<_> = issues
        .iter()
        .filter(|i| i.rule == HealthRule::Reused)
        .collect();
    assert!(reused.len() >= 2);
    assert!(reused.iter().all(|i| i.reason.contains("other account")));

    let comp: String = v
        .conn()
        .query_row(
            "SELECT id FROM identity WHERE name = 'Competitive'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let inside = health::issues(&v, Some(&comp), Some(HealthRule::Reused), now).unwrap();
    assert!(inside.iter().any(|i| i.reason.contains("other account")));
    assert!(inside.iter().all(|i| i.title != "Old launcher"));
}
