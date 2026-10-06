#![allow(clippy::unwrap_used)] // test helpers
//! Relationship map (Phase 13): the product spec's example tree, the depth
//! and node caps, archived accounts, and a canary that must never reach the
//! graph.

use std::collections::HashSet;
use std::path::Path;

use secrecy::SecretString;
use vaultair_core::clock::{Clock, ManualClock};
use vaultair_core::crypto::kdf::KdfParams;
use vaultair_core::domain::account::{
    AccountInput, AccountStatus, AccountType, CustomFieldInput, CustomFieldType, SecretUpdate,
};
use vaultair_core::domain::catalog::GameProfileInput;
use vaultair_core::domain::graph::{EdgeKind, FocusKind, Graph, GraphFocus, GraphNode, NodeKind};
use vaultair_core::domain::identity::IdentityInput;
use vaultair_core::domain::mfa::{MfaInput, MfaMethod};
use vaultair_core::graph::{MAX_DEPTH, MAX_NODES};
use vaultair_core::service::{accounts, catalog, graph, identities, mfa};
use vaultair_core::vault::{create_vault, CreateOptions, OpenVault};
use vaultair_core::AppError;

const PASSWORD: &str = "orbit lantern cactus mosaic";
const CANARY: &str = "CANARY7F3A";

fn new_vault(parent: &Path, clock: &dyn Clock) -> OpenVault {
    create_vault(
        &CreateOptions {
            parent_dir: parent.to_path_buf(),
            name: "Graph".into(),
            kdf: KdfParams::MINIMUM,
            demo: false,
        },
        &SecretString::from(PASSWORD),
        clock,
    )
    .unwrap()
}

fn input(title: &str, account_type: AccountType) -> AccountInput {
    AccountInput {
        title: title.into(),
        account_type,
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

fn identity(v: &mut OpenVault, c: &dyn Clock, name: &str, primary: &str) -> String {
    identities::create(
        v,
        c,
        &IdentityInput {
            name: name.into(),
            description: None,
            primary_email: Some(primary.into()),
            recovery_email: Some("recovery@example.com".into()),
            phone_ref: Some("Pixel, ends 42".into()),
            notes: None,
            color: None,
            tags: Vec::new(),
        },
    )
    .unwrap()
    .id
}

fn profile(v: &mut OpenVault, c: &dyn Clock, account: &str, game: &str, launcher: &str) {
    catalog::create_profile(
        v,
        c,
        account,
        &GameProfileInput {
            game_id: game.into(),
            platform_id: None,
            gamertag: None,
            player_id: None,
            region: None,
            rank_tier: None,
            current_season: None,
            notes: None,
            linked_launcher_account_id: Some(launcher.into()),
            linked_console_account_id: None,
        },
    )
    .unwrap();
}

fn focus(kind: FocusKind, id: &str) -> GraphFocus {
    GraphFocus {
        kind,
        id: id.into(),
    }
}

fn node<'a>(g: &'a Graph, kind: NodeKind, label: &str) -> &'a GraphNode {
    g.nodes
        .iter()
        .find(|n| n.kind == kind && n.label == label)
        .unwrap_or_else(|| panic!("no {kind:?} node labelled {label}"))
}

fn has_edge(g: &Graph, source: &GraphNode, kind: EdgeKind, target: &GraphNode) -> bool {
    g.edges
        .iter()
        .any(|e| e.source == source.id && e.target == target.id && e.kind == kind)
}

/// Every edge joins two returned nodes, and every node but the focus hangs
/// under a returned node it shares an edge with.
fn assert_well_formed(g: &Graph) {
    let ids: HashSet<&str> = g.nodes.iter().map(|n| n.id.as_str()).collect();
    assert_eq!(ids.len(), g.nodes.len(), "node ids repeat");
    if let Some(focus) = &g.focus {
        assert!(ids.contains(focus.as_str()));
    }
    for e in &g.edges {
        assert!(ids.contains(e.source.as_str()) && ids.contains(e.target.as_str()));
    }
    for n in &g.nodes {
        // With a focus it is the only root; without one, every tree has its own.
        if n.parent.is_none() && g.focus.as_ref().is_none_or(|f| *f == n.id) {
            assert_eq!(n.depth, 0);
            continue;
        }
        let parent = n.parent.as_deref().expect("a parent");
        assert!(ids.contains(parent), "{} hangs under a missing node", n.id);
        let kind = n.parent_edge.expect("a parent edge");
        assert!(g.edges.iter().any(|e| e.kind == kind
            && ((e.source == parent && e.target == n.id)
                || (e.target == parent && e.source == n.id))));
    }
}

