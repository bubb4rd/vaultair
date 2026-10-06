//! Loads every link between active records, then keeps what is within reach
//! of the focus.
//!
//! Archived accounts are left out, with everything only they connect to.
//! The selects name ids, titles, icon slugs and enum text; no `*_enc`
//! column, fingerprint or strength score is read.

use std::collections::{HashMap, HashSet, VecDeque};

use rusqlite::Connection;

use crate::domain::graph::{
    EdgeKind, FocusKind, Graph, GraphEdge, GraphFocus, GraphNode, NodeKind,
};
use crate::domain::identity::{normalize_contact, ContactKind, ContactRole, IdentityColor};
use crate::domain::mfa::MfaMethod;
use crate::AppError;

/// The furthest a query may reach from its focus.
pub const MAX_DEPTH: u8 = 2;
/// The most nodes a query may return.
pub const MAX_NODES: u32 = 300;

struct Draft {
    id: String,
    kind: NodeKind,
    record_id: String,
    label: String,
    detail: Option<String>,
    icon: Option<String>,
    color: Option<IdentityColor>,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct Link {
    source: usize,
    target: usize,
    kind: EdgeKind,
}

#[derive(Default)]
struct Loaded {
    nodes: Vec<Draft>,
    index: HashMap<String, usize>,
    links: Vec<Link>,
    seen: HashSet<Link>,
}

fn node_id(kind: NodeKind, id: &str) -> String {
    format!("{}:{id}", kind.as_str())
}

impl Loaded {
    fn add(&mut self, kind: NodeKind, id: &str, label: String) -> usize {
        let node = node_id(kind, id);
        if let Some(&at) = self.index.get(&node) {
            return at;
        }
        let at = self.nodes.len();
        self.index.insert(node.clone(), at);
        self.nodes.push(Draft {
            id: node,
            kind,
            record_id: id.to_owned(),
            label,
            detail: None,
            icon: None,
            color: None,
        });
        at
    }

    fn find(&self, kind: NodeKind, id: &str) -> Option<usize> {
        self.index.get(&node_id(kind, id)).copied()
    }

    fn link(&mut self, source: usize, target: usize, kind: EdgeKind) {
        let link = Link {
            source,
            target,
            kind,
        };
        if source != target && self.seen.insert(link) {
            self.links.push(link);
        }
    }
}

/// The same wording as the account page (`MFA_METHODS` in `labels.ts`).
fn mfa_label(method: MfaMethod) -> &'static str {
    match method {
        MfaMethod::AuthenticatorApp => "Authenticator app",
        MfaMethod::Totp => "TOTP code",
        MfaMethod::HardwareKey => "Security key",
        MfaMethod::Sms => "Text message",
        MfaMethod::Email => "Email code",
        MfaMethod::RecoveryCodesOnly => "Recovery codes only",
        MfaMethod::Unknown => "Unknown",
    }
}

type AccountRow = (
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    String,
    Option<String>,
);

fn load_catalog(conn: &Connection, g: &mut Loaded) -> Result<(), AppError> {
    for (table, kind) in [("platform", NodeKind::Platform), ("game", NodeKind::Game)] {
        let mut stmt = conn.prepare(&format!("SELECT id, name, icon FROM {table}"))?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
        })?;
        for row in rows {
            let (id, name, icon) = row?;
            let at = g.add(kind, &id, name);
            g.nodes[at].icon = icon;
        }
    }
    Ok(())
}

/// Active accounts, with the edges to their platform and game. Returns each
/// account's identity for `load_identities`.
fn load_accounts(conn: &Connection, g: &mut Loaded) -> Result<Vec<(usize, String)>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.title, a.identity_id, a.platform_id, a.game_id, p.name,
                CASE WHEN a.account_type = 'game' THEN COALESCE(g.icon, pl.icon)
                     ELSE COALESCE(pl.icon, g.icon) END
         FROM account a
         JOIN purpose_label p ON p.id = a.purpose_id
         LEFT JOIN platform pl ON pl.id = a.platform_id
         LEFT JOIN game g ON g.id = a.game_id
         WHERE a.archived_at IS NULL",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get(0)?,
            r.get(1)?,
            r.get(2)?,
            r.get(3)?,
            r.get(4)?,
            r.get(5)?,
            r.get(6)?,
        ))
    })?;
    let mut owners = Vec::new();
    for row in rows {
        let (id, title, identity, platform, game, purpose, icon): AccountRow = row?;
        let at = g.add(NodeKind::Account, &id, title);
        g.nodes[at].detail = Some(purpose);
        g.nodes[at].icon = icon;
        if let Some(to) = platform.and_then(|p| g.find(NodeKind::Platform, &p)) {
            g.link(at, to, EdgeKind::OnPlatform);
        }
        if let Some(to) = game.and_then(|p| g.find(NodeKind::Game, &p)) {
            g.link(at, to, EdgeKind::Plays);
        }
        if let Some(identity) = identity {
            owners.push((at, identity));
        }
    }
    Ok(owners)
}

