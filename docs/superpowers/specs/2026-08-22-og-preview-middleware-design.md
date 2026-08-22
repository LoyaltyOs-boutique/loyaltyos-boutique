# Design: WhatsApp/Social Link Preview (OG Tags) for PDF and Lookbook Share Links

Date: 2026-08-22
Status: **Approved** — corrected after technical review, ready for implementation

## Problem
Share links for PDF-kind and regular lookbooks (`/lookbook/public/:id` and
`/lookbook/piece/:pieceId`) show no rich preview when shared on WhatsApp,
because this is a client-side-rendered Vite SPA. WhatsApp's crawler reads
only the initial static HTML and does not execute JavaScript, so no
React-based or head-tag-library solution can produce per-link dynamic
Open Graph tags.

## Constraint driving this design
This must NOT change behavior for real browser users in any way. The
existing SPA routing, Ma'am's UI components, and all current flows must
remain byte-for-byte identical for non-crawler traffic. Only requests
identified as social-media crawlers get different handling.

## Approach
Add a Vercel Middleware (`middleware.js` at repo root) scoped via matcher
config to only intercept `/lookbook/public/:id` and `/lookbook/piece/:pieceId`
paths. Runtime: default (Node.js / Fluid Compute) — not `runtime: 'edge'`.

Inside the middleware:
1. Read the `User-Agent` header.
2. If it does NOT match a known crawler pattern (WhatsApp, facebookexternalhit,
   Twitterbot, LinkedInBot, Slackbot, TelegramBot), return nothing/`undefined`
   and let the request pass through unchanged to the existing SPA. This is
   the default path for all real users.
3. If it DOES match a crawler UA:
   a. Extract the `id`/`pieceId` from the URL.
   b. Query Convex server-side (via `ConvexHttpClient` from `convex/browser`,
      called with `fetch`, safe on Node.js) for the lookbook or piece's name
      and a representative image URL.
   c. If the query succeeds, return `new Response(html, {headers: {'content-type':'text/html'}})`
      containing `<meta property="og:title">`, `<meta property="og:image">`,
      `<meta property="og:description">`, and `<meta property="og:url">`
      populated from the fetched data, plus a `<meta http-equiv="refresh">`
      fallback pointing to the real URL (in case a crawler partially renders it).
   d. If the query fails OR throws for any reason, fail open: skip the
      custom HTML and let the request pass through to the normal SPA,
      exactly as if it were a non-crawler request. Never block or error
      out the response.

### Technical corrections made during review (2026-08-22)
The original draft called `NextResponse.next()` for the pass-through case.
**This project has no `next` dependency** (`package.json` confirmed) — that
API does not exist here and would throw at runtime. Corrected to the
framework-agnostic Vercel Middleware contract: return nothing/`undefined`
to pass through; return a plain `Response` object to override.

The original draft also called this "Edge Middleware" targeting the Edge
runtime. Current Vercel guidance (checked this session) recommends against
defaulting to `runtime: 'edge'` — Middleware now supports full Node.js via
Fluid Compute with no material downside. Corrected to default runtime.

### Per-piece data lookup — new read-only Convex query required
`convex/lookbooks.ts:getLookbookById` already exists and is a clean O(1)
fetch for the `/lookbook/public/:id` case — genuine reuse, no new backend
code needed there.

For `/lookbook/piece/:pieceId`, no efficient query exists. The only current
piece-lookup code is `src/lib/db.js:getCatalogueItemById()` — a **client-side**
helper that fetches every lookbook, then linear-scans each one's items to
find a match (N+1 Convex reads). It is not callable server-side as-is and
would be too slow to run on every crawler hit.

**Decision (confirmed with user 2026-08-22):** add one new read-only Convex
query, `getCatalogueItemById`, to `convex/lookbooks.ts`, using
`ctx.db.get(id)` directly — a trivial O(1) lookup, same pattern as
`getLookbookById`. This is still read-only (no schema or mutation change),
but is one new Convex query function, which supersedes the original "no
Convex changes — read-only query reuse only" wording. The existing
`src/lib/db.js:getCatalogueItemById()` client helper is untouched — this is
an additive server-side query only.

## Files touched
- New file: `middleware.js` (repo root)
- `convex/lookbooks.ts`: one new read-only query, `getCatalogueItemById`
  (`ctx.db.get(id)` — no schema change, no mutation, no action)
- `vercel.json`: add a matcher/config entry scoped only to the two lookbook
  paths above. The existing SPA catch-all rewrite rule is not modified,
  only supplemented.

## Explicitly NOT touched
- No React component, page, or route file
- No existing OG/meta tag absence in `index.html` (SPA's own head stays as-is
  for real browsers)
- No Convex schema, mutation, or action changes — one additive read-only
  query only
- No changes to any existing share/copy-link logic (`copyPieceLink`,
  `waPieceLink`, `copyPublicLink`, `waShareLink`)
- No changes to `vercel.json`'s existing SPA rewrite behavior for non-matched
  paths
- No changes to `src/lib/db.js`'s existing `getCatalogueItemById()` client helper

## Rollback safety
Because the middleware fails open and only activates on a narrow path + UA
match, if anything goes wrong post-deploy the safest immediate fix is
deleting `middleware.js` and the `vercel.json` addition — this fully reverts
to current behavior with zero residual risk to the SPA. The new Convex query
is additive and inert if unused, so it does not need to be rolled back.

## Testing plan before merge
1. curl with a spoofed WhatsApp UA against a real lookbook/PDF share link
   on the Vercel preview URL — confirm OG tags appear in raw HTML response.
2. curl with a normal browser UA against the same URL — confirm response
   is unchanged from current production behavior (no OG HTML injected,
   normal SPA index.html served).
3. Manually load 3-4 existing pages (merchant login, magic-link flow,
   Ma'am's protected UI screens) in a real browser — confirm zero visual
   or functional change.
4. Test with Convex query intentionally failing (e.g. bad id) — confirm
   fail-open, no error page, no crash.
5. Verify `middleware.js` actually gets picked up and invoked by Vercel on
   this plain-Vite (non-Next.js) project — confirm via step 1's curl test
   on a real preview deploy, since this project has no prior precedent of
   using Vercel Middleware to point to.