/// The product spec's example (§5), built from real records.
fn spec_vault(v: &mut OpenVault, c: &dyn Clock) -> String {
    let me = identity(v, c, "Primary Gaming Identity", "primary@example.com");
    let mut make = |title: &str, kind: AccountType, platform: Option<&str>| {
        let mut form = input(title, kind);
        form.identity_id = Some(me.clone());
        form.email = Some("Primary@Example.com".into());
        form.platform_id = platform.map(Into::into);
        accounts::create(v, c, &form).unwrap().id
    };
    let battle_net = make(
        "Battle.net",
        AccountType::Launcher,
        Some("builtin-pl-battlenet"),
    );
    let cod = make(
        "Activision / Call of Duty Main Account",
        AccountType::Game,
        None,
    );
    let steam = make("Steam", AccountType::Launcher, Some("builtin-pl-steam"));
    let cs2 = make("CS2 Main Account", AccountType::Game, None);
    make("Discord", AccountType::Social, Some("builtin-pl-discord"));
    make("Twitch", AccountType::Streaming, Some("builtin-pl-twitch"));
    profile(v, c, &cod, "builtin-game-cod", &battle_net);
    profile(v, c, &cs2, "builtin-game-cs2", &steam);
    mfa::upsert(
        v,
        c,
        &battle_net,
        &MfaInput {
            id: None,
            method: MfaMethod::AuthenticatorApp,
            enabled: true,
            totp_secret: SecretUpdate::Unchanged,
            recovery_instructions: SecretUpdate::Unchanged,
            notes: None,
        },
    )
    .unwrap();
    me
}

