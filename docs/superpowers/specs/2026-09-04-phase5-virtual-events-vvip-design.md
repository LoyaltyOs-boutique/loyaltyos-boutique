# Phase 5 — Virtual Events + VVIP (Feature C) — Design

> Status: approved-pending-build. Companion to `docs/superpowers/specs/2026-09-03-ai-automation-architecture-design.md` (§4 "Feature C — Virtual events (VVIP-gated)", §7 "Scalability Principles" — cited throughout, not redesigned here).
> This doc is self-contained: every classname/pattern it relies on is quoted directly below from the real source files as read on 2026-09-04, not referenced as "see elsewhere."

---

## (a) Schema — new `events` table

Add to `convex/schema.ts`:

```ts
events: defineTable({
  designer_name: v.string(),
  event_datetime: v.number(),
  vvip_only: v.boolean(),
  description: v.string(),
  draft_text: v.optional(v.string()),
  status: v.union(v.literal("draft"), v.literal("dispatched")),
  created_at: v.number(),
})
  // "Upcoming events" query needs a range read on event_datetime, the same
  // shape as the by_role_birthday_md / by_role_anniversary_md precedent in
  // this same schema (users table, lines 100-106): equality on a cheap
  // discriminator (there is none needed here — events is a single small
  // table, unlike users) + range on the date field. Since events has no
  // natural equality partition key, index directly on the range field:
  .index("by_event_datetime", ["event_datetime"]),
```

Reasoning, citing the existing precedent directly (convex/schema.ts lines 100-106):
```ts
.index("by_role_name_lower", ["role", "name_lower"])
// Scaling Fix 3 — same shape as by_role_name_lower: equality on `role` +
// range on the zero-padded _md mirror lets findUpcoming (customers.ts)
// fetch the "next N days" birthday/anniversary window via an indexed
// range read instead of a full-table scan + per-row parseMD().
.index("by_role_birthday_md", ["role", "birthday_md"])
.index("by_role_anniversary_md", ["role", "anniversary_md"]),
```
The users table indexes pair an equality field (`role`) with a range field (`*_md`) because `users` is large and mixed (merchants + customers). `events` has no such mixed-population problem — it is a small, purpose-built table where every row is an event — so `by_event_datetime` alone (a plain range index) is sufficient for `getEvents`'s "upcoming events, soonest first" query via `.withIndex("by_event_datetime", q => q.gte("event_datetime", now)).order("asc")`, with no full-table scan. This is the same indexed-range-read principle as the birthday/anniversary precedent, applied to a table shape that doesn't need the equality prefix.

Also add to the existing `users` table definition (alongside the existing `tier` field, convex/schema.ts line 64-66):
```ts
tier: v.optional(
  v.union(v.literal("silver"), v.literal("gold"), v.literal("platinum")),
),
vvip: v.optional(v.boolean()), // Phase 5 — VVIP-only event access flag, mirrors whatsapp_consent's optional-boolean shape (line 68)
```

---

## (b) Backend — new `convex/events.ts`

- **`createEvent`, `getEvents`, `deleteEvent`** — merchant-guarded mutations/query using `requireMerchantSession()` (convex/auth.ts), the exact same guard pattern already applied to all 39 merchant-only functions across customers.ts/lookbooks.ts/orders.ts/reviews.ts/settings.ts/templates.ts/whatsapp.ts (branch `feat/merchant-session-lock`, commits df25962..a99837f — not yet merged to main; Feature C build must land after that merge, or apply the same guard call directly, matching the established call signature). `getEvents` reads via `by_event_datetime` index, never `.collect()` over the full table.

- **`generateEventDraft`** — internal action. Reuses the Phase 2 `callGemini` shared helper from `convex/ai.ts` verbatim (no new Gemini plumbing). Prompt is built ONLY from event title, designer_name, and description — never customer measurements or staff_notes. This is the same confidentiality boundary already enforced in:
  - Phase 1 `getCustomerIntelligenceProfile` (confidential fields excluded from the returned profile)
  - Phase 3 `generateMessageDraft` (drafts built from non-confidential customer/order context only)
  Same fail-gracefully contract as `callGemini` — missing `GEMINI_API_KEY` never throws, never blocks the merchant flow; returns null/empty draft and the merchant types the message manually.

