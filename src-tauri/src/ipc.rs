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

    /// The bindings as `builder()` generates them now, written to a scratch
    /// file. The tests below read these, never `bindings.ts` on disk, which
    /// `export_bindings` may be rewriting at the same moment.
    fn generated_bindings() -> String {
        let dir = tempfile::tempdir().expect("scratch folder");
        let path = dir.path().join("bindings.ts");
        builder()
            .export(export_config(), &path)
            .expect("failed to export TS bindings");
        std::fs::read_to_string(&path).expect("generated bindings")
    }

    /// One command as the bindings call it.
    struct Call<'a> {
        name: &'a str,
        /// What it resolves to, as generated (`VaultInfo`, `string | null`).
        returns: String,
    }

    /// A generated type with its doc comments dropped and its whitespace
    /// collapsed, so it compares the same however it was wrapped.
    fn squash(ty: &str) -> String {
        let mut rest = ty;
        let mut out = String::new();
        while let Some((before, after)) = rest.split_once("/**") {
            out.push_str(before);
            rest = after.split_once("*/").map_or("", |(_, tail)| tail);
        }
        out.push_str(rest);
        out.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    /// Every command the bindings invoke. tauri-specta writes
    /// `typedError<T, IpcError_Serialize>(__TAURI_INVOKE("name"` for a
    /// command that returns a `Result` and `__TAURI_INVOKE<T>("name"` for
    /// one that doesn't; `T` can run over several lines.
    fn calls(text: &str) -> Vec<Call<'_>> {
        const RESULT_START: &str = "typedError<";
        const RESULT_END: &str = ", IpcError_Serialize>(";
        let parts: Vec<&str> = text.split("__TAURI_INVOKE").collect();
        parts
            .windows(2)
            .filter_map(|pair| {
                let (before, rest) = (pair[0], pair[1]);
                let (returns, call) = match rest.strip_prefix('<') {
                    Some(generic) => generic.split_once(">(")?,
                    None => {
                        let call = rest.strip_prefix('(')?;
                        let wrapped = before.strip_suffix(RESULT_END)?;
                        let at = wrapped.rfind(RESULT_START)? + RESULT_START.len();
                        (&wrapped[at..], call)
                    }
                };
                Some(Call {
                    name: call.strip_prefix('"')?.split('"').next()?,
                    returns: squash(returns),
                })
            })
            .collect()
    }

    /// Every command in `text`, with proof that none was skipped: each
    /// `__TAURI_INVOKE` except the `import` that defines it is one command.
    fn all_calls(text: &str) -> Vec<Call<'_>> {
        let found = calls(text);
        let sites = text.matches("__TAURI_INVOKE").count() - 1;
        assert_eq!(
            found.len(),
            sites,
            "a command in the bindings has a shape `calls` doesn't read"
        );
        found
    }

    /// Every command and what it returns, as reviewed. Adding a command, or
    /// changing what one returns, fails here until `ipc-surface.snap` is
    /// updated, which puts the change in front of a reviewer as one line:
    /// a new command returning a bare `string` can't arrive unnoticed.
    ///
    /// To accept a change, run this test with `VAULTAIR_UPDATE_IPC_SURFACE=1`
    /// and commit the file.
    ///
    /// It sees return types by name only. A field added to an existing
    /// response (`password: string` on `AccountDetail`) changes no line
    /// here; that shows in the `bindings.ts` diff and, for responses built
    /// from a vault's records, in the canary tests.
    #[test]
    fn the_command_surface_is_the_reviewed_one() {
        const SNAPSHOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/ipc-surface.snap");
        let bindings = generated_bindings();
        let mut surface: Vec<String> = all_calls(&bindings)
            .iter()
            .map(|c| format!("{} -> {}", c.name, c.returns))
            .collect();
        surface.sort_unstable();

        if std::env::var("VAULTAIR_UPDATE_IPC_SURFACE").as_deref() == Ok("1") {
            std::fs::write(SNAPSHOT, surface.join("\n") + "\n").expect("write ipc-surface.snap");
        }
        let reviewed = std::fs::read_to_string(SNAPSHOT).expect("ipc-surface.snap");
        let reviewed: Vec<&str> = reviewed.lines().map(str::trim_end).collect();
        let unreviewed: Vec<&String> = surface
            .iter()
            .filter(|line| !reviewed.contains(&line.as_str()))
            .collect();
        assert!(
            unreviewed.is_empty(),
            "not in ipc-surface.snap (a new command, or a new return type): {unreviewed:#?}"
        );
        let gone: Vec<&&str> = reviewed
            .iter()
            .filter(|line| !surface.iter().any(|s| s == **line))
            .collect();
        assert!(
            gone.is_empty(),
            "in ipc-surface.snap but no longer generated: {gone:#?}"
        );
    }

    /// A command the webview can call must be listed in `build.rs` (which
    /// generates its permission) and allowed in the main capability, or
    /// Tauri rejects it at runtime with "not allowed". Mocked frontend
    /// tests can't see that, so this checks every command in the bindings.
    #[test]
    fn every_command_is_allowed() {
        let bindings = generated_bindings();
        let build = include_str!("../build.rs");
        let capability = include_str!("../capabilities/main.json");
        for cmd in all_calls(&bindings).iter().map(|c| c.name) {
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

    /// The three response types that exist to carry a secret value, and the
    /// only commands allowed to return each. It fails when another command
    /// returns one of them or another response embeds one, and when a
    /// core-only type (backup codes, keys, on-disk formats) gets a TS type.
    ///
    /// It knows those names and nothing else. It can't tell that some other
    /// type, a bare `string`, or a new field on an existing response holds
    /// a secret. `the_command_surface_is_the_reviewed_one` makes a new or
    /// re-typed command visible; a new field still takes a reviewer.
    #[test]
    fn secret_values_leave_only_through_the_reveal_commands() {
        const EGRESS: &[(&str, &[&str])] = &[
            ("RevealedSecret", &["secret_reveal"]),
            ("TotpCodeView", &["totp_current_code"]),
            ("Generated", &["generate_password", "generate_passphrase"]),
        ];
        let bindings = generated_bindings();
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
                let command: Vec<&str> = calls(line).iter().map(|c| c.name).collect();
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
