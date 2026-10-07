#![allow(clippy::unwrap_used)] // test helpers
//! Phase 11: global search, the account list's filters and sort, saved
//! views, bulk actions, and keeping the search index in step with the
//! tables. Includes the secret non-indexing canary.

use std::path::Path;
use std::time::{Duration, Instant};

use secrecy::SecretString;
use vaultair_core::clock::{Clock, ManualClock, SystemClock};
use vaultair_core::crypto::kdf::KdfParams;
use vaultair_core::domain::account::{
    AccountInput, AccountStatus, AccountType, CustomFieldInput, CustomFieldType, SecretUpdate,
};
use vaultair_core::domain::catalog::{GameProfileFilter, GameProfileInput};
use vaultair_core::domain::identity::IdentityInput;
use vaultair_core::domain::mfa::{MfaInput, MfaMethod};
use vaultair_core::domain::search::{SavedViewInput, SearchHit};
use vaultair_core::search::{AccountFilter, AccountSort, SortKey, StatusFilter, ViewSpec};
use vaultair_core::service::{accounts, backup, catalog, graph, identities, mfa, search, settings};
use vaultair_core::vault::location::CloudRoots;
use vaultair_core::vault::{create_vault, CreateOptions, OpenVault};
use vaultair_core::AppError;

const CANARY: &str = "CANARY7F3A";
/// RFC 6238's SHA-1 test key in base32.
const TOTP_KEY: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const STEAM: &str = "builtin-pl-steam";
const RIOT: &str = "builtin-pl-riot";
const VALORANT: &str = "builtin-game-valorant";
const MAIN: &str = "builtin-main";
const ALT: &str = "builtin-alt";
const RECOVERY: &str = "builtin-recovery";
const DAY: Duration = Duration::from_secs(86_400);

