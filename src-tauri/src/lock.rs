//! Every way the vault locks goes through [`Locker`]: the lock button and
//! Ctrl+L, the idle timer, and OS events (Win+L, sleep, sign-out, minimize).
//! Locking closes the vault, clears our clipboard value and tells the UI.

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;

use vaultair_core::service::session::{SessionConfig, SessionManager};
use vaultair_platform::SessionEvent;

use crate::clipboard::ClipboardService;

/// How often the idle deadline is checked. The deadline itself lives in
/// `SessionManager`; this only bounds how late the lock can be.
const IDLE_CHECK: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockReason {
    Manual,
    Idle,
    Os(SessionEvent),
    /// The window was closed to the tray. The user did it, so the lock
    /// screen has nothing to explain.
    Tray,
    /// The app is closing; there's no UI left to tell.
    Exit,
}

/// Why the vault last locked, for the lock screen to explain after the
/// webview reloads. Taken once (`session_take_lock_notice`), so a later
/// reload doesn't repeat it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "reason", rename_all = "camelCase")]
pub enum LockNotice {
    /// The lock button or Ctrl+L.
    Manual,
    #[serde(rename_all = "camelCase")]
    Idle {
        after_secs: u32,
    },
    SessionLocked,
    SignedOut,
    Disconnected,
    Sleep,
    Minimized,
}

impl LockNotice {
    fn for_reason(reason: LockReason, config: &SessionConfig) -> Option<Self> {
        Some(match reason {
            LockReason::Manual => Self::Manual,
            LockReason::Idle => Self::Idle {
                after_secs: config.idle_lock_secs.unwrap_or(0),
            },
            LockReason::Os(SessionEvent::SessionLocked) => Self::SessionLocked,
            LockReason::Os(SessionEvent::SessionLoggedOff) => Self::SignedOut,
            LockReason::Os(SessionEvent::Disconnected) => Self::Disconnected,
            LockReason::Os(SessionEvent::Suspending) => Self::Sleep,
            LockReason::Os(SessionEvent::Minimized) => Self::Minimized,
            LockReason::Os(SessionEvent::ShuttingDown) | LockReason::Tray | LockReason::Exit => {
                return None
            }
        })
    }
}

/// Whether `event` locks the vault under `config`.
pub fn should_lock(config: &SessionConfig, event: SessionEvent) -> bool {
    match event {
        SessionEvent::SessionLocked
        | SessionEvent::SessionLoggedOff
        | SessionEvent::Disconnected => config.lock_on_session_lock,
        SessionEvent::Suspending => config.lock_on_sleep,
        SessionEvent::Minimized => config.lock_on_minimize,
        // The process is about to end: always close the vault and clear.
        SessionEvent::ShuttingDown => true,
    }
}

pub struct Locker {
    session: Arc<SessionManager>,
    clipboard: Arc<ClipboardService>,
    config: Mutex<SessionConfig>,
    notice: Mutex<Option<LockNotice>>,
    /// Sets window capture affinity. Used to return to the steady policy on lock.
    apply_capture: Box<dyn Fn(bool) + Send + Sync>,
    /// Tells the UI (emits `vault://locked`).
    on_locked: Box<dyn Fn() + Send + Sync>,
}

impl std::fmt::Debug for Locker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Locker").finish_non_exhaustive()
    }
}

impl Locker {
    pub fn new(
        session: Arc<SessionManager>,
        clipboard: Arc<ClipboardService>,
        config: SessionConfig,
        apply_capture: impl Fn(bool) + Send + Sync + 'static,
        on_locked: impl Fn() + Send + Sync + 'static,
    ) -> Self {
        session.set_idle_lock(config.idle_lock());
        Self {
            session,
            clipboard,
            config: Mutex::new(config),
            notice: Mutex::default(),
            apply_capture: Box::new(apply_capture),
            on_locked: Box::new(on_locked),
        }
    }

    fn config_guard(&self) -> MutexGuard<'_, SessionConfig> {
        self.config
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn config(&self) -> SessionConfig {
        *self.config_guard()
    }

