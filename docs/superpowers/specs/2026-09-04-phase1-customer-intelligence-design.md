# Phase 1 — Customer Intelligence Foundation — Design

Design doc — first build phase under the overall AI automation architecture
(`docs/superpowers/specs/2026-09-03-ai-automation-architecture-design.md`).
This doc does not change that architecture; it scopes what backend data
plumbing Phase 1 needs before any Gemini-calling code (Feature A/B/C) is
written.

No implementation in this task. Design proposal only — nothing in `convex/`
or `src/` is touched by this document.

---

## (a) Already live, no changes needed

Three data paths the AI features will need already exist, are already
indexed, and already read live Convex data on every call (no cached/stale
copy anywhere):

1. **Occasion status** — `users.birthday` / `users.anniversary`, mirrored
   into zero-padded `birthday_md` / `anniversary_md` (`convex/schema.ts`
   lines 52-63), indexed via `by_role_birthday_md` / `by_role_anniversary_md`
   (`convex/schema.ts` lines 100-106). Served by `getUpcomingBirthdays`
   (`convex/customers.ts` lines 442-459) and `getUpcomingAnniversaries`
   (lines 462-479), both merchant-session-gated queries that call the shared
   `findUpcoming` helper (lines 220-265), which does one or two indexed range
   reads via `upcomingMDRanges` (lines 150-170) to handle year-boundary
   wraparound (e.g. Dec 29 + 7 days reaching Jan 5) — never a full-table scan.

2. **Purchase history** — `orders` has a `by_user` index
   (`convex/schema.ts` line 155), and `convex/orders.ts` exports
   `getOrdersByUser` (lines 114-127): `args: { customerId, userId, token }`,
   guarded by `requireMerchantSession`, returns
   `.withIndex("by_user", (q) => q.eq("user_id", customerId)).order("desc").collect()`
   — all of one customer's orders, newest first, indexed.

3. **Points history** — `points_ledger` has a `by_customer` index
   (`convex/schema.ts` line 267), and `convex/customers.ts` exports
   `getPointsHistory` (lines 616-634): `args: { customer_id, userId, token }`,
   guarded, returns `.withIndex("by_customer", (q) => q.eq("customer_id", customer_id)).order("desc").collect()`,
   mapped into `{ id, userId, action, points, reason, createdAt }` rows.

**Why this matters for the architecture spec:** `2026-09-03-ai-automation-architecture-design.md`
§7 "Scalability Principles" states the rule as: *"No full-table scans: every
query used by an AI feature must go through an index (matches Phase 0's
fixes to getCustomers, getTodayOrders/getTodaySummary,
getUpcomingBirthdays/getUpcomingAnniversaries) — AI draft-generation reuses
those same indexed queries, never re-scans the full users/orders table
itself."* (line 42). Note: the existing spec does not label this constraint
with a numbered "Risk N" — it is stated directly as a §7 scalability rule,
not as a numbered risk elsewhere in that document. This design doc restates
it as-is rather than inventing a risk number that isn't in the source file.
All three data paths above already satisfy that rule today, with zero new
schema or index work needed — they give the AI everything it needs for
occasion-based and purchase-based logic by reading live Convex data on every
call (zero stale-copy risk, since nothing is cached or duplicated).

---

## (b) New: `getCustomerIntelligenceProfile` (design proposal, not code)

**Problem:** no existing Convex function combines a customer's profile +
orders + points history + occasion status into one call.
`getCustomerById` (`convex/customers.ts` lines 322-329) returns only the raw
customer row (via `toMerchantCustomer`, lines 47-68). Every future AI
feature that wants "everything about this customer" (draft generation,
personalization, lookbook ranking) would otherwise have to re-assemble the
same three-way join itself, in three different places, with three chances to
get the guard or the shape wrong.

**Proposed location: `convex/customers.ts`, not a new `convex/ai.ts`.**

