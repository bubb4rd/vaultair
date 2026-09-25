//! Copy with automatic clearing.
//!
//! Every copy is marked to stay out of clipboard history and cloud sync (see
//! `vaultair_platform::Clipboard`), and is cleared after a timeout, on lock
//! and on exit. A clear only removes our own value: if the user has copied
//! something else since, it's left alone.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use vaultair_platform::{Clipboard, ClipboardTicket, PlatformError};

#[derive(Debug, Clone, Copy)]
struct Pending {
    /// Tells a timer whether its copy is still the current one.
    id: u64,
    ticket: ClipboardTicket,
}

pub struct ClipboardService {
    clipboard: Arc<dyn Clipboard>,
    runtime: tokio::runtime::Handle,
    /// Called whenever a pending copy ends by clearing (not by "keep").
    on_cleared: Box<dyn Fn() + Send + Sync>,
    pending: Mutex<Option<Pending>>,
    next_id: AtomicU64,
}

impl std::fmt::Debug for ClipboardService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ClipboardService").finish_non_exhaustive()
    }
}

impl ClipboardService {
    pub fn new(
        clipboard: Arc<dyn Clipboard>,
        runtime: tokio::runtime::Handle,
        on_cleared: impl Fn() + Send + Sync + 'static,
    ) -> Arc<Self> {
        Arc::new(Self {
            clipboard,
            runtime,
            on_cleared: Box::new(on_cleared),
            pending: Mutex::default(),
            next_id: AtomicU64::new(0),
        })
    }

    fn pending(&self) -> MutexGuard<'_, Option<Pending>> {
        self.pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Copies `text` and schedules a clear after `clear_after`. A new copy
    /// replaces the previous one's timer. Blocks briefly if another app holds
    /// the clipboard, so call it off the UI thread.
    pub fn copy(self: &Arc<Self>, text: &str, clear_after: Duration) -> Result<(), PlatformError> {
        let ticket = self.clipboard.write_sensitive(text)?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        *self.pending() = Some(Pending { id, ticket });

        let this = Arc::downgrade(self);
        self.runtime.spawn(async move {
            tokio::time::sleep(clear_after).await;
            let Some(this) = this.upgrade() else { return };
            // The clear may wait on a busy clipboard; keep that off the async workers.
            let _ = tokio::task::spawn_blocking(move || this.expire(id)).await;
        });
        Ok(())
    }

    fn expire(&self, id: u64) {
        let due = {
            let mut pending = self.pending();
            match *pending {
                Some(p) if p.id == id => pending.take(),
                _ => None,
            }
        };
        if let Some(p) = due {
            self.clear(p);
        }
    }

    fn clear(&self, p: Pending) -> bool {
        let cleared = match self.clipboard.clear_if_unchanged(p.ticket) {
            Ok(cleared) => {
                if cleared {
                    tracing::info!("clipboard cleared");
                } else {
                    tracing::info!("clipboard changed since our copy; left alone");
                }
                cleared
            }
            Err(err) => {
                tracing::warn!(error = %err, "could not clear the clipboard");
                false
            }
        };
        (self.on_cleared)();
        cleared
    }

    /// "Keep in clipboard": drops the pending clear. The value then stays
    /// until the user replaces it; lock and exit don't clear it either,
    /// because nothing is pending.
    pub fn cancel(&self) -> bool {
        self.pending().take().is_some()
    }

    /// Clears now, if our copy is still on the clipboard. Used by "Clear
    /// now", lock and exit. Returns whether it cleared.
    pub fn clear_now(&self) -> bool {
        let taken = self.pending().take();
        taken.is_some_and(|p| self.clear(p))
    }

