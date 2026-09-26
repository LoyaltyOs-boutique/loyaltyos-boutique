# Multiple Photos Per Product — Read-Only Audit

**Date:** 2026-09-25
**Branch:** `feat/lookbook-delete` (soft-delete commits already pushed, no changes made by this audit)
**Scope:** Read-only. No code changed. This file is the only artifact created.

---

## Plain-language summary (for Saidul)

**What you asked about:** letting a merchant attach several photos to one product (not just one), with a photo slider on product cards, and a full-screen pinch-zoom viewer when a customer taps a photo — like the reference page on your own site.

**What I found, in plain words:**

1. **Today, a piece can have exactly one picture, and it's required.** The database field is `catalogue_items.image_url`, a single required text string — not a list. There is no second "photo 2", no gallery, no video field, nothing beyond one URL per piece.
2. **Nothing that looks like a gallery, slider, or zoomable viewer exists anywhere in this app today** — I searched the whole frontend for the usual keywords (carousel, slider, lightbox, zoom, swipe, pinch) and found zero matches. There isn't even a reusable "click a photo to see it bigger" pattern to build on — every product photo everywhere is a plain, non-clickable `<img>` tag.
3. **No photo-gallery or pinch-zoom library is installed.** This would need either a new small library added, or a hand-built viewer using plain React — a real decision to make, not just wiring.
4. **A video CAN technically be uploaded today** (the Manual Entry file box accepts video files) but it silently breaks — the video's URL just gets shown inside an `<img>` tag everywhere, which can't play video, so it shows as a broken image on every screen. This is a pre-existing gap, separate from the new feature.
5. **Only ONE file can be uploaded at a time today**, and there's no page anywhere to edit an existing piece and add more photos to it later — only "add a brand-new piece" exists. Building "add more photos to an existing piece" needs a new edit screen that doesn't exist yet.
6. **Good news: nothing needs to break.** Only 3 places actually read the picture field (the 4 display pages, the OG link-preview server, and the cart). If a photo list is added while keeping the existing single `image_url` field as "the cover photo," every one of today's single-photo pieces keeps working with zero changes to them.

## Recommended data design

**Keep `image_url` exactly as-is (the cover/first photo, unchanged type and required-ness) and add a new optional field for the rest of the gallery**, for example:

```ts
catalogue_items: defineTable({
  ...
  image_url: v.string(),                    // UNCHANGED — cover photo, always the first slide
  images: v.optional(v.array(v.string())),   // NEW — additional photo URLs, gallery order 2..N
  ...
})
```

This is additive and backward-compatible by construction:
- Every existing row has `image_url` and no `images` — every read path that only knows about `image_url` (OG middleware, cart, the 4 display pages, `src/data/seed.js`-shaped demo data) keeps working completely unchanged, with zero migration needed.
- A gallery-aware component reads `[item.image_url, ...(item.images || [])]` as the full ordered photo list — one photo today, several after the merchant adds more.
- "First photo is the cover" falls out naturally: `image_url` IS the cover by definition; reordering only ever reorders `images`, or (for a genuine "make a different photo the cover") swaps a value into `image_url` and adjusts `images` — needs an explicit merchant action, not automatic.

## Files a build would touch (estimate, not started)

- `convex/schema.ts` — add `images: v.optional(v.array(v.string()))` to `catalogue_items`
- `convex/lookbooks.ts` — `addCatalogueItem`/`updateCatalogueItem` args + `getLookbookById`/`getCustomerCatalogue`/`getCatalogueItemById` to carry `images` through
- `src/lib/db.js` — `addCatalogueItem`/`updateCatalogueItem`/`hydrateCatalogue`/`hydrateCustomerCatalogue` bridges to carry `images`; likely a new `uploadTemplateMedia`-style multi-file helper
- `src/pages/merchant/Catalogue.jsx` — Manual Entry needs a real multi-file picker + reorder/remove UI (does not exist today); **an edit-piece screen would need to be built from scratch** if photos should be addable to already-created pieces, not just at creation time
- `src/pages/Lookbook.jsx`, `src/pages/PublicLookbook.jsx`, `src/pages/PublicPiece.jsx`, `src/pages/merchant/Catalogue.jsx` (display side) — product-card slider + the new full-screen zoom viewer component (new file, e.g. `src/components/ui.jsx` or a new component file)
- `middleware.js` — no change needed if `image_url` stays the cover (already reads only that field)
- `package.json` — only if a library is chosen for the viewer instead of building it by hand

