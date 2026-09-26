//! Identities: create, edit, archive, delete (reassigning or unassigning their
//! accounts), bulk account assignment, and the overview that shows what an
//! identity's accounts share and recover through.
//!
//! Every write runs in one transaction together with its search-index
//! updates. An account's search row includes its identity's name, so
//! renaming, deleting or reassigning also reindexes the affected accounts.

use std::collections::{BTreeMap, HashMap, HashSet};

use rusqlite::Connection;

use crate::clock::Clock;
use crate::db::repo::account as account_repo;
use crate::db::repo::identity::{self as repo, IdentityFields};
use crate::db::repo::{contact, new_id, tag};
use crate::domain::identity::{
    ContactKind, ContactPointView, ContactRole, Dependent, IdentityDeletePlan, IdentityDetail,
    IdentityInput, IdentityOverview, IdentityRef, IdentitySummary, MailboxSecurity,
    OverviewAccount, PlatformGroup, RecoveryDependency, SharedEmail,
};
use crate::domain::validation::{self as v, MAX_NOTES_CHARS, MAX_SHORT_CHARS, MAX_TITLE_CHARS};
use crate::vault::OpenVault;
use crate::AppError;

/// How many accounts one bulk assignment may touch.
pub const MAX_ASSIGN: usize = 1000;
const MAX_DESCRIPTION_CHARS: usize = 500;

fn not_found<T>(value: Option<T>) -> Result<T, AppError> {
    value.ok_or(AppError::NotFound)
}

// ---- Reads -------------------------------------------------------------------

/// Active identities, or archived ones.
pub fn list(vault: &OpenVault, archived: bool) -> Result<Vec<IdentitySummary>, AppError> {
    Ok(repo::summaries(vault.conn(), archived)?)
}

/// Active identities, for the account form and filters.
pub fn refs(vault: &OpenVault) -> Result<Vec<IdentityRef>, AppError> {
    Ok(repo::refs(vault.conn())?)
}

pub fn get(vault: &OpenVault, id: &str) -> Result<IdentityDetail, AppError> {
    not_found(repo::detail(vault.conn(), id)?)
}

/// Every contact point, with how many active accounts use each.
pub fn contacts(vault: &OpenVault) -> Result<Vec<ContactPointView>, AppError> {
    Ok(contact::list(vault.conn())?)
}

// ---- Validation --------------------------------------------------------------

fn validate(
    conn: &Connection,
    input: &IdentityInput,
    id: Option<&str>,
) -> Result<IdentityFields, AppError> {
    let name = v::required(&input.name, "name", MAX_TITLE_CHARS)?;
    // Names are how people tell identities apart (and pick one to reassign
    // accounts to), so two with the same name would only confuse.
    if repo::name_taken(conn, &name, id)? {
        return Err(AppError::InvalidInput { field: "name" });
    }
    Ok(IdentityFields {
        name,
        description: v::optional(
            input.description.as_deref(),
            "description",
            MAX_DESCRIPTION_CHARS,
        )?,
        primary_email: v::optional_email(input.primary_email.as_deref(), "primaryEmail")?,
        recovery_email: v::optional_email(input.recovery_email.as_deref(), "recoveryEmail")?,
        phone_ref: v::optional(input.phone_ref.as_deref(), "phoneRef", MAX_SHORT_CHARS)?,
        notes: v::optional_multiline(input.notes.as_deref(), "notes", MAX_NOTES_CHARS)?,
        color: input.color,
    })
}

/// Upserts the identity's own email and phone as contact points it declares.
fn sync_contacts(
    conn: &Connection,
    id: &str,
    f: &IdentityFields,
    now: &str,
) -> Result<(), AppError> {
    let declared = [
        (ContactKind::Email, f.primary_email.as_deref()),
        (ContactKind::Email, f.recovery_email.as_deref()),
        (ContactKind::Phone, f.phone_ref.as_deref()),
    ];
    let mut ids = Vec::new();
    for (kind, value) in declared {
        if let Some(value) = value {
            ids.push(contact::upsert(conn, kind, value, now)?);
        }
    }
    contact::set_identity_claims(conn, id, &ids)?;
    contact::prune_unused(conn)?;
    Ok(())
}

