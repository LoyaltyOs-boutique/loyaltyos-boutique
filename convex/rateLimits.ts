// ============================================================================
// Rate limiters for public (no-auth) Convex functions.
//
// Design spec: docs/superpowers/specs/2026-09-05-rate-limiting-design.md
// (Part A4 / Part B). Defense-in-depth ONLY — this does not fix the two
// open Critical vulnerabilities tracked in docs/full-system-audit-2026-09-04
// .html Part F #1/#2 (magic-link takeover, duplicate-mobile data leak). It
// slows down automated abuse of the 4 genuinely-public, input-accepting
// functions while those remain open in a future task.
//
// All three limiters use "token bucket" (per the design's reasoning: smooths
// bursts from a single key with tolerance for a small legitimate burst, see
// spec Part B). None of them use `throws: true` — see each call site (in
// auth.ts / customers.ts / reviews.ts) for why: src/lib/db.js's
// onboardCustomerRemote wraps createCustomer + generateMagicTokenSelf in one
// bare `catch { return createLocalCustomer(f) }`, so a THROWN rejection here
// would be silently swallowed into a fake local-only phantom customer with
// no error shown — worse than a crash. Always use the non-throwing
// `{ok, retryAfter}` return form and handle the false case explicitly.
// ============================================================================
import { RateLimiter, MINUTE, HOUR } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // generateMagicTokenSelf / generateMagicToken (deprecated alias) —
  // Critical #1's takeover vector (mints a working 180-day session for any
  // existing mobile, no auth). 5 attempts / 10 min, keyed by normalized
  // mobile. Shared by BOTH functions (byte-identical bodies, same threat).
  magicTokenByMobile: { kind: "token bucket", rate: 5, period: 10 * MINUTE },

  // createCustomer — Critical #2's leak vector (duplicate-mobile branch
  // returns the full existing customer record, incl. magic_token /
  // measurements / staff_notes, to an unauthenticated caller). 5 attempts /
  // 10 min, keyed by normalized mobile. Deliberately a SEPARATE named
  // limiter from magicTokenByMobile (not shared) so exhausting one doesn't
  // cross-block the other — /join's legitimate two-call sequence
  // (createCustomer then generateMagicTokenSelf) must not double-consume a
  // shared bucket in one real signup.
  createCustomerByMobile: { kind: "token bucket", rate: 5, period: 10 * MINUTE },

  // createReview — public + intentionally unguarded (no merchant session at
  // review time). Worst case is pending-review spam, not a data/security
  // incident (approveReview stays merchant-gated). Looser limit: 20/hour,
  // keyed by submitting user_id, capacity 5 lets a legitimate short burst of
  // reviews (product + GMB + testimonial in one session) through without
  // friction.
  createReviewByUser: { kind: "token bucket", rate: 20, period: HOUR, capacity: 5 },
});