## Open decisions for Saidul

1. **Maximum photos per piece** — no limit is enforced anywhere today (not on the single photo, not proposed for a list). A cap (e.g. 6, matching common e-commerce norms) needs picking.
2. **Do videos join the gallery, or stay unsupported?** Today a video silently breaks (renders as a broken `<img>`). This audit did not find any video-specific handling to build on — deciding "photos only for now" vs. "also fix video playback" changes scope significantly.
3. **Is an edit-piece screen part of this task, or a separate one?** Confirmed no UI exists today to open an already-added piece and change anything about it, including adding photos later. Without it, extra photos could only ever be added at the moment of creation — existing (already-created) pieces could never gain a gallery without one.
4. **Library vs. hand-built viewer** — no gallery/zoom/gesture library is installed today (see §10). Pinch-zoom + pan + swipe + keyboard nav is meaningfully complex to hand-build correctly across touch and desktop; a small dependency (e.g. a lightbox/zoom library) is the lower-risk path but is a new dependency to accept.

---

## 3. Data model

`convex/schema.ts:163-176`, in full:

```ts
  catalogue_items: defineTable({
    lookbook_id: v.id("lookbooks"),
    title: v.string(),
    price: v.number(), // PAISE (₹12,500 → 1,250,000)
    image_url: v.string(),
    instagram_link: v.optional(v.string()),
    size: v.optional(v.string()), // Gate 2 — e.g. "S", "M", "L", "Free Size"
    colour: v.optional(v.string()), // Gate 2 — e.g. "Ivory", "Blush"
    // Design spec: docs/superpowers/specs/2026-09-25-lookbook-delete-design.md
    // Soft-delete pair (decision 1) — set by deleteLookbook's cascade when the
    // parent lookbook is deleted; missing/false = active.
    is_deleted: v.optional(v.boolean()),
    deleted_at: v.optional(v.number()),
  }).index("by_lookbook", ["lookbook_id"]),
```

**Exactly one field holds a piece's picture today: `image_url: v.string()`** (schema.ts:167) — a single, **required**, plain string. `instagram_link` (schema.ts:168) is NOT a picture field — it is an optional link to the *original Instagram post* (an external URL shown as a "View post ↗" link), confirmed by its only consumer:

`src/pages/merchant/Catalogue.jsx:511` (grid item):
```jsx
{i.instagram_link && i.instagram_link !== '#' && <a href={i.instagram_link} target="_blank" rel="noreferrer" className="text-[10px] text-gold tracking-wide2 uppercase mt-1 inline-block">View post ↗</a>}
```

There is no video field, no media array, no second image field anywhere in the schema.

**`addCatalogueItem`/`updateCatalogueItem` args** — `convex/lookbooks.ts:301-320,323-342`:

```ts
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
    // Reject adding into a soft-deleted lookbook (2026-09-25-lookbook-delete-design.md decision 3).
    const lb = await ctx.db.get(args.lookbook_id);
    if (!lb || lb.is_deleted === true) {
      throw new ConvexError("This lookbook has been deleted.");
    }
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
    // Reject edits to a soft-deleted piece (2026-09-25-lookbook-delete-design.md decision 3).
    const existing = await ctx.db.get(id);
    if (!existing || existing.is_deleted === true) {
      throw new ConvexError("This piece has been deleted.");
    }
    await ctx.db.patch(id, patch);
  },
});
```

**Every read path that returns the picture:**

`getLookbookById` — `convex/lookbooks.ts:90-104` (returns the full `catalogue_items` doc, `image_url` included as-is):
```ts
export const getLookbookById = query({
  args: { id: v.id("lookbooks") },
  handler: async (ctx, { id }) => {
    const lb = await ctx.db.get(id);
    if (!lb || lb.is_deleted === true) return null;
    const items = await ctx.db
      .query("catalogue_items")
      .withIndex("by_lookbook", (q) => q.eq("lookbook_id", id))
      .collect();
    return { ...lb, items: items.filter((i) => i.is_deleted !== true) };
  },
});
```

