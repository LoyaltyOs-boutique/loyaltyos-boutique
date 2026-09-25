# Rate Limiting for Public Convex Functions — Design

> Status: design-only, not yet approved for build. This document is investigation + design ONLY — no implementation happens as part of this task. Written 2026-09-05 on branch `feat/ai-automation-gemini-phase`, reading `convex/customers.ts`, `convex/auth.ts`, `convex/reviews.ts`, `convex/events.ts`, `convex/settings.ts`, `convex/lookbooks.ts`, `convex/orders.ts`, `convex/notifications.ts`, `convex/crons.ts`, `convex/ai.ts`, `convex/templates.ts`, `convex/whatsapp.ts` directly, not from memory of past sessions.

---

## Summary

This is a **defense-in-depth layer** — a rate limiter placed in front of the small set of Convex functions that are genuinely public (no session/auth check) and accept meaningful attacker-controlled input (a mobile number or free-text review). It slows down automated abuse of those functions while they remain public.

**It explicitly does NOT fix the two open Critical vulnerabilities** identified in the 2026-09-04 full system audit (`docs/full-system-audit-2026-09-04.html`, Part F #1 and #2):

- **Critical #1 — account takeover:** `generateMagicTokenSelf` (and its deprecated alias `generateMagicToken`) mint a working 180-day session for ANY existing customer's mobile number, with zero authentication. An attacker who knows or guesses a customer's mobile gets a valid magic link to that customer's account.
- **Critical #2 — confidential data leak:** `createCustomer`'s duplicate-mobile branch returns the FULL existing customer record — including `magic_token`, `measurements`, and `staff_notes` — to an unauthenticated caller who simply submits a mobile number that already belongs to someone.

Both were fixed once (commit `5545175`, ledgered at `625aa6e`) and then **reverted** (commits `aed26cf`, `1c19ccb`, 2026-09-05) because the fix broke two live flows — the merchant Customer CRM list rendering, and `Onboarding.jsx`'s existing-mobile re-onboarding path (a caller of the deprecated `generateMagicToken` alias that the fix's own commit missed). See `.superpowers/sdd/progress.md`'s 2026-09-05 "Revert: Critical #1/#2 security fix caused a live regression, rolled back" entry for the full root-cause trace. Both vulnerabilities remain **OPEN** as of this document and need their own properly-tested fix in a **future task** — rate limiting only slows down how fast they can be exploited, it does not close them.