fn new_vault(parent: &Path, clock: &dyn Clock) -> OpenVault {
    create_vault(
        &CreateOptions {
            parent_dir: parent.to_path_buf(),
            name: "Search".into(),
            kdf: KdfParams::MINIMUM,
            demo: false,
        },
        &SecretString::from("orbit lantern cactus mosaic"),
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
        purpose_id: MAIN.into(),
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

fn identity(name: &str, email: Option<&str>) -> IdentityInput {
    IdentityInput {
        name: name.into(),
        description: None,
        primary_email: email.map(Into::into),
        recovery_email: None,
        phone_ref: None,
        notes: None,
        color: None,
        tags: Vec::new(),
    }
}

fn profile(gamertag: &str) -> GameProfileInput {
    GameProfileInput {
        game_id: VALORANT.into(),
        platform_id: None,
        gamertag: Some(gamertag.into()),
        player_id: None,
        region: None,
        rank_tier: None,
        current_season: None,
        notes: None,
        linked_launcher_account_id: None,
        linked_console_account_id: None,
    }
}

fn totp() -> MfaInput {
    MfaInput {
        id: None,
        method: MfaMethod::Totp,
        enabled: true,
        totp_secret: set(TOTP_KEY),
        recovery_instructions: SecretUpdate::Unchanged,
        notes: None,
    }
}

fn field_of<T>(r: Result<T, AppError>) -> Option<&'static str> {
    r.err().and_then(|e| e.field())
}

fn titles(v: &OpenVault, clock: &dyn Clock, filter: AccountFilter) -> Vec<String> {
    accounts::list(v, clock, filter, AccountSort::default())
        .unwrap()
        .into_iter()
        .map(|a| a.title)
        .collect()
}

fn text(q: &str) -> AccountFilter {
    AccountFilter {
        text: Some(q.into()),
        ..Default::default()
    }
}

/// What each hit opens, as "kind:title".
fn hits(v: &OpenVault, q: &str) -> Vec<String> {
    search::search(v, q, 20)
        .unwrap()
        .into_iter()
        .map(|h| match h {
            SearchHit::Account { account } => format!("account:{}", account.title),
            SearchHit::Identity { name, .. } => format!("identity:{name}"),
            SearchHit::GameProfile {
                gamertag, account, ..
            } => format!("profile:{}@{}", gamertag.unwrap_or_default(), account.title),
        })
        .collect()
}

/// Every index row, sorted, for comparing incremental updates to a rebuild.
fn index_rows(v: &OpenVault) -> Vec<String> {
    let mut stmt = v
        .conn()
        .prepare(
            "SELECT entity_type || '|' || entity_id || '|' || title || '|' || username || '|'
                    || email || '|' || game || '|' || platform || '|' || publisher || '|'
                    || tags || '|' || identity || '|' || purpose || '|' || notes || '|'
                    || region || '|' || player_id
             FROM search_index",
        )
        .unwrap();
    let mut rows: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    rows.sort();
    rows
}

fn index_ok(v: &OpenVault) -> bool {
    v.integrity_check().unwrap().search_index_ok
}

// ---- The canary -----------------------------------------------------------------

#[test]
fn secrets_are_never_indexed_or_found() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let mut a = input("Canary holder");
    a.username = Some("plainuser".into());
    a.password = set(CANARY);
    a.sensitive_notes = set(&format!("security answer {CANARY}"));
    a.custom_fields = vec![CustomFieldInput {
        id: None,
        label: "PIN".into(),
        field_type: CustomFieldType::Secret,
        value: None,
        secret: set(CANARY),
    }];
    let a = accounts::create(&mut v, c, &a).unwrap();
    let with_mfa = mfa::upsert(&mut v, c, &a.id, &totp()).unwrap();
    let m = &with_mfa.mfa[0].id;
    mfa::set_backup_codes(&mut v, c, m, Some(&format!("{CANARY}\nABCD-1234"))).unwrap();
    let mut recover = totp();
    recover.id = Some(m.clone());
    recover.totp_secret = SecretUpdate::Unchanged;
    recover.recovery_instructions = set(&format!("call support, say {CANARY}"));
    mfa::upsert(&mut v, c, &a.id, &recover).unwrap();

    for q in [
        CANARY,
        &CANARY.to_lowercase(),
        "7F3A",
        "CANARY7",
        TOTP_KEY,
        "GEZDGNBV",
        "ABCD-1234",
        "support",
        "security answer",
    ] {
        assert!(hits(&v, q).is_empty(), "search found a secret for {q:?}");
        assert!(
            titles(&v, c, text(q)).is_empty(),
            "the list filter found a secret for {q:?}"
        );
    }
    assert_eq!(hits(&v, "plainuser"), ["account:Canary holder"], "sanity");

    let mut stmt = v.conn().prepare("SELECT * FROM search_index").unwrap();
    let n = stmt.column_count();
    let cells: Vec<String> = stmt
        .query_map([], |r| {
            Ok((0..n)
                .map(|i| r.get::<_, Option<String>>(i).unwrap().unwrap_or_default())
                .collect::<Vec<_>>()
                .join("|"))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert!(!cells.is_empty());
    for row in &cells {
        for secret in [CANARY, TOTP_KEY, "ABCD-1234", "call support"] {
            assert!(!row.contains(secret), "{secret} in the search index: {row}");
        }
    }
}

/// The responses the account canary (`tests/accounts.rs`) doesn't reach:
/// search hits, saved views, identities and their overview, contact points,
/// the catalog, game profiles, the whole-vault map, the vault's own facts,
/// its settings and its backup status. None of them carries a secret.
#[test]
fn no_lookup_or_listing_response_carries_a_secret() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let me = identities::create(&mut v, c, &identity("Main", Some("me@example.com"))).unwrap();
    let mut a = input("Canary holder");
    a.identity_id = Some(me.id.clone());
    a.username = Some("plainuser".into());
    a.email = Some("me@example.com".into());
    a.recovery_email = Some("backup@example.com".into());
    a.platform_id = Some(STEAM.into());
    a.password = set(&format!("{CANARY}-password"));
    a.sensitive_notes = set(&format!("Password: {CANARY}-notes"));
    a.custom_fields = vec![CustomFieldInput {
        id: None,
        label: "PIN".into(),
        field_type: CustomFieldType::Secret,
        value: None,
        secret: set(&format!("{CANARY}-field")),
    }];
    let a = accounts::create(&mut v, c, &a).unwrap();
    let mut method = totp();
    method.recovery_instructions = set(&format!("{CANARY}-recovery"));
    let with_mfa = mfa::upsert(&mut v, c, &a.id, &method).unwrap();
    let codes = format!("{CANARY}-code-1\n{CANARY}-code-2");
    mfa::set_backup_codes(&mut v, c, &with_mfa.mfa[0].id, Some(&codes)).unwrap();
    catalog::create_profile(&mut v, c, &a.id, &profile("plainuser#1")).unwrap();
    let view = SavedViewInput {
        name: "Canary view".into(),
        spec: ViewSpec {
            v: 1,
            filter: text("plainuser"),
            sort: AccountSort::default(),
        },
    };
    search::create_view(&mut v, c, &view).unwrap();

    let found = search::search(&v, "plainuser", 20).unwrap();
    assert!(found.len() >= 2, "sanity: the account and its profile");
    let now = c.now_utc();
    let responses = [
        serde_json::to_string(&found),
        serde_json::to_string(&search::views(&v).unwrap()),
        serde_json::to_string(&identities::list(&v, false).unwrap()),
        serde_json::to_string(&identities::refs(&v).unwrap()),
        serde_json::to_string(&identities::get(&v, &me.id).unwrap()),
        serde_json::to_string(&identities::overview(&v, &me.id).unwrap()),
        serde_json::to_string(&identities::contacts(&v).unwrap()),
        serde_json::to_string(&catalog::platforms(&v).unwrap()),
        serde_json::to_string(&catalog::games(&v).unwrap()),
        serde_json::to_string(&catalog::profiles(&v, &GameProfileFilter::default()).unwrap()),
        serde_json::to_string(&graph::overview(&v, None).unwrap()),
        serde_json::to_string(&v.info()),
        serde_json::to_string(&v.integrity_check().unwrap()),
        serde_json::to_string(&settings::load(v.conn()).unwrap()),
        serde_json::to_string(&backup::status(&v, &CloudRoots::default(), now).unwrap()),
    ]
    .map(Result::unwrap);

    for json in &responses {
        for secret in [CANARY, TOTP_KEY] {
            assert!(!json.contains(secret), "{secret} in a response: {json}");
        }
    }
    assert!(
        responses.iter().filter(|j| j.contains("plainuser")).count() >= 3,
        "sanity: usernames and gamertags are in these responses"
    );
    assert!(
        responses.iter().any(|j| j.contains("backup@example.com")),
        "sanity: recovery contacts are in these responses"
    );
}

// ---- Matching ----------------------------------------------------------------------

#[test]
fn trigram_substrings_find_accounts_by_gamertag_fragment() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let riot = accounts::create(&mut v, c, &input("Riot main")).unwrap();
    catalog::create_profile(&mut v, c, &riot.id, &profile("xX_Sn1per_Xx")).unwrap();
    let mut other = input("Steam");
    other.username = Some("quietplayer".into());
    accounts::create(&mut v, c, &other).unwrap();

    // Ctrl+K: a fragment from the middle of a gamertag, any case.
    assert_eq!(hits(&v, "sn1p"), ["profile:xX_Sn1per_Xx@Riot main"]);
    assert_eq!(hits(&v, "SN1PER"), ["profile:xX_Sn1per_Xx@Riot main"]);
    // The list's text box finds the account the profile is on.
    assert_eq!(titles(&v, c, text("n1pe")), ["Riot main"]);
    // A middle-of-word fragment of a username.
    assert_eq!(titles(&v, c, text("etpla")), ["Steam"]);
    // Every word must match.
    assert!(titles(&v, c, text("quiet sn1per")).is_empty());
    assert_eq!(titles(&v, c, text("quiet steam")), ["Steam"]);
}

