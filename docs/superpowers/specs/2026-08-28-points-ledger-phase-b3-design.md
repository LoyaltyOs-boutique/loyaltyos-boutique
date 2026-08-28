# Design Doc: Points Ledger — Phase B3 (Reason-Type Dropdown)

Date: 2026-08-28
Branch: feat/whatsapp-cloud-api

## Problem
Both manual point-award call sites (Customer CRM's "+ Points" modal and the Points Tool tab — both rendered by the shared `PointsTool` component in `src/pages/merchant/Customers.jsx`) currently hardcode `reason_type: 'normal'` in their `awardPoints` call. Merchant staff have no way to record a birthday or anniversary bonus distinctly from a normal goodwill adjustment — every manual award is logged identically in the `points_ledger` audit trail regardless of the real reason.

A prior investigation (read-only audit, this session) confirmed `PointsLedger.jsx`'s inert Phase A "Give Points" panel already contains a working `REASON_TYPES` dropdown pattern (`Normal`/`Birthday`/`Anniversary`/`Testimonial`, Capitalized labels) that is visually correct but not wired to any mutation. Its option *values* are Capitalized strings, which do NOT match the backend `awardPoints` mutation's `reason_type` union — which uses lowercase literals (`"normal" | "birthday" | "anniversary" | "testimonial" | "purchase"`, per `convex/customers.ts`, defined in Phase B1). A naive copy-paste of that pattern would send invalid casing and fail every submission.

## Scope — Phase B3 only
1. Verify the exact backend `reason_type` union casing directly from `convex/customers.ts` (not assumed from the B1 spec doc) before wiring anything.
2. Add a `reasonType` state to `PointsTool` (`src/pages/merchant/Customers.jsx`), default `'normal'`, lowercase, matching the verified backend casing exactly.
3. Add a `<select>` dropdown to `PointsTool`'s form, styled identically to this file's existing Tier `<select className="input">` pattern (no invented classes). Dropdown offers only **Normal / Birthday / Anniversary** as options — `"testimonial"` and `"purchase"` remain excluded from all manual UIs (reserved for the automated review-approval and order-checkout flows respectively, per the original Phase B1 design). Option `value` attributes are the exact lowercase backend literals; label text may be Capitalized for readability.
4. Change `PointsTool`'s `awardPoints` call to pass the `reasonType` state instead of the hardcoded `'normal'` literal.
5. Reset `reasonType` back to `'normal'` after a successful submit, matching the existing `delta`/`reason` reset behavior.

## Explicitly out of scope
- `PointsLedger.jsx`'s own inert "Give Points" panel — stays exactly as-is (Phase A UI shell, not wired to any mutation). Not touched in this task.
- Any backend change — `convex/customers.ts`'s `awardPoints` mutation already accepts `reason_type` as a parameter; no schema/mutation change needed.
- Offering "testimonial" or "purchase" as manual-UI-selectable options — permanently reserved for their respective automated flows.
- Any change to `points_ledger` schema, indexes, or other mutations.

## Verification plan
- `git diff` scoped to only `src/pages/merchant/Customers.jsx`.
- `npm run build` (cache-cleared) — confirm clean build, report exact CSS byte size.
- Live test: call `awardPoints` with `reason_type: "birthday"` and `"anniversary"` against a real test customer, confirm both accepted (not rejected for casing/enum mismatch), confirm a fresh `points_ledger` query records both with the correct `reason_type`.
- Confirm `PointsLedger.jsx` shows zero diff (untouched).
- Clean up all temporary test data created during verification.