    #[cfg(test)]
    fn has_pending(&self) -> bool {
        self.pending().is_some()
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use std::sync::atomic::AtomicUsize;

    use vaultair_platform::fake::FakeClipboard;

    use super::*;

    struct Harness {
        fake: Arc<FakeClipboard>,
        service: Arc<ClipboardService>,
        cleared: Arc<AtomicUsize>,
        cleared_rx: tokio::sync::mpsc::UnboundedReceiver<()>,
    }

    fn harness() -> Harness {
        let fake = Arc::new(FakeClipboard::default());
        let cleared = Arc::new(AtomicUsize::new(0));
        let (tx, cleared_rx) = tokio::sync::mpsc::unbounded_channel();
        let count = cleared.clone();
        let service =
            ClipboardService::new(fake.clone(), tokio::runtime::Handle::current(), move || {
                count.fetch_add(1, Ordering::SeqCst);
                let _ = tx.send(());
            });
        Harness {
            fake,
            service,
            cleared,
            cleared_rx,
        }
    }

    const CLEAR_AFTER: Duration = Duration::from_secs(30);

    /// Lets spawned timer tasks observe the (paused) clock.
    async fn settle() {
        for _ in 0..10 {
            tokio::task::yield_now().await;
        }
    }

    #[tokio::test(start_paused = true)]
    async fn clears_after_the_timeout() {
        let mut h = harness();
        h.service.copy("hunter2-user", CLEAR_AFTER).unwrap();
        assert!(h.fake.excluded_from_history());

        tokio::time::advance(Duration::from_secs(29)).await;
        settle().await;
        assert_eq!(h.fake.text().as_deref(), Some("hunter2-user"));
        assert!(h.service.has_pending());

        tokio::time::advance(Duration::from_secs(1)).await;
        h.cleared_rx.recv().await.unwrap();
        assert_eq!(h.fake.text(), None);
        assert!(!h.service.has_pending());
        assert_eq!(h.cleared.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn keep_in_clipboard_cancels_the_clear() {
        let h = harness();
        h.service.copy("keep-me", CLEAR_AFTER).unwrap();
        assert!(h.service.cancel());
        assert!(!h.service.cancel());

        tokio::time::advance(Duration::from_secs(120)).await;
        settle().await;
        assert_eq!(h.fake.text().as_deref(), Some("keep-me"));
        assert_eq!(h.cleared.load(Ordering::SeqCst), 0);
        // Nothing pending, so lock/exit leave it too.
        assert!(!h.service.clear_now());
        assert_eq!(h.fake.text().as_deref(), Some("keep-me"));
    }

    #[tokio::test(start_paused = true)]
    async fn never_clears_what_the_user_copied_afterwards() {
        let mut h = harness();
        h.service.copy("ours", CLEAR_AFTER).unwrap();
        h.fake.user_copies("theirs");

        tokio::time::advance(CLEAR_AFTER).await;
        h.cleared_rx.recv().await.unwrap();
        assert_eq!(h.fake.text().as_deref(), Some("theirs"));
    }

    #[tokio::test(start_paused = true)]
    async fn clear_now_clears_immediately_and_stops_the_timer() {
        let h = harness();
        h.service.copy("now", CLEAR_AFTER).unwrap();
        assert!(h.service.clear_now());
        assert_eq!(h.fake.text(), None);
        assert_eq!(h.cleared.load(Ordering::SeqCst), 1);

        tokio::time::advance(CLEAR_AFTER).await;
        settle().await;
        assert_eq!(h.cleared.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_new_copy_restarts_the_timer() {
        let mut h = harness();
        h.service.copy("first", CLEAR_AFTER).unwrap();
        tokio::time::advance(Duration::from_secs(20)).await;
        h.service.copy("second", CLEAR_AFTER).unwrap();

        // The first copy's timer fires at 30 s and must do nothing.
        tokio::time::advance(Duration::from_secs(11)).await;
        settle().await;
        assert_eq!(h.fake.text().as_deref(), Some("second"));
        assert_eq!(h.cleared.load(Ordering::SeqCst), 0);

        tokio::time::advance(Duration::from_secs(19)).await;
        h.cleared_rx.recv().await.unwrap();
        assert_eq!(h.fake.text(), None);
    }

    #[tokio::test(start_paused = true)]
    async fn a_busy_clipboard_fails_the_copy_cleanly() {
        let h = harness();
        h.fake.set_busy(true);
        assert!(matches!(
            h.service.copy("x", CLEAR_AFTER),
            Err(PlatformError::ClipboardBusy)
        ));
        assert!(!h.service.has_pending());
    }
}