#[test]
fn short_queries_fall_back_to_a_prefix_match() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    accounts::create(&mut v, c, &input("Xbox")).unwrap();
    let mut by_user = input("Battle.net");
    by_user.username = Some("xenon".into());
    accounts::create(&mut v, c, &by_user).unwrap();
    let mut by_player = input("Riot");
    by_player.player_id = Some("XQ-1234".into());
    accounts::create(&mut v, c, &by_player).unwrap();
    // "x" appears inside this title, but not at the start of a field.
    accounts::create(&mut v, c, &input("Epic Nexus")).unwrap();

    assert_eq!(
        titles(&v, c, text("x")),
        ["Battle.net", "Riot", "Xbox"],
        "prefix of title, username or player ID"
    );
    assert_eq!(titles(&v, c, text("XB")), ["Xbox"]);
    assert_eq!(hits(&v, "xe"), ["account:Battle.net"]);
    // LIKE wildcards typed by the user are plain characters.
    assert!(titles(&v, c, text("%")).is_empty());
    assert!(titles(&v, c, text("_b")).is_empty());
}

#[test]
fn search_ranks_titles_first_and_archived_last() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let mut in_notes = input("Epic");
    in_notes.notes = Some("same login as Valorant".into());
    accounts::create(&mut v, c, &in_notes).unwrap();
    let old = accounts::create(&mut v, c, &input("Valorant old")).unwrap();
    accounts::set_archived(&mut v, c, &old.id, true).unwrap();
    accounts::create(&mut v, c, &input("Valorant")).unwrap();
    identities::create(&mut v, c, &identity("Valorant persona", None)).unwrap();

    let found = hits(&v, "valorant");
    assert_eq!(found.last().unwrap(), "account:Valorant old", "{found:?}");
    let epic = found.iter().position(|h| h == "account:Epic").unwrap();
    let title = found.iter().position(|h| h == "account:Valorant").unwrap();
    assert!(
        title < epic,
        "a title match outranks a notes match: {found:?}"
    );
    assert!(found.contains(&"identity:Valorant persona".to_owned()));
}

#[test]
fn search_rejects_oversized_or_control_queries() {
    let dir = tempfile::tempdir().unwrap();
    let v = new_vault(dir.path(), &SystemClock);
    assert_eq!(
        field_of(search::search(&v, &"a".repeat(201), 20)),
        Some("query")
    );
    assert_eq!(field_of(search::search(&v, "a\u{0}b", 20)), Some("query"));
    assert!(search::search(&v, "   ", 20).unwrap().is_empty());
    // FTS5 syntax is searched for as text, not run.
    assert!(search::search(&v, "NEAR(a b) OR title:x *", 20)
        .unwrap()
        .is_empty());
}

// ---- Filters -----------------------------------------------------------------------

