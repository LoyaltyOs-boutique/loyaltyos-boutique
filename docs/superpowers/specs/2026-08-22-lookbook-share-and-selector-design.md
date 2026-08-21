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