fn reindex_accounts(conn: &Connection, ids: &[String]) -> Result<(), AppError> {
    for id in ids {
        account_repo::reindex(conn, id)?;
    }
    Ok(())
}

// ---- Writes ------------------------------------------------------------------

pub fn create(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    input: &IdentityInput,
) -> Result<IdentityDetail, AppError> {
    let now = clock.now_rfc3339();
    let id = new_id();
    let tx = vault.conn_mut().transaction()?;
    let fields = validate(&tx, input, None)?;
    let tags = v::tags(&input.tags)?;
    repo::insert(&tx, &id, &fields, &now)?;
    tag::set_for_identity(&tx, &id, &tags)?;
    sync_contacts(&tx, &id, &fields, &now)?;
    repo::reindex(&tx, &id)?;
    tx.commit()?;
    tracing::info!(identity = %id, "identity created");
    get(vault, &id)
}

pub fn update(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    id: &str,
    input: &IdentityInput,
) -> Result<IdentityDetail, AppError> {
    let now = clock.now_rfc3339();
    let tx = vault.conn_mut().transaction()?;
    let fields = validate(&tx, input, Some(id))?;
    let tags = v::tags(&input.tags)?;
    if !repo::update_fields(&tx, id, &fields, &now)? {
        return Err(AppError::NotFound);
    }
    tag::set_for_identity(&tx, id, &tags)?;
    tag::prune_unused(&tx)?;
    sync_contacts(&tx, id, &fields, &now)?;
    repo::reindex(&tx, id)?;
    reindex_accounts(&tx, &repo::account_ids(&tx, id)?)?;
    tx.commit()?;
    tracing::info!(identity = %id, "identity updated");
    get(vault, id)
}

/// Archiving hides the identity from pickers and the list; its accounts
/// keep it.
pub fn set_archived(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    id: &str,
    archived: bool,
) -> Result<IdentityDetail, AppError> {
    let now = clock.now_rfc3339();
    let archived_at = archived.then_some(now.as_str());
    if !repo::set_archived(vault.conn(), id, archived_at, &now)? {
        return Err(AppError::NotFound);
    }
    tracing::info!(identity = %id, archived, "identity archive state changed");
    get(vault, id)
}

/// Permanently deletes an identity. `confirm_name` must match its name (the
/// UI makes the user type it). Its accounts are kept: they move to another
/// identity or are left without one, as `plan` says. Contact points it
/// declared are released, and removed if nothing else uses them.
pub fn delete(
    vault: &mut OpenVault,
    id: &str,
    confirm_name: &str,
    plan: &IdentityDeletePlan,
) -> Result<(), AppError> {
    let tx = vault.conn_mut().transaction()?;
    let name = not_found(repo::name(&tx, id)?)?;
    if confirm_name.trim() != name.trim() {
        return Err(AppError::InvalidInput {
            field: "confirmName",
        });
    }
    let accounts = repo::account_ids(&tx, id)?;
    if let IdentityDeletePlan::Reassign {
        identity_id: target,
    } = plan
    {
        if target == id || repo::archived(&tx, target)? != Some(false) {
            return Err(AppError::InvalidInput {
                field: "identityId",
            });
        }
        for account in &accounts {
            repo::set_account_identity(&tx, account, Some(target))?;
        }
    }
    // Unassign: `ON DELETE SET NULL` clears the accounts' identity_id.
    repo::delete(&tx, id)?;
    reindex_accounts(&tx, &accounts)?;
    tag::prune_unused(&tx)?;
    contact::prune_unused(&tx)?;
    tx.commit()?;
    tracing::info!(
        identity = %id,
        accounts = accounts.len(),
        reassigned = matches!(plan, IdentityDeletePlan::Reassign { .. }),
        "identity deleted"
    );
    Ok(())
}

