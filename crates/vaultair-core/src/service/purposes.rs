//! Purpose labels: add, rename and recolour, hide, reorder, and delete
//! (moving the accounts that use one onto another label first).
//!
//! An account's search row includes its purpose's name, so renaming a label
//! or moving accounts off one reindexes them in the same transaction.
//! Built-ins can be hidden, recoloured and reordered, but keep their name
//! and can't be deleted: the High-priority view and the dashboard match on
//! their slugs. At least one purpose always stays visible, so the account
//! form always has something to offer.

use std::collections::HashSet;

use rusqlite::Connection;

use crate::clock::Clock;
use crate::db::repo::purpose as repo;
use crate::db::repo::{account as account_repo, new_id, saved_view};
use crate::domain::account::{PurposeInput, PurposeView};
use crate::domain::validation as v;
use crate::vault::OpenVault;
use crate::AppError;

pub const MAX_NAME_CHARS: usize = 40;

fn not_found<T>(value: Option<T>) -> Result<T, AppError> {
    value.ok_or(AppError::NotFound)
}

/// Every purpose, hidden ones included, in display order.
pub fn list(vault: &OpenVault) -> Result<Vec<PurposeView>, AppError> {
    Ok(repo::list(vault.conn())?)
}

/// Lowercase ASCII letters and digits, with single hyphens between runs:
/// "Tournament 2026!" is `tournament-2026`. A name with no ASCII letters or
/// digits gets `custom`.
pub fn slug_of(name: &str) -> String {
    let mut slug = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_end_matches('-');
    if slug.is_empty() {
        "custom".to_owned()
    } else {
        slug.to_owned()
    }
}

/// `slug_of(name)`, with `-2`, `-3`... added until no label has it.
fn unique_slug(conn: &Connection, name: &str) -> Result<String, AppError> {
    let base = slug_of(name);
    let mut slug = base.clone();
    let mut n = 2u32;
    while repo::slug_taken(conn, &slug)? {
        slug = format!("{base}-{n}");
        n += 1;
    }
    Ok(slug)
}

/// Names tell labels apart in pickers and badges, so two labels can't share
/// one (ignoring case), hidden ones included.
fn validate_name(
    conn: &Connection,
    input: &PurposeInput,
    id: Option<&str>,
) -> Result<String, AppError> {
    let name = v::required(&input.name, "name", MAX_NAME_CHARS)?;
    if repo::name_taken(conn, &name, id)? {
        return Err(AppError::InvalidInput { field: "name" });
    }
    Ok(name)
}

fn reindex_accounts(conn: &Connection, ids: &[String]) -> Result<(), AppError> {
    for id in ids {
        account_repo::reindex(conn, id)?;
    }
    Ok(())
}

pub fn create(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    input: &PurposeInput,
) -> Result<PurposeView, AppError> {
    let now = clock.now_rfc3339();
    let id = new_id();
    let tx = vault.conn_mut().transaction()?;
    let name = validate_name(&tx, input, None)?;
    let slug = unique_slug(&tx, &name)?;
    repo::insert(&tx, &id, &slug, &name, input.color, &now)?;
    tx.commit()?;
    tracing::info!(purpose = %id, "purpose created");
    not_found(repo::get(vault.conn(), &id)?)
}

/// Renames and recolours a label. A built-in only changes colour: sending
/// any other name is rejected.
pub fn update(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    id: &str,
    input: &PurposeInput,
) -> Result<PurposeView, AppError> {
    let now = clock.now_rfc3339();
    let tx = vault.conn_mut().transaction()?;
    let current = not_found(repo::get(&tx, id)?)?;
    let name = validate_name(&tx, input, Some(id))?;
    if current.is_builtin && name != current.name {
        return Err(AppError::InvalidInput { field: "name" });
    }
    repo::update(&tx, id, &name, input.color, &now)?;
    if name != current.name {
        reindex_accounts(&tx, &repo::account_ids(&tx, id)?)?;
    }
    tx.commit()?;
    tracing::info!(purpose = %id, "purpose updated");
    not_found(repo::get(vault.conn(), id)?)
}

