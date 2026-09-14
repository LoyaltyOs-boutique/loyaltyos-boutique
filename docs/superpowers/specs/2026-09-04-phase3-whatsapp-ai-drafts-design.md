# Phase 3 — Feature A: AI-drafted WhatsApp Messages (Design)

Design doc — draft-generation only. Does NOT decide the send-wiring fork (see §c).
Builds on the approved architecture spec: `docs/superpowers/specs/2026-09-03-ai-automation-architecture-design.md`
(§2 "Feature A — AI-drafted WhatsApp messages", §7 "Scalability Principles").

No code is written or changed by this doc. No file under `convex/` or `src/` is touched.

---

## (a) Already confirmed, reusable as-is

### `whatsapp_template_config` (convex/settings.ts) — promo context for the Gemini prompt
The merchant-editable promo fields (Discount%, Coupon Code, Valid Days) per occasion type, stored
under settings key `WHATSAPP_TEMPLATE_CONFIG` (`convex/settings.ts:72`):

```ts
// convex/settings.ts:353-357
export const whatsAppTemplateConfigFieldsValidator = v.object({
  discountPercent: v.string(),
  couponCode: v.string(),
  validDays: v.string(),
});
```

Defaults are all-empty-string, not null (`convex/settings.ts:372-375`), and are read through the
already merchant-guarded query:

```ts
// convex/settings.ts:708-722
export const getWhatsAppTemplateConfig = query({
  args: {
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const doc = await getSettingsDoc(ctx, SETTINGS_KEYS.WHATSAPP_TEMPLATE_CONFIG);
    const stored = doc?.value as
      | Partial<Record<WhatsAppTemplateType, Partial<WhatsAppTemplateConfigFields>>>
      | undefined;
    return mergeWhatsAppTemplateConfig(stored);
  },
});
```

**Proposed use for Phase 3:** this per-occasion `{discountPercent, couponCode, validDays}` shape is
the natural piece of prompt context to hand to Gemini — "weave this discount/coupon/validity into a
warm, on-brand birthday/anniversary message for {customer.name}" — so the draft text is grounded in
whatever promo terms the merchant has actually configured on the Templates page, not invented by the
model. `getWhatsAppTemplateConfig` itself is merchant-session-guarded and callable as-is from a
merchant-triggered flow; a cron (see §b) has no merchant session and would need its own
internal-query read of the same settings doc (out of scope to design further here — noted only as a
reuse candidate).

### `whatsapp_consent` — already present, already the gate
`getUpcomingBirthdays` and `getUpcomingAnniversaries` (`convex/customers.ts:462-479`,
`convex/customers.ts:482-499`) already default and return `whatsapp_consent`:

```ts
// convex/customers.ts:474-476 (birthdays) / :494-496 (anniversaries) — identical comment+field
// Consent flag drives the Approve & Send gate (WhatsApp wishes cannot fire without it).
whatsapp_consent: doc.whatsapp_consent ?? false,
```

**Proposed use for Phase 3:** this is exactly the flag that must gate which customers a
draft-generation cron is even allowed to process — a customer with `whatsapp_consent !== true` must
never have a Gemini call made about them, not just never receive a send. Filtering happens before any
AI call, not just before any WhatsApp send (see §b).

### `Templates.jsx` textarea pattern — UI match for AI-draft editing
The existing message-body textarea in the Templates page:

```jsx
// src/pages/merchant/Templates.jsx:239
<textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
```

**Proposed use for Phase 3:** any future editable AI-draft textarea added to the ApprovalModal (per
Option 1/3 in §c, if approved) should pin-to-pin match this exact pattern —
`className="input" rows={3}` — controlled value + onChange, no new styling invented. This is cited
now so the eventual frontend task has zero ambiguity about the visual contract, even though building
it is explicitly deferred until §c is resolved.

### `ai_message_drafts` table shape — from the approved architecture spec
Quoted verbatim from `docs/superpowers/specs/2026-09-03-ai-automation-architecture-design.md:17`:

> New table ai_message_drafts: { customer_id, occasion, occasion_date, draft_text, generated_at, status: "pending" | "used" | "discarded" }.

Fields, restated for schema-authoring clarity (not a redesign — same shape, same source):
- `customer_id` — the customer this draft is about
- `occasion` — which moment type (`"birthday"` | `"anniversary"`)
- `occasion_date` — the specific date the draft is for
- `draft_text` — the Gemini-generated message text
- `generated_at` — timestamp of generation
- `status: "pending" | "used" | "discarded"` — lifecycle state; a cron only ever writes `"pending"`

---

## (b) New: convex/crons.ts

