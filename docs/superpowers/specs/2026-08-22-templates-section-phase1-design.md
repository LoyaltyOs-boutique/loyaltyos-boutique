# Design: Templates Section — Phase 1 (Structure Only)

Date: 2026-08-22
Status: **Approved** — corrected after technical review, ready for implementation
Branch: feat/templates-section-phase1

## Problem
Merchant needs a new "Templates" area to send personal outreach messages
(Anniversary, Birthday) and arbitrary media (Video/Image/PDF) to
customers via WhatsApp. This is Phase 1: structure only — sidebar entry,
route, three-card layout matching Lookbook Manager pin-to-pin. No final
message copy (pending Ma'am's two reference templates), no AI (future
gate).

## Design rule for this entire task
Every className used below is copied VERBATIM from the audit
(src/components/merchant/Shell.jsx, src/pages/merchant/Catalogue.jsx,
components/ui.jsx). No new Tailwind class or CSS is invented anywhere
in this task. If a needed pattern isn't in the audit, stop and ask
rather than invent one.

## 1. Sidebar entry
File: src/components/merchant/Shell.jsx
Add one new object to the existing NAV array (line 7-14), positioned
between the Lookbook Manager and Settings & Support entries:
  { to: '/merchant/templates', label: 'Templates', icon: '▤' }
No other change to Shell.jsx — NavList already maps over NAV generically,
so the new entry automatically inherits the exact same rendering:
  <span className="text-gold text-sm w-4 text-center">{n.icon}</span>
and the exact same NavLink className function (border-l-2/active-state
logic) already used for every other item. Nothing else in this file
changes.

## 2. Route registration
File: src/App.jsx
Add one import (matching the existing Catalogue import pattern, line 34):
  import Templates from './pages/merchant/Templates.jsx';
Add one route block (matching the existing Catalogue route exactly,
lines 71-74):
  <Route
    path="/merchant/templates"
    element={<MerchantGuard><Shell><Templates /></Shell></MerchantGuard>}
  />
This is a protected file per CLAUDE.md §5.4 (ASK-BEFORE-EDIT) — this
spec itself is the explicit approval request for this exact 2-line
addition, same precedent as the earlier PublicPiece route addition.

## 3. New page: src/pages/merchant/Templates.jsx
Page header — verbatim pattern copied from Catalogue.jsx (lines 175-179):
  <div>
    <div className="eyebrow mb-1">Anti-Shopify · Templates</div>
    <h1 className="luxe-title text-3xl">Templates</h1>
    <p className="text-sm text-steel mt-2">Send personal moments and media to your customers on WhatsApp.</p>
  </div>

Three-card grid — verbatim container (Catalogue.jsx line 182):
  <div className="grid lg:grid-cols-3 gap-5">

Each card — verbatim wrapper + heading pattern (Catalogue.jsx lines 183-185):
  <section className="card p-6">
    <div className="eyebrow mb-1">[card eyebrow]</div>
    <h3 className="luxe-title text-lg mb-3">[card title]</h3>
    ...
  </section>

### Card 1 — Anniversary
eyebrow: "Personal moment" / title: "Anniversary"
Fields, using the exact existing form pattern (label className="label" +
input className="input", as used throughout Catalogue.jsx):
  - Full Name (text input)
  - Nickname (text input — plain form field only; NOT stored in Convex,
    NOT sourced from CRM, since no nickname field exists in schema —
    confirmed via audit, not assumed)
  - Message (textarea — same .input class, styled as a multi-line
    textarea; hardcoded placeholder copy for Phase 1, e.g. "Happy
    anniversary, {name}! With love, 85 Lansdowne." — real copy replaces
    this in Phase 2 once Ma'am's templates arrive)
Customer-select mechanism: a toggle or two sub-tabs —
  (a) "Existing customer" — a <select> populated from the existing
      getCustomers query (convex/customers.ts:132-143), showing name +
      mobile; selecting one auto-fills Full Name and a phone number
      field (mobile). Nickname is NOT auto-filled (field doesn't exist
      on the customer record) — merchant types it manually every time.
  (b) "New / manual number" — merchant types Full Name, phone number,
      and Nickname manually.
  Use the existing Modal pattern (components/ui.jsx lines 42-58) if a
  popup selector is cleaner than an inline toggle — implementer's
  choice, but must reuse Modal as-is, not build a new dialog primitive.
Send button — verbatim existing primary button class:
  <button className="btn-ink w-full">Send via WhatsApp</button>