Justification:
- `convex/ai.ts` (per the architecture spec §1) is reserved for *actions*
  that call the external Gemini API (`generateMessageDraft`,
  `generateLookbookRanking`) — it needs `fetch`, so it must be an action.
  `getCustomerIntelligenceProfile` does no external call and no AI
  generation; it is a pure read composed entirely of existing indexed
  Convex queries (`getCustomerById` + `getOrdersByUser` + `getPointsHistory`
  + the `findUpcoming` occasion logic). A pure data-read query belongs with
  the other customer-data queries it depends on, matching this file's
  existing pattern (`getCustomers`, `getCustomerById`, `getPointsHistory`
  already live here).
- Keeping it in `customers.ts` means it can call the existing internal
  helpers (`getCustomerDoc`, `toMerchantCustomer`, `findUpcoming`) directly
  as same-file functions rather than needing them exported/re-imported into
  a new module — smaller diff, no new file, no duplicated guard logic.
- `convex/ai.ts` stays scoped to "things that call Gemini," which matches
  the architecture spec's own framing of that file (§1: "One guarded Convex
  action ... per AI task"). This new function is not an AI task; it is the
  data plumbing an AI task will consume.

**Proposed shape** (design only — field names/types, not implementation):

```
getCustomerIntelligenceProfile
  args: { customerId: Id<"users">, userId: Id<"users">, token: string }
  guard: requireMerchantSession(userId, token) — same as every other
         merchant-only query in this file

  returns: {
    profile: {
      _id: Id<"users">,
      name: string,
      mobile: string,
      email: string | null,
      tier: "silver" | "gold" | "platinum",
      points: number,
      custom_tags: string[],
      whatsapp_consent: boolean,
      // NOTE: measurements / staff_notes deliberately EXCLUDED — confidential,
      // merchant-only fields with no legitimate AI-drafting use case (per
      // architecture spec §1: Gemini prompts get "name, tier, occasion type,
      // last-purchase tags — never staff_notes, never measurements").
    },
    occasions: {
      birthday: { date: string | null, is_upcoming: boolean, days_until: number | null },
      anniversary: { date: string | null, is_upcoming: boolean, days_until: number | null },
    },
    orders: {
      count: number,
      total_spent_paise: number,
      recent: Array<{
        _id: Id<"orders">,
        final_total: number,       // paise
        points_earned: number,
        created_at: number,        // epoch ms
      }>,   // most-recent-first, same order as getOrdersByUser; capped (e.g. last 10) to keep the payload bounded regardless of a customer's lifetime order count
    },
    points_history: {
      current_balance: number,
      recent: Array<{
        action: "earned" | "redeemed" | "adjustment",
        points: number,
        reason: string,
        createdAt: string,          // ISO string, same shape as getPointsHistory
      }>,   // most-recent-first, same cap rationale as orders.recent
    },
  }
```

Design notes:
- `orders.recent` and `points_history.recent` are capped (not the full
  history) so this function's response size stays bounded as a loyal
  customer accumulates hundreds of orders/ledger rows over years — this is
  the same "don't scale linearly with data growth" concern §7 raises for AI
  calls, applied to the response payload itself. `orders.count` /
  `total_spent_paise` / `points_history.current_balance` give the AI
  aggregate signal without needing the full list.
- `occasions.days_until` reuses the same `findUpcoming` computation already
  powering `getUpcomingBirthdays`/`getUpcomingAnniversaries` — no new
  date-window logic, just exposed per-customer instead of as a queue list.
- This is a genuinely new function, not a modification of
  `getCustomerById`/`getOrdersByUser`/`getPointsHistory` — all three keep
  existing, unchanged, for their current call sites (CRM UI). This is
  strictly additive.

---

## (c) Open decision: Cart & Likes

This is a **genuine unresolved fork for Saidul to decide** — this design doc
does not pick between the two options below, and no Phase 2+ code should
touch cart or likes until one is explicitly approved.

**Current state (confirmed by reading the code):**
- Cart: `src/pages/Lookbook.jsx` line 34, `const [cart, setCart] = useState([])`
  — pure React component state. Lost on refresh, never persisted anywhere,
  no Convex table.
- Likes: `src/lib/db.js`, `likeItem()` (lines 1057-1078) — toggles
  `item.likedBy` on the in-memory `state.catalogueItems` array and calls
  `emit()` (localStorage persistence only). Confirmed: no
  `client.mutation(...)` call anywhere in `likeItem()`, unlike
  `addStaffNote` in the same file which does call
  `client.mutation(api.customers.addStaffNote, ...)`. Likes are never
  written to Convex.

