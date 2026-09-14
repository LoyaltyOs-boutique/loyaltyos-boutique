# Customer Activity Intelligence — Design

Design proposal only. Nothing in `convex/` or `src/` is touched by this
document. Builds on top of, and does not modify, the approved
`2026-09-03-ai-automation-architecture-design.md`,
`2026-09-04-phase1-customer-intelligence-design.md`,
`2026-09-04-dashboard-notifications-design.md`, and the real (as-deployed)
`convex/crons.ts` daily-cron pattern.

Scope requested: real backend tracking of cart-add, likes, lookbook views,
and event-link clicks (purchases already exist via `orders`); a daily
AI-generated per-customer activity summary; a weekly "most active customers"
bell notification; a new Dashboard section listing active customers where
clicking a row opens that customer's AI summary.

---

## 0. Grounding — what Part A of the audit actually found

(Full raw findings are in the audit report accompanying this doc. Summary of
what this design is built on:)

- `likeItem()` (`src/lib/db.js:1057-1078`) and cart state (`src/pages/Lookbook.jsx:34`,
  `const [cart, setCart] = useState([])`) are confirmed **still** frontend-only.
  `likeItem()` was touched once since the Phase 1 audit (commit `c0cdb03`,
  2026-09-02, "convert like counter to a real per-customer toggle") but that
  change only added the `likedBy` per-customer dedup array to local state —
  `grep -n "cart" src/lib/db.js` returns zero matches, and `likeItem()` still
  has no `client.mutation(...)` call anywhere in its body. Both remain
  ephemeral, zero Convex persistence.
- No existing tracking of "customer viewed a lookbook" or "customer clicked
  an event join-link" exists anywhere. The only near-miss is `campaigns.clicks_count`
  (`convex/schema.ts:197`), a legacy per-campaign **aggregate counter** (not
  per-customer, not per-event) that is initialized to `0` in `src/lib/db.js:1507`
  and never incremented by any mutation — dead weight from the old broadcast
  feature, nothing to build on.
- The daily-cron pattern in `convex/crons.ts` (confirmed live, post `6a35dbc`)
  uses `crons.cron("<name>", "35 18 * * *", internal.crons.<fn>, {})` — a
  fixed 5-field cron expression, wall-clock 00:05 IST — never `.interval()`
  or `.daily()`/`.hourly()`/`.weekly()` (forbidden by this project's own
  `convex/_generated/ai/guidelines.md:372-396`). Each cron follows the same
  three-part shape: an `internalQuery` dedup check keyed on a compound tuple
  index (`hasExistingDraft`/`hasExistingNotification`), an `internalMutation`
  insert, and an `internalAction` body that fetches candidates via one
  indexed read, filters, caps at a fixed batch size, and paces any external
  (Gemini) calls with a fixed delay.
- `src/pages/merchant/Dashboard.jsx`'s "Recent activity" section (lines
  134-170) is the **only** click-a-row-to-expand pattern anywhere in `src/`
  (confirmed via `grep -rn "onClick.*=>.*set.*Id(" src/pages/merchant/*.jsx`
  — Dashboard.jsx is the only hit). It renders a `<table className="tbl ...">`
  inside a `<section>` / `<div className="card overflow-x-auto">` wrapper,
  each `<tr>` has `onClick={() => setActivityUserId(e.userId)}
  className="cursor-pointer hover:bg-mist"`, and the expand target is
  `<Modal open onClose={...} title={...} wide><Ledger userId={...} db={db} /></Modal>`
  — `Modal` (`src/components/ui.jsx:42-58`) and `Ledger`
  (`src/pages/merchant/Customers.jsx:683-731`, exported for exactly this
  reuse) are both existing, shared components.
- The confidentiality guard is structural, not just a comment: `generateMessageDraft`
  (`convex/ai.ts:349-424`) takes only `{ customerName, tier, occasion }` as
  args — it never fetches the customer document, so there is no code path by
  which `measurements`/`staff_notes` could reach it. `getCustomerIntelligenceProfile`
  (`convex/customers.ts:987-1056`) explicitly destructures `measurements`/`staff_notes`
  out of `toMerchantCustomer(doc)`'s result before returning (`const { measurements: _measurements, staff_notes: _staff_notes, ...customer } = toMerchantCustomer(doc);`).
