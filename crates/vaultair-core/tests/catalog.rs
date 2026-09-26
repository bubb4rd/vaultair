#![allow(clippy::unwrap_used)] // test helpers
//! Phase 10: the platform and game catalog, account links, filters, game
//! profiles, and the search rows they keep in step.

use std::path::Path;

use secrecy::SecretString;
use vaultair_core::clock::{Clock, SystemClock};
use vaultair_core::crypto::kdf::KdfParams;
use vaultair_core::domain::account::{
    AccountFilter, AccountInput, AccountStatus, AccountType, AccountUrl, SecretUpdate,
};
use vaultair_core::domain::catalog::{
    GameInput, GameProfileFilter, GameProfileInput, PlatformInput, PlatformKind,
};
use vaultair_core::service::{accounts, catalog};
use vaultair_core::vault::{create_vault, CreateOptions, OpenVault};
use vaultair_core::AppError;

const STEAM: &str = "builtin-pl-steam";
const RIOT: &str = "builtin-pl-riot";
const VALORANT: &str = "builtin-game-valorant";
const LOL: &str = "builtin-game-lol";

fn new_vault(parent: &Path, clock: &dyn Clock) -> OpenVault {
    create_vault(
        &CreateOptions {
            parent_dir: parent.to_path_buf(),
            name: "Catalog".into(),
            kdf: KdfParams::MINIMUM,
            demo: false,
        },
        &SecretString::from("orbit lantern cactus mosaic"),
        clock,
    )
    .unwrap()
}

fn input(title: &str, platform: Option<&str>, game: Option<&str>) -> AccountInput {
    AccountInput {
        title: title.into(),
        account_type: AccountType::Launcher,
        purpose_id: "builtin-main".into(),
        status: AccountStatus::Active,
        identity_id: None,
        username: None,
        email: None,
        password: SecretUpdate::Unchanged,
        recovery_email: None,
        recovery_phone: None,
        website_url: None,
        login_url: None,
        platform_id: platform.map(Into::into),
        game_id: game.map(Into::into),
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

fn profile(game: &str) -> GameProfileInput {
    GameProfileInput {
        game_id: game.into(),
        platform_id: None,
        gamertag: Some("NightOwl#EUW".into()),
        player_id: None,
        region: Some("EU".into()),
        rank_tier: Some("Diamond 2".into()),
        current_season: None,
        notes: None,
        linked_launcher_account_id: None,
        linked_console_account_id: None,
    }
}

fn field_of<T>(r: Result<T, AppError>) -> Option<&'static str> {
    r.err().and_then(|e| e.field())
}

fn titles(v: &OpenVault, filter: &AccountFilter) -> Vec<String> {
    accounts::list(v, false, filter)
        .unwrap()
        .into_iter()
        .map(|a| a.title)
        .collect()
}

fn search_column(v: &OpenVault, entity_id: &str, column: &str) -> Option<String> {
    v.conn()
        .query_row(
            &format!("SELECT {column} FROM search_index WHERE entity_id = ?1"),
            [entity_id],
            |r| r.get(0),
        )
        .ok()
}

#[test]
fn a_new_vault_has_the_built_in_catalog_with_logos() {
    let dir = tempfile::tempdir().unwrap();
    let v = new_vault(dir.path(), &SystemClock);
    let platforms = catalog::platforms(&v).unwrap();
    let steam = platforms.iter().find(|p| p.id == STEAM).unwrap();
    assert_eq!(steam.name, "Steam");
    assert_eq!(steam.kind, PlatformKind::Launcher);
    assert_eq!(steam.icon.as_deref(), Some("steam"));
    assert!(steam.is_builtin);
    assert_eq!(steam.account_count, 0);
    let games = catalog::games(&v).unwrap();
    assert!(games
        .iter()
        .any(|g| g.id == VALORANT && g.icon.as_deref() == Some("valorant")));
}

#[test]
fn accounts_carry_their_platform_and_game_and_reject_unknown_ids() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let created = accounts::create(
        &mut v,
        &SystemClock,
        &input("Ranked", Some(RIOT), Some(VALORANT)),
    )
    .unwrap();
    assert_eq!(created.platform_name.as_deref(), Some("Riot Games"));
    assert_eq!(created.game_icon.as_deref(), Some("valorant"));
    let summary = &accounts::list(&v, false, &AccountFilter::default()).unwrap()[0];
    assert_eq!(summary.platform_icon.as_deref(), Some("riotgames"));
    assert_eq!(summary.game_name.as_deref(), Some("Valorant"));
    assert_eq!(
        search_column(&v, &created.id, "platform").as_deref(),
        Some("Riot Games")
    );

    assert_eq!(
        field_of(accounts::create(
            &mut v,
            &SystemClock,
            &input("Bad", Some("nope"), None)
        )),
        Some("platformId")
    );
    assert_eq!(
        field_of(accounts::create(
            &mut v,
            &SystemClock,
            &input("Bad", None, Some("nope"))
        )),
        Some("gameId")
    );
}

