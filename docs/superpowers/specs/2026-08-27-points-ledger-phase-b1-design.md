# Design Doc: Points Ledger — Phase B1 (Real Awarding Backend)

Date: 2026-08-27
Branch: feat/whatsapp-cloud-api

## Problem
Points can currently only be manually adjusted via the existing per-customer "Points Tool" tab, which is local-state-only (src/lib/db.js's adjustPoints function) — it does not call any Convex mutation, so changes vanish on refresh or a different device/browser. There is also no durable points-transaction/audit table in Convex; the existing "Activity Ledger" tab is synthesized client-side from local-only arrays. This phase builds the real, durable backend for manual point awarding.

## Scope — Phase B1 only (backend)
1. New Convex schema table `points_ledger`: customer_id (v.id("users")), delta (v.number(), positive or negative), reason_type (v.union of "normal"|"birthday"|"anniversary"|"testimonial"|"purchase"), note (v.optional(v.string())), resulting_balance (v.number()), created_by (v.union of "admin"|"system"), created_at (v.number()). Index by_customer on customer_id for per-customer history lookups.
2. New mutation `awardPoints(customer_id, delta, reason_type, note)`: patches the customer's points field (never allow the result to go negative — clamp at 0, matching the existing local adjustPoints's Math.max(0, ...) safety behavior), inserts one row into points_ledger with the resulting balance, returns the new balance.
3. This mutation is designed to be called from two places in later tasks: the existing Points Tool tab (Customers.jsx) — replacing its current local-only adjustPoints call — and a new "+ Points" quick-action in the Customer CRM "All clients" row (Phase B2, separate task).
4. reason_type "testimonial" is reserved for the existing automated review-approval flow (reviews.ts) only — NOT selectable in either manual UI (Points Tool or the new "+ Points" button). Manual UIs only offer "normal"/"birthday"/"anniversary". "purchase" is reserved for the existing order-checkout flow (orders.ts) only, not manual UIs.

## Explicitly out of scope (separate future tasks)
- Phase B2: the new "+ Points" button/modal UI in Customer CRM's "All clients" row
- Wiring the existing Points Tool tab to call awardPoints instead of local adjustPoints (a small follow-up once B1 is verified)
- Fixing testimonial points being hardcoded to 50000 in reviews.ts instead of sourced from settings.testimonialBonus
- Fixing orders.createOrder to apply the tier purchasePercent multiplier instead of a flat rate
- Any redemption logic (discount/wallet/referral/perks)
