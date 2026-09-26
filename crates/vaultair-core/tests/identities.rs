#![allow(clippy::unwrap_used)] // test helpers
//! Identities and contact points end to end against real (temp-dir) vaults
//! (implementation plan, Phase 8): email normalization, shared emails,
//! recovery dependencies, `ON DELETE SET NULL`, reassigning on delete, bulk
//! assignment, and the identity filter on the dashboard summary.

use std::path::Path;

use secrecy::SecretString;
use vaultair_core::clock::{Clock, ManualClock};
use vaultair_core::crypto::kdf::KdfParams;
use vaultair_core::domain::account::{AccountInput, AccountStatus, AccountType, SecretUpdate};
use vaultair_core::domain::identity::{
    ContactKind, ContactRole, IdentityColor, IdentityDeletePlan, IdentityInput, MailboxSecurity,
};
use vaultair_core::domain::mfa::{MfaInput, MfaMethod};
use vaultair_core::service::{accounts, dashboard, identities, mfa};
use vaultair_core::vault::{create_vault, CreateOptions, OpenVault};
use vaultair_core::AppError;

const PASSWORD: &str = "orbit lantern cactus mosaic";
const SECRET: &str = "CANARY7F3A";

fn new_vault(parent: &Path, clock: &dyn Clock) -> OpenVault {
    create_vault(
        &CreateOptions {
            parent_dir: parent.to_path_buf(),
            name: "Identities".into(),
            kdf: KdfParams::MINIMUM,
            demo: false,
        },
        &SecretString::from(PASSWORD),
        clock,
    )
    .unwrap()
}

fn identity(name: &str) -> IdentityInput {
    IdentityInput {
        name: name.into(),
        description: None,
        primary_email: None,
        recovery_email: None,
        phone_ref: None,
        notes: None,
        color: None,
        tags: Vec::new(),
    }
}

fn account(title: &str, identity_id: Option<&str>, email: Option<&str>) -> AccountInput {
    AccountInput {
        title: title.into(),
        account_type: AccountType::Launcher,
        purpose_id: "builtin-main".into(),
        status: AccountStatus::Active,
        identity_id: identity_id.map(Into::into),
        username: None,
        email: email.map(Into::into),
        password: SecretUpdate::Set {
            value: SECRET.into(),
        },
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

fn field_of<T>(r: Result<T, AppError>) -> Option<&'static str> {
    r.err().and_then(|e| e.field())
}

fn scalar(v: &OpenVault, sql: &str) -> i64 {
    v.conn().query_row(sql, [], |r| r.get(0)).unwrap()
}

fn turn_on_mfa(v: &mut OpenVault, clock: &dyn Clock, account_id: &str) {
    mfa::upsert(
        v,
        clock,
        account_id,
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
}

#[test]
fn emails_are_normalized_into_one_contact_point() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);

    let a = accounts::create(&mut v, &clock, &account("A", None, Some("Me@Example.COM"))).unwrap();
    let mut b_input = account("B", None, Some("me@example.com"));
    b_input.recovery_email = Some("  ME@example.com ".into());
    let b = accounts::create(&mut v, &clock, &b_input).unwrap();

    let contacts = identities::contacts(&v).unwrap();
    assert_eq!(contacts.len(), 1, "one contact point for every spelling");
    assert_eq!(contacts[0].kind, ContactKind::Email);
    assert_eq!(contacts[0].value, "me@example.com");
    assert_eq!(contacts[0].account_count, 2);
    assert_eq!(b.recovery_email.as_deref(), Some("me@example.com"));
    // The account keeps the email as typed; only the contact point folds it.
    assert_eq!(a.email.as_deref(), Some("Me@Example.COM"));

    // The UNIQUE constraint backs the normalization up.
    let dup = v.conn().execute(
        "INSERT INTO contact_point (id, kind, value_normalized, created_at, updated_at)
         VALUES ('x', 'email', 'me@example.com', 'now', 'now')",
        [],
    );
    assert!(dup.is_err());

    // Changing and clearing emails moves the links and prunes what's unused.
    accounts::update(
        &mut v,
        &clock,
        &a.id,
        &account("A", None, Some("other@example.com")),
    )
    .unwrap();
    accounts::update(&mut v, &clock, &b.id, &account("B", None, None)).unwrap();
    let values: Vec<String> = identities::contacts(&v)
        .unwrap()
        .into_iter()
        .map(|c| c.value)
        .collect();
    assert_eq!(values, ["other@example.com"]);

    accounts::delete(&mut v, &a.id, "A").unwrap();
    assert!(identities::contacts(&v).unwrap().is_empty());
}