    pub fn update_config(&self, f: impl FnOnce(&mut SessionConfig)) -> SessionConfig {
        let mut config = self.config_guard();
        f(&mut config);
        self.session.set_idle_lock(config.idle_lock());
        *config
    }

    /// Locks and returns whether a vault was open. May block briefly on a
    /// busy clipboard, so call it off the UI thread.
    pub fn lock(&self, reason: LockReason) -> bool {
        let was_open = self.session.lock();
        self.after_lock(was_open, reason);
        was_open
    }

    fn after_lock(&self, was_open: bool, reason: LockReason) {
        self.clipboard.clear_now();
        self.restore_capture_steady();
        if was_open {
            tracing::info!(?reason, "vault locked");
            *self
                .notice
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) =
                LockNotice::for_reason(reason, &self.config());
        }
        // A manual lock always tells the UI, even if Rust was already locked,
        // so a UI that's somehow out of step still returns to the lock screen.
        if (was_open && reason != LockReason::Exit) || reason == LockReason::Manual {
            (self.on_locked)();
        }
    }

    /// Custom mode may have hidden the window for an open account. Lock
    /// leaves that account, so the window returns to the saved steady state
    /// (visible, unless the policy is Always).
    fn restore_capture_steady(&self) {
        let steady = self.config().capture_mode.hides_at_rest();
        if self.config().capture_protection == steady {
            return;
        }
        (self.apply_capture)(steady);
        self.update_config(|c| c.capture_protection = steady);
    }

    pub fn lock_if_idle(&self) -> bool {
        let locked = self.session.lock_if_idle();
        if locked {
            self.after_lock(true, LockReason::Idle);
        }
        locked
    }

    /// Why the vault last locked, once.
    pub fn take_notice(&self) -> Option<LockNotice> {
        self.notice
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
    }

    /// Applies the lock policy to an OS event. Returns whether it locked.
    pub fn on_session_event(&self, event: SessionEvent) -> bool {
        if !should_lock(&self.config(), event) {
            return false;
        }
        self.lock(LockReason::Os(event))
    }
}