#[test]
fn each_filter_alone_and_together() {
    let dir = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let c = &clock;
    let mut v = new_vault(dir.path(), c);
    let persona =
        identities::create(&mut v, c, &identity("Main me", Some("me@example.com"))).unwrap();

    // Created on day 0, then left alone: 100 days idle at the checks below.
    let mut old = input("Old dormant");
    old.platform_id = Some(STEAM.into());
    old.tags = vec!["Legacy".into()];
    let old = accounts::create(&mut v, c, &old).unwrap();
    clock.advance(DAY * 50);
    // 50 days idle at the checks below.
    let mut stale = input("Stale alt");
    stale.purpose_id = ALT.into();
    stale.platform_id = Some(RIOT.into());
    stale.publisher = Some("Riot Games".into());
    accounts::create(&mut v, c, &stale).unwrap();
    clock.advance(DAY * 50);

    let mut main = input("Main riot");
    main.platform_id = Some(RIOT.into());
    main.game_id = Some(VALORANT.into());
    main.identity_id = Some(persona.id.clone());
    main.email = Some("ME@example.com".into());
    main.tags = vec!["ranked".into(), "EU".into()];
    let main = accounts::create(&mut v, c, &main).unwrap();
    mfa::upsert(&mut v, c, &main.id, &totp()).unwrap();

    let mut coded = input("Coded recovery");
    coded.purpose_id = RECOVERY.into();
    coded.status = AccountStatus::Locked;
    let coded = accounts::create(&mut v, c, &coded).unwrap();
    let m = mfa::upsert(&mut v, c, &coded.id, &totp()).unwrap().mfa[0]
        .id
        .clone();
    mfa::set_backup_codes(&mut v, c, &m, Some("AAAA-1111\nBBBB-2222")).unwrap();

    let mut fav = input("Favorite casual");
    fav.purpose_id = "builtin-casual".into();
    let fav = accounts::create(&mut v, c, &fav).unwrap();
    accounts::set_favorite(&mut v, c, &fav.id, true).unwrap();
    // A profile for Valorant on another account counts for the game filter.
    catalog::create_profile(&mut v, c, &fav.id, &profile("fav_tag")).unwrap();
    accounts::mark_verified(&mut v, c, &fav.id).unwrap();

    let gone = accounts::create(&mut v, c, &input("Archived one")).unwrap();
    accounts::set_archived(&mut v, c, &gone.id, true).unwrap();

    let f = |v: &OpenVault, f: AccountFilter| titles(v, c, f);
    assert_eq!(
        f(&v, AccountFilter::default()),
        [
            "Coded recovery",
            "Favorite casual",
            "Main riot",
            "Old dormant",
            "Stale alt"
        ]
    );
    assert_eq!(
        f(
            &v,
            AccountFilter {
                archived: true,
                ..Default::default()
            }
        ),
        ["Archived one"]
    );
    assert_eq!(
        f(
            &v,
            AccountFilter {
                identity_ids: vec![persona.id.clone()],
                ..Default::default()
            }
        ),
        ["Main riot"]
    );
    assert_eq!(
        f(
            &v,
            AccountFilter {
                purpose_ids: vec![ALT.into(), RECOVERY.into()],
                ..Default::default()
            }
        ),
        ["Coded recovery", "Stale alt"]
    );
    assert_eq!(
        f(
            &v,
            AccountFilter {
                platform_ids: vec![RIOT.into()],
                ..Default::default()
            }
        ),
        ["Main riot", "Stale alt"]
    );
    assert_eq!(
        f(
            &v,
            AccountFilter {
                game_ids: vec![VALORANT.into()],
                ..Default::default()
            }
        ),
        ["Favorite casual", "Main riot"]
    );
    assert_eq!(
        f(
            &v,
            AccountFilter {
                publishers: vec![" riot GAMES ".into()],
                ..Default::default()
            }
        ),
        ["Stale alt"]
    );
    assert_eq!(
        f(
            &v,
            AccountFilter {
                tags: vec!["RANKED".into(), "legacy".into()],
                ..Default::default()
            }
        ),
        ["Main riot", "Old dormant"]
    );
    assert_eq!(
        f(
            &v,
            AccountFilter {
                mfa: Some(true),
                ..Default::default()
            }
        ),
        ["Coded recovery", "Main riot"]
    );
    assert_eq!(
        f(
            &v,
            AccountFilter {
                mfa: Some(false),
                ..Default::default()
            }
        ),
        ["Favorite casual", "Old dormant", "Stale alt"]
    );
    assert_eq!(
        f(
            &v,
            AccountFilter {
                recovery_codes: Some(true),
                ..Default::default()
            }
        ),
        ["Coded recovery"]
    );
    // MFA on, no codes: the "missing recovery codes" view. Accounts without
    // MFA aren't missing recovery codes.
    assert_eq!(
        f(
            &v,
            AccountFilter {
                recovery_codes: Some(false),
                ..Default::default()
            }
        ),
        ["Main riot"]
    );
    assert_eq!(
        f(
            &v,
            AccountFilter {
                favorite: Some(true),
                ..Default::default()
            }
        ),
        ["Favorite casual"]
    );
    assert_eq!(
        f(
            &v,
            AccountFilter {
                not_verified_in_days: Some(30),
                ..Default::default()
            }
        ),
        ["Coded recovery", "Main riot", "Old dormant", "Stale alt"]
    );
    assert_eq!(
        f(
            &v,
            AccountFilter {
                updated_in_days: Some(30),
                ..Default::default()
            }
        ),
        ["Coded recovery", "Favorite casual", "Main riot"]
    );
    assert_eq!(
        f(
            &v,
            AccountFilter {
                uses_primary_email: true,
                ..Default::default()
            }
        ),
        ["Main riot"]
    );
    assert_eq!(
        f(
            &v,
            AccountFilter {
                high_priority: true,
                ..Default::default()
            }
        ),
        [
            "Coded recovery",
            "Favorite casual",
            "Main riot",
            "Old dormant"
        ],
        "favorites and the Main and Recovery purposes"
    );

    // Statuses as the list shows them: 100 days idle is Dormant, 50 is Stale.
    let status = |v: &OpenVault, s: Vec<StatusFilter>| {
        f(
            v,
            AccountFilter {
                statuses: s,
                ..Default::default()
            },
        )
    };
    assert_eq!(status(&v, vec![StatusFilter::Dormant]), ["Old dormant"]);
    assert_eq!(status(&v, vec![StatusFilter::Stale]), ["Stale alt"]);
    assert_eq!(
        status(&v, vec![StatusFilter::Active]),
        ["Favorite casual", "Main riot"]
    );
    assert_eq!(status(&v, vec![StatusFilter::Locked]), ["Coded recovery"]);
    assert_eq!(
        status(&v, vec![StatusFilter::Stale, StatusFilter::Locked]),
        ["Coded recovery", "Stale alt"]
    );

    // Several filters: all must hold.
    assert_eq!(
        f(
            &v,
            AccountFilter {
                platform_ids: vec![RIOT.into()],
                mfa: Some(true),
                tags: vec!["eu".into()],
                text: Some("riot".into()),
                ..Default::default()
            }
        ),
        ["Main riot"]
    );
    assert!(f(
        &v,
        AccountFilter {
            platform_ids: vec![RIOT.into()],
            favorite: Some(true),
            ..Default::default()
        }
    )
    .is_empty());
    assert!(f(
        &v,
        AccountFilter {
            archived: true,
            mfa: Some(true),
            ..Default::default()
        }
    )
    .is_empty());

    // An edit counts as activity: the old account is no longer dormant.
    let mut edited = input("Old dormant");
    edited.platform_id = Some(STEAM.into());
    edited.tags = vec!["Legacy".into()];
    accounts::update(&mut v, c, &old.id, &edited).unwrap();
    assert!(status(&v, vec![StatusFilter::Dormant]).is_empty());
}