**Option A — Build real Convex tables now, as part of Phase 1.**
Add a `cart_items` table (e.g. keyed on `customer_id`, holding item refs +
qty) and a `likes` join table (keyed on `customer_id` / `item_id`), wired to
real mutations, replacing both the ephemeral `useState` cart in
`Lookbook.jsx` and the localStorage-only `likeItem()` in `db.js`. This would
give any future AI feature durable, cross-session cart/likes signal
immediately.

**Option B — Defer both.**
Feature A (AI-drafted WhatsApp messages — the next thing scheduled to be
built, per the architecture spec §2) needs zero cart/likes data: its prompt
context is "name, tier, occasion type, last-purchase tags" (§1), all of
which come from (a)/(b) above. Only Feature B (AI-customized lookbooks,
§3 — "several phases away") would plausibly use cart/likes signal, and its
own design doc has not been written yet. Under Option B, cart/likes tables
get built later, scoped precisely to what Feature B's eventual design
specifies (exact shape driven by what that feature actually needs), instead
of guessing the schema now and possibly having to migrate it once Feature
B's real requirements are known.

**This design doc does not decide between A and B.** Both options are
documented here for Saidul's explicit approval before any Phase 2+ code
touches cart or likes, per the project's spec-driven HARD-GATE rule
(CLAUDE.md §5.12 — no code until a design is presented and approved).

---

## (d) Scalability principles carried forward

The following are the already-approved §7 constraints from
`docs/superpowers/specs/2026-09-03-ai-automation-architecture-design.md`
(restated/closely paraphrased here, not redesigned or added to — see that
file for the authoritative text):

- **No full-table scans:** every query used by an AI feature must go
  through an index (matches Phase 0's fixes to `getCustomers`,
  `getTodayOrders`/`getTodaySummary`, `getUpcomingBirthdays`/
  `getUpcomingAnniversaries`) — AI draft-generation reuses those same
  indexed queries, never re-scans the full `users`/`orders` table itself.
- **No single hot document:** AI-related data (drafts, lookbook rankings,
  events) is stored as one row per customer/order/event, never aggregated
  into one shared settings-style document that every write would contend on.
- **Batched, rate-limited AI calls:** the daily draft-generation cron and
  the per-order lookbook-ranking trigger call Gemini in small batches (e.g.
  per occasion-day, per single order) with a request-rate cap, so cost and
  latency stay flat as customer count grows from tens to 1000+.
- **Every new table is created with the indexes its actual query patterns
  need from day one**, not added retroactively after a slowdown is found.
- **Stateless guarded actions:** all new Gemini-calling functions are
  Convex actions/mutations that take no in-memory state between calls
  (matches the existing `requireMerchantSession` pattern) — safe to run any
  number of them in parallel as load grows.
- These rules apply to Phases 1-5 equally; Phase 0's four fixes are the
  concrete first application of the same principle to the pre-existing code.

**Applied to this doc's proposal:** `getCustomerIntelligenceProfile`
(section b) must also follow all of the above — it is built entirely out of
already-indexed reads (`getCustomerById` by `_id`, `getOrdersByUser` via
`by_user`, `getPointsHistory` via `by_customer`, occasion status via
`by_role_birthday_md`/`by_role_anniversary_md`), performs no full-table
scan, introduces no new hot document, and returns a size-bounded payload
(capped `recent` lists, per the note in section b) so its cost stays flat as
any one customer's order/ledger history grows over time. It makes no
external calls itself, so the "batched, rate-limited AI calls" and
"stateless guarded actions" rules apply to it only insofar as any future
Gemini action that calls it must itself remain batched/rate-limited and
stateless — this function itself is a synchronous indexed read, not an AI
call.

## Addendum 2026-09-04 — Cart/Likes decision

User has chosen Option B: defer cart and likes entirely. Feature A (WhatsApp notifications) needs neither. Only Feature B (Personalized Lookbook, Phase 4) will need them — they will be designed and built at that point, scoped exactly to Feature B's real requirements, not guessed now. No cart/likes code, schema, or backfill is part of Phase 1.
