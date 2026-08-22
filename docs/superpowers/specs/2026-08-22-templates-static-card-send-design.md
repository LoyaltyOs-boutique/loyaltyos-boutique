# Design: Static Card-Image Send (Templates Phase 2 — Revised)

Date: 2026-08-22
Status: **Approved**
Branch: feat/templates-section-phase1

## Problem
Ma'am has provided the real, final Anniversary and Birthday card designs
as static images (src/assets/templates/anniversary-card.png and
birthday-card.png). Replacing the abandoned @vercel/og dynamic-rendering
approach: the card is now a fixed image per type, not dynamically
generated text-in-image. Merchant's message stays as plain WhatsApp
chat text; the card image is sent as a rich link-preview alongside it.

## Approach (all already-proven patterns, zero new infrastructure)
1. One-time upload: each of the two card images gets uploaded to Vercel
   Blob (reusing the existing, already-tested uploadTemplateMedia bridge
   → convex/templates.ts → @vercel/blob put()), producing two stable
   public Blob URLs. This happens once (not per-send) — the URLs are
   then hardcoded as constants in Templates.jsx (or fetched once and
   cached), since the images don't change per-customer.
2. "Choose a card" control: Anniversary and Birthday cards in
   Templates.jsx each get a simple selector — Phase 2 shows exactly one
   hardcoded option (the respective card image), styled as a dropdown
   or radio-style selector using existing .input/.label classes, ready
   to hold more options later without restructuring.
3. Send flow: merchant fills Full Name/Nickname/Message as before
   (Phase 1, unchanged). On "Send via WhatsApp", the message text sent
   via wa.me includes the merchant's message PLUS the selected card's
   Blob URL, so WhatsApp unfurls the image as a rich preview when the
   customer receives it (same visual result as the "Mirarii Lookbook2"
   test the user already confirmed works).
4. Middleware extension: the existing OG-preview middleware
   (middleware.js) currently only matches /lookbook/public/:id and
   /lookbook/piece/:pieceId. A raw Vercel Blob image URL does NOT need
   OG tags to preview in WhatsApp — WhatsApp natively unfurls direct
   image URLs (.png/.jpg) without needing custom meta tags, unlike PDF
   links. So no middleware change is needed for this — confirm this
   during testing rather than assuming, but no code change is proposed
   here for middleware.js.

### Confirmed during review (2026-08-22)
- `middleware.js`'s `matcher` (`/lookbook/public/:id`, `/lookbook/piece/:pieceId`)
  only covers same-origin app paths. Vercel Blob URLs live on a
  completely different domain (`*.public.blob.vercel-storage.com`), so
  the middleware is structurally irrelevant to them regardless of
  matcher scope — "no middleware change needed" is confirmed correct,
  not just plausible.
- `generateTemplateMediaUploadUrl`'s signature (`{file, filename,
  contentType}`) is already fully generic — no changes needed to reuse
  it for the two one-time PNG uploads; already verified end-to-end with
  a real PNG in an earlier task (real Blob URL returned, curl -I
  confirmed HTTP 200 + correct content-type/length).
- Note (not a blocker): `src/assets/templates/*.png` (~3.4MB combined)
  will sit in the repo without ever being imported/served by the
  running app — used only for the one-time Blob upload. Reasonable
  choice (keeps source images as version-controlled provenance) — just
  flagging it as a conscious tradeoff.

## What this explicitly does NOT include (per user's constraints)
- No dynamic text rendered into the image — image is fixed.
- No @vercel/og, no server-side image generation, no new dependency.
- No WhatsApp Business API — still wa.me link-based sending.
- No actual image attachment (technical limit without Business API,
  already explained to and accepted by the user) — this remains a
  rich link-preview, which visually presents as a card in WhatsApp.

## Files touched
- New: two Blob-uploaded image URLs (produced via a one-time upload
  step — could be a small one-off script or done through the already-
  built Card 3 upload flow manually, TBD in build task) hardcoded as
  constants in Templates.jsx.
- src/pages/merchant/Templates.jsx: MomentCard gains a card-selector
  UI element and the wa.me message-building logic gains the card URL.
- src/assets/templates/*.png: source images, already added by user,
  committed as-is (not served directly by the app — only used for the
  one-time Blob upload).

## Explicitly NOT touched
- middleware.js (no change needed per the analysis above — confirmed,
  not just assumed)
- convex/templates.ts, src/lib/db.js (existing upload bridge reused
  as-is, no changes)
- Card 3 (Video/Image/PDF Send) — unaffected
- Any other existing page/route/file

## Safety
Purely additive to Templates.jsx (one selector element + a URL
substitution in the message-building logic already there). No new
dependency, no new serverless function (avoiding the exact category of
problem that broke the @vercel/og attempt). Rollback = revert the
Templates.jsx diff.

## Testing plan
1. Upload both images to Blob once, confirm real public URLs, curl -I
   to confirm accessibility.
2. Build check.
3. Real WhatsApp share test (user) — confirm the card image unfurls as
   a rich preview for both Anniversary and Birthday sends.
4. Regression sweep — Card 3, sidebar, existing pages untouched.