#[test]
fn the_list_sorts_by_each_key() {
    let dir = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let c = &clock;
    let mut v = new_vault(dir.path(), c);
    let b = accounts::create(&mut v, c, &input("bravo")).unwrap();
    clock.advance(DAY);
    accounts::create(&mut v, c, &input("Alpha")).unwrap();
    clock.advance(DAY);
    accounts::create(&mut v, c, &input("charlie")).unwrap();
    clock.advance(DAY);
    accounts::update(&mut v, c, &b.id, &input("bravo")).unwrap();

    let sorted = |key, descending| {
        accounts::list(
            &v,
            c,
            AccountFilter::default(),
            AccountSort { key, descending },
        )
        .unwrap()
        .into_iter()
        .map(|a| a.title)
        .collect::<Vec<_>>()
    };
    assert_eq!(sorted(SortKey::Title, false), ["Alpha", "bravo", "charlie"]);
    assert_eq!(sorted(SortKey::Title, true), ["charlie", "bravo", "Alpha"]);
    assert_eq!(
        sorted(SortKey::Created, false),
        ["bravo", "Alpha", "charlie"]
    );
    assert_eq!(
        sorted(SortKey::Updated, true),
        ["bravo", "charlie", "Alpha"]
    );
    assert_eq!(
        sorted(SortKey::Activity, true),
        ["bravo", "charlie", "Alpha"]
    );
    for key in [SortKey::Identity, SortKey::Purpose, SortKey::Status] {
        assert_eq!(sorted(key, false).len(), 3);
    }
}

#[test]
fn invalid_filters_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let v = new_vault(dir.path(), &SystemClock);
    let bad = [
        AccountFilter {
            platform_ids: vec!["  ".into()],
            ..Default::default()
        },
        AccountFilter {
            updated_in_days: Some(0),
            ..Default::default()
        },
        AccountFilter {
            tags: (0..51).map(|i| format!("t{i}")).collect(),
            ..Default::default()
        },
        AccountFilter {
            text: Some("x".repeat(201)),
            ..Default::default()
        },
    ];
    for filter in bad {
        assert_eq!(
            field_of(accounts::list(
                &v,
                &SystemClock,
                filter,
                AccountSort::default()
            )),
            Some("filter")
        );
    }
}

// ---- The index stays in step ------------------------------------------------------