#[test]
fn the_account_list_filters_by_platform_game_and_publisher() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    accounts::create(&mut v, c, &input("Riot main", Some(RIOT), Some(VALORANT))).unwrap();
    let steam = accounts::create(&mut v, c, &input("Steam main", Some(STEAM), None)).unwrap();
    let mut with_publisher = input("Publisher account", None, None);
    with_publisher.publisher = Some("Example Publisher".into());
    accounts::create(&mut v, c, &with_publisher).unwrap();
    // A Valorant profile on the Steam account counts for the game filter.
    catalog::create_profile(&mut v, c, &steam.id, &profile(VALORANT)).unwrap();

    let by_platform = AccountFilter {
        platform_id: Some(STEAM.into()),
        ..Default::default()
    };
    assert_eq!(titles(&v, &by_platform), ["Steam main"]);
    let by_game = AccountFilter {
        game_id: Some(VALORANT.into()),
        ..Default::default()
    };
    assert_eq!(titles(&v, &by_game), ["Riot main", "Steam main"]);
    let by_publisher = AccountFilter {
        publisher: Some(" example PUBLISHER ".into()),
        ..Default::default()
    };
    assert_eq!(titles(&v, &by_publisher), ["Publisher account"]);
    let both = AccountFilter {
        platform_id: Some(RIOT.into()),
        game_id: Some(LOL.into()),
        publisher: None,
    };
    assert!(titles(&v, &both).is_empty());
}

#[test]
fn the_login_page_falls_back_to_the_catalog_and_says_so() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let a = accounts::create(&mut v, &SystemClock, &input("Steam", Some(STEAM), None)).unwrap();
    assert_eq!(
        a.catalog_login_url.as_deref(),
        Some("https://store.steampowered.com/login/")
    );
    let target = accounts::url_target(&v, &a.id, AccountUrl::Login).unwrap();
    assert!(target.from_catalog);
    assert_eq!(target.host, "store.steampowered.com");

    let mut own = input("Steam", Some(STEAM), None);
    own.login_url = Some("https://login.example.com/".into());
    let a = accounts::update(&mut v, &SystemClock, &a.id, &own).unwrap();
    assert_eq!(a.catalog_login_url, None);
    let target = accounts::url_target(&v, &a.id, AccountUrl::Login).unwrap();
    assert!(!target.from_catalog);
    assert_eq!(target.host, "login.example.com");

    let plain = accounts::create(&mut v, &SystemClock, &input("Plain", None, None)).unwrap();
    assert!(matches!(
        accounts::url_target(&v, &plain.id, AccountUrl::Login),
        Err(AppError::NotFound)
    ));
}

