/** Wrong attempts allowed before the lock screen starts making you wait. */
export const FREE_ATTEMPTS = 5;
const MAX_WAIT_SECONDS = 60;

/**
 * Seconds to wait after `failures` wrong passwords: 5, 10, 20, 40, then 60.
 * Cosmetic: it slows down someone guessing at the keyboard. The real rate
 * limit is Argon2 (about a second of work per guess, on any machine).
 */
export function lockoutSeconds(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  return Math.min(5 * 2 ** (failures - FREE_ATTEMPTS), MAX_WAIT_SECONDS);
}
