# Templates.jsx AI-Generated Message Drafts — Design Spec (FINAL)

- **Date:** 2026-09-14
- **Branch:** `feat/ai-automation-gemini-phase`
- **Status:** FINAL — the three previously-open decisions are now LOCKED (see §6). Ready for implementation under Hard Rule 5.12 (spec-driven hard gate).
- **Related specs:** `docs/superpowers/specs/2026-09-04-phase3-whatsapp-ai-drafts-design.md`, `docs/superpowers/specs/2026-09-09-whatsapp-ai-draft-wame-design.md`, `docs/superpowers/specs/2026-09-03-ai-automation-architecture-design.md`

---

## 1. Context / Problem

The Templates section (`src/pages/merchant/Templates.jsx`) lets the merchant send Anniversary and Birthday WhatsApp cards. Today the message body is a **static hardcoded string** with a single `{name}` placeholder, passed as the `template` prop:

- Anniversary — `Templates.jsx:412`: `"Happy anniversary, {name}! With love, 85 Lansdowne."`
- Birthday — `Templates.jsx:423`: `"Happy birthday, {name}! With love, 85 Lansdowne."`

A `useEffect` at `Templates.jsx:180-182` recomputes the `message` state whenever `name`/`nickname`/`template` change: `setMessage(template.replace('{name}', who))`. Both cards are the **same `MomentCard` component** (`Templates.jsx:112`), rendered twice (`Templates.jsx:409-420` anniversary, `:421-430` birthday) with different props — not two code paths. The third card, `MediaCard` (`Templates.jsx:275`), has no template and is out of scope.

The rest of the app already has a full, tested on-demand Gemini draft chain (used by the Customers.jsx "Approve & Send" modal). Templates.jsx has never been wired to it. The goal of this spec: replace the static Anniversary/Birthday text in Templates.jsx with **real, on-demand Gemini-generated drafts**, while keeping the message fully hand-editable and keeping the static string as a graceful fallback when Gemini is unavailable.

`CustomerSelect` (`Templates.jsx:43-97`) drives `MomentCard`. It has two modes (`Templates.jsx:44`): **`'existing'`** (dropdown that fills name+phone from a real customer row) and **`'manual'`** (merchant types a new name/phone by hand). Both modes must produce a real AI draft after this change.

---

## 2. Existing Gemini Chain (reused — verified ground truth)

All claims below were re-verified by reading the cited files on `feat/ai-automation-gemini-phase`.

- **Core draft action** — `generateMessageDraft`, `convex/ai.ts:356-410`. It is an **`internalAction`** (`ai.ts:356`), args `{ customerName: v.string(), tier: v.union(silver|gold|platinum), occasion: v.union(birthday|anniversary) }` (`ai.ts:357-361`). Returns `Promise<string | null>` (`ai.ts:362`). Builds a prompt from name/tier/occasion + the merchant's configured promo copy, calls `callGemini`, returns `sanitizeGeminiOutput(result.text)` or `null` on failure (`ai.ts:406-408`). **Has zero date-awareness** — it can be called for any customer on any day.
- **Public, merchant-guarded, cache-wrapping action** — `generateMessageDraftPublic`, `convex/ai.ts:454-499`. Args `{ userId: v.id("users"), token: v.string(), customerId: v.id("users"), customerName: v.string(), tier: v.union(...), occasion: v.union(...), occasionDate: v.string() }` (`ai.ts:456-463`). Returns `Promise<string | null>`. Flow: session guard (`ai.ts:468`) → cache read (`ai.ts:471-477`) → on hit return cached (`ai.ts:477`) → on miss call `generateMessageDraft` (`ai.ts:480-484`) → if null return null WITHOUT caching (`ai.ts:487`) → else write cache row and return (`ai.ts:491-499`).
- **Session guard** — `checkMerchantSession`, an `internalQuery` at `convex/ai.ts:287`, invoked as `await ctx.runQuery(internal.ai.checkMerchantSession, { userId, token })` (`ai.ts:468`, same call at `:527`, `:884`). This is the exact guard pattern the new manual action must reuse.
- **Gemini helper** — `callGemini(prompt)`, `convex/ai.ts:217`. Reads `process.env.GEMINI_API_KEY` at call time; returns `{ success: false }` if unset (`ai.ts:223-227`), never throws. Result type `{ success: true; text } | { success: false }` (`ai.ts:204`).
- **Model** — pinned to `gemini-3.5-flash-lite` (`ai.ts:196`). `GEMINI_API_KEY` confirmed SET on prod deployment `pleasant-cobra-560`.
- **Frontend bridge (existing customers)** — `generateMessageDraftRemote(customerId, customerName, tier, occasion, occasionDate)`, `src/lib/db.js:580-596`. Resolves `null` if no client/session/occasionDate (`db.js:582`) or on any thrown error (`db.js:593-595`). Calls `api.ai.generateMessageDraftPublic` with `convexUserId(customerId)` (`db.js:585-593`). Already imported and used by `Customers.jsx` (`:9`, `:713`). **Templates.jsx does NOT import it yet.**
- **`convexUserId`** — `db.js:436-439`: maps a UI userId to its hydrated Convex `_id`, or returns the input unchanged if not found. For a manual/typed-in name there is no matching row, so it returns the non-id string, which then fails `v.id("users")` and the bridge try/catch resolves `null` (`db.js:593-595`) — i.e. manual entries currently fall back to static text with no crash. Decision (a) removes this dead-end for manual entries via a dedicated action.

