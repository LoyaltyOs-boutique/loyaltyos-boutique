# Dashboard Notifications (Bell Icon) — Design Spec

Date: 2026-09-04
Branch: feat/ai-automation-gemini-phase
Status: DRAFT — pending user approval (per CLAUDE.md 5.12 spec-driven hard-gate; no code until approved)

## 0. What this is

A bell icon on the merchant Dashboard (Delight Desk) that shows daily
birthday/anniversary reminders **for the merchant to see** — internal-only,
non-AI, no Gemini call anywhere in this feature. This doc is grounded in a
read-only audit (Part A) performed on this branch; every claim below cites
the exact file/line it came from.

---

## Part A findings (audit, read-only — no files edited)

### A1/A2 — Where does the header/top-right area actually live?

**Answer: `src/components/merchant/Shell.jsx` owns the shared header/top bar
across ALL merchant pages — not Dashboard.jsx.**

- `Dashboard.jsx` (`src/pages/merchant/Dashboard.jsx`) has **no top-right
  header row of its own**. Its only page-level header-ish element is the
  "Delight Banner" section (lines 63-77), a `<section className="card
  bg-ink text-white px-6 sm:px-8 py-8 relative overflow-hidden">` with an
  absolutely-positioned "＋ New client" button:
  ```
  <button
    onClick={() => navigate('/merchant/onboarding')}
    className="absolute top-4 right-4 sm:top-5 sm:right-5 btn-gold !py-2 text-[10px]"
  >
    ＋ New client
  </button>
  ```
  (Dashboard.jsx:65-70) — this is scoped to the banner card, not a global
  top bar, and is page-specific (only rendered on Dashboard).

- `Shell.jsx` (`src/components/merchant/Shell.jsx`) wraps every merchant
  page (`<main className="lg:ml-60"><div className="max-w-6xl mx-auto
  px-4 sm:px-6 py-6 lg:py-8">{children}</div></main>`, Shell.jsx:92-93) and
  owns two real header-like bars:
  - **Mobile top bar** (Shell.jsx:51-54):
    ```
    <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between bg-white border-b border-line px-4 py-3">
      <img src={BRAND.logo} alt="85 Lansdowne" className="h-7 object-contain" />
      <button onClick={() => setOpen(true)} className="btn-ink !px-3 !py-1.5 text-[10px]">☰ Menu</button>
    </div>
    ```
  - **Desktop sidebar top block** (Shell.jsx:57-61), not a horizontal top
    bar but the closest "header" equivalent on desktop:
    ```
    <div className="px-5 py-6 border-b border-line">
      <img src={BRAND.logo} alt="85 Lansdowne" className="h-8 object-contain" />
      <div className="eyebrow mt-3">LoyaltyOS · Boutique CRM</div>
    </div>
    ```
  - There is **no persistent desktop top-right header row** currently — the
    desktop layout is sidebar (left, `fixed inset-y-0 left-0 w-60`) + content
    (`lg:ml-60`), with no top strip above the content on desktop.

**Conclusion for placement:** since Shell.jsx wraps every merchant page and
Dashboard.jsx has no reusable top-right slot, a bell that should be visible
"on the Dashboard" per the task description will live in Shell.jsx's mobile
top bar (`flex items-center justify-between`, add the bell as a new
flex child before/after the ☰ Menu button) for mobile, and a new small
top-right row added to Shell.jsx's `<main>` content wrapper for desktop —
NOT inside Dashboard.jsx's banner card, since that card is page-specific and
a merchant should plausibly see the bell from any merchant page, matching
Shell.jsx's actual ownership of shared chrome. See §(c) for the concrete
plan.

### A3 — "Jump to Customers page with a tab pre-selected" pattern

**Navigating side** — `src/pages/merchant/Dashboard.jsx:82`:
```jsx
<button onClick={() => navigate('/merchant/customers', { state: { tab: 'reviews' } })} className="chip">
```
(Full chip block: Dashboard.jsx:82-86 — passes `location.state.tab`.)

Note: the birthday/anniversary chips on the same Dashboard (lines 87-96)
use a **different** state key, `q`, not `tab`:
```jsx
<button onClick={() => navigate('/merchant/customers', { state: { q: todayList('b') } })} className="chip">
...
<button onClick={() => navigate('/merchant/customers', { state: { q: todayList('a') } })} className="chip">
```
where `todayList(kind)` (Dashboard.jsx:184-189) builds a marker string like
`b:8-27` or `a:8-27` for today's date — this drives the **search box** (`q`),
not the tab filter.