#[test]
fn the_index_follows_updates_deletes_and_renames_and_matches_a_rebuild() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let persona = identities::create(&mut v, c, &identity("Alpha", None)).unwrap();
    let mut a = input("Launcher one");
    a.identity_id = Some(persona.id.clone());
    a.tags = vec!["first".into()];
    let a = accounts::create(&mut v, c, &a).unwrap();
    let b = accounts::create(&mut v, c, &input("To delete")).unwrap();
    let p = catalog::create_profile(&mut v, c, &b.id, &profile("gonetag")).unwrap();
    assert!(index_ok(&v));

    // Update: the old title stops matching, the new one starts.
    let mut renamed = input("Renamed launcher");
    renamed.identity_id = Some(persona.id.clone());
    renamed.tags = vec!["first".into()];
    accounts::update(&mut v, c, &a.id, &renamed).unwrap();
    assert!(titles(&v, c, text("Launcher one")).is_empty());
    assert_eq!(titles(&v, c, text("renamed")), ["Renamed launcher"]);

    // An identity rename reaches the account's row.
    identities::update(&mut v, c, &persona.id, &identity("Bravo", None)).unwrap();
    assert_eq!(titles(&v, c, text("bravo")), ["Renamed launcher"]);
    assert!(titles(&v, c, text("alpha")).is_empty());

    // So does bulk tagging.
    accounts::bulk_tag(
        &mut v,
        c,
        std::slice::from_ref(&a.id),
        &["weekly".into()],
        &[],
    )
    .unwrap();
    assert_eq!(titles(&v, c, text("weekly")), ["Renamed launcher"]);

    // Delete removes the account's row and its profiles' rows.
    accounts::delete(&mut v, &b.id, "To delete").unwrap();
    assert!(hits(&v, "gonetag").is_empty());
    assert!(hits(&v, "To delete").is_empty());
    assert_eq!(
        v.conn()
            .query_row(
                "SELECT COUNT(*) FROM search_index WHERE entity_id = ?1",
                [&p.id],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert!(index_ok(&v));

    let incremental = index_rows(&v);
    let n = search::rebuild_index(&mut v).unwrap();
    assert_eq!(usize::try_from(n).unwrap(), incremental.len());
    assert_eq!(index_rows(&v), incremental, "rebuild equals incremental");
}

#[test]
fn the_integrity_check_notices_drift_and_a_rebuild_repairs_it() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let a = accounts::create(&mut v, &SystemClock, &input("Drifting")).unwrap();
    assert!(index_ok(&v));

    v.conn()
        .execute("DELETE FROM search_index WHERE entity_id = ?1", [&a.id])
        .unwrap();
    assert!(!index_ok(&v));
    assert!(
        v.integrity_check().unwrap().ok,
        "the database itself is fine"
    );
    search::rebuild_index(&mut v).unwrap();
    assert!(index_ok(&v));

    // Same count, but one row is an orphan.
    v.conn()
        .execute(
            "INSERT INTO search_index (entity_type, entity_id, title, username, email, game,
                platform, publisher, tags, identity, purpose, notes, region, player_id)
             VALUES ('account', 'ghost', 'x', '', '', '', '', '', '', '', '', '', '', '')",
            [],
        )
        .unwrap();
    v.conn()
        .execute("DELETE FROM search_index WHERE entity_id = ?1", [&a.id])
        .unwrap();
    assert!(!index_ok(&v));
    search::rebuild_index(&mut v).unwrap();
    assert!(index_ok(&v));
    assert_eq!(hits(&v, "Drifting"), ["account:Drifting"]);
}

// ---- Bulk actions ---------------------------------------------------------------

#[test]
fn bulk_tag_adds_and_removes_in_one_go() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let mut a = input("A");
    a.tags = vec!["old".into(), "keep".into()];
    let a = accounts::create(&mut v, c, &a).unwrap();
    let b = accounts::create(&mut v, c, &input("B")).unwrap();
    let ids = vec![a.id.clone(), b.id.clone(), a.id.clone()];

    let r = accounts::bulk_tag(&mut v, c, &ids, &["Ranked".into()], &["OLD".into()]).unwrap();
    assert_eq!(r.changed, 2, "duplicates count once");
    assert_eq!(accounts::get(&v, &a.id).unwrap().tags, ["keep", "Ranked"]);
    assert_eq!(accounts::get(&v, &b.id).unwrap().tags, ["Ranked"]);
    assert!(
        !accounts::tags(&v).unwrap().contains(&"old".to_owned()),
        "unused tags are pruned"
    );

    assert_eq!(
        field_of(accounts::bulk_tag(&mut v, c, &ids, &[], &[])),
        Some("tags")
    );
    assert_eq!(
        field_of(accounts::bulk_tag(&mut v, c, &[], &["x".into()], &[])),
        Some("ids")
    );
    // No account may end up over the tag limit.
    let many: Vec<String> = (0..32).map(|i| format!("t{i}")).collect();
    assert_eq!(
        field_of(accounts::bulk_tag(&mut v, c, &ids, &many, &[])),
        Some("tags")
    );
    assert_eq!(accounts::get(&v, &b.id).unwrap().tags, ["Ranked"]);
    // A missing id fails the whole action: nothing changes.
    let with_missing = vec![b.id.clone(), "nope".to_owned()];
    assert_eq!(
        accounts::bulk_tag(&mut v, c, &with_missing, &["new".into()], &[]).unwrap_err(),
        AppError::NotFound
    );
    assert_eq!(accounts::get(&v, &b.id).unwrap().tags, ["Ranked"]);
}

#[test]
fn bulk_archive_and_unarchive() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let a = accounts::create(&mut v, c, &input("A")).unwrap();
    let b = accounts::create(&mut v, c, &input("B")).unwrap();
    accounts::create(&mut v, c, &input("C")).unwrap();
    let ids = [a.id.clone(), b.id.clone()];

    assert_eq!(
        accounts::bulk_set_archived(&mut v, c, &ids, true)
            .unwrap()
            .changed,
        2
    );
    assert_eq!(titles(&v, c, AccountFilter::default()), ["C"]);
    let archived = AccountFilter {
        archived: true,
        ..Default::default()
    };
    assert_eq!(titles(&v, c, archived.clone()), ["A", "B"]);
    accounts::bulk_set_archived(&mut v, c, &ids[..1], false).unwrap();
    assert_eq!(titles(&v, c, archived), ["B"]);
}