#[test]
fn the_spec_example_tree_has_its_nodes_edges_and_nesting() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);
    let me = spec_vault(&mut v, &clock);

    let g = graph::query(&v, &focus(FocusKind::Identity, &me), None, None).unwrap();
    assert_well_formed(&g);
    assert!(!g.truncated);

    let root = node(&g, NodeKind::Identity, "Primary Gaming Identity");
    assert_eq!(g.focus.as_deref(), Some(root.id.as_str()));
    let email = node(&g, NodeKind::Email, "primary@example.com");
    let recovery = node(&g, NodeKind::Email, "recovery@example.com");
    let phone = node(&g, NodeKind::RecoveryMethod, "Pixel, ends 42");
    let battle_net = node(&g, NodeKind::Account, "Battle.net");
    let cod = node(
        &g,
        NodeKind::Account,
        "Activision / Call of Duty Main Account",
    );
    let steam = node(&g, NodeKind::Account, "Steam");
    let cs2 = node(&g, NodeKind::Account, "CS2 Main Account");
    let discord = node(&g, NodeKind::Account, "Discord");
    let twitch = node(&g, NodeKind::Account, "Twitch");
    let authenticator = node(&g, NodeKind::MfaMethod, "Authenticator app");

    // Identity ├ Primary Email │ ├ Battle.net │ │ └ Call of Duty │ ├ Steam
    // │ │ └ CS2 │ ├ Discord │ └ Twitch ├ Recovery Email └ MFA entry.
    let under = |n: &GraphNode| (n.parent.clone(), n.parent_edge);
    assert_eq!(
        under(email),
        (Some(root.id.clone()), Some(EdgeKind::PrimaryEmail))
    );
    assert_eq!(
        under(recovery),
        (Some(root.id.clone()), Some(EdgeKind::RecoveryEmail))
    );
    assert_eq!(under(phone), (Some(root.id.clone()), Some(EdgeKind::Phone)));
    for account in [battle_net, steam, discord, twitch] {
        assert_eq!(
            under(account),
            (Some(email.id.clone()), Some(EdgeKind::LoginEmail)),
            "{}",
            account.label
        );
    }
    assert_eq!(
        under(cod),
        (Some(battle_net.id.clone()), Some(EdgeKind::LinkedLauncher))
    );
    assert_eq!(
        under(cs2),
        (Some(steam.id.clone()), Some(EdgeKind::LinkedLauncher))
    );
    assert_eq!(
        under(authenticator),
        (Some(battle_net.id.clone()), Some(EdgeKind::Mfa))
    );
    // An MFA node opens its account.
    assert_eq!(authenticator.record_id, battle_net.record_id);

    assert!(has_edge(&g, root, EdgeKind::Owns, cod));
    assert!(has_edge(&g, email, EdgeKind::LoginEmail, cod));
    assert!(has_edge(&g, battle_net, EdgeKind::LinkedLauncher, cod));
    let platform = node(&g, NodeKind::Platform, "Battle.net");
    assert!(has_edge(&g, battle_net, EdgeKind::OnPlatform, platform));
    assert_eq!(platform.icon.as_deref(), Some("battledotnet"));
    assert_eq!(battle_net.icon.as_deref(), Some("battledotnet"));
    assert_eq!(battle_net.detail.as_deref(), Some("Main"));
    let game = node(&g, NodeKind::Game, "Call of Duty");
    assert!(has_edge(&g, cod, EdgeKind::Plays, game));
    assert_eq!(
        (root.depth, email.depth, cod.depth, game.depth),
        (0, 1, 1, 2)
    );

    let kinds: HashSet<NodeKind> = g.nodes.iter().map(|n| n.kind).collect();
    assert_eq!(kinds.len(), NodeKind::ALL.len(), "every node kind appears");

    // The same records from the other end: the game leads back to its account.
    let from_game = graph::query(
        &v,
        &focus(FocusKind::Game, "builtin-game-cod"),
        Some(1),
        None,
    )
    .unwrap();
    assert_well_formed(&from_game);
    let labels: Vec<&str> = from_game.nodes.iter().map(|n| n.label.as_str()).collect();
    assert_eq!(
        labels,
        ["Call of Duty", "Activision / Call of Duty Main Account"]
    );
    let contact = email.record_id.clone();
    let from_email = graph::query(&v, &focus(FocusKind::Contact, &contact), Some(1), None).unwrap();
    assert_well_formed(&from_email);
    assert_eq!(
        from_email.nodes.len(),
        9,
        "the email, its identity, six accounts, the mailbox not in the vault"
    );
    assert_eq!(
        under(node(&from_email, NodeKind::Account, "CS2 Main Account")).1,
        Some(EdgeKind::LinkedLauncher)
    );
}

#[test]
fn depth_and_node_caps_are_enforced() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);
    let me = spec_vault(&mut v, &clock);
    let at = focus(FocusKind::Identity, &me);

    let near = graph::query(&v, &at, Some(1), None).unwrap();
    assert_well_formed(&near);
    assert!(near.nodes.iter().all(|n| n.depth <= 1));
    assert!(near.nodes.iter().all(|n| !matches!(
        n.kind,
        NodeKind::Platform | NodeKind::Game | NodeKind::MfaMethod
    )));
    assert_eq!(
        near.nodes.len(),
        10,
        "identity, 2 emails, phone, 6 accounts"
    );

    let full = graph::query(&v, &at, Some(MAX_DEPTH), Some(MAX_NODES)).unwrap();
    assert!(full.nodes.len() > near.nodes.len());
    assert!(full.nodes.iter().all(|n| n.depth <= MAX_DEPTH));
    assert_eq!(full, graph::query(&v, &at, None, None).unwrap());

    let capped = graph::query(&v, &at, None, Some(4)).unwrap();
    assert_well_formed(&capped);
    assert_eq!(capped.nodes.len(), 4);
    assert!(capped.truncated);
    let all = u32::try_from(full.nodes.len()).unwrap();
    assert!(!graph::query(&v, &at, None, Some(all)).unwrap().truncated);

    for (depth, limit, field) in [
        (Some(0), None, "depth"),
        (Some(MAX_DEPTH + 1), None, "depth"),
        (None, Some(0), "limit"),
        (None, Some(MAX_NODES + 1), "limit"),
    ] {
        assert_eq!(
            graph::query(&v, &at, depth, limit).unwrap_err(),
            AppError::InvalidInput { field }
        );
    }
    for missing in [
        focus(FocusKind::Identity, "no-such-identity"),
        focus(FocusKind::Account, &me),
        focus(FocusKind::Contact, "no-such-contact"),
        focus(FocusKind::Platform, "no-such-platform"),
        focus(FocusKind::Game, "no-such-game"),
    ] {
        assert_eq!(
            graph::query(&v, &missing, None, None).unwrap_err(),
            AppError::NotFound
        );
    }
}