#[test]
fn identity_crud_validation_and_archive() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);

    assert_eq!(
        field_of(identities::create(&mut v, &clock, &identity("  "))),
        Some("name")
    );
    let mut bad = identity("Main");
    bad.primary_email = Some("not-an-email".into());
    assert_eq!(
        field_of(identities::create(&mut v, &clock, &bad)),
        Some("primaryEmail")
    );
    let mut bad = identity("Main");
    bad.recovery_email = Some("a@b".into());
    assert_eq!(
        field_of(identities::create(&mut v, &clock, &bad)),
        Some("recoveryEmail")
    );

    let mut input = identity("Competitive");
    input.description = Some("Ranked accounts".into());
    input.primary_email = Some("Ranked@Example.com".into());
    input.phone_ref = Some("Pixel, ends 42".into());
    input.color = Some(IdentityColor::Rose);
    input.tags = vec!["esports".into()];
    let created = identities::create(&mut v, &clock, &input).unwrap();
    assert_eq!(created.name, "Competitive");
    assert_eq!(created.primary_email.as_deref(), Some("Ranked@Example.com"));
    assert_eq!(created.tags, ["esports"]);

    // Names are unique, case-insensitively, but an identity keeps its own.
    assert_eq!(
        field_of(identities::create(&mut v, &clock, &identity("competitive"))),
        Some("name")
    );
    input.description = Some("Ranked and practice".into());
    let updated = identities::update(&mut v, &clock, &created.id, &input).unwrap();
    assert_eq!(updated.description.as_deref(), Some("Ranked and practice"));

    // Its email and phone are contact points it declares.
    let contacts = identities::contacts(&v).unwrap();
    assert_eq!(contacts.len(), 2);
    assert!(contacts
        .iter()
        .all(|c| c.identity_id.as_deref() == Some(created.id.as_str())));
    assert!(contacts
        .iter()
        .any(|c| c.kind == ContactKind::Phone && c.value == "Pixel, ends 42"));

    // Archived identities leave the list and pickers but keep their accounts.
    let acct =
        accounts::create(&mut v, &clock, &account("Arena", Some(&created.id), None)).unwrap();
    identities::set_archived(&mut v, &clock, &created.id, true).unwrap();
    assert!(identities::list(&v, false).unwrap().is_empty());
    assert_eq!(identities::list(&v, true).unwrap().len(), 1);
    assert!(identities::refs(&v).unwrap().is_empty());
    assert_eq!(
        accounts::get(&v, &acct.id).unwrap().identity_id.as_deref(),
        Some(created.id.as_str())
    );
    identities::set_archived(&mut v, &clock, &created.id, false).unwrap();
    assert_eq!(identities::list(&v, false).unwrap()[0].account_count, 1);

    // An account can't point at an identity that doesn't exist.
    assert_eq!(
        field_of(accounts::create(
            &mut v,
            &clock,
            &account("X", Some("nope"), None)
        )),
        Some("identityId")
    );
    assert_eq!(identities::get(&v, "nope").unwrap_err(), AppError::NotFound);
}

#[test]
fn overview_groups_accounts_and_finds_shared_emails() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);
    let id = identities::create(&mut v, &clock, &identity("Creator"))
        .unwrap()
        .id;
    let other = identities::create(&mut v, &clock, &identity("Main"))
        .unwrap()
        .id;

    let mut chat = account("Chat", Some(&id), Some("creator@example.com"));
    chat.publisher = Some("Chat Co".into());
    accounts::create(&mut v, &clock, &chat).unwrap();
    let mut stream = account("Stream", Some(&id), Some("CREATOR@example.com"));
    stream.publisher = Some("chat co".into());
    accounts::create(&mut v, &clock, &stream).unwrap();
    accounts::create(
        &mut v,
        &clock,
        &account("Store", Some(&id), Some("solo@example.com")),
    )
    .unwrap();
    // Another identity using the same email makes it shared across the vault.
    accounts::create(
        &mut v,
        &clock,
        &account("Main store", Some(&other), Some("creator@example.com")),
    )
    .unwrap();
    // Archived accounts are left out.
    let old = accounts::create(
        &mut v,
        &clock,
        &account("Old", Some(&id), Some("old@example.com")),
    )
    .unwrap();
    accounts::set_archived(&mut v, &clock, &old.id, true).unwrap();

    let o = identities::overview(&v, &id).unwrap();
    assert_eq!(o.account_count, 3);
    assert_eq!(o.platforms, ["Chat Co"]);
    assert_eq!(o.groups.len(), 2);
    assert_eq!(o.groups[0].platform.as_deref(), Some("Chat Co"));
    assert_eq!(
        o.groups[0].accounts.len(),
        2,
        "publisher groups case-insensitively"
    );
    assert_eq!(o.groups[1].platform, None);

    let emails: Vec<(&str, u32, usize)> = o
        .shared_emails
        .iter()
        .map(|e| {
            (
                e.contact.value.as_str(),
                e.contact.account_count,
                e.accounts.len(),
            )
        })
        .collect();
    assert_eq!(
        emails,
        [("creator@example.com", 3, 2), ("solo@example.com", 1, 1)],
        "most-used first; counts are vault-wide, accounts are this identity's"
    );
    assert!(o.recovery_methods.is_empty());
}