/// Emails and phones, and which active accounts sign in or recover through
/// them. Returns each contact's node by kind and normalized value.
fn load_contacts(
    conn: &Connection,
    g: &mut Loaded,
) -> Result<HashMap<(ContactKind, String), usize>, AppError> {
    let mut by_value = HashMap::new();
    let mut by_id = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT id, kind, COALESCE(value_display, value_normalized, ''), value_normalized
         FROM contact_point WHERE kind IN ('email', 'phone')",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, ContactKind>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, Option<String>>(3)?,
        ))
    })?;
    for row in rows {
        let (id, kind, display, normalized) = row?;
        let node = if kind == ContactKind::Email {
            NodeKind::Email
        } else {
            NodeKind::RecoveryMethod
        };
        let at = g.add(node, &id, display);
        by_id.insert(id, at);
        if let Some(value) = normalized {
            by_value.insert((kind, value), at);
        }
    }

    let mut stmt =
        conn.prepare("SELECT account_id, contact_point_id, role FROM account_contact")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, ContactRole>(2)?,
        ))
    })?;
    for row in rows {
        let (account, contact, role) = row?;
        let kind = match role {
            ContactRole::LoginEmail => EdgeKind::LoginEmail,
            ContactRole::RecoveryEmail => EdgeKind::RecoveryEmail,
            ContactRole::RecoveryPhone => EdgeKind::RecoveryPhone,
            ContactRole::Authenticator | ContactRole::HardwareKey | ContactRole::Other => continue,
        };
        // An archived account isn't loaded, so its links are skipped here.
        if let (Some(&from), Some(to)) = (by_id.get(&contact), g.find(NodeKind::Account, &account))
        {
            g.link(from, to, kind);
        }
    }
    Ok(by_value)
}

/// Identities, the accounts assigned to them, and the email and phone each
/// one names as its own. The contact is looked up by value: two identities
/// can name the same address, and `contact_point.identity_id` holds one.
fn load_identities(
    conn: &Connection,
    g: &mut Loaded,
    owners: &[(usize, String)],
    contacts: &HashMap<(ContactKind, String), usize>,
) -> Result<(), AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, primary_email, recovery_email, phone_ref FROM identity",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<IdentityColor>>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, Option<String>>(5)?,
        ))
    })?;
    for row in rows {
        let (id, name, color, primary, recovery, phone) = row?;
        let at = g.add(NodeKind::Identity, &id, name);
        g.nodes[at].color = color;
        let named = [
            (ContactKind::Email, primary, EdgeKind::PrimaryEmail),
            (ContactKind::Email, recovery, EdgeKind::RecoveryEmail),
            (ContactKind::Phone, phone, EdgeKind::Phone),
        ];
        let mut linked = HashSet::new();
        for (kind, value, edge) in named {
            let found = value.and_then(|v| contacts.get(&(kind, normalize_contact(&v))).copied());
            // One address as both primary and recovery is drawn once, as primary.
            if let Some(to) = found.filter(|to| linked.insert(*to)) {
                g.link(at, to, edge);
            }
        }
    }
    for (account, identity) in owners {
        if let Some(from) = g.find(NodeKind::Identity, identity) {
            g.link(from, *account, EdgeKind::Owns);
        }
    }
    Ok(())
}

