//! Typed IPC surface. `bindings.ts` is generated from this list.

use tauri_specta::{collect_commands, collect_events, Builder};

use crate::{commands, events};

pub fn builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::app::app_info,
            commands::vault::vault_kdf_calibrate,
            commands::vault::vault_create,
            commands::vault::vault_unlock,
            commands::vault::vault_lock,
            commands::vault::vault_status,
            commands::vault::vault_integrity_check,
            commands::vault::vault_create_demo,
            commands::vault::vault_location_check,
            commands::vault::vault_pick_folder,
            commands::recent::recent_vaults_list,
            commands::recent::recent_vaults_forget,
            commands::password::strength_estimate,
            commands::generator::generate_password,
            commands::generator::generate_passphrase,
            commands::session::session_touch,
            commands::session::session_config_get,
            commands::session::capture_policy_set,
            commands::session::hide_emails_set,
            commands::session::capture_apply,
            commands::session::session_take_lock_notice,
            commands::clipboard::clipboard_copy_plain,
            commands::clipboard::clipboard_cancel_clear,
            commands::clipboard::clipboard_clear_now,
            commands::account::account_list,
            commands::account::account_get,
            commands::account::account_create,
            commands::account::account_update,
            commands::account::account_archive,
            commands::account::account_unarchive,
            commands::account::account_set_favorite,
            commands::account::account_mark_verified,
            commands::account::account_dismiss_notes_suggestions,
            commands::account::account_delete,
            commands::account::account_duplicate_as_template,
            commands::account::account_url_target,
            commands::account::account_open_url,
            commands::account::account_bulk_tag,
            commands::account::account_bulk_archive,
            commands::account::account_bulk_delete,
            commands::account::purpose_list,
            commands::purpose::purpose_create,
            commands::purpose::purpose_update,
            commands::purpose::purpose_set_hidden,
            commands::purpose::purpose_reorder,
            commands::purpose::purpose_delete,
            commands::account::tag_list,
            commands::secret::secret_reveal,
            commands::secret::clipboard_copy_secret,
            commands::mfa::mfa_upsert,
            commands::mfa::mfa_delete,
            commands::mfa::mfa_set_backup_codes,
            commands::mfa::mfa_mark_code_used,
            commands::mfa::totp_current_code,
            commands::identity::identity_list,
            commands::identity::identity_refs,
            commands::identity::identity_get,
            commands::identity::identity_overview,
            commands::identity::identity_create,
            commands::identity::identity_update,
            commands::identity::identity_archive,
            commands::identity::identity_unarchive,
            commands::identity::identity_delete,
            commands::identity::identity_assign_accounts,
            commands::identity::contact_point_list,
            commands::identity::dashboard_summary,
            commands::health::health_summary,
            commands::health::health_issues,
            commands::graph::graph_query,
            commands::graph::graph_overview,
            commands::graph::graph_prospect_set_dismissed,
            commands::catalog::platform_list,
            commands::catalog::platform_create,
            commands::catalog::platform_update,
            commands::catalog::game_list,
            commands::catalog::game_create,
            commands::catalog::game_update,
            commands::catalog::game_profile_list,
            commands::catalog::game_profile_create,
            commands::catalog::game_profile_update,
            commands::catalog::game_profile_delete,
            commands::search::search,
            commands::search::search_rebuild_index,
            commands::search::saved_view_list,
            commands::search::saved_view_create,
            commands::search::saved_view_update,
            commands::search::saved_view_delete,
            commands::backup::backup_status,
            commands::backup::backup_set_destination,
            commands::backup::backup_create,
            commands::backup::backup_verify,
            commands::backup::backup_pick_file,
            commands::backup::backup_restore_to,
            commands::settings::settings_get,
            commands::settings::settings_update,
            commands::settings::vault_profile_update,
            commands::settings::vault_change_password,
            commands::settings::vault_kdf_check,
            commands::settings::vault_strengthen_kdf,
            commands::settings::logs_folder,
            commands::settings::logs_open,
            commands::quick_unlock::quick_unlock_status,
            commands::quick_unlock::quick_unlock_enable,
            commands::quick_unlock::quick_unlock_unlock,
            commands::quick_unlock::quick_unlock_forget,
            commands::quick_unlock::quick_unlock_offer,
            commands::quick_unlock::quick_unlock_offer_dismiss,
            commands::quick_unlock::quick_unlock_enable_now,
            commands::session::tray_set,
        ])
        .events(collect_events![
            events::VaultLocked,
            events::ClipboardCleared
        ])
        // Error codes every command can reject with (see `vaultair_core::AppError`).
        .typ::<vaultair_core::ErrorCode>()
}

#[cfg(test)]
pub const BINDINGS_PATH: &str = "../src/ipc/bindings.ts";