A companion, separate investigation concluded that open CORS is not the primary attack vector here (this app's auth is explicit-token-in-mutation-args, not cookies, so a malicious page embedding this app's Convex client still can't act as an authenticated user without already having a valid token/mobile) — but recommended rate limiting as defense-in-depth for exactly the public, input-accepting functions this document covers.

---

## Part A — Investigation Findings

### A1. Complete grep-verified list of public, input-accepting functions

Ran `grep -n "^export const .* = \(mutation\|query\|action\)("` across every file in `convex/*.ts` (65 exported functions total across `ai.ts`, `auth.ts`, `customers.ts`, `events.ts`, `lookbooks.ts`, `notifications.ts`, `orders.ts`, `reviews.ts`, `settings.ts`, `templates.ts`, `whatsapp.ts`), then cross-checked each against a call to `requireMerchantSession(ctx, ...)` in its handler body (`grep -c "requireMerchantSession(ctx" convex/*.ts` — counts per file: `ai.ts` 1, `auth.ts` 1, `customers.ts` 16, `events.ts` 4, `lookbooks.ts` 9, `notifications.ts` 3, `orders.ts` 5, `reviews.ts` 4, `settings.ts` 9, `templates.ts` 1, `whatsapp.ts` 1 — `crons.ts` and `schema.ts` export zero public functions, `crons.ts` is 100% `internalAction`/`internalMutation`/`internalQuery`, unreachable from any client).

**The 4 functions that are genuinely public AND accept meaningful attacker-controlled input:**

| Function | File | Guard? | Input | Realistic abuse |
|---|---|---|---|---|
| `createCustomer` | `customers.ts:781` | none | `mobile`, `name`, ... | Duplicate-mobile branch is Critical #2's leak vector — bulk-guessable mobiles scrape confidential customer data one guess at a time |
| `generateMagicTokenSelf` | `auth.ts:189` | none | `mobile` | Critical #1's takeover vector — mints a working session for any existing mobile |
| `generateMagicToken` (deprecated alias) | `auth.ts:236` | none | `mobile` | Byte-identical body to `generateMagicTokenSelf` — same vector, still actively called by `Onboarding.jsx`'s duplicate-mobile fallback and `Join.jsx`, cannot be ignored just because it's deprecated |
| `createReview` | `reviews.ts:50` | none (explicitly documented "PUBLIC + UNGUARDED by design" in its own comment) | `user_id`, `type`, `text`, `rating` | Pending-review spam a merchant must click through |

**Everything else checked and ruled out**, with reasoning:

- `getLookbookById` (`lookbooks.ts:82`) / `getCatalogueItemById` (`lookbooks.ts:101`) — public, but the only input is an existing Convex `_id` (not a guessable/enumerable business value like a mobile number), and this is the intentional Public Lookbook feature (`/lookbook/public/:id`, CLAUDE.md §3 "approved feature"). No confidential fields returned. Not a rate-limiting candidate.
- `getSettings` (`settings.ts:486`) / `getTemplateCardUrls` (`settings.ts:565`) — public queries but take **zero arguments**, return global (non-per-customer) config. No input to abuse, no per-victim enumeration possible.
- `getEventAccess` (`events.ts:427`) — public, but only accepts existing `customerId`/`eventId` values a merchant already dispatched; read-only status check (locked/unlocked), no confidential-field leak, mirrors `validateMagicToken`'s established verdict-only pattern. Not comparable to the two Criticals.
- `validateMagicToken` (`auth.ts:261`) — public, but requires the caller to already possess BOTH a valid `id` and the full 256-bit `token` (not guessable) — this is the intended mechanism for the magic link itself to work, not an enumeration vector.
- `createOrder`, all of `customers.ts`'s other 15 functions, `events.ts`'s CRUD/dispatch, all of `lookbooks.ts`'s writes, `notifications.ts`, `orders.ts`'s other queries, `reviews.ts`'s `approveReview`/`declineReview`/`getPendingReviews`/`getReviews`, all of `settings.ts`'s writes and its two remaining guarded reads, `templates.ts`, `whatsapp.ts` — every one of these calls `requireMerchantSession(ctx, userId, token)` as the first line of its handler (verified above, confirmed by direct read of `customers.ts`, `auth.ts`, `reviews.ts`, `events.ts`, and grep-counted for the rest). An unauthenticated caller cannot reach them at all.
- `ai.ts`'s `testGeminiConnection` and `templates.ts`'s `generateTemplateMediaUploadUrl` — both take `userId`/`token` args and call `requireMerchantSession` (confirmed by reading their arg/handler signatures).

This confirms the task's assumed list of 4 is **complete** — nothing else public-and-input-accepting was missed.

### A2. Convex's official rate-limiter component

**Package:** `@convex-dev/rate-limiter` (npm). GitHub source: `github.com/get-convex/rate-limiter`. Official listing: `convex.dev/components/rate-limiter`.

**Install + registration** (per `github.com/get-convex/rate-limiter`'s README, and independently corroborated by this project's own bundled `convex/_generated/ai/guidelines.md` lines 305-320, which already names `@convex-dev/rate-limiter` as the canonical answer for "per-key quotas, cooldowns, or throttling"):

```
npm install @convex-dev/rate-limiter
```

New file `convex/convex.config.ts` (does not currently exist in this repo — confirmed via `find . -iname convex.config.ts`, no results):

```ts
import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";

const app = defineApp();
app.use(rateLimiter);

export default app;
```

**Defining named limiters** — a config object per limiter, keyed by name, with `kind` selecting the algorithm:

```ts
import { RateLimiter, MINUTE, HOUR } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

const rateLimiter = new RateLimiter(components.rateLimiter, {
  freeTrialSignUp: { kind: "fixed window", rate: 100, period: HOUR },
  sendMessage: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 3 },
});
```

Both algorithms are real, distinct options (not one emulated on top of the other):
- **`"token bucket"`** — tokens refill continuously at `rate` per `period`, up to `capacity` (defaults to `rate`); unused tokens roll over, similar to "rollover minutes." Good for bursty-but-self-limiting behavior.
- **`"fixed window"`** — the full `rate` allowance is granted all at once every `period` ms, then resets. Simpler, but allows a burst right at the window boundary.

Optional fields beyond `kind`/`rate`/`period`: `capacity` (token bucket only), `shards` (splits the counter across N documents to reduce write contention under high concurrency — relevant only at far higher volume than this boutique app sees), `start` (fixed-window only, custom reset offset).

**Calling it inside a mutation/action:**

```ts
const status = await rateLimiter.limit(ctx, "sendMessage", { key: userId });
```

- `key` scopes the limit to a specific identifier (e.g. a mobile number) — omit it for a single global/shared limit.
- `count` (optional) — consume more than 1 unit per call (not needed for our use case, default 1 per call is correct).
- Return shape **without** `throws: true`: `{ ok: boolean, retryAfter: number }` — `ok: false` means the call was rejected and NO token was consumed; `retryAfter` is a timestamp/ms-delay hint for when to retry.
- **With** `throws: true`, instead of returning `{ok:false,...}` it throws a `ConvexError` whose data payload is `{ kind, name, retryAfter }`.
- A separate `rateLimiter.check(ctx, name, opts)` exists for a read-only "would this be allowed" check without consuming a token, and `rateLimiter.reset(ctx, name, opts)` to clear a key's state.

**Schema wiring:** confirmed **not required** in `convex/schema.ts`. Like other Convex components (`@convex-dev/aggregate`, `@convex-dev/agent`, etc. — see this project's own `convex/_generated/ai/guidelines.md` "Component guidelines" section), the rate limiter installs its own isolated tables via its `convex.config.ts` mount, fully separate from the app's own schema. The app never queries those tables directly — only through the `RateLimiter` client's methods.

**Overhead:** the README states storage is "not proportional to requests" (i.e. it does not write one row per call — it maintains compact per-key counters/bucket state), and documents `shards` as the lever for reducing write contention under heavy concurrent traffic on the SAME key. No specific latency numbers are published. For this app's realistic traffic (a single boutique's customer base, not a high-throughput SaaS), the overhead is one additional small transactional read/write per guarded call — negligible next to the existing `ctx.db` calls each of these mutations already makes.

**Honesty note on sourcing:** the exact code blocks above were retrieved via `WebFetch` against `github.com/get-convex/rate-limiter/blob/main/README.md` and `raw.githubusercontent.com/get-convex/rate-limiter/main/README.md`, cross-checked against a `WebSearch` summary of `convex.dev/components/rate-limiter` and the npm listing. `WebFetch` itself paraphrases fetched pages through a summarizing model rather than returning byte-exact HTML, so the code blocks above should be treated as a **reliable paraphrase of the real README**, not a guaranteed byte-exact quote — re-verify against the pinned installed version's actual README at implementation time (`node_modules/@convex-dev/rate-limiter/README.md` after install). The overall API shape (named-limiter config object, `kind`/`rate`/`period`/`capacity`, `.limit(ctx, name, {key})` returning `{ok, retryAfter}` or throwing with `throws:true`, self-contained storage) is corroborated independently by this project's own bundled `convex/_generated/ai/guidelines.md` (lines 305-320), which was written from Convex's own current documentation and names this exact package for this exact use case — giving two independent, consistent sources rather than one.

Citations:
- https://github.com/get-convex/rate-limiter/blob/main/README.md
- https://www.npmjs.com/package/@convex-dev/rate-limiter
- https://www.convex.dev/components/rate-limiter
- `convex/_generated/ai/guidelines.md` (this repo, lines 305-320) — bundled Convex guidelines already recommend this exact component for this exact use case

### A3. No existing rate-limiting code

```
$ grep -rn "rate\|throttle" convex/
```
Every match (full output reviewed) is unrelated noise — words like "generate", "rating", "duplicate-submit guard window", and `crons.ts`'s comment about pacing Gemini API calls (`// SECTION 1 — Pacing helper (scalability §7: batched, rate-limited AI calls)`, which is a **sequential-batching** comment about the daily AI-drafts cron avoiding a Gemini rate limit — not a rate limiter protecting this app's own functions). No hand-rolled counter/window-scan throttle exists anywhere in `convex/`.