#[test]
fn bulk_delete_needs_the_exact_phrase_for_the_exact_count() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let mut a = input("A");
    a.tags = vec!["only-a".into()];
    let a = accounts::create(&mut v, c, &a).unwrap();
    let b = accounts::create(&mut v, c, &input("B")).unwrap();
    catalog::create_profile(&mut v, c, &b.id, &profile("btag")).unwrap();
    let keep = accounts::create(&mut v, c, &input("Keep")).unwrap();
    let ids = [a.id.clone(), b.id.clone()];

    assert_eq!(accounts::bulk_delete_phrase(1), "DELETE 1 ACCOUNT");
    assert_eq!(accounts::bulk_delete_phrase(2), "DELETE 2 ACCOUNTS");
    for wrong in [
        "",
        "DELETE",
        "delete 2 accounts",
        "DELETE 3 ACCOUNTS",
        "DELETE 1 ACCOUNT",
    ] {
        assert_eq!(
            field_of(accounts::bulk_delete(&mut v, &ids, wrong)),
            Some("confirm"),
            "{wrong:?}"
        );
    }
    assert_eq!(titles(&v, c, AccountFilter::default()).len(), 3);

    let r = accounts::bulk_delete(&mut v, &ids, " DELETE 2 ACCOUNTS ").unwrap();
    assert_eq!(r.changed, 2);
    assert_eq!(titles(&v, c, AccountFilter::default()), ["Keep"]);
    assert!(hits(&v, "btag").is_empty());
    assert!(!accounts::tags(&v).unwrap().contains(&"only-a".to_owned()));
    assert!(index_ok(&v));
    assert_eq!(
        accounts::bulk_delete(
            &mut v,
            &[keep.id.clone(), a.id.clone()],
            "DELETE 2 ACCOUNTS"
        )
        .unwrap_err(),
        AppError::NotFound,
        "an already-deleted id fails the whole action"
    );
    assert_eq!(titles(&v, c, AccountFilter::default()), ["Keep"]);
}

// ---- Saved views ----------------------------------------------------------------

#[test]
fn built_in_views_are_seeded_and_read_only() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let views = search::views(&v).unwrap();
    let names: Vec<&str> = views.iter().map(|x| x.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "Main",
            "Alts",
            "High-priority",
            "Missing MFA",
            "Missing recovery codes",
            "Uses primary email",
            "Recently updated",
            "Dormant",
            "Archived"
        ],
        "every seeded filter parses"
    );
    assert!(views.iter().all(|x| x.is_builtin));
    let archived = views
        .iter()
        .find(|x| x.id == "builtin-view-archived")
        .unwrap();
    assert!(archived.spec.filter.archived);
    let recent = views
        .iter()
        .find(|x| x.id == "builtin-view-recent")
        .unwrap();
    assert_eq!(recent.spec.sort.key, SortKey::Updated);

    let edit = SavedViewInput {
        name: "Mine".into(),
        spec: archived.spec.clone(),
    };
    assert_eq!(
        field_of(search::update_view(
            &mut v,
            &SystemClock,
            "builtin-view-main",
            &edit
        )),
        Some("id")
    );
    assert_eq!(
        field_of(search::delete_view(&mut v, "builtin-view-archived")),
        Some("id")
    );
    assert_eq!(
        search::delete_view(&mut v, "nope").unwrap_err(),
        AppError::NotFound
    );
}

#[test]
fn user_views_can_be_created_renamed_and_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let spec = ViewSpec {
        v: 1,
        filter: AccountFilter {
            tags: vec![" ranked ".into()],
            mfa: Some(false),
            ..Default::default()
        },
        sort: AccountSort {
            key: SortKey::Activity,
            descending: true,
        },
    };
    let made = search::create_view(
        &mut v,
        c,
        &SavedViewInput {
            name: "  Ranked, no MFA ".into(),
            spec: spec.clone(),
        },
    )
    .unwrap();
    assert_eq!(made.name, "Ranked, no MFA");
    assert!(!made.is_builtin);
    assert_eq!(made.spec.filter.tags, ["ranked"], "validated and trimmed");
    assert_eq!(search::views(&v).unwrap().last().unwrap().id, made.id);

    // Names are unique, case-insensitively, including against built-ins.
    for taken in ["ranked, NO mfa", "main", "Archived"] {
        assert_eq!(
            field_of(search::create_view(
                &mut v,
                c,
                &SavedViewInput {
                    name: taken.into(),
                    spec: spec.clone()
                }
            )),
            Some("name"),
            "{taken}"
        );
    }
    let mut future = spec.clone();
    future.v = 2;
    assert_eq!(
        field_of(search::create_view(
            &mut v,
            c,
            &SavedViewInput {
                name: "Future".into(),
                spec: future
            }
        )),
        Some("filter")
    );

    let changed = search::update_view(
        &mut v,
        c,
        &made.id,
        &SavedViewInput {
            name: "Ranked, no MFA".into(),
            spec: ViewSpec {
                v: 1,
                filter: AccountFilter::default(),
                sort: AccountSort::default(),
            },
        },
    )
    .unwrap();
    assert_eq!(
        changed.spec.filter,
        AccountFilter::default(),
        "keeping its own name is fine"
    );
    search::delete_view(&mut v, &made.id).unwrap();
    assert!(search::views(&v).unwrap().iter().all(|x| x.is_builtin));
}

