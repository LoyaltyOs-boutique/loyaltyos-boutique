# Step 6.1 — Lookbook Catalogue Backend — Design Spec

**Status:** Proposed
**Reference:** PRD Module 2 (Catalogue & Lookbook)
**Date:** 2026-08-13
**Scope:** Backend implementation of 8 CRUD functions in `convex/lookbooks.ts`. Zero frontend edits.

## Context

The current lookbook system uses `localStorage` (via `src/lib/db.js`) and demo seed data. This step implements the real Convex backend for Lookbook management, enabling the Merchant to create/edit collections and the Customer to view them from the database.

## Schema Overview (Reference from `convex/schema.ts`)

- **Table `lookbooks`**:
  - `title`: string
  - `designer`: string
  - `source`: "manual" | "pdf" | "csv" | "instagram"
  - `created_at`: number (ms)
- **Table `catalogue_items`**:
  - `lookbook_id`: Id<"lookbooks">
  - `title`: string
  - `price`: number (**PAISE integer**)
  - `image_url`: string
  - `instagram_link`: optional string
  - Index: `by_lookbook` on `["lookbook_id"]`

## Design Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Sectioned Structure** | Use clear markers (CONSTANTS, HELPERS, PUBLIC API) for maintainability. |
| 2 | **Aggregate item_count** | `getLookbooks` will return the list of lookbooks where each object includes an `itemCount` field calculated by querying `catalogue_items` by lookbook ID. |
| 3 | **Paise Money Invariant** | Price is ALWAYS an integer (₹125.50 = 12550 paise). Mutation validators will enforce `v.number()`. |
| 4 | **Cascade Delete** | `deleteLookbook` will use a loop to delete all associated `catalogue_items` first to ensure data integrity. |
| 5 | **Source Validator** | Restrict `source` to the union defined in schema: `manual`, `pdf`, `csv`, `instagram`. |

## Public API (convex/lookbooks.ts)

| Function | Type | Args | Description |
|---|---|---|---|
| `getLookbooks` | query | `{}` | Returns all lookbooks sorted by `created_at` desc, each with `item_count`. |
| `getLookbookById` | query | `{ id }` | Returns lookbook + `items` (via `by_lookbook` index). |
| `createLookbook` | mutation | `{ title, designer, source }` | Inserts lookbook with `created_at: Date.now()`. Returns `{ ok: true, id }`. |
| `updateLookbook` | mutation | `{ id, ...patch }` | Partial update of lookbook metadata. |
| `deleteLookbook` | mutation | `{ id }` | Deletes lookbook and all its catalogue items. |
| `addCatalogueItem` | mutation | `{ lookbook_id, title, price, image_url, instagram_link? }` | Inserts item. Enforces paise integer. |
| `updateCatalogueItem`| mutation | `{ id, ...patch }` | Partial update of item (price, title, etc). |
| `deleteCatalogueItem`| mutation | `{ id }` | Deletes a single item. |

## Global Constraints

- **Price**: Integer paise (₹1=100 paise).
- **Scalability**: Use indexes for all lookups (`by_lookbook`).
- **Safety**: Validators for all arguments. No `src/` edits.

## Verification Plan

1. **Build Check**: `npm run build` must succeed; CSS size 27.74kB (baseline).
2. **Convex Dev**: `npx convex dev --once` for type safety and deployment.
3. **Functional Tests** (`npx convex run`):
   - Create lookbook "Spring 2027" -> ID.
   - Add "Silk Saree" (1250000 paise) -> persisted.
   - getLookbooks -> `item_count: 1`.
   - Update price -> check persistence.
   - Delete lookbook -> verify items are gone from DB.
4. **Git**: Diff against main shows ZERO `src/` changes.

## Approval

- [ ] Proposed by Backend Agent
- [ ] Approved by User