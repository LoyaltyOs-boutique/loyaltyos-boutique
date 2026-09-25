# WhatsApp AI-Draft → wa.me Send Path (Design Proposal — NOT approved, NOT decided)

Status: **DESIGN DRAFT FOR REVIEW.** No code has been written. This document
lays out the real current state (grounded in code actually read on
2026-09-09, branch `feat/ai-automation-gemini-phase`, HEAD `22dd4ef`) and
presents open forks for the user to decide. Nothing here should be read as
already decided.

Related prior specs:
- `docs/superpowers/specs/2026-09-04-phase3-whatsapp-ai-drafts-design.md` —
  built the `ai_message_drafts` table + daily cron + `generateMessageDraft`,
  explicitly chose **"Option 3: build the drafts table now, defer sending
  wiring"** — this document is the deferred follow-up that spec called out.
- `docs/superpowers/specs/2026-09-04-phase5-virtual-events-vvip-design.md` —
  Events/VVIP backend, relevant to the open fork in section (d) below.

---

## 0. Real current state (Part A findings — grounded, quoted, verified 2026-09-09)

### 0.1 `ApprovalModal`'s current send-path logic — verbatim

File: `src/pages/merchant/Customers.jsx`, function `ApprovalModal` (starts
line 564). The doc-comment directly above it (lines 553-563) already states
the exact shape:

> "no template configured for this occasion type → skip straight to the
> wa.me fallback; template configured → try the Cloud API send, and on ANY
> failure fall back to the same wa.me link-open, never a silent dead end."

The real `approve()` function (lines 590-625), quoted verbatim:

```js
const approve = async () => {
  // Consent gate — never send to a customer who hasn't given WhatsApp
  // consent, even if the button is somehow triggered while disabled.
  if (!customer.whatsapp_consent) return;

  // No template configured for this occasion type yet → skip the Cloud
  // API attempt entirely, go straight to wa.me — same guard MomentCard.send()
  // uses, not an error state.
  if (!waTemplate) {
    openWaLinkFallback();
    setSendMsg('Sent via WhatsApp link');
    onSent?.(customer.id, occasion, 'wa_fallback');
    onClose();
    return;
  }

  // Template IS configured → try the Cloud API send first. bodyParams:
  // [name] only, no card image URL — identical shape to MomentCard.send().
  setSending(true);
  setSendMsg('Sending…');
  let channel = 'cloud_api';
  try {
    await sendWhatsAppTemplateMessage(customer.mobile, waTemplate.name, waTemplate.language, undefined, [customer.name.trim() || '{name}']);
    setSendMsg('Sent via WhatsApp');
  } catch (err) {
    // Any failure (Meta rejection, network error, etc.) → fall back to the
    // same wa.me link-open, using the preview text shown above.
    openWaLinkFallback();
    setSendMsg('Sent via WhatsApp link');
    channel = 'wa_fallback';
  } finally {
    setSending(false);
    onSent?.(customer.id, occasion, channel);
    onClose();
  }
};
```

**Trigger conditions today, exactly:**
- `wa.me` fallback fires when EITHER (a) no `waTemplate` is configured for
  this occasion type (`waTemplates[occasion]` is falsy — checked before any
  network call), OR (b) `sendWhatsAppTemplateMessage` throws for any reason
  (Meta rejection, network error, 24h-window rejection, etc.) — caught in the
  `catch` block.
- `sendWhatsAppTemplateMessage` (Cloud API) is the ONLY path attempted first,
  and only when a `waTemplate` for that occasion exists.
- Both paths converge on the same `onSent?.(customer.id, occasion, channel)`
  call with `channel` set to `'cloud_api'` or `'wa_fallback'` accordingly.

### 0.2 `wa.me` link construction — verbatim, exact

Same file, lines 586-588:

```js
const openWaLinkFallback = () => {
  window.open(`https://wa.me/${waDigits(customer.whatsapp || customer.mobile)}?text=${encodeURIComponent(previewText)}`, '_blank');
};
```

- URL format: `https://wa.me/<digits>?text=<encoded>` — confirmed exact.
- Phone source: `customer.whatsapp || customer.mobile` (WhatsApp number if
  set, else mobile), passed through `waDigits()`
  (`src/lib/db.js:1992`): `export function waDigits(n) { return String(n || '').replace(/[^0-9]/g, ''); }`
  — strips everything but digits, no country-code prepend logic visible in
  this function itself.
