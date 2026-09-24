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