/// Assigns accounts to an identity in bulk, or with `None` removes them from
/// whatever identity they had. Returns how many accounts changed.
pub fn assign_accounts(
    vault: &mut OpenVault,
    identity_id: Option<&str>,
    account_ids: &[String],
) -> Result<u32, AppError> {
    const FIELD: &str = "accountIds";
    if account_ids.is_empty() || account_ids.len() > MAX_ASSIGN {
        return Err(AppError::InvalidInput { field: FIELD });
    }
    let tx = vault.conn_mut().transaction()?;
    if let Some(target) = identity_id {
        if repo::archived(&tx, target)? != Some(false) {
            return Err(AppError::InvalidInput {
                field: "identityId",
            });
        }
    }
    let mut changed = 0u32;
    let mut seen = HashSet::new();
    for account in account_ids {
        if !seen.insert(account.as_str()) {
            continue;
        }
        let Some(current) = repo::account_identity(&tx, account)? else {
            return Err(AppError::InvalidInput { field: FIELD });
        };
        if current.as_deref() == identity_id {
            continue;
        }
        repo::set_account_identity(&tx, account, identity_id)?;
        account_repo::reindex(&tx, account)?;
        changed += 1;
    }
    tx.commit()?;
    tracing::info!(
        accounts = changed,
        assigned = identity_id.is_some(),
        "accounts reassigned"
    );
    Ok(changed)
}

// ---- Overview ----------------------------------------------------------------

fn title_order(a: &OverviewAccount, b: &OverviewAccount) -> std::cmp::Ordering {
    a.title
        .to_lowercase()
        .cmp(&b.title.to_lowercase())
        .then_with(|| a.id.cmp(&b.id))
}

fn mailbox_rank(m: MailboxSecurity) -> u8 {
    match m {
        MailboxSecurity::NoMfa => 0,
        MailboxSecurity::NotInVault => 1,
        MailboxSecurity::NotApplicable => 2,
        MailboxSecurity::MfaOn => 3,
    }
}

/// Accounts that could be reset through one contact point, and whether its
/// mailbox has MFA. The mailbox itself signs in with the address rather than
/// depending on it, so it's left out of the dependents. `None` if nothing
/// depends on it.
fn dependency(
    conn: &Connection,
    view: &ContactPointView,
    links: &[(String, ContactRole)],
    accounts: &HashMap<String, OverviewAccount>,
) -> Result<Option<RecoveryDependency>, AppError> {
    let mailbox_accounts = if view.kind == ContactKind::Email {
        repo::mailbox_accounts(conn, &view.id)?
    } else {
        Vec::new()
    };
    let mailbox_ids: HashSet<&str> = mailbox_accounts.iter().map(|a| a.id.as_str()).collect();
    let mut dependents: Vec<Dependent> = Vec::new();
    // One entry per account, preferring the login role.
    for role in [
        ContactRole::LoginEmail,
        ContactRole::RecoveryEmail,
        ContactRole::RecoveryPhone,
    ] {
        for (account, r) in links {
            if *r != role
                || mailbox_ids.contains(account.as_str())
                || dependents.iter().any(|d| &d.account.id == account)
            {
                continue;
            }
            if let Some(a) = accounts.get(account) {
                dependents.push(Dependent {
                    account: a.clone(),
                    role,
                });
            }
        }
    }
    if dependents.is_empty() {
        return Ok(None);
    }
    dependents.sort_by(|a, b| title_order(&a.account, &b.account));
    let mailbox = if view.kind != ContactKind::Email {
        MailboxSecurity::NotApplicable
    } else if mailbox_accounts.is_empty() {
        MailboxSecurity::NotInVault
    } else if mailbox_accounts.iter().all(|a| a.mfa_enabled) {
        MailboxSecurity::MfaOn
    } else {
        MailboxSecurity::NoMfa
    };
    Ok(Some(RecoveryDependency {
        contact: view.clone(),
        mailbox,
        mailbox_accounts,
        dependents,
    }))
}

