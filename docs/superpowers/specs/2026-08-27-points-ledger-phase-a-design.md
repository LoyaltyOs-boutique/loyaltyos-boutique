# Design Doc: Points Ledger — Phase A (Frontend Shell)

Date: 2026-08-27
Branch: feat/whatsapp-cloud-api

## Problem
Merchant needs a dedicated "Points Ledger" section to configure point-earning rates (purchase, birthday, anniversary, testimonial) per tier, and to eventually manually award points to any customer. Phase A builds the UI shell and wires the rate-configuration to the real, already-existing settings mechanism. Phase B (a separate future task) will add real manual-award logic and fix known pre-existing bugs (testimonial points hardcoded in reviews.ts, purchase points ignoring tier multiplier in orders.ts, the existing Points Tool being local-only/not Convex-backed).

## Scope — Phase A only
1. New sidebar nav entry "Points Ledger", inserted between "Templates" and "Settings & Support" in src/components/merchant/Shell.jsx, following the exact existing {to, label, icon} array pattern.
2. New page component (e.g. src/pages/merchant/PointsLedger.jsx) with two sections:
   a. "Point Rules" — tier-structured (Silver/Gold/Platinum/Global, matching the existing tab pattern in Settings.jsx) editable fields for: purchasePercent (reuse existing field), birthdayBonus (reuse existing field), a NEW anniversaryBonus field, a NEW testimonialBonus field. This section is REAL — it reads/writes via the existing getSettings/updateSettings mutation and SETTINGS_KEYS.LOYALTY_RULES mechanism already used by Settings.jsx, so Save genuinely persists to Convex.
   b. "Give Points" — a manual-award form UI (customer picker, reason/type dropdown: Normal/Birthday/Anniversary/Testimonial, amount field, note field) — UI ONLY. Submit button is disabled or shows "Coming soon" — no new mutation, no change to the existing Points Tool, no real point-crediting in this phase.
3. Schema change: add anniversaryBonus and testimonialBonus fields to the tiers object in convex/schema.ts's settings validation (or wherever purchasePercent/birthdayBonus are currently typed) and to DEFAULT_SETTINGS in convex/settings.ts, following the exact existing field pattern (per-tier: global/silver/gold/platinum).

## Pin-to-pin UI requirement
Every visual element must reuse exact existing classNames verbatim — no invented styles. Reference (audited and confirmed):
- Page header: `<div className="eyebrow mb-1">...</div><h1 className="luxe-title text-3xl">Points Ledger</h1>` pattern (Settings.jsx style)
- Section cards: `<div className="card p-6">` 
- Tier tabs: base `'px-4 py-2 text-[10px] tracking-wide2 uppercase border transition-colors'`, active `'border-ink bg-ink text-white'`, inactive `'border-line text-steel hover:border-ink hover:text-ink'` (Settings.jsx pattern, via cls() helper)
- Rate input with unit suffix: `className="input !w-24 text-right pr-7 disabled:opacity-40"` inside `<div className="relative">` with an absolute-positioned unit label span (Settings.jsx pattern)
- Save button: `<button className="btn-ink">{saved ? '✓ Saved' : 'Save tier'}</button>` pattern
- Give Points form inputs: match existing PointsTool styling (Customers.jsx) — `.label`, `.input`, `grid sm:grid-cols-2 gap-4 mb-4` layout
- Nav entry: exact Shell.jsx NavLink className function (active: `'border-ink text-ink bg-mist font-medium'`, inactive: `'border-transparent text-steel hover:text-ink'`), icon span `<span className="text-gold text-sm w-4 text-center">`

## Explicitly out of scope (Phase B)
- Real manual point-award logic (Give Points Submit button)
- Fixing the Points Tool to be Convex-backed instead of local-only
- Fixing testimonial points being hardcoded to 50000 in reviews.ts instead of sourced from settings
- Fixing orders.createOrder to apply the tier purchasePercent multiplier instead of a flat rate
- Any redemption logic (discount/wallet/referral/perks) — separate future phase per the shared Points Redemption Rulebook