```
$ cat convex/package.json
NO convex/package.json (file does not exist — Convex functions share the repo root's package.json, there is no separate convex/ package manifest)
```

Root `package.json` dependencies relevant to this check:
```
"dependencies": {
  "@vercel/blob": "^2.8.0",
  "@vercel/functions": "^3.9.5",
  "bcryptjs": "^3.0.3",
  "canvas-confetti": "^1.9.4",
  "convex": "^1.43.0",
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "react-router-dom": "^6.22.0",
  "resend": "^6.18.1"
}
```
No `@convex-dev/rate-limiter` (or any `@convex-dev/*` component) present. Confirms a clean-slate install would be needed.

### A4. Proposed limits per function

**`generateMagicTokenSelf` / `generateMagicToken` (deprecated alias — must get the SAME limit, they share byte-identical logic and both remain live callers per the revert's root-cause trace):**

- **Per-mobile-number limit: 5 attempts per 10 minutes, keyed by the normalized 10-digit mobile.** `rateLimiter.limit(ctx, "magicTokenByMobile", { key: normalizedMobile })`, `{ kind: "token bucket", rate: 5, period: 10 * MINUTE }`.
  - Why 5: a real customer might mistype their own WhatsApp number 2-3 times, or a merchant might trigger a resend attempt on their behalf during onboarding troubleshooting — 5 leaves comfortable headroom above realistic legitimate retries without being so high it stops mattering.
  - Why 10 minutes: long enough that an attacker enumerating a SINGLE victim's mobile (this function takes the mobile as-is, not guessed digit-by-digit, so "enumeration" here means repeated attempts against one already-known/guessed number, e.g. retrying to catch a race or just hammering it) is throttled to a trickle (5 tries / 10 min = 30/hour, vs unlimited), while short enough that a genuine customer who got rate-limited by their own mistakes isn't locked out for an inconveniently long time.
  - **IP-based or global limiting is NOT realistically available for this function.** Verified via web search (`github.com/get-convex/convex-backend` issue #130, an open feature request): standard Convex `mutation`/`action` handlers have **no built-in access to the caller's IP address** — `ctx` exposes `db`/`auth`/`scheduler`/`storage`/`runQuery`/etc., never the request's remote address. IP is only available inside `httpAction` handlers (which receive the raw `Request` object), and `generateMagicTokenSelf`/`generateMagicToken` are called via the standard Convex client SDK (`client.mutation(api.auth.generateMagicTokenSelf, ...)`) from `src/lib/db.js`/`src/pages/Join.jsx`/`src/pages/Onboarding.jsx` — not through an HTTP route. Converting them to `httpAction`s just to gain IP access would be a much larger, riskier change than this task's scope. **A global (all-callers-combined) limit is possible but was deliberately NOT proposed as a second layer here** — a single global bucket shared across every legitimate customer onboarding at once would start rejecting real customers during ordinary daily traffic (e.g. a busy day with 20 real onboardings) long before it meaningfully slowed an attacker who can simply spread guesses across many different mobile numbers. Per-mobile keying is the only shape that targets the actual threat (protecting one victim's number from rapid hijack attempts) without this false-positive risk.

**`createCustomer`:**

- **Per-mobile-number limit: 5 attempts per 10 minutes, keyed by the normalized 10-digit mobile** — same numbers, same reasoning as above, reusing a distinctly-named limiter (`createCustomerByMobile`) rather than sharing the same named limiter as `generateMagicTokenSelf` (so exhausting one doesn't cross-block the other, and so `/join`'s two-call sequence — `createCustomer` then `generateMagicTokenSelf` — doesn't double-consume a shared bucket in one legitimate signup).
  - Threat: Critical #2's duplicate-mobile branch returns the full existing customer record (name, points, tier, `magic_token`, `measurements`, `staff_notes`) to anyone submitting that mobile. Rate-limiting this per-mobile turns "scrape the whole customer list one guessed mobile at a time" from an unlimited-speed operation into a 5-guesses-per-10-minutes one — the SAME false-positive-vs-throughput tradeoff as above applies here, because it is the same underlying `mobile` field and the same class of legitimate user behavior (mistyped own number during signup).

**`createReview`:**

- **Looser limit: 20 attempts per hour, per submitting `user_id`.** `rateLimiter.limit(ctx, "createReviewByUser", { key: String(args.user_id) })`, `{ kind: "token bucket", rate: 20, period: HOUR, capacity: 5 }`.
  - Why looser: the actual worst case of abusing this function is **pending-review spam** — every row lands in `status: "pending"` with `points_awarded: 0` and does nothing until a merchant manually clicks Approve in the Reviews queue (`convex/reviews.ts`'s `approveReview`, itself `requireMerchantSession`-gated). There is no data leak, no account takeover, no money/points movement from `createReview` alone — the worst outcome is an annoying, click-through-able queue, not a security incident. `createReview` already has its own narrow duplicate-submit guard (`DUPLICATE_SUBMIT_WINDOW_MS`, 5 minutes, same-text-same-type dedup) for accidental double-clicks — this rate limit is a coarser backstop against deliberate spam, not a replacement for that existing check.
  - Why 20/hour: a genuine customer might leave several product reviews plus a GMB review plus a testimonial in one active session — 20 is generously above any real single-session usage, while still bounding an automated spam script to a low, easily-noticed rate. `capacity: 5` (token bucket) lets a legitimate burst of a few reviews in quick succession go through without friction, then throttles to the steady 20/hour rate.

### A5. Frontend error-handling — what a rate-limit rejection needs to look like

**`Join.jsx`'s actual submit path** (read `src/pages/Join.jsx` lines 34-81 directly): the form calls `onboardCustomerRemote(f)` (`src/lib/db.js:1967`), NOT `createCustomer`/`generateMagicTokenSelf` directly. Reading that function's full body:

```js
export async function onboardCustomerRemote(f) {
  const client = getConvex();
  if (!client) return createLocalCustomer(f);

  const mobile = waDigits(f.whatsapp || f.calling);
  try {
    const created = await client.mutation(api.customers.createCustomer, { mobile, ... });
    if (created && !created.ok) {
        return { error: created.error };
    }
    ...
    const linkRes = await client.mutation(api.auth.generateMagicTokenSelf, { mobile, ... });
    if (!linkRes || !linkRes.user || !cvxId) return createLocalCustomer(f);
    ...
    return { user: synced, magicLink: `...` };
  } catch {
    return createLocalCustomer(f); // offline / Convex error → same-browser local link (unchanged)
  }
}
```

Two critical, load-bearing findings here:

1. **`createCustomer`'s existing `{ok:false, error:"..."}` return shape is already read and surfaced correctly** — `Join.jsx` line 46 checks `res.error` and (for the non-duplicate-mobile case) line 76 calls `setMobileError(res.error)`, which renders inline next to the mobile field. **If the rate limiter is added as a check INSIDE `createCustomer`'s handler that returns `{ ok: false, error: "Too many attempts — please try again in a few minutes." }` in the same shape the invalid-mobile check already uses (`customers.ts:796`), it degrades gracefully with ZERO frontend changes needed** — the exact code path that already renders `"Please enter a valid 10-digit mobile number"` inline would render the rate-limit message the same way.
2. **The entire `client.mutation(...)` sequence is wrapped in one outer `try { ... } catch { return createLocalCustomer(f); }`.** If instead the rate limiter is called with `throws: true` (so it throws a `ConvexError` instead of returning `{ok:false}`), this catch-all swallows it completely — a rate-limited real customer would silently get a **fake local-only customer row** (`createLocalCustomer`) with no error message shown at all, and Convex-side would never actually have their record. This is worse than a raw stack trace: it looks like signup succeeded but the customer has no real backend record, no real magic link, nothing durable. **This means the design must NOT use `throws: true` for `createCustomer` or `generateMagicTokenSelf`** — it must return the same `{ok:false, error}` shape `createCustomer` already uses for invalid-mobile, so `Join.jsx`'s existing `res.error` / `setMobileError` path handles it exactly like any other validation failure. `generateMagicTokenSelf` currently returns `null` on non-existent customer (not an `{ok,error}` object) — its rejection shape would need to be decided at implementation time to also avoid being swallowed by this catch-all silently.

**`src/pages/Lookbook.jsx` does NOT call `createReview` directly** — grep confirmed zero matches in that file. The real call sites are `submitGmbReview`/`submitProductReview` in `src/lib/db.js` (lines 1350, 1395), which components call synchronously (local-first bridge pattern). Their actual error handling:

```js
export function submitGmbReview(userId, stars, review_text) {
  ...
  // 1. Optimistic local create — PENDING ONLY, added to state.reviews immediately, emit()'d.
  ...
  // 2. Convex write-through (fire-and-forget)
  const client = getConvex();
  if (client) {
    client.mutation(api.reviews.createReview, { ... })
      .then((cvxReview) => { if (cvxReview) { /* stamp convexId */ } })
      .catch(() => { /* offline — keep local */ });
  }
  return { bonus, review }; // returns immediately, does NOT wait for Convex
}
```

This is a **local-first optimistic** pattern, not a request/response one — the customer always sees their review appear instantly (added to local state before the Convex call even starts), and the Convex write-through happens in the background with a bare `.catch(() => {})` that silently no-ops on ANY failure (offline, validation error, or a future rate limit — no distinction). A rate-limit rejection here (`{ok:false}` or a thrown error, either way) would be silently absorbed by that existing catch — the review stays visible locally to the customer (looking submitted) but never actually lands in Convex, so it would never appear in the merchant's Reviews queue. This is **already the existing behavior for any Convex-side rejection today** (not a new gap introduced by rate limiting) — but it means a rate-limited review submission fails silently from the customer's point of view, with no visible error message, same as any other backend failure on this path today. Worth flagging explicitly for whoever eventually implements this: if this silent-failure behavior for `createReview` is considered acceptable today, it remains acceptable after adding a loose rate limit; if it's not acceptable, that's a pre-existing gap independent of this task.

---

## Part B — Design

### Component & approach chosen

**`@convex-dev/rate-limiter`**, per-key **token bucket** limiters (see A2 for full citation/API detail):
- Token bucket over fixed window because our threat model cares about smoothing out bursts from a single key (one mobile number, one review-submitting customer) with tolerance for a small legitimate burst (`capacity`), not about a hard reset-at-the-hour-boundary cliff. It also matches the "5 attempts per 10 min" / "20 per hour with capacity 5" phrasing used in the justification above naturally.
- Chosen over hand-rolling a counter table because this project's own bundled `convex/_generated/ai/guidelines.md` (lines 305-320) already explicitly steers toward this exact component for "per-key quotas, cooldowns, or throttling," specifically warning that "hand-rolled counter or window-scan implementations admit races under concurrency and lose quota when a mutation fails" — a correctness property (transactional, rolls back with the calling mutation) that would be nontrivial to reproduce by hand inside `createCustomer`/`generateMagicTokenSelf`'s existing logic.

### Proposed limits (full detail: Part A4)

| Function | Limiter name (proposed) | Kind | Rate | Period | Capacity | Key |
|---|---|---|---|---|---|---|
| `generateMagicTokenSelf` / `generateMagicToken` | `magicTokenByMobile` | token bucket | 5 | 10 min | 5 (default) | normalized mobile |
| `createCustomer` | `createCustomerByMobile` | token bucket | 5 | 10 min | 5 (default) | normalized mobile |
| `createReview` | `createReviewByUser` | token bucket | 20 | 1 hour | 5 | `user_id` |

No IP-based or global limit is proposed for any of these three (see A4's honest IP-unavailability finding) — all three are per-key (mobile or user id) only.

### Files that would need to change (implementation — future task, not this one)

- **`convex/convex.config.ts`** — NEW FILE. Does not currently exist (confirmed: `find . -iname convex.config.ts` → no results). Registers the `rateLimiter` component per A2's snippet.
- **`convex/schema.ts`** — **no change needed.** Confirmed in A2: the component installs its own isolated tables via the component mount, not via this app's schema.
- **`convex/customers.ts`** — `createCustomer`'s handler gains a `rateLimiter.limit(ctx, "createCustomerByMobile", { key: normalized })` check before the existing duplicate-mobile lookup, returning the SAME `{ok:false, error:"..."}` shape the invalid-mobile branch already uses (not `throws:true` — see A5's finding on why the outer `try/catch` in `db.js` would swallow a thrown error silently).
- **`convex/auth.ts`** — `generateMagicTokenSelf` and `generateMagicToken` each gain a `rateLimiter.limit(ctx, "magicTokenByMobile", { key: digits })` check before their existing `by_mobile` lookup. Return-shape choice (both currently return `null` on a non-existent customer, not an `{ok,error}` object) needs an explicit decision at implementation time — noted as open in A5.
- **`convex/reviews.ts`** — `createReview`'s handler gains a `rateLimiter.limit(ctx, "createReviewByUser", { key: String(args.user_id) })` check, placed before or alongside the existing `DUPLICATE_SUBMIT_WINDOW_MS` check.
- **`src/pages/Join.jsx`** — likely NO change needed for the `createCustomer` path specifically, because its existing `res.error` / `setMobileError(res.error)` handling (lines 46, 76) already renders whatever string `createCustomer` returns in its `{ok:false,error}` shape — confirmed by direct read in A5. Would need review once `generateMagicTokenSelf`'s rejection shape is finalized, since `onboardCustomerRemote`'s current `if (!linkRes || !linkRes.user || !cvxId) return createLocalCustomer(f);` line treats ANY non-success from `generateMagicTokenSelf` (including a future rate-limit rejection) as silently falling back to a local-only fake customer with no visible error — this is an existing gap, not something this design doc fixes, but implementation must decide whether to also patch this fallback line so a rate-limited legitimate customer sees a real message instead of a phantom "success."
- **`src/pages/Lookbook.jsx`** — no direct change; confirmed it does not call `createReview` at all (A5).
- **`src/lib/db.js`** — `submitGmbReview`/`submitProductReview`'s existing `.catch(() => { /* offline — keep local */ })` on the `createReview` write-through would silently absorb a rate-limit rejection exactly as it already does for any other Convex-side rejection today (A5) — flagged as a pre-existing, unrelated gap, not something this design proposes changing, but implementation should confirm the product decision on whether a customer should ever see "your review couldn't be submitted right now" instead of an always-succeeds-locally UI.

### Out of scope

- **Implementation.** This document is design/investigation only, per the task instruction — no `convex.config.ts`, no schema change, no function edits, no `npm install` was performed.
- **The two open Criticals' proper fix** (Critical #1 — `generateMagicTokenSelf`/`generateMagicToken` account takeover; Critical #2 — `createCustomer`'s duplicate-mobile confidential-data leak). These remain tracked separately per `docs/full-system-audit-2026-09-04.html` Part F #1/#2, and the 2026-09-05 ledger entry documenting the fix-then-revert (commit `5545175` fixed, `625aa6e` ledgered, `aed26cf`/`1c19ccb` reverted after breaking the CRM list render and `Onboarding.jsx`'s existing-mobile path). Rate limiting slows down exploitation of these two bugs; it does not close them. A future task must re-attempt that fix with the two specific regressions this revert surfaced explicitly covered by testing before the next push.
- **CORS / Origin restriction.** Investigated separately; concluded not the primary attack vector for this app (explicit-token-in-args auth model, not cookies) and is not part of this document's design.

---

## Addendum note

This document was written fresh on 2026-09-05 (no prior version existed).
