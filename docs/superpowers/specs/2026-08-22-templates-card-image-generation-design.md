# Design: Branded Anniversary/Birthday Card Image Generation (Templates Phase 2)

Date: 2026-08-22
Status: **Approved** — with confirmatory notes added after review, ready for implementation
Branch: feat/templates-section-phase1 (continuing on same branch)

## Problem
Templates Phase 1 (structure) is built and pushed. Ma'am has now provided
the real Anniversary and Birthday card designs (gold border, wreath
illustration, "85" emblem, custom merchant-entered message inserted
dynamically). We need to generate the actual branded image server-side
(not just plain WhatsApp text) so the exact designed card — with the
merchant's typed message inserted — is what the customer sees as a real
image in WhatsApp.

## Confirmed technical approach (from investigation)
- New Vercel Function: api/templates-card.js (same repo-root,
  zero-config convention already proven by middleware.js in this repo).
  NOT a Convex action — @vercel/og's ImageResponse is built/documented
  for the Vercel Functions Node.js runtime, not Convex's action runtime.
- New dependency: @vercel/og only.
- New font assets: Playfair Display + Montserrat, 2-3 weights each,
  sourced as real .ttf/.otf files (not the existing CSS Google-Fonts
  link, which @vercel/og cannot use), stored in a new folder (e.g.
  /fonts or /api/fonts), Latin-only subset where possible, watching
  Vercel's 500KB total function-bundle budget (JSX + CSS + fonts +
  images combined).
- One shared function handles both card types via a `type` query
  param/body field (`anniversary` | `birthday`), not two separate
  functions — avoids duplicating the shared border/wreath/emblem/footer
  layout code.

### Confirmatory notes added during review (2026-08-22)
- **Runtime**: no explicit `export const config = { runtime: 'nodejs' }`
  is needed for `api/templates-card.js`. That requirement was specific
  to `middleware.js`'s Routing-Middleware file convention (which
  defaults to Edge unless overridden) — plain Vercel Functions under
  `/api/` default to the Node.js runtime already. Confirmed via
  Vercel's own "other framework" OG-image example, which shows zero
  extra runtime config.
- **Local dev limitation, stated explicitly**: `/api/templates-card`
  is only reachable once deployed (Vercel preview or prod) — Vite's
  `npm run dev` has no local `/api` server, unlike Convex actions
  (reachable immediately via the live Convex dev deployment). This
  matches the testing plan below (already anchored on the Vercel
  preview, not local dev) — just making the limitation explicit so
  it isn't a surprise mid-build.
- **Open item, not resolved here**: whether `name` is actually
  rendered anywhere in the card image, or the design only ever uses
  the free-text `message` field, is unconfirmed — the reference images
  aren't available in this investigation. **Confirm this against Ma'am's
  actual reference images during implementation**, not by guessing.
  If the layout has no name slot, drop `name` from the function's
  payload/contract entirely rather than passing an unused field.

## Card design (from Ma'am's reference images)
Both cards share the same frame: cream/off-white background, thin gold
border, corner wreath illustration (dark green/gold leaves), centered
serif heading (Playfair Display), a horizontal ornamental divider, an
italic gold sub-line, a circular "85" wreath emblem, and a closing line
("With love from, 85 Lansdowne" / "Warmest Regards, 85 Lansdowne").

Per-type differences:
- Anniversary: heading "HAPPY ANNIVERSARY", italic sub-line "Celebrate
  your love. May this special day be as wonderful as you are.", closing
  "With love from, 85 Lansdowne", corner wreath in a gold/dark-green
  leaf pattern (matches reference image 2).
- Birthday: heading "HAPPIEST BIRTHDAY", italic sub-line "Warm wishes
  for a wonderful year ahead.", closing "Warmest Regards, 85 Lansdowne",
  corner wreath pattern per reference image 3 (eucalyptus-style leaves,
  slightly different arrangement/asymmetric top corners).
- The merchant's custom message (from the existing Message textarea in
  Templates.jsx) replaces "[CUSTOM MESSAGES CAN BE ADDED HERE]" —
  rendered as plain centered text in the card's serif body style.

## Flow (end to end)
1. Merchant fills Full Name / Nickname / Message in the Anniversary or
   Birthday card on Templates.jsx (already built, Phase 1).
2. On "Send via WhatsApp" click, the frontend calls the new Vercel
   Function (api/templates-card.js) with { type, message, name } (name
   used only if the card design needs it — primarily message is what
   fills the custom-message slot, per Ma'am's reference layout — see
   "Open item" above, to be confirmed during implementation).
3. The function renders the ImageResponse PNG and returns the image
   bytes.
4. The frontend uploads those bytes via the ALREADY-BUILT
   uploadTemplateMedia bridge (src/lib/db.js → convex/templates.ts →
   Vercel Blob) — reusing Phase 1's proven upload path, not building a
   new one.
5. The returned Blob URL is inserted into the wa.me message text
   (replacing the current hardcoded placeholder sentence), same
   wa.me-link-building logic already in Templates.jsx.
6. wa.me opens in a new tab with the image link in the message; when
   sent, WhatsApp unfurls it into a real image preview (raw image URLs
   typically preview natively in WhatsApp without needing OG-tag
   middleware, unlike PDFs — this will be confirmed during testing).

## Files touched (all new or narrowly additive)
- New file: api/templates-card.js (Vercel Function, @vercel/og)
- New folder: font files for Playfair Display + Montserrat (2-3
  weights), e.g. api/fonts/ or /fonts/
- package.json / package-lock.json: add @vercel/og dependency
- src/pages/merchant/Templates.jsx: MomentCard's "Send via WhatsApp"
  handler gains a call to the new function + upload step before
  building the wa.me link (replacing the current plain hardcoded
  message text with the generated image URL). No structural/layout
  change to the existing cards — same fields, same customer-select,
  same button.

## Explicitly NOT touched
- No existing route, middleware.js, or Convex action modified.
- No change to the existing website's Google Fonts CSS <link> or any
  other page's typography.
- No change to Card 3 (Video/Image/PDF Send) — unaffected by this task.
- No change to Shell.jsx, App.jsx, or any other file already
  committed in Phase 1.
- No AI-generated message content — merchant's typed message is used
  as-is.

## Safety / isolation
api/templates-card.js is a brand-new, isolated Vercel Function at a
path (/api/templates-card) that nothing else in the app calls or
depends on. It does not overlap with middleware.js's matcher scope
(/lookbook/public/:id, /lookbook/piece/:pieceId only) — confirmed no
routing conflict. If it fails or is misconfigured, it affects only the
"Send via WhatsApp" button on Cards 1-2 of the Templates page — no
other route, page, or existing flow can be impacted, since nothing
else references this new endpoint. Rollback = delete the new file,
new font folder, revert the one handler change in Templates.jsx, and
remove the dependency from package.json.

## Testing plan before merge
1. Build check — confirm no compile errors, confirm bundle-size budget
   respected (function bundle under Vercel's 500KB limit).
2. Direct test of api/templates-card.js on the Vercel preview (not
   local npm run dev — see runtime note above) — fetch the endpoint
   with a real type+message payload, save and visually inspect the
   returned PNG, compare side-by-side against Ma'am's reference images
   for visual fidelity.
3. Full regression sweep — confirm every existing Templates Phase 1
   behavior (Card 3 media upload, existing/manual customer toggle,
   sidebar, routing) and every other existing page/flow is untouched.
4. Real WhatsApp share test (user, live) — confirm the generated card
   image actually unfurls as a rich preview in WhatsApp, for both
   Anniversary and Birthday types.