#[test]
fn recovery_dependencies_flag_mailboxes_without_mfa() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);
    let id = identities::create(&mut v, &clock, &identity("Main"))
        .unwrap()
        .id;

    // The mailboxes: one protected, one not.
    let mut safe_box = account("Safe mail", None, Some("safe@example.com"));
    safe_box.account_type = AccountType::Email;
    let safe_box = accounts::create(&mut v, &clock, &safe_box).unwrap();
    turn_on_mfa(&mut v, &clock, &safe_box.id);
    let mut weak_box = account("Weak mail", Some(&id), Some("weak@example.com"));
    weak_box.account_type = AccountType::Email;
    let weak_box = accounts::create(&mut v, &clock, &weak_box).unwrap();

    let mut a = account("Game A", Some(&id), Some("safe@example.com"));
    a.recovery_email = Some("weak@example.com".into());
    accounts::create(&mut v, &clock, &a).unwrap();
    let mut b = account("Game B", Some(&id), Some("unknown@example.com"));
    b.recovery_phone = Some("Pixel, ends 42".into());
    accounts::create(&mut v, &clock, &b).unwrap();

    let o = identities::overview(&v, &id).unwrap();
    #[allow(clippy::type_complexity)]
    let deps: Vec<(&str, MailboxSecurity, Vec<(&str, ContactRole)>)> = o
        .dependencies
        .iter()
        .map(|d| {
            (
                d.contact.value.as_str(),
                d.mailbox,
                d.dependents
                    .iter()
                    .map(|x| (x.account.title.as_str(), x.role))
                    .collect(),
            )
        })
        .collect();
    assert_eq!(
        deps,
        [
            // Riskiest first. The weak mailbox doesn't depend on itself.
            (
                "weak@example.com",
                MailboxSecurity::NoMfa,
                vec![("Game A", ContactRole::RecoveryEmail)]
            ),
            (
                "unknown@example.com",
                MailboxSecurity::NotInVault,
                vec![("Game B", ContactRole::LoginEmail)]
            ),
            (
                "Pixel, ends 42",
                MailboxSecurity::NotApplicable,
                vec![("Game B", ContactRole::RecoveryPhone)]
            ),
            (
                "safe@example.com",
                MailboxSecurity::MfaOn,
                vec![("Game A", ContactRole::LoginEmail)]
            ),
        ]
    );
    assert_eq!(o.dependencies[0].mailbox_accounts[0].title, "Weak mail");
    let recovery: Vec<&str> = o
        .recovery_methods
        .iter()
        .map(|c| c.value.as_str())
        .collect();
    assert_eq!(recovery, ["weak@example.com", "Pixel, ends 42"]);

    // Turning MFA on for the weak mailbox clears the flag.
    turn_on_mfa(&mut v, &clock, &weak_box.id);
    let o = identities::overview(&v, &id).unwrap();
    assert!(o
        .dependencies
        .iter()
        .all(|d| d.mailbox != MailboxSecurity::NoMfa));
}

