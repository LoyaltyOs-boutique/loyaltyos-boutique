# Design: WhatsApp Consent Checkbox — Both Onboarding Flows

Date: 2026-08-25
Status: Approved
Branch: feat/whatsapp-cloud-api (continuing on same branch)

## Problem
Neither onboarding form (merchant-filled Client Onboarding, customer-filled
Self-Onboarding) captures WhatsApp consent today. The schema field
(whatsapp_consent) exists but is wired nowhere — not in createCustomer's
args, not in the insert path, not in the existing-customer repeat-link
path, and not checked by getUpcomingBirthdays/getUpcomingAnniversaries
or the Approve & Send flow. This closes that gap end-to-end.

## Scope
1. Add whatsapp_consent to createCustomer's args and handler — BOTH
   branches (new insert AND existing-customer-found), since a repeat
   magic-link generation currently does zero writes to an existing
   record (confirmed via investigation) — ticking consent on a repeat
   visit would otherwise be silently discarded.
2. Add a checkbox UI to both Onboarding.jsx (merchant-filled) and
   Join.jsx (self-onboarding) — identical field, identical wording,
   identical position (after the existing fields, before the submit
   button).
3. Add consent-gating to the Approve & Send flow (Customer CRM's
   tomorrow-tabs modal) — if a customer's whatsapp_consent is not
   true, the Approve button is disabled with a clear message, rather
   than silently sending or crashing.

## Backend: convex/customers.ts's createCustomer mutation
Add to args: whatsapp_consent: v.optional(v.boolean()).
Handler changes:
- Insert branch (new customer): pass whatsapp_consent through to the
  inserted document (default false/undefined if not provided —
  matches the field's existing v.optional(v.boolean()) schema type,
  no schema change needed).
- Existing-customer branch: today this branch does zero writes
  (confirmed via investigation — just looks up and returns). Add an
  explicit ctx.db.patch(existing._id, { whatsapp_consent }) call ONLY
  when whatsapp_consent is provided as true in this call's args (i.e.
  a repeat-visit consent tick updates the record; not providing it,
  or providing false, does not silently downgrade a customer who
  already consented on a prior visit — consent should only ever be
  set to true here, never cleared, since clearing consent is a
  separate, more sensitive action not in this task's scope).

## Frontend: checkbox UI (Onboarding.jsx and Join.jsx, identical)
No existing checkbox pattern exists in this codebase (confirmed via
investigation) — use a plain, minimally-styled real checkbox, not a
repurposed pill-toggle (a marketing-style pill button is the wrong
metaphor for a consent affirmation). Pattern:
<div className="flex items-start gap-2">
  <input
    type="checkbox"
    id="whatsapp_consent"
    checked={f.whatsapp_consent || false}
    onChange={(e) => setF({ ...f, whatsapp_consent: e.target.checked })}
    className="mt-1"
  />
  <label htmlFor="whatsapp_consent" className="text-sm text-steel">
    I agree to receive WhatsApp updates (birthday/anniversary wishes and offers) from 85 Lansdowne.
  </label>
</div>
Placed after the existing City/Country (Onboarding.jsx) or City/Country
(Join.jsx) fields, before the submit button, in both files identically.
Both forms already call the same shared function (onboardCustomerRemote
in db.js) — that bridge function needs whatsapp_consent added to the
object it passes through to the createCustomer mutation call.

## Frontend: consent gating on Approve & Send (Customers.jsx)
The ApprovalModal (built in the previous session) currently shows a
template preview and an Approve button unconditionally. Add a check:
if the customer row's whatsapp_consent is not true, replace the
Approve button with a disabled state and a clear message ("This
customer hasn't given WhatsApp consent yet — can't send."). This
requires whatsapp_consent to be included in the data the tomorrow-tabs
already fetch — confirm whether getUpcomingBirthdays/
getUpcomingAnniversaries's projection needs to add this field (it's
not currently selected, per investigation) — if so, add it to both
queries' return shape (read-only addition, no behavior change to the
date-window logic itself).

## Explicitly NOT in scope (per user's prior decisions)
- 3-way consent split (consent_occasion/consent_marketing separately)
  — single whatsapp_consent boolean covers both for now.
- STOP-flag / webhook-based opt-out handling — future work, requires
  WhatsApp webhook infrastructure not yet built.
- Any UI for a merchant to manually toggle an existing customer's
  consent outside the two onboarding flows (e.g. from within Customer
  CRM directly) — not requested, not built here.
- Cleaning up the dead if (res.existingId) code branches noticed in
  both forms during investigation — pre-existing, unrelated, left
  alone per no-scope-creep discipline.

## Files touched
- convex/customers.ts (createCustomer: args + both branches' handler)
- src/lib/db.js (onboardCustomerRemote: pass whatsapp_consent through)
- src/pages/merchant/Onboarding.jsx (new checkbox field)
- src/pages/Join.jsx (new checkbox field, identical)
- src/pages/merchant/Customers.jsx (ApprovalModal consent gate; possibly
  the tomorrow-tab data-fetch if the projection needs the new field)
- convex/customers.ts's getUpcomingBirthdays/getUpcomingAnniversaries
  ONLY if their projection needs to add whatsapp_consent (read-only
  addition to the returned shape, confirmed necessary during the
  gating step, not assumed here)

## Explicitly NOT touched
- middleware.js, convex/whatsapp.ts, convex/settings.ts, Templates.jsx,
  MediaCard, or any other file from prior sessions.
- No schema change (whatsapp_consent already exists as a field).
- The dead if (res.existingId) branches in both forms (noted, not
  removed).

## Safety
- Additive only at every layer: one new optional mutation arg, one
  new UI checkbox (same pattern, twice), one new conditional check in
  an existing modal.
- The existing-customer patch is scoped narrowly (only sets to true,
  never clears) — cannot accidentally downgrade a customer who already
  consented on an earlier visit, even if this form is submitted again
  without the box ticked.
- No existing form field, existing customer-creation path, or existing
  Approve & Send success path is altered — only a new gate is added
  before Approve is allowed to fire.

## Testing plan
1. Real Convex test: create a brand-new customer with
   whatsapp_consent: true, confirm it's stored; create one with it
   omitted, confirm it defaults to false/undefined — not an error.
2. Real Convex test: call createCustomer again for an EXISTING mobile
   number with whatsapp_consent: true — confirm the existing record
   is patched (not duplicated), confirm a fresh getCustomers-style
   read shows consent now true.
3. Real Convex test: call it again for the same existing customer with
   whatsapp_consent omitted/false — confirm consent stays true (not
   downgraded) — proves the "never clears" safety rule.
4. Frontend: confirm the checkbox renders identically in both forms,
   submits correctly.
5. Frontend: confirm the Approve & Send modal correctly disables/warns
   for a customer with consent false, and allows Approve normally for
   one with consent true.
6. Full regression sweep: existing onboarding flow (name/mobile/
   birthday/etc.) unaffected, existing magic-link generation for both
   new and existing customers unaffected beyond the new consent field.
