/**
 * One-Device Merchant Login Lock — pure helpers (design spec 2026-09-28).
 *
 * This module imports NOTHING from Convex on purpose: it is dependency-free
 * TypeScript so the liveness math can be unit-tested with plain `tsx` without
 * spinning up a Convex runtime. convex/auth.ts imports these helpers.
 *
 * Two concepts live here:
 *  - A merchant session is "live" when it currently has a valid token, an
 *    unexpired expiry, AND a recent liveness heartbeat (session_last_seen).
 *  - The feature is gated by an env switch that only counts when set to "on".
 */

/**
 * How fresh session_last_seen must be for a session to count as live.
 * A session whose last heartbeat is older than this is treated as gone, so a
 * second device may then log in. Five minutes.
 */
export const LIVE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Minimum age of session_last_seen before merchantHeartbeat rewrites it.
 * Heartbeats fire often; re-stamping only every 30 seconds avoids needless
 * writes while keeping the value fresh enough for the live-window check above.
 */
export const HEARTBEAT_MIN_WRITE_MS = 30 * 1000;

/**
 * A merchant row, typed loosely — this file cannot import Convex's generated
 * Doc<"users"> (no Convex imports allowed here).
 */
type SessionUser = {
  session_token?: string | null;
  session_expiry?: number | null;
  session_last_seen?: number | null;
};

/**
 * True only when the merchant currently has an active, freshly-seen session:
 * a token exists, the expiry is still in the future, a heartbeat timestamp
 * exists, and that heartbeat is newer than LIVE_WINDOW_MS.
 *
 * A session with no session_last_seen (legacy rows written before this feature)
 * counts as NOT live — deliberate, so nobody is locked out at rollout.
 * Strictly-less-than: a heartbeat exactly LIVE_WINDOW_MS old is NOT live.
 */
export function isMerchantSessionLive(user: SessionUser, now: number): boolean {
  if (!user.session_token) return false;
  if (!user.session_expiry || user.session_expiry <= now) return false;
  if (typeof user.session_last_seen !== "number") return false;
  return now - user.session_last_seen < LIVE_WINDOW_MS;
}

/**
 * True only when the ONE_DEVICE_LOCK switch is exactly the string "on".
 * Case-sensitive, exact match — unset or any other value means the lock is OFF
 * and merchantLogin behaves exactly as before.
 */
export function lockEnabled(value: string | undefined | null): boolean {
  return value === "on";
}

/**
 * Decides whether merchantLogin should refuse a password-verified attempt.
 *
 * Refuse ONLY when: the switch is "on", the stored session is still live, AND
 * the caller is NOT the same device. "Same device" means currentToken is a
 * non-empty string exactly equal to the stored session_token — this lets a
 * merchant who reopens their OWN browser (within the live window) sign in again
 * instead of being refused by their own still-live session. Empty string or a
 * mismatched token counts as a different device and is refused.
 */
export function shouldRefuseLogin(
  user: SessionUser,
  now: number,
  switchValue: string | undefined | null,
  currentToken: string | undefined | null,
): boolean {
  if (!lockEnabled(switchValue)) return false;
  if (!isMerchantSessionLive(user, now)) return false;
  const sameDevice =
    typeof currentToken === "string" &&
    currentToken.length > 0 &&
    currentToken === user.session_token;
  return !sameDevice;
}