`getCatalogueItemById` — `convex/lookbooks.ts:211-219` (returns the full doc, `image_url` included as-is):
```ts
export const getCatalogueItemById = query({
  args: { id: v.id("catalogue_items") },
  handler: async (ctx, { id }) => {
    const item = await ctx.db.get(id);
    if (!item || item.is_deleted === true) return null;
    return item;
  },
});
```

`getCustomerCatalogue` — `convex/lookbooks.ts:186-198` (explicit thin projection, only `image_url`):
```ts
      for (const item of items) {
        if (item.is_deleted === true) continue;
        allItems.push({
          id: item._id,
          convexId: item._id,
          title: item.title,
          price: (item.price || 0) / 100, // Paise to INR — same conversion hydrateCatalogue() uses
          image_url: item.image_url,
          instagram_link: item.instagram_link || "",
          source: lb.source || "manual",
          lookbook_id: lb._id,
        });
      }
```

Merchant catalogue hydrate — `src/lib/db.js:1424-1453` (`hydrateCatalogue`), builds the flat client-side list from `getLookbooks` + `getLookbookById`:
```js
  client.query(api.lookbooks.getLookbooks, session)
    .then(async (lookbooks) => {
      if (!Array.isArray(lookbooks)) { catalogueHydrating = false; return; }
      const allItems = [];
      for (const lb of lookbooks) {
        const detail = await client.query(api.lookbooks.getLookbookById, { id: lb._id });
        if (detail && detail.items) {
          allItems.push(...detail.items.map((i) => ({
            id: i._id,
            convexId: i._id,
            handle: i._id.toLowerCase(),
            title: i.title,
            price: (i.price || 0) / 100, // Paise to INR
            image_url: i.image_url,
            instagram_link: i.instagram_link || '',
            source: lb.source || 'manual',
            likes: 0,
            likedBy: [], // per-customer like toggle state (bug fix — see likeItem())
            lookbook_id: lb._id
          })));
        }
      }
      ...
```

Every read path carries exactly one `image_url` string — confirmed no array anywhere.

---

## 4. Merchant add paths

**Manual Entry — Image URL input**, `src/pages/merchant/Catalogue.jsx:382`:
```jsx
<div><label className="label">Image URL</label><input className="input" value={manual.image_url} onChange={(e) => setManual({ ...manual, image_url: e.target.value })} /></div>
```
A single plain-text URL field — the merchant can type/paste one URL directly, no picker.

**Manual Entry — the drag-and-drop media zone**, `Catalogue.jsx:384-390`:
```jsx
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onManualMediaFile(e.dataTransfer.files?.[0]); }}
              onClick={() => manualMediaRef.current?.click()}
              className="border-2 border-dashed border-line hover:border-gold p-6 text-center cursor-pointer transition-colors"
            >
              <input ref={manualMediaRef} type="file" accept="video/*,image/*,.pdf" className="hidden" onChange={(e) => onManualMediaFile(e.target.files?.[0])} />
```
`e.dataTransfer.files?.[0]` and `e.target.files?.[0]` — **only the FIRST file is ever read**, both on drop and on the native file picker (no `multiple` attribute on the `<input>`). Accepts `video/*`, `image/*`, and `.pdf`.

**How an uploaded file becomes the piece's picture** — `Catalogue.jsx:205-225`:
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
      setMediaMsg(friendlyError(err));
    } finally {
      setMediaUploading(false);
    }
  };
```
A successful upload directly **overwrites** `manual.image_url` (`setManual((m) => ({ ...m, image_url: res.url }))`) — uploading a second file before submit would silently discard the first upload's URL (last-write-wins), confirming there is no concept of "several files queued for one piece" today.

**CSV linesheet Image URL column** — `Catalogue.jsx:235-251` (`onCsvParse`):
```jsx
  const onCsvParse = (f) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const rows = String(r.result).split(/\r?\n/).map((l) => l.split(',')).filter((r2) => r2.length >= 3 && r2[1].trim());
      setCsvPreview(rows.slice(0, 5));
      let added = 0;
      for (const [title, price, url] of rows) {
        if (title && price && url && url.startsWith('http')) {
          const res = addCatalogueItem({ title: title.trim(), price: Number(price), image_url: url.trim(), source: 'csv' });
```
Each CSV row is exactly `Title, Price, Image URL` (one column, per the column-hint label `Catalogue.jsx:318`: `"Columns: Title, Price, Image URL"`) — one URL per row, no support for multiple images per row.

**Instagram screenshot path** — `Catalogue.jsx:359,366,227-234`:
```jsx
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f?.type.startsWith('image/')) { const r = new FileReader(); r.onload = () => setIgImg(r.result); r.readAsDataURL(f); } }}
...
          {igImg && <img src={igImg} alt="ig" className="mt-3 h-28 w-full object-cover border border-line" />}