- **`dispatchEvent`** — merchant-guarded mutation/action, triggered ONLY by the new "Dispatch Event" button described in (c). Recipient filter:
  ```
  whatsapp_consent === true AND (vvip_only === false OR customer.vvip === true)
  ```
  Reuses the existing guarded WhatsApp send flow in `convex/whatsapp.ts` (its exported send functions) — this design does not redesign or modify whatsapp.ts, only calls into it, same as Phase 3's WhatsApp AI drafts cron does. On successful dispatch, sets the event's `status: "dispatched"`.

- **`getEventAccess(customerId, eventId, now?)`** — public query. Direct precedent: `validateMagicToken` (convex/auth.ts lines 261-284), quoted here in full since this doc must be self-contained:
  ```ts
  export const validateMagicToken = query({
    args: {
      id: v.string(),
      token: v.string(),
      now: v.optional(v.number()),
    },
    handler: async (ctx, { id, token, now }) => {
      const customer = await ctx.db
        .query("users")
        .withIndex("by_magic_token", (q) => q.eq("magic_token", token))
        .first();
      if (!customer || customer.role !== "customer") return null;
      if (String(customer._id) !== id) return null;

      const createdAt = customer.magic_token_created_at;
      if (!createdAt || Number.isNaN(createdAt)) return null;

      const nowMs = now ?? Date.now();
      const expiresAt = createdAt + MAGIC_LINK_DAYS * DAY_MS;
      if (nowMs > expiresAt) return null;

      return { user: toPublicUser(customer), expiresAt };
    },
  });
  ```
  `getEventAccess` follows this exactly: server-stored `event_datetime` is the source of truth, an optional client-supplied `now` param is accepted for the identical reason `validateMagicToken` accepts one — per its own comment, "Accepts an optional `now` (epoch ms) so the client can refresh the clock — queries must not read the wall clock (reactive-cache guideline)." The unlock computation is entirely server-side:
  ```ts
  const nowMs = now ?? Date.now();
  const unlocked = nowMs >= event.event_datetime - 5 * 60_000;
  ```
  Never a client-trusted "is it unlocked" boolean passed in — the client only ever supplies the clock reading, never the verdict, mirroring `validateMagicToken`'s `now`/expiry-verdict split exactly.

---

## (c) Frontend — Event Setter section (inside Campaigns.jsx)

**Exact evidence from `src/pages/merchant/Campaigns.jsx` as read 2026-09-04 (full file, 186 lines):**

Page wrapper (line 56):
```jsx
<div className="space-y-8">
```

Left column config wrapper (line 65):
```jsx
<div className="space-y-6">
```

Existing numbered section card container — "1 · Creative flyer" (lines 66-67):
```jsx
<section className="card p-6">
  <div className="eyebrow mb-4">1 · Creative flyer</div>
```
"2 · Message copy" section, same container pattern (lines 86-87):
```jsx
<section className="card p-6">
  <div className="eyebrow mb-4">2 · Message copy</div>
```
"3 · Audience segment" section, same container pattern (lines 93-94):
```jsx
<section className="card p-6">
  <div className="eyebrow mb-4">3 · Audience segment</div>
```
So the section-card container className is exactly `"card p-6"` and the numbered eyebrow-label className is exactly `"eyebrow mb-4"` with text content pattern `"<N> · <Title Case Label>"`.

Campaign Title input + its label (lines 80-83):
```jsx
<div className="mt-3">
  <label className="label">Campaign title</label>
  <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
</div>
```
So: label className `"label"`, input className `"input"`.

Message textarea pattern (lines 88-89, confirms the Phase 3 "same `className=\"input\"` textarea pattern" cited in the task):
```jsx
<label className="label">WhatsApp message</label>
<textarea className="input min-h-[130px]" value={body} onChange={(e) => setBody(e.target.value)} />
```

