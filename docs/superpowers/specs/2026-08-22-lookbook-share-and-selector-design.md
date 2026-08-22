# Design — Step A: Per-Piece Share Fix + Lookbook/PDF Selector

Approved by user, 2026-08-22. Part of the Gate 2 lookbook-sharing rework.

Problem being solved: Per-piece Copy Link/WhatsApp buttons currently share the whole
lookbook instead of that one piece. Plus: admin needs a way to switch between
"Current catalogue" (flat, existing), a named designer-lookbook (grouped, with
preview), or a PDF-lookbook (link-only, no preview) — with a lookbook-level Copy
Link + WhatsApp share appearing only when a specific lookbook/PDF is selected.

## 1. Schema changes

No new tables needed for Step A — lookbooks table already has name/id, catalogue_items
already has lookbook_id.

Add one field to lookbooks: `kind: v.optional(v.union(v.literal("catalogue"), v.literal("designer"), v.literal("pdf")))`
— distinguishes a normal designer-lookbook from a future PDF-lookbook (Step B).
Default/missing = treated as "catalogue" grouping, unaffected.

## 2. Backend (convex/lookbooks.ts or catalogue.ts)

New query `getLookbooksForSelector` — returns `[{_id, name, kind}]` for the dropdown
(excludes the implicit "Current catalogue" which is a UI-only pseudo-option, not a
real lookbook row).

No new mutation needed for the bug-fix itself — it's a frontend logic fix.

## 3. Frontend — bug fix (Catalogue.jsx)

Fix `copyPublicLink` and `waShareLink` to accept the piece's own id, not `lookbook_id`,
and route to a new per-piece public route (see #4), not `i.lookbook_id`.
Existing per-piece buttons stay in the exact same visual position/styling — only
their onClick/href target changes.

## 4. New per-piece public route

New page `src/pages/PublicPiece.jsx` at route `/lookbook/piece/:pieceId` — shows just
that one piece (image, title, price if given, size/colour if given), reusing the
exact same luxury styling tokens as the existing `PublicLookbook.jsx`.
WhatsApp message text becomes piece-specific: "Check out this [title]: [url]"
instead of generic lookbook text.

## 5. Frontend — new dropdown (Catalogue.jsx, "Current catalogue" heading row)

New `<select>` next to the heading, options: Current catalogue (default) →
[each designer-lookbook by name] → [each PDF-lookbook by name] (Step B will populate
the PDF ones; for Step A, only designer-lookbooks show real data, PDF option exists
in UI but empty until Step B).

On selecting a designer-lookbook: grid below re-filters to that lookbook's pieces
only (reusing existing grid rendering, just filtered), and a Copy Link +
WhatsApp-share pair appears top-right of the heading row, scoped to that lookbook's
existing `/lookbook/public/:lookbookId` route (already correct at the lookbook
level — only the per-piece one was broken).

On selecting a PDF-lookbook (Step B territory): grid hides entirely, only Copy Link +
WhatsApp-share show (no preview for PDFs). For Step A, this branch will just be
stubbed/disabled since no PDF-lookbooks exist yet.

Styling: exact match to existing button/select patterns already in this file — no
new visual language introduced.

## 6. Buy Now / Inquire buttons (per-piece, in both catalogue grid and PublicPiece.jsx)

"Inquire" — real, reuses the existing WhatsApp-inquiry pattern already built
(Improvement 5, customer-name-in-message).

"Buy Now" — dummy: visually present, same button styling, onClick shows a simple
"Coming soon" toast/alert — no real checkout wiring yet, pending Ma'am's decision.

## What stays untouched

- "Current catalogue" default view — same flat grid, same behavior, zero visual
  change when dropdown is on default.
- Existing lookbook-level share (already correct) — unchanged.
- All CSV/Instagram/manual upload flows — unchanged.

## Implementation order

- **Step A (this spec), backend half:** schema `kind` field + `getLookbooksForSelector`
  query. (convex/schema.ts, convex/lookbooks.ts)
- **Step A, frontend half (separate follow-up task):** #3-#6 above.

---

## Design — Step B: PDF Lookbook Upload + Storage

Approved by user, 2026-08-22.

Uses Vercel Blob (`@vercel/blob`, already installed; `BLOB_READ_WRITE_TOKEN` already
set in Convex env). Follows the exact same action+internalMutation pattern as
`convex/auth.ts`'s `forgotPassword` — actions call external services and can't touch
`ctx.db` directly, so DB writes go through `ctx.runMutation` to a paired
`internalMutation`.

### 1. Backend (convex/lookbooks.ts)

New `action` `generatePdfUploadUrl` — uses `@vercel/blob`'s `put()` (or equivalent
upload helper) with `BLOB_READ_WRITE_TOKEN` from env, to upload a PDF file and get
back its public URL.

