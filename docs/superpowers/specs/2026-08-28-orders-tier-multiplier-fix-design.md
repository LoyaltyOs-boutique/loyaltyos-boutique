# Design Doc: Fix Orders Tier-Multiplier Bug

Date: 2026-08-28
Branch: feat/whatsapp-cloud-api

## Problem
`convex/orders.ts`'s `createOrder` mutation computes `points_earned` with a flat rate — `Math.floor(subtotal_paise / 10000)` (`orders.ts:57`) — giving every customer a flat ₹100 = 1pt regardless of tier. It ignores the customer's tier-specific `purchasePercent` rate (global 5 / silver 4 / gold 5 / platinum 7, per `convex/settings.ts` DEFAULT_SETTINGS), already built and Convex-backed since Points Ledger Phase A/B1. `convex/schema.ts:120`'s comment on `orders.points_earned` ("earnForAmount(subtotal) × tier multiplier, floored") has never matched the real implementation.

A read-only audit (this session) confirmed the exact fix and its scope:
- `createOrder` already fetches the full user doc (`orders.ts:38`), so `user.tier` is already in scope — no new fetch needed for that.
- `createOrder` does NOT currently read the `settings` table at all — a new fetch is needed, mirroring the exact pattern already used in `convex/reviews.ts:60-66` for gmb/product/testimonial points (query `settings` by `SETTINGS_KEYS.LOYALTY_RULES`, fall back to `DEFAULT_SETTINGS.tiers`).
- The correct per-tier rate lookup, with undefined-tier fallback to global, mirrors the exact pattern already established in `src/lib/db.js`'s local `checkout()` (line 731): `rules[user.tier] || rules.global`.
- The formula itself must be derived paise-native (backend convention) rather than copied from `db.js`'s rupee-based local version. `db.js:732` computes `Math.round((subtotal_rupees * purchasePercent) / 100)`. The paise-native equivalent is `Math.floor((subtotal_paise * purchasePercent) / 10000)`.
- **Round vs floor decision (made):** `db.js`'s local fallback uses `Math.round`; the project's stated money convention (paise, points always floored — per `schema.ts:13`'s currency invariant and the existing flat-rate code's own "floored" comment) calls for `Math.floor`. This fix floors on the backend, matching convention and the schema comment. `src/lib/db.js`'s local `Math.round` is explicitly left untouched — it is a separate, smaller, pre-existing 1-point local-vs-persisted rounding quirk, out of scope for this task.

## Scope
1. Add a settings fetch to `createOrder`, mirroring `reviews.ts:60-66` exactly (query `settings` by `SETTINGS_KEYS.LOYALTY_RULES`, fall back to `DEFAULT_SETTINGS.tiers`).
2. Look up the customer's tier rule with global fallback: `const rule = rules[user.tier] || rules.global;` (mirrors `db.js:731`).
3. Replace `orders.ts:57`'s flat calculation:
   ```
   const points_earned = Math.floor(subtotal_paise / 10000);
   ```
   with:
   ```
   const points_earned = Math.floor((subtotal_paise * (rule.purchasePercent || 5)) / 10000);
   ```
4. No other changes to `createOrder` or any other function in the file.

## Explicitly out of scope
- Any change to `src/lib/db.js`'s local `checkout()` — its `Math.round` stays as-is, per explicit decision above.
- Any change to `convex/schema.ts` (the `points_earned` comment already correctly describes the intended behavior — no comment edit needed once the code matches it) or `convex/settings.ts`.
- Any change to the points-redemption side of `createOrder` (the `discount_value`/`points_applied` logic is untouched — this fix only concerns points *earned*, not points *redeemed*).
- Any tier-awareness for gmb/product/testimonial review points (already intentionally flat-global, fixed separately, unrelated to this task).

## Verification plan
- `git diff` scoped to `convex/orders.ts` only.
- `npx convex dev --once` deploy, confirm no errors.
- Live test with at least two different tiers (e.g. silver and platinum) on the same subtotal, confirming `points_earned` differs correctly per tier's `purchasePercent`, and matches `Math.floor((subtotal_paise * purchasePercent) / 10000)` exactly.
- Confirm a customer with no `tier` set falls back to the global rate.
- Clean up all temporary test data created.
- `npm run build` (cache-cleared) — confirm clean (backend-only change, no frontend impact expected).