Existing "Dispatch campaign" button, full className, exact JSX (lines 119-127):
```jsx
<div className="card p-6 flex items-center justify-between gap-4">
  <div>
    <div className="luxe-title text-2xl">{targets.length}</div>
    <div className="text-xs text-steel uppercase tracking-wide2">clients will receive this</div>
  </div>
  <button onClick={dispatch} disabled={sending || targets.length === 0} className="btn-gold disabled:opacity-40">
    {sending ? <><span className="h-3 w-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Dispatching…</> : 'Dispatch campaign'}
  </button>
</div>
```
Button className: `"btn-gold disabled:opacity-40"`. Spinner span className: `"h-3 w-3 border-2 border-white/40 border-t-white rounded-full animate-spin"`.

**Existing dispatch/sending state — exact variable names and JSX condition (lines 24-25, 45-53, 124-126):**
```jsx
const [sending, setSending] = useState(false);
const [done, setDone] = useState(null);
...
const dispatch = () => {
  setSending(true);
  setTimeout(() => {
    dispatchCampaign({ title, creative_url: img, message_body: body, audience_segment: { tiers, minPoints: useMinPoints ? Number(minPoints) : null, tags }, targets });
    setSending(false);
    setDone(targets.length);
    confetti({ particleCount: 140, spread: 100, origin: { y: 0.3 }, colors: ['#C5A880', '#111111', '#E9DFCF'] });
  }, 1600);
};
...
<button onClick={dispatch} disabled={sending || targets.length === 0} className="btn-gold disabled:opacity-40">
  {sending ? <>...Dispatching…</> : 'Dispatch campaign'}
</button>
```
State is local `useState` in the `Campaigns` component (`sending`, `done`), driven by a `dispatch()` closure that calls `dispatchCampaign(...)` from `src/lib/db.js`. The disabled condition is `sending || targets.length === 0`.

**Designer dropdown — exact evidence from `src/pages/merchant/Catalogue.jsx` (full file, 406 lines):**

The "Add to" designer-lookbook select in Manual Entry (lines 312-319):
```jsx
<div>
  <label className="label">Add to</label>
  <select className="input" value={addTo} onChange={(e) => setAddTo(e.target.value)}>
    <option value="all">Current catalogue</option>
    {designerLookbooks.map((lb) => <option key={lb._id} value={lb._id}>{lb.name}</option>)}
    <option value="__new__">+ New designer lookbook</option>
  </select>
</div>
```
The catalogue-filter select at the grid header (lines 335-343) uses the identical `className="input !w-auto !py-1.5 text-xs"` variant plus the same `designerLookbooks.map(...)` population.

`designerLookbooks` is **derived live**, not hardcoded (lines 44-53, 98):
```jsx
const [lookbookOptions, setLookbookOptions] = useState([]);
...
useEffect(() => {
    let mounted = true;
    getLookbooksForSelector().then((rows) => { if (mounted && Array.isArray(rows)) setLookbookOptions(rows); });
    return () => { mounted = false; };
}, []);
...
const designerLookbooks = lookbookOptions.filter((lb) => lb.kind !== 'pdf');
```
So it is populated by an async `getLookbooksForSelector()` call (from `src/lib/db.js`, backed by Convex) into `lookbookOptions` state, then filtered client-side by `lb.kind !== 'pdf'` — a live-data `useState` + `useEffect` fetch pattern, NOT a `useMemo`/`Set` derived from a `designer` field on individual catalogue items, and NOT a static hardcoded array. **The Event Setter's Designer dropdown must reuse this same `getLookbooksForSelector()`-backed pattern** (fetch on mount into local state, filter to non-PDF/designer lookbooks, render `<option key={lb._id} value={lb._id}>{lb.name}</option>>`) — not invent a separate live-designer-list query.

**Placement and structure:**