New `internalMutation` `createPdfLookbook` taking `{name, pdf_url}`, inserting a new
`lookbooks` row with `kind: "pdf"` and that `pdf_url`. The action calls the
internalMutation via `ctx.runMutation` after a successful upload.

### 2. Frontend (Catalogue.jsx)

The existing PDF-picker in the "CSV/PDF Linesheet" card currently mis-parses PDFs as
CSV text. Fix: branch on file extension — `.csv` keeps existing logic unchanged,
`.pdf` triggers a name-prompt then calls the new upload action, then the new
lookbook appears immediately in the Step A dropdown.

### 3. Client-facing

No custom PDF viewer — the Step A dropdown's existing Copy Link/WhatsApp-share for a
selected PDF-lookbook points straight at the raw Blob URL; browsers render PDFs
natively.

### 4. Untouched

CSV-import logic itself (only gated behind a proper file-type check now),
Instagram/manual flows, everything from Step A.

### Implementation order (Step B)

- **Step B, backend half (this task):** `generatePdfUploadUrl` action +
  `createPdfLookbook` internalMutation. (convex/lookbooks.ts only)
- **Step B, frontend half (separate follow-up task):** Catalogue.jsx PDF-picker fix.

---

## Design — Step C: Manual Entry → Assign to Designer Lookbook

Problem: Manual Entry currently has no way to assign a piece to a specific designer-lookbook — every manually-added piece only ever lands in the flat "Current catalogue" view (no lookbook_id set), even though designer-lookbooks already exist and are selectable in the Step A dropdown.

Add to the Manual Entry form: a new select field, "Add to", with options: "Current catalogue" (default, current behavior — no lookbook_id, unchanged), each existing designer-lookbook by name (kind !== "pdf", reusing the already-loaded lookbookOptions from Step A/B), and "+ New designer lookbook" which reveals a text input for a new lookbook name. On submit: if "Current catalogue" is selected, behave exactly as today (no change). If an existing designer-lookbook is selected, the new catalogue item is created with that lookbook's _id. If "+ New designer lookbook" is selected with a name typed, first create a new lookbook (kind: "designer", using the existing addLookbook-style pattern if one exists — check convex/lookbooks.ts for an existing createLookbook/addLookbook mutation and reuse it; if none exists, this needs a new small mutation), then create the catalogue item with that new lookbook's _id. After creation, refresh lookbookOptions (same pattern as the PDF upload's post-upload refresh) so the new lookbook is immediately selectable elsewhere.

What stays untouched: CSV import, Instagram flow, PDF upload flow (Step B), Step A's dropdown/sharing logic, existing manual-entry behavior when "Current catalogue" is chosen.

### Implementation order (Step C)

- **Reuse decision:** `createLookbook` mutation already exists in convex/lookbooks.ts
  (`{title, designer, source}`). Reused as-is, extended with one optional additive
  arg `kind: v.optional(...)` so a "designer"-kind lookbook can be tagged — no new
  mutation needed. The `createLookbook` db.js bridge already passes args through,
  and `addCatalogueItem` already accepts an optional `lookbook_id`, so db.js needs
  no change.
- **Frontend (Catalogue.jsx only):** "Add to" select + conditional new-name input in
  the Manual Entry card; `addManual` updated to resolve the target lookbook_id
  (none / existing _id / freshly-created) before adding the piece, then refresh
  `lookbookOptions`.