### Cache table (reused as-is)
`ai_message_drafts`, `convex/schema.ts:324-336`: `{ customer_id: v.id("users"), occasion: birthday|anniversary, occasion_date: v.string(), draft_text: v.string(), generated_at: v.number(), status: pending|used|discarded }`, index `by_customer_occasion_date` on `["customer_id","occasion","occasion_date"]` (`schema.ts:336`). Read = newest pending row for the exact tuple; write = new pending row on miss; a Gemini failure writes nothing (retryable). The tuple stays fresh across days/years because `occasion_date` is part of the key.

### The "only fires when occasion is tomorrow" rule is NOT in the core function
That rule lived only in the now-disabled nightly cron (`convex/crons.ts`), never inside `generateMessageDraft`. The core function has no date filter, so on-demand calls for any customer on any day are correct and intended. No date-bypass is needed.

---

## 3. Customer occasion-date field (for the cache key)

The `users` table stores occasion dates as:
- `birthday: v.optional(v.string())` — `convex/schema.ts:52`
- `anniversary: v.optional(v.string())` — `convex/schema.ts:53`

These are **year-less month-day strings** (e.g. `"8-1"`), unpadded. Zero-padded `"MM-DD"` mirrors also exist — `birthday_md`/`anniversary_md` (`schema.ts:62-63`) — used by the indexed reminder queries.

**Cross-year staleness caution (design note, not an open decision):** Customers.jsx deliberately does NOT key the cache on the raw year-less string. It computes a canonical, year-bearing "specific real calendar day" via `canonicalTomorrowOccasionDate()` (`Customers.jsx:617-621`, e.g. `"2026-9-16"`) and passes THAT as `occasionDate` (`Customers.jsx:713`), because a year-less key would never change across years and would strand the cache forever (the exact P0-1/P1-3 bug that fix addressed — see `Customers.jsx:600-616`). Templates.jsx has no "tomorrow" semantics (the merchant may send on any day), so the implementer should key the existing-customer cache on a **canonical current-occurrence date derived from the customer's real `birthday`/`anniversary` M-D plus the current year** (mirroring the IST-shift technique in `Customers.jsx:617-621` / `convex/customers.ts`'s `upcomingWindow()`), NOT the bare year-less `birthday`/`anniversary` string. The bare M-D is the value read FROM the profile; it must be canonicalized into a year-bearing occasion-date before being used as the cache key, exactly as the rest of the codebase already does. Per Decision (b) the source is the customer's real occasion field (never today's date); this note only specifies how to turn that year-less source into a stable, non-staling key.

---

## 4. Proposed behavior

### 4.1 Existing-customer path (cache-backed — reuses the current chain)

When `CustomerSelect` is in `'existing'` mode and a real customer is chosen (`Templates.jsx:47-53` fills name+phone from the row):

1. `MomentCard` calls the existing bridge `generateMessageDraftRemote(customerId, customerName, tier, occasion, occasionDate)` (`db.js:580`), where:
   - `occasion` is the card's occasion (`'anniversary'` or `'birthday'`, from `cardType`).
   - `occasionDate` is the customer's REAL occasion date pulled from their profile field (`users.birthday` / `users.anniversary`, `schema.ts:52-53`), canonicalized to a year-bearing occurrence date per §3 — NEVER today's date. This keeps the cache key stable per customer+occasion regardless of the day the merchant actually sends.
   - `tier` is the customer's real tier.