/// Checks the idle deadline every second for the life of the app.
pub fn spawn_idle_timer(locker: Arc<Locker>, runtime: &tokio::runtime::Handle) {
    runtime.spawn(async move {
        let mut tick = tokio::time::interval(IDLE_CHECK);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            let locker = locker.clone();
            let _ = tokio::task::spawn_blocking(move || locker.lock_if_idle()).await;
        }
    });
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use std::sync::atomic::{AtomicUsize, Ordering};

    use secrecy::SecretString;
    use vaultair_core::crypto::kdf::KdfParams;
    use vaultair_core::service::session::VaultStatus;
    use vaultair_core::vault::CreateOptions;
    use vaultair_platform::fake::{FakeClipboard, FakeSessionEvents};
    use vaultair_platform::SessionEvents;

    use super::*;

    #[test]
    fn default_policy_matches_adr_0004() {
        let config = SessionConfig::default();
        assert!(should_lock(&config, SessionEvent::SessionLocked));
        assert!(should_lock(&config, SessionEvent::SessionLoggedOff));
        assert!(should_lock(&config, SessionEvent::Disconnected));
        assert!(should_lock(&config, SessionEvent::Suspending));
        assert!(should_lock(&config, SessionEvent::ShuttingDown));
        assert!(!should_lock(&config, SessionEvent::Minimized));

        let relaxed = SessionConfig {
            lock_on_session_lock: false,
            lock_on_sleep: false,
            lock_on_minimize: true,
            ..config
        };
        assert!(!should_lock(&relaxed, SessionEvent::SessionLocked));
        assert!(!should_lock(&relaxed, SessionEvent::Suspending));
        assert!(should_lock(&relaxed, SessionEvent::Minimized));
        // Shutdown can't be opted out of.
        assert!(should_lock(&relaxed, SessionEvent::ShuttingDown));
    }

    struct Harness {
        _dir: tempfile::TempDir,
        session: Arc<SessionManager>,
        fake: Arc<FakeClipboard>,
        clipboard: Arc<ClipboardService>,
        locker: Arc<Locker>,
        notified: Arc<AtomicUsize>,
    }

    fn unlocked_harness() -> Harness {
        let dir = tempfile::tempdir().unwrap();
        let session = Arc::new(SessionManager::default());
        session
            .create(
                &CreateOptions {
                    parent_dir: dir.path().to_path_buf(),
                    name: "Locker".into(),
                    kdf: KdfParams::MINIMUM,
                    demo: false,
                },
                &SecretString::from("orbit lantern cactus mosaic"),
            )
            .unwrap();
        let fake = Arc::new(FakeClipboard::default());
        let clipboard =
            ClipboardService::new(fake.clone(), tokio::runtime::Handle::current(), || {});
        let notified = Arc::new(AtomicUsize::new(0));
        let count = notified.clone();
        let locker = Arc::new(Locker::new(
            session.clone(),
            clipboard.clone(),
            SessionConfig::default(),
            |_| {},
            move || {
                count.fetch_add(1, Ordering::SeqCst);
            },
        ));
        Harness {
            _dir: dir,
            session,
            fake,
            clipboard,
            locker,
            notified,
        }
    }

    fn subscribe(events: &FakeSessionEvents, locker: &Arc<Locker>) {
        let locker = locker.clone();
        events
            .subscribe(Box::new(move |event| {
                locker.on_session_event(event);
            }))
            .unwrap();
    }

    #[tokio::test]
    async fn os_session_lock_locks_the_vault_and_clears_the_clipboard() {
        let h = unlocked_harness();
        let events = FakeSessionEvents::default();
        subscribe(&events, &h.locker);
        h.clipboard
            .copy("username-canary", Duration::from_secs(30))
            .unwrap();

        // Minimize doesn't lock by default.
        events.emit(SessionEvent::Minimized);
        assert!(matches!(h.session.status(), VaultStatus::Unlocked { .. }));
        assert_eq!(h.notified.load(Ordering::SeqCst), 0);

        events.emit(SessionEvent::SessionLocked);
        assert_eq!(h.session.status(), VaultStatus::Locked);
        assert_eq!(h.fake.text(), None);
        assert_eq!(h.notified.load(Ordering::SeqCst), 1);
        // The lock screen can say why, once.
        assert_eq!(h.locker.take_notice(), Some(LockNotice::SessionLocked));
        assert_eq!(h.locker.take_notice(), None);

        // Another event while locked doesn't reload the UI again.
        events.emit(SessionEvent::Suspending);
        assert_eq!(h.notified.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn lock_leaves_a_later_user_copy_alone() {
        let h = unlocked_harness();
        h.clipboard.copy("ours", Duration::from_secs(30)).unwrap();
        h.fake.user_copies("theirs");
        assert!(h.locker.lock(LockReason::Manual));
        assert_eq!(h.fake.text().as_deref(), Some("theirs"));
    }

    #[tokio::test]
    async fn idle_lock_goes_through_the_same_path() {
        let h = unlocked_harness();
        h.clipboard.copy("ours", Duration::from_secs(30)).unwrap();
        assert!(!h.locker.lock_if_idle());

        h.locker.update_config(|c| c.idle_lock_secs = Some(0));
        assert!(h.locker.lock_if_idle());
        assert_eq!(h.session.status(), VaultStatus::Locked);
        assert_eq!(h.fake.text(), None);
        assert_eq!(h.notified.load(Ordering::SeqCst), 1);
        assert_eq!(
            h.locker.take_notice(),
            Some(LockNotice::Idle { after_secs: 0 })
        );
    }

    #[tokio::test]
    async fn manual_lock_always_notifies() {
        let h = unlocked_harness();
        assert!(h.locker.lock(LockReason::Manual));
        assert!(!h.locker.lock(LockReason::Manual));
        assert_eq!(h.notified.load(Ordering::SeqCst), 2);
        // Only a lock that closed a vault leaves a notice.
        assert_eq!(h.locker.take_notice(), Some(LockNotice::Manual));
        assert!(!h.locker.lock(LockReason::Manual));
        assert_eq!(h.locker.take_notice(), None);
    }
}