#[test]
fn catalog_entries_can_be_added_and_renamed_with_unique_names() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let platform = PlatformInput {
        name: "Tournament Hub".into(),
        kind: PlatformKind::Website,
        publisher: None,
        default_login_url: Some("https://hub.example.com/login".into()),
    };
    let hub = catalog::create_platform(&mut v, c, &platform).unwrap();
    assert!(!hub.is_builtin);
    assert_eq!(hub.icon, None);
    let dupe = PlatformInput {
        name: "STEAM".into(),
        ..platform.clone()
    };
    assert_eq!(
        field_of(catalog::create_platform(&mut v, c, &dupe)),
        Some("name")
    );
    let bad_url = PlatformInput {
        default_login_url: Some("javascript:alert(1)".into()),
        name: "Other".into(),
        ..platform
    };
    assert_eq!(
        field_of(catalog::create_platform(&mut v, c, &bad_url)),
        Some("defaultLoginUrl")
    );

    let game = catalog::create_game(
        &mut v,
        c,
        &GameInput {
            name: "Arena Legends".into(),
            franchise: None,
            publisher: Some("Example Publisher".into()),
        },
    )
    .unwrap();
    assert_eq!(
        field_of(catalog::create_game(
            &mut v,
            c,
            &GameInput {
                name: "arena legends".into(),
                franchise: None,
                publisher: None,
            }
        )),
        Some("name")
    );

    // Renaming reindexes the accounts and profiles that name the entry.
    let a = accounts::create(&mut v, c, &input("Main", Some(STEAM), Some(&game.id))).unwrap();
    let p = catalog::create_profile(&mut v, c, &a.id, &profile(&game.id)).unwrap();
    let steam = catalog::update_platform(
        &mut v,
        c,
        STEAM,
        &PlatformInput {
            name: "Steam (Valve)".into(),
            kind: PlatformKind::Launcher,
            publisher: Some("Valve".into()),
            default_login_url: None,
        },
    )
    .unwrap();
    assert_eq!(
        steam.icon.as_deref(),
        Some("steam"),
        "a built-in keeps its logo"
    );
    assert_eq!(steam.account_count, 1);
    assert_eq!(
        search_column(&v, &a.id, "platform").as_deref(),
        Some("Steam (Valve)")
    );
    catalog::update_game(
        &mut v,
        c,
        &game.id,
        &GameInput {
            name: "Arena Legends II".into(),
            franchise: None,
            publisher: None,
        },
    )
    .unwrap();
    assert_eq!(
        search_column(&v, &a.id, "game").as_deref(),
        Some("Arena Legends II")
    );
    assert_eq!(
        search_column(&v, &p.id, "game").as_deref(),
        Some("Arena Legends II")
    );
}

#[test]
fn game_profiles_are_created_listed_edited_and_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let riot = accounts::create(&mut v, c, &input("Riot", Some(RIOT), None)).unwrap();
    let launcher = accounts::create(&mut v, c, &input("Launcher", Some(STEAM), None)).unwrap();

    let mut p_in = profile(VALORANT);
    p_in.platform_id = Some(RIOT.into());
    p_in.linked_launcher_account_id = Some(launcher.id.clone());
    let p = catalog::create_profile(&mut v, c, &riot.id, &p_in).unwrap();
    assert_eq!(p.game_name, "Valorant");
    assert_eq!(p.platform_name.as_deref(), Some("Riot Games"));
    assert_eq!(p.linked_launcher_title.as_deref(), Some("Launcher"));
    assert_eq!(
        search_column(&v, &p.id, "title").as_deref(),
        Some("NightOwl#EUW")
    );
    assert!(search_column(&v, &p.id, "notes")
        .unwrap()
        .contains("Diamond 2"));

    let for_account = GameProfileFilter {
        account_id: Some(riot.id.clone()),
        ..Default::default()
    };
    assert_eq!(catalog::profiles(&v, &for_account).unwrap().len(), 1);
    let for_game = GameProfileFilter {
        game_id: Some(VALORANT.into()),
        ..Default::default()
    };
    assert_eq!(catalog::profiles(&v, &for_game).unwrap().len(), 1);
    let valorant = catalog::games(&v)
        .unwrap()
        .into_iter()
        .find(|g| g.id == VALORANT)
        .unwrap();
    assert_eq!(valorant.profile_count, 1);

    let mut edit = p_in.clone();
    edit.rank_tier = Some("Ascendant 1".into());
    edit.game_id = LOL.into();
    let edited = catalog::update_profile(&mut v, c, &p.id, &edit).unwrap();
    assert_eq!(edited.rank_tier.as_deref(), Some("Ascendant 1"));
    assert_eq!(
        search_column(&v, &p.id, "game").as_deref(),
        Some("League of Legends")
    );

    // Validation: unknown game or platform, linking the account to itself.
    let mut bad = profile("nope");
    assert_eq!(
        field_of(catalog::create_profile(&mut v, c, &riot.id, &bad)),
        Some("gameId")
    );
    bad = profile(VALORANT);
    bad.platform_id = Some("nope".into());
    assert_eq!(
        field_of(catalog::create_profile(&mut v, c, &riot.id, &bad)),
        Some("platformId")
    );
    bad = profile(VALORANT);
    bad.linked_console_account_id = Some(riot.id.clone());
    assert_eq!(
        field_of(catalog::create_profile(&mut v, c, &riot.id, &bad)),
        Some("linkedConsoleAccountId")
    );
    assert!(matches!(
        catalog::create_profile(&mut v, c, "nope", &profile(VALORANT)),
        Err(AppError::NotFound)
    ));

    catalog::delete_profile(&mut v, c, &p.id).unwrap();
    assert!(catalog::profiles(&v, &for_account).unwrap().is_empty());
    assert_eq!(search_column(&v, &p.id, "title"), None);
    assert!(matches!(
        catalog::delete_profile(&mut v, c, &p.id),
        Err(AppError::NotFound)
    ));
}