/// Groups accounts by platform (or publisher), case-insensitively and
/// alphabetically; accounts without one go in a last group.
fn group_by_platform(rows: Vec<(OverviewAccount, Option<String>)>) -> Vec<PlatformGroup> {
    let mut groups: BTreeMap<String, PlatformGroup> = BTreeMap::new();
    let mut ungrouped: Vec<OverviewAccount> = Vec::new();
    for (account, platform) in rows {
        match platform {
            Some(name) => groups
                .entry(name.to_lowercase())
                .or_insert_with(|| PlatformGroup {
                    platform: Some(name),
                    accounts: Vec::new(),
                })
                .accounts
                .push(account),
            None => ungrouped.push(account),
        }
    }
    let mut groups: Vec<PlatformGroup> = groups.into_values().collect();
    if !ungrouped.is_empty() {
        groups.push(PlatformGroup {
            platform: None,
            accounts: ungrouped,
        });
    }
    groups
}

/// What the identity page shows: its accounts grouped by platform, the
/// emails they share, their recovery methods, and the recovery dependencies
/// (which accounts could be reset through which email or phone, and whether
/// that mailbox has MFA). Archived accounts are left out.
pub fn overview(vault: &OpenVault, id: &str) -> Result<IdentityOverview, AppError> {
    let conn = vault.conn();
    let identity = not_found(repo::detail(conn, id)?)?;
    let rows = repo::overview_accounts(conn, id)?;
    let account_count = u32::try_from(rows.len()).unwrap_or(u32::MAX);
    let accounts: HashMap<String, OverviewAccount> = rows
        .iter()
        .map(|(a, _)| (a.id.clone(), a.clone()))
        .collect();
    let groups = group_by_platform(rows);
    let platforms: Vec<String> = groups.iter().filter_map(|g| g.platform.clone()).collect();

    let mut per_contact: BTreeMap<String, Vec<(String, ContactRole)>> = BTreeMap::new();
    for (account, cid, role) in repo::contact_links(conn, id)? {
        per_contact.entry(cid).or_default().push((account, role));
    }

    let mut shared_emails = Vec::new();
    let mut recovery_methods = Vec::new();
    let mut dependencies = Vec::new();
    for (cid, links) in &per_contact {
        let view = not_found(contact::view(conn, cid)?)?;
        if view.kind == ContactKind::Email {
            let ids: HashSet<&String> = links.iter().map(|(a, _)| a).collect();
            let mut users: Vec<OverviewAccount> = ids
                .into_iter()
                .filter_map(|a| accounts.get(a).cloned())
                .collect();
            users.sort_by(title_order);
            shared_emails.push(SharedEmail {
                contact: view.clone(),
                accounts: users,
            });
        }
        if links
            .iter()
            .any(|(_, r)| matches!(r, ContactRole::RecoveryEmail | ContactRole::RecoveryPhone))
        {
            recovery_methods.push(view.clone());
        }
        if let Some(dep) = dependency(conn, &view, links, &accounts)? {
            dependencies.push(dep);
        }
    }

    shared_emails.sort_by(|a, b| {
        b.contact
            .account_count
            .cmp(&a.contact.account_count)
            .then_with(|| a.contact.value.cmp(&b.contact.value))
    });
    recovery_methods.sort_by(|a, b| {
        (a.kind != ContactKind::Email)
            .cmp(&(b.kind != ContactKind::Email))
            .then_with(|| a.value.to_lowercase().cmp(&b.value.to_lowercase()))
    });
    dependencies.sort_by(|a, b| {
        mailbox_rank(a.mailbox)
            .cmp(&mailbox_rank(b.mailbox))
            .then_with(|| b.dependents.len().cmp(&a.dependents.len()))
            .then_with(|| a.contact.value.cmp(&b.contact.value))
    });

    Ok(IdentityOverview {
        identity,
        account_count,
        groups,
        platforms,
        shared_emails,
        recovery_methods,
        dependencies,
    })
}
