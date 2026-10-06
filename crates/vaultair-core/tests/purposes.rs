#![allow(clippy::unwrap_used)] // test helpers
//! Phase 9: purpose labels. Built-ins hide but don't delete, custom labels
//! are added, renamed, recoloured, reordered and deleted (moving their
//! accounts), and the search index follows every rename and move.

use std::path::Path;

use secrecy::SecretString;
use vaultair_core::clock::{Clock, SystemClock};
use vaultair_core::crypto::kdf::KdfParams;
use vaultair_core::domain::account::{
    AccountInput, AccountStatus, AccountType, PurposeColor, PurposeInput, PurposeView, SecretUpdate,
};
use vaultair_core::domain::search::{SavedViewInput, SearchHit};
use vaultair_core::search::{AccountFilter, ViewSpec};
use vaultair_core::service::{accounts, purposes, search};
use vaultair_core::vault::{create_vault, CreateOptions, OpenVault};
use vaultair_core::AppError;

const MAIN: &str = "builtin-main";
const ALT: &str = "builtin-alt";

fn new_vault(parent: &Path, clock: &dyn Clock) -> OpenVault {
    create_vault(
        &CreateOptions {
            parent_dir: parent.to_path_buf(),
            name: "Purposes".into(),
            kdf: KdfParams::MINIMUM,
            demo: false,
        },
        &SecretString::from("orbit lantern cactus mosaic"),
        clock,
    )
    .unwrap()
}

fn account(title: &str, purpose: &str) -> AccountInput {
    AccountInput {
        title: title.into(),
        account_type: AccountType::Game,
        purpose_id: purpose.into(),
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

fn label(name: &str) -> PurposeInput {
    PurposeInput {
        name: name.into(),
        color: None,
    }
}

fn field_of<T>(r: Result<T, AppError>) -> Option<&'static str> {
    r.err().and_then(|e| e.field())
}

fn find(v: &OpenVault, id: &str) -> PurposeView {
    purposes::list(v)
        .unwrap()
        .into_iter()
        .find(|p| p.id == id)
        .unwrap()
}

fn search_purpose(v: &OpenVault, account_id: &str) -> Option<String> {
    v.conn()
        .query_row(
            "SELECT purpose FROM search_index WHERE entity_id = ?1",
            [account_id],
            |r| r.get(0),
        )
        .ok()
}

fn hit_titles(v: &OpenVault, q: &str) -> Vec<String> {
    search::search(v, q, 20)
        .unwrap()
        .into_iter()
        .filter_map(|h| match h {
            SearchHit::Account { account } => Some(account.title),
            _ => None,
        })
        .collect()
}

#[test]
fn a_new_vault_lists_the_built_ins_in_order_without_smurf() {
    let dir = tempfile::tempdir().unwrap();
    let v = new_vault(dir.path(), &SystemClock);
    let all = purposes::list(&v).unwrap();
    let slugs: Vec<_> = all.iter().map(|p| p.slug.as_str()).collect();
    assert_eq!(
        slugs,
        [
            "main",
            "competitive",
            "ranked",
            "casual",
            "alt",
            "creator",
            "testing",
            "work",
            "recovery",
            "other"
        ]
    );
    assert!(all.iter().all(|p| p.is_builtin && !p.is_hidden));
    assert!(!slugs.contains(&"smurf") && !slugs.contains(&"shared-household"));
}

#[test]
fn a_custom_purpose_works_on_accounts_filters_and_search() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let t = purposes::create(
        &mut v,
        c,
        &PurposeInput {
            name: "  Tournament ".into(),
            color: Some(PurposeColor::Amber),
        },
    )
    .unwrap();
    assert_eq!(
        (t.name.as_str(), t.slug.as_str(), t.color),
        ("Tournament", "tournament", Some(PurposeColor::Amber))
    );
    assert!(!t.is_builtin && !t.is_hidden);
    assert_eq!(
        purposes::list(&v).unwrap().last().unwrap().id,
        t.id,
        "added after the others"
    );

    let a = accounts::create(&mut v, c, &account("LAN finals", &t.id)).unwrap();
    accounts::create(&mut v, c, &account("Everyday", MAIN)).unwrap();
    assert_eq!(a.purpose_name, "Tournament");
    assert_eq!(find(&v, &t.id).account_count, 1);
    let by_purpose = AccountFilter {
        purpose_ids: vec![t.id.clone()],
        ..Default::default()
    };
    let titles: Vec<_> = accounts::list(&v, c, by_purpose, Default::default())
        .unwrap()
        .into_iter()
        .map(|a| a.title)
        .collect();
    assert_eq!(titles, ["LAN finals"]);
    assert_eq!(hit_titles(&v, "tourn"), ["LAN finals"]);
}