#[test]
fn deleting_an_identity_unassigns_or_reassigns_its_accounts() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);
    let mut input = identity("Alt");
    input.primary_email = Some("alt@example.com".into());
    let alt = identities::create(&mut v, &clock, &input).unwrap().id;
    let main = identities::create(&mut v, &clock, &identity("Main"))
        .unwrap()
        .id;
    let a = accounts::create(
        &mut v,
        &clock,
        &account("A", Some(&alt), Some("alt@example.com")),
    )
    .unwrap();
    let b = accounts::create(&mut v, &clock, &account("B", Some(&alt), None)).unwrap();

    // The typed name is checked, and the target must be another active identity.
    assert_eq!(
        field_of(identities::delete(
            &mut v,
            &alt,
            "alt",
            &IdentityDeletePlan::Unassign
        )),
        Some("confirmName")
    );
    let to_self = IdentityDeletePlan::Reassign {
        identity_id: alt.clone(),
    };
    assert_eq!(
        field_of(identities::delete(&mut v, &alt, "Alt", &to_self)),
        Some("identityId")
    );

    // Reassign: the accounts move, and their search rows follow.
    let to_main = IdentityDeletePlan::Reassign {
        identity_id: main.clone(),
    };
    identities::delete(&mut v, &alt, "Alt", &to_main).unwrap();
    for id in [&a.id, &b.id] {
        assert_eq!(
            accounts::get(&v, id).unwrap().identity_id.as_deref(),
            Some(main.as_str())
        );
    }
    assert_eq!(
        scalar(
            &v,
            "SELECT COUNT(*) FROM search_index WHERE entity_type = 'account' AND identity = 'Main'"
        ),
        2
    );
    // The email it declared is released but kept: account A still uses it.
    let contacts = identities::contacts(&v).unwrap();
    assert_eq!(contacts.len(), 1);
    assert_eq!(contacts[0].identity_id, None);
    assert_eq!(identities::get(&v, &alt).unwrap_err(), AppError::NotFound);

    // Unassign: ON DELETE SET NULL clears the accounts' identity.
    identities::delete(&mut v, &main, " Main ", &IdentityDeletePlan::Unassign).unwrap();
    assert_eq!(accounts::get(&v, &a.id).unwrap().identity_id, None);
    assert_eq!(accounts::get(&v, &b.id).unwrap().identity_name, None);
    assert_eq!(scalar(&v, "SELECT COUNT(*) FROM identity"), 0);
    assert_eq!(
        scalar(
            &v,
            "SELECT COUNT(*) FROM search_index WHERE entity_type = 'identity'"
        ),
        0
    );
    assert_eq!(
        scalar(&v, "SELECT COUNT(*) FROM search_index WHERE identity <> ''"),
        0
    );
}

#[test]
fn contact_points_lose_their_identity_on_delete_via_the_schema() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);
    let mut input = identity("Main");
    input.primary_email = Some("main@example.com".into());
    let id = identities::create(&mut v, &clock, &input).unwrap().id;
    accounts::create(
        &mut v,
        &clock,
        &account("A", Some(&id), Some("main@example.com")),
    )
    .unwrap();

    // A raw delete (no service) exercises the foreign keys themselves.
    v.conn()
        .execute("DELETE FROM identity WHERE id = ?1", [&id])
        .unwrap();
    assert_eq!(
        scalar(
            &v,
            "SELECT COUNT(*) FROM account WHERE identity_id IS NOT NULL"
        ),
        0
    );
    assert_eq!(
        scalar(
            &v,
            "SELECT COUNT(*) FROM contact_point WHERE identity_id IS NOT NULL"
        ),
        0
    );
    assert_eq!(scalar(&v, "SELECT COUNT(*) FROM contact_point"), 1);
}

#[test]
fn bulk_assignment_and_rename_reindex_accounts() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);
    let id = identities::create(&mut v, &clock, &identity("Competitive"))
        .unwrap()
        .id;
    let a = accounts::create(&mut v, &clock, &account("A", None, None)).unwrap();
    let b = accounts::create(&mut v, &clock, &account("B", None, None)).unwrap();
    clock.advance(std::time::Duration::from_secs(60));

    let ids = vec![a.id.clone(), b.id.clone(), a.id.clone()];
    assert_eq!(
        identities::assign_accounts(&mut v, Some(&id), &ids).unwrap(),
        2
    );
    assert_eq!(
        identities::assign_accounts(&mut v, Some(&id), &ids).unwrap(),
        0
    );
    assert_eq!(identities::list(&v, false).unwrap()[0].account_count, 2);
    assert_eq!(
        accounts::get(&v, &a.id).unwrap().updated_at,
        a.updated_at,
        "assigning isn't an edit"
    );
    assert_eq!(
        field_of(identities::assign_accounts(
            &mut v,
            Some(&id),
            &["nope".into()]
        )),
        Some("accountIds")
    );
    assert_eq!(
        field_of(identities::assign_accounts(&mut v, Some("nope"), &ids)),
        Some("identityId")
    );
    assert_eq!(
        field_of(identities::assign_accounts(&mut v, Some(&id), &[])),
        Some("accountIds")
    );

    // Renaming reindexes the accounts' search rows.
    identities::update(&mut v, &clock, &id, &identity("Ranked")).unwrap();
    assert_eq!(
        scalar(
            &v,
            "SELECT COUNT(*) FROM search_index WHERE entity_type = 'account' AND identity = 'Ranked'"
        ),
        2
    );
    assert_eq!(
        scalar(
            &v,
            "SELECT COUNT(*) FROM search_index WHERE entity_type = 'identity' AND title = 'Ranked'"
        ),
        1
    );

    assert_eq!(
        identities::assign_accounts(&mut v, None, std::slice::from_ref(&b.id)).unwrap(),
        1
    );
    assert_eq!(accounts::get(&v, &b.id).unwrap().identity_id, None);
    assert_eq!(
        scalar(
            &v,
            "SELECT COUNT(*) FROM search_index WHERE entity_type = 'account' AND identity = 'Ranked'"
        ),
        1
    );
}

