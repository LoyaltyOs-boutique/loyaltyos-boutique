# Design: WhatsApp Cloud API Integration — Templates Section

Date: 2026-08-24
Status: **Approved** — decisions locked in below
Branch: feat/whatsapp-cloud-api

## Problem
Templates section currently uses wa.me deep links — merchant must
manually tap "Send" in WhatsApp after a new tab opens, no delivery
confirmation, no true image attachment (only a link-preview). Ma'am's
WhatsApp Cloud API test-registration is pending; this task builds the
full architecture now (server-side send, real image attachments,
delivery tracking) using env-based credentials, so the feature goes
live the moment real credentials are set — no code changes needed at
that point.

## Scope — what this covers
1. A new Convex action that sends real WhatsApp messages via Meta's
   Graph API (`POST /<PHONE_NUMBER_ID>/messages`), used by Cards 1/2
   (Anniversary/Birthday) and Card 3 (Media send) as the primary send
   path, with the existing wa.me link-open kept as a live automatic
   fallback (see Decision 3).
2. Support for both message types Meta documents:
   - Template messages (pre-approved, required for first-contact —
     used once Anniversary/Birthday templates are created & approved
     in WhatsApp Manager).
   - Service/free-form messages (only valid inside an open 24-hour
     customer service window — used for Card 3).
3. Real media attachment — the card image is sent as an actual
   WhatsApp image message component, not a link the customer has to
   tap.
4. A settings-table entry for approved template metadata (name,
   language, category) — separate from the secrets themselves.
5. Frontend: Templates.jsx's "Send via WhatsApp" buttons call the new
   backend action first; on any failure they fall back to the current
   wa.me link-open, unchanged from today's behavior.

## What this explicitly does NOT do yet
- Does not create/submit the actual Anniversary/Birthday templates to
  Meta for approval — **Decision 2: manual**, done by Ma'am/Saidul via
  WhatsApp Manager once the test account exists. No "create template"
  action is added to `whatsapp.ts`.
- Does not implement webhooks for delivery-status tracking yet (Phase
  2 of this integration, once basic sending works).
- Does not implement 24h service-window session tracking — **Decision
  1: attempt-and-catch instead** (see below).
- Does not touch Groups API (not needed for Templates).
- Does not require real credentials to build/test the code structure
  — guard-clauses ensure the action fails safely and clearly if secrets
  are absent, exactly like the existing BLOB_READ_WRITE_TOKEN pattern.

## Secrets (Convex env vars — set later, not now)
Following the exact BLOB_READ_WRITE_TOKEN/RESEND_API_KEY precedent —
set via `npx convex env set <NAME> <value>` or the Convex dashboard,
never committed:
- WHATSAPP_ACCESS_TOKEN — the permanent System User access token
- WHATSAPP_PHONE_NUMBER_ID — the business phone number ID
- (WHATSAPP_BUSINESS_ACCOUNT_ID — optional, only needed if we later
  manage templates programmatically; not needed for this scope)

## New backend: convex/whatsapp.ts (new file, mirrors convex/templates.ts's shape)

### Action: sendWhatsAppTemplateMessage
Args: `{ to: string (bare 10-digit customer mobile), templateName: string,
languageCode: string, imageUrl: v.optional(v.string()), bodyParams: v.optional(v.array(v.string())) }`

Handler:
1. Read `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` from
   `process.env` inside the handler (not module scope) — guard-clause
   throw if either missing, exact same error-message shape as
   `generateTemplateMediaUploadUrl`: `"[sendWhatsAppTemplateMessage]
   WHATSAPP_ACCESS_TOKEN is not set in the Convex deployment
   environment."`
2. Normalize the phone number: reuse the existing `toWaPhone`-equivalent
   logic (91-prefix + bare digits) server-side — same transform
   already proven in Templates.jsx, relocated here.
3. Build the Graph API request body per the official template-message
   syntax (`type: "template"`, `template: { name, language: { code },
   components: [...] }`) — components array includes an image header
   component (using `imageUrl`) if provided, and body text parameters
   (`bodyParams`) if provided.
4. POST to `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`
   with `Authorization: Bearer <token>`, wrapped in try/catch. (Pinned
   to a stable dated version rather than tracking Meta's latest tag —
   confirm current stable version number at implementation time.)
5. On success: return `{ ok: true, messageId: <from response> }`.
6. On failure: `console.error` the raw Graph API error **response
   body only** (never log the Authorization header/token) server-side
   — Meta returns structured error JSON, log it in full for debugging
   — throw a clean user-facing `Error` with a short summary.

### Action: sendWhatsAppServiceMessage
Args: `{ to: string, type: "text" | "image", text: v.optional(v.string()),
imageUrl: v.optional(v.string()) }`

Same secret-reading/error-handling shape as above. Builds a service
(non-template) message payload per the official syntax. **Decision 1:**
no server-side or client-side session-window verification is added.
The action is simply called; if Meta rejects because no 24h window is
open, that rejection surfaces as a normal try/catch failure with
Meta's real error code/message, and the frontend's fallback behavior
(Decision 3) takes over — no new tracking infrastructure.

## Settings addition (convex/settings.ts)
New key: `SETTINGS_KEYS.WHATSAPP_TEMPLATES = "whatsapp_templates"`
(distinct from both `"templates"` and `"template_cards"` — confirmed no
collision). Value shape once templates are approved:
```
{
  anniversary: { name: "...", language: "en", status: "approved" },
  birthday: { name: "...", language: "en", status: "approved" }
}
```
Read via the same `getSettingsDoc`/`mergeX` pattern already
established (mirrors `mergeTemplateCards`). Empty/default value (no
template configured yet) is a real, expected state — the frontend
must treat it as "no template configured" and fall back to wa.me
(Decision 3), not crash and not block sending.

