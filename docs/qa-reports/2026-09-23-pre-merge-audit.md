# Pre-Merge Audit — `feat/ai-automation-gemini-phase` → `main`

**Date:** 2026-09-23/24 · **Auditor:** office-tester-agent methodology (run directly, no subagent spawned, per task instruction) · **Mode:** read-only. Nothing changed, deployed, merged, or committed. The only file written by this audit is this report (untracked).

---

## VERDICT: MERGE-READY WITH ACCEPTED RISKS

The branch is technically mergeable right now: `git merge-tree` reports a clean merge (no conflicts), `main` has not moved since the branch point, the build is clean at the documented CSS baseline, the schema change is 100% additive, and every Convex function the live production frontend (`origin/main`'s `src/`) calls still exists with a compatible argument shape. **No new security regression is introduced by this branch** — the two Critical vulnerabilities are inherited from `main` (already open there today), not created by this branch.

**Accepted risks (pre-existing on `main`, not made worse by this branch):**
1. **Critical #1 — `generateMagicTokenSelf`/`generateMagicToken` account takeover** (`convex/auth.ts:190-227`, `:259-286`) — OPEN.
2. **Critical #2 — `createCustomer` duplicate-mobile confidential-data leak** (`convex/customers.ts:976-1079`) — OPEN.
3. **Forgot-password flow incomplete** — no `resetPassword` mutation consumes the reset token (pre-existing gap, not touched by this branch).
4. **Soft-delete does not revoke magic-link access** — a soft-deleted customer's existing magic link keeps working (documented known gap in the 2026-09-14 spec, confirmed still true — `is_deleted` is never checked in `convex/auth.ts`).
5. **WhatsApp Cloud API env vars unset** (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`) — all Cloud-API sends will throw a clear error until configured; no crash risk, but the "Send All"/dispatch features are non-functional until then.
6. **~49% of the live `users` table is test/QA data** (47 of 95 customer rows) — a data-hygiene item for before real client demos, not a merge blocker.

**Blockers found: none.** No conflicting paths, no removed/renamed production API, no required-arg additions to any function the live frontend calls, no schema field made required or removed, no cron sends WhatsApp, no secrets committed, build is clean.

Two items below are new/updated in this branch and deserve a human decision before merge, not because they're broken, but because they change behavior:
- `getSettings`/`getTemplateCardUrls` are public and unguarded (pre-existing pattern, unchanged by this branch) — confirmed non-PII, exposes only tier percentages and card image URLs.
- `getEventAccess` (new, this branch) takes a raw `customerId` with no token check — see §5 finding.

---

## 2. Git state

```
$ git fetch origin
(no output — up to date)

$ git status --short
?? .claude/.headroom_wrap_settings.lock
?? .playwright-mcp/
?? .serena/
?? ARCHITECTURE_CX.html
?? FRONTEND_FULL_SOURCE.html
?? "Final LoyaltyOS_CX_Full_Feature_Document.html"
?? "Final LoyaltyOS_Full_Architecture.html"
?? LoyaltyOS_CX_Full_Feature_Document.html
?? MASTER_PLAN.html
?? "MIRARI LOOKBOOK1.pdf"
?? PROJECT_UNDERSTANDING.md
?? docs/architecture-and-memory.html
?? docs/birthday-anniversary-full-architecture.html
?? docs/complete-branch-summary-2026-09-09.html
?? docs/full-system-audit-2026-09-04.html
?? docs/project-documentation-index.html
?? docs/qa-reports/2026-09-11-full-qa-report.zip
?? docs/qa-reports/2026-09-11-full-qa-report/
?? docs/superpowers/reports/2026-08-31-scalability-audit-300-to-1000.html
?? docs/superpowers/specs/2026-09-14-templates-ai-draft-design.md
?? docs/superpowers/specs/2026-09-15-merchant-hydration-fix-design.md
?? qa-screenshots-2026-09-11/
?? whatsapp-feature-summary.html

$ git stash list
(empty)

$ git branch -vv
* feat/ai-automation-gemini-phase    e0cf851 [origin/feat/ai-automation-gemini-phase] docs(ledger): CSV bulk onboarding entry for 3d147cf
  main                               ff1cbcb [origin/main] Ledger: record production merge of feat/merchant-session-lock to main (commit 85e20b4)
  (27 other feature branches omitted — all tracked, all [origin/...])

$ git log --oneline -1 main
ff1cbcb Ledger: record production merge of feat/merchant-session-lock to main (commit 85e20b4)

$ git log --oneline -1 origin/main
ff1cbcb Ledger: record production merge of feat/merchant-session-lock to main (commit 85e20b4)

$ git merge-base HEAD origin/main
ff1cbcb722cdbe14a7de3bf25a57a1bc61b8bc7c

$ git rev-list --count origin/main..HEAD
116

$ git rev-list --count HEAD..origin/main
0
```

**Main has NOT moved since the branch point** (`main` and `origin/main` are both exactly `ff1cbcb`, which is also the merge-base). The branch is 116 commits ahead, 0 behind.

**Conflict check (working tree untouched):**
```
$ git merge-tree --write-tree origin/main HEAD
98f885e21d493ee3ef8b94d7e6e81e586d21e90d
```
Exit code 0, a single tree hash returned with no conflict markers/paths listed → **clean merge, zero conflicting paths.**

---

## 3. Change inventory

```
$ git diff --stat origin/main...HEAD
 .superpowers/sdd/progress.md                          |  109 ++
 CLAUDE.md                                              |   40 +-
 api/dynamic-shell.js                                   |   66 ++
 convex/_generated/api.d.ts                             |   16 +-
 convex/activity.ts                                     |   73 ++
 convex/ai.ts                                           | 1117 ++++++++++++++++++++
 convex/auth.ts                                         |   37 +-
 convex/convex.config.ts                                |   20 +
 convex/crons.ts                                        |  838 +++++++++++++++
 convex/customers.ts                                    |  943 ++++++++++++++++-
 convex/events.ts                                       |  524 +++++++++
 convex/lookbooks.ts                                    |   95 ++
 convex/notifications.ts                                |   87 ++
 convex/orders.ts                                       |   15 +-
 convex/rateLimits.ts                                   |   48 +
 convex/reviews.ts                                      |   60 +-
 convex/schema.ts                                       |  273 ++++-
 convex/whatsapp.ts                                     |  335 +++-
 docs/qa-reports/2026-09-13-production-load-test-report.html | 145 +++
 docs/superpowers/specs/*.md (16 new spec files)        |
 memory-bank/progress.md                                |  109 ++
 package-lock.json                                      |   16 +
 package.json                                           |    1 +
 src/components/merchant/Shell.jsx                      |  352 +++-
 src/lib/csvImport.js                                   |  282 +++++
 src/lib/db.js                                          |  848 ++++++++++++++-
 src/pages/Lookbook.jsx                                 |  189 +++-
 src/pages/merchant/Campaigns.jsx                       |  163 +++-
 src/pages/merchant/Catalogue.jsx                       |   24 +-
 src/pages/merchant/Customers.jsx                       |  624 ++++++++++-
 src/pages/merchant/Dashboard.jsx                       |  107 +-
 src/pages/merchant/Onboarding.jsx                      |  177 +++-
 src/pages/merchant/Templates.jsx                       |  155 +++-
 vercel.json                                            |   30 +-
 50 files changed, 10613 insertions(+), 244 deletions(-)
```

**Grouped by folder (50 changed files total):**

| Folder | Files | Notes |
|---|---|---|
| `convex/` | 15 | 5 brand-new modules (`activity.ts`, `ai.ts`, `convex.config.ts`, `crons.ts`, `events.ts`, `notifications.ts`, `rateLimits.ts` — 7 actually new), rest modified additively |
| `src/` | 10 | `Shell.jsx`, `csvImport.js` (new), `db.js`, `Lookbook.jsx`, `Campaigns.jsx`, `Catalogue.jsx`, `Customers.jsx`, `Dashboard.jsx`, `Onboarding.jsx`, `Templates.jsx` — all are on CLAUDE.md's approved-flow-files list except `Shell.jsx` (bell icon, explicitly documented in ledger) |
| `api/` | 1 | `dynamic-shell.js` (new — Vercel Function for CDN-staleness fix) |
| `docs/` | 18 | 1 QA report + 16 new spec files + 1 renamed/moved (see below) |
| Config | 4 | `CLAUDE.md`, `package.json`, `package-lock.json` (adds `@convex-dev/rate-limiter` + `@vercel/blob`), `vercel.json` |
| Ledgers | 2 | `.superpowers/sdd/progress.md`, `memory-bank/progress.md` — 109 lines added to each (identical) |

Two spec files present in the working tree are **untracked** on this branch (not committed): `docs/superpowers/specs/2026-09-14-templates-ai-draft-design.md`, `docs/superpowers/specs/2026-09-15-merchant-hydration-fix-design.md`. They are referenced by ledger entries but not part of `git diff origin/main...HEAD` — flagged in §15.

---

## 4. Feature inventory (ledger entries added after branch point `ff1cbcb`)

`.superpowers/sdd/progress.md` is 289 lines total; `origin/main`'s copy is 180 lines. All 55 entries below are new (lines 181–289), confirmed via `git diff origin/main...HEAD -- .superpowers/sdd/progress.md` (+109 lines) and cross-checked against `git show origin/main:.superpowers/sdd/progress.md | wc -l` = 180.

| Date | Title | Commit | Spec | Main files |
|---|---|---|---|---|
| 09-03 | Spec amendment: AI Automation design §7 Scalability | `a9a9f79` | 2026-09-03-ai-automation-architecture-design.md | docs only |
| 09-03 | Spec: Phase 0 pre-AI scaling fixes | `9789d87` | 2026-09-03-scaling-fixes-pre-ai-design.md | docs only |
| 09-03 | Fix 1 backend: `getCustomersPaginated` + `name_lower` mirror | `c6b3e66` | 2026-09-03-scaling-fixes-pre-ai-design.md | customers.ts, schema.ts |
| 09-03 | Comment-only: removed stale backfillNameLower ref | `c6b3e66` | same | schema.ts |
| 09-03 | Fix 1 frontend: hybrid pagination wiring | `650d1df` | same | Customers.jsx |
| 09-03 | Fix 2 & 3 backend + full regression | `164b813` | same | customers.ts, orders.ts, schema.ts |
| 09-03 | Merge: scale-fixes-pre-ai → this branch | `1bf93cc` | — | (merge) |
| 09-04 | Phase 1: `getCustomerIntelligenceProfile` | `6d79189` | 2026-09-04-phase1-customer-intelligence-design.md | customers.ts |
| 09-04 | Phase 2: `convex/ai.ts` Gemini plumbing | `76b39eb` | 2026-09-03-ai-automation-architecture-design.md | ai.ts |
| 09-04 | Phase 3 (Option 3): AI drafts table + cron | `b622852` | 2026-09-04-phase3-whatsapp-ai-drafts-design.md | ai.ts, crons.ts, schema.ts |
| 09-04 | Phase 5 (Feature C): Events + VVIP backend | `592fa35` | 2026-09-04-phase5-virtual-events-vvip-design.md | events.ts, schema.ts, auth.ts |
| 09-04 | Phase 5 frontend: Event Setter + VVIP checkbox | `5435370` | same | Campaigns.jsx, Onboarding.jsx |
| 09-04 | Dashboard Notifications: is_deleted fix + backend + bell UI | `2c22418` | 2026-09-04-dashboard-notifications-design.md | notifications.ts, crons.ts, Shell.jsx |
| 09-04 | Notification bell polish + cron-timing investigation | `2c22418` | same | Shell.jsx |
| 09-04 | Notification bell: red dot + real tab navigation | `2c22418` | same | Shell.jsx |
| 09-05 | Revert: Critical #1/#2 fix caused live regression | `5545175`(reverted) | 2026-09-05-rate-limiting-design.md | auth.ts, customers.ts |
| 09-05 | Correction to revert entry (root cause mis-stated) | `5545175` | same | docs only |
| 09-05 | Rate limiting (defense-in-depth) | `4fe1273` | 2026-09-05-rate-limiting-design.md | rateLimits.ts, auth.ts, customers.ts, reviews.ts |
| 09-05 | Pre-Gemini-key hardening: prompt-injection + sanitization | `f15a52a` | (audit doc) | ai.ts, events.ts |
| 09-07 | `getEventAccess` VVIP read-time re-check | `b0b1acc` | (audit doc) | events.ts |
| 09-07 | Daily cron fixed-schedule fix | `6a35dbc` | (audit doc) | crons.ts |
| 09-07 | CLAUDE.md staleness fix (Part F #10) | `27153a7` | — | CLAUDE.md |
| 09-07 | Full CLAUDE.md refresh (Part F #10 follow-up) | `27153a7` | — | CLAUDE.md |
| 09-08 | Customer Activity Intelligence Part 1/3: real tracking | `6abc85f` | 2026-09-07-customer-activity-intelligence-design.md | activity.ts, schema.ts |
| 09-08 | Part 2/3: weekly "most active" bell notification | `3832593` | same | crons.ts, notifications.ts |
| 09-08 | Part 3a/3: AI per-customer activity summary backend | `8e0323a` | same | ai.ts, crons.ts, schema.ts |
| 09-08 | Gemini model swap: 2.0-flash → 3.5-flash-lite | `a20dd0d` | — | ai.ts |
| 09-09 | Part 3b (final): Dashboard "Active this week" | `873f42a` | same | Dashboard.jsx, ai.ts |
| 09-09 | Part 3b follow-up: 30s polling | `873f42a` | same | Dashboard.jsx |
| 09-09 | WhatsApp Approve & Send, Option B | `a3ee453` | 2026-09-09-whatsapp-ai-draft-wame-design.md | Templates.jsx, whatsapp.ts |
| 09-09 | Birthday/anniversary AI draft on-demand + caching | `348ac3e` | same | ai.ts |
| 09-09 | Fix P0-1 (dedup never expires) + P1-3 (format) | `18b66f1` | same | customers.ts, schema.ts |
| 09-09 | Weekly-activity bell: on-demand AI popup (P2-1/P2-2) | `6c4024b` | same | Dashboard.jsx, ai.ts |
| 09-09 | Fix P2-3 (stale bell navigation) | `7c030bd` | same | Shell.jsx |
| 09-09 | Fix P2-4 (misleading "sent" for wa.me link-opens) | `f4b1a45` | same | schema.ts, customers.ts, Customers.jsx |
| 09-09 | Dashboard AI-summary popup: "View Full Profile" | `c3c5013` | same | Dashboard.jsx |
| 09-14 | Customer soft-delete (deleteCustomer + bulk), 19/19 pass | `a0f3ebe` | 2026-09-14-customer-soft-delete-design.md | customers.ts, schema.ts |
| 09-15 | Templates.jsx AI-draft backend | `f6bf639` | 2026-09-14-templates-ai-draft-design.md **(untracked spec)** | ai.ts |
| 09-15 | Templates.jsx AI-draft frontend + live QA | `8233d47` | same **(untracked spec)** | Templates.jsx |
| 09-15 | Merchant hydrate-on-mount fix, 18/18+4/4 pass | `b1e7c75` | 2026-09-15-merchant-hydration-fix-design.md **(untracked spec)** | db.js |
| 09-15 | Customer CRM search tier-based matching, 6/6 pass | `a0f5a7f` | no spec | Customers.jsx or db.js |
| 09-17 | Customer-facing catalogue pipe | `6821655` | 2026-09-17-customer-catalogue-pipe-design.md | lookbooks.ts, db.js, Lookbook.jsx |
| 09-17 | Seed/real-catalogue race-condition fix | `bfd1fbc` | no spec | Lookbook.jsx |
| 09-17 | Vercel CDN caching fix (stale index.html) | `7f4ed6e` | no spec | vercel.json |
| 09-17 | Vercel CDN caching fix, 2nd attempt — UNVERIFIED | `b237c09` | no spec | vercel.json |
| 09-17 | `approveReview` tier-aware points fix | `4f1069e` | no spec | reviews.ts |
| 09-18 | Birthday/anniversary automatic points crediting | `8c55d41` | 2026-09-18-birthday-anniversary-points-design.md | whatsapp.ts / customers.ts |
| 09-18 | Today View combined Approve & Send | `da48018` | 2026-09-18-today-view-approve-send-design.md | Templates.jsx |
| 09-18 | Onboarding local-row whatsapp_consent/vvip fix | `58fc132` | no spec | Onboarding.jsx |
| 09-19 | Permanent lookbook staleness fix (Function bypass) | `051d26e` | 2026-09-19-lookbook-staleness-permanent-fix-design.md | vercel.json, api/dynamic-shell.js, Lookbook.jsx |
| 09-18 | Combined-occasion AI draft (single Gemini call) | `6d06a1b` | 2026-09-18-combined-occasion-ai-draft-design.md | ai.ts |
| 09-22 | Lookbook catalogue useMemo stale-closure fix | `8122de2` | no spec | Lookbook.jsx |
| 09-23 | Send All bulk WhatsApp (arch, gated on Meta template) | `69683f0` | 2026-09-22-send-all-bulk-whatsapp-design.md | whatsapp.ts, Templates.jsx |
| 09-23 | Event Setter dropdown placeholder rename | `480c7b1` | no spec (trivial UI text fix) | Campaigns.jsx |
| 09-23 | CSV bulk onboarding — first-class customers | `3d147cf` | 2026-09-23-csv-bulk-onboarding-design.md | csvImport.js, customers.ts, Onboarding.jsx |

**Note on the "PRODUCTION MERGE: feat/merchant-session-lock" entry** dated 2026-09-03 that appears at line 180 of the file: that entry is **already in `origin/main`** (confirmed: `origin/main`'s copy of the ledger is exactly 180 lines and ends with that same entry) — it is NOT part of this branch's new content, listed here only to explain the date-ordering; it is excluded from the 55-entry count above.

---

## 5. Security — session guard coverage

Full inventory of exported `query`/`mutation`/`action`/`internal*` functions across `convex/*.ts` (public vs internal), and their guard status:

**`requireMerchantSession` — quoted in full (`convex/auth.ts:91-104`):**
```ts
export async function requireMerchantSession(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  token: string,
): Promise<UserDoc> {
  const user = await ctx.db.get(userId);
  if (!user) throw new ConvexError("Not authenticated");
  if (user.role !== "merchant") throw new ConvexError("Not authorized");
  if (user.session_token !== token) throw new ConvexError("Invalid session");
  if (!user.session_expiry || user.session_expiry < Date.now()) {
    throw new ConvexError("Session expired");
  }
  return user;
}
```
Actions (which have no `ctx.db`) call it indirectly via a per-file `checkMerchantSession` `internalQuery` wrapper (`ai.ts:287`, `events.ts:281`, `lookbooks.ts:355`, `templates.ts:30`, `whatsapp.ts:116`) that all do `await requireMerchantSession(ctx, userId, token)` — same pattern everywhere, confirmed by direct grep.

**Guard status by file (public functions only; internal* functions are never externally callable and are excluded):**

| File | Guarded (requireMerchantSession/checkMerchantSession) | Public + intentionally unguarded | Notes |
|---|---|---|---|
| `auth.ts` | `generateMagicTokenForCustomer` | `merchantLogin`, `generateMagicTokenSelf`, `generateMagicToken`, `validateMagicToken`, `forgotPassword` | These 5 are the auth entry points themselves — guarding them is a contradiction. `generateMagicTokenSelf`/`generateMagicToken` are Critical #1 (§6). |
| `customers.ts` | `getCustomers`, `getCustomersPaginated`, `getCustomerById`, `updateMeasurements`, `addStaffNote`, `updateCustomTags`, `updateCustomerProfile`, `getUpcomingBirthdays`, `getUpcomingAnniversaries`, `recordMessageAction`, `awardPoints`, `getPointsHistory`, `findCustomerByMobile`, `deleteCustomer`, `bulkDeleteCustomers`, `bulkCreateCustomers`, `checkMobilesStatus`, `getCustomerIntelligenceProfile`, `getDraftForCustomer` | `createCustomer` | `createCustomer` is Critical #2 (§6) — self-onboarding entry point, cannot require a merchant session by design, but its duplicate-mobile branch over-returns. |
| `lookbooks.ts` | `getLookbooks`, `getLookbooksForSelector`, `createLookbook`, `updateLookbook`, `deleteLookbook`, `addCatalogueItem`, `updateCatalogueItem`, `deleteCatalogueItem`, `generatePdfUploadUrl` | `getLookbookById`, `getCustomerCatalogue`, `getCatalogueItemById` | `getLookbookById`/`getCatalogueItemById` intentionally public (public-lookbook sharing, OG-preview) and return only product/catalogue data, no PII. `getCustomerCatalogue` does its own inline magic-token validation (byte-identical to `validateMagicToken`, `lookbooks.ts:129-188`) — correctly gated by proof-of-ownership, not merchant session. |
| `orders.ts` | `createOrder`, `getOrders`, `getOrdersByUser`, `getTodayOrders`, `getTodaySummary` | none | All 5 take `userId`/`token` and guard first — fully merchant-only, no customer-facing use. |
| `reviews.ts` | `approveReview`, `declineReview`, `getPendingReviews`, `getReviews` | `createReview` | `createReview` is deliberately public (customer submits a review) — rate-limited (`createReviewByUser`, 20/hour), and worst case is spam, not data exposure (per `rateLimits.ts`'s own comment). |
| `settings.ts` | `updateSettings`, `updateTemplate`, `setTemplateCardUrl`, `getWhatsAppTemplates`, `setWhatsAppTemplate`, `clearWhatsAppTemplate`, `getWhatsAppTemplateConfig`, `setWhatsAppTemplateConfig`, `resetSettings` | `getSettings`, `getTemplateCardUrls` | Both public reads return non-PII business config (tier percentages, card image URLs) — no customer/merchant identifying data. Pre-existing pattern, unchanged by this branch. |
| `events.ts` | `createEvent`, `getEvents`, `deleteEvent`, `dispatchEvent` (via checkMerchantSession), `generateEventDraftPublic` (via checkMerchantSession) | `getEventAccess` | **Flagged finding below.** |
| `notifications.ts` | `getNotifications`, `markAllSeen`, `deleteNotification` | none | All merchant-guarded (file header: "every function here is merchant-guarded"). |
| `whatsapp.ts` | `sendWhatsAppTemplateMessage`, `sendWhatsAppServiceMessage`, `sendAllUpcomingOccasionMessages` (all via checkMerchantSession) | none | |
| `templates.ts` | `generateTemplateMediaUploadUrl` (via checkMerchantSession) | none | |
| `ai.ts` | `generateMessageDraftPublic`, `generateMessageDraftManual`, `generateCombinedMessageDraftPublic`, `testGeminiConnection`, `getActiveCustomers`, `generateActivitySummaryPublic` (all guarded) | none | |
| `activity.ts` | none | `trackActivity` | **Flagged finding below.** |

**Findings (neither is new to the audit's scope of Critical #1/#2, both low-severity, informational-only exposure):**

1. **`convex/events.ts:489-524` `getEventAccess`** — public query, no `requireMerchantSession`, and takes `customerId: v.id("users")` as a raw argument with **no token/ownership check**:
   ```ts
   export const getEventAccess = query({
     args: {
       customerId: v.id("users"),
       eventId: v.id("events"),
       now: v.optional(v.number()),
     },
     handler: async (ctx, { customerId, eventId, now }) => {
       const event = await ctx.db.get(eventId);
       ...
       const customer = await ctx.db.get(customerId);
       if (!customer || customer.role !== "customer") return null;
       ...
   ```
   Anyone who knows/guesses a customer's Convex `_id` (visible in that customer's own magic-link/share URLs) can call this for ANY `customerId` to check their VVIP-unlock status and read unlocked event content once `event_datetime - 5min` has passed. Impact is low: `toEventView` (events.ts:48, "no secrets on this table") returns only designer name/datetime/description/draft text — no customer PII is returned about the impersonated `customerId`, only whether that ID is a VVIP customer. Not part of the tracked Critical #1/#2, but worth a ticket.

2. **`convex/activity.ts:47-71` `trackActivity`** — public mutation, deliberately unguarded per its own doc comment (`activity.ts:19-28`, "AUTH — deliberately PUBLIC / UNGUARDED... mirrors createReview/generateMagicTokenSelf"), accepts `customerId: v.id("users")` with **no proof the caller owns that ID**. Anyone can insert a `like`/`cart_add`/`lookbook_view`/`event_link_click` row for any customer. Impact: engagement-data spam only (affects Dashboard "Active this week" and AI activity summaries), not a PII read/write. Explicitly accepted risk per the file's own comment, no rate limiting added (also explicitly deferred per the comment). Consistent with, not worse than, the existing `createReview` posture.

Both are pre-existing-pattern-consistent design choices, not regressions — flagged per the task's instruction to flag any public function reading/writing customer data without a guard and without an obvious token check.

---

## 6. Security — the two known CRITICAL issues (read-only, not exploited)

### Critical #1 — magic-link account takeover (still OPEN)

`convex/auth.ts:190-227`:
```ts
export const generateMagicTokenSelf = mutation({
  args: {
    mobile: v.string(),
    baseUrl: v.optional(v.string()),
  },
  handler: async (ctx, { mobile, baseUrl }) => {
    const digits = mobile.replace(/\D/g, "");

    const rl = await rateLimiter.limit(ctx, "magicTokenByMobile", { key: digits });
    if (!rl.ok) {
      return { ok: false, error: "Too many attempts — please try again in a few minutes.", rateLimited: true };
    }

    const customer = await ctx.db
      .query("users")
      .withIndex("by_mobile", (q) => q.eq("mobile", digits))
      .first();
    if (!customer || customer.role !== "customer") return null;

    return issueMagicToken(ctx, customer, baseUrl);
  },
});
```
**Answer: YES — a magic token can be minted for an existing customer with only a mobile number and no ownership check.** No OTP, no proof the caller owns that WhatsApp number. `issueMagicToken` (`auth.ts:157-181`) rotates a fresh 256-bit token and returns the live 180-day portal link to whoever called this mutation. Deprecated alias `generateMagicToken` (`auth.ts:259-286`) has a byte-identical unguarded body and is still an active caller target from `Onboarding.jsx`/`Join.jsx`.

**Rate limiter quoted (`convex/rateLimits.ts:29`):**
```ts
magicTokenByMobile: { kind: "token bucket", rate: 5, period: 10 * MINUTE },
```
Defense-in-depth only — 5 attempts/10 min per mobile, shared by both `generateMagicTokenSelf` and `generateMagicToken`. Does not close the vulnerability, only slows automated abuse (explicitly stated in the code's own comment, `rateLimits.ts:5-9`).

### Critical #2 — `createCustomer` duplicate-mobile confidential-data leak (still OPEN)

`convex/customers.ts:976-1052` (duplicate-mobile branch):
```ts
export const createCustomer = mutation({
  args: { mobile: v.string(), name: v.string(), birthday: v.optional(v.string()), ... },
  handler: async (ctx, { mobile, name, ... }) => {
    ...
    const rl = await rateLimiter.limit(ctx, "createCustomerByMobile", { key: normalized });
    if (!rl.ok) { return { ok: false, error: "Too many attempts..." }; }
    ...
    const existing = await ctx.db.query("users").withIndex("by_mobile", (q) => q.eq("mobile", normalized)).first();
    if (existing) {
      let record = existing;
      if (existing.is_deleted === true) { ... }
      if (whatsapp_consent === true && ...) { ... }
      if (vvip === true && ...) { ... }
      return {
        ok: true,
        isExisting: true,
        existingId: record._id,
        customer: toMerchantCustomer(record),   // <-- full merchant-view record
      };
    }
    ...
```
`toMerchantCustomer` (`convex/customers.ts:49-72`) returns, among other fields:
```ts
    magic_token: doc.magic_token ?? null,
    magic_token_created_at: doc.magic_token_created_at ?? null,
    ...
    // CONFIDENTIAL — merchant-only: body-fit measurements + internal staff notes.
    measurements: doc.measurements ?? {},
    staff_notes: doc.staff_notes ?? [],
```
**Answer: YES — the duplicate-mobile response returns `magic_token`, `measurements`, and `staff_notes` to an unauthenticated caller.** Anyone who submits an already-registered mobile number to the public `/join` self-onboarding form gets back that customer's live magic token (equivalent to Critical #1's full account takeover) plus their confidential measurements and staff notes, which are otherwise explicitly merchant-only everywhere else in the codebase.

**Rate limiter quoted (`convex/rateLimits.ts:39`):**
```ts
createCustomerByMobile: { kind: "token bucket", rate: 5, period: 10 * MINUTE },
```
Separate named bucket from `magicTokenByMobile` (so a legitimate two-call `/join` signup sequence doesn't cross-exhaust), same 5/10min shape, same "defense-in-depth, does not close it" posture per the file's header comment.

**Both are confirmed OPEN on `main` today** (this branch inherits, does not introduce, them — the fix-then-revert history is `5545175`→reverted `aed26cf`/`1c19ccb`, documented in the 2026-09-05 ledger entries, and the rate limiters above are this branch's only mitigation).

---

## 7. WhatsApp and automation safety

**All 3 registered crons (`convex/crons.ts`):**
```ts
crons.cron("generate dashboard notifications", "35 18 * * *", internal.crons.generateDailyNotifications, {});
crons.cron("generate weekly activity notifications", "40 18 * * 0", internal.crons.generateWeeklyActivityNotifications, {});
crons.cron("generate daily activity summaries", "45 18 * * *", internal.crons.generateDailyActivitySummaries, {});
```
(All fixed wall-clock IST times: 00:05, 00:10-Sun→Mon, 00:15 IST daily/weekly — not deploy-relative.) A 4th cron ("generate whatsapp ai drafts") was **explicitly removed** (`crons.ts:761-775`, superseded by on-demand generation) — its target function `generateDailyDrafts` still exists but is no longer auto-scheduled, only manually invokable.

**No cron sends WhatsApp — confirmed by code comment and by absence of any call:**
```
convex/crons.ts:13: * status:"pending". It has ZERO access to sendWhatsAppTemplateMessage or
```
`grep -n 'sendWhatsApp\|ctx.runAction(internal.whatsapp\|ctx.runAction(api.whatsapp' convex/crons.ts convex/ai.ts` returns only that one comment line — no actual call site in either file.

**Every WhatsApp-sending function, and its trigger + consent check:**

| Function | Trigger | Consent check |
|---|---|---|
| `sendWhatsAppTemplateMessage` (`whatsapp.ts:148`) | Merchant Approve & Send click (`checkMerchantSession` first) | Caller-side (Templates.jsx gates the button on `whatsapp_consent`) |
| `sendWhatsAppServiceMessage` (`whatsapp.ts:233`) | Merchant click (`checkMerchantSession` first) | Same |
| `sendAllUpcomingOccasionMessages` (`whatsapp.ts:404-…`) | Merchant "Send All" click (`checkMerchantSession` first, `whatsapp.ts:410`) | Enforced in `mergeOccasionHits` (`whatsapp.ts:357,371`): `if (!b.whatsapp_consent) continue;` / `if (!a.whatsapp_consent) continue;` — non-consenting customers are silently excluded from the recipient list before any send is attempted. Also gated on a real Meta template existing (`no_template` early return, D-17 — currently always true in production, so this function currently never actually sends). |
| `dispatchEvent` (`events.ts:361-…`) | Merchant "Dispatch Event" click (`checkMerchantSession` first, `events.ts:368`) | Enforced at the query level — `getDispatchRecipientsInternal` (`events.ts:299-319`) only reads via the `by_role_consent_vvip` index with `.eq("whatsapp_consent", true)` always in the query itself, so non-consenting customers are structurally never fetched as recipients, let alone sent to. |

"Nothing auto-sends" is true for both: no cron, no time-trigger reaches either function; both require an explicit merchant click every time.

---

## 8. Schema compatibility

`git diff origin/main...HEAD -- convex/schema.ts` (273 lines changed, full diff read) shows:

- **New fields on `users`:** `name_lower`, `birthday_md`, `anniversary_md`, `vvip` — all `v.optional(...)`. No existing field made required, none removed.
- **New indexes on `users`:** `by_role_name_lower`, `by_role_birthday_md`, `by_role_anniversary_md`, `by_role_consent_vvip` — all additive; `by_tier`/`by_mobile`/`by_email`/`by_magic_token` unchanged.
- **New index on `orders`:** `by_created_at` — additive; `by_user` unchanged.
- **`message_actions.action` union widened:** `v.union(v.literal("sent"), v.literal("cancelled"))` → `v.union(v.literal("sent"), v.literal("link_opened"), v.literal("cancelled"))` — purely additive (old values `"sent"`/`"cancelled"` still valid).
- **5 entirely new tables:** `ai_message_drafts`, `events`, `notifications`, `customer_activity_events`, `customer_activity_summaries` — new tables cannot invalidate existing documents.

No line in the diff removes a field, narrows a union, or makes an optional field required. **Existing documents stay valid — this is a 100% additive schema change.**

---

## 9. Production compatibility (shared Convex deployment)

`git grep -n -E 'api\.[a-zA-Z]+\.[a-zA-Z]+' origin/main -- src/` → 46 distinct `api.<module>.<function>` references. Cross-checked against the current branch's `convex/*.ts` exports:

**All 46 exist on this branch, unchanged or purely-additive argument shapes.** Verified by diffing each referenced function's `args:` block between `origin/main` and `HEAD`:
- `orders.ts`, `reviews.ts`, `settings.ts`, `templates.ts`, `auth.ts` (of the referenced functions) — **zero `args:` block changes at all** in any of the 5 referenced functions' signatures.
- `customers.ts`: `getCustomers` — args byte-identical (`{ userId: v.id("users"), token: v.string() }`), only handler body gained an additive `is_deleted` filter. `createCustomer` — one new field added, `vvip: v.optional(v.boolean())`. `bulkCreateCustomers` — two new optional row fields, `whatsapp_consent`/`vvip`. `recordMessageAction` — args byte-identical (7 fields unchanged); the `action` union widened additively (§8); internal date-format validation changed from `parseMD` ("M-D") to `parseYMD` ("YYYY-M-D", `customers.ts:673-685`) — confirmed this is compatible-or-better with what `origin/main`'s own `Customers.jsx` actually sends (`c.birthday`/`c.anniversary`, raw stored date strings, which match `YYYY-M-D`'s 3-part pattern, not the old 2-part `M-D`-only pattern).
- `lookbooks.ts`, `whatsapp.ts`: the only new `args:` blocks found belong to brand-new functions (`getCustomerCatalogue`, `sendAllUpcomingOccasionMessages`) that `origin/main`'s `src/` never calls — the referenced functions (`getLookbooks`, `getLookbookById`, `createLookbook`, etc.; `sendWhatsAppServiceMessage`, `sendWhatsAppTemplateMessage`) are untouched.

**Nothing removed, renamed, newly-guarded (guards were already live on `main` via the merchant-session-lock merge, `85e20b4`, which predates this branch), or given a new required argument. Today's live production frontend would work unchanged against this branch's backend if deployed.**

---

## 10. Leftovers

```
$ grep -rn 'TODO\|FIXME' convex/ src/ --include='*.ts' --include='*.js' --include='*.jsx'
(no output)

$ grep -rn 'console\.log' convex/ src/ --include='*.ts' --include='*.js' --include='*.jsx'
convex/auth.ts:427:        console.log(`[forgotPassword] RESET LINK for ${merchant.email}: ${resetLink}`);
convex/ai.ts:225:    console.log("[ai] GEMINI_API_KEY not set, skipping Gemini call");

$ grep -rn 'debugger' convex/ src/ ...
(no output)

$ grep -rn 'localhost\|127\.0\.0\.1' convex/ src/ ...
(no output)

$ grep -rn 'owner123' convex/ src/ ...
src/data/seed.js:88:      password_hash: 'owner123',
src/pages/Login.jsx:69:  Demo credentials</span> — owner@boutique.in / owner123

$ grep -rniE 'tempCleanup|one-off|backfill' convex/ src/ ...
convex/schema.ts:183: (comment: "no backfill is needed")

$ find convex/ -iname 'tempCleanup*'
(no output — confirmed no such file exists)
```

| Hit | Classification |
|---|---|
| `convex/auth.ts:427` console.log of reset link | **Pre-existing on `main`** (confirmed via `git diff origin/main...HEAD -- convex/auth.ts` — this line is untouched by this branch, only the rate-limiter block was added around it). Fine to leave for this merge; logs a live password-reset token to Convex function logs as a dev-mode fallback when Resend isn't configured — worth a separate ticket, not a branch regression. |
| `convex/ai.ts:225` console.log (no Gemini key) | Fine — informational, no secret logged. |
| `src/data/seed.js:88`, `src/pages/Login.jsx:69` owner123 | **Pre-existing on `main`**, both files untouched by this branch (not in the diffstat). Not introduced here. |
| `convex/schema.ts:183` "no backfill" comment | Fine — plain-English comment, not a leftover script reference. |

No `tempCleanup*.ts` file exists. No hardcoded API keys/tokens found in a targeted sweep of the new `ai.ts`/`whatsapp.ts`/`events.ts`/`crons.ts`/`rateLimits.ts`/`notifications.ts`/`activity.ts` files (`sk-`, `AIza`, `ghp_`, `xox`, 32+ char literal strings — all zero hits).

---

## 11. Environment variables

```
$ npx convex env list | cut -d= -f1
BLOB_READ_WRITE_TOKEN
GEMINI_API_KEY
RESEND_API_KEY
```
(Values never printed, per instruction.)

Env var names referenced anywhere in `convex/*.ts` (`grep -rn 'process\.env\.' convex/*.ts`): `BLOB_READ_WRITE_TOKEN`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`.

| Name | Set? | Feature | Failure mode if unset |
|---|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | ✅ set | Vercel Blob uploads (template card images, PDF lookbooks) | n/a |
| `GEMINI_API_KEY` | ✅ set | All AI draft/summary generation (`ai.ts`) | Code fails gracefully — `ai.ts:225` logs and skips rather than throwing (per Phase 2 design, "fails gracefully with no key") |
| `RESEND_API_KEY` | ✅ set | Forgot-password + magic-link backup email | n/a |
| `WHATSAPP_ACCESS_TOKEN` | ❌ **unset** | All 3 Cloud API senders | Throws a clear labeled `Error` (`whatsapp.ts:167-171`, `:248-251`, `:587-589`) — caught per-recipient in batch sends, surfaces as a merchant-visible failure, no crash |
| `WHATSAPP_PHONE_NUMBER_ID` | ❌ **unset** | Same 3 functions | Same — clear labeled `Error`, same 3 call sites |

WhatsApp Cloud API sending is **not functional** in the current deployment until these two are configured — consistent with D-17 (Meta template not yet approved) being the documented blocker.

---

## 12. Build, types, lint

```
$ rm -rf node_modules/.vite dist && npm run build
vite v5.4.21 building for production...
✓ 130 modules transformed.
(2 informational dynamic-import warnings — pre-existing pattern, db.js/api.js statically+dynamically imported by different pages, not an error)
dist/index.html                   0.93 kB │ gzip:   0.54 kB
dist/assets/index-CCDmCF7r.css   30.00 kB │ gzip:   5.98 kB
dist/assets/index--E2__dCh.js   442.72 kB │ gzip: 126.84 kB
✓ built in 8.47s
```
**0 errors.** CSS matches the documented 30.00 kB baseline exactly. JS grew to 442.72 kB (gzip 126.84 kB) from the merchant-session-lock baseline of 408.91 kB — expected, given the AI/events/notifications/CSV-import feature surface added on this branch.

```
$ npx tsc --noEmit -p convex
```
**Could not run** — `typescript` is not an installed project dependency (`node_modules/.bin/tsc` does not exist) and `npx tsc` would silently attempt to install a package, which is out of scope for a read-only audit. This is itself worth noting: there is no standalone typecheck gate for `convex/` other than `npx convex dev --once`'s own bundler check (not run here, per the STRICT no-deploy constraint).

```
$ cat package.json → scripts: { "dev": "vite", "build": "vite build", "preview": "vite preview" }
```
**No lint script exists** in `package.json` — nothing to run or summarize.

---

## 13. Vercel config

**`vercel.json`, quoted in full:**
```json
{
  "functions": {
    "api/dynamic-shell.js": {
      "includeFiles": "dist/index.html"
    }
  },
  "rewrites": [
    { "source": "/lookbook", "destination": "/api/dynamic-shell" },
    { "source": "/join", "destination": "/api/dynamic-shell" },
    { "source": "/lookbook/public/:lookbookId", "destination": "/api/dynamic-shell" },
    { "source": "/lookbook/piece/:pieceId", "destination": "/api/dynamic-shell" },
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/((?!assets/).*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" },
        { "key": "Vercel-CDN-Cache-Control", "value": "no-store" }
      ]
    }
  ]
}
```

**`api/dynamic-shell.js`, quoted in full:**
```js
// Dynamic shell — permanent CDN-staleness fix for customer-facing routes.
// Spec: docs/superpowers/specs/2026-09-19-lookbook-staleness-permanent-fix-design.md
//
// WHY THIS FILE EXISTS (read before touching):
// Vercel's CDN cannot be told to stop caching a STATIC file by any header
// tweak — confirmed live: even with Vercel-CDN-Cache-Control: no-store set
// on the static HTML route in vercel.json, the CDN kept returning
// `x-vercel-cache: HIT` with a climbing `Age` for 15+ minutes. Vercel's own
// docs: "Vercel doesn't allow bypassing the cache for static files by
// design." Headers on static files are simply not consulted by the
// static-file cache layer.
//
// The fix: serve certain customer-facing routes through an actual Vercel
// Function instead of the static index.html. A Function's OWN
// Cache-Control response header IS honored (unlike a static file's), so a
// real Node.js Function here can force no-store and guarantee every
// customer request gets the live index.html shell (which then loads the
// hashed JS/CSS bundles and fetches live Convex data client-side, same as
// before — this file changes ONLY how the HTML shell is served, nothing
// about the React app itself).
//
// Scope: rewired in vercel.json's rewrites (BEFORE the catch-all) for
// customer-facing dynamic routes only — /lookbook, /join,
// /lookbook/public/:id, /lookbook/piece/:id. Merchant routes (/login,
// /merchant/*) are explicitly OUT of scope — see the design doc — and keep
// the existing static-file + catch-all rewrite behavior untouched.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const INDEX_HTML_PATH = path.join(process.cwd(), 'dist', 'index.html');

let cachedHtml = null;

export default async function handler(req, res) {
  try {
    if (cachedHtml === null) {
      cachedHtml = await readFile(INDEX_HTML_PATH, 'utf-8');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(cachedHtml);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).send('Could not load the application shell. Please try again.');
  }
}
```

**Rewrite coverage confirmed:** `/lookbook`, `/join`, `/lookbook/public/:lookbookId`, `/lookbook/piece/:pieceId` are all present and route to `/api/dynamic-shell`. The catch-all `{ "source": "/(.*)", "destination": "/index.html" }` is the **last** entry in the `rewrites` array — Vercel matches top-to-bottom, so all 4 dynamic routes are matched before the catch-all is ever reached. Confirmed correct ordering.

---

## 14. Data hygiene (admin read only)

```
$ npx convex data users --limit 10000 --format jsonLines
```
98 total rows read, no modifications made.

| Metric | Count |
|---|---|
| Total rows | 98 |
| `role: "merchant"` | 3 |
| `role: "customer"` | 95 |

**Test/QA-looking customer names (case-insensitive prefix/substring match on `ZTEST`, `TEST`, `QA`, `CSV Test`, or containing "test"):**

| Prefix group | Count | Sample |
|---|---|---|
| `ZTEST*` | 3 | ZTEST NoConsent, ZTEST VVIP Consent, ZTEST NonVVIP Consent |
| `TEST*` / `Test*` | 13 | Test Consent Trace, Test Customer 999, Test 3Days Birthday, Test Today/Tomorrow Birthday, Test Onboarding Note, Test Bulk Import, Tester New A, Test Valid 1/27/53, Test Unique |
| `QA*` | 14 | QA Repro NeverVisited, QA CSV Client, QA Dual3, QA Anniv Only, QA Occasion Single/Dual (×5), QA Self Join, QA Walkthrough One, QA Loop Client, QA_msonxkdw, QA_msonp2bc |
| `CSV Test*` | 2 | CSV Test One, CSV Test Two |
| Other "test" substring | 15 | ZZTestStale Dropdown0922, ZZ Regression BdayTest, ZZ Regression ReviewTest, ZZZ QA Hydration Test, Award Test One, SOFTDELETE_TEST_Verify2/Temp/Temp2, Bell Test Customer, VVIP Test Customer, akash test, ayush test, shreya test, Deploy Test 7, New Test User |
| **Total test/QA rows** | **47 of 95 customers (~49%)** | |

No modification made to any row.

---

## 15. Open items (deduplicated, from ledger + specs, quoted where the text drove the classification)

**Blocker for merge:**
- None found. (Critical #1/#2 are pre-existing on `main` — see verdict — accepted risk, not a blocker specific to merging this branch, since main already carries them today.)

**Before client delivery:**
- **Critical #1 & #2** — magic-link takeover + `createCustomer` leak — "**Both vulnerabilities remain OPEN** as of this document and need their own properly-tested fix in a future task" (`2026-09-05-rate-limiting-design.md:16`).
- **Forgot-password incomplete** — no `resetPassword` mutation consumes the token yet (per CLAUDE.md REMAINING §2, confirmed no such export in `convex/auth.ts`).
- **Soft-delete does not revoke magic-link access** — "**Known gap, explicitly not closed by this decision:** this is not yet full DPDP 'right to erasure'... Before this feature can be called Gate-8/DPDP-complete, `validateMagicToken` must additionally check `is_deleted` and refuse." (`2026-09-14-customer-soft-delete-design.md:128`) — confirmed still true, no `is_deleted` reference anywhere in `convex/auth.ts`.
- **Test/QA data cleanup** — 47 of 95 customer rows are test data (§14) — should be cleaned before a real client-facing demo of the CRM list.
- **Two untracked spec files** (`2026-09-14-templates-ai-draft-design.md`, `2026-09-15-merchant-hydration-fix-design.md`) referenced by ledger entries but never committed — should be `git add`-ed so the ledger's spec references resolve for future readers.
- **Vercel CDN caching fix, 2nd attempt marked "UNVERIFIED"** in its own ledger entry title (09-17) before the 09-19 "permanent fix" superseded it — confirm the 09-19 fix is what's actually live/tested, not the unverified intermediate one.

**Later:**
- **WhatsApp Cloud API env vars unset** (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`) — blocks `sendAllUpcomingOccasionMessages`/`dispatchEvent`'s actual Cloud API path (both are otherwise fully wired and consent-safe).
- **D-17 Meta template decision** — "decided, not yet built... blocked on Meta template approval, not a code task yet" (CLAUDE.md REMAINING). Two send paths (Events Dispatch, bulk occasion send) depend on it.
- **Cart/likes intelligence deferred (Option B)** — "deferred building a durable `cart_items` table until a feature... needs it" (`2026-09-07-customer-activity-intelligence-design.md:183`).
- **`getEventAccess` unguarded customerId** and **`trackActivity` unguarded customerId** (§5) — low-severity, explicitly-accepted-pattern findings worth their own tickets.
- **Unbounded `.collect()` reads** remain in `getReviews`/`getLookbooks` per CLAUDE.md REMAINING (customers/orders already got indexed/paginated variants on this branch, per §4's Phase-0 entries — but the plain `getCustomers`/`getOrders`/`getReviews` full-collect versions are still live alongside the new paginated ones).
- **`npm audit` items needing breaking major-version bumps** (vite, react-router-dom) — out of scope for this branch, pre-existing.
- **External audit items still open**: CORS reflecting any Origin with credentials, customer-enumeration oracle, missing security headers (CSP/XFO/nosniff/Referrer-Policy), tokens in plain `localStorage` (not HttpOnly) — none touched by this branch, all pre-existing per CLAUDE.md REMAINING.

---

## Report file & final git state

**Report written to:** `docs/qa-reports/2026-09-23-pre-merge-audit.md` (this file — untracked, not committed, per instruction).

```
$ git status --short
?? .claude/.headroom_wrap_settings.lock
?? .playwright-mcp/
?? .serena/
?? ARCHITECTURE_CX.html
?? FRONTEND_FULL_SOURCE.html
?? "Final LoyaltyOS_CX_Full_Feature_Document.html"
?? "Final LoyaltyOS_Full_Architecture.html"
?? LoyaltyOS_CX_Full_Feature_Document.html
?? MASTER_PLAN.html
?? "MIRARI LOOKBOOK1.pdf"
?? PROJECT_UNDERSTANDING.md
?? docs/architecture-and-memory.html
?? docs/birthday-anniversary-full-architecture.html
?? docs/complete-branch-summary-2026-09-09.html
?? docs/full-system-audit-2026-09-04.html
?? docs/project-documentation-index.html
?? docs/qa-reports/2026-09-11-full-qa-report.zip
?? docs/qa-reports/2026-09-11-full-qa-report/
?? docs/qa-reports/2026-09-23-pre-merge-audit.md   <-- NEW (this report)
?? docs/superpowers/reports/2026-08-31-scalability-audit-300-to-1000.html
?? docs/superpowers/specs/2026-09-14-templates-ai-draft-design.md
?? docs/superpowers/specs/2026-09-15-merchant-hydration-fix-design.md
?? qa-screenshots-2026-09-11/
?? whatsapp-feature-summary.html

$ git stash list
(empty)
```
Identical to the step-2 baseline plus exactly one new untracked file (this report). No other file was touched. Branch remains `feat/ai-automation-gemini-phase`, HEAD unchanged at `e0cf851`. Stash list empty, matching the pre-audit state.
