// Build scripts talk to Cargo through stdout, so printing is required here.
#![allow(clippy::disallowed_macros, clippy::print_stdout)]

fn main() {
    // Every app command must be listed here so it gets an explicit permission,
    // and the capability file has to allow it by name.
    let mut attrs =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "app_info",
            "vault_kdf_calibrate",
            "vault_create",
            "vault_unlock",
            "vault_lock",
            "vault_status",
            "vault_integrity_check",
            "vault_create_demo",
            "vault_location_check",
            "vault_pick_folder",
            "recent_vaults_list",
            "recent_vaults_forget",
            "strength_estimate",
            "generate_password",
            "generate_passphrase",
            "session_touch",
            "session_config_get",
            "capture_protection_set",
            "session_take_lock_notice",
            "clipboard_copy_plain",
            "clipboard_cancel_clear",
            "clipboard_clear_now",
            "account_list",
            "account_get",
            "account_create",
            "account_update",
            "account_archive",
            "account_unarchive",
            "account_set_favorite",
            "account_mark_verified",
            "account_dismiss_notes_suggestions",
            "account_delete",
            "account_duplicate_as_template",
            "account_url_target",
            "account_open_url",
            "purpose_list",
            "tag_list",
            "secret_reveal",
            "clipboard_copy_secret",
            "mfa_upsert",
            "mfa_delete",
            "mfa_set_backup_codes",
            "mfa_mark_code_used",
            "totp_current_code",
            "identity_list",
            "identity_refs",
            "identity_get",
            "identity_overview",
            "identity_create",
            "identity_update",
            "identity_archive",
            "identity_unarchive",
            "identity_delete",
            "identity_assign_accounts",
            "contact_point_list",
            "dashboard_summary",
            "platform_list",
            "platform_create",
            "platform_update",
            "game_list",
            "game_create",
            "game_update",
            "game_profile_list",
            "game_profile_create",
            "game_profile_update",
            "game_profile_delete",
        ]));

    // tauri-build only embeds the Windows manifest into the app binary, so test
    // binaries crash with STATUS_ENTRYPOINT_NOT_FOUND (no Common Controls v6).
    // Embed it through the linker instead, which covers every target.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        attrs =
            attrs.windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        let manifest =
            std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir"))
                .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }

    tauri_build::try_build(attrs).expect("failed to run tauri-build");
}
