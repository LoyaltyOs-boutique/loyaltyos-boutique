# Lookbook Staleness — Permanent Fix Design

## Part 1 — CDN fix via Vercel Function
Add a new Vercel Function (api/dynamic-shell.js or equivalent, using the Node.js runtime for simplicity/compatibility) that reads the built index.html from the deployment's output and returns it verbatim, but with an explicit Cache-Control: no-store header set in the Function's own response (Vercel docs confirm Function-set headers are honored, unlike static-file headers which are ignored for caching purposes). Add new rewrites in vercel.json, placed BEFORE the existing catch-all SPA rewrite: one per customer-facing dynamic route (confirm the real route list in src/ first, don't assume only /lookbook, /join, /lookbook/public/:id — check the actual routes defined in the app). The existing catch-all /(.*) -> /index.html rewrite stays as the fallback for every other route (merchant pages etc. can keep static caching, since staleness there is not the reported problem and merchant users already have the hard-refresh habit from CLI-session-rotation).

## Part 2 — App-code success/failure distinction
In src/lib/db.js, change hydrateCustomerCatalogue's onSettled contract so it reports which outcome occurred instead of being a bare no-arg callback — e.g. onSettled({ ok: true }) on genuine success (items array with length > 0), onSettled({ ok: false, reason: '<no-client|no-array|empty|error>' }) on every other branch (missing client, non-array/null response, empty array, thrown rejection). In src/pages/Lookbook.jsx, replace the boolean catalogueReady with a small state (e.g. 'loading' | 'ready' | 'error'), and when the outcome is failure, render a clear "Couldn't load your lookbook right now — tap to retry" message with a button that re-invokes hydrateCustomerCatalogue, instead of silently falling through to render stale state.catalogueItems. A genuine empty catalogue (merchant hasn't added any items yet) should NOT show the error state — distinguish that case with its own honest "No pieces added yet" message, not the retry-error UI.

## Explicitly NOT touched
convex/lookbooks.ts's getCustomerCatalogue logic itself (already correct), the merchant-side hydrateCatalogue/Catalogue.jsx pages, any other route's caching behavior beyond the customer-facing dynamic routes listed above.

## Implementation note (route list confirmed against src/App.jsx)
Customer-facing dynamic routes needing the Function rewrite (no MerchantGuard, must never serve stale cached HTML to a real client browser):
- `/lookbook` (magic-link personal module + 180-day session + public invitation landing)
- `/join` (self-onboarding)
- `/lookbook/public/:lookbookId` (public lookbook, no login)
- `/lookbook/piece/:pieceId` (public single-piece page)

`/login` is merchant-only (staff), left on the static/catch-all path along with all `/merchant/*` routes — out of scope per the design doc (merchant users already have the hard-refresh habit; staleness there is not the reported problem).

## Implementation note (Function file-access mechanism — researched, not guessed)
Vercel Functions (Node.js runtime, non-Next.js project) bundle extra non-code files via the `functions.<path>.includeFiles` glob key in `vercel.json`. At runtime the included file is available under `path.join(process.cwd(), '<same-relative-path-as-declared>')` — `process.cwd()` resolves to the function's own bundle root, and `includeFiles` preserves the declared relative path. For this project (`vite build` outputs to `dist/`), the Function declares `includeFiles: "dist/index.html"` and reads it via `fs.readFileSync(path.join(process.cwd(), 'dist/index.html'), 'utf-8')`. This is the documented mechanism for plain `/api/*.js` functions (confirmed via Vercel KB "How can I use files in Vercel Functions?" and the `functions` config docs) — NOT via the root `middleware.js` Routing Middleware, which has a separate, less-documented bundling model. This project already has a working `middleware.js` (OG-preview crawler carve-out), but this Part-1 fix is implemented as a standalone `/api` Function per the approved design, not by extending `middleware.js`, to stay on the documented, verifiable mechanism.