...
  const addIg = () => {
    if (!igImg) return;
    const res = addCatalogueItem({ title: 'Instagram Style Post', price: 0, image_url: igImg, instagram_link: igUrl || '#', source: 'instagram' });
```
Also single-file only (`e.dataTransfer.files?.[0]`). **Never calls `uploadTemplateMedia`/Vercel Blob at all** — `FileReader.readAsDataURL` encodes the image as a base64 `data:image/...` URI entirely client-side, and that raw base64 string becomes `image_url` directly (confirmed live in real data, §12).

**Upload function — `uploadTemplateMedia` bridge**, `src/lib/db.js:1054-1060`:
```js
export function uploadTemplateMedia(file, filename, contentType) {
  const client = getConvex();
  const session = merchantSessionArgs();
  if (!client) return Promise.reject(new Error('Offline — Convex is not connected.'));
  if (!session) return Promise.reject(new Error('Not logged in — please sign in again.'));
  return client.action(api.templates.generateTemplateMediaUploadUrl, { file, filename, contentType, ...session });
}
```

**Backend — `generateTemplateMediaUploadUrl`**, `convex/templates.ts:55-95`, in full:
```ts
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
        addRandomSuffix: true, // avoid overwriting an existing file with the same filename
      });
      url = blob.url;
    } catch (err) {
      console.error(
        "[generateTemplateMediaUploadUrl] Vercel Blob upload failed:",
        err instanceof Error ? err.message : String(err),
      );
      throw new Error("Failed to upload media to storage. Please try again.");
    }

    return { ok: true, url };
  },
});
```
**No size or type limit is enforced anywhere in this path** — `grep -n "MB\|\.size >\|maxSize\|file.size"` across `Catalogue.jsx`, `db.js`, and `templates.ts` returns zero hits. The only gate is the client-side MIME-prefix check at `Catalogue.jsx:207` (`video/*`, `image/*`, or exactly `application/pdf`) — no byte-size cap client- or server-side.

**Several files in one go today: no.** Every add path (`onManualMediaFile`, the Instagram drop, each CSV row) resolves to exactly one `image_url` string per `addCatalogueItem` call; nothing loops over multiple selected files for a single piece.

---

## 5. Edit path

**No UI exists today to edit an existing piece** (title, price, or picture). Confirmed via a full-codebase grep:

```
$ grep -rn "updateCatalogueItem" src/ convex/
src/lib/db.js:1365:export function updateCatalogueItem(id, patch) {
src/lib/db.js:1371:  return client.mutation(api.lookbooks.updateCatalogueItem, { id, ...p, ...session }).catch(() => null);
convex/lookbooks.ts:323:export const updateCatalogueItem = mutation({
```
Zero hits in any `.jsx` page/component — the bridge and backend mutation exist but are called from nowhere in the UI. A merchant can only Add or Remove a piece today; there is no "click a piece to edit it" affordance anywhere in `Catalogue.jsx`.

**`updateCatalogueItem`'s db.js bridge**, `src/lib/db.js:1364-1372`, in full:
```js
/** Patch catalogue item on Convex (async). MERCHANT-ONLY (Merchant Session Lock). */
export function updateCatalogueItem(id, patch) {
  const client = getConvex();
  const session = merchantSessionArgs();
  if (!client || !session) return Promise.resolve(null);
  const p = { ...patch };
  if (p.price !== undefined) p.price = Math.round(Number(p.price) * 100);
  return client.mutation(api.lookbooks.updateCatalogueItem, { id, ...p, ...session }).catch(() => null);
}
```

---

## 6. Customer-facing display

**(a) Customer lookbook, `src/pages/Lookbook.jsx:330-343`:**
```jsx
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
                {catalogue.map((item) => (
                  <article key={item.id} className="animate-fadeUp group">
                    <div className="relative bg-mist overflow-hidden border border-line">
                      <img src={item.image_url} alt={item.title} loading="lazy" className="aspect-[3/4] w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      <button
                        onClick={() => { likeItem(customer.id, item.id); setLikeAnim(item.id); setTimeout(() => setLikeAnim(null), 400); }}
                        className={cls('absolute top-3 right-3 h-9 w-9 bg-white/90 border border-line flex items-center justify-center text-lg transition-transform cursor-pointer hover:scale-110', likeAnim === item.id && 'animate-pop')}
                        aria-label="Like"
                      >
```
Image container: `"relative bg-mist overflow-hidden border border-line"`. Image: `"aspect-[3/4] w-full object-cover transition-transform duration-500 group-hover:scale-105"`. **No `onClick` on the `<img>` itself** — only the heart Like button (absolutely positioned over it) is clickable.

**(b) `PublicLookbook.jsx:85-92`:**
```jsx
              <article key={item._id || item.id} className="animate-fadeUp group">
                <div className="relative bg-mist overflow-hidden border border-line">
                  <img
                    src={item.image_url}
                    alt={item.title}
                    loading="lazy"
                    className="aspect-[3/4] w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
```
Identical container/image classNames to (a). No click handler at all.

**(c) `PublicPiece.jsx:70-76`:**
```jsx
          <div className="relative bg-mist overflow-hidden border border-line">
            <img
              src={piece.image_url}
              alt={piece.title}
              className="aspect-[3/4] w-full object-cover"
            />
          </div>
```
Same container class, image class drops the hover-scale/transition. No click handler.

**(d) Merchant Current catalogue grid, `Catalogue.jsx:481-487`:**
```jsx
              <div key={i.id} className="card overflow-hidden group">
                <div className="relative">
                  <img src={i.image_url} alt={i.title} className="aspect-[3/4] w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/80 to-transparent p-3 flex justify-between items-end">
                    <span className="text-[9px] tracking-wide2 uppercase text-white/80">{i.source} · {i.likes || 0} ♥</span>
                  </div>
                </div>
```
No click handler on the image.

**Click-to-enlarge / modal / lightbox / carousel / swipe anywhere in `src/` today: none.**
```
$ grep -rniE "lightbox|carousel|swiper|slider|zoom|touchstart|pointerdown|pinch" src/
(zero hits)
```
The only `modal`-matching hits in the whole codebase are the existing text/data `Modal` component (§11) used for customer-detail, approval, and activity-history popups — never for an image.

---

## 7. Video

**A video CAN be uploaded today** — `Catalogue.jsx:207`'s allow-check (`f.type.startsWith('video/')`) and the file input's `accept="video/*,image/*,.pdf"` (`Catalogue.jsx:389`) both accept it, and `generateTemplateMediaUploadUrl` (§4) uploads any content type to Blob with no type restriction server-side. The resulting video URL is stored in the exact same `image_url` string field as a photo — there is no branching anywhere by content type once the URL is stored.

**On every one of the 4 pages in §6, that video URL is rendered through a plain `<img src={...}>` tag** (confirmed: `grep -rn "<video" src/` returns zero hits anywhere in the app). A browser cannot play a video inside an `<img>` — the result is a broken-image icon on the customer lookbook, `PublicLookbook`, `PublicPiece`, and the merchant grid alike. This is a pre-existing gap, unrelated to and not fixed by this audit.

---

## 8. OG previews

`middleware.js:141-164`:
```js
    if (publicMatch) {
      const lookbook = await client.query(api.lookbooks.getLookbookById, { id: publicMatch[1] });
      if (!lookbook) return next(); // fail open — not found
      const firstImage = Array.isArray(lookbook.items) && lookbook.items.length ? lookbook.items[0].image_url : null;
      const html = ogHtml({
        title: lookbook.title || '85 Lansdowne',
        description: `${lookbook.designer ? lookbook.designer + ' — ' : ''}Curated lookbook from 85 Lansdowne.`,
        image: firstImage,
        url: pageUrl,
      });
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    if (pieceMatch) {
      const item = await client.query(api.lookbooks.getCatalogueItemById, { id: pieceMatch[1] });
      if (!item) return next(); // fail open — not found
      const html = ogHtml({
        title: item.title || '85 Lansdowne',
        description: 'Shop this piece from 85 Lansdowne.',
        image: item.image_url || null,
        url: pageUrl,
      });
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
```
`/lookbook/public/:id` uses `lookbook.items[0].image_url` (whichever `catalogue_items` row `.collect()` returns first for that lookbook — insertion order, not a designated "cover" concept). `/lookbook/piece/:pieceId` uses `item.image_url` directly. Both read only the single existing field — **keeping `image_url` as the cover in any new design means zero middleware changes are needed.**

---

## 9. Other consumers of the picture field

Full-codebase grep for `image_url` (excluding `_generated`):
```
convex/lookbooks.ts:172,193,308,330    — type + read/write (already quoted §3)
convex/schema.ts:167                    — field def (already quoted §3)
src/data/seed.js:46,51                  — demo seed data, same single-image_url shape (DO-NOT-EDIT file)
src/lib/db.js:1300,1319,1346,1437       — bridges (already quoted §3, §4)
src/pages/PublicPiece.jsx:72            — display (already quoted §6)
src/pages/Lookbook.jsx:223,334,370,415  — cart + display (see below)
src/pages/PublicLookbook.jsx:88         — display (already quoted §6)
src/pages/merchant/Catalogue.jsx:26,197,203,215,229,244,382,483 — add form + display (already quoted §3-6)
```
**AI prompts** (`convex/ai.ts`, `convex/events.ts`), **activity tracking** (`convex/activity.ts`, `customer_activity_events`), **WhatsApp share-text builders** (every `waLink`/`waShareLink`/`waPieceLink`/`waInquireLink` function across `Catalogue.jsx`, `PublicLookbook.jsx`, `PublicPiece.jsx`, `Lookbook.jsx`), **Templates.jsx**, **Campaigns.jsx**, **order/checkout backend** (`convex/orders.ts`) — **zero hits for `image_url` in any of these.** None of them read or embed the picture; WhatsApp messages are built from `item.title` + a link URL only, never the image itself. Orders store no item reference at all (confirmed in the earlier lookbook-delete audit) — no picture involvement there either.

**Cart** — `Lookbook.jsx:223` (adding to cart carries the cover image through, for the cart-line thumbnail):
```js
      return ex ? c.map((i) => (i.id === item.id ? { ...i, qty: i.qty + 1 } : i)) : [...c, { id: item.id, title: item.title, price: item.price, image_url: item.image_url, qty: 1 }];
```
Rendered at `Lookbook.jsx:370` (checkout cart-line thumbnail) and `:415` (a second list, order-history/points-ledger style thumbnail) — both plain `<img>`, no click handler:
```jsx
                      <img src={catalogue.find((c) => c.id === i.catalogueItemId)?.image_url || ''} className="h-16 w-14 object-cover border border-line" alt="" />
...
                      <img src={i.image_url} alt="" className="h-20 w-16 object-cover border border-line" />
```
Both would need to read the cover (`image_url`) the same as today — no change needed if the recommended design keeps `image_url` as the cover.

**Likes** (`likeItem`) — does not touch `image_url` at all; keyed purely by `customer.id`/`item.id`, confirmed via the same grep returning no hit in that function.

---

## 10. Dependencies and constraints

`package.json`, full `dependencies`/`devDependencies`:
```json
  "dependencies": {
    "@convex-dev/rate-limiter": "^0.3.2",
    "@vercel/blob": "^2.8.0",
    "@vercel/functions": "^3.9.5",
    "bcryptjs": "^3.0.3",
    "canvas-confetti": "^1.9.4",
    "convex": "^1.43.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.0",
    "resend": "^6.18.1"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^26.2.0",
    "@types/react": "^18.2.43",
    "@types/react-dom": "^18.2.17",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.5.4",
    "postcss": "^8.5.26",
    "tailwindcss": "^3.4.19",
    "vite": "^5.4.21"
  }
```
**No gallery, carousel, zoom, or gesture library is installed** — confirmed by the full list above (only React/React Router for UI; Convex, Blob, rate-limiter, bcryptjs, Resend for backend; canvas-confetti is a one-off celebration-burst effect, unrelated).

**`vercel.json`, headers section, in full:**
```json
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/((?!assets/).*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" },
        { "key": "Vercel-CDN-Cache-Control", "value": "no-store" }
      ]
    }
  ]
```
**No `Content-Security-Policy`, `X-Frame-Options`, or any `img-src`-style restriction exists anywhere in `vercel.json`** — nothing here would block images from Vercel Blob, Instagram, Shopify CDN, Unsplash, or any other host (confirmed live in real data, §12, where all 5 of those hosts are already in use today with no issue). This is a pre-existing, unrelated gap (already flagged in the 2026-09-04 security audit as missing security headers) — not a blocker for this feature, but also not something this feature should be read as "fixing."

---

## 11. Pin-to-pin references

**`Modal` component, `src/components/ui.jsx:42-58`, in full:**
```jsx
export function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 sm:p-8" onClick={onClose}>
      <div
        className={cls('card bg-white w-full my-6 animate-fadeUp', wide ? 'max-w-4xl' : 'max-w-lg')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h3 className="luxe-title text-lg">{title}</h3>
          <button onClick={onClose} className="text-steel hover:text-ink text-xl leading-none cursor-pointer">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
```
This is a **centered white card with a title bar and padding** (`bg-white`, `max-w-lg`/`max-w-4xl`, `p-6` content padding) — not a full-bleed dark image viewer. The backdrop pattern (`fixed inset-0 z-50 ... bg-ink/30`, click-outside-to-close via `onClick={onClose}` + `stopPropagation` on the inner card) is a reusable precedent, but the card chrome itself (white background, title bar, fixed max-width, padding) is not suited to a full-screen photo viewer without being bypassed entirely — a dedicated new overlay component is the realistic path, reusing only the backdrop/click-outside idiom.

**Product card classNames** — already quoted in full in §6(a)/(c): customer lookbook grid card container `"relative bg-mist overflow-hidden border border-line"` / image `"aspect-[3/4] w-full object-cover transition-transform duration-500 group-hover:scale-105"`; `PublicPiece.jsx` single-piece image container `"relative bg-mist overflow-hidden border border-line"` / image `"aspect-[3/4] w-full object-cover"` (no hover-scale, since there's no grid to hover into on a single-piece page).

**Arrow/chevron buttons and dot indicators anywhere in the app: none exist.**
```
$ grep -rniE "chevron|›|‹|◀|▶|arrow-left|arrow-right" src/
(zero hits)
```
A gallery slider, its arrows, and any dot/thumbnail-strip indicator would be new UI with no existing pattern in this codebase to copy — the only existing "row of small interactive controls" precedent is the notification kebab-menu classes (`text-steel hover:text-ink px-1.5 leading-none text-sm` for a button, `absolute right-0 top-full mt-1 ... bg-white border border-line shadow-lg z-50` for a popover), which is a different UI shape (a dropdown menu, not a slider).

---

## 12. Real data (admin read, `--limit 10000`)

```
$ npx convex data catalogue_items --limit 10000 --format jsonLines | wc -l
37
```

- **Total `catalogue_items`: 37, all 37 have a non-empty `image_url`.** Zero rows with a missing/empty picture.
- **Host breakdown of `image_url` values:**

| count | host |
|---|---|
| 28 | `kya9cip96sntdsv4.public.blob.vercel-storage.com` (Vercel Blob) |
| 6 | `85lansdowne.com` (the client's own site — demo/reference images) |
| 1 | `cdn.shopify.com` |
| 1 | `images.unsplash.com` |
| 1 | *(no host — a `data:image/...;base64,...` URI, 463,411 characters long)* |

- **Video media: 0** — no `image_url` value ends in a known video extension (`.mp4`/`.mov`/`.webm`/`.avi`/`.mkv`).
- The one no-host row is titled **"Instagram Style Post"**, created via the Instagram screenshot path (§4) — its `image_url` is a raw base64 data URI stored directly in the Convex document, not a Blob upload. This is worth flagging for the gallery design: if this base64-inline pattern continues per additional gallery photo, document size grows fast (this single field alone is ~450KB) — a gallery feature should very likely route the Instagram path through `uploadTemplateMedia`/Blob too, rather than keep inlining base64, though that is a separate decision from the photo-list schema change itself.

Nothing sensitive was printed — all values above are either counts, public hostnames, or a length figure.

---

## Final verification

```
$ git status --short
?? docs/qa-reports/2026-09-25-product-gallery-audit.md

$ git stash list
(empty)
```