- Message-text source **today**: `previewText`, built at lines 578-584 from
  a **fixed, locally-assembled string** — customer name + occasion label +
  configured discount/coupon/valid-days from `templateConfig[occasion]`.
  This is **not** AI-drafted text; it is the same fixed reference-preview
  string shown in the modal's own preview box. Confirmed — no read of
  `ai_message_drafts` or any Gemini-generated content happens anywhere in
  this component today.
- Encoding: standard `encodeURIComponent(previewText)`.

### 0.3 `getDraftForCustomer` — real signature, return shape, and unused-by-frontend confirmation

File: `convex/customers.ts`, lines 1082-1115 (doc comment 1062-1081).

```ts
export const getDraftForCustomer = query({
  args: {
    customerId: v.id("users"),
    occasion: v.union(v.literal("birthday"), v.literal("anniversary")),
    occasionDate: v.string(),
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, { customerId, occasion, occasionDate, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);

    const rows = await ctx.db
      .query("ai_message_drafts")
      .withIndex("by_customer_occasion_date", (q) =>
        q.eq("customer_id", customerId).eq("occasion", occasion).eq("occasion_date", occasionDate),
      )
      .collect();

    const pending = rows.filter((r) => r.status === "pending");
    if (pending.length === 0) return null;
    pending.sort((a, b) => b.generated_at - a.generated_at);
    const doc = pending[0];
    return {
      _id: doc._id,
      customer_id: doc.customer_id,
      occasion: doc.occasion,
      occasion_date: doc.occasion_date,
      draft_text: doc.draft_text,
      generated_at: doc.generated_at,
      status: doc.status,
    };
  },
});
```

- Args: `customerId` (`Id<"users">`), `occasion` (`"birthday" | "anniversary"`),
  `occasionDate` (string, `"M-D"` format), plus the standard
  `userId`/`token` merchant-session pair.
- Returns `null` if no `"pending"`-status draft row exists for the
  `(customer_id, occasion, occasion_date)` tuple; otherwise the newest
  pending row's `{_id, customer_id, occasion, occasion_date, draft_text,
  generated_at, status}`.
- Merchant-guarded via `requireMerchantSession` — same pattern as every
  other merchant query in this file.
- **Unused-by-frontend, re-verified today:**
  ```
  $ grep -rn "getDraftForCustomer" src/
  (no output — exit code 1)
  ```
  Zero call sites anywhere in `src/`. The function's own doc comment
  confirms this was intentional: *"This is a read-path-only addition for a
  later frontend task ... no UI wiring happens in this task."* The gap is
  real today, not a stale finding.

### 0.4 `whatsapp_consent` gate — exact code, confirmed mechanism-agnostic

Same `ApprovalModal`, three places, all quoted verbatim:

1. Inside `approve()` (line 593), the very first line, before either send
   path is reachable:
   ```js
   if (!customer.whatsapp_consent) return;
   ```
2. The Approve button itself is disabled on the same condition (line 642):
   ```jsx
   <button onClick={approve} disabled={sending || !customer.whatsapp_consent} className="btn-gold !px-3 !py-1.5 text-[10px] flex-1">Approve &amp; Send</button>
   ```
3. The visible error message shown to the merchant (lines 644-646):
   ```jsx
   {!customer.whatsapp_consent && (
     <div className="text-red-600 text-xs">This customer hasn't given WhatsApp consent yet — can't send.</div>
   )}
   ```

**Confirmed mechanism-agnostic:** the guard at line 593 is the first
statement in `approve()`, executed before the `if (!waTemplate)` branch that
decides Cloud-API-vs-wa.me. Neither send path (`sendWhatsAppTemplateMessage`
nor `openWaLinkFallback`) is reachable if this guard returns early. Routing
the primary path through `wa.me` instead of Cloud API would not move,
weaken, or bypass this check — it is structurally upstream of both.

### 0.5 `recordMessageAction` / `message_actions.channel` — exact validator

Schema, `convex/schema.ts` lines 243-253:

```ts
message_actions: defineTable({
  customer_id: v.id("users"),
  occasion: v.union(v.literal("birthday"), v.literal("anniversary")),
  occasion_date: v.string(), // "M-D" e.g. "8-27" — matches parseMD's format in customers.ts
  action: v.union(v.literal("sent"), v.literal("cancelled")),
  decided_at: v.number(), // epoch ms
  channel: v.optional(v.union(v.literal("cloud_api"), v.literal("wa_fallback"))), // only meaningful for action:"sent"
})
  .index("by_customer_occasion_date", ["customer_id", "occasion", "occasion_date"]),
