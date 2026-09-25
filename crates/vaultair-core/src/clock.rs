//! Injectable time source, so session and timestamp logic is testable.

use std::time::Instant;

use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

pub trait Clock: Send + Sync {
    fn now_utc(&self) -> OffsetDateTime;
    fn monotonic(&self) -> Instant;

    /// ISO-8601 UTC timestamp, the format stored in the database.
    fn now_rfc3339(&self) -> String {
        self.now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_utc(&self) -> OffsetDateTime {
        OffsetDateTime::now_utc()
    }

    fn monotonic(&self) -> Instant {
        Instant::now()
    }
}

/// A clock that only moves when told to. For tests.
#[derive(Debug)]
pub struct ManualClock {
    start: Instant,
    offset: std::sync::Mutex<std::time::Duration>,
}

impl Default for ManualClock {
    fn default() -> Self {
        Self {
            start: Instant::now(),
            offset: std::sync::Mutex::default(),
        }
    }
}

impl ManualClock {
    pub fn advance(&self, by: std::time::Duration) {
        *self
            .offset
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) += by;
    }
}

impl Clock for ManualClock {
    fn now_utc(&self) -> OffsetDateTime {
        OffsetDateTime::UNIX_EPOCH + self.monotonic().duration_since(self.start)
    }

    fn monotonic(&self) -> Instant {
        self.start
            + *self
                .offset
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}
