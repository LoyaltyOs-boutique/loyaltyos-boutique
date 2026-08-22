# Design Addendum: OG-Preview Middleware Extension for Template Cards

Date: 2026-08-22
Status: **Approved** — with one gap resolved during review
Branch: feat/templates-section-phase1

## Problem
Raw Vercel Blob image URLs for the Anniversary/Birthday cards do not
unfurl as WhatsApp image previews — confirmed via two real tests (large
file, then compressed file — both failed identically). This matches
this project's own prior discovery with PDF-lookbook links: WhatsApp's
crawler does not reliably render bare media URLs, but does render a
proper HTML page with Open Graph tags — exactly what middleware.js
already proves works for /lookbook/public/:id and /lookbook/piece/:pieceId.

## Approach
Extend the existing middleware.js matcher to also cover two new static
paths: /templates/card/anniversary and /templates/card/birthday. For
crawler UAs hitting these paths, return a minimal OG-tagged HTML page
(same ogHtml() pattern already in middleware.js) with og:image pointing
at the real (compressed) Blob URL, og:title set to "Happy Anniversary"
/ "Happiest Birthday" (matches the actual card art headings), and the
same meta-refresh fallback pattern. Non-crawler requests are handled
per the resolution below (NOT a generic fail-open to the SPA, unlike
the existing lookbook paths).

### Gap found and resolved during review (2026-08-22)
Unlike `/lookbook/public/:id` and `/lookbook/piece/:pieceId`, which have
real registered `<Route>` entries in `src/App.jsx` (`PublicLookbook`,
`PublicPiece`), the two new paths have **no corresponding SPA route**.
If non-crawler requests used the same generic `next()` fail-open as the
lookbook paths, a real customer tapping the link in WhatsApp would load
the SPA, match nothing, and land on the catch-all
`<Route path="*" element={<Navigate to="/lookbook" replace />} />` —
the customer-invitation landing page, not the card image. This is a
real production UX gap, not just a testing detail, so it's resolved
here rather than left open:

**Resolution: for these two specific paths only, non-crawler requests
redirect (302) directly to the real (compressed) Blob image URL** —
`return new Response(null, { status: 302, headers: { Location: blobUrl } })`
(or equivalent) instead of calling `next()`. A browser renders that
natively — exactly what someone expects after tapping an image link.
This does NOT change behavior for `/lookbook/*` paths — those keep
their existing generic `next()` fail-open unchanged. (The design's own
alternative suggestion — redirecting to `/merchant/templates` — was
considered and rejected: that page is merchant-only, behind
`MerchantGuard`, so a real customer would hit a login wall instead.)

## Files touched
- middleware.js: matcher array gains the two new paths; handler gains
  a small static lookup (type → title + Blob image URL) for these two
  fixed paths, reusing the existing ogHtml()/crawler-detection/fail-open
  logic as-is for the crawler branch — no restructuring of existing
  lookbook handling. Non-crawler branch for these two paths only
  redirects to the image (see resolution above) instead of the generic
  lookbook-style `next()`.
- src/pages/merchant/Templates.jsx: the two message-building call sites
  swap the raw Blob URL for the new /templates/card/... URL.

## Explicitly NOT touched
- Existing /lookbook/public/:id and /lookbook/piece/:pieceId handling
  in middleware.js — untouched, same logic, same fail-open behavior.
- No new Convex function, no new dependency, no new upload.
- vercel.json (middleware matcher is self-contained in middleware.js
  per the earlier-confirmed Vercel convention).

## Safety
This is the same proven mechanism already live in production
(middleware.js), extended with two more static entries in its own
lookup table. Fail-open logic (try/catch → next()) is unchanged for
crawler-branch errors and covers these new paths too. Zero risk to
/lookbook/* behavior since those code paths are not touched.

## Testing plan
1. Build check.
2. Real curl with spoofed WhatsApp UA against both new paths (once
   deployed) — confirm OG HTML with correct image/title.
3. Real curl with normal browser UA — confirm a 302 redirect straight
   to the real Blob image URL (per the resolution above, not a SPA
   pass-through).
4. Real WhatsApp test (user) — paste the new /templates/card/anniversary
   URL directly, confirm thumbnail now appears.
5. Real end-to-end test — Send via WhatsApp button on Templates page,
   confirm rich preview appears in actual WhatsApp.