#[test]
fn slugs_are_unique_and_names_clash_case_insensitively() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let first = purposes::create(&mut v, c, &label("Pro Team")).unwrap();
    let second = purposes::create(&mut v, c, &label("Pro-Team")).unwrap();
    let third = purposes::create(&mut v, c, &label("pro team!")).unwrap();
    assert_eq!(first.slug, "pro-team");
    assert_eq!(second.slug, "pro-team-2");
    assert_eq!(third.slug, "pro-team-3");
    // A custom label never takes a built-in's slug either, hidden or not.
    purposes::set_hidden(&mut v, c, ALT, true).unwrap();
    assert_eq!(
        purposes::create(&mut v, c, &label("Alt.")).unwrap().slug,
        "alt-2"
    );
    let symbols = purposes::create(&mut v, c, &label("日本")).unwrap();
    assert_eq!(symbols.slug, "custom");

    for taken in ["PRO TEAM", "main", " ALT ", "  "] {
        assert_eq!(
            field_of(purposes::create(&mut v, c, &label(taken))),
            Some("name"),
            "{taken:?}"
        );
    }
    assert_eq!(
        field_of(purposes::create(&mut v, c, &label(&"x".repeat(41)))),
        Some("name")
    );
    // Renaming into another label's name clashes too; keeping your own is fine.
    assert_eq!(
        field_of(purposes::update(&mut v, c, &second.id, &label("pro team"))),
        Some("name")
    );
    purposes::update(&mut v, c, &first.id, &label("PRO TEAM")).unwrap();
}

#[test]
fn renaming_reindexes_search_and_keeps_the_slug() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let t = purposes::create(&mut v, c, &label("Tournament")).unwrap();
    let a = accounts::create(&mut v, c, &account("LAN finals", &t.id)).unwrap();
    let b = accounts::create(&mut v, c, &account("Old cup", &t.id)).unwrap();
    accounts::set_archived(&mut v, c, &b.id, true).unwrap();
    assert_eq!(search_purpose(&v, &a.id).as_deref(), Some("Tournament"));
    assert_eq!(hit_titles(&v, "tournament").len(), 2);

    let renamed = purposes::update(
        &mut v,
        c,
        &t.id,
        &PurposeInput {
            name: "Scrims".into(),
            color: Some(PurposeColor::Teal),
        },
    )
    .unwrap();
    assert_eq!(renamed.slug, "tournament", "slugs are stable");
    assert_eq!(renamed.color, Some(PurposeColor::Teal));
    // Archived accounts' rows are rewritten too.
    for id in [&a.id, &b.id] {
        assert_eq!(search_purpose(&v, id).as_deref(), Some("Scrims"));
    }
    assert_eq!(accounts::get(&v, &a.id).unwrap().purpose_name, "Scrims");
    assert!(hit_titles(&v, "tournament").is_empty());
    let mut found = hit_titles(&v, "scrims");
    found.sort();
    assert_eq!(found, ["LAN finals", "Old cup"]);
}

#[test]
fn built_ins_recolour_but_keep_their_name_and_cant_be_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    assert_eq!(
        field_of(purposes::update(&mut v, c, MAIN, &label("Primary"))),
        Some("name")
    );
    let main = purposes::update(
        &mut v,
        c,
        MAIN,
        &PurposeInput {
            name: "Main".into(),
            color: Some(PurposeColor::Blue),
        },
    )
    .unwrap();
    assert_eq!(
        (main.name.as_str(), main.color),
        ("Main", Some(PurposeColor::Blue))
    );

    assert_eq!(
        field_of(purposes::delete(&mut v, c, MAIN, None)),
        Some("isBuiltin")
    );
    assert_eq!(
        field_of(purposes::delete(&mut v, c, ALT, Some(MAIN))),
        Some("isBuiltin")
    );
    assert_eq!(purposes::list(&v).unwrap().len(), 10);
    assert!(matches!(
        purposes::delete(&mut v, c, "nope", None),
        Err(AppError::NotFound)
    ));
}

#[test]
fn delete_with_reassign_moves_accounts_views_and_search_rows() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let t = purposes::create(&mut v, c, &label("Tournament")).unwrap();
    let a = accounts::create(&mut v, c, &account("LAN finals", &t.id)).unwrap();
    let b = accounts::create(&mut v, c, &account("Old cup", &t.id)).unwrap();
    accounts::set_archived(&mut v, c, &b.id, true).unwrap();
    let before = accounts::get(&v, &a.id).unwrap().updated_at;
    let view = search::create_view(
        &mut v,
        c,
        &SavedViewInput {
            name: "Events".into(),
            spec: ViewSpec {
                v: 1,
                filter: AccountFilter {
                    purpose_ids: vec![t.id.clone(), ALT.into()],
                    ..Default::default()
                },
                sort: Default::default(),
            },
        },
    )
    .unwrap();

    // Accounts use it: a target is required, and it must be another visible label.
    assert_eq!(
        field_of(purposes::delete(&mut v, c, &t.id, None)),
        Some("reassignTo")
    );
    assert_eq!(
        field_of(purposes::delete(&mut v, c, &t.id, Some(&t.id))),
        Some("reassignTo")
    );
    assert_eq!(
        field_of(purposes::delete(&mut v, c, &t.id, Some("nope"))),
        Some("reassignTo")
    );
    purposes::set_hidden(&mut v, c, ALT, true).unwrap();
    assert_eq!(
        field_of(purposes::delete(&mut v, c, &t.id, Some(ALT))),
        Some("reassignTo")
    );
    purposes::set_hidden(&mut v, c, ALT, false).unwrap();
    assert_eq!(find(&v, &t.id).account_count, 2, "nothing moved yet");

    purposes::delete(&mut v, c, &t.id, Some(ALT)).unwrap();
    assert!(purposes::list(&v).unwrap().iter().all(|p| p.id != t.id));
    for id in [&a.id, &b.id] {
        let d = accounts::get(&v, id).unwrap();
        assert_eq!(
            (d.purpose_id.as_str(), d.purpose_name.as_str()),
            (ALT, "Alt")
        );
        assert_eq!(search_purpose(&v, id).as_deref(), Some("Alt"));
    }
    assert_eq!(accounts::get(&v, &a.id).unwrap().updated_at, before);
    assert_eq!(find(&v, ALT).account_count, 2);
    let views = search::views(&v).unwrap();
    let events = views.iter().find(|x| x.id == view.id).unwrap();
    assert_eq!(
        events.spec.filter.purpose_ids,
        [ALT],
        "retargeted, no duplicate"
    );
}

#[test]
fn an_unused_custom_label_deletes_without_a_target() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let t = purposes::create(&mut v, c, &label("Spare")).unwrap();
    purposes::delete(&mut v, c, &t.id, None).unwrap();
    assert_eq!(purposes::list(&v).unwrap().len(), 10);
    assert!(matches!(
        purposes::delete(&mut v, c, &t.id, None),
        Err(AppError::NotFound)
    ));
}

