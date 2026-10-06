/**
 * Choices for the lock and clipboard timings. Rust enforces the bounds
 * (`service::settings`): auto-lock 1–120 minutes or never, clipboard
 * 10–300 s, reveal 5–300 s.
 */
export const AUTO_LOCK_MINUTES = [1, 2, 5, 10, 15, 30, 60, 120];
export const CLIPBOARD_SECS = [10, 15, 20, 30, 45, 60, 90, 120, 180, 300];
export const REVEAL_SECS = [5, 10, 15, 20, 30, 60, 120, 300];
export const NEVER = "never";

/** The choices plus `saved` if it isn't one of them, in order. */
export function withSaved(choices: number[], saved: number | null): number[] {
  if (saved === null || choices.includes(saved)) return choices;
  return [...choices, saved].sort((a, b) => a - b);
}

export function formatMinutes(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${String(hours)} hours`;
  }
  return minutes === 1 ? "1 minute" : `${String(minutes)} minutes`;
}

export function formatSeconds(secs: number): string {
  if (secs >= 60 && secs % 60 === 0) return formatMinutes(secs / 60);
  return `${String(secs)} seconds`;
}
