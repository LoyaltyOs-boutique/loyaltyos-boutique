# Design Doc: Points Ledger — Phase B2 (Customer CRM "+ Points" Wiring)

Date: 2026-08-28
Branch: feat/whatsapp-cloud-api

## Problem
The existing per-customer Points Tool tab (Customers.jsx) adjusted points via a local-only function (adjustPoints in db.js) that never reached Convex — changes were lost on refresh or a different device. Phase B1 built the real, durable backend (points_ledger table + awardPoints mutation). Phase B2 wires the frontend to use it: fixing the existing Points Tool AND adding a new "+ Points" quick-action button to the Customer CRM's "All clients" row, per the original Phase B1 spec's stated future call sites.

## Scope — Phase B2
1. New db.js bridge function `awardPoints(customer_id, delta, reason_type, note)` — calls the real Convex `api.customers.awardPoints` mutation, following the exact same error-propagating pattern as `recordMessageAction` (no try/catch-and-swallow; real rejections surface to the caller). On success, calls `hydrateCustomers()` to refresh local state with the real persisted balance (since the mutation returns only a numeric balance, not a full customer doc).
2. `Customers.jsx`'s `PointsTool` component: replaced its `adjustPoints` local-only call with the new `awardPoints(userId, sign*n, 'normal', reason.trim())`, and added a `pointsError` state that shows an inline error message (existing `text-red-600 text-[10px]` convention) if the mutation fails, instead of silently doing nothing.
3. New "+ Points" icon button (glyph ✦) added as a 4th sibling in the existing per-row icon-button group (`inline-flex gap-1.5 items-center`), styled `btn-ghost !px-2 !py-1.5 text-[11px]` matching the existing eye/copy/WhatsApp buttons exactly.
4. New `pointsTarget` state (mirrors the existing `approveTarget` pattern) opens a `Modal` (reusing the existing `Modal` component from ui.jsx, same pattern as `ApprovalModal`) containing the existing `PointsTool` component directly — no new component invented, no duplicate form built.
5. reason_type is hardcoded to `'normal'` for both the Points Tool tab and the new CRM button — matching the Phase B1 spec's rule that manual UIs only ever offer normal/birthday/anniversary (this task only wires "normal"; birthday/anniversary reason-type selection in manual UI, if wanted, is a separate future task).

## Explicitly out of scope
- A reason_type picker in the manual UI (currently hardcoded to "normal")
- Any change to the automated testimonial/purchase point-crediting flows (reviews.ts, orders.ts)
- The Activity Ledger tab's read-side (still synthesized client-side; wiring it to read from the real points_ledger table is a separate future task)
- Fixing testimonial points hardcoded to 50000 in reviews.ts, or orders.ts's tier-multiplier bug (already deferred from Phase B1)

## Verification (already run before this spec was written, independently re-confirmed)
- Diff scoped to exactly `src/lib/db.js` (+32) and `src/pages/merchant/Customers.jsx` (+28/-4)
- Build clean, CSS byte-identical (28.60 kB, same file hash as before this change) — zero CSS added
- Live test data (Test Unique, mobile 9876500001) confirmed cleaned up, balance restored to 1660

## Process note
This spec was written retroactively, after the code was already implemented and independently verified, because the implementing task skipped CLAUDE.md 5.12's hard-gate (spec before code). The user explicitly chose to document what was built rather than discard working, verified code — see .superpowers/sdd/progress.md / memory-bank/progress.md ledger entry for this same date for full context.