**Receiving side** — `src/pages/merchant/Customers.jsx:26-28`:
```jsx
const location = useLocation();
const [q, setQ] = useState(location.state?.q || '');
const [filter, setFilter] = useState(location.state?.tab === 'reviews' ? 'reviews' : 'all');
```
`location.state.tab === 'reviews'` is the ONLY tab value currently handled
this way (initializes `filter` to `'reviews'`, else defaults to `'all'`).
There is no generic `'birthdays'`/`'anniversaries'` tab value wired through
`state.tab` today — those two flows instead pre-fill the search box via
`state.q` and rely on the "all" filter's search matching.

**Reusable pattern for this feature:** `navigate('/merchant/customers',
{ state: { tab: 'reviews' } })` is the exact, minimal pattern to reuse
verbatim for any future "jump to a specific tab" link — same `useNavigate()`
+ `state.tab` shape. A notification's "click name" action should extend the
same `location.state?.tab === X` conditional in Customers.jsx (see §(c))
rather than invent a new signaling shape.

### A4 — Existing dropdown/panel (open-on-click, close-on-outside-click) pattern

**Confirmed absent.** Searched `src/` for outside-click handling
(`mousedown` listeners, `onClickOutside`, dropdown-style absolutely
positioned panels) — no matches outside of:
- The mobile nav **drawer** in Shell.jsx (lines 72-89), which is a full-screen
  overlay (`fixed inset-0 z-40 lg:hidden` + a click-catcher `absolute inset-0
  bg-ink/40` div, not a small anchored dropdown) closed by clicking the
  overlay backdrop or an explicit × button — no outside-click/mousedown
  document listener, just a backdrop `onClick`.
- The `Modal` component in `src/components/ui.jsx` (centered modal, not an
  anchored dropdown).

**No existing small anchored dropdown/menu pattern exists anywhere in
`src/`.** The notification panel must be a new, minimal implementation
(see §(c)) — but it CAN reuse Shell.jsx's proven "backdrop `onClick`
closes it" idiom (`<div className="absolute inset-0 ..." onClick={close} />`)
instead of inventing a `mousedown`/document-listener mechanism from
scratch, since that idiom is already established and working in this
codebase.

### A5 — Existing three-dot/kebab menu pattern

**Confirmed absent.** Searched `src/` for kebab-menu characters/patterns
(⋮, •••, ⋯, "kebab", "three-dot") — zero matches (the only "•••" hits are
password-mask placeholders in Login.jsx/Lookbook.jsx, unrelated). A new,
minimal three-dot menu must be specified from scratch (see §(c)).

### A6 — `findUpcomingInternal` return shape (convex/customers.ts:524-559)

Confirmed it already returns exactly what a notification generator needs,
with **no Gemini/AI call** anywhere in its call chain (it delegates to
`findUpcoming()`, a pure indexed DB read):

```ts
export const findUpcomingInternal = internalQuery({
  args: {
    days: v.optional(v.number()),
    field: v.union(v.literal("birthday"), v.literal("anniversary")),
  },
  handler: async (ctx, { days, field }) => {
    const hits = await findUpcoming(ctx, days ?? 7, field);
    return hits.map(({ doc, daysUntil }) => {
      const raw = field === "birthday" ? doc.birthday : doc.anniversary;
      const parsed = parseMD(raw);
      const occasionDate = parsed ? `${parsed[0]}-${parsed[1]}` : null;
      return {
        _id: doc._id,
        name: doc.name,
        birthday: doc.birthday ?? null,
        anniversary: doc.anniversary ?? null,
        mobile: doc.mobile,
        tier: doc.tier ?? "silver",
        points: doc.points ?? 0,
        whatsapp_consent: doc.whatsapp_consent ?? false,
        days_until: daysUntil,
        occasion_date: occasionDate, // "M-D" string, e.g. "8-27"
      };
    });
  },
});
```
(customers.ts:524-559, quoted verbatim.) This has `name` (customer name),
`occasion_date` ("M-D" string), and `days_until` — exactly the 3 fields the
task requires (customer name, occasion, occasion_date, days_until — note
"occasion" itself is the `field` arg passed in, e.g. `"birthday"`, not a
field on each row). Already used with `days: 1` by
`crons.ts:171-172` (`generateDailyDrafts`) for exactly the "tomorrow" window
this feature also needs.