/// Game profiles: the game an account plays, and the launcher or console
/// account a profile is linked to.
fn load_profiles(conn: &Connection, g: &mut Loaded) -> Result<(), AppError> {
    let mut stmt = conn.prepare(
        "SELECT account_id, game_id, linked_launcher_account_id, linked_console_account_id
         FROM game_profile",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
        ))
    })?;
    for row in rows {
        let (account, game, launcher, console) = row?;
        let Some(at) = g.find(NodeKind::Account, &account) else {
            continue;
        };
        if let Some(to) = g.find(NodeKind::Game, &game) {
            g.link(at, to, EdgeKind::Plays);
        }
        for (linked, kind) in [
            (launcher, EdgeKind::LinkedLauncher),
            (console, EdgeKind::LinkedConsole),
        ] {
            if let Some(from) = linked.and_then(|id| g.find(NodeKind::Account, &id)) {
                g.link(from, at, kind);
            }
        }
    }
    Ok(())
}

/// MFA methods that are turned on. Each opens its account.
fn load_mfa(conn: &Connection, g: &mut Loaded) -> Result<(), AppError> {
    let mut stmt =
        conn.prepare("SELECT id, account_id, method FROM mfa_method WHERE enabled = 1")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, MfaMethod>(2)?,
        ))
    })?;
    for row in rows {
        let (id, account, method) = row?;
        let Some(from) = g.find(NodeKind::Account, &account) else {
            continue;
        };
        let at = g.add(NodeKind::MfaMethod, &id, mfa_label(method).to_owned());
        g.nodes[at].record_id = account;
        g.link(from, at, EdgeKind::Mfa);
    }
    Ok(())
}

/// Prospective accounts: the mailbox behind an email that active accounts
/// sign in or recover with, when no email account signs in with that
/// address. An archived mailbox account counts as having one, so the same
/// mailbox isn't suggested twice. Suggestions the user discarded are skipped.
fn load_prospects(conn: &Connection, g: &mut Loaded) -> Result<(), AppError> {
    let mut stmt = conn.prepare(
        "SELECT c.id, COALESCE(c.value_display, c.value_normalized, '')
         FROM contact_point c
         WHERE c.kind = 'email' AND c.mailbox_dismissed_at IS NULL
           AND EXISTS (SELECT 1 FROM account_contact ac JOIN account a ON a.id = ac.account_id
                        WHERE ac.contact_point_id = c.id AND a.archived_at IS NULL
                          AND ac.role IN ('login_email', 'recovery_email'))
           AND NOT EXISTS (SELECT 1 FROM account_contact ac JOIN account a ON a.id = ac.account_id
                            WHERE ac.contact_point_id = c.id AND a.account_type = 'email'
                              AND ac.role = 'login_email')",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (id, address) = row?;
        let Some(from) = g.find(NodeKind::Email, &id) else {
            continue;
        };
        let at = g.add(NodeKind::ProspectiveAccount, &id, address);
        g.link(from, at, EdgeKind::Prospective);
    }
    Ok(())
}

fn load(conn: &Connection) -> Result<Loaded, AppError> {
    let mut g = Loaded::default();
    load_catalog(conn, &mut g)?;
    let owners = load_accounts(conn, &mut g)?;
    let contacts = load_contacts(conn, &mut g)?;
    load_identities(conn, &mut g, &owners, &contacts)?;
    load_profiles(conn, &mut g)?;
    load_mfa(conn, &mut g)?;
    load_prospects(conn, &mut g)?;
    Ok(g)
}

/// Which link a node hangs under in the tree when it has several: the most
/// specific first, and "assigned to this identity" last.
fn parent_rank(kind: EdgeKind) -> u8 {
    match kind {
        EdgeKind::LinkedLauncher | EdgeKind::LinkedConsole => 0,
        EdgeKind::LoginEmail | EdgeKind::PrimaryEmail => 1,
        EdgeKind::RecoveryEmail | EdgeKind::Phone => 2,
        EdgeKind::RecoveryPhone => 3,
        EdgeKind::OnPlatform | EdgeKind::Plays | EdgeKind::Mfa | EdgeKind::Prospective => 4,
        EdgeKind::Owns => 5,
    }
}

fn kind_rank(kind: NodeKind) -> usize {
    NodeKind::ALL
        .iter()
        .position(|k| *k == kind)
        .unwrap_or(usize::MAX)
}

