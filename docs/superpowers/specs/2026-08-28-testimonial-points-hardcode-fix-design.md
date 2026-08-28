# Design Doc: Fix Testimonial Points Hardcode

Date: 2026-08-28
Branch: feat/whatsapp-cloud-api

## Problem
`convex/reviews.ts`'s `approveReview` mutation hardcodes testimonial points to `50000` with a misleading comment ("50000 paise equivalent") — but `points` is a raw loyalty-points count added directly to `user.points`, not paise. This is off by orders of magnitude versus every other review type (gmb/product use values in the 150-750 range) and ignores the real `testimonialBonus` setting already built in `convex/settings.ts` (Points Ledger Phase A/B1), which has real global/silver/gold/platinum values (global default 150).

A read-only audit (this session) confirmed the exact fix and its scope: `approveReview` reads loyalty rules via a raw settings-doc query (`reviews.ts:60-66`, falling back to `DEFAULT_SETTINGS.tiers`), then computes `points` per review type. gmb and product already correctly read `globalRules.gmbPoints` / `globalRules.productReviewPoints` from that same flat-global read — neither is tier-aware today, despite per-tier rows existing in settings. Testimonial should follow the identical pattern for consistency, not add new tier-awareness that doesn't exist elsewhere in this mutation.

## Scope
1. Replace `convex/reviews.ts:71`'s hardcoded `points = 50000; // 50000 paise equivalent` with `points = globalRules.testimonialBonus;` — mirroring the exact pattern used two lines below for gmb/product.
2. No other changes to this file or any other file.

## Explicitly out of scope
- Tier-awareness for testimonial (or gmb/product) points — stays flat-global, matching existing behavior exactly.
- Any change to `convex/settings.ts` or `convex/schema.ts` — `testimonialBonus` already exists as a field with real defaults.
- Switching the raw settings-doc read to a merged-rules helper — a latent `undefined`/NaN risk already exists identically for gmb/product if a stored `loyalty_rules` doc is missing a field; hardening that is a separate, deliberate future change, not bundled here.
- Any migration or correction of historical `reviews.points_awarded` values already stored (e.g. past testimonial approvals that got 50000) — only future approvals are affected by this fix.

## Verification plan
- `git diff` scoped to exactly one line in `convex/reviews.ts`.
- `npx convex dev --once` deploy, confirm no errors.
- Live test: approve a test testimonial review, confirm `points_awarded` is 150 (current global default), not 50000; confirm the test customer's balance increased by exactly 150.
- Clean up all temporary test data created.
- `npm run build` (cache-cleared) — confirm clean (backend-only change, no frontend impact expected).