#[test]
fn hidden_labels_stay_on_their_accounts_and_can_come_back() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let a = accounts::create(&mut v, c, &account("Second", ALT)).unwrap();
    let hidden = purposes::set_hidden(&mut v, c, ALT, true).unwrap();
    assert!(hidden.is_hidden);
    assert!(find(&v, ALT).is_hidden, "still listed, flagged hidden");

    // The account keeps it, and can still be saved with it.
    let d = accounts::get(&v, &a.id).unwrap();
    assert_eq!(d.purpose_name, "Alt");
    let mut edit = account("Second (edited)", ALT);
    edit.notes = Some("still an alt".into());
    accounts::update(&mut v, c, &a.id, &edit).unwrap();
    let by_purpose = AccountFilter {
        purpose_ids: vec![ALT.into()],
        ..Default::default()
    };
    assert_eq!(
        accounts::list(&v, c, by_purpose, Default::default())
            .unwrap()
            .len(),
        1
    );

    assert!(
        !purposes::set_hidden(&mut v, c, ALT, false)
            .unwrap()
            .is_hidden
    );
    assert!(matches!(
        purposes::set_hidden(&mut v, c, "nope", true),
        Err(AppError::NotFound)
    ));
}

#[test]
fn the_last_visible_label_cant_be_hidden_or_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let t = purposes::create(&mut v, c, &label("Only")).unwrap();
    for p in purposes::list(&v).unwrap() {
        if p.id != t.id {
            purposes::set_hidden(&mut v, c, &p.id, true).unwrap();
        }
    }
    assert_eq!(
        field_of(purposes::set_hidden(&mut v, c, &t.id, true)),
        Some("lastVisible")
    );
    assert_eq!(
        field_of(purposes::delete(&mut v, c, &t.id, None)),
        Some("lastVisible")
    );
    // Hiding an already hidden one again is fine.
    purposes::set_hidden(&mut v, c, MAIN, true).unwrap();
    purposes::set_hidden(&mut v, c, MAIN, false).unwrap();
    purposes::set_hidden(&mut v, c, &t.id, true).unwrap();
    let visible: Vec<_> = purposes::list(&v)
        .unwrap()
        .into_iter()
        .filter(|p| !p.is_hidden)
        .map(|p| p.id)
        .collect();
    assert_eq!(visible, [MAIN]);
}

#[test]
fn reordering_persists_and_needs_every_label_once() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let t = purposes::create(&mut v, c, &label("Tournament")).unwrap();
    let mut ids: Vec<String> = purposes::list(&v)
        .unwrap()
        .into_iter()
        .map(|p| p.id)
        .collect();
    let last = ids.pop().unwrap();
    assert_eq!(last, t.id);
    ids.insert(0, last);
    ids.swap(1, 2);
    let listed: Vec<_> = purposes::reorder(&mut v, &ids)
        .unwrap()
        .into_iter()
        .map(|p| p.id)
        .collect();
    assert_eq!(listed, ids);
    assert_eq!(listed[..3], [t.id.as_str(), "builtin-competitive", MAIN]);

    // Persisted: a fresh read (and a new label) keep the order.
    let next = purposes::create(&mut v, c, &label("Next")).unwrap();
    let again: Vec<_> = purposes::list(&v)
        .unwrap()
        .into_iter()
        .map(|p| p.id)
        .collect();
    assert_eq!(again[..ids.len()], ids[..]);
    assert_eq!(again.last(), Some(&next.id));

    let mut missing = again.clone();
    missing.pop();
    assert_eq!(field_of(purposes::reorder(&mut v, &missing)), Some("ids"));
    let mut doubled = again.clone();
    doubled[0] = doubled[1].clone();
    assert_eq!(field_of(purposes::reorder(&mut v, &doubled)), Some("ids"));
    let mut unknown = again.clone();
    unknown[0] = "nope".into();
    assert_eq!(field_of(purposes::reorder(&mut v, &unknown)), Some("ids"));
    let unchanged: Vec<_> = purposes::list(&v)
        .unwrap()
        .into_iter()
        .map(|p| p.id)
        .collect();
    assert_eq!(unchanged, again);
}