fn focus_node(g: &Loaded, focus: &GraphFocus) -> Option<usize> {
    match focus.kind {
        FocusKind::Identity => g.find(NodeKind::Identity, &focus.id),
        FocusKind::Account => g.find(NodeKind::Account, &focus.id),
        FocusKind::Contact => g
            .find(NodeKind::Email, &focus.id)
            .or_else(|| g.find(NodeKind::RecoveryMethod, &focus.id)),
        FocusKind::Platform => g.find(NodeKind::Platform, &focus.id),
        FocusKind::Game => g.find(NodeKind::Game, &focus.id),
    }
}

/// Whether `node` is `ancestor` or hangs somewhere under it.
fn hangs_under(parents: &HashMap<usize, (usize, EdgeKind)>, node: usize, ancestor: usize) -> bool {
    let mut at = node;
    // A tree has no path longer than its node count.
    for _ in 0..=parents.len() {
        if at == ancestor {
            return true;
        }
        match parents.get(&at) {
            Some((up, _)) => at = *up,
            None => return false,
        }
    }
    true
}

fn checked_limit(limit: u32) -> Result<usize, AppError> {
    if limit == 0 || limit > MAX_NODES {
        return Err(AppError::InvalidInput { field: "limit" });
    }
    Ok(usize::try_from(limit).unwrap_or(usize::MAX))
}

/// The focus and everything within `depth` steps, nearest first, stopping at
/// `limit` nodes. An unknown focus (or an archived account) is `NotFound`;
/// a depth outside 1..=[`MAX_DEPTH`] or a limit outside 1..=[`MAX_NODES`] is
/// `InvalidInput`.
pub fn query(
    conn: &Connection,
    focus: &GraphFocus,
    depth: u8,
    limit: u32,
) -> Result<Graph, AppError> {
    if depth == 0 || depth > MAX_DEPTH {
        return Err(AppError::InvalidInput { field: "depth" });
    }
    let limit = checked_limit(limit)?;
    let g = load(conn)?;
    let root = focus_node(&g, focus).ok_or(AppError::NotFound)?;
    Ok(walk(&g, Some(root), depth, limit))
}

/// The whole vault, stopping at `limit` nodes: a tree under every identity,
/// then one under each email and account no identity reaches. Platforms and
/// games no active account uses are left out. A limit outside
/// 1..=[`MAX_NODES`] is `InvalidInput`.
pub fn overview(conn: &Connection, limit: u32) -> Result<Graph, AppError> {
    let limit = checked_limit(limit)?;
    let g = load(conn)?;
    Ok(walk(&g, None, u8::MAX, limit))
}

