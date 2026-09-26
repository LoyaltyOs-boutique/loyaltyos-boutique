# Lookbook Delete (soft) + Lookbook Manager error handling — Design (2026-09-25)

## Problem
Merchants cannot delete a designer or PDF lookbook. A previous attempt (commit 5c83005) was reverted after live QA showed a double-fire race (the delete succeeded but the screen reported failure) and no refresh. Separately, Lookbook Manager uploads show raw technical errors (for example "[CONVEX A(templates:generateTemplateMediaUploadUrl)] ... Invalid session") when the merchant session was replaced by a login elsewhere, and the per-piece Remove button still removes a piece locally even when the backend call fails.

## Audit facts this design relies on
- Current catalogue is an unfiltered view of all catalogue_items, not a lookbook document. A piece added to a designer lookbook is one catalogue_items row shown in both places.
- PublicLookbook, PublicPiece and the OG middleware already show a clean state when their query returns null.
- merchantLogin rotates session_token, so a login elsewhere invalidates this tab; Customers.jsx already has a session-rejection detection pattern.

## Decisions (approved by Saidul)
1. Soft delete. Deleting a lookbook sets is_deleted: true and deleted_at on the lookbook and on every piece whose lookbook_id is that lookbook. Nothing is removed from the database, so a later archive/unarchive feature can restore a lookbook with its pieces by clearing those fields. No restore UI in this task.
2. Every query that feeds a merchant screen or a customer screen skips soft-deleted lookbooks and pieces, so a deleted lookbook and its pieces appear nowhere (Lookbook Manager dropdown and catalogue, Campaigns event lookbook dropdown, customer lookbook, public lookbook and piece links, OG previews). Public lookups of a soft-deleted lookbook or piece return null so the existing clean "no longer available" state appears.
3. Mutations that add or edit pieces in a soft-deleted lookbook, or edit a soft-deleted piece, are rejected with a clear error.
4. Deletable: any lookbook document shown in the dropdown (designer and PDF kinds). Current catalogue is a view and never shows the delete option.
5. Placement: a small three-dot button beside the lookbook dropdown, before Copy Link, visible only while a lookbook (not Current catalogue) is selected. Styling copies the existing Dashboard notification three-dot menu classes exactly; no new classes.
6. Flow: three-dot, then "Delete lookbook", then an inline confirmation in the same row: "Delete <title> and its <N> pieces? They will be hidden everywhere." (PDF: "Delete PDF lookbook <title>? It will be hidden everywhere.") with Delete and Cancel. While deleting, both buttons are disabled and a second click does nothing.
7. After success: the lookbook and its pieces disappear from local state, the catalogue and lookbooks are re-fetched from Convex (not blocked by an in-flight refresh), and the dropdown switches to Current catalogue. On failure nothing is hidden locally and a clean message is shown.
8. Session expired (any Lookbook Manager upload, delete or remove): show "Your session has ended because this account signed in somewhere else. Please sign out and sign in again." in the existing error style and keep the form contents. No automatic sign-out. Other errors show a short clean message, never raw Convex text.
9. Per-piece Remove stays a permanent delete (unchanged behaviour), but no local removal happens until the backend confirms; on failure the piece stays and the clean message shows.
10. Out of scope: restore/archive UI (next feature), deleting uploaded files from Vercel Blob storage, orphaned review and activity rows.

## Backend
- Schema: add is_deleted: v.optional(v.boolean()) and deleted_at: v.optional(v.number()) to lookbooks and to catalogue_items. Additive only; no index changes unless an existing read cannot filter without one (report first).
- deleteLookbook: requireMerchantSession first. If the lookbook does not exist or is already soft-deleted, return { ok: true, alreadyDeleted: true, hiddenItems: 0 } (idempotent). Otherwise, in one mutation, patch every catalogue_items row with this lookbook_id that is not already deleted with is_deleted: true and deleted_at: now, then patch the lookbook the same way, and return { ok: true, alreadyDeleted: false, hiddenItems: <n> }.
- Every read of lookbooks or catalogue_items used by any screen filters out is_deleted === true (rows with the field absent are treated as not deleted).

## Tests
Backend: soft delete of a designer lookbook with pieces (rows still exist with is_deleted true; other pieces untouched), PDF lookbook, idempotent second call, unauthenticated call rejected, every read path excludes the deleted lookbook and pieces, public lookups return null, edits to deleted rows rejected. Frontend and browser: three-dot placement and visibility, confirm and cancel, double click, dropdown returns to Current catalogue, pieces gone without reload, customer lookbook and old public links show the clean state, Campaigns dropdown no longer lists it, session-expired message on upload/delete/remove with form kept, Remove button no longer silent-fails, CSS unchanged.

## Known issue left open by decision (2026-09-25)
Browser QA found a pre-existing bug: catalogue_items.lookbook_id is required, so when a piece is added to Current catalogue (Manual Entry, Instagram import or CSV linesheet) the db.js addCatalogueItem bridge (line 1340, "lookbook_id || lbs[0]._id") silently attaches it to the most recently created lookbook. Deleting that lookbook therefore also hides those pieces (soft delete, so the data is recoverable). Pieces have no source field, so existing wrongly attached pieces cannot be identified automatically. Fix options recorded: (A) make lookbook_id optional and update every read path; (B) a hidden, undeletable "catalogue"-kind home lookbook for Current catalogue pieces, excluded from dropdowns (recommended). Saidul chose to leave it for now. Also noted: after "+ New designer lookbook" in Manual Entry the new lookbook does not appear in that dropdown until reload.