#[cfg(test)]
pub fn export_config() -> specta_typescript::Typescript {
    specta_typescript::Typescript::default()
        .header("// @ts-nocheck\n/* eslint-disable */\n// Generated by tauri-specta from src-tauri/src/ipc.rs. Do not edit.")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regenerates the TS bindings. CI runs this test and then fails if the
    /// committed `bindings.ts` changed, so the frontend can't drift from Rust.
    #[test]
    fn export_bindings() {
        builder()
            .export(export_config(), BINDINGS_PATH)
            .expect("failed to export TS bindings");
    }

    /// Every command the bindings invoke. tauri-specta writes
    /// `__TAURI_INVOKE("name"` for a command that returns a `Result` and
    /// `__TAURI_INVOKE<T>("name"` for one that doesn't.
    fn invoked(text: &str) -> Vec<&str> {
        text.split("__TAURI_INVOKE")
            .skip(1)
            .filter_map(|rest| {
                let call = match rest.strip_prefix('<') {
                    Some(generic) => generic.split_once(">(")?.1,
                    None => rest.strip_prefix('(')?,
                };
                call.strip_prefix('"')?.split('"').next()
            })
            .collect()
    }

    /// A command the webview can call must be listed in `build.rs` (which
    /// generates its permission) and allowed in the main capability, or
    /// Tauri rejects it at runtime with "not allowed". Mocked frontend
    /// tests can't see that, so this checks every command in the bindings.
    #[test]
    fn every_command_is_allowed() {
        let bindings = std::fs::read_to_string(BINDINGS_PATH).expect("bindings.ts");
        let build = include_str!("../build.rs");
        let capability = include_str!("../capabilities/main.json");
        let commands = invoked(&bindings);
        assert!(
            commands.len() > 100,
            "found only {} commands",
            commands.len()
        );
        for cmd in commands {
            assert!(
                build.contains(&format!("\"{cmd}\"")),
                "{cmd} is missing from build.rs"
            );
            let allow = format!("\"allow-{}\"", cmd.replace('_', "-"));
            assert!(
                capability.contains(&allow),
                "{allow} is missing from capabilities/main.json"
            );
        }
    }

    /// Whether `line` names the type `name` (not a longer name containing it).
    fn names_type(line: &str, name: &str) -> bool {
        let is_ident = |c: char| c.is_alphanumeric() || c == '_';
        line.match_indices(name).any(|(i, _)| {
            !line[..i].chars().next_back().is_some_and(is_ident)
                && !line[i + name.len()..].chars().next().is_some_and(is_ident)
        })
    }

    /// The types that carry a secret value to the webview, and the only
    /// commands allowed to return each. A new command returning one, or a
    /// DTO that embeds one, fails here: widening how secrets leave Rust has
    /// to be a decision, not a side effect.
    #[test]
    fn secret_values_leave_only_through_the_reveal_commands() {
        const EGRESS: &[(&str, &[&str])] = &[
            ("RevealedSecret", &["secret_reveal"]),
            ("TotpCodeView", &["totp_current_code"]),
            ("Generated", &["generate_password", "generate_passphrase"]),
        ];
        let bindings = std::fs::read_to_string(BINDINGS_PATH).expect("bindings.ts");
        let code: Vec<&str> = bindings
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                !(t.starts_with("//") || t.starts_with("/*") || t.starts_with('*'))
            })
            .collect();

        for (ty, allowed) in EGRESS {
            let definition = format!("export type {ty} = ");
            assert!(
                code.iter().any(|l| l.starts_with(&definition)),
                "{ty} is no longer in the bindings; update this list"
            );
            let mut returned_by: Vec<&str> = Vec::new();
            for line in code
                .iter()
                .filter(|l| names_type(l, ty) && !l.starts_with(&definition))
            {
                let command = invoked(line);
                let returned = line.contains(&format!("typedError<{ty},"))
                    || line.contains(&format!("__TAURI_INVOKE<{ty}>("));
                assert!(
                    returned && command.len() == 1,
                    "{ty} is used outside a command's return type: {line}"
                );
                returned_by.extend(command);
            }
            returned_by.sort_unstable();
            let mut allowed = allowed.to_vec();
            allowed.sort_unstable();
            assert_eq!(returned_by, allowed, "commands returning {ty}");
        }

        // Backup codes, keys and the on-disk formats stay in the core: none
        // of them may ever get a TS type.
        for internal in [
            "BackupCode",
            "VaultKeys",
            "Dek",
            "DeviceSlot",
            "VaultHeader",
        ] {
            assert!(
                !code.iter().any(|l| names_type(l, internal)),
                "{internal} reached the bindings"
            );
        }
    }
}
