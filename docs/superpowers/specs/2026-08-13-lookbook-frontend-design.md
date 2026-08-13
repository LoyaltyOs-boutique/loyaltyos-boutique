# Step 6.2 — Lookbook Catalogue Frontend Wiring — Design Spec

**Status:** Approved
**Reference:** PRD Module 2 (Catalogue & Lookbook)
**Date:** 2026-08-13
**Scope:** Wire `src/lib/db.js` lookbook/catalogue functions to Convex (`api.lookbooks.*`). Zero component edits.

## Context

Step 6.1 implemented the Convex backend (`convex/lookbooks.ts`) with 8 CRUD functions. The frontend (`src/pages/merchant/Catalogue.jsx`) currently uses `src/lib/db.js` which reads/writes a `localStorage` seed. This step rewrites the lookbook/catalogue functions in `db.js` to call Convex while preserving the **synchronous UI contract** (local-first render, background sync) so `Catalogue.jsx` needs **zero changes**.

## Current `db.js` Catalogue Surface (lines 302-314)

```javascript
export function allCatalogue() { return [...state.catalogueItems]; }
export function addCatalogueItem({ title, price, image_url, instagram_link, source }) { ... }
export function removeCatalogueItem(id) { ... }
```

`Catalogue.jsx` calls these **synchronously** via `useDb()` hook (subscribes to `emit()`).

## Design Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Hydration Bridge** | Add `hydrateCatalogue()` (like `hydrateCustomers`/`hydrateSettings`) to seed `state.catalogueItems` from Convex on module load. Initial render = localStorage, then `emit()` swaps in live data. |
| 2 | **Local-First Mutations** | `addCatalogueItem` / `removeCatalogueItem` mutate `state` + `persist()` + `emit()` immediately (synchronous UI), then fire Convex mutation in background. Matches `merchantLogin` / `addStaffNote` / `saveTierSettings` patterns. |
| 3 | **API Parity** | Export all 8 Convex functions (`getLookbooks`, `getLookbookById`, `createLookbook`, `updateLookbook`, `deleteLookbook`, `addCatalogueItem`, `updateCatalogueItem`, `deleteCatalogueItem`) wrapping `client.query/mutation(api.lookbooks.*)` for future use / completeness. |
| 4 | **Price Handling** | Convex expects **paise (integer)**. `db.js` currently stores price as INR number (e.g., 4800). Convert `price * 100` on write; Convex returns paise, convert back `/ 100` for local UI shape. |
| 5 | **ID Mapping** | Convex returns `_id` (Id<"catalogue_items">). Local items use `id` (string). Store `convexId` on local item for future updates/deletes; fallback to local `id` if missing. |
| 6 | **No Component Edits** | Keep function names, signatures, return shapes identical. `Catalogue.jsx` imports `allCatalogue`, `addCatalogueItem`, `removeCatalogueItem` — unchanged. |

## Convex Function Mapping

| `db.js` Export | Convex Call | Notes |
|---|---|---|
| `getLookbooks()` | `client.query(api.lookbooks.getLookbooks)` | Returns lookbooks with `item_count` |
| `getLookbookById(id)` | `client.query(api.lookbooks.getLookbookById, { id })` | Returns lookbook + items |
| `createLookbook({ title, designer, source })` | `client.mutation(api.lookbooks.createLookbook, { title, designer, source })` | Returns `{ ok, id }` |
| `updateLookbook(id, patch)` | `client.mutation(api.lookbooks.updateLookbook, { id, ...patch })` | |
| `deleteLookbook(id)` | `client.mutation(api.lookbooks.deleteLookbook, { id })` | Cascades items |
| `addCatalogueItem({ lookbook_id, title, price, image_url, instagram_link })` | `client.mutation(api.lookbooks.addCatalogueItem, { lookbook_id, title, price: price*100, image_url, instagram_link })` | **Paise conversion** |
| `updateCatalogueItem(id, patch)` | `client.mutation(api.lookbooks.updateCatalogueItem, { id, ...patch })` | If `patch.price` exists, `* 100` |
| `deleteCatalogueItem(id)` | `client.mutation(api.lookbooks.deleteCatalogueItem, { id })` | |

## Hydration Logic (`hydrateCatalogue`)

1. Call `client.query(api.lookbooks.getLookbooks)` → returns lookbooks with `item_count`.
2. For each lookbook, call `client.query(api.lookbooks.getLookbookById, { id: lb._id })` to get items.
3. Flatten items, map to local shape: `{ id: item._id, convexId: item._id, title, price: item.price/100, image_url, instagram_link, source, likes: 0 }`.
4. Merge into `state.catalogueItems` (replace local seed).
5. `emit()`.

## Verification Plan

1. **Build Check**: `npm run build` → CSS 27.74kB.
2. **Convex Dev**: `npx convex dev --once` passes.
3. **Functional**:
   - `npx convex run lookbooks:getLookbooks` → shows test lookbook from Step 6.1.
   - Open Preview `/merchant/catalogue` → login → catalogue loads from Convex (test lookbook visible).
   - Add new product → verify in Convex Dashboard Data → `catalogue_items`.
   - Refresh page → product still there (persisted).
4. **Git Diff**: `src/` diff shows **ONLY** `lib/db.js` changed.

## Approval

- [x] Proposed by Backend Agent
- [x] Approved by User