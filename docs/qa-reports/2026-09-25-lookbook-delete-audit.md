# Lookbook Delete + Manual Entry Upload Bug — Read-Only Audit

**Date:** 2026-09-25
**Branch:** `feat/lookbook-delete` (created from `main` @ `f64b870`, not pushed)
**Author:** Claude (acting as office-tester-agent, inline — no subagent spawned)
**Scope:** Read-only. No code changed. This file + the branch are the only artifacts created.

---

## Plain-language summary (for Saidul)

**What you asked for:** two things audited before building — (1) a merchant "Delete lookbook" button (three-dot menu next to the designer-lookbook dropdown in Lookbook Manager) that also removes its pieces from Current catalogue and leaves old shared links showing "no longer available", and (2) why Manual Entry media upload shows a raw `Invalid session at requireMerchantSession` error.

**What I found, in plain words:**

1. **"Current catalogue" is not a separate thing.** It's just the unfiltered view of ALL pieces across ALL lookbooks. A piece added to a designer lookbook is **one row**, not a copy — it shows up in "Current catalogue" automatically because that view has no filter. So deleting a designer lookbook's pieces is exactly the same action as deleting them from Current catalogue — there's only one copy to delete.

2. **The public "no longer available" pages already exist and already work.** `PublicLookbook.jsx` and `PublicPiece.jsx` already show a clean "doesn't exist or has been removed" screen when the backend returns `null` for a missing id. The WhatsApp link-preview middleware also already "fails open" cleanly on a missing id. **None of this needs to be built** — deleting a lookbook today would already make old shared links show the right message, with zero code changes.

3. **Nothing else in the app would break if pieces/lookbooks are hard-deleted.** I checked every table in the schema. Orders don't store which piece was bought (only a rupee total) — and the order history screen actually freezes the piece's *name* as text at the moment of purchase, so it's already immune. Reviews store a link to the product but never actually display it anywhere today. Activity-tracking rows (likes/cart) store links too but are only ever counted, never shown by name. So a hard delete is safe today — nothing on screen would crash, go blank, or show broken data.