```

Mutation, `convex/customers.ts` lines 586-595:

```ts
export const recordMessageAction = mutation({
  args: {
    customer_id: v.id("users"),
    occasion: v.union(v.literal("birthday"), v.literal("anniversary")),
    occasion_date: v.string(),
    action: v.union(v.literal("sent"), v.literal("cancelled")),
    channel: v.optional(v.union(v.literal("cloud_api"), v.literal("wa_fallback"))),
    userId: v.id("users"),
    token: v.string(),
  },
  ...
```

**Confirmed: `'wa_fallback'` is already a valid literal in the existing
union**, on both the schema field and the mutation arg validator. `wa_fallback`
is already the literal used today whenever `openWaLinkFallback()` fires (see
0.1 — `channel = 'wa_fallback'`). Making `wa.me` the *primary* path for
birthday/anniversary would mean the `channel` value logged is simply
`'wa_fallback'` far more often than it is today — **no schema change, no
mutation-signature change needed.** (Whether `'wa_fallback'` is still the
right *name* for what would become a primary, not fallback, path is a
naming/clarity question worth flagging to the user — see section 3d — but it
requires zero code to keep working as-is.)

### 0.6 Events (Phase 5) dispatch — re-verified against the prior audit finding

File: `convex/events.ts`, `dispatchEvent` action (lines 361+), doc comment
329-360.

**Re-verified, and the real picture is more specific than the prior audit's
one-line summary.** Quoting the doc comment directly:

> "WhatsApp send: reuses whatsapp.ts's `sendWhatsAppServiceMessage`
> (free-form text service message), NOT `sendWhatsAppTemplateMessage`.
> Justification: `sendWhatsAppTemplateMessage` requires a pre-approved Meta
> template name + language code registered in WhatsApp Manager ahead of
> time — appropriate for the fixed birthday/anniversary Templates.jsx cards,
> but an event's draft_text is free-form, per-event, merchant-edited-or-AI-
> generated content with no matching approved template.
> `sendWhatsAppServiceMessage`'s type:"text" shape is structurally the right
> fit ... a service message additionally requires an open 24h
> customer-service window; if Meta rejects a given recipient for that
> reason, THIS action catches that per-recipient failure ... and continues
> dispatching to the rest of the recipient set rather than aborting the
> whole batch."

The real per-recipient send call (lines 390-396):

```ts
await ctx.runAction(api.whatsapp.sendWhatsAppServiceMessage, {
  userId,
  token,
  to: recipient.mobile,
  type: "text",
  text: messageText,
});
```

Grep confirms **no `wa.me`, no `openWaLinkFallback`, no fallback mechanism
of any kind exists anywhere in `convex/events.ts`** — this is a pure
server-side Cloud API action (`ctx.runAction`), which structurally *cannot*
open a browser `window.open()` deep-link the way `Customers.jsx`'s
client-side `ApprovalModal`/`Templates.jsx`'s `MomentCard` do. A per-recipient
failure (e.g. no open 24h window) is caught, logged, and skipped — the batch
continues, but that individual customer never receives anything.

**Correction to the prior audit's framing:** Part F #8 said "Events
dispatch uses service (24h-window) messages, so most cold recipients
silently fail" — this is accurate but understates *why* no template path
exists at all: it's not merely "using the wrong message type," it's that
**no approved Meta template exists for events in the first place** (events
are free-form/AI-drafted per-event content, structurally incompatible with
template pre-registration), whereas birthday/anniversary already has a
template *plan* (the blocked D-17 large-placeholder template) that would
also apply. This distinction matters for the open fork in section (d) below.

### 0.7 `ApprovalModal` reuse scope — confirmed single call site

```
$ grep -n "<ApprovalModal\|ApprovalModal(" src/pages/merchant/*.jsx src/components/merchant/*.jsx
src/pages/merchant/Customers.jsx:513:        <ApprovalModal
src/pages/merchant/Customers.jsx:564:function ApprovalModal({ target, templateConfig, waTemplates, onClose, onSent }) {
```

`ApprovalModal` is defined and rendered exactly once, in `Customers.jsx`,
for the "Birthdays tomorrow" / "Anniversaries tomorrow" Delight Queue tabs
only. It is not imported or reused by any other page/tab.

**Important adjacent finding:** `src/pages/merchant/Templates.jsx` has a
*structurally similar but entirely separate* component, `MomentCard`, with
its **own independent** `openWaLinkFallback` (defined twice in that file, at
lines 191 and 312, for two different card-send contexts) and its own
Cloud-API-then-fallback try/catch, sharing the doc-comment's stated
intent ("same guard MomentCard.send() uses") but **not the same code** — no
shared function, no shared component. A change scoped to `ApprovalModal` in
`Customers.jsx` would **not** touch `Templates.jsx`/`MomentCard` at all
unless explicitly extended there later (out of scope for this proposal).

---

## 1. Proposed change #1 — draft-aware preview

**Today:** `previewText` (lines 578-584) is always the fixed, locally-built
string (name + occasion label + configured discount/coupon/valid-days).
There is no code path that reads any AI-generated content into this modal.

**Proposed:** On modal open (or on `target` change), call
`getDraftForCustomer({customerId: customer.id, occasion, occasionDate, userId, token})`
(already exists, already merchant-guarded, already returns exactly the
`draft_text` needed). If it returns a non-null pending draft, show
`draft_text` in the preview box instead of the fixed `previewText`. If it
returns `null` — e.g. the daily draft cron (`crons.ts` → `ai.ts`
`generateMessageDraft`) hasn't reached this customer yet for today's run, or
a `GEMINI_API_KEY` issue prevented generation (both real, already-documented
failure modes per the Phase 2/3 specs' "fails gracefully" contract) — fall
back to today's exact fixed `previewText` logic, completely unchanged.

This is strictly **additive**: the existing fixed-text logic becomes the
fallback branch of a new conditional, not replaced or removed. Today's
"only text there currently is" behavior is preserved byte-for-byte as the
`null`-draft case.

## 2. Proposed change #2 — wa.me as the (new) primary send path for birthday/anniversary

**This is the central open decision — not decided here.**

The proposal: for birthday/anniversary Approve & Send specifically, route
through `openWaLinkFallback()`-equivalent logic using the draft/fallback
text from change #1 as the pre-filled message, as the **primary** action —
rather than attempting `sendWhatsAppTemplateMessage` first.

Three concrete options, laid out plainly, none chosen:

| Option | What changes | What stays |
|---|---|---|
| **A — wa.me fully replaces Cloud API for birthday/anniversary** | `if (!waTemplate)` branch and the `sendWhatsAppTemplateMessage` try/catch are removed; `approve()` always calls the wa.me-equivalent open, unconditionally, once consent passes. | `waTemplate` config UI becomes dead code for this modal (would still apply to `Templates.jsx`/`MomentCard`, untouched). |
| **B — wa.me becomes primary, Cloud API becomes explicit secondary/manual option** | Default button behavior opens wa.me; a separate, secondary control (or a mode toggle) lets the merchant explicitly choose Cloud API if a template is configured and they prefer the one-click send. | Both mechanisms remain live and selectable; more UI surface, more merchant-facing complexity. |
| **C — leave current order (Cloud-API-first, wa.me-on-failure) but swap in draft text everywhere `previewText` is used** | Only change #1 ships; change #2 does not ship. Cloud API stays primary, wa.me stays the failure-only fallback it is today, just with better/AI-drafted text when a send does fall through to it. | Zero behavior-order change; least risky; does not solve the "blocked on Meta template approval" problem at all — Cloud API sends for birthday/anniversary remain unusable in practice with no approved template, same as today. |

**Real tradeoff, stated plainly:**
- **wa.me (Options A/B as primary):** requires the merchant to make one
  extra manual tap *inside WhatsApp itself* after `window.open()` hands off
  to the WhatsApp app/web session — the message is pre-filled but not sent
  until that tap. Stronger manual-approval guarantee (see section 3), fully
  bypasses Meta template-approval and the 24-hour customer-service window
  (it is not a Business API call at all — see the CLAUDE.md context this
  task was given). Cost: one more click for the merchant, per message, and
  it depends on the merchant's own WhatsApp session being logged in on the
  device/browser they're using.
- **Cloud API (status quo primary):** genuinely one-click from the
  merchant's perspective when it works — `sendWhatsAppTemplateMessage` fires
  with no further merchant action needed. Cost: currently blocked in
  practice for birthday/anniversary until the D-17 large-placeholder
  template clears Meta approval (an external, undated dependency), and even
  once approved, is blocked for any customer outside Meta's 24-hour
  customer-service window unless a template send (which doesn't have the
  24h restriction, only service messages do) is what's actually configured
  — worth the user separately confirming which of these two Meta mechanisms
  the D-17 template is meant to be, since template messages and service
  messages have different window rules and this doc should not blur them.

## 3. Explicit confirmation section

- **`whatsapp_consent` gate stays fully intact, mechanism-agnostic.** Per
  section 0.4, the gate at `Customers.jsx:593` (`if
  (!customer.whatsapp_consent) return;`) executes before any branching on
  send mechanism, and the button-disable + visible error text
  (`"This customer hasn't given WhatsApp consent yet — can't send."`) are
  driven off the same `customer.whatsapp_consent` field regardless of which
  path is primary. None of Options A/B/C touch this check.
- **`recordMessageAction` logging needs zero schema change.** Per section
  0.5, `'wa_fallback'` is already a valid `channel` literal on both
  `message_actions.channel` (schema) and `recordMessageAction`'s arg
  validator. Making wa.me primary just means this existing literal gets
  logged far more often. (Flagging, not deciding: if wa.me becomes the
  *primary* path rather than a failure fallback, the literal name
  `'wa_fallback'` becomes a little misleading in the ledger — a possible
  follow-up naming change, e.g. adding a distinct `'wa_primary'` literal
  alongside the existing one, is a real but separate decision the user may
  want to make; not required for correctness.)
- **"Never auto-send" rule is preserved, arguably strengthened.** Today, a
  successful Cloud API send requires exactly one merchant click (the
  Approve & Send button) and then sends with no further human action. Under
  Options A or B, the equivalent action requires the same one click *plus*
  a second, manual tap inside the merchant's own WhatsApp
  app/web session to actually transmit the message — meaning there are
  **more**, not fewer, human-approval steps between "AI/system prepares
  text" and "customer receives it." This is consistent with (and
  strengthens) the existing design principle already stated in
  `convex/events.ts`'s dispatchEvent doc comment: *"Nothing auto-sends."*

## 4. Open decision — Events (genuine fork, not a recommendation)

Per section 0.6, Events dispatch (`convex/events.ts` `dispatchEvent`) is a
**server-side action** using `sendWhatsAppServiceMessage` with **no
wa.me-style fallback of any kind today** — and structurally, a Convex
action running server-side cannot call `window.open()` the way
`ApprovalModal`/`MomentCard` do client-side. Extending "wa.me as primary"
to Events would not be a copy-paste of this same fix; it would require the
send to happen from the merchant's browser (client-side), which is a
different code shape than `dispatchEvent`'s current all-server-side,
per-recipient-loop batch design.

Two real distinctions worth restating before the fork:
- Birthday/anniversary already has a *planned* template (D-17, blocked on
  Meta approval, but a defined path exists).
- Events have **no approved template and, per the dispatchEvent doc
  comment, no template plan at all** — free-form/AI-generated per-event
  content is described as structurally incompatible with Meta's
  pre-registration requirement, not just "waiting on approval."

**Fork — genuinely open, not decided here:**

- **Option 1:** Extend the same wa.me-with-AI-text approach to Events too,
  as a follow-on task — likely requiring `dispatchEvent`'s per-recipient
  loop to move client-side (or to return a list of prepared wa.me links for
  the merchant to click through one-by-one), since the current
  action-based, server-side batch loop has no equivalent of `window.open()`.
  This is a materially bigger change than the birthday/anniversary version
  and would need its own design pass.
- **Option 2:** Leave Events on its current `sendWhatsAppServiceMessage`
  path exactly as-is for now, and treat any Events fix as a fully separate,
  later task — scoping this proposal strictly to birthday/anniversary.

This document does not recommend one over the other — both are laid out for
the user to choose.

## 5. Zero-regression guarantee

What must stay byte-identical regardless of which option (A/B/C, and
whether Events is touched) is chosen:

- **Modal trigger mechanism:** the `<ApprovalModal>` render at
  `Customers.jsx:513` and however `target`/`onClose`/`onSent` currently get
  passed to it — unchanged.
- **Cancel flow:** the Cancel button (`Customers.jsx:641`,
  `onClick={onClose}`) and its `btn-ghost` styling — unchanged, no proposal
  here touches it.
- **Consent-gate error message text, exact:** `"This customer hasn't given
  WhatsApp consent yet — can't send."` — must remain byte-identical per
  section 3.
- **Scope confirmed to `ApprovalModal`/`Customers.jsx` only.** Per section
  0.7, `ApprovalModal` has exactly one call site (the birthday/anniversary
  Delight Queue tabs) and is not shared with any other tab or page. The
  separate, similarly-named `openWaLinkFallback` inside
  `Templates.jsx`'s `MomentCard` (two independent definitions, lines 191
  and 312) is **not** the same code and is **not** touched by anything
  proposed here unless the user explicitly asks for that as a follow-on.