#[test]
fn a_stored_view_with_a_broken_filter_is_skipped() {
    let dir = tempfile::tempdir().unwrap();
    let v = new_vault(dir.path(), &SystemClock);
    v.conn()
        .execute(
            "INSERT INTO saved_view (id, name, filter_json, created_at, updated_at)
             VALUES ('bad', 'Bad', '{\"v\":1,\"filter\":{\"sql\":\"1=1\"}}', 'x', 'x')",
            [],
        )
        .unwrap();
    assert!(search::views(&v).unwrap().iter().all(|x| x.id != "bad"));
}

// ---- Performance ------------------------------------------------------------------

/// 5,000 accounts: search and filtered lists stay under 50 ms at p95.
/// Slow to seed, so it only runs with `--ignored` (and `--release`).
#[test]
#[ignore = "seeds 5k accounts; run with --release -- --ignored"]
#[allow(clippy::disallowed_macros, clippy::print_stderr)] // report the measurement
fn search_is_fast_at_five_thousand_accounts() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    for i in 0..5000 {
        let mut a = input(&format!("Account {i:04}"));
        a.username = Some(format!("player_{i:04}_tag"));
        a.email = Some(format!("user{}@example.com", i % 300));
        a.platform_id = Some(if i % 2 == 0 { STEAM } else { RIOT }.into());
        a.notes = Some(format!("seeded row {i} for the performance test"));
        a.tags = vec![format!("group{}", i % 20)];
        accounts::create(&mut v, c, &a).unwrap();
    }

    let mut times = Vec::new();
    for q in ["r_12", "yer_4", "account 3", "example", "ab", "tag"] {
        let mut worst = (Duration::ZERO, Duration::ZERO);
        for _ in 0..10 {
            let t = Instant::now();
            search::search(&v, q, 20).unwrap();
            let s = t.elapsed();
            let t = Instant::now();
            accounts::list(
                &v,
                c,
                AccountFilter {
                    text: Some(q.into()),
                    platform_ids: vec![STEAM.into()],
                    tags: vec!["group3".into()],
                    ..Default::default()
                },
                AccountSort::default(),
            )
            .unwrap();
            let l = t.elapsed();
            worst = (worst.0.max(s), worst.1.max(l));
            times.extend([s, l]);
        }
        eprintln!(
            "{q:>10}: search {:?}, list {:?} (worst of 10)",
            worst.0, worst.1
        );
    }
    times.sort();
    let p95 = times[times.len() * 95 / 100];
    eprintln!("p95 = {p95:?} over {} queries", times.len());
    assert!(p95 < Duration::from_millis(50), "p95 {p95:?}");
}

/// A casual account is high-priority when its password is weak or reused,
/// and not when the password is merely fair and unique.
#[test]
fn high_priority_includes_weak_and_reused_passwords() {
    let dir = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let c = &clock;
    let mut v = new_vault(dir.path(), c);

    let casual = |v: &mut OpenVault, title: &str, password: Option<&str>| {
        let mut form = input(title);
        form.purpose_id = "builtin-casual".into();
        if let Some(password) = password {
            form.password = set(password);
        }
        accounts::create(v, c, &form).unwrap()
    };

    let weak = casual(&mut v, "Weak casual", Some("unique-weak-password"));
    v.conn()
        .execute(
            "UPDATE account SET password_strength = 1 WHERE id = ?1",
            [&weak.id],
        )
        .unwrap();
    let fair = casual(&mut v, "Fair casual", Some("unique-fair-password"));
    v.conn()
        .execute(
            "UPDATE account SET password_strength = 2 WHERE id = ?1",
            [&fair.id],
        )
        .unwrap();
    let one = casual(&mut v, "Reused one", Some("same-password-for-both"));
    let two = casual(&mut v, "Reused two", Some("same-password-for-both"));
    v.conn()
        .execute(
            "UPDATE account SET password_strength = 4 WHERE id = ?1 OR id = ?2",
            [&one.id, &two.id],
        )
        .unwrap();
    let fav = casual(&mut v, "Just favorite", None);
    accounts::set_favorite(&mut v, c, &fav.id, true).unwrap();

    let found = titles(
        &v,
        c,
        AccountFilter {
            high_priority: true,
            ..Default::default()
        },
    );
    assert!(found.contains(&"Weak casual".to_owned()));
    assert!(found.contains(&"Reused one".to_owned()));
    assert!(found.contains(&"Reused two".to_owned()));
    assert!(found.contains(&"Just favorite".to_owned()));
    assert!(
        !found.contains(&"Fair casual".to_owned()),
        "strength 2 is not a high-severity issue: {found:?}"
    );
}