### Must use `crons.interval`, not `.daily()`/`.hourly()`/`.weekly()`
This codebase's own pinned Convex guidelines file states this as a hard rule, quoted verbatim from
`convex/_generated/ai/guidelines.md:372-375`:

> ### Cron guidelines
>
> - Only use the `crons.interval` or `crons.cron` methods to schedule cron jobs. Do NOT use the `crons.hourly`, `crons.daily`, or `crons.weekly` helpers.
> - Both cron methods take in a FunctionReference. Do NOT try to pass the function directly into one of these methods.

The same guidelines file's worked example (`convex/_generated/ai/guidelines.md:378-395`) is the
pattern to follow structurally: declare a top-level `crons` object via `cronJobs()`, register the job
with `crons.interval(name, { hours/days }, internal.crons.<fn>, args)`, export `crons` as default.
This project's daily draft-generation job must be declared the same way — `crons.interval("generate
whatsapp drafts", { hours: 24 }, internal.crons.generateDailyDrafts, {})` (name illustrative, not
final — actual naming/args decided at implementation time, not in this design doc).

### Needs a new internal-query variant of getUpcomingBirthdays/getUpcomingAnniversaries
The existing `getUpcomingBirthdays` (`convex/customers.ts:462-479`) and `getUpcomingAnniversaries`
(`convex/customers.ts:482-499`) both call `requireMerchantSession(ctx, userId, token)` as their first
line and both require `userId`/`token` args. A cron runs on a schedule with no live merchant browser
session to supply those — there is no human in the loop clicking anything at cron-fire time. So Phase
3 needs a **new internal query** (not exposed to the frontend, callable only from other Convex
functions such as this cron) that reuses the same underlying `findUpcoming(ctx, days, field)` helper
(`convex/customers.ts:220-224`, already indexed via `by_role_birthday_md` /
`by_role_anniversary_md` — see §d) but skips the `requireMerchantSession` call, since there is no
session to validate. This is a genuinely new function to design/build later, not a reuse of the
public query as-is — noted here as a requirement, not implemented.

### Filter to whatsapp_consent === true before any Gemini call
Per §a above, the cron's customer iteration must apply the `whatsapp_consent === true` filter
immediately after fetching candidates from the internal `findUpcoming`-based query, and strictly
*before* any `generateMessageDraft` / Gemini call is made for that customer — not merely before a
WhatsApp send. A customer who has not opted in should never have their name/tier/occasion data sent
to Gemini at all, matching the architecture spec's stated non-sensitive-context scoping (architecture
spec §1, `docs/superpowers/specs/2026-09-03-ai-automation-architecture-design.md:12`: "name, tier,
occasion type, last-purchase tags — never staff_notes, never measurements, never magic_token").

### Per eligible customer: call generateMessageDraft, insert into ai_message_drafts
For each customer that passes the consent filter, the cron calls a new `generateMessageDraft` action
(to live in `convex/ai.ts`, built on top of the already-existing shared `callGemini` helper from
Phase 2 — `convex/ai.ts`, commit `76b39eb`) and inserts the result as a new row in `ai_message_drafts`
with `status: "pending"`.

### Zero access to sendWhatsAppTemplateMessage or recordMessageAction
The cron job's responsibility ends at writing drafts. This is not a new rule invented for this doc —
it is the architecture spec's own stated boundary, quoted verbatim from
`docs/superpowers/specs/2026-09-03-ai-automation-architecture-design.md:18`:

> This job only writes drafts — it has zero access to sendWhatsAppTemplateMessage or recordMessageAction.

Concretely: `convex/crons.ts` and the new `generateMessageDraft` action it calls must not import,
reference, or transitively call `sendWhatsAppTemplateMessage` or `recordMessageAction`
(both in `convex/whatsapp.ts`) anywhere in their code path. This mirrors §5 of the architecture spec
("What stays untouched") — the cron is purely additive and cannot become a hidden send path.

---

## (c) Open decision: how does the AI draft actually get sent?

This section presents a genuine, unresolved fork. **This design doc does not decide between these
three options.** No Phase 3+ code should touch the actual send-wiring (the `ApprovalModal` component,
or any change to how/whether `draft_text` reaches `sendWhatsAppTemplateMessage`) until Saidul
explicitly approves one option. This mirrors the pattern already used successfully in the Phase 1
design doc, which presented the cart/likes fork without picking a side.

**Why this fork is real, not cosmetic:** the existing "Approve & Send" flow (`Customers.jsx` →
`ApprovalModal.approve()` → `sendWhatsAppTemplateMessage` in `convex/whatsapp.ts`) is hard-locked to
Meta's pre-approved WhatsApp template shape. `sendWhatsAppTemplateMessage` only fills a fixed
`bodyParams` placeholder array on an already-Meta-approved template — it has no mechanism to carry
arbitrary free-form AI-generated text end-to-end to the customer. A draft full of Gemini-written
prose cannot simply be substituted into that call today.