/// Hiding stops a label being offered for new picks; accounts that use it
/// keep it. The last visible label can't be hidden.
pub fn set_hidden(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    id: &str,
    hidden: bool,
) -> Result<PurposeView, AppError> {
    let now = clock.now_rfc3339();
    let tx = vault.conn_mut().transaction()?;
    let current = not_found(repo::get(&tx, id)?)?;
    if hidden && !current.is_hidden && repo::visible_count(&tx, id)? == 0 {
        return Err(AppError::InvalidInput {
            field: "lastVisible",
        });
    }
    repo::set_hidden(&tx, id, hidden, &now)?;
    tx.commit()?;
    tracing::info!(purpose = %id, hidden, "purpose visibility changed");
    not_found(repo::get(vault.conn(), id)?)
}

/// Puts every label in the order of `ids`, which must name each one exactly
/// once. Returns the reordered list.
pub fn reorder(vault: &mut OpenVault, ids: &[String]) -> Result<Vec<PurposeView>, AppError> {
    let tx = vault.conn_mut().transaction()?;
    let existing: HashSet<String> = repo::ids(&tx)?.into_iter().collect();
    let given: HashSet<&String> = ids.iter().collect();
    if ids.len() != existing.len()
        || given.len() != ids.len()
        || !ids.iter().all(|id| existing.contains(id))
    {
        return Err(AppError::InvalidInput { field: "ids" });
    }
    for (order, id) in ids.iter().enumerate() {
        repo::set_sort_order(&tx, id, i64::try_from(order).unwrap_or(i64::MAX))?;
    }
    tx.commit()?;
    tracing::info!(count = ids.len(), "purposes reordered");
    list(vault)
}

/// Saved views that filter on a deleted label filter on its replacement
/// instead, or drop it when nothing replaced it.
fn retarget_views(
    conn: &Connection,
    from: &str,
    to: Option<&str>,
    now: &str,
) -> Result<(), AppError> {
    for mut view in saved_view::list(conn)? {
        let ids = &view.spec.filter.purpose_ids;
        if view.is_builtin || !ids.iter().any(|p| p == from) {
            continue;
        }
        let mut next: Vec<String> = Vec::with_capacity(ids.len());
        for p in ids {
            let p = if p == from { to } else { Some(p.as_str()) };
            if let Some(p) = p {
                if !next.iter().any(|n| n == p) {
                    next.push(p.to_owned());
                }
            }
        }
        view.spec.filter.purpose_ids = next;
        saved_view::update(conn, &view.id, &view.name, &view.spec, now)?;
    }
    Ok(())
}

/// Deletes a custom label. Accounts that use it (archived ones too) move to
/// `reassign_to`, which must be another visible label; it's required when
/// any account uses it. Built-ins can only be hidden.
pub fn delete(
    vault: &mut OpenVault,
    clock: &dyn Clock,
    id: &str,
    reassign_to: Option<&str>,
) -> Result<(), AppError> {
    const TARGET: &str = "reassignTo";
    let now = clock.now_rfc3339();
    let tx = vault.conn_mut().transaction()?;
    let current = not_found(repo::get(&tx, id)?)?;
    if current.is_builtin {
        return Err(AppError::InvalidInput { field: "isBuiltin" });
    }
    let target = match reassign_to.map(str::trim) {
        None | Some("") => None,
        Some(t) => match repo::get(&tx, t)? {
            Some(p) if p.id != id && !p.is_hidden => Some(p.id),
            _ => return Err(AppError::InvalidInput { field: TARGET }),
        },
    };
    let accounts = repo::account_ids(&tx, id)?;
    if !accounts.is_empty() && target.is_none() {
        return Err(AppError::InvalidInput { field: TARGET });
    }
    if !current.is_hidden && repo::visible_count(&tx, id)? == 0 {
        return Err(AppError::InvalidInput {
            field: "lastVisible",
        });
    }
    if let Some(target) = target.as_deref() {
        repo::reassign_accounts(&tx, id, target)?;
    }
    retarget_views(&tx, id, target.as_deref(), &now)?;
    repo::delete(&tx, id)?;
    reindex_accounts(&tx, &accounts)?;
    tx.commit()?;
    tracing::info!(
        purpose = %id,
        accounts = accounts.len(),
        "purpose deleted"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::slug_of;

    #[test]
    fn slugs_are_lowercase_ascii_with_single_hyphens() {
        assert_eq!(slug_of("Tournament"), "tournament");
        assert_eq!(slug_of("  Pro  Team (EU) 2026! "), "pro-team-eu-2026");
        assert_eq!(slug_of("Café crew"), "caf-crew");
        assert_eq!(slug_of("日本"), "custom");
        assert_eq!(slug_of("--"), "custom");
    }
}