2. On a non-null result: `setMessage(draftText)` — the AI draft becomes the editable message.
3. On `null` (no key / Gemini failure / manual-id mismatch / any throw): fall back to the current static `template.replace('{name}', who)` behavior (`Templates.jsx:181`) — unchanged fallback, no crash, no empty box.
4. A brief "Generating AI draft…" loading state is shown while the call is in flight (same UX posture as `Customers.jsx`'s modal), after which either the AI draft or the static fallback populates the textarea.
5. **Caching is guaranteed** by `generateMessageDraftPublic` (`ai.ts:454`): the first open for a given (customer, occasion, occasion_date) tuple calls Gemini once and caches; every later open for the same tuple is a zero-Gemini cache hit — including opens from Customers.jsx's modal, since both share the identical table + tuple convention.

### 4.2 Manual / typed-in-customer path (new backend, uncached, live each time)

When `CustomerSelect` is in `'manual'` mode (merchant typed a name/phone, no customer row, no `_id`, no tier):

1. `MomentCard` calls a NEW bridge that forwards to a NEW backend action `generateMessageDraftManual` (see §5), passing only `customerName` + `occasion` + the merchant session args.
2. The backend internally hardcodes `tier = "silver"` (lowest/safest default) purely for prompt generation, and reuses `generateMessageDraft`'s core prompt logic.
3. It does **not** read or write `ai_message_drafts` — there is no `customer_id` to key by, so **every manual-entry call is a live, uncached Gemini call each time** (this is intentional and acceptable: manual entries are ad-hoc and low-volume).
4. Returns `string | null` — same graceful-fallback contract. On `null` (Gemini failure / no key / any throw), fall back to the static `template.replace('{name}', who)` text exactly as today.
5. Same brief loading state as the existing path.

### 4.3 Regenerate control (both paths)

A small **"Regenerate" control** sits next to the Message textarea (`Templates.jsx:238-240`). Tapping it re-runs the appropriate draft call for the current name/occasion and overwrites the textarea with the fresh draft:

- **Existing-customer path:** Regenerate must FORCE a fresh Gemini call (skip the cache read) AND overwrite the cached row for that tuple, so subsequent normal opens serve the newly regenerated draft (not the old one, and not an uncached miss). This is a **force-regenerate** capability on the backend (see §5, chosen approach: an optional `forceRegenerate` arg on `generateMessageDraftPublic`). It must still WRITE/overwrite the cache row — it skips the cache *read*, not the cache *write*.
- **Manual path:** Regenerate simply calls `generateMessageDraftManual` again (already uncached and live every call — no special flag needed).
- On `null` from either regenerate call, keep the current message unchanged (or fall back to static) — never blank the box.
- The message textarea (`Templates.jsx:238-240`) remains a plain controlled `<textarea value={message} onChange=...>` throughout — **editable at all times**, before and after any draft/regenerate. Nothing about this change locks or disables it.

### 4.4 Styling of the Regenerate control

Templates.jsx does **not** import `lucide-react` and uses no emoji anywhere — its buttons are plain Tailwind classes. The Regenerate control must match the **existing icon/size-override button pattern already in this file**: the `CustomerSelect` mode-toggle buttons at `Templates.jsx:59-72` use `btn-ghost !py-1 !px-2 text-[9px]` (small ghost buttons), and the send button at `Templates.jsx:268` uses `btn-ink`. Reuse `btn-ghost !py-1 !px-2 text-[9px]` (small, secondary) for the Regenerate control with a plain text label (e.g. `Regenerate`) — no new icon dependency, consistent with the file's existing emoji-free luxury design. Do not introduce `lucide-react` solely for this button.

### 4.5 No-key / failure behavior (unchanged graceful chain)

With no `GEMINI_API_KEY`: `callGemini` returns `{ success: false }` (`ai.ts:223-227`) → `generateMessageDraft` returns null (`ai.ts:406`) → `generateMessageDraftPublic` returns null without caching (`ai.ts:487`), and `generateMessageDraftManual` likewise returns null → both bridges resolve null (`db.js:593-595`) → Templates.jsx falls back to the static string. Merchant never sees an error or an empty box.

---

## 5. Files this design would touch

### `convex/ai.ts` — CODE CHANGES (not just reuse)

1. **New action `generateMessageDraftManual`** (public, merchant-guarded). Args: `{ customerName: v.string(), occasion: v.union(v.literal("birthday"), v.literal("anniversary")), userId: v.id("users"), token: v.string() }`. Handler: run `await ctx.runQuery(internal.ai.checkMerchantSession, { userId, token })` FIRST (identical guard to `generateMessageDraftPublic` at `ai.ts:468`), then `await ctx.runAction(internal.ai.generateMessageDraft, { customerName, tier: "silver", occasion })` and return its `string | null` directly. **No `customerId`, no `tier` param from the caller; tier hardcoded `"silver"`; no read/write of `ai_message_drafts`.**
2. **Force-regenerate capability on `generateMessageDraftPublic`** (`ai.ts:454-499`) — add an optional arg `forceRegenerate: v.optional(v.boolean())`. When `true`, SKIP the cache-read step (`ai.ts:471-477`) and go straight to `generateMessageDraft`; on a non-null result, WRITE/overwrite the cache row (reuse the existing insert at `ai.ts:491-499`) so future normal opens serve the regenerated draft. When absent/`false`, behavior is exactly as today (cache-first). Chosen over a separate wrapper action because it keeps the cache-read/generate/cache-write orchestration in one place and avoids a second near-duplicate action; it is a minimal, additive optional arg.

### `src/lib/db.js` — small additions

1. **New bridge `generateMessageDraftManualRemote(customerName, occasion)`** — mirrors `generateMessageDraftRemote` (`db.js:580-596`): get client + `merchantSessionArgs()`, return `null` if missing, call `api.ai.generateMessageDraftManual` with `{ customerName, occasion, ...session }`, resolve `null` on any throw. No `convexUserId` / `occasionDate` (manual entries have neither).
2. **Pass a regenerate flag through the existing bridge** — extend `generateMessageDraftRemote` (`db.js:580`) with a final optional `forceRegenerate = false` param and forward it in the `api.ai.generateMessageDraftPublic` call args. Default `false` keeps every existing caller (e.g. `Customers.jsx:713`) unchanged.

### `src/pages/merchant/Templates.jsx` — small frontend addition (APPROVED FLOW FILE, see §6 Decision c)

1. **Import** `generateMessageDraftRemote` and `generateMessageDraftManualRemote` from `../../lib/db.js` (add to the existing import at `Templates.jsx:2`).
2. In `MomentCard` (`Templates.jsx:112`), when name/occasion resolve, call the appropriate draft path (existing-customer → `generateMessageDraftRemote` with the canonicalized real occasion date per §3; manual → `generateMessageDraftManualRemote`), set `message` from the result, and **fall back to the current `template.replace('{name}', who)`** on `null`. This augments — does not replace — the existing `useEffect` at `Templates.jsx:180-182` (keep it as the fallback/base). Add a brief loading flag for the "Generating AI draft…" state.
3. To know whether the selected entry is an existing customer (has `_id`/tier) or a manual one, surface `CustomerSelect`'s mode/selected-customer to `MomentCard` (small prop/lift — `CustomerSelect` already tracks `mode` and `selectedId` at `Templates.jsx:44-45`; pass the resolved customer object or a mode flag up so `MomentCard` can branch). No change to `CustomerSelect`'s existing UI.
4. **Add the Regenerate control** next to the textarea (`Templates.jsx:238-240`), styled `btn-ghost !py-1 !px-2 text-[9px]` to match `CustomerSelect`'s buttons (`Templates.jsx:59-72`). Wire it to force-regenerate (existing path → `generateMessageDraftRemote(..., true)`; manual path → `generateMessageDraftManualRemote(...)` again).
5. Textarea stays a plain controlled editable `<textarea>` (`Templates.jsx:238-240`) — no `readOnly`/`disabled`.

### No schema change
`ai_message_drafts` (`schema.ts:324-336`) is reused unchanged. No new table, no new index, no migration.

---

## 6. Locked decisions

- **(a) Manual/typed-in customers get real AI drafts** — via new `generateMessageDraftManual` action (tier hardcoded `"silver"`, uncached, live per call). LOCKED.
- **(b) `occasionDate` = customer's real occasion field (canonicalized), plus a Regenerate control** — never today's date; force-regenerate implemented as optional `forceRegenerate` arg on `generateMessageDraftPublic` (skips cache read, still overwrites cache write). LOCKED. (See §3 design note: the raw year-less M-D source must be canonicalized to a year-bearing occurrence date for cache-key stability, per the codebase's own P0-1/P1-3 fix.)
- **(c) Templates.jsx edit approval** — **self-approved by the project owner; no additional Ma'am/team sign-off is being waited on for this spec.** Note: Templates.jsx is not on the CLAUDE.md §5.4 default approved-files list, so this spec diverges from that default — but approval for this specific change is already granted, and the spec itself is not gated on any further approval. The edit stays surgical (data-layer wiring + one small button + import), touching no unrelated layout, tokens, or the sacred luxury design.

---

## 7. Open items

None. All three previously-open decisions (manual-entry drafts, occasionDate/Regenerate, Templates.jsx approval) are locked above. The only implementation-time judgment call — canonicalizing the year-less occasion string into a stable cache key — is specified in §3 with the exact existing pattern to reuse (`Customers.jsx:617-621`), not left open.

---

## 8. Regression surface (for the eventual QA pass — not part of this doc's build)

The eventual implementation must regression-check: Anniversary send, Birthday send, Media send (unchanged), existing-customer dropdown fill, manual name/phone entry, static-fallback when `GEMINI_API_KEY` is absent, Customers.jsx Approve & Send modal (shares the same cache tuple — must still hit cache), and every other `generateMessageDraftRemote` caller (default `forceRegenerate=false` keeps them unchanged). This spec introduces no schema/index change, so no data migration risk.
