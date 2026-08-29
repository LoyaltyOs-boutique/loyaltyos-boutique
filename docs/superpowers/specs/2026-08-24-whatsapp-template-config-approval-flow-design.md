# Design: WhatsApp Template Config + Birthday/Anniversary Approval Flow

Date: 2026-08-24
Status: **Approved** — decisions locked in below
Branch: feat/whatsapp-cloud-api (continuing on same branch)

## Scope (this task — consent/scheduler/messages-table explicitly deferred)
1. Templates page: merchant-configurable Discount%, Coupon Code, Expiry/
   Valid Days fields for Anniversary and Birthday (shared per type, static
   across all customers, editable anytime).
2. Customer CRM: two new tabs, "Birthdays tomorrow" and "Anniversaries
   tomorrow", alongside the existing "All clients"/"Birthdays today"/
   "Anniversaries"/"Reviews" tabs — exact same tab-button idiom.
3. Approval modal: clicking "Approve & Send" on a customer row in either
   new tomorrow-tab opens the existing Modal component showing a filled
   template preview (name + configured discount/coupon/expiry), with
   Approve and Cancel actions.
4. Approve → immediately calls the existing sendWhatsAppTemplateMessage
   (same try-then-wa.me-fallback discipline already built) — NOT
   scheduled for 9am tomorrow in this phase (that requires a scheduler,
   explicitly deferred per today's decision to keep scope small).

## Explicitly deferred (per today's discussion, pending Ma'am's input)
- 3-way consent (consent_occasion/consent_marketing/stop_flag)
- Daily automatic scheduled job (Convex cron)
- messages table / duplicate-send idempotency protection
- 9am-next-day scheduled send (Approve sends immediately instead, for now)
- Consent filtering on the new "tomorrow" tabs (confirmed via investigation:
  NO consent check exists on getUpcomingBirthdays/getUpcomingAnniversaries
  today — this task does not add one, matching today's existing,
  already-shipped behavior; flagged as a known gap to close once the
  consent decision is made, not silently ignored)

## 1. Discount/Coupon/Expiry config (Templates page)

### Backend
New settings key: `SETTINGS_KEYS.WHATSAPP_TEMPLATE_CONFIG =
"whatsapp_template_config"` (grep-confirm no collision with `"templates"`,
`"template_cards"`, `"whatsapp_templates"` — deliberately distinct string
from the similarly-named `WHATSAPP_TEMPLATES` key; a code comment must
explain the distinction the same way `TEMPLATE_CARDS`'s comment explains
why it isn't named `"templates"`). Value shape:
```
{
  anniversary: { discountPercent: string, couponCode: string, validDays: string },
  birthday: { discountPercent: string, couponCode: string, validDays: string }
}
```
Default: all empty strings (not null — these are simple text fields, an
empty string is a valid "not set yet" state, matching the merchant
just not having filled them in). New query `getWhatsAppTemplateConfig`
and mutation `setWhatsAppTemplateConfig` (same read-merge-write
discipline as `setWhatsAppTemplate`/`setTemplateCardUrl` — updating
anniversary's config must never touch birthday's).

### Frontend (Templates.jsx)
Each `MomentCard` gains three new fields, verbatim `.label`/`.input`
pattern (exact idiom already used for Nickname):
```jsx
<div><label className="label">Discount</label><input className="input" .../></div>
<div><label className="label">Coupon code</label><input className="input" .../></div>
<div><label className="label">Valid for (days)</label><input className="input" .../></div>
```
Placed after the existing Message field, before "Replace card".

**Decision (field save timing):** fields save **on blur only**, not on
every keystroke. A local controlled `useState` holds the in-progress
value as the merchant types; `onBlur` fires `setWhatsAppTemplateConfig`
once. This avoids a Convex read-merge-write mutation firing per
character (wasteful) and avoids two overlapping writes to the same
settings doc racing each other and silently dropping a character —
a real risk with per-keystroke `onChange` saves given the
read-merge-write pattern (read current → merge → write; two rapid
calls can interleave).

## 2. "Birthdays tomorrow" / "Anniversaries tomorrow" tabs (Customer CRM)

### Backend
No new query needed structurally — call the EXISTING
`getUpcomingBirthdays({ days: 1 })`/`getUpcomingAnniversaries({ days: 1 })`
and filter client-side for `days_until === 1` (excludes today, i.e.
`days_until === 0`). This reuses proven, already-tested logic exactly as
audited — no new date-math.

### Frontend (Customers.jsx)
Add two new entries to the existing tab array, verbatim reuse of the
established `[key, label]` + `cls(...)` idiom already used twice in this
file:
```
['birthday_tomorrow', 'Birthdays tomorrow'], ['anniversary_tomorrow', 'Anniversaries tomorrow']
```
Filter logic follows the same `if (filter === '...') l = l.filter(...)`
pattern, using the `days_until === 1` result from the queries above
instead of the existing `todayMD()` string-match (today's tabs stay
completely unchanged).

Table columns/row rendering: unchanged (CLIENT/MOBILE/POINTS/TIER/
BIRTHDAY/ANNIVERSARY/MAGIC LINK, verbatim structure per the audit).

**Decision (column scope):** the new "WhatsApp Wish" column with its
"Approve & Send" button (`btn-gold` or `btn-ink !px-2 !py-1.5
text-[11px]`, matching existing action-button sizing in that row)
renders **only when `filter === 'birthday_tomorrow'` or `filter ===
'anniversary_tomorrow'`** — conditionally added `<th>`/`<td>`, not a
permanent 8th column. It does not appear on "All clients," "Birthdays
today," "Anniversaries," or "Reviews" — those tabs have no single
defined occasion type to wish, so the button would be meaningless
there. This requires the table header/row rendering to branch on
`filter` for that one trailing column only; every other column stays
byte-identical across all tabs.

## 3. Approval modal

Reuses the existing Modal component as-is (open/onClose/title/children/
wide props, no new modal primitive). Content:
- Customer name, occasion type (Birthday/Anniversary), the occasion date.
- Rendered template preview: since no real Meta-approved template text
  exists yet, shows a clear placeholder preview string assembled the
  same way `MomentCard`'s existing template-string-with-substitution
  logic works (name filled in, discount/coupon/validDays from section 1
  shown as readable preview text), so the modal's shape is ready to
  swap in real template text later without restructuring.

**Decision (Anniversary's two name slots):** Ma'am's reference material
shows Anniversary templates using `{{1}}` and `{{2}}`, but our data
model has only one customer name field (no "partner name"). This phase
uses the **customer's own name for both slots** — simplest, and avoids
sending an empty string into a Meta-required parameter (a likely
rejection cause) once real credentials exist. This is a placeholder
choice, not a final one — revisit once the real approved Anniversary
template's actual parameter meanings are confirmed.

**Decision (bodyParams sent to Meta):** Approve's call to
`sendWhatsAppTemplateMessage` passes **`bodyParams: [name]` only** —
identical to `MomentCard`'s existing first-pass behavior (see the
`convex/whatsapp.ts` commit's own "first-pass simplified... follow-up
needed" note). Discount/Coupon/Valid Days remain **preview-only display
text in the modal** for this phase — they are NOT threaded into the
Graph API payload yet, because their real position/count within Ma'am's
actual approved template isn't finalized. Wiring them into `bodyParams`
is explicit follow-up work once the real template exists, not part of
this task.

- Approve button: calls `sendWhatsAppTemplateMessage` immediately (same
  try-then-fallback path already built and tested), closes the modal,
  shows a success/fallback message reusing the existing `sendMsg`-style
  feedback pattern. On any failure (no credentials, Meta rejection,
  etc.), falls back to `window.open(buildWaLink(...))` using the same
  placeholder preview text shown in the modal — so the wa.me fallback
  message is never blank or undefined.
- Cancel button: closes the modal, does nothing.

## Files touched
- `convex/settings.ts`: new `SETTINGS_KEYS` entry + query/mutation
  (additive only, same file already being extended this session).
- `convex/customers.ts`: NOT modified — existing queries reused as-is.
- `src/lib/db.js`: two new bridge functions
  (`getWhatsAppTemplateConfig`/`setWhatsAppTemplateConfig`).
- `src/pages/merchant/Templates.jsx`: three new fields per `MomentCard`,
  saved on blur.
- `src/pages/merchant/Customers.jsx`: two new tabs, one conditional new
  table column (tomorrow-tabs only), one new approval modal (reusing
  the existing `Modal` component).

## Explicitly NOT touched
- `middleware.js`, `convex/whatsapp.ts`'s core send logic (reused as-is,
  not modified), Card 3/`MediaCard`, any other page/route.
- No consent field added or checked (matches today's existing,
  already-shipped behavior on these queries — not a new gap introduced
  by this task, but explicitly not closed either).

## Safety
- Purely additive at every layer: new settings key, new tabs, one
  conditional column, new modal — no existing tab, column, query, or
  component logic is altered.
- Approve still routes through the already-tested
  try-Cloud-API-then-wa.me-fallback path — no new failure mode
  introduced beyond what already exists.
- `getUpcomingBirthdays`/`getUpcomingAnniversaries` are reused
  read-only, unchanged — zero risk of regressing today's existing
  "Birthdays today"/"Anniversaries" tabs, which are provably untouched.

## Testing plan
1. Build check, CSS delta explained (should be near-zero, all classes
   reused verbatim).
2. Backend: real read-merge-write independence test for
   `setWhatsAppTemplateConfig` (same two-direction proof pattern used
   for every settings mutation this session).
3. Frontend: confirm `days_until === 1` filtering returns the correct
   customers (traced against real current data).
4. Regression: existing "Birthdays today"/"Anniversaries"/"All
   clients"/"Reviews" tabs confirmed byte-unchanged and functioning,
   including confirming the new "WhatsApp Wish" column does NOT appear
   on those tabs.
5. Modal: confirm it opens/closes correctly, Approve calls the real
   (guard-clause-protected, since no credentials exist yet) send
   action with `bodyParams: [name]` only, and falls back to wa.me using
   the same preview text shown in the modal — exactly like
   `Templates.jsx` already does.

## Decisions locked in (2026-08-24 review)
1. **Anniversary's `{{2}}` slot:** customer's own name for both slots
   (placeholder choice, revisit once real template is confirmed).
2. **"Approve & Send" column scope:** only on the two new tomorrow-tabs,
   conditionally rendered — not a permanent column on every tab.
3. **Discount/Coupon/Valid-Days field save timing:** on blur only, not
   on every keystroke — avoids excess/racing Convex writes.
4. **bodyParams sent to Meta on Approve:** `[name]` only for now;
   discount/coupon/validDays stay preview-only until the real approved
   template's parameter structure is known.