4. **This exact feature was attempted before and undone.** On 2026-09-16 a commit (`5c83005`, "Add lookbook-delete kebab menu... temp for live QA") built almost exactly this feature, pushed it to the branch's live preview for testing, and was then hard-reset away before being marked done. It is **not on any branch today** — I only found it by digging through the reflog. There is no written record of what exactly broke during that live QA pass (no ledger entry, no spec file was ever actually committed even though the commit message references one), so I cannot tell you the confirmed bug. But reading the reverted code against today's code, I found one concrete, still-present hazard: it called `hydrateCatalogue()` to refresh the grid after deleting, but that function silently no-ops if another hydrate is already in flight (e.g., the page's own on-mount refresh) — so the grid could keep showing the deleted lookbook's pieces after a "successful" delete, with no error shown. This is a plausible, code-evidenced explanation for a "delete didn't visually work" bug; it is not a confirmed diagnosis since no written QA record survives.

5. **The upload bug has a clear, evidence-backed root cause.** Logging in anywhere (another tab, another device, or just logging in again) immediately invalidates every OTHER open tab's saved session — there's no multi-device support, by design. When that happens, any locked action (including Manual Entry's media upload) throws `Invalid session`, and the Manual Entry screen has no handling for that specific case — it just prints the raw error text. Other parts of the app (Customers.jsx's Points Tool) already have a clean pattern for this exact situation (detect the message, sign the merchant out, send them to `/login`) — Manual Entry, the PDF linesheet upload, and everywhere else in Catalogue.jsx do not use it.

## Recommended delete strategy: **HARD delete**

**Evidence (see §5 below for full detail):** across all 13 tables in `convex/schema.ts`, only `catalogue_items.lookbook_id`, `reviews.catalogue_item_id`, and `customer_activity_events.{catalogue_item_id,lookbook_id,event_id}` reference a lookbook or catalogue item. Of those:
- `reviews.catalogue_item_id` is stored but **never read/joined anywhere** in the current backend or frontend (`grep` for the field outside schema.ts/reviews insert path returns nothing in `src/`).
- `customer_activity_events`'s three id fields are **only ever aggregated as counts** (`convex/ai.ts:762-764`, explicit comment: "never the underlying catalogue_item_id/lookbook_id detail").
- `orders` stores **no** item/lookbook reference at all — only aggregate `subtotal`/`final_total`/`points_earned` (paise integers). The one place a "what did they buy" string is shown (`Customers.jsx` Activity Ledger) reads it from a **client-side-only snapshot captured at checkout time** (`db.js:1569`), decoupled from the live `catalogue_items` row from the moment of purchase.
- The customer-facing read paths (`getCustomerCatalogue`, `getLookbookById`, `getCatalogueItemById`) and their frontend consumers already null-handle a missing id cleanly (§6).

A soft-delete (`is_deleted` flag, following the existing `customers.ts` soft-delete precedent) would only add value if something depended on keeping historical item data queryable after removal — nothing found today does. Hard delete (the existing `deleteLookbook`/`deleteCatalogueItem` mutations, unchanged) is simplest and matches what's already built. **Open decision for Saidul either way — see below.**

## Files a build would need to touch (estimate, not started)

- `src/pages/merchant/Catalogue.jsx` — add the three-dot menu next to the dropdown (approved flow file, Catalogue copy/share section)
- `src/lib/db.js` — `deleteLookbook` bridge already exists (`db.js:1236-1241`); may need local-state refresh fixed (see finding #4 above) before reuse
- No `convex/` changes needed — `deleteLookbook`/`deleteCatalogueItem` already do a full hard delete with the merchant-session guard (§4)
- For the upload-bug fix (separate task): `src/pages/merchant/Catalogue.jsx` (`onManualMediaFile`, `onPdfUpload` catch blocks) to adopt the `isSessionRejected` pattern that already exists in `Customers.jsx:1196-1231`

## Open decisions for Saidul

1. **Hard vs soft delete** — recommendation above is hard delete; confirm before building.
2. **What exactly broke in the 2026-09-16 attempt** — no written record survives (no ledger entry, no committed spec, no QA report). Worth 2 minutes of you recalling what you saw live, if you remember, before rebuilding — otherwise the hydrate-guard race in finding #4 is the best evidence-based lead.
3. **UI placement** — the previous attempt used a separate "Designer lookbooks" list section with its own per-row kebab; your new ask is a three-dot button *inside* the existing dropdown header row, before Copy Link. Confirm this is the layout you want (different from what was tried before).
4. **Whether to also fix the raw-error upload bug in the same branch/PR, or as a separate one** — they're unrelated code paths (Catalogue.jsx dropdown/delete vs. Catalogue.jsx media-upload catch block) but live in the same file.

---

## 3. Data model — lookbooks & catalogue_items, and what "Current catalogue" is

`convex/schema.ts:131-165`:

```ts
  /** PRD §6 Table `lookbooks` — designer collection groups. */
  lookbooks: defineTable({
    title: v.string(), // e.g. "Autumn Collection 2026"
    designer: v.string(),
    source: v.union(
      v.literal("manual"),
      v.literal("pdf"),
      v.literal("csv"),
      v.literal("instagram"),
    ),
    created_at: v.optional(v.number()),
    // Gate 2 (Step A) — distinguishes a designer-lookbook from a future PDF-lookbook
    // for the Catalogue.jsx selector dropdown. Missing/undefined on existing rows =
    // treated as "catalogue" grouping (unaffected), same optional-field pattern as
    // reviews.catalogue_item_id above.
    kind: v.optional(
      v.union(v.literal("catalogue"), v.literal("designer"), v.literal("pdf")),
    ),
    // Gate 2 (Step B) — public Vercel Blob URL for a PDF-kind lookbook
    // (kind: "pdf"). Optional: only set when a PDF was actually uploaded via
    // lookbooks.generatePdfUploadUrl -> createPdfLookbook; catalogue/designer
    // lookbooks never set this field.
    pdf_url: v.optional(v.string()),
  }),

  /** PRD §6 Table `catalogue_items` — items inside a lookbook. */
  catalogue_items: defineTable({
    lookbook_id: v.id("lookbooks"),
    title: v.string(),
    price: v.number(), // PAISE (₹12,500 → 1,250,000)
    image_url: v.string(),
    instagram_link: v.optional(v.string()),
    size: v.optional(v.string()), // Gate 2 — e.g. "S", "M", "L", "Free Size"
    colour: v.optional(v.string()), // Gate 2 — e.g. "Ivory", "Blush"
  }).index("by_lookbook", ["lookbook_id"]),
```

`catalogue_items` has NO `kind: "catalogue"` sentinel row and no "Current catalogue" pseudo-lookbook document exists in the `lookbooks` table. **"Current catalogue" is a pure UI-only grouping in `Catalogue.jsx`, not a data-model concept.**

Proof — `src/pages/merchant/Catalogue.jsx:32-34, 45, 103-104`:

```jsx
  // Step C — Manual Entry "Add to" target: 'all' = Current catalogue (no lookbook_id),
  // '__new__' = create a new designer lookbook (name from newLookbookName), else an existing lookbook _id.
  const [addTo, setAddTo] = useState('all');
  ...
    const [selected, setSelected] = useState('all'); // 'all' = Current catalogue, else lookbook _id
  ...
    // Grid items: all when on "Current catalogue", else filtered to the chosen lookbook.
    const shownItems = isLookbookSelected ? items.filter((i) => i.lookbook_id === selected) : items;
```

When `selected === 'all'` ("Current catalogue"), `shownItems = items` — **the full, unfiltered list of every catalogue_items row, regardless of `lookbook_id`.** There is no separate query, no separate document, no copy.

**Manual Entry with "Add to: `<designer lookbook>`" → ONE row, shown in two places by filtering, not two rows.**

`Catalogue.jsx:106-131` (`addManual`):

```jsx
  const addManual = async () => {
    if (!manual.title || !manual.price) return;
    // Step C — resolve which lookbook the piece is assigned to:
    //  'all'      → Current catalogue (no lookbook_id, unchanged legacy behavior)
    //  '__new__'  → create a new designer lookbook first, then use its _id
    //  <_id>      → an existing designer lookbook
    let lookbook_id;
    if (addTo === '__new__') {
      const name = newLookbookName.trim();
      if (!name) return; // "+ New designer lookbook" chosen but no name typed — abort
      const res = await createLookbook({ title: name, designer: name, source: 'manual', kind: 'designer' });
      if (!res || !res.ok || !res.id) return; // creation failed — don't orphan the piece
      lookbook_id = res.id;
      // Refresh Step A selector so the new lookbook is immediately pickable elsewhere.
      getLookbooksForSelector().then((rows) => { if (Array.isArray(rows)) setLookbookOptions(rows); });
    } else if (addTo !== 'all') {
      lookbook_id = addTo;
    }
    const res = addCatalogueItem({ ...manual, source: 'manual', ...(lookbook_id ? { lookbook_id } : {}) });
    // Missing-session case: surface the error (via the Manual-entry mediaMsg line)
    // and do NOT clear the form / show success — the item was never saved.
    if (res && res.ok === false) { setMediaMsg(res.error); return; }
    setManual({ title: '', price: '', image_url: '', instagram_link: '' });
    setAddTo('all');
    setNewLookbookName('');
  };
```

`addCatalogueItem` backend — `convex/lookbooks.ts:265-280`:

```ts
/** Add catalogue item. Price in paise (Integer). MERCHANT-ONLY. */
export const addCatalogueItem = mutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    lookbook_id: v.id("lookbooks"),
    title: v.string(),
    price: v.number(), // PAISE integer
    image_url: v.string(),
    instagram_link: v.optional(v.string()),
  },
  handler: async (ctx, { userId, token, ...args }) => {
    await requireMerchantSession(ctx, userId, token);
    return await ctx.db.insert("catalogue_items", args);
  },
});
```

`db.js` bridge — `src/lib/db.js:1244-1306` (`addCatalogueItem`):

```js
/** Add catalogue item with optimistic update + Convex write-through (Step 6.2). */
export function addCatalogueItem({ title, price, image_url, instagram_link, source, lookbook_id }) {
  // 0. Guard the missing-session case BEFORE the optimistic write. When a Convex
  // client exists but there is no merchant session, the item would otherwise be
  // added to the local UI and silently never persist — it vanishes on the next
  // hydrate with no error. Surface a clear error instead so nothing is lost.
  // (When client is null — pure offline/demo — we intentionally fall through to
  // local-only, same as every other bridge in this file.)
  const client = getConvex();
  const addSession = merchantSessionArgs();
  if (client && !addSession) {
    return { ok: false, error: 'Your session has expired — please refresh and log in again to add items.' };
  }

  // 1. Optimistic update (INR price for local UI)
  const item = {
    id: uid('it'),
    handle: uid('it').toLowerCase(),
    title,
    price: Number(price) || 0,
    image_url: image_url || '',
    instagram_link: instagram_link || '',
    source: source || 'manual',
    likes: 0,
    likedBy: [], // per-customer like toggle state (bug fix — see likeItem())
    lookbook_id
  };
  state.catalogueItems.unshift(item);
  pushEvent('owner', 'catalogue', `New lookbook item added · ${title} (₹${item.price})`);
  emit();

  // 2. Convex write-through (PAISE integer). MERCHANT-ONLY (Merchant Session
  // Lock) — both the lookbook lookup and the insert now require the
  // merchant's session; skip the write-through entirely (keep the local
  // optimistic item) when no merchant is logged in, same as every other
  // "no session → stay on local/offline state" bridge in this file.
  // (client/addSession resolved above, before the optimistic write.)
  if (client && addSession) {
    // If no lookbook_id provided, we try to find one or ignore (PRD says item must have lookbook)
    // For the demo / standalone catalogue, we expect the caller to provide it or the first lookbook.
    client.query(api.lookbooks.getLookbooks, addSession).then((lbs) => {
      const lbId = lookbook_id || (lbs && lbs[0] ? lbs[0]._id : null);
      if (lbId) {
        client.mutation(api.lookbooks.addCatalogueItem, {
          lookbook_id: lbId,
          title,
          price: Math.round((Number(price) || 0) * 100),
          image_url: image_url || '',
          instagram_link: instagram_link || undefined,
          ...addSession,
        }).then((cvxId) => {
          // Stamp the real ID so subsequent deletes/updates target Convex
          const idx = state.catalogueItems.findIndex((i) => i.id === item.id);
          if (idx >= 0) {
            state.catalogueItems[idx].convexId = cvxId;
            state.catalogueItems[idx].id = cvxId; // Swap local ID for Convex ID
            persist();
          }
        }).catch(() => { /* offline — keep local */ });
      }
    });
  }
  return item;
}
```

**One `catalogue_items` row is created, with `lookbook_id` set to the chosen designer lookbook.** It shows in "Current catalogue" purely because that view has no `lookbook_id` filter (`shownItems = items` when `selected === 'all'`). Confirmed: not a copy.

---

## 4. Existing delete functions

`convex/lookbooks.ts:248-306`, in full:

```ts
/** Delete lookbook + items (cleanup). MERCHANT-ONLY. */
export const deleteLookbook = mutation({
  args: { userId: v.id("users"), token: v.string(), id: v.id("lookbooks") },
  handler: async (ctx, { userId, token, id }) => {
    await requireMerchantSession(ctx, userId, token);
    // Delete all items first
    const items = await ctx.db
      .query("catalogue_items")
      .withIndex("by_lookbook", (q) => q.eq("lookbook_id", id))
      .collect();
    for (const item of items) {
      await ctx.db.delete(item._id);
    }
    await ctx.db.delete(id);
  },
});

/** Add catalogue item. Price in paise (Integer). MERCHANT-ONLY. */
export const addCatalogueItem = mutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    lookbook_id: v.id("lookbooks"),
    title: v.string(),
    price: v.number(), // PAISE integer
    image_url: v.string(),
    instagram_link: v.optional(v.string()),
  },
  handler: async (ctx, { userId, token, ...args }) => {
    await requireMerchantSession(ctx, userId, token);
    return await ctx.db.insert("catalogue_items", args);
  },
});

/** Patch catalogue item. MERCHANT-ONLY. */
export const updateCatalogueItem = mutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    id: v.id("catalogue_items"),
    title: v.optional(v.string()),
    price: v.optional(v.number()),
    image_url: v.optional(v.string()),
    instagram_link: v.optional(v.string()),
  },
  handler: async (ctx, { userId, token, id, ...patch }) => {
    await requireMerchantSession(ctx, userId, token);
    await ctx.db.patch(id, patch);
  },
});

/** Delete item. MERCHANT-ONLY. */
export const deleteCatalogueItem = mutation({
  args: { userId: v.id("users"), token: v.string(), id: v.id("catalogue_items") },
  handler: async (ctx, { userId, token, id }) => {
    await requireMerchantSession(ctx, userId, token);
    await ctx.db.delete(id);
  },
});
```

- **Guard:** both require a valid merchant session (`requireMerchantSession`).
- **Hard delete, not soft:** `ctx.db.delete(...)` — a real Convex document delete, no `is_deleted` flag written.
- **`deleteLookbook` DOES delete its items** — it queries `by_lookbook`, deletes every matching `catalogue_items` row first, then deletes the lookbook document itself (cascade, in-mutation, atomic).

`db.js` bridges, in full — `src/lib/db.js:1236-1241` (`deleteLookbook`) and `:1318-1337` (`removeCatalogueItem`, the exposed name for deleting a catalogue item):

```js
/** Delete lookbook + items on Convex (async). MERCHANT-ONLY (Merchant Session Lock). */
export function deleteLookbook(id) {
  const client = getConvex();
  const session = merchantSessionArgs();
  if (!client || !session) return Promise.resolve(null);
  return client.mutation(api.lookbooks.deleteLookbook, { id, ...session }).catch(() => null);
}
```

```js
/** Delete item with optimistic update + Convex write-through (Step 6.2). MERCHANT-ONLY. */
export function removeCatalogueItem(id) {
  const item = state.catalogueItems.find((i) => i.id === id);
  const convexId = item ? (item.convexId || (String(id).startsWith('it_') ? null : id)) : null;

  // 1. Optimistic remove
  state.catalogueItems = state.catalogueItems.filter((i) => i.id !== id);
  emit();

  // 2. Convex delete. Merchant Session Lock (Task 1, Step 9): skip silently
  // (same as the pre-existing "offline" catch) when no merchant is logged in.
  if (convexId) {
    const client = getConvex();
    const session = merchantSessionArgs();
    if (client && session) {
      client.mutation(api.lookbooks.deleteCatalogueItem, { id: convexId, ...session })
        .catch(() => { /* offline */ });
    }
  }
}
```

**`deleteLookbook` bridge:**
- **Optimistic local write before the Convex call?** NO — no local state (`state.lookbooks`, `state.catalogueItems`) is touched at all, success or failure. It is a pure pass-through to the Convex mutation.
- **Session check before writing?** Yes — `if (!client || !session) return Promise.resolve(null)`, before the mutation call. No session → the mutation is never sent.
- **What does the caller see on failure?** `null` — for BOTH "no session" and "Convex mutation threw" (`.catch(() => null)`). These two distinct cases (no session vs. e.g. lookbook already deleted / network error) are indistinguishable to the caller — a caller must treat any `null` as generic failure.
- **Local state refreshed after success?** NO — the bridge itself does nothing to `state.catalogueItems`/`lookbookOptions` on success. Any caller MUST separately re-fetch (e.g. `hydrateCatalogue()` + `getLookbooksForSelector()`) to make the UI reflect the deletion. This is exactly what the reverted attempt did (§8) — and exactly where its refresh could silently no-op (§8 finding).

**`removeCatalogueItem` (the `deleteCatalogueItem` bridge, exposed under a different name):**
- **Optimistic local write before the Convex call?** YES — `state.catalogueItems = state.catalogueItems.filter(...)` + `emit()` happen unconditionally at step 1, BEFORE any session/client check.
- **Session check before writing?** NO — the local removal happens regardless of session state. The session check only gates whether the Convex call is even attempted.
- **What does the caller see on failure?** Nothing — no return value at all (function returns `undefined`), and any Convex failure (including "no session") is silently swallowed via `.catch(() => { /* offline */ })`. **This is the exact silent-fail shape from the e28acfc bug (§9)** — the item disappears from the merchant's screen even if the Convex delete never actually happened (e.g. expired session), with zero error shown, and it will reappear as a "ghost" on the next real hydrate.
- **Local state refreshed after success?** The optimistic removal already happened at step 1; no further refresh occurs (none needed for a genuine success — the item is legitimately gone).

---

## 5. References to pieces and lookbooks elsewhere (hard vs. soft delete evidence)

Full pass over every table in `convex/schema.ts` (490 lines) for any field that is `v.id("catalogue_items")`, `v.id("lookbooks")`, or a string plausibly snapshotting a piece/lookbook title:

| Table | Field(s) referencing catalogue_items/lookbooks | Dereferenced/rendered anywhere today? |
|---|---|---|
| `users` | none | — |
| `lookbooks` | `title` (own field, not a reference) | n/a |
| `catalogue_items` | `lookbook_id: v.id("lookbooks")` (schema.ts:158); `title` (own field) | n/a |
| `orders` | **none** — `user_id` only, plus aggregate paise fields (`subtotal`, `final_total`, `points_earned`) | n/a — no id to dereference |
| `campaigns` | none (`audience_segment` only has `tiers`/`min_points`/`custom_tags`) | — |
| `settings` | none (`grep` confirmed zero hits for "catalogue"/"lookbook" in `convex/settings.ts`) | — |
| `reviews` | `catalogue_item_id: v.optional(v.id("catalogue_items"))` (schema.ts:224) | **No** — never read in `convex/reviews.ts` beyond storage, and zero hits for `catalogue_item_id` anywhere in `src/` |
| `message_actions` | none | — |
| `points_ledger` | none | — |
| `ai_message_drafts` | none | — |
| `events` | none (`designer_name` is a free-text string, not a reference) | — |
| `notifications` | none | — |
| `customer_activity_events` | `catalogue_item_id` (optional), `lookbook_id` (optional), `event_id` (optional) (schema.ts:441-443) | **No** — only ever aggregated as counts, see below |
| `customer_activity_summaries` | none | — |

**Orders — snapshot or reference?** Schema (`convex/orders.ts:31-90`, `createOrder`) takes only `subtotal_paise` (a number) — no items array, no `catalogue_item_id`, ever sent to or stored in Convex. **Orders never reference a specific piece at all, on the backend.** Where the frontend appears to show "what was bought," it's a **client-side-only snapshot frozen at checkout time**, never persisted to Convex and never re-joined against the live catalogue:

`src/lib/db.js:1560-1570` (`checkout`):
```js
export function checkout({ userId, items, pointsApplied, paymentMethod }) {
  const user = state.users.find((u) => u.id === userId);
  if (!user) return null;
  const subtotal = items.reduce((s, i) => s + i.price * (i.qty || 1), 0);
  const rule = state.settings.tiers[user.tier] || state.settings.tiers.global;
  const pointsEarned = Math.round((subtotal * (rule.purchasePercent || 5)) / 100);
  const finalTotal = Math.max(0, subtotal - pointsApplied);
  const order = {
    id: uid('o'), userId, subtotal, pointsApplied, discountValue: pointsApplied,
    paymentMethod, finalTotal, pointsEarned, items: items.map((i) => ({ catalogueItemId: i.id, title: i.title, price: i.price })),
    createdAt: now(),
  };
```

`items: items.map((i) => ({ catalogueItemId: i.id, title: i.title, price: i.price }))` — the piece's `title` string is copied verbatim into the local order record at the moment of purchase. It is never re-fetched from `catalogue_items` afterward.

**Order/activity/review rendering** — `src/pages/merchant/Customers.jsx:1144-1176` (`Ledger` component, used by both the Activity Ledger tab and Dashboard's "Recent Activity"):

```jsx
  const icon = { order: '🛍', review: '★', earned: '✦', redeemed: '▼', adjustment: '⚙' };
  return (
    <div className="max-h-80 overflow-y-auto scroll-thin">
      <table className="tbl">
        <thead><tr><th>Date</th><th>Type</th><th>Detail</th><th className="text-right">Points</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="text-xs text-steel whitespace-nowrap">{fmtDate(e.createdAt)}</td>
              <td><span className="text-sm">{icon[e.kind] || '·'}</span></td>
              <td className="text-sm">
                {e.kind === 'order' ? `Order · ${e.items?.[0]?.title || 'lookbook'} · ${e.paymentMethod === 'online' ? 'paid online' : 'reserved'} ${inr(e.finalTotal)}` : e.kind === 'review' ? `Review · ${e.platform === 'gmb' ? 'Google' : 'product'} ${e.stars}★` : `${e.reason}`}
              </td>
```

`e.items?.[0]?.title || 'lookbook'` — reads the frozen local snapshot with a generic `'lookbook'` fallback if absent. Review rows render `Review · {platform} {stars}★` — **the product name is never shown for a review at all today**, so `reviews.catalogue_item_id` pointing at a deleted item changes nothing on screen.

**What would happen on screen if the referenced item/lookbook no longer existed:**
- **Orders:** Nothing — the order row is a frozen local string, decoupled from `catalogue_items` since the instant of purchase. Fine, unaffected, by design (not a delete-feature side effect).
- **Reviews:** Nothing — `catalogue_item_id` is never dereferenced into a title anywhere in `src/`. Fine.
- **Activity (`customer_activity_events`)** — `convex/ai.ts:753-774` (`getRecentActivityCountsInternal`):
  ```ts
  /**
   * getRecentActivityCountsInternal — per-customer, 7-day-bounded activity
   * counts by action type, read via the by_customer_created_at index (Part 1's
   * FIRST index, purpose-built for exactly this "one customer's activity in
   * [start, now]" read pattern — see schema.ts's own comment on that index).
   * Bounded by one customer's one-week event volume, not a full-table scan.
   *
   * Returns only aggregate counts — never raw per-event rows — since the
   * summary prompt only needs "2 likes, 1 cart-add, 1 lookbook view", not the
   * underlying catalogue_item_id/lookbook_id detail.
   */
  export const getRecentActivityCountsInternal = internalQuery({
  ```
  Confirms: never dereferenced into a title. A deleted item just leaves an orphaned id in a row that's only ever counted, never displayed by name. Fine.
- **Likes:** the like/unlike toggle state (`likedBy` array) lives entirely in local `state.catalogueItems[i].likedBy` — if the item itself is deleted, the like state disappears with it (nothing to orphan).

**Net finding: no dangling-reference crash, blank, or "Unknown" risk exists anywhere in the current codebase for a hard-deleted lookbook or catalogue item.**

---

## 6. Customer-facing read paths

`convex/lookbooks.ts:129-203` (`getCustomerCatalogue`, `getCatalogueItemById`) and `:82-93` (`getLookbookById`):

```ts
/** Get lookbook + items (by_lookbook index). */
export const getLookbookById = query({
  args: { id: v.id("lookbooks") },
  handler: async (ctx, { id }) => {
    const lb = await ctx.db.get(id);
    if (!lb) return null;
    const items = await ctx.db
      .query("catalogue_items")
      .withIndex("by_lookbook", (q) => q.eq("lookbook_id", id))
      .collect();
    return { ...lb, items };
  },
});
```

```ts
export const getCustomerCatalogue = query({
  args: { id: v.string(), token: v.string() },
  handler: async (ctx, { id, token }) => {
    // --- Inline magic-link validation ---
    const customer = await ctx.db
      .query("users")
      .withIndex("by_magic_token", (q) => q.eq("magic_token", token))
      .first();
    if (!customer || customer.role !== "customer") return null;
    if (String(customer._id) !== id) return null;
    ...
    // --- Validated: aggregate the full shared global catalogue ---
    const lookbooks = await ctx.db.query("lookbooks").collect();
    ...
    for (const lb of lookbooks) {
      const items = await ctx.db
        .query("catalogue_items")
        .withIndex("by_lookbook", (q) => q.eq("lookbook_id", lb._id))
        .collect();
      for (const item of items) { allItems.push({ ... }); }
    }
    return allItems;
  },
});
```

```ts
/**
 * Get a single catalogue item by id (O(1) lookup).
 */
export const getCatalogueItemById = query({
  args: { id: v.id("catalogue_items") },
  handler: async (ctx, { id }) => {
    const item = await ctx.db.get(id);
    if (!item) return null;
    return item;
  },
});
```

All three: `null` on a missing/nonexistent id, never a throw. `getCustomerCatalogue` re-aggregates fresh from live `lookbooks`/`catalogue_items` on every call — a deleted lookbook or item simply isn't in the result, no stale-id lookup ever happens.

**`Lookbook.jsx` (customer's own personal view)** — never looks up a single stale id; it only calls `hydrateCustomerCatalogue()` (`src/pages/Lookbook.jsx:92,113,132,158`), which re-fetches the full live array via `getCustomerCatalogue` on each call. A deleted lookbook/item just drops out of the next hydrate — no null/dangling-id handling is needed there because no by-id lookup ever occurs.

**`PublicLookbook.jsx` — full null handling (`src/pages/PublicLookbook.jsx:13-51`):**

```jsx
  useEffect(() => {
    let mounted = true;
    getLookbookById(lookbookId)
      .then((data) => {
        if (mounted) {
          if (data) setLookbook(data);
          else setError(true);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) { setError(true); setLoading(false); }
      });
    return () => { mounted = false; };
  }, [lookbookId]);
  ...
  if (error || !lookbook) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-5">
        <div className="max-w-sm text-center">
          <div className="text-5xl mb-4">📖</div>
          <div className="eyebrow mb-2">Lookbook not found</div>
          <h1 className="luxe-title text-2xl mb-3">This lookbook doesn't exist or has been removed.</h1>
          <p className="text-sm text-steel mb-6">Please check the link or contact the boutique.</p>
        </div>
      </div>
    );
  }
```

**`PublicPiece.jsx` — identical pattern (`src/pages/PublicPiece.jsx:13-51`):**

```jsx
  useEffect(() => {
    let mounted = true;
    getCatalogueItemById(pieceId)
      .then((data) => {
        if (mounted) {
          if (data) setPiece(data);
          else setError(true);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) { setError(true); setLoading(false); }
      });
    return () => { mounted = false; };
  }, [pieceId]);
  ...
  if (error || !piece) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-5">
        <div className="max-w-sm text-center">
          <div className="text-5xl mb-4">👗</div>
          <div className="eyebrow mb-2">Piece not found</div>
          <h1 className="luxe-title text-2xl mb-3">This piece doesn't exist or has been removed.</h1>
          <p className="text-sm text-steel mb-6">Please check the link or contact the boutique.</p>
        </div>
      </div>
    );
  }
```

**Both pages already show the exact "no longer available" clean state the task asks for. This is already built and requires zero changes.**

**`middleware.js` (WhatsApp/social OG-preview server) — `middleware.js:141-164`:**

```js
    if (publicMatch) {
      const lookbook = await client.query(api.lookbooks.getLookbookById, { id: publicMatch[1] });
      if (!lookbook) return next(); // fail open — not found
      ...
    }

    if (pieceMatch) {
      const item = await client.query(api.lookbooks.getCatalogueItemById, { id: pieceMatch[1] });
      if (!item) return next(); // fail open — not found
      ...
    }
```

On a missing id, the middleware "fails open" — `return next()` passes the request through to the normal SPA, which then renders the same clean not-found page above (for a crawler, this means no OG card is generated for a dead link — acceptable, matches the "fail open, never break the real page" convention documented at the top of the file). No change needed here either.

---

## 7. Merchant UI for placement (pin-to-pin)

`src/pages/merchant/Catalogue.jsx:343-370` — the "Current catalogue" heading row, dropdown, and share buttons in full:

```jsx
      {/* Catalogue grid */}
      <section>
        <SectionTitle
          eyebrow={`${(isLookbookSelected && !selectedPdf ? shownItems.length : items.length)} pieces live`}
          title="Current catalogue"
          right={
            <div className="flex items-center gap-3">
              <select
                className="input !w-auto !py-1.5 text-xs"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="all">Current catalogue</option>
                {designerLookbooks.map((lb) => <option key={lb._id} value={lb._id}>{lb.name}</option>)}
                {pdfLookbooks.map((lb) => <option key={lb._id} value={lb._id}>{lb.name} (PDF)</option>)}
              </select>
              {isLookbookSelected && (
                <div className="flex items-center gap-2">
                  <button onClick={() => copyPublicLink(selected)} className="btn-ghost !py-1 !px-2 text-[9px]">
                    {copiedId === selected ? '✓ Copied' : '🔗 Copy Link'}
                  </button>
                  <a href={waShareLink(selected)} target="_blank" rel="noreferrer" className="btn-gold !py-1 !px-2 text-[9px] flex items-center justify-center" aria-label="WhatsApp">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 11.5v7A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-7" /><path d="M14.5 9 21 2.5" /><path d="M15.5 2.5H21V8" /></svg>
                  </a>
                </div>
              )}
            </div>
          }
        />
```

- **`<select>` className:** `"input !w-auto !py-1.5 text-xs"` (`Catalogue.jsx:349-350`)
- **Options built from:** `designerLookbooks` (`lookbookOptions.filter(lb => lb.kind !== 'pdf')`, `Catalogue.jsx:99`) then `pdfLookbooks` (`lookbookOptions.filter(lb => lb.kind === 'pdf')`, `Catalogue.jsx:100`) — plus the always-present hardcoded `<option value="all">Current catalogue</option>`. **Three kinds appear: Current catalogue (pseudo), designer lookbooks, PDF lookbooks. `kind: "catalogue"`-tagged legacy rows (undefined `kind`) fall into `designerLookbooks` since the filter is `lb.kind !== 'pdf'`, not `lb.kind === 'designer'`.**
- **Selected-lookbook state:** `const [selected, setSelected] = useState('all');` (`Catalogue.jsx:45`)
- **Copy Link button className:** `"btn-ghost !py-1 !px-2 text-[9px]"` (`Catalogue.jsx:360`)
- **WhatsApp share button className:** `"btn-gold !py-1 !px-2 text-[9px] flex items-center justify-center"` (`Catalogue.jsx:363`)

**PDF lookbooks DO also appear in this dropdown** — confirmed at `Catalogue.jsx:356`: `{pdfLookbooks.map((lb) => <option key={lb._id} value={lb._id}>{lb.name} (PDF)</option>)}`.

**Existing kebab/three-dot pattern in `src/`** — `grep -rniE "⋮|kebab|popover|dropdown-menu"` across `src/` found exactly one live implementation, in the Dashboard notification bell (`src/components/merchant/Shell.jsx:306-324`, a DO-NOT-EDIT file per CLAUDE.md — quoted here only as a style reference, not to be edited):

```jsx
                  <div className="relative shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === n._id ? null : n._id); }}
                      className="text-steel hover:text-ink px-1.5 leading-none text-sm"
                      aria-label="Notification options"
                    >
                      ⋮
                    </button>
                    {menuFor === n._id && (
                      <div className="absolute right-0 top-full mt-1 w-28 bg-white border border-line shadow-lg z-50">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(n); }}
                          className="w-full text-left px-3 py-2 text-[11px] text-steel hover:text-ink hover:bg-mist"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
```

The reverted lookbook-delete attempt (§8) used its own, slightly different kebab styling (`btn-ghost !py-1 !px-2 text-sm leading-none` trigger, `bg-paper border border-line shadow-sm` panel, `btn-ghost !py-1 !px-3 text-[9px] w-full text-left` Delete button) rather than reusing Shell.jsx's classes exactly — worth deciding which style to follow when rebuilding.

---

## 8. History of the previous attempt

**No ledger entry, no spec file, and no QA report for a lookbook-delete feature exists anywhere in this repo's tracked history or the ledgers.** I searched `.superpowers/sdd/progress.md` and `memory-bank/progress.md` for lines containing both "lookbook" and "delete" (18 matches) and read every one — all are unrelated (existing `deleteLookbook` function mentions from Step 6.2, the customer soft-delete feature, VVIP event-access re-check, etc.). `git log --all` (every branch) has no commit with "lookbook" and "delete" together either.

**The actual attempt only survives in the reflog, as a dangling/unreachable commit** — found via `git reflog | grep -i lookbook`:

```
5c83005 HEAD@{41}: commit: Add lookbook-delete kebab menu to Catalogue.jsx (temp for live QA)
4f08361 HEAD@{40}: reset: moving to 4f08361
```

Full reflog window around it:

```
1d1c382 HEAD@{38}: commit: Ledger: record silent catalogue-import failure fix (commit e28acfc)
e28acfc HEAD@{39}: commit: Fix silent catalogue-import failure when merchant session is invalid
4f08361 HEAD@{40}: reset: moving to 4f08361
5c83005 HEAD@{41}: commit: Add lookbook-delete kebab menu to Catalogue.jsx (temp for live QA)
4f08361 HEAD@{42}: commit: Ledger: record Customer CRM search tier-based matching (commit a0f5a7f)
```

**This confirms the revert exactly as described: the branch was hard-reset from `5c83005` back to `4f08361`** (the commit immediately before it), after which `e28acfc` (the unrelated silent-catalogue-import fix) was committed on top. `5c83005` is `git fsck --unreachable`-confirmed dangling — it is not on `main`, not on `feat/ai-automation-gemini-phase`, not on any branch.

**Full commit message of `5c83005`:**

```
Add lookbook-delete kebab menu to Catalogue.jsx (temp for live QA)

New "Designer lookbooks" list section (name + piece count) with a
per-row kebab menu whose only option is Delete, reusing the existing
native confirm() pattern and the existing deleteLookbook mutation/bridge
as-is (no backend changes). Per docs/superpowers/specs/2026-09-15-lookbook-delete-design.md.

Pushed as-is to make the change live on this branch's Vercel preview for
a live-browser QA pass (build-tested only so far, not yet click-tested) —
not yet ledgered as complete.
```

`docs/superpowers/specs/2026-09-15-lookbook-delete-design.md` — **referenced in the commit message but was never actually committed to the repo at any point in git history** (`git log --all --diff-filter=A -- docs/superpowers/specs/2026-09-15-lookbook-delete-design.md` returns nothing; the file does not exist today either). This is itself a process gap against CLAUDE.md §5.12 (SPEC-DRIVEN hard-gate: "Save approved design to `docs/superpowers/specs/...` and commit").

**The full diff of `5c83005`** (69 lines added to `src/pages/merchant/Catalogue.jsx`, no backend changes):

```jsx
    // Piece count per lookbook, computed from the already-loaded catalogue
    // `items` (getLookbooksForSelector's thin projection carries no item_count,
    // and each catalogue_item belongs to exactly one lookbook — schema.ts:158).
    const lookbookItemCount = (lookbookId) => items.filter((i) => i.lookbook_id === lookbookId).length;

    // Kebab → Delete. Native confirm() mirrors the item-removal pattern below.
    // Row is removed only AFTER the backend confirms (deleteLookbook resolves
    // non-null on success, null on failure) — never optimistically.
    const onDeleteLookbook = async (lb) => {
      const n = lookbookItemCount(lb._id);
      setOpenMenu(null);
      if (!confirm(`Delete lookbook "${lb.name}" and its ${n} pieces? This cannot be undone.`)) return;
      setDeleteErr('');
      const res = await deleteLookbook(lb._id);
      if (res === null) { setDeleteErr(`Could not delete "${lb.name}" — please try again.`); return; }
      // Refresh both the new list and the "Add to"/grid selectors (same pattern
      // used after createLookbook at addManual) + re-hydrate the grid so the
      // deleted lookbook's pieces drop out immediately, no reload.
      getLookbooksForSelector().then((rows) => { if (Array.isArray(rows)) setLookbookOptions(rows); });
      if (selected === lb._id) setSelected('all');
      hydrateCatalogue();
    };
```

(new UI was a separate "Designer lookbooks" list section below the bulk-loader cards, each row with a `⋮` → Delete popup — not integrated into the existing dropdown header, unlike this task's requested placement.)

**No "12 to 2 pieces" investigation and no explicit "double-fire race" write-up were found anywhere** — I could not locate any document, ledger line, or commit describing the specific symptom observed during the live QA pass that triggered the reset. This part of the requested history genuinely does not exist in retrievable form; I am not fabricating a diagnosis for it.

**What the code itself shows as a plausible (not confirmed) explanation** — `onDeleteLookbook`'s post-delete refresh calls `hydrateCatalogue()` (`src/lib/db.js:1339-1377`), which has an in-flight guard:

```js
/** Background hydrate catalogue items from all lookbooks (Step 6.2). MERCHANT-ONLY. */
let catalogueHydrating = false;
export function hydrateCatalogue() {
  if (catalogueHydrating) return;
  const client = getConvex();
  const session = merchantSessionArgs();
  if (!client || !session) return;
  catalogueHydrating = true;
  ...
```

`Catalogue.jsx` also calls `hydrateCatalogue()` unconditionally on every mount (`Catalogue.jsx:24`: `useEffect(() => { hydrateCatalogue(); }, []);`). **If a merchant deletes a lookbook while that mount-time hydrate is still in flight, the post-delete `hydrateCatalogue()` call silently returns immediately (`catalogueHydrating` already `true`) and does nothing** — the grid would keep showing the just-deleted lookbook's pieces even though the backend delete succeeded, with zero error surfaced (matching a plausible "delete looked like it didn't work" / stale-count symptom). This is my own analysis of the reverted code against today's `db.js`, not a documented finding — flagged accordingly, per the task's evidence-only rule.

**Numbered lessons (quoted evidence only):**

1. The spec-first hard-gate (CLAUDE.md §5.12) was not actually followed for this attempt — a spec path was named in the commit message but never committed, so there is no record of the originally-approved design to compare against.
2. The feature was pushed to a live preview for QA *before* being marked ledger-complete ("not yet ledgered as complete") — per the commit message itself, this was a deliberate "build-tested only, not yet click-tested" push, i.e., the bug (whatever it was) was expected to be found via live click-testing, not caught beforehand.
3. `deleteLookbook`'s db.js bridge does no local-state refresh on success (§4) — any caller (like the reverted `onDeleteLookbook`) is fully responsible for re-fetching, and `hydrateCatalogue()`'s in-flight guard (`catalogueHydrating`) is a documented, still-present mechanism by which that re-fetch can silently no-op.
4. The reverted UI placement (separate "Designer lookbooks" list section) differs from this task's requested placement (three-dot inside the existing dropdown header, before Copy Link) — not a like-for-like rebuild.

---

## 9. Silent-fail pattern

The e28acfc fix and its follow-up list — `.superpowers/sdd/progress.md` (2026-09-16 entry), quoted in full:

> **Silent catalogue-import failure fix (missing merchant session) complete, tester verified** — commit `e28acfc` on branch `feat/ai-automation-gemini-phase`. **The bug:** `addCatalogueItem()` in `src/lib/db.js` did an optimistic local UI write immediately, then silently skipped the Convex write-through when the merchant session was missing/invalid — the item appeared saved in the UI but never persisted to Convex, no error surfaced, and it vanished on the next hydrate/refresh. [...] **NOTED FOLLOW-UP (not started):** a broader audit found 5 OTHER functions in `db.js` with the exact same silent-failure bug shape — `addStaffNote`, `checkout`, `setReviewStatus`, `removeCatalogueItem`, `saveTierSettings` — to be fixed as a separate task later, NOT in this one.

**Correction to the task's premise:** the actual 5-function follow-up list is `addStaffNote`, `checkout`, `setReviewStatus`, `removeCatalogueItem`, `saveTierSettings` — **not** `createLookbook`/`updateLookbook`/`deleteLookbook`/`updateCatalogueItem`/`deleteCatalogueItem` as the task description assumed. Only **one** of those five requested-to-check-today functions (`deleteCatalogueItem`, exposed as `removeCatalogueItem`) is actually on the real follow-up list. Assessing the risk for each of the five requested functions against today's code (bridges already quoted in full in §4 above):

| Function | Optimistic local write before session check? | Risk today |
|---|---|---|
| `createLookbook` (`db.js:1220-1225`) | No local write at all — pure `Promise` pass-through, `{ ok: false }` on no session | **Not present.** Caller (`addManual`, `Catalogue.jsx:116-117`) correctly awaits and checks `res.ok`. |
| `updateLookbook` (`db.js:1228-1233`) | No local write — `null` on no session | **Not present**, but currently unused anywhere in `Catalogue.jsx` (zero call sites found) — dormant, unverified by any real caller. |
| `deleteLookbook` (`db.js:1236-1241`) | No local write — `null` on no session/failure | **Not present** in the bridge itself (no optimistic write to silently fail). The real risk here is the separate local-refresh-race issue in §8, not this pattern. |
| `updateCatalogueItem` (`db.js:1309-1316`) | No local write — `null` on no session | **Not present**, and also currently unused in `Catalogue.jsx` (zero call sites) — dormant. |
| `deleteCatalogueItem` / `removeCatalogueItem` (`db.js:1318-1337`) | **Yes** — `state.catalogueItems = state.catalogueItems.filter(...)` + `emit()` run unconditionally at step 1, before any session check; Convex failure (including missing session) is caught and silently swallowed | **Still present today**, confirmed by current code, and is the one function of the five actually on the real e28acfc follow-up list. |

---

## 10. Upload bug

`convex/templates.ts:1-95`, `generateTemplateMediaUploadUrl`, in full:

```ts
import { action, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { put } from "@vercel/blob";
import { internal } from "./_generated/api";
import { requireMerchantSession } from "./auth";

export const checkMerchantSession = internalQuery({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    return null;
  },
});

export const generateTemplateMediaUploadUrl = action({
  args: {
    userId: v.id("users"),
    token: v.string(),
    file: v.bytes(),
    filename: v.string(),
    contentType: v.string(),
  },
  handler: async (ctx, { userId, token, file, filename, contentType }) => {
    await ctx.runQuery(internal.templates.checkMerchantSession, { userId, token });

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      throw new Error(
        "[generateTemplateMediaUploadUrl] BLOB_READ_WRITE_TOKEN is not set in the Convex deployment environment.",
      );
    }

    let url: string;
    try {
      const blob = await put(filename, file, {
        access: "public",
        token: blobToken,
        contentType,
        addRandomSuffix: true,
      });
      url = blob.url;
    } catch (err) {
      console.error("[generateTemplateMediaUploadUrl] Vercel Blob upload failed:", err instanceof Error ? err.message : String(err));
      throw new Error("Failed to upload media to storage. Please try again.");
    }

    return { ok: true, url };
  },
});
```

**Guard:** `checkMerchantSession` (an `internalQuery`, called via `ctx.runQuery` since actions have no `ctx.db`) → `requireMerchantSession(ctx, userId, token)`. On any auth failure this **throws** (not a graceful `{ok:false}` return), which rejects the action's promise entirely — no Blob upload is attempted.

`requireMerchantSession` — `convex/auth.ts:91-104`, in full:

```ts
export async function requireMerchantSession(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  token: string,
): Promise<UserDoc> {
  const user = await ctx.db.get(userId);
  if (!user) throw new ConvexError("Not authenticated");
  if (user.role !== "merchant") throw new ConvexError("Not authorized");
  if (user.session_token !== token) throw new ConvexError("Invalid session");
  if (!user.session_expiry || user.session_expiry < Date.now()) {
    throw new ConvexError("Session expired");
  }
  return user;
}
```

`user.session_token !== token` → `throw new ConvexError("Invalid session")` — this is the exact source of the screenshot's raw text.

**Manual Entry media upload code, Catalogue.jsx:136-156, in full:**

```jsx
  const onManualMediaFile = async (f) => {
    if (!f) return;
    const isAllowed = f.type.startsWith('video/') || f.type.startsWith('image/') || f.type === 'application/pdf';
    if (!isAllowed) { setMediaMsg('Only video, image, or PDF files are supported.'); return; }
    setMediaUploading(true);
    setMediaMsg('Uploading…');
    try {
      const bytes = await f.arrayBuffer();
      const res = await uploadTemplateMedia(bytes, f.name, f.type);
      if (res && res.ok) {
        setManual((m) => ({ ...m, image_url: res.url }));
        setMediaMsg(`"${f.name}" uploaded.`);
      } else {
        setMediaMsg('Upload failed — please try again.');
      }
    } catch (err) {
      setMediaMsg(`Upload failed: ${err?.message || 'please try again.'}`);
    } finally {
      setMediaUploading(false);
    }
  };
```

**`err.message` IS shown raw to the user** — `setMediaMsg(\`Upload failed: ${err?.message || 'please try again.'}\`)`, with no filtering, no session-specific handling. A Convex `ConvexError("Invalid session")` thrown from `requireMerchantSession` (via the action) reaches this `catch` block and its message text (which the Convex client reconstructs including function-path context, matching the screenshot's "...at requireMerchantSession" text) is printed verbatim.

**Session rotation — `merchantLogin`, `convex/auth.ts:112-147`, relevant excerpt:**

```ts
export const merchantLogin = mutation({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }) => {
    ...
    const token = randomHex();
    const now = Date.now();
    const expiresAt = now + SESSION_DAYS * DAY_MS;
    await ctx.db.patch(merchant._id, {
      session_token: token,
      session_expiry: expiresAt,
    });

    return { user: toPublicUser(merchant), token, expiresAt };
  },
});
```

**Every successful login unconditionally overwrites `session_token`/`session_expiry`** — there is no multi-session support. Logging in again anywhere (another tab, another device, or the same tab after a manual re-login) immediately invalidates every other browser's previously-saved token; the next locked call from that other browser throws `Invalid session`.

**Existing session-rejection handling pattern** — found in exactly one place, `src/pages/merchant/Customers.jsx:1184-1231`:

```js
// Merchant Session Lock follow-up fix: a locked Convex call (e.g. awardPoints)
// throws a ConvexError whose text is exactly one of these when
// requireMerchantSession (convex/auth.ts) rejects the merchant's cached
// {userId, token} — stale/rotated token (e.g. merchant logged in again in
// another tab/device), expired 7-day session, or a deleted/demoted account.
// getMerchantSession() only checks LOCALLY that a merchant row exists (see
// its own comment in src/lib/db.js) — it never re-validates the token against
// the backend, so the UI can keep showing the merchant as "logged in" while
// every locked call 403s with one of these messages. Matching on the known
// rejection text lets us tell that specific case apart from a real offline/
// validation error and recover cleanly instead of dumping the raw
// ConvexError string on screen.
const SESSION_REJECTED_MESSAGES = ['Invalid session', 'Session expired', 'Not authenticated', 'Not authorized'];
function isSessionRejected(err) {
  const text = (typeof err?.data === 'string' ? err.data : '') || err?.message || '';
  return SESSION_REJECTED_MESSAGES.some((m) => text.includes(m));
}
...
    awardPoints(userId, sign * n, reasonType, reason.trim())
      .then(() => { setDelta(''); setReason(''); setReasonType('normal'); })
      .catch((err) => {
        if (isSessionRejected(err)) {
          clearMerchantSession();
          navigate('/login', { replace: true });
          return;
        }
        setPointsError(err?.message || 'Could not save this adjustment — try again.');
      });
```

`grep -rn "isSessionRejected\|SESSION_REJECTED_MESSAGES" src/` confirms this helper is defined and used **only** in `Customers.jsx` (one definition, one call site — `PointsTool`'s `awardPoints` catch). **No central handler exists.** `Catalogue.jsx`'s `onManualMediaFile`, `onPdfUpload`, `addManual`, `addIg`, `onCsvParse` all have their own independent `catch` blocks that print `err.message` raw, with none of them checking for `isSessionRejected`-style text.

**Read-only admin check (no token printed) — `owner@boutique.in`'s live session state, converted to IST:**

```
email: owner@boutique.in
session_expiry_ist: 2026-10-02T12:06:09.326+05:30
has_session_token: true
_creationTime_ist: 2026-08-07T21:06:27.015332+05:30
```

(The other two merchant-role rows, `mdsaidulmould@gmail.com` and `digital@mouldinnovation.com`, have no `session_token` at all — never logged in via `merchantLogin`, or logged out.)

**Today's date is 2026-09-25** — `owner@boutique.in`'s `session_expiry` is **2026-10-02**, roughly a week in the future, i.e. **not naturally expired**. This is consistent with (not proof of) the screenshot's error being a **token-mismatch case (`session_token !== token`) rather than natural 7-day expiry** — e.g. the merchant (or someone else) logged in again somewhere else after the browser that hit the upload had already stored its own token, silently invalidating it. I did not call `merchantLogin` or reproduce this live, per the task's constraints, so this is the most likely root cause supported by the evidence above, not a confirmed reproduction.

**Does the upload work with a valid session?** Per the code path alone (not executed): `requireMerchantSession` returns the user object without throwing when `session_token === token` and `session_expiry >= Date.now()` (`auth.ts:96-103`); `generateTemplateMediaUploadUrl` then proceeds past the `checkMerchantSession` call to the `put()` Blob upload and returns `{ ok: true, url }` (`templates.ts:76-94`); `onManualMediaFile`'s `if (res && res.ok)` branch (`Catalogue.jsx:145-147`) then sets `manual.image_url` and a success message. This is a straight read of the code, not something I ran.

---

## 11. PDF linesheet + Instagram upload paths

**PDF linesheet upload** — `Catalogue.jsx:192-214` (`onPdfUpload`), calls `uploadPdfLookbook` (`db.js`) → `api.lookbooks.generatePdfUploadUrl` (an `action`, same `checkMerchantSession`/`requireMerchantSession` guard pattern as templates.ts, already quoted in full in §4's `convex/lookbooks.ts:344-361,382-424`):

```jsx
  const onPdfUpload = async (f, lookbookName) => {
    if (!f) return;
    if (!lookbookName || !lookbookName.trim()) return;
    setPdfUploading(true);
    setBulkMsg('Uploading PDF…');
    try {
      const bytes = await f.arrayBuffer();
      const res = await uploadPdfLookbook(bytes, f.name, lookbookName.trim());
      if (res && res.ok) {
        setBulkMsg(`"${lookbookName.trim()}" PDF lookbook uploaded successfully.`);
        getLookbooksForSelector().then((rows) => { if (Array.isArray(rows)) setLookbookOptions(rows); });
      } else {
        setBulkMsg('PDF upload failed — please try again.');
      }
    } catch (err) {
      setBulkMsg(`PDF upload failed: ${err?.message || 'please try again.'}`);
    } finally {
      setPdfUploading(false);
      setPendingPdfFile(null);
      setPdfNameInput('');
    }
  };
```

**Same backend guard shape as the Manual Entry bug (`checkMerchantSession` → `requireMerchantSession`, `convex/lookbooks.ts:355-361`), and the exact same raw-error display**: `setBulkMsg(\`PDF upload failed: ${err?.message || 'please try again.'}\`)` — an `Invalid session`/`Session expired` `ConvexError` would print raw here too, under the "Bulk loader" card's message line.

**Instagram screenshot "upload"** — `Catalogue.jsx:288-297`:

```jsx
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f?.type.startsWith('image/')) { const r = new FileReader(); r.onload = () => setIgImg(r.result); r.readAsDataURL(f); } }}
            onClick={() => pdfRef.current && pdfRef.current.click()}
            className="border-2 border-dashed border-line hover:border-gold p-6 text-center cursor-pointer transition-colors"
          >
            <div className="text-2xl mb-2">📸</div>
            <div className="text-sm">Drag & drop an Instagram screenshot</div>
          </div>
          {igImg && <img src={igImg} alt="ig" className="mt-3 h-28 w-full object-cover border border-line" />}
```

**This never calls any Convex action or Vercel Blob at all** — `FileReader.readAsDataURL(f)` encodes the image as a base64 data URL entirely client-side, stored directly in `igImg` state. It is immune to the `requireMerchantSession`/raw-error bug class described above, because there is no server round-trip at the "upload" step. (The subsequent "Add to lookbook feed" click does call `addCatalogueItem`, which already has the e28acfc fix — `res.ok === false` is checked and `res.error` shown cleanly, not a raw thrown error — `Catalogue.jsx:158-165`.)

---

## Final verification

```
$ git status --short
?? docs/qa-reports/2026-09-25-lookbook-delete-audit.md

$ git stash list
(empty)
```

Only the new report file differs from the branch-creation baseline in §2 (same set of pre-existing untracked scratch/doc files, plus this one new report). Stash is empty. No tracked file was modified. No commit was made on `feat/lookbook-delete`.
