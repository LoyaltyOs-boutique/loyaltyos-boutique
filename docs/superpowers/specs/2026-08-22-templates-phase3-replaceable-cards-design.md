# Design: Templates Phase 3 — Merchant-Replaceable Card Images

Date: 2026-08-22
Status: **Approved** — with one real bug fixed and one implementation
detail resolved during review
Branch: feat/templates-section-phase1 (continuing on same branch, per explicit user instruction)

## Problem
Merchant should be able to upload a new Anniversary or Birthday card
image that replaces the current one for future WhatsApp sends —
independently per type (changing Birthday must not affect Anniversary,
and vice versa). Until a merchant replaces a card, the current
Ma'am-provided hardcoded designs remain active.

## Data model
Reuse the existing generic settings table (convex/schema.ts) — no new
table. New settings key: "template_cards" (NOT "templates" — that key
already means something different: WhatsApp message-copy templates on
the Settings page, per PRD §8; using it would silently collide).

Value shape:
{
  anniversary: "<current active Blob URL>",
  birthday: "<current active Blob URL>"
}

Seed value (set once, at build time, not per-request): the current
hardcoded URLs —
  anniversary: 'https://kya9cip96sntdsv4.public.blob.vercel-storage.com/anniversary-card-v3-j8Wx0uuIVRtNeJ4HPnEgYzfBdoUWdi.png'
  birthday: 'https://kya9cip96sntdsv4.public.blob.vercel-storage.com/birthday-card-v3-ceGMUhD5Iwq0AP0f99yotycwhEBCJv.png'
This ensures the setting always resolves to a real URL — if a merchant
never replaces anything, behavior is identical to today.

## Backend changes

### Bug found and fixed during review (2026-08-22)
`convex/settings.ts`'s existing `upsertSettings(ctx, key, value)` helper
does a **whole-value overwrite** — `ctx.db.patch(existing._id, { value, ... })`
replaces the entire `value` field with whatever is passed in; it does
NOT deep-merge nested fields. The original draft of this design assumed
calling `upsertSettings(ctx, KEY, { [type]: url })` directly would
"update ONLY the field matching type, leaving the other field completely
untouched" — that is **false** against the helper's real behavior: it
would silently wipe the other card type's stored URL, directly
contradicting this design's own "Safety" section claim. Corrected:

2. **`setTemplateCardUrl` mutation** — takes `{ type: "anniversary" |
   "birthday", url: string }`. Implementation MUST read-merge-write:
   ```ts
   const existing = await getSettingsDoc(ctx, "template_cards"); // or the new query-compatible helper, see below
   const current = (existing?.value as { anniversary: string; birthday: string }) ?? DEFAULT_TEMPLATE_CARDS;
   const next = { ...current, [type]: url }; // spread first, only override the changed key
   await upsertSettings(ctx, "template_cards", next);
   ```
   This — not a bare `{ [type]: url }` — is what actually guarantees
   independence between the two card types, since `upsertSettings`
   itself has no merge logic of its own.

1. **`getTemplateCardUrls` query** — reads the `"template_cards"`
   settings doc, returns `{ anniversary, birthday }`, falling back to
   the hardcoded defaults above if the doc doesn't exist yet (first
   deploy before seeding) — never null/undefined.

   **Implementation detail resolved during review:** the existing
   `getSettingsDoc` helper is typed `ctx: MutationCtx` — a query
   function receives a `QueryCtx`, a distinct Convex type, and cannot
   pass it to a function typed for `MutationCtx`. Either broaden
   `getSettingsDoc`'s signature to `ctx: QueryCtx | MutationCtx` (both
   only need read access — `ctx.db.query(...).withIndex(...).first()`
   — so this is a safe, non-breaking widening), or give the new query
   its own equivalent inline read (three lines, same query/index).
   Prefer broadening the shared helper — avoids duplicating the read
   logic a third time.

3. **One-time seed**: the settings doc for `"template_cards"` is
   created with today's two hardcoded URLs before this feature ships
   (via a one-off script, same pattern as the earlier card-image
   upload scripts) — not left to be lazily created on first merchant
   use.

## Frontend changes (src/pages/merchant/Templates.jsx)
1. On page load, fetch current card URLs via the new query instead of
   using the hardcoded ANNIVERSARY_CARD_URL/BIRTHDAY_CARD_URL
   constants — CardSelect's single option now reflects whatever is
   currently active, not a build-time constant.
2. Add a "Replace card" upload control per MomentCard (Anniversary and
   Birthday each get their own, independent) — reuses MediaCard's
   exact upload pattern (drag-drop zone, uploadTemplateMedia call) but
   restricted to image files only (not video/PDF, since this is
   specifically a card-image slot).
3. On successful upload: call the new mutation with the correct type,
   then update the local displayed URL/CardSelect option to the new
   one immediately (optimistic update) — the next "Send via WhatsApp"
   for that type will use it.
4. Anniversary's upload control only ever calls the mutation with
   type: "anniversary"; Birthday's only ever with type: "birthday" —
   structurally impossible for one to affect the other at the UI
   layer, AND now correctly guaranteed at the mutation layer too (see
   bug fix above — this was the actual gap, not the UI layer).

## Middleware changes (middleware.js)
1. The TEMPLATE_CARDS branch changes from a static object lookup to a
   live Convex query (ConvexHttpClient, same pattern already proven in
   this file's /lookbook/* branches) — fetches current
   anniversary/birthday URLs from getTemplateCardUrls at request time.
2. Fail-open behavior: if the Convex query fails/times out/throws, fall
   back to the hardcoded default URLs (same values as the seed) rather
   than erroring — preserves this branch's existing zero-crash
   guarantee even though this introduces a new dependency (Convex
   reachability) that didn't exist for this branch before.
3. The existing /lookbook/* branches remain completely untouched.

## Explicitly NOT included
- No UI for viewing/managing card history (only current-active state).
- No approval workflow — merchant's upload takes effect immediately.
- No validation of uploaded image dimensions/aspect ratio (Phase 4
  candidate if quality issues arise).

## Safety
- Independence between Anniversary/Birthday is enforced at the
  mutation level via read-merge-write (see bug fix above — the naive
  "just pass the changed field" approach would NOT have achieved this,
  since upsertSettings performs a whole-value overwrite, not a merge).
  Even a bug in the frontend calling the wrong handler couldn't
  cross-contaminate the two, since the mutation itself reads the
  current full value and only overrides one key before writing back.
- middleware.js's new fail-open fallback means a Convex outage
  degrades to "shows the last-known-good hardcoded default," never a
  broken link.
- Existing /lookbook/* middleware behavior is provably unaffected
  (separate branch, no shared code touched).

## Testing plan
1. Seed script run + verified (settings doc created with correct
   defaults).
2. Backend: query/mutation tested directly (real calls, real data) —
   confirm updating one type leaves the other's stored URL **actually**
   unchanged (this is now the critical test given the bug found above
   — must verify with a real before/after read, not just assume the
   mutation is correct because it compiles).
3. Middleware: re-run the direct-handler harness for both crawler and
   non-crawler scenarios on both paths, confirming it now reflects the
   live setting, not the old hardcoded value.
4. Frontend: upload a real test image via each MomentCard's new
   control, confirm the mutation fires with the correct type, confirm
   CardSelect updates.
5. Full regression sweep — Card 3, existing /lookbook/* paths, rest of
   Templates page.
6. Real WhatsApp test (user) — confirm a replaced card actually
   unfurls correctly, and confirm the untouched type still shows its
   original design.