Behavior: assembles the hardcoded placeholder message with the entered
name/nickname substituted in, builds a wa.me link
(https://wa.me/<phone>?text=<encoded message>), opens it in a new tab.
No WhatsApp Business API — same pattern as this project's existing
waShareLink/waPieceLink/waInquireLink functions; reuse their exact
URL-encoding approach (`https://wa.me/${phone}?text=${encodeURIComponent(...)}`),
don't reinvent it.

**Phone-number format — resolved during review (2026-08-22):** every
existing wa.me link in this codebase either has no target number
(waPieceLink/waShareLink use `https://wa.me/?text=...`, generic share
sheet) or targets the boutique's own hardcoded, already-international
number (`BRAND.wa = '919836000000'`, used in waInquireLink). There was
no existing precedent for targeting a *customer's* stored mobile, which
is saved as a bare 10-digit string with no country code (per the Fix 3
"remove +91 prefix" design — `createCustomer`'s `mobile: digits`).
`wa.me` requires the full international format without `+`
(e.g. `919876543210`). **Decision: Templates.jsx prepends `'91'` to the
phone field when building the wa.me URL** (`91${phone}`), for both the
existing-customer auto-filled number and the manually-typed number —
matching the same country assumption `BRAND.wa` already hardcodes
elsewhere in this codebase. No backend or schema change; scoped
entirely to the one new page file.

### Card 2 — Birthday
Identical structure to Card 1, including the same `91${phone}` wa.me
prefix. eyebrow: "Personal moment" / title: "Birthday". Same three
fields, same customer-select mechanism, same Send via WhatsApp button,
same wa.me mechanism. Placeholder copy differs, e.g. "Happy birthday,
{name}! With love, 85 Lansdowne."

### Card 3 — Video/Image/PDF Send
eyebrow: "Share media" / title: "Send media"
Drag-drop zone — verbatim pattern (Catalogue.jsx lines 186-192):
  <div
    onDragOver={(e) => e.preventDefault()}
    onDrop={(e) => { e.preventDefault(); onMediaFile(e.dataTransfer.files?.[0]); }}
    onClick={() => mediaRef.current?.click()}
    className="border-2 border-dashed border-line hover:border-gold p-6 text-center cursor-pointer transition-colors"
  >
Accepts video, image, or PDF (file type check in the onMediaFile
handler, mirroring the existing CSV/PDF type-routing logic already in
Catalogue.jsx's onBulkFile).
Upload mechanism: reuses the exact existing Vercel Blob action pattern
(convex/lookbooks.ts's generatePdfUploadUrl + createPdfLookbook
internalMutation, src/lib/db.js's uploadPdfLookbook bridge) — a new
action/internalMutation pair following this exact same shape, just
generalized to accept the actual contentType of the uploaded file
instead of hardcoding "application/pdf". Do not invent a new upload
mechanism.
Same customer-select mechanism (and same `91${phone}` wa.me prefix) as
Cards 1-2.
Send button — same btn-ink w-full pattern. Behavior: after upload
succeeds, builds a wa.me link with the uploaded file's shareable Blob
URL included in the message text (so WhatsApp unfurls a preview using
the existing OG-preview middleware, IF the shared link is one of the
two middleware-covered path patterns — see open question below).

**Backend file location — resolved during review (2026-08-22):** the
new action/internalMutation pair lives in a **new `convex/templates.ts`**
file, not appended to `convex/lookbooks.ts`. Templates media isn't a
lookbook — this keeps `lookbooks.ts` focused and gives Templates its
own home for this and any future template-related backend work.

## Open question to resolve before/during build
The OG-preview middleware currently only intercepts /lookbook/public/:id
and /lookbook/piece/:pieceId. A raw Vercel Blob URL for arbitrary
uploaded media will NOT get an OG card automatically — WhatsApp will
either show a plain link or, for direct image/video URLs, sometimes
render a native inline preview on its own (no OG tags needed for a
raw .jpg/.mp4 link in many cases, unlike PDFs). This needs a quick
confirmation during build/testing, not a blocking redesign — plain
Blob links are an acceptable Phase 1 outcome; OG-card support for
arbitrary Templates media (if needed) is a Phase 2+ enhancement.

## Files touched
- src/components/merchant/Shell.jsx (1 new NAV entry — additive only)
- src/App.jsx (1 import + 1 route block — additive only, ASK-BEFORE-EDIT
  file, this spec is the explicit approval)
- New file: src/pages/merchant/Templates.jsx
- New file: convex/templates.ts (new action + internalMutation for
  generic media upload, mirroring the existing PDF pattern exactly)
- src/lib/db.js (1 new bridge function, mirroring uploadPdfLookbook)

## Explicitly NOT touched
- No existing page, route, or nav item modified beyond the one additive
  NAV entry
- No existing Convex schema, query, or mutation modified
- No nickname field added to the schema (deliberately out of scope —
  Phase 1 keeps it as an unstored form field only)
- convex/lookbooks.ts is not modified — new backend lives in
  convex/templates.ts instead
- No AI message drafting
- No WhatsApp Business API
- No final Anniversary/Birthday message copy/design (Phase 2, pending
  Ma'am's templates)

## Safety / rollback
Purely additive: one NAV entry, one route, one new page file, one new
backend file, one new bridge function. Nothing existing is modified in
a way that changes its behavior. Rollback = remove the NAV entry,
remove the route, delete the new files.

## Testing plan before merge
1. Build check — clean compile, CSS delta reported against the 28.51 kB
   baseline confirmed in the audit.
2. Visual side-by-side — Templates page vs Lookbook Manager page, confirm
   pin-to-pin class match (same card style/spacing/typography).
3. Full regression sweep — every existing sidebar item/page/flow
   untouched and working exactly as before.
4. Manual click-through — sidebar entry appears in the right position,
   active-state highlighting works, all three cards render, customer
   select (existing + manual) works, wa.me link generation produces a
   correct pre-filled message for a test send (verify the 91-prefixed
   number actually opens the right chat), media upload succeeds and
   returns a real Blob URL.