/// Walks out from `focus`, or with none from every identity at once and then
/// from whatever is still unreached, and hangs each node it keeps in a tree.
fn walk(g: &Loaded, focus: Option<usize>, depth: u8, limit: usize) -> Graph {
    // Neighbours in a fixed order, so the same vault always draws the same map.
    let mut near: Vec<Vec<(usize, Link)>> = vec![Vec::new(); g.nodes.len()];
    for link in &g.links {
        near[link.source].push((link.target, *link));
        near[link.target].push((link.source, *link));
    }
    for list in &mut near {
        list.sort_by_cached_key(|(to, link)| {
            let n = &g.nodes[*to];
            (parent_rank(link.kind), n.label.to_lowercase(), n.id.clone())
        });
    }

    // Where a walk may start. With no focus: identities, then emails
    // something uses, then accounts. Everything else worth drawing is linked
    // to one of those.
    let mut starts: VecDeque<usize> = VecDeque::new();
    let mut together = 1;
    match focus {
        Some(root) => starts.push_back(root),
        None => {
            let mut order: Vec<usize> = (0..g.nodes.len())
                .filter(|at| match g.nodes[*at].kind {
                    NodeKind::Identity | NodeKind::Account => true,
                    NodeKind::Email => !near[*at].is_empty(),
                    _ => false,
                })
                .collect();
            order.sort_by_cached_key(|at| {
                let n = &g.nodes[*at];
                (kind_rank(n.kind), n.label.to_lowercase(), n.id.clone())
            });
            // Identities set out together, so a shared record hangs under
            // the nearest one.
            together = order
                .iter()
                .filter(|at| g.nodes[**at].kind == NodeKind::Identity)
                .count()
                .max(1);
            starts.extend(order);
        }
    }

    let mut depths: HashMap<usize, u8> = HashMap::new();
    let mut kept = Vec::new();
    let mut queue = VecDeque::new();
    let mut truncated = false;
    loop {
        for _ in 0..together {
            let Some(root) = starts.pop_front() else {
                break;
            };
            if depths.contains_key(&root) {
                continue;
            }
            if kept.len() >= limit {
                truncated = true;
                continue;
            }
            depths.insert(root, 0);
            kept.push(root);
            queue.push_back(root);
        }
        together = 1;
        while let Some(at) = queue.pop_front() {
            let d = depths.get(&at).copied().unwrap_or(0);
            if d >= depth {
                continue;
            }
            for (to, _) in &near[at] {
                if depths.contains_key(to) {
                    continue;
                }
                if kept.len() >= limit {
                    truncated = true;
                    continue;
                }
                depths.insert(*to, d.saturating_add(1));
                kept.push(*to);
                queue.push_back(*to);
            }
        }
        if starts.is_empty() {
            break;
        }
    }

    // The tree: each node under its best link to a node one step nearer.
    let mut parents: HashMap<usize, (usize, EdgeKind)> = HashMap::new();
    for &at in &kept {
        let Some(d) = depths.get(&at).copied().filter(|d| *d > 0) else {
            continue;
        };
        let up = near[at]
            .iter()
            .find(|(to, _)| depths.get(to).copied() == Some(d - 1));
        if let Some((to, link)) = up {
            parents.insert(at, (*to, link.kind));
        }
    }
    // An account that is only "assigned to this identity" reads better under
    // the email it signs in with, and a linked account under its launcher or
    // console, when those are just as near. Emails are never moved, so the
    // first pass can't loop; the second checks before it moves anything.
    for &at in &kept {
        if !matches!(parents.get(&at), Some((_, EdgeKind::Owns))) {
            continue;
        }
        let email = near[at].iter().find(|(to, link)| {
            link.kind == EdgeKind::LoginEmail
                && link.target == at
                && depths.get(to) == depths.get(&at)
        });
        if let Some((to, link)) = email {
            parents.insert(at, (*to, link.kind));
        }
    }
    for &at in &kept {
        let linked = near[at].iter().find(|(to, link)| {
            matches!(
                link.kind,
                EdgeKind::LinkedLauncher | EdgeKind::LinkedConsole
            ) && link.target == at
                && depths.get(to) == depths.get(&at)
                && !hangs_under(&parents, *to, at)
        });
        if let Some((to, link)) = linked {
            parents.insert(at, (*to, link.kind));
        }
    }

    kept.sort_by_cached_key(|at| {
        let n = &g.nodes[*at];
        (
            depths.get(at).copied().unwrap_or(0),
            kind_rank(n.kind),
            n.label.to_lowercase(),
            n.id.clone(),
        )
    });
    let nodes = kept
        .iter()
        .map(|at| {
            let n = &g.nodes[*at];
            let parent = parents.get(at);
            GraphNode {
                id: n.id.clone(),
                kind: n.kind,
                record_id: n.record_id.clone(),
                label: n.label.clone(),
                detail: n.detail.clone(),
                icon: n.icon.clone(),
                color: n.color,
                depth: depths.get(at).copied().unwrap_or(0),
                parent: parent.map(|(up, _)| g.nodes[*up].id.clone()),
                parent_edge: parent.map(|(_, kind)| *kind),
            }
        })
        .collect();
    let mut edges: Vec<GraphEdge> = g
        .links
        .iter()
        .filter(|l| depths.contains_key(&l.source) && depths.contains_key(&l.target))
        .map(|l| {
            let (source, target) = (&g.nodes[l.source].id, &g.nodes[l.target].id);
            GraphEdge {
                id: format!("{source}>{}>{target}", l.kind.as_str()),
                source: source.clone(),
                target: target.clone(),
                kind: l.kind,
            }
        })
        .collect();
    edges.sort_by(|a, b| a.id.cmp(&b.id));

    Graph {
        focus: focus.map(|root| g.nodes[root].id.clone()),
        nodes,
        edges,
        truncated,
    }
}