- `getCustomerIntelligenceProfile` is real and deployed (not just a design
  proposal) — `query` in `convex/customers.ts`, guarded by
  `requireMerchantSession`, returns **full** (not capped, contrary to the
  Phase 1 design doc's proposal) order history and points-ledger history plus
  a computed `upcoming_occasion`. See §6 below for the extend-vs-new
  recommendation this finding drives.
- `notifications` table (`convex/schema.ts:371-388`) has `occasion: v.union(v.literal("birthday"), v.literal("anniversary"))`
  — a strict two-value union. A "most active this week" notification is
  neither, so it cannot be written into this table without a schema change.
  See §c below.

---

## a. Schema

### New table: `customer_activity_events`

```ts
customer_activity_events: defineTable({
  customer_id: v.id("users"),
  action: v.union(
    v.literal("cart_add"),
    v.literal("like"),
    v.literal("lookbook_view"),
    v.literal("event_link_click"),
  ),
  catalogue_item_id: v.optional(v.id("catalogue_items")), // cart_add / like
  lookbook_id: v.optional(v.id("lookbooks")),              // lookbook_view
  event_id: v.optional(v.id("events")),                    // event_link_click
  created_at: v.number(), // epoch ms
})
  // Primary read pattern: "this customer's activity in [start, now]" for the
  // daily summary + weekly most-active scan. Equality prefix on customer_id,
  // then a range on created_at — same "equality field first" index style as
  // by_role_birthday_md / by_customer_occasion_date elsewhere in schema.ts.
  .index("by_customer_created_at", ["customer_id", "created_at"])
  // Secondary read pattern: the weekly cron needs "all activity in the last
  // 7 days across all customers" to find who's active — a range-only index
  // on created_at (mirrors orders' by_created_at, schema.ts:184) avoids a
  // full-table scan for that global scan.
  .index("by_created_at", ["created_at"]),
```

**Purchases are explicitly NOT duplicated into this table.** The summary
function reads `orders` directly via the existing `by_user` index
(`convex/schema.ts:178`, same index `getOrdersByUser`/`getCustomerIntelligenceProfile`
already use) for purchase history. `customer_activity_events` only ever holds
the four non-purchase action types listed above — one source of truth per
concern, no risk of the two ever drifting out of sync.

Field choices explained:
- `catalogue_item_id`/`lookbook_id`/`event_id` are all `v.optional` because
  exactly one (or, for `lookbook_view`, possibly none if it's a whole-catalogue
  view rather than a single lookbook) applies per `action` value — this
  mirrors the existing optional-FK style already used on `reviews.catalogue_item_id`
  (`convex/schema.ts:224`, "which product this review is about (type
  'product' only)").
- No `v.union`-discriminated variant type (e.g. one object per action) was
  chosen over flat optional fields, matching this codebase's existing
  preference for flat optional columns over tagged unions in table
  definitions (`reviews`, `orders` follow the same flat-optional-field
  style) — keeps read code simple (`row.catalogue_item_id` directly) instead
  of a `switch` on a nested union at every read site.

---

## b. Backend

### b.1 — Replacing today's frontend-only cart_add / like with real writes

**`like` — convert `likeItem()` to the hydration bridge pattern.**
`src/lib/db.js`'s `likeItem(userId, itemId)` (lines 1057-1078) keeps its
exact synchronous signature and local-state toggle behavior (the
`item.likedBy` dedup logic added in `c0cdb03` is untouched — it's still the
source of truth for the instant UI response). After the existing
`emit()` call, add a **fire-and-forget** Convex write, following the exact
pattern `addStaffNote` (same file, lines 1088-1108) already uses for
"update local state instantly, persist in background, swallow errors":

```js
// after emit():
const client = getConvex();
const session = merchantIsIrrelevantHereSinceThisIsCustomerFacing; // see note below
if (client) {
  try {
    client.mutation(api.customerActivity.trackActivity, {
      customerId: convexId, // resolved the same way addStaffNote resolves user.convexId
      action: alreadyLiked ? "unlike_noop" /* see note */ : "like",
      catalogueItemId: item.convexId || item.id,
    }).catch(() => { /* tracking failure must never surface to the customer */ });
  } catch { /* same */ }
}
```

Note: only the **first-like** branch (the one that already calls
`pushEvent(...)` for the merchant feed, matching the existing "unlike is a
state change, not an activity" reasoning documented in `likeItem()`'s own
comment block) writes a `customer_activity_events` row with
`action: "like"`. The unlike branch writes nothing — this keeps the new
table's semantics identical to the existing local activity-feed semantics
(one event per genuine "first like", not one per click), so a customer
repeatedly toggling like/unlike does not inflate the activity-events table
any more than it inflates today's `pushEvent` feed.

**`cart_add` — new tracking call from `Lookbook.jsx`'s existing add-to-cart
handler.** The cart itself (`useState([])`, line 34) stays exactly as-is —
this is intentionally NOT "Option A" from the Phase 1 spec (a durable
`cart_items` table replacing `useState`). It is a strictly additive,
non-blocking **tracking side-effect** fired at the same point the existing
add-to-cart handler already runs, calling a new `trackCartAdd(customerId,
catalogueItemId)` bridge function in `db.js` that fires
`client.mutation(api.customerActivity.trackActivity, {...action: "cart_add"...})`
and swallows any failure. The cart's own local `setCart(...)` call is never
awaited on, gated by, or rolled back based on the tracking call's outcome —
they are sequential but independent; a tracking failure cannot prevent or
undo the actual cart-add.

**Why not persist the cart itself:** the Phase 1 spec's Option B decision
(user-approved, `2026-09-04-phase1-customer-intelligence-design.md`
Addendum) deferred building a durable `cart_items` table until a feature
that actually needs cart *state* (not just cart *activity signal*) is
designed — Feature B (personalized lookbook). This task only needs "did
this customer add something to their cart, and when" as an activity signal
for the daily/weekly summary, which `customer_activity_events` rows fully
supply without reopening that deferred decision.

### b.2 — New lightweight tracking calls: `lookbook_view`, `event_link_click`

New file `convex/customerActivity.ts` (parallel to `notifications.ts` — a
small, single-purpose file, not folded into `customers.ts` which is already
large):

```ts
export const trackActivity = mutation({
  args: {
    customerId: v.id("users"),
    action: v.union(
      v.literal("cart_add"), v.literal("like"),
      v.literal("lookbook_view"), v.literal("event_link_click"),
    ),
    catalogueItemId: v.optional(v.id("catalogue_items")),
    lookbookId: v.optional(v.id("lookbooks")),
    eventId: v.optional(v.id("events")),
  },
  handler: async (ctx, args) => {
    // Deliberately NO requireMerchantSession — the caller here is the
    // CUSTOMER's own browser session (Lookbook.jsx / event-link landing),
    // which has no merchant token at all (it authenticates via magic-link
    // token, a completely separate mechanism — see auth.ts's
    // validateMagicToken). This mutation is intentionally public/unguarded,
    // the same posture createReview and generateMagicTokenSelf already have
    // (convex/rateLimits.ts's own comment: "public + intentionally
    // unguarded ... worst case is spam, not a data/security incident").
    await ctx.db.insert("customer_activity_events", { ...args, created_at: Date.now() });
  },
});
```

Both `lookbook_view` and `event_link_click` are invoked from the frontend as
fire-and-forget calls at the point the customer opens `Lookbook.jsx` (mount
effect) or clicks through an event join-link (`getEventAccess`'s consuming
page), using the exact non-blocking pattern from §b.1 — call, attach
`.catch(() => {})`, never `await` in a way that gates rendering. This
mirrors `hydrateCatalogue()`'s own fire-and-forget background-fetch style
(`src/lib/db.js:1007-1043`, `.catch(() => { catalogueHydrating = false; })`)
applied to a write instead of a read.

**Rate limiting:** `trackActivity` is public/unguarded like `createReview`,
so per this project's existing defense-in-depth posture
(`2026-09-05-rate-limiting-design.md`, `convex/rateLimits.ts`) it should get
its own token-bucket entry (e.g. `trackActivityByCustomer: { kind: "token
bucket", rate: 60, period: MINUTE, capacity: 20 }` — generous enough that
normal browsing/liking never hits it, but bounds a scripted-abuse write
flood). This is a recommendation for the implementation task, not a design
this doc finalizes — exact numbers are an implementation-time judgment call
matching how `4fe1273` picked numbers for `createCustomer`/`createReview`.

### b.3 — `generateCustomerActivitySummary` (daily, per-customer AI summary)

New `internalAction` in `convex/ai.ts` (co-located with `generateMessageDraft`,
not a new file — this IS an AI-Gemini-calling function, matching `ai.ts`'s
established scope per the Phase 1 doc's own file-placement reasoning: "`ai.ts`
... is reserved for actions that call the external Gemini API"):

```ts
export const generateCustomerActivitySummary = internalAction({
  args: {
    customerId: v.id("users"),
    customerName: v.string(),
    tier: v.union(v.literal("silver"), v.literal("gold"), v.literal("platinum")),
  },
  handler: async (ctx, { customerId, customerName, tier }): Promise<string | null> => {
    // Fetch ONLY this customer's last-7-days activity_events (indexed) +
    // orders (indexed by_user) — same confidentiality posture as
    // generateMessageDraft: no measurements/staff_notes are ever read here,
    // because this function's own DB reads never touch those fields (it
    // reads customer_activity_events + orders, neither of which contains
    // them) — structurally impossible to leak, not just policy.
    const activity = await ctx.runQuery(internal.customerActivity.getRecentActivityInternal, {
      customerId, sinceMs: Date.now() - 7 * 24 * 60 * 60 * 1000,
    });
    const orders = await ctx.runQuery(internal.customers.getRecentOrdersInternal, { customerId });
    // ... build prompt from activity counts (by action type) + order count/total,
    // truncate free-text fields via the existing truncateForPrompt/PROMPT_FIELD_MAX
    // helpers (ai.ts:124), wrap in DATA_NOT_INSTRUCTIONS_NOTICE (ai.ts:67) —
    // same hardening as the Part F #3/#4 fix (commit f15a52a) already applies
    // to generateMessageDraft/generateEventDraft.
    return callGemini(prompt); // reuses the shared helper, fails gracefully to null
  },
});
```

Storage: the generated summary is written onto a **new field on
`customer_activity_events`'s sibling** — not a new table. Proposed: reuse
`ai_message_drafts`' *pattern* but as a distinct concept, stored as one row
per customer per day on a small new table `customer_activity_summaries`
(`customer_id`, `summary_text`, `generated_at`, indexed
`by_customer` for latest-lookup) — kept separate from `ai_message_drafts`
because a WhatsApp draft (customer-facing, sendable) and an internal
merchant-facing activity summary (never sent to the customer) are different
concepts with different consumers, matching this doc's §6 reasoning for why
`getCustomerIntelligenceProfile` itself should also stay separate rather
than growing to hold this.

### b.4 — `getActiveCustomers` (merchant-guarded query)

New query in `convex/customerActivity.ts`:

```ts
export const getActiveCustomers = query({
  args: { userId: v.id("users"), token: v.string(), days: v.optional(v.number()) },
  handler: async (ctx, { userId, token, days }) => {
    await requireMerchantSession(ctx, userId, token); // same guard as every merchant query
    const since = Date.now() - (days ?? 7) * 24 * 60 * 60 * 1000;
    const events = await ctx.db
      .query("customer_activity_events")
      .withIndex("by_created_at", (q) => q.gte("created_at", since))
      .collect();
    // group by customer_id, count, join latest customer_activity_summaries row
    // per customer (indexed by_customer lookup, not a full scan) — return
    // [{ customerId, name, activityCount, latestSummary }], sorted by count desc.
  },
});
```

Indexed range read only (`by_created_at`), no `.collect()` over an unbounded
table — bounded by the `days` window, matching Part F #9's stated concern
about unbounded `.collect()` reads elsewhere in the codebase (this new query
deliberately does not repeat that mistake).

### b.5 — Weekly cron: "most active this week" notification

New section in `convex/crons.ts`, mirroring `generateDailyNotifications`'s
exact three-part shape (`hasExisting*` internalQuery → `insert*`
internalMutation → `internalAction` body), registered via:

```ts
crons.cron("generate weekly most-active notification", "35 18 * * 1", internal.crons.generateWeeklyActivitySummary, {});
```

(`"35 18 * * 1"` = same 18:35 UTC / 00:05 IST wall-clock time as the two
existing daily crons, but `* * 1` restricts it to Mondays — the same
`crons.cron()` fixed-expression mechanism, just a different day-of-week
field, no new scheduling primitive introduced.)

**Notification storage — schema decision, stated explicitly per the task's
own instruction to justify any extension:** `notifications.occasion` is a
strict `v.union(v.literal("birthday"), v.literal("anniversary"))`
(`convex/schema.ts:373`) — confirmed by reading the schema, not assumed. A
"most active this week" notification is neither value, so it cannot be
written as-is. Recommended fix: widen the union to
`v.union(v.literal("birthday"), v.literal("anniversary"), v.literal("weekly_activity"))`
and make `occasion_date` (currently always an "M-D" string) accept the ISO
week-start date for this new type instead (still a `v.string()`, no type
change, just a different string format for this one occasion value) — this
is a minimal, additive, non-breaking union-widening, not a schema rewrite:
existing `birthday`/`anniversary` rows and every existing read
(`getNotifications`, `markAllSeen`, `deleteNotification`, the bell UI) stay
byte-identical, since they only ever filter/render on the fields that
already exist. The dedup index `by_customer_occasion_date` is reused as-is;
for a weekly summary notification `customer_id` can be a placeholder/anchor
value (e.g. the single top customer, or omitted entirely if a genuinely
customer-agnostic "boutique-wide" notification is preferred — an
implementation-time judgment call, since the existing table is
customer-scoped by design and a "top N customers" digest doesn't map 1:1
onto one `customer_id`). This doc flags the mapping question explicitly
rather than picking silently, since it's a real design fork the
implementer/reviewer should confirm before writing code.

Batch/scale discipline for this cron: reads `customer_activity_events` via
`by_created_at` for the last 7 days (indexed, same as `getActiveCustomers`),
computes counts per customer in memory (bounded by one week's event volume,
not the full table), caps the "most active" list at a fixed N (e.g. top 10)
before building the notification message — no unbounded loop, no per-customer
Gemini call in this cron (the message is a plain templated string, same
`generateDailyNotifications` posture: "no AI, no consent gate").

---

## c. Frontend

### c.1 — Dashboard section

New section in `src/pages/merchant/Dashboard.jsx`, inserted directly after
the existing "Recent activity" `<section>` (after line 170's closing
`</section>`, before the activity-history `<Modal>` block at line 175) using
the **exact same classNames** found in Part A:

```jsx
<section>
  <div className="eyebrow mb-1">This week</div>
  <h2 className="luxe-title text-2xl mb-4">Most active customers</h2>
  <div className="card overflow-x-auto">
    <table className="tbl min-w-[560px]">
      <thead><tr><th>Client</th><th>Activity</th><th>Summary</th></tr></thead>
      <tbody>
        {activeCustomers.map((c) => (
          <tr key={c.customerId} onClick={() => setSummaryCustomerId(c.customerId)} className="cursor-pointer hover:bg-mist">
            <td><span className="font-medium text-sm">{c.name}</span></td>
            <td className="text-sm text-ink/75">{c.activityCount} actions</td>
            <td className="text-xs text-steel truncate max-w-xs">{c.latestSummary ? 'View summary' : 'No summary yet'}</td>
          </tr>
        ))}
        {activeCustomers.length === 0 && (
          <tr><td colSpan={3} className="text-sm text-steel text-center py-6">No activity this week.</td></tr>
        )}
      </tbody>
    </table>
  </div>
</section>
```

`section > .eyebrow.mb-1 > h2.luxe-title.text-2xl.mb-4 > .card.overflow-x-auto > table.tbl.min-w-[560px]`
pin-to-pin matches the existing "Recent activity" section's structure
verbatim (Dashboard.jsx lines 137-141).

### c.2 — Click-to-expand

Reuses the **exact** pattern already in Dashboard.jsx (lines 39, 58, 175-179)
for `activityUserId`/`activityUser`/the `Ledger` modal — same `useState(null)`
+ truthy-conditional `<Modal>` shape, just a new sibling state variable
(`summaryCustomerId`) and a new lightweight summary-display component
instead of `<Ledger>`:

```jsx
{summaryCustomer && (
  <Modal open onClose={() => setSummaryCustomerId(null)} title={`${summaryCustomer.name} — activity summary`}>
    <p className="text-sm text-ink/80">{summaryCustomer.latestSummary || 'No summary generated yet.'}</p>
  </Modal>
)}
```

No new expand primitive is introduced — `Modal` (`src/components/ui.jsx:42-58`)
is reused as-is, same as the existing Recent Activity modal reuses it.

---

## d. Explicit non-negotiables

- **No AI call ever sees `measurements`/`staff_notes`.** `generateCustomerActivitySummary`'s
  own DB reads (`customer_activity_events`, `orders`) never touch those
  fields — this is structural (the tables literally don't have those
  columns), the same structural guarantee `generateMessageDraft` already has
  by only accepting `{customerName, tier, occasion}` as args.
- **Tracking must be genuinely non-blocking.** Every `trackActivity` call
  from the frontend (`like`, `cart_add`, `lookbook_view`, `event_link_click`)
  is fire-and-forget with `.catch(() => {})` — a Convex write failure (network
  down, rate-limited, deployment blip) must never throw into the calling
  code path, never delay `setCart(...)`/`emit()`, and never change what the
  customer sees. The like-toggle and add-to-cart UX must keep working
  exactly as today even with zero connectivity — matching the "local
  fallback should ONLY trigger on network failure, never surface to the
  user" lesson already documented in CLAUDE.md §12.4 and the existing
  `addStaffNote`/`hydrateCatalogue` fire-and-forget style this design
  copies.
- **Weekly cron follows the same dedup/scalability discipline as existing
  daily crons:** indexed reads only (`by_created_at`, `by_customer_created_at`),
  capped batch size (top-N active customers, not unbounded), no Gemini call
  in the notification cron itself (plain templated string, matching
  `generateDailyNotifications`'s "no AI, no consent gate" posture), and a
  `hasExisting*`/`insert*` dedup pair keyed on the same
  `by_customer_occasion_date`-style tuple index so re-running the cron never
  duplicates a notification.

---

## e. Zero-regression guarantee

Byte-identical, unchanged:
- Like-toggle UX in `Lookbook.jsx`/`likeItem()` — same synchronous local
  toggle, same `pushEvent` merchant-feed behavior, same visual response.
  Only a new fire-and-forget Convex write is appended after the existing
  `emit()` call; nothing before it changes.
- Add-to-cart UX — `cart` stays a plain `useState([])`; only a sibling,
  independent tracking call is added at the existing add-to-cart call site.
- `Lookbook.jsx`'s existing checkout flow (`checkout()` in `db.js`, lines
  1111+) — untouched, no changes proposed anywhere in this doc.
- Every existing Dashboard.jsx section/card (Delight Banner, Action chips,
  Metrics ribbon, Pending review approval, Recent activity + its modal) —
  the new "Most active customers" section is inserted as an additional
  sibling `<section>`, nothing existing is restyled, reordered ahead of, or
  displaced.
- `getCustomerById`, `getOrdersByUser`, `getPointsHistory`,
  `getCustomerIntelligenceProfile`, `generateMessageDraft`,
  `generateDailyDrafts`, `generateDailyNotifications` — all untouched;
  every new function proposed here is additive (new table, new file, new
  cron section, new query), matching the Phase 1 doc's own "ADDITIVE ONLY"
  posture for the same reasons.

---

## f. Scalability

- `customer_activity_events` has two purpose-built indexes
  (`by_customer_created_at`, `by_created_at`) chosen specifically for the two
  real read patterns this feature needs (per-customer window read; global
  weekly scan) — no query in this design does a full-table `.collect()`
  without an index or a bounding range.
- `getActiveCustomers` and the weekly cron both bound their read to a fixed
  `days`/7-day window via `by_created_at` range queries — cost stays flat as
  historical event volume grows over months/years, since old rows fall
  outside the range and are never scanned.
- The weekly cron caps its "most active" output at a fixed top-N before
  building any notification content, and makes zero Gemini calls itself
  (only `generateCustomerActivitySummary`, the separate daily per-customer
  summary job, calls Gemini — and that job should follow `generateDailyDrafts`'s
  existing `MAX_DRAFTS_PER_RUN`-style cap + `GEMINI_CALL_DELAY_MS`-style
  pacing, sequential not concurrent, exact numbers an implementation-time
  judgment call as they were for the existing cron).
- `trackActivity` writes are single-document inserts with no read-modify-write
  contention (no shared counter document is patched on every like/cart-add —
  avoids the "no single hot document" principle violation the architecture
  spec's §7 warns against).