#[test]
fn archived_accounts_and_every_secret_stay_out() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let c = &clock;
    let mut v = new_vault(tmp.path(), c);
    let me = identity(&mut v, c, "Main", "me@example.com");

    let secret = |tail: &str| SecretUpdate::Set {
        value: format!("{CANARY}-{tail}"),
    };
    let mut form = input("Game store", AccountType::Launcher);
    form.identity_id = Some(me.clone());
    form.email = Some("me@example.com".into());
    form.password = secret("password");
    form.sensitive_notes = secret("notes");
    form.custom_fields = vec![CustomFieldInput {
        id: None,
        label: "Security answer".into(),
        field_type: CustomFieldType::Secret,
        value: None,
        secret: secret("field"),
    }];
    let store = accounts::create(&mut v, c, &form).unwrap();
    let saved = mfa::upsert(
        &mut v,
        c,
        &store.id,
        &MfaInput {
            id: None,
            method: MfaMethod::Sms,
            enabled: true,
            totp_secret: SecretUpdate::Unchanged,
            recovery_instructions: secret("recovery"),
            notes: None,
        },
    )
    .unwrap();
    let codes = format!("{CANARY}-code");
    mfa::set_backup_codes(&mut v, c, &saved.mfa[0].id, Some(&codes)).unwrap();
    // A method that is turned off protects nothing, so it isn't drawn.
    mfa::upsert(
        &mut v,
        c,
        &store.id,
        &MfaInput {
            id: None,
            method: MfaMethod::HardwareKey,
            enabled: false,
            totp_secret: SecretUpdate::Unchanged,
            recovery_instructions: SecretUpdate::Unchanged,
            notes: None,
        },
    )
    .unwrap();

    let mut old = input("Old launcher", AccountType::Launcher);
    old.identity_id = Some(me.clone());
    old.email = Some("old@example.com".into());
    old.platform_id = Some("builtin-pl-epic".into());
    let old = accounts::create(&mut v, c, &old).unwrap();
    accounts::set_archived(&mut v, c, &old.id, true).unwrap();

    let g = graph::query(&v, &focus(FocusKind::Identity, &me), None, None).unwrap();
    assert_well_formed(&g);
    let labels: Vec<&str> = g.nodes.iter().map(|n| n.label.as_str()).collect();
    assert!(labels.contains(&"Game store") && labels.contains(&"Text message"));
    for gone in [
        "Old launcher",
        "old@example.com",
        "Epic Games Store",
        "Security key",
    ] {
        assert!(!labels.contains(&gone), "{gone} should not be drawn");
    }
    assert_eq!(
        graph::query(&v, &focus(FocusKind::Account, &old.id), None, None).unwrap_err(),
        AppError::NotFound
    );

    let json = serde_json::to_string(&g).unwrap();
    assert!(!json.contains(CANARY));
    for word in ["password", "strength", "secret", "fingerprint", "totp"] {
        assert!(
            !json.to_lowercase().contains(word),
            "{word} is in the graph"
        );
    }
}

fn account(
    v: &mut OpenVault,
    c: &dyn Clock,
    title: &str,
    kind: AccountType,
    email: &str,
) -> String {
    let mut form = input(title, kind);
    form.email = Some(email.into());
    accounts::create(v, c, &form).unwrap().id
}

fn prospects(g: &Graph) -> Vec<&str> {
    g.nodes
        .iter()
        .filter(|n| n.kind == NodeKind::ProspectiveAccount)
        .map(|n| n.label.as_str())
        .collect()
}