### Option 1 (Reference-only)
AI draft text is shown to the merchant as inspiration/reference in the ApprovalModal's new editable
textarea (pattern: `Templates.jsx:239`, see §a). The merchant can read it, but the actual WhatsApp
send still goes through the existing locked `sendWhatsAppTemplateMessage` with `bodyParams: [name]`
only — the AI text itself never reaches WhatsApp.
- **Pro:** fastest to build, zero Meta dependency.
- **Con:** the merchant would need to manually copy/paraphrase into the approved template's limited
  placeholder if they want to actually use the AI wording — the AI text has no direct path to the
  customer.

### Option 2 (Real template placeholder)
A new WhatsApp template gets approved via Meta Business Manager with one large body placeholder that
can carry the full AI-generated text as `bodyParams[0]`.
- **Pro:** the AI draft becomes what's literally sent to the customer.
- **Con:** requires a real, separate, non-code dependency (template approval through Meta, could take
  days, entirely outside this project's control) before it can go live.

### Option 3 (Build the drafts table now, defer sending wiring)
`ai_message_drafts` + the cron + Gemini generation get built and tested end-to-end for draft creation
only; the `ApprovalModal` UI/sending-wiring change is deferred to a later, separate task once Option 1
vs Option 2 is decided.
- **Pro:** unblocks Phase 3 draft-generation work immediately without forcing a premature send-path
  decision; drafts sit in `ai_message_drafts` as `"pending"` and are simply not surfaced/wired to any
  UI yet.
- **Con:** merchant gets no visible feature until a follow-up task lands.

This design doc does not decide between these three options — it documents them for Saidul's explicit
approval before any Phase 3+ code touches the actual send path.

---

## (d) Scalability principles carried forward

This section restates, and does not redesign, the already-approved §7 constraints from
`docs/superpowers/specs/2026-09-03-ai-automation-architecture-design.md` ("Scalability Principles"),
applying them concretely to this cron.

**No full-table scans (indexed reads only)** — architecture spec §7
(`2026-09-03-ai-automation-architecture-design.md:42`):

> No full-table scans: every query used by an AI feature must go through an index (matches Phase 0's fixes to getCustomers, getTodayOrders/getTodaySummary, getUpcomingBirthdays/getUpcomingAnniversaries) — AI draft-generation reuses those same indexed queries, never re-scans the full users/orders table itself.

Concretely for this cron: the new internal-query variant described in §b must reuse `findUpcoming`
(`convex/customers.ts:220-224`), which already fetches candidates via
`.withIndex("by_role_birthday_md", ...)` / `.withIndex("by_role_anniversary_md", ...)`
(`convex/customers.ts:240-241`, `:246-247`) rather than `.collect()`-ing the whole `users` table. The
cron must not introduce a second, unindexed read path over `users`.

**Batched, rate-limited AI calls** — architecture spec §7
(`2026-09-03-ai-automation-architecture-design.md:44`):

> Batched, rate-limited AI calls: the daily draft-generation cron and the per-order lookbook-ranking trigger call Gemini in small batches (e.g. per occasion-day, per single order) with a request-rate cap, so cost and latency stay flat as the customer count grows from tens to 1000+, rather than scaling linearly (or worse) with every customer.

Applied concretely to this cron's customer-iteration + Gemini-call pattern: the daily job must **not**
fire one synchronous, unbounded Gemini call per eligible customer in a tight loop with no cap. Instead
the cron's eligible-customer list (post `whatsapp_consent` filter) should be processed as a **capped
batch per run** — e.g. a fixed maximum number of `generateMessageDraft` calls per cron invocation —
with **pacing between calls** (e.g. spacing/staggering the calls rather than firing them
concurrently/back-to-back) so that as the customer base grows from tens to 1000+, the cron's per-run
Gemini spend and latency stay flat rather than growing linearly with the number of
birthdays/anniversaries that land on any given day. The exact batch size and pacing mechanism (e.g.
`ctx.scheduler` staggered follow-up runs, or an in-action delay loop) is an implementation detail for
the build task, not decided here — this section only carries forward the constraint that such a cap
must exist, per the architecture spec's own rule quoted above.

**No single hot document** and **stateless guarded actions** (architecture spec §7,
`2026-09-03-ai-automation-architecture-design.md:43,46`) apply unchanged: each `ai_message_drafts` row
is one document per customer/occasion (never aggregated into a shared document every cron run would
contend on), and `generateMessageDraft` must be a stateless action carrying no in-memory state between
calls, consistent with the existing `requireMerchantSession`-guarded action/mutation pattern already
used elsewhere in this codebase.