## Frontend changes (src/pages/merchant/Templates.jsx)

**Decision 3 — wa.me kept live as an automatic fallback, not dead code.**
Both `MomentCard.send()` and `MediaCard.send()` keep `buildWaLink`/
`toWaPhone` as active, in-use functions. New send flow:
```
try Cloud API send (template for Cards 1/2, service for Card 3)
  → on success: show "Sent" confirmation, done
  → on any failure (no secrets, no template configured in settings,
     Meta rejects the call, network error):
       fall back to window.open(buildWaLink(...)) exactly like today
```
The merchant is never blocked or worse off than the current behavior
— worst case is today's exact flow, best case is a direct API send
with no manual tap required.

**Decision 4 — MomentCard's message textarea.**
The textarea stays exactly as it is today (merchant can still see and
edit it) — but for the Cloud API path, only `name`/`nickname` are
extracted and sent as the approved template's parameter values to
Meta. The literal delivered wording on a successful Cloud API send is
Meta's approved copy with placeholders filled in — the textarea acts
as a local preview/personalization field for that path, not the
literal message body. When the wa.me fallback fires instead, the
literal textarea text is sent exactly as it is today (unchanged
behavior for that path).

Specific edits:
1. `MomentCard.send()` — call the new `sendWhatsAppTemplateMessage`
   action (via a new `src/lib/db.js` bridge function, mirroring
   existing bridge patterns) with `{name, nickname}` as `bodyParams`
   and the card's image URL. On any failure, fall back to
   `window.open(buildWaLink(...))` unchanged. Show a real
   loading/success/error state on the button (reusing the existing
   `replaceMsg`-style feedback pattern already in this file).
2. If no template is configured yet for a card type (settings doc has
   no entry for that `cardType`), skip the Cloud API attempt entirely
   and go straight to the wa.me path — this is the expected state
   until Ma'am/Saidul approve real templates, not an error.
3. `MediaCard.send()` — call `sendWhatsAppServiceMessage` first
   (Decision 1: attempt-and-catch, no window-tracking). On any
   failure (including a Meta window-closed rejection), fall back to
   `window.open(buildWaLink(...))` unchanged, with a short message
   explaining why (e.g. "Sent via WhatsApp link instead — customer
   hasn't messaged recently").
4. `buildWaLink`/`toWaPhone` are NOT deleted or commented out — they
   remain live, load-bearing fallback code.

## Files touched
- New: `convex/whatsapp.ts` (both actions)
- `convex/settings.ts`: one new `SETTINGS_KEYS` entry, no schema change
- `src/lib/db.js`: new bridge functions (`sendWhatsAppTemplateMessage`,
  `sendWhatsAppServiceMessage`), mirroring existing bridge patterns
- `src/pages/merchant/Templates.jsx`: `MomentCard`/`MediaCard`
  `send()` logic updated to try Cloud API first, fall back to the
  existing (unchanged) wa.me logic on any failure

## Explicitly NOT touched
- `middleware.js`, existing Convex files unrelated to this, any other
  page/route.
- No schema table changes (settings table reused, same as
  `template_cards`).

## Safety
- Guard-clauses mean the new actions fail safely and immediately (a
  clear thrown error, caught by the frontend) if secrets aren't set —
  no crash, no silent failure, no risk to any other part of the app.
- The wa.me fallback (Decision 3) means the merchant's ability to send
  is never worse than it is today at any point during this rollout —
  before secrets exist, before templates are approved, and even if
  the Cloud API call fails after credentials are live.
- Purely additive: one new backend file, one new settings key, bridge
  functions, and a `send()`-function-body change (try-Cloud-API-first,
  same-fallback-after) in two existing components — no existing route,
  page, or other feature touched.

## Testing plan (credential-free phase)
1. Build check.
2. Call `sendWhatsAppTemplateMessage`/`sendWhatsAppServiceMessage`
   directly (real Convex call, no real Meta call reached) with
   secrets deliberately unset — confirm the exact guard-clause error
   message, proving the fail-safe behavior works before any credential
   exists.
3. Confirm settings read/write for the new `whatsapp_templates` key
   (real data, independence from `template_cards`/`templates` keys —
   same read-merge-write discipline as before).
4. Frontend: confirm that with an empty `whatsapp_templates` settings
   doc, MomentCard's send skips straight to the wa.me path (no broken
   attempt, no disabled button) and MediaCard behaves the same way on
   a simulated Cloud API failure.

## Testing plan (once credentials arrive — separate future task)
1. Real template creation + approval in WhatsApp Manager (manual,
   Decision 2).
2. Real send test — confirm actual message delivery, image renders as
   a true attachment (not a link).
3. Confirm the wa.me fallback path still works unchanged (send with a
   deliberately wrong/expired token to force a Cloud API failure, and
   confirm it falls through cleanly).
4. Regression sweep — confirm nothing else in Templates or elsewhere
   broke.

## Decisions locked in (2026-08-24 review)
1. **Card 3 service window:** attempt-and-catch, no session tracking.
   Meta's real rejection is the signal; frontend falls back to wa.me.
2. **Template creation:** manual via WhatsApp Manager, not automated.
3. **wa.me logic:** stays live as an automatic fallback, not dead or
   commented-out code.
4. **MomentCard free-text field:** stays as a preview/personalization
   input feeding template params on the Cloud API path; sent literally
   only on the wa.me fallback path.