#[test]
fn an_email_without_its_mailbox_is_a_prospective_account() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let c = &clock;
    let mut v = new_vault(tmp.path(), c);
    let me = identity(&mut v, c, "Main", "me@xyz.com");
    let steam = account(&mut v, c, "Steam", AccountType::Launcher, "Me@XYZ.com");
    account(&mut v, c, "Discord", AccountType::Social, "me@xyz.com");
    account(&mut v, c, "Twitch", AccountType::Streaming, "me@xyz.com");
    let old = account(
        &mut v,
        c,
        "Old launcher",
        AccountType::Launcher,
        "old@xyz.com",
    );
    accounts::set_archived(&mut v, c, &old, true).unwrap();

    let at = focus(FocusKind::Account, &steam);
    let g = graph::query(&v, &at, None, None).unwrap();
    assert_well_formed(&g);
    let email = node(&g, NodeKind::Email, "me@xyz.com");
    let prospect = node(&g, NodeKind::ProspectiveAccount, "me@xyz.com");
    assert_eq!(prospect.record_id, email.record_id);
    assert_eq!(
        (
            prospect.parent.as_deref(),
            prospect.parent_edge,
            prospect.depth
        ),
        (Some(email.id.as_str()), Some(EdgeKind::Prospective), 2)
    );
    assert!(has_edge(&g, email, EdgeKind::Prospective, prospect));
    // An address only an identity names, or only an archived account uses,
    // has nothing depending on its mailbox.
    let whole = graph::query(&v, &focus(FocusKind::Identity, &me), None, None).unwrap();
    assert_well_formed(&whole);
    assert_eq!(prospects(&whole), ["me@xyz.com"]);

    let contact = email.record_id.clone();
    graph::set_prospect_dismissed(&mut v, c, &contact, true).unwrap();
    let g = graph::query(&v, &at, None, None).unwrap();
    assert_well_formed(&g);
    assert!(prospects(&g).is_empty());
    graph::set_prospect_dismissed(&mut v, c, &contact, false).unwrap();
    assert_eq!(
        prospects(&graph::query(&v, &at, None, None).unwrap()),
        ["me@xyz.com"]
    );

    let phone: String = v
        .conn()
        .query_row(
            "SELECT id FROM contact_point WHERE kind = 'phone'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    for not_an_email in [phone.as_str(), "no-such-contact"] {
        assert_eq!(
            graph::set_prospect_dismissed(&mut v, c, not_an_email, true).unwrap_err(),
            AppError::NotFound
        );
    }

    // The mailbox itself, once added, is an account like any other.
    account(&mut v, c, "XYZ mail", AccountType::Email, "me@xyz.com");
    let g = graph::query(&v, &at, None, None).unwrap();
    assert_well_formed(&g);
    assert!(prospects(&g).is_empty());
    assert_eq!(node(&g, NodeKind::Account, "XYZ mail").depth, 2);
}

#[test]
fn the_whole_vault_is_a_tree_per_identity_and_per_group_nothing_owns() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let c = &clock;
    let mut v = new_vault(tmp.path(), c);
    spec_vault(&mut v, c);
    identity(&mut v, c, "Alt", "alt@example.com");
    account(
        &mut v,
        c,
        "Forum",
        AccountType::Website,
        "stray@example.com",
    );
    account(&mut v, c, "Wiki", AccountType::Website, "stray@example.com");
    accounts::create(&mut v, c, &input("Notes app", AccountType::App)).unwrap();
    let old = account(&mut v, c, "Old", AccountType::Website, "old@example.com");
    accounts::set_archived(&mut v, c, &old, true).unwrap();

    let g = graph::overview(&v, None).unwrap();
    assert_well_formed(&g);
    assert_eq!(g.focus, None);
    assert!(!g.truncated);
    let roots: Vec<(NodeKind, &str)> = g
        .nodes
        .iter()
        .filter(|n| n.parent.is_none())
        .map(|n| (n.kind, n.label.as_str()))
        .collect();
    assert_eq!(
        roots,
        [
            (NodeKind::Identity, "Alt"),
            (NodeKind::Identity, "Primary Gaming Identity"),
            (NodeKind::Email, "stray@example.com"),
            (NodeKind::Account, "Notes app"),
        ]
    );
    let stray = node(&g, NodeKind::Email, "stray@example.com");
    for title in ["Forum", "Wiki"] {
        assert_eq!(
            node(&g, NodeKind::Account, title).parent.as_deref(),
            Some(stray.id.as_str())
        );
    }
    // The same nesting as the identity's own map, however deep it goes.
    let cod = node(
        &g,
        NodeKind::Account,
        "Activision / Call of Duty Main Account",
    );
    assert_eq!(cod.parent_edge, Some(EdgeKind::LinkedLauncher));
    assert_eq!(node(&g, NodeKind::Game, "Call of Duty").depth, 2);
    // Nearest its root first.
    assert_eq!(prospects(&g), ["stray@example.com", "primary@example.com"]);
    // Two identities name the recovery address and the phone: each is drawn once.
    let labels: Vec<&str> = g.nodes.iter().map(|n| n.label.as_str()).collect();
    for once in ["recovery@example.com", "Pixel, ends 42"] {
        assert_eq!(labels.iter().filter(|l| **l == once).count(), 1);
    }
    // Nothing active uses these.
    for gone in ["Old", "old@example.com", "Epic Games Store"] {
        assert!(!labels.contains(&gone), "{gone} should not be drawn");
    }

    let capped = graph::overview(&v, Some(3)).unwrap();
    assert_well_formed(&capped);
    assert_eq!(capped.nodes.len(), 3);
    assert!(capped.truncated);
    for limit in [0, MAX_NODES + 1] {
        assert_eq!(
            graph::overview(&v, Some(limit)).unwrap_err(),
            AppError::InvalidInput { field: "limit" }
        );
    }
}