The Event Setter section lives inside `src/pages/merchant/Campaigns.jsx`, positioned immediately ABOVE the existing `"1 · Creative flyer"` section (i.e., inserted before line 66 in the left column, inside the same `<div className="space-y-6">` at line 65), styled as its own numbered card:
```jsx
<section className="card p-6">
  <div className="eyebrow mb-4">0 · Event setter</div>
  {/* fields below */}
</section>
```
(Numbering: since it sits above "1 · Creative flyer," it either takes "0 ·" or the existing sections 1/2/3 get renumbered to 2/3/4. This is a build-time decision to confirm with the team before implementation — noted here so it isn't silently assumed either way.)

Fields, all using the exact `"label"` / `"input"` classNames quoted above:
- **Event Title** — `<label className="label">Event title</label>` + `<input className="input" .../>`
- **Designer** — `<label className="label">Designer</label>` + `<select className="input">` populated via `getLookbooksForSelector()` exactly as in Catalogue.jsx, filtered to `lb.kind !== 'pdf'`
- **Date** + **Time** — two `<input className="input" type="date">` / `type="time">` fields (or a single `datetime-local` input), combined into the single `event_datetime` epoch-ms value the backend expects
- **Audience** — All Customers / VVIP Only, a simple toggle reusing the `Toggle` component already imported in Campaigns.jsx (line 5: `import { Toggle, Tag, Empty } from '../../components/ui.jsx';`) — same component already used for the "Only clients with more than N points" toggle (line 105), or a `<select className="input">` with two options — build-time choice, either matches existing patterns in this file
- **Description** — `<label className="label">Description</label>` + `<textarea className="input min-h-[130px]" .../>` matching the Message Copy textarea pattern exactly (line 89)
- **Message** — `<textarea className="input min-h-[130px]" .../>`, pre-filled by a "Generate AI Draft" button (new, calls `generateEventDraft`), editable afterward by the merchant same as any controlled textarea

**Dispatch Event button** — visually matches the exact classNames of the existing "Dispatch campaign" button:
```jsx
<button onClick={dispatchEvent_local} disabled={eventSending || !eventValid} className="btn-gold disabled:opacity-40">
  {eventSending ? <><span className="h-3 w-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Dispatching…</> : 'Dispatch Event'}
</button>
```
Explicitly: this button uses its OWN new state variables (e.g. `eventSending`, `eventDone` — names TBD at build time but must NOT be `sending`/`done`, which are already owned by the Creative Flyer flow) and its OWN handler that calls the new `dispatchEvent` backend function. It must NOT share `sending`, `done`, `dispatch`, `targets`, or any other state/handler with the existing Dispatch campaign button. They are two fully independent send paths that happen to live in the same file and share only the visual className string — not the wiring.

---

## (d) VVIP checkbox — src/pages/merchant/Onboarding.jsx

Exact current JSX for `whatsapp_consent` (re-read 2026-09-04, lines 213-224):
```jsx
<div className="flex items-start gap-2">
  <input
    type="checkbox"
    id="whatsapp_consent"
    checked={f.whatsapp_consent || false}
    onChange={(e) => setF({ ...f, whatsapp_consent: e.target.checked })}
    className="mt-1"
  />
  <label htmlFor="whatsapp_consent" className="text-sm text-steel">
    I agree to receive WhatsApp updates (birthday/anniversary wishes and offers) from 85 Lansdowne.
  </label>
</div>
```
Form state default (line 25):
```jsx
const [f, setF] = useState({ name: '', whatsapp: '', calling: '', birthday: '', anniversary: '', city: '', country: 'India', note: '', whatsapp_consent: false });
```
Reset-form call (line 256) also resets `whatsapp_consent: false` in the same object literal.

**New `vvip` field** copies this structure verbatim, one-for-one:
```jsx
<div className="flex items-start gap-2">
  <input
    type="checkbox"
    id="vvip"
    checked={f.vvip || false}
    onChange={(e) => setF({ ...f, vvip: e.target.checked })}
    className="mt-1"
  />
  <label htmlFor="vvip" className="text-sm text-steel">
    Mark as VVIP client (gets access to VVIP-only virtual events).
  </label>
</div>
```
`f` state default and the reset-form object literal both need `vvip: false` added alongside the existing `whatsapp_consent: false`, at lines 25 and 256.

---

## (e) Explicit non-negotiable — "Nothing auto-sends"

Event links only go out when a merchant explicitly clicks **"Dispatch Event."** There is no automatic send triggered by time, cron, or event creation.

The `event_datetime - 5min` lock controls **WHEN a customer's already-sent link BECOMES OPENABLE** — i.e., when `getEventAccess` stops returning "locked." It never controls WHEN the link gets SENT.

These are two fully independent mechanisms:
1. **Send-timing** — controlled by a human click on "Dispatch Event." Zero automation.
2. **Access-timing** — controlled by server clock math in `getEventAccess` (`Date.now() >= event_datetime - 5*60_000`).

They must never be conflated in the implementation. A concrete scenario that must work correctly: a merchant could dispatch a link **today** for an event happening **next week**, and the link would sit "locked" (unopenable) in the customer's lookbook/message until 5 minutes before `event_datetime` — at which point `getEventAccess` starts returning unlocked, with no further action from the merchant required.

---

## (f) Zero-regression guarantee

The following must remain byte-identical / completely untouched by this build:

- The existing **"1 · Creative flyer"** section in `Campaigns.jsx` (lines 66-84 as read 2026-09-04)
- The existing **"2 · Message copy"** section in `Campaigns.jsx` (lines 86-91) — confirmed exact name from the Part A read: `"2 · Message copy"` (there is also a "3 · Audience segment" section, lines 93-117, likewise untouched)
- The existing **"Dispatch campaign"** button and its handler/state in `Campaigns.jsx` — the `dispatch` function, `sending`/`done` state, and the `<button onClick={dispatch} ...>Dispatch campaign</button>` block (lines 24-25, 45-53, 119-127)
- All of `src/pages/merchant/Onboarding.jsx`'s existing fields, other than the new `vvip` addition described in (d)
- `convex/whatsapp.ts` and `convex/auth.ts` — unchanged. Feature C reuses their existing exported functions (whatsapp.ts's guarded send functions, auth.ts's `requireMerchantSession()` and the `validateMagicToken` pattern as a design reference) and never modifies either file.

---

## (g) Scalability principles carried forward

Per the architecture spec's already-approved §7 "Scalability Principles" (`docs/superpowers/specs/2026-09-03-ai-automation-architecture-design.md`, not redesigned here — cited as binding constraint):
> "No full-table scans: every query used by an AI feature must go through an index... Every new table (ai_message_drafts, ai_lookbook_rankings or equivalent, events) is created with the indexes its actual query patterns need from day one, not added retroactively after a slowdown is found."

Applied to Feature C:
- `getEvents` — uses `by_event_datetime` (defined in (a)) for the "upcoming events" range read. No full-table scan.
- `getEventAccess` — single-document lookup by `eventId` (Convex `_id` get, O(1)), no scan.
- `dispatchEvent`'s recipient-filtering query — **flagged as a real implementation detail, not asserted trivial.** The filter is a compound condition:
  ```
  whatsapp_consent === true AND (vvip_only === false OR customer.vvip === true)
  ```
  This does not map cleanly to a single simple Convex index, because:
  - `vvip_only` lives on the `events` table (decided per-event, known at dispatch time), while `whatsapp_consent` and `vvip` live on the `users` table (per-customer).
  - The `OR` branch means the effective user-side filter changes shape depending on the event's `vvip_only` flag: for a non-VVIP event it's just `whatsapp_consent === true` (all consented customers); for a VVIP event it's `whatsapp_consent === true AND vvip === true` (a strict subset).

  Two implementation options to resolve at build time (this doc intentionally does not pick one — it's a build-time tradeoff):
  1. **Index on `whatsapp_consent`** (a new `by_whatsapp_consent` index on `users`, or reuse `by_tier`-style single-field index) to fetch the consented set via an indexed range/equality read, then filter `vvip` in-memory over that bounded result set when `vvip_only === true`. Cheap because the consented set is presumably much smaller than the full customer table, and the in-memory filter only runs over that already-bounded set, not the full table.
  2. **Compound index** `by_whatsapp_consent_vvip` (`["whatsapp_consent", "vvip"]`) on `users`, letting both dispatch paths (VVIP and non-VVIP events) use a pure indexed equality read with no in-memory filter step at all.

  Either avoids a full-table scan; which one is cheaper depends on real customer-table size and consented/VVIP ratios at build time — a decision for the backend agent building `convex/events.ts`, not this design doc.

---

## Addendum note

This document was written fresh on 2026-09-04 (no prior version existed) with the Event Setter already relocated into `Campaigns.jsx` per the product decision in this task — there is no separate standalone-Events-page section to mark superseded, since this is the first and only version of this design.