#[test]
fn dashboard_summary_filters_by_identity() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);
    let comp = identities::create(&mut v, &clock, &identity("Competitive"))
        .unwrap()
        .id;
    identities::create(&mut v, &clock, &identity("Creator")).unwrap();

    let main = accounts::create(&mut v, &clock, &account("Main", Some(&comp), None)).unwrap();
    turn_on_mfa(&mut v, &clock, &main.id);
    accounts::set_favorite(&mut v, &clock, &main.id, true).unwrap();
    let mut alt = account("Alt", Some(&comp), None);
    alt.purpose_id = "builtin-alt".into();
    accounts::create(&mut v, &clock, &alt).unwrap();
    accounts::create(&mut v, &clock, &account("Loose", None, None)).unwrap();
    let gone = accounts::create(&mut v, &clock, &account("Gone", Some(&comp), None)).unwrap();
    accounts::set_archived(&mut v, &clock, &gone.id, true).unwrap();

    let all = dashboard::summary(&v, None).unwrap();
    assert_eq!(
        (all.total_accounts, all.main_accounts, all.alt_accounts),
        (3, 2, 1)
    );
    assert_eq!((all.identities, all.missing_mfa, all.favorites), (2, 2, 1));
    assert_eq!(all.recent.len(), 3);

    let one = dashboard::summary(&v, Some(&comp)).unwrap();
    assert_eq!(one.identity_id.as_deref(), Some(comp.as_str()));
    assert_eq!(
        (one.total_accounts, one.main_accounts, one.alt_accounts),
        (2, 1, 1)
    );
    assert_eq!((one.identities, one.missing_mfa, one.favorites), (1, 1, 1));
    assert!(one
        .recent
        .iter()
        .all(|a| a.identity_id.as_deref() == Some(comp.as_str())));

    assert_eq!(
        dashboard::summary(&v, Some("nope")).unwrap_err(),
        AppError::NotFound
    );
}

#[test]
fn identity_dtos_carry_no_secrets() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);
    vaultair_core::demo::seed(&mut v, &clock).unwrap();
    let id = identities::create(&mut v, &clock, &identity("Canary"))
        .unwrap()
        .id;
    accounts::create(
        &mut v,
        &clock,
        &account("Canary account", Some(&id), Some("c@example.com")),
    )
    .unwrap();

    let mut json = String::new();
    for i in identities::list(&v, false).unwrap() {
        json.push_str(&serde_json::to_string(&identities::overview(&v, &i.id).unwrap()).unwrap());
    }
    json.push_str(&serde_json::to_string(&identities::list(&v, false).unwrap()).unwrap());
    json.push_str(&serde_json::to_string(&identities::contacts(&v).unwrap()).unwrap());
    json.push_str(&serde_json::to_string(&dashboard::summary(&v, Some(&id)).unwrap()).unwrap());
    json.push_str(&serde_json::to_string(&dashboard::summary(&v, None).unwrap()).unwrap());
    assert!(!json.contains(SECRET));
}

#[test]
fn demo_seed_has_identities_with_recovery_routes() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);
    vaultair_core::demo::seed(&mut v, &clock).unwrap();

    let list = identities::list(&v, false).unwrap();
    let names: Vec<&str> = list.iter().map(|i| i.name.as_str()).collect();
    assert_eq!(names, ["Competitive", "Creator", "Main"]);
    let creator = list.iter().find(|i| i.name == "Creator").unwrap();
    let o = identities::overview(&v, &creator.id).unwrap();
    assert!(o
        .dependencies
        .iter()
        .any(|d| d.mailbox == MailboxSecurity::NoMfa && d.contact.value == "creator@example.com"));
    for c in identities::contacts(&v).unwrap() {
        assert!(
            c.kind == ContactKind::Phone
                || c.value.ends_with("example.com")
                || c.value.ends_with(".invalid"),
            "{} is not a reserved example domain",
            c.value
        );
    }
}