#[test]
fn deleting_accounts_cascades_profiles_and_clears_links_to_them() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let owner = accounts::create(&mut v, c, &input("Owner", None, None)).unwrap();
    let launcher = accounts::create(&mut v, c, &input("Launcher", None, None)).unwrap();
    let mut p_in = profile(VALORANT);
    p_in.linked_launcher_account_id = Some(launcher.id.clone());
    let p = catalog::create_profile(&mut v, c, &owner.id, &p_in).unwrap();

    // The linked launcher goes: the link becomes NULL, the profile stays.
    accounts::delete(&mut v, &launcher.id, "Launcher").unwrap();
    let all = GameProfileFilter::default();
    let left = catalog::profiles(&v, &all).unwrap();
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].linked_launcher_account_id, None);

    // The owner goes: the profile and its search row go with it.
    accounts::delete(&mut v, &owner.id, "Owner").unwrap();
    assert!(catalog::profiles(&v, &all).unwrap().is_empty());
    assert_eq!(search_column(&v, &p.id, "title"), None);
    let orphans: i64 = v
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM search_index WHERE entity_type = 'game_profile'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(orphans, 0);
}

#[test]
fn archived_accounts_profiles_stay_on_the_account_but_leave_the_catalog_lists() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let c = &SystemClock;
    let a = accounts::create(&mut v, c, &input("Old", Some(RIOT), Some(VALORANT))).unwrap();
    catalog::create_profile(&mut v, c, &a.id, &profile(VALORANT)).unwrap();
    accounts::set_archived(&mut v, c, &a.id, true).unwrap();

    let by_game = GameProfileFilter {
        game_id: Some(VALORANT.into()),
        ..Default::default()
    };
    assert!(catalog::profiles(&v, &by_game).unwrap().is_empty());
    let on_account = GameProfileFilter {
        account_id: Some(a.id.clone()),
        ..Default::default()
    };
    assert_eq!(catalog::profiles(&v, &on_account).unwrap().len(), 1);
    let valorant = catalog::games(&v)
        .unwrap()
        .into_iter()
        .find(|g| g.id == VALORANT)
        .unwrap();
    assert_eq!((valorant.account_count, valorant.profile_count), (0, 0));
}

#[test]
fn a_template_duplicate_keeps_the_platform_and_game() {
    let dir = tempfile::tempdir().unwrap();
    let mut v = new_vault(dir.path(), &SystemClock);
    let a = accounts::create(
        &mut v,
        &SystemClock,
        &input("Main", Some(RIOT), Some(VALORANT)),
    )
    .unwrap();
    let dup = accounts::duplicate_as_template(&mut v, &SystemClock, &a.id).unwrap();
    assert_eq!(dup.platform_id.as_deref(), Some(RIOT));
    assert_eq!(dup.game_id.as_deref(), Some(VALORANT));
}