#[test]
fn demo_vault_maps_shared_emails_and_platforms() {
    let tmp = tempfile::tempdir().unwrap();
    let clock = ManualClock::default();
    let mut v = new_vault(tmp.path(), &clock);
    vaultair_core::demo::seed(&mut v, &clock).unwrap();
    let id_of = |sql: &str| -> String { v.conn().query_row(sql, [], |r| r.get(0)).unwrap() };

    let main = id_of("SELECT id FROM identity WHERE name = 'Main'");
    let g = graph::query(&v, &focus(FocusKind::Identity, &main), None, None).unwrap();
    assert_well_formed(&g);
    let kinds: HashSet<NodeKind> = g.nodes.iter().map(|n| n.kind).collect();
    // Every kind but one: the mailbox behind Main's email is in the vault.
    assert_eq!(kinds.len(), NodeKind::ALL.len() - 1);
    assert!(prospects(&g).is_empty());
    assert!(g.nodes.iter().all(|n| n.label != "Beta test account"));
    // The ranked address has accounts signing in with it and no mailbox account.
    let ranked = id_of("SELECT id FROM identity WHERE name = 'Competitive'");
    let g = graph::query(&v, &focus(FocusKind::Identity, &ranked), None, None).unwrap();
    assert_well_formed(&g);
    assert_eq!(prospects(&g), ["nightowl.ranked@example.com"]);
    let g = graph::query(&v, &focus(FocusKind::Identity, &main), None, None).unwrap();
    // Other identities' accounts recover through Main's email, so they're in reach.
    assert_eq!(node(&g, NodeKind::Account, "Community chat").depth, 2);

    // Three identities name this address: one as primary, two as recovery.
    let shared =
        id_of("SELECT id FROM contact_point WHERE value_normalized = 'nightowl@example.com'");
    let g = graph::query(&v, &focus(FocusKind::Contact, &shared), Some(1), None).unwrap();
    assert_well_formed(&g);
    let email = node(&g, NodeKind::Email, "nightowl@example.com");
    assert!(has_edge(
        &g,
        node(&g, NodeKind::Identity, "Main"),
        EdgeKind::PrimaryEmail,
        email
    ));
    for name in ["Competitive", "Creator"] {
        assert!(has_edge(
            &g,
            node(&g, NodeKind::Identity, name),
            EdgeKind::RecoveryEmail,
            email
        ));
    }
    assert!(has_edge(
        &g,
        email,
        EdgeKind::RecoveryEmail,
        node(&g, NodeKind::Account, "Arena ranked (EUW)")
    ));

    let g = graph::query(
        &v,
        &focus(FocusKind::Platform, "builtin-pl-riot"),
        Some(1),
        None,
    )
    .unwrap();
    let labels: Vec<&str> = g.nodes.iter().skip(1).map(|n| n.label.as_str()).collect();
    assert_eq!(labels, ["Arena alt", "Arena ranked (EUW)"]);
}