### A7 — Does `findUpcoming`/`findUpcomingInternal` exclude soft-deleted customers?

**No — confirmed absent.** `schema.ts:74` defines `is_deleted:
v.optional(v.boolean())` on `users` ("Gate 1 — soft-delete flag;
missing/false = active"), but grepping `convex/customers.ts` end-to-end
shows **zero references to `is_deleted`** anywhere in `findUpcoming` (lines
222-267), `findUpcomingInternal` (524-559), `getCustomers` (290-302), or any
other query/mutation in that file. The only filter applied is `role ===
"customer"` (via `.eq("role", "customer")` on the indexed queries, or
`q.eq(q.field("role"), "customer")` in `getCustomers`).

**Impact on this feature:** the notification generator (§(c) below) reusing
`findUpcomingInternal` will, exactly like the existing AI-drafts cron does
today, include soft-deleted customers if any exist with a birthday/
anniversary tomorrow — this is **pre-existing behavior**, not a gap
introduced by this feature (the AI-drafts cron has the identical exposure
today and is explicitly out of scope to change). Per the task's non-
negotiables (extend, don't modify, existing behavior), the notification
generator will **not** add an `is_deleted` filter of its own beyond what
`findUpcomingInternal` already does, keeping it byte-parity with the
existing cron's filtering behavior. This is flagged here as a known,
pre-existing, out-of-scope gap — not something this feature's spec silently
papers over.

---

## Part B — Design

### (a) Schema — `notifications` table

```ts
notifications: defineTable({
  customer_id: v.id("users"),
  occasion: v.union(v.literal("birthday"), v.literal("anniversary")),
  occasion_date: v.string(), // "M-D" string, e.g. "8-27" — same convention as message_actions/ai_message_drafts
  message: v.string(),
  created_at: v.number(), // epoch ms
  seen: v.boolean(),
})
  // Dedup check in the daily generator (mirrors hasExistingDraft's tuple
  // lookup in crons.ts:96-111 and message_actions'/ai_message_drafts'
  // by_customer_occasion_date convention exactly — same field order/naming).
  .index("by_customer_occasion_date", ["customer_id", "occasion", "occasion_date"])
  // Efficient "unseen count" — equality-only prefix on `seen`, matching this
  // schema's established "narrow with an equality field first" style (see
  // by_role_consent_vvip's own comment, schema.ts:112-129, for the same
  // reasoning: partition the table on the field every read filters on).
  .index("by_seen", ["seen"])
  // Efficient "not expired" (< 30 days old) reads — range read on
  // created_at directly, same shape as orders' by_created_at index
  // (schema.ts:184, "range-read created_at >= X via .withIndex(...) instead
  // of a full-table .filter() scan").
  .index("by_created_at", ["created_at"]),
```

Both indexes are single-purpose range/equality reads, no full-table scans:
- `getNotifications` (non-expired rows): `.withIndex("by_created_at", q =>
  q.gte("created_at", Date.now() - 30*24*60*60*1000))` — indexed range read.
- Unseen count (if surfaced as a dedicated fast query rather than derived
  from `getNotifications`'s already-fetched rows — see §(c) note below):
  `.withIndex("by_seen", q => q.eq("seen", false))` — indexed equality read.
- Daily generator's per-tuple dedup check: `.withIndex("by_customer_occasion_date", ...)`
  — identical shape to `hasExistingDraft` (crons.ts:96-111).

In practice, since `getNotifications` already range-reads all non-expired
rows for the panel (bounded by the 30-day auto-expiry, so this set stays
small even at 1000+ customers — at most a handful of birthdays/anniversaries
per day), the unseen count can be derived client-side from that same result
set (`rows.filter(r => !r.seen).length`) without a second round-trip. The
`by_seen` index is specified regardless, in case a future task wants a
dedicated "just the count" query that reads even less data than the full
`getNotifications` payload (index is included in the schema now, per the
task's explicit indexing requirement — using it is a call-site choice, not
a schema gap).

### (b) Backend — `convex/notifications.ts` + an addition to `convex/crons.ts`

**New file `convex/notifications.ts`:**

- `getNotifications` — merchant-guarded query (`requireMerchantSession`,
  same pattern as every query in `customers.ts`). Args: `{ userId:
  v.id("users"), token: v.string() }`. Reads via `by_created_at` index,
  `gte("created_at", Date.now() - THIRTY_DAYS_MS)`, returns rows sorted
  newest-first (mirrors `getPointsHistory`'s `.order("desc")` idiom,
  customers.ts:696-714).

- `markAllSeen` — merchant-guarded mutation. Args: `{ userId, token }`.
  Called when the bell is opened (per task spec). Patches every currently-
  unseen, non-expired row (`seen: false` within the same `by_created_at`
  window used by `getNotifications`, so it only touches rows the merchant
  can actually see) to `seen: true`. Uses `Promise.all` over `ctx.db.patch`
  calls, same style as other bulk-touch mutations in this codebase (no
  existing bulk-patch helper to reuse — this is a small, new, minimal loop).

- `deleteNotification` — merchant-guarded mutation. Args: `{ notificationId:
  v.id("notifications"), userId, token }`. Calls `ctx.db.delete(notificationId)`
  on **only** the `notifications` table row. Does not read, patch, or delete
  anything in `users`, `ai_message_drafts`, or `message_actions` — no import
  of those tables' logic into this function at all, so there is no code path
  by which deleting a notification can touch `findUpcoming`/
  `findUpcomingInternal`'s source data (`users.birthday`/`users.anniversary`)
  or the separate AI-drafts feature.

**Addition to the EXISTING `convex/crons.ts` (new step, not a modification
of `generateDailyDrafts`):**

- A new `internalMutation` (e.g. `insertNotification`, mirroring
  `insertDraft`'s exact shape at crons.ts:114-131) that inserts one
  `notifications` row: `{ customer_id, occasion, occasion_date, message,
  created_at: Date.now(), seen: false }`. `message` is a generic,
  non-AI-generated string built in code, e.g. `` `${name}'s ${occasion} is
  tomorrow` `` — no Gemini call, no `ai.ts` import.

- A new `internalQuery` (e.g. `hasExistingNotification`, mirroring
  `hasExistingDraft`'s exact shape at crons.ts:96-111) that checks the
  `by_customer_occasion_date` index on `notifications` for an existing row
  for the tuple, so re-running the daily job never double-inserts.

- A new `internalMutation` (e.g. `deleteExpiredNotifications`) that range-
  reads `notifications` via `by_created_at` for
  `created_at < Date.now() - THIRTY_DAYS_MS` and deletes each — the "auto-
  expiry, no separate cron needed" requirement, run inline at the end of the
  same daily action described next.

- A new `internalAction` (e.g. `generateDailyNotifications`) that is a
  **sibling** to `generateDailyDrafts`, not a change to it: fetches
  tomorrow's birthday/anniversary hits via the SAME
  `internal.customers.findUpcomingInternal` calls `generateDailyDrafts`
  already makes (crons.ts:171-172) — reused read-only, no modification to
  that query — but with **no consent gate** (per task: "this never messages
  the customer, it only informs the merchant" — `whatsapp_consent` is
  irrelevant here, unlike `generateDailyDrafts`'s Step 2 gate) and **no
  Gemini call** (unlike `generateDailyDrafts`'s Step 4). For each hit not
  already covered by `hasExistingNotification`, calls `insertNotification`.
  Then calls `deleteExpiredNotifications` once at the end of the same run.

- Cron registration: one new `crons.interval("generate dashboard
  notifications", { hours: 24 }, internal.crons.generateDailyNotifications,
  {})` line added alongside the existing `crons.interval("generate whatsapp
  ai drafts", ...)` line (crons.ts:240) — an addition, not a replacement.

### (c) Frontend

**Placement** — per A1/A2's finding that Shell.jsx (not Dashboard.jsx) owns
the shared header:
- **Mobile top bar** (Shell.jsx:51-54): add the bell as a new flex child
  inside the existing `flex items-center justify-between bg-white
  border-b border-line px-4 py-3` row, between the logo and the ☰ Menu
  button (or after Menu — exact order is a small visual call left to
  implementation time, not a functional one).
- **Desktop**: since Shell.jsx's desktop layout has no existing top strip
  above `<main>`'s content (§A1/A2), add a new minimal top-right row inside
  `<main className="lg:ml-60">`, before `{children}` — e.g. a `flex
  justify-end` div containing just the bell, using the SAME `max-w-6xl
  mx-auto px-4 sm:px-6` content-width wrapper Shell.jsx already uses for
  `{children}` (Shell.jsx:93) so the bell aligns with existing page content
  rather than floating at an arbitrary width. This is a new addition to
  Shell.jsx, not a resize/restructure of the existing sidebar or mobile bar.

**Red-dot indicator**: small absolutely-positioned dot (`absolute -top-1
-right-1 h-2 w-2 rounded-full bg-[color]`, using an existing brand accent
color — gold `#C5A880` fits the luxury palette per CLAUDE.md 5.4, though a
"needs attention" dot conventionally reads better in a warning tone; exact
color is an implementation-time call within the approved token set), shown
only when unseen count > 0. Data source: `getNotifications`'s result,
`.filter(n => !n.seen).length` (see §(a) note on why a second query isn't
needed).

**Dropdown/panel**: per A4, no existing anchored-dropdown pattern exists —
build new, minimal, reusing Shell.jsx's proven backdrop-click-to-close
idiom (Shell.jsx:74: `<div className="absolute inset-0 ..." onClick={close} />`)
adapted to a small anchored panel instead of a full-screen overlay:
```
<div className="relative">
  <button onClick={() => setOpen(v => !v)} ...>{bell + red dot}</button>
  {open && (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-line shadow-lg z-50">
        {/* notification rows */}
      </div>
    </>
  )}
</div>
```
Opening the panel (`setOpen(true)`) triggers `markAllSeen` (per task: "called
when the bell is opened").

**Per-row content**:
- Customer name — clickable, calls `navigate('/merchant/customers', {
  state: { tab: ... } })` reusing the EXACT pattern from §A3. Since today's
  Customers.jsx only special-cases `state.tab === 'reviews'`
  (Customers.jsx:28), the frontend task implementing this will need to
  extend that same conditional with a new tab value (e.g. `'birthdays'` /
  `'anniversaries'`, or reuse the existing `state.q` marker-string approach
  from `todayList()` (Dashboard.jsx:184-189) scoped to the notification's
  own `occasion_date` instead of today's date) — exact choice is a frontend
  implementation decision, not a schema/backend one; both reuse patterns
  A3 already documents, no new signaling shape is invented.
- Generic message — `notification.message` as generated by the backend
  (§(b)), e.g. "Priya's birthday is tomorrow".
- Relative-time display — time since `created_at` (when the notification
  row was made), NOT time until the occasion. No existing relative-time
  helper was found reused elsewhere for this exact "21m/4d" short format
  during this audit (`fmtDate`/`timeAgo` exist in `src/lib/util.js` and are
  already imported by Dashboard.jsx for the "Recent activity" table's "When"
  column, e.g. `timeAgo(e.ts)` at Dashboard.jsx:160) — `timeAgo` is the
  natural fit to reuse here since it already computes elapsed-time-since-a-
  timestamp for this same Dashboard page; using it (or matching its output
  format if it doesn't already emit "21m"/"4d" shorthand) is an
  implementation-time detail for the frontend task, not a new pattern.
- Three-dot menu — per A5, no existing kebab pattern exists; build new,
  minimal (small button toggling a tiny 1-item absolute panel with just
  "Delete", same backdrop-close idiom as the outer panel, or simplest: reuse
  the outer panel's own click-away handling by keeping the per-row menu's
  open state local and closing it on any outer-panel re-render). Clicking
  "Delete" calls `deleteNotification({ notificationId, userId, token })`.

### (d) Explicit non-negotiables

- No AI/Gemini call anywhere in this feature — `convex/notifications.ts` and
  the new `crons.ts` step never import or call `ai.ts`'s `callGemini` or
  `generateMessageDraft`.
- `deleteNotification` only ever calls `ctx.db.delete(notificationId)` on
  the `notifications` table. It does not touch `users.birthday`/
  `users.anniversary`, `message_actions`, or `ai_message_drafts` — a
  customer's birthday/anniversary-tomorrow status shown in Customers.jsx
  (driven by `getUpcomingBirthdays`/`getUpcomingAnniversaries`, which read
  `findUpcoming` against `users`, completely independent of the
  `notifications` table) is unaffected by any notification action.
- Nothing in this feature sends anything to a customer — `getNotifications`,
  `markAllSeen`, `deleteNotification`, and the new cron step are all
  internal reads/writes to the `notifications` table only; no
  `sendWhatsAppTemplateMessage` or Resend call anywhere. No consent gate is
  applied anywhere in this feature (unlike `generateDailyDrafts`'s
  `whatsapp_consent` gate, which exists specifically because that feature
  DOES message the customer).

### (e) Zero-regression guarantee

Must stay byte-identical / unmodified:
- `Dashboard.jsx`'s existing content (Delight Banner, action chips, metrics
  ribbon, pending reviews, recent activity, activity modal) — the bell does
  not live inside Dashboard.jsx per §A1/A2's finding, so this file is not
  touched by this feature at all (a later task could optionally add a
  Dashboard-local trigger, but the design as specified needs no Dashboard.jsx
  change).
- `Shell.jsx`'s existing nav list, sign-out button, mobile drawer, and
  sidebar structure — the bell is a pure addition (new JSX inside the
  existing mobile top bar's flex row, and a new top-right row above
  `{children}` on desktop), not a restructuring of any existing element.
- `Customers.jsx`'s existing tabs (`all`, `reviews`, and the birthday/
  anniversary `q`-driven search flows) — untouched; if a new `state.tab`
  value is added for this feature's "click name" navigation, it is an
  ADDITION to the existing `location.state?.tab === 'reviews' ? 'reviews' :
  'all'` conditional (e.g. a new branch), not a replacement of the
  `'reviews'` case.
- `findUpcoming`/`findUpcomingInternal` (customers.ts:222-267, 524-559) —
  read-only reuse from the new cron step, zero modification. Their existing
  callers (`getUpcomingBirthdays`, `getUpcomingAnniversaries`,
  `generateDailyDrafts`) keep working exactly as before.
- `crons.ts`'s existing `generateDailyDrafts` function (crons.ts:165-230) —
  the new notification-generation step is a separate, new
  action/mutation/query added to this file (new cron registration line
  alongside the existing one at crons.ts:240), not an edit to
  `generateDailyDrafts`'s body, args, or behavior.

### (f) Scalability

- `notifications` table has 3 purpose-built indexes from day one (§(a)):
  `by_customer_occasion_date` (dedup checks — equality lookup, matches
  `message_actions`/`ai_message_drafts`'s established convention exactly),
  `by_seen` (unseen-count reads — equality prefix, matches
  `by_role_consent_vvip`'s "narrow on the field every read filters on
  first" convention), and `by_created_at` (not-expired range reads —
  matches `orders.by_created_at`'s established range-read convention
  exactly, schema.ts:184).
- No full-table scans anywhere: `getNotifications` and the expiry cleanup
  both range-read via `by_created_at`; the dedup check range-reads via
  `by_customer_occasion_date`; an optional future dedicated unseen-count
  query would equality-read via `by_seen`.
- The daily generator reuses `findUpcomingInternal`'s existing indexed
  `by_role_birthday_md`/`by_role_anniversary_md` reads (already proven at
  the 1000+ customer scale this codebase targets, per
  `2026-09-03-scaling-fixes-pre-ai-design.md`) — no new scanning path is
  introduced on the `users` table.
- The `notifications` table itself stays small and bounded by design: at
  most a handful of rows per day (birthdays/anniversaries landing tomorrow,
  same small daily volume `generateDailyDrafts` already handles), with a
  30-day auto-expiry keeping the table from growing unbounded over time.

---

## Open items for a future implementation task (not decided here)

- Exact `state.tab` value name (or reuse of the `state.q` marker-string
  approach) for the "click name -> jump to Customers" navigation — flagged
  in §(c), left as an implementation-time choice within the two patterns
  A3 already documents.
- Exact bell/dot color token and icon glyph.
- Whether `markAllSeen` should be a single "mark all in the fetched window"
  patch loop or take an explicit list of notification IDs from the client
  (both satisfy the task's requirement; the batch/window approach is
  specified here as the simpler default per Ponytail Ladder).
