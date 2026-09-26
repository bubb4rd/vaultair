//! Cutoffs for the health rules. The dormant cutoff is the same number the
//! account list uses, so an account the list calls dormant is a dormant
//! health issue too.

/// zxcvbn scores at or below this are a weak-password issue. 0 and 1 are
/// "very weak" and "weak"; 2 ("fair") is not.
pub const WEAK_AT_OR_BELOW: u8 = 1;

/// Days without activity before an active account is dormant. Activity is
/// the latest of an edit, "Mark verified", and using the password from
/// Vaultair. Must match `DORMANT_AFTER_DAYS` in the UI's `labels.ts`.
pub const DORMANT_AFTER_DAYS: u32 = 90;
