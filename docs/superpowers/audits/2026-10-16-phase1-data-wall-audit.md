LoyaltyOS Multi-Boutique Phase 1 (Data Wall) Build Audit
Date: 2026-10-16
Status: read-only, no app changes (revision 2 — closes the 30 gaps found in
review of revision 1: no file other than this audit changed in this revision)
Branch: feat/multi-boutique-phase1
Source spec: docs/superpowers/specs/2026-10-16-multi-boutique-design.md
Source audit: docs/superpowers/audits/2026-10-15-multi-boutique-audit.md
Backend read for row counts only: none. All row counts below are copied from
docs/superpowers/audits/2026-10-15-multi-boutique-audit.md section 1 (captured
2026-10-15 against pleasant-cobra-560). The live backend was not read for this
audit; aware-rabbit-290 was not read in this revision at all — zero convex
commands were run (see section 14 item 30 confirmation).

1. INDEXES

1.1 users (convex/schema.ts:31-130), row count 107 (per Phase 0a audit).
Current indexes (schema.ts:95-130):
- by_mobile (schema.ts:95) ["mobile"] — used by findCustomerByMobile
  (customers.ts:947), checkMobilesStatus (customers.ts:1393), createCustomer's
  dup-mobile check (customers.ts:976 area), bulkCreateCustomers (customers.ts:1237).
  Replaced by by_boutique_mobile ["boutique_id","mobile"] (spec 3.4) — mobile
  uniqueness becomes per boutique.
- by_email (schema.ts:96) ["email"] — used by merchantLogin (auth.ts:113),
  findMerchantByEmail (auth.ts:400), forgotPassword (auth.ts:469). STAYS GLOBAL
  per spec 3.4 — merchant emails are unique across all boutiques, not per boutique.
- by_magic_token (schema.ts:97) ["magic_token"] — used by validateMagicToken
  (auth.ts:364), getCustomerCatalogue (lookbooks.ts:213). STAYS GLOBAL per spec
  3.4 — tokens are random/unique and the boutique is read from the row.
- by_tier (schema.ts:98) ["tier"] — used by campaign audience segmentation
  (no direct withIndex call found in the 121-function grep; likely read via
  in-memory filter today — see section 9). Replaced by
  by_boutique_tier ["boutique_id","tier"].
- by_role_name_lower (schema.ts:106) ["role","name_lower"] — used by getCustomers
  (customers.ts:376-ish, full collect today per Phase 0a audit section 9),
  getCustomersPaginated (customers.ts:412), platformStats.ts's customer loop.
  Replaced by by_boutique_role_name_lower ["boutique_id","role","name_lower"].
- by_role_birthday_md (schema.ts:111) ["role","birthday_md"] — used by
  getUpcomingBirthdays (customers.ts:564), findUpcomingInternal (customers.ts:624).
  Replaced by by_boutique_role_birthday_md ["boutique_id","role","birthday_md"].
- by_role_anniversary_md (schema.ts:112) ["role","anniversary_md"] — used by
  getUpcomingAnniversaries (customers.ts:584), findUpcomingInternal (customers.ts:624).
  Replaced by by_boutique_role_anniversary_md ["boutique_id","role","anniversary_md"].
- by_role_consent_vvip (schema.ts:130) ["role","whatsapp_consent","vvip"] — used
  by getDispatchRecipientsInternal (events.ts:299), sendAllUpcomingOccasionMessages
  (whatsapp.ts:404). Replaced by
  by_boutique_role_consent_vvip ["boutique_id","role","whatsapp_consent","vvip"].
INDEX COUNT CHECK (item 11): users has 8 indexes today. After Step A it gains
by_boutique_mobile, by_boutique_tier, by_boutique_role_name_lower,
by_boutique_role_birthday_md, by_boutique_role_anniversary_md,
by_boutique_role_consent_vvip (6 new) ALONGSIDE the 8 old ones (Step A is
additive, old indexes are not dropped until Step C) = 14 indexes at peak,
dropping back to 8 (2 global + 6 new boutique-scoped) after Step C removes the
6 old ones. 14 is well under Convex's per-table index limit of 32. Because
users already has 107 live rows, Convex must build each of the 6 new indexes
over those 107 rows at deploy time — not instant, but trivial at this row
count; this becomes a real wait only once a boutique has a much larger
customers table.

1.2 lookbooks (convex/schema.ts:133-161), row count 32.
Current indexes: NONE. defineTable at schema.ts:133 has no .index(...) chained
(ends with ",)" at schema.ts:161) — every read is a full .collect() today
(getLookbooks, getLookbooksForSelector, getLookbookById, getCustomerCatalogue,
getOrCreateHomeLookbook all .collect() the whole table — see sections 3 and 9).
Needs: boutique_id field + .index("by_boutique",["boutique_id"]) as the new
baseline index, replacing every full-table .collect() in section 3/9.
INDEX COUNT CHECK: 0 today -> 1 after Step A (only by_boutique is ever added;
there was nothing to replace) -> 1 after Step C. Well under 32.

1.3 catalogue_items (convex/schema.ts:164-190), row count 42.
Current index: by_lookbook (schema.ts:190) ["lookbook_id"] — used by
getCustomerCatalogue's per-lookbook item loop (lookbooks.ts:248-251). Stays as
a secondary index (lookbook_id already implies one boutique transitively via
the parent lookbook), but boutique_id is ALSO stamped directly on this table
(spec 3.3) with a new by_boutique index, so getCustomerCatalogue and any future
cross-lookbook item listing can read by boutique_id directly without a join.
INDEX COUNT CHECK: 1 today -> 2 after Step A (by_lookbook kept, by_boutique
added; by_lookbook is never dropped since it has no boutique prefix and is
still needed for the parent-lookbook join) -> 2 after Step C. Well under 32.

1.4 orders (convex/schema.ts:193-209), row count 16.
Current indexes: by_user (schema.ts:203) ["user_id"] — used by getOrdersByUser
(orders.ts:118). by_created_at (schema.ts:209) ["created_at"] — used by
getTodayOrders (orders.ts:151), getTodaySummary (orders.ts:160).
Replaced by by_boutique_user ["boutique_id","user_id"] and
by_boutique_created_at ["boutique_id","created_at"].
INDEX COUNT CHECK: 2 today -> 4 after Step A -> 2 after Step C. Well under 32.

1.5 campaigns (convex/schema.ts:212-224), row count 0 (per Phase 0a audit).
Current indexes: NONE. Needs boutique_id + .index("by_boutique",["boutique_id"]).
Zero live rows means this is the cheapest table to backfill (nothing to backfill).
INDEX COUNT CHECK: 0 today -> 1 after Step A -> 1 after Step C. Well under 32.

1.6 settings (convex/schema.ts:234-239), row count 4.
Current index: by_key (schema.ts:239) ["key"] — used by getSettingsDoc (helper,
settings.ts, called from every settings.ts function) and getSettings
(settings.ts:486). Replaced by by_boutique_key ["boutique_id","key"] (spec 3.4
and spec 6) — settings becomes one document per boutique per key, so the 4
existing rows become 4 rows under the 85 Lansdowne boutique_id, and a new
boutique starts with 0 settings rows (defaults used until first write, per
spec 6).
INDEX COUNT CHECK: 1 today -> 2 after Step A -> 1 after Step C. Well under 32.

1.7 reviews (convex/schema.ts:242-253), row count 75.
Current indexes: by_user (schema.ts:252) ["user_id"] — used by (no direct
withIndex found for by_user outside getOrdersByUser-style patterns; reviews
per-customer reads go through getCustomerById's related calls or
getCustomerIntelligenceProfile, customers.ts:1474). by_status (schema.ts:253)
["status"] — used by getPendingReviews (reviews.ts:219), getReviews
(reviews.ts:237), platformStats.ts's approved-reviews read.
Replaced by by_boutique_user ["boutique_id","user_id"] and
by_boutique_status ["boutique_id","status"].
INDEX COUNT CHECK: 2 today -> 4 after Step A -> 2 after Step C. Well under 32.

1.8 message_actions (convex/schema.ts:283-293), row count 33.
Current index: by_customer_occasion_date (schema.ts:293)
["customer_id","occasion","occasion_date"] — used by getUpcomingBirthdays/
getUpcomingAnniversaries's exclusion check (customers.ts:564,584).
Replaced by by_boutique_customer_occasion_date
["boutique_id","customer_id","occasion","occasion_date"] (boutique_id first so
a boutique-wide dedup sweep is also possible later without a table scan).
INDEX COUNT CHECK: 1 today -> 2 after Step A -> 1 after Step C. Well under 32.

1.9 points_ledger (convex/schema.ts:313-330), row count 69.
Current index: by_customer (schema.ts:330) ["customer_id"] — used by
getPointsHistory (customers.ts:894), getDashboardSummary's ledger sum
(dashboard.ts:38, currently a full .collect() — see section 9),
computeStats's ledger sum (platformStats.ts:35, also a full .collect()).
Replaced by by_boutique_customer ["boutique_id","customer_id"] for the
per-customer read, plus boutique_id alone (via the new by_boutique_customer
prefix) lets the Delight Desk / Platform Admin sums become a boutique-scoped
range read instead of a whole-table scan.
INDEX COUNT CHECK: 1 today -> 2 after Step A -> 1 after Step C. Well under 32.

1.10 ai_message_drafts (convex/schema.ts:349-361), row count 33.
Current index: by_customer_occasion_date (schema.ts:361)
["customer_id","occasion","occasion_date"] — used by hasExistingDraft
(crons.ts:119), getCachedDraftTextInternal (crons.ts:155), getDraftForCustomer
(customers.ts:1569), overwriteCachedDraft (ai.ts:539).
Replaced by by_boutique_customer_occasion_date
["boutique_id","customer_id","occasion","occasion_date"].
INDEX COUNT CHECK: 1 today -> 2 after Step A -> 1 after Step C. Well under 32.

1.11 events (convex/schema.ts:380-394), row count 14.
Current index: by_event_datetime (schema.ts:394) ["event_datetime"] — used by
getEvents (events.ts:108), getEventForDispatchInternal (events.ts:425).
Replaced by by_boutique_event_datetime ["boutique_id","event_datetime"].
INDEX COUNT CHECK: 1 today -> 2 after Step A -> 1 after Step C. Well under 32.

1.12 notifications (convex/schema.ts:422-439), row count 36.
Current indexes: by_customer_occasion_date (schema.ts:433) — used by
hasExistingNotification (crons.ts:331). by_seen (schema.ts:436) ["seen"] —
used by getNotifications' unseen-count (notifications.ts:38). by_created_at
(schema.ts:439) ["created_at"] — used by deleteExpiredNotifications
(crons.ts:385).
Replaced by by_boutique_customer_occasion_date
["boutique_id","customer_id","occasion","occasion_date"],
by_boutique_seen ["boutique_id","seen"], and
by_boutique_created_at ["boutique_id","created_at"] (expiry sweep can stay a
global range scan since it only ever deletes, never leaks data across
boutiques, but a boutique-prefixed version avoids one boutique's huge
notification volume slowing another's unseen-count read).
INDEX COUNT CHECK: 3 today -> 6 after Step A -> 3 after Step C. Well under 32.

1.13 customer_activity_events (convex/schema.ts:458-480), row count 354 (the
largest table by row count).
Current indexes: by_customer_created_at (schema.ts:475)
["customer_id","created_at"] — used by a future per-customer summary read
(getPurchaseSummaryInternal/getRecentActivityCountsInternal, ai.ts:810,766,
read orders/activity by customer). by_created_at (schema.ts:480)
["created_at"] — used by getRecentActivityCustomerIdsInternal (crons.ts:520),
the weekly most-active scan.
Replaced by by_boutique_customer_created_at
["boutique_id","customer_id","created_at"] and
by_boutique_created_at ["boutique_id","created_at"] — this table's row count
(354) and its global by_created_at scan (crons.ts:520, a weekly cron) make it
the highest-priority table to re-index, since an un-scoped weekly cron over
this table will scan every boutique's 7 days of activity today.
INDEX COUNT CHECK: 2 today -> 4 after Step A -> 2 after Step C. Well under 32.
This table's 354 rows also make it the slowest Step-A index build of the 14 —
still seconds, not minutes, at this row count, but the first table where a
future large boutique's version of this same build step would need watching.

1.14 customer_activity_summaries (convex/schema.ts:505-514), row count 38.
Current index: by_customer (schema.ts:514) ["customer_id"] — used by
upsertActivitySummary (ai.ts:913), getCachedActivitySummaryInternal (ai.ts:1037).
Replaced by by_boutique_customer ["boutique_id","customer_id"].
INDEX COUNT CHECK: 1 today -> 2 after Step A -> 1 after Step C. Well under 32.

1.15 New table boutiques (spec 3.1), exactly as approved:
Fields: name (string), slug (string, unique), logo_storage_id (optional),
status ("active"|"suspended"), is_default (boolean), one_device_lock (boolean,
default true), flags (record string->boolean), custom_domain (optional string,
unused this build), created_at, updated_at (numbers).
Indexes: by_slug (slug), by_default (is_default).
INDEX COUNT CHECK: 0 rows at creation, 2 indexes, trivially under 32.

1.16 New table boutique_secrets (spec 3.2), exactly as approved:
Fields: boutique_id, whatsapp_access_token, whatsapp_phone_number_id.
Index: by_boutique (boutique_id). Read only by internal functions; no query or
mutation ever returns these fields to a client (same posture whatsapp.ts
already has for process.env.WHATSAPP_ACCESS_TOKEN today — never returned,
only read server-side at whatsapp.ts:166,172,247,253,586,590).
INDEX COUNT CHECK: 0 rows at creation, 1 index, trivially under 32.

Summary: every one of the 14 existing tables plus the 2 new tables stays
far under Convex's 32-index-per-table limit even at Step A's peak (old+new
indexes coexisting). The only real-world cost of Step A is a one-time index
build proportional to each table's current row count — largest at
customer_activity_events (354 rows) and users (107 rows), both still trivial
today.

2. INSERT, PATCH AND REPLACE SITES

Total from grep -c "ctx\.db\.insert\|ctx\.db\.patch\|ctx\.db\.replace" convex/*.ts
(excluding convex/_generated/*): 50. No ctx.db.replace call exists anywhere —
every write is insert or patch. Per-file counts: activity.ts 1, ai.ts 4,
auth.ts 5, crons.ts 2, customers.ts 19, events.ts 2, lookbooks.ts 8,
notifications.ts 1, orders.ts 2, reviews.ts 4, settings.ts 2. Sum = 50, matches.

activity.ts:61 insert customer_activity_events, fn trackActivity(47) —
boutique_id from: the customer row the (to-be-added) magic token resolves to
(spec 4.3's trackActivity fix).

ai.ts:559 patch ai_message_drafts, ai.ts:564 insert ai_message_drafts, fn
overwriteCachedDraft(539, internalMutation) — boutique_id from: the caller
(a cron/internal action) passes it through explicitly, since this is an
internal-only function (spec 5's "internal and cron functions through an
explicit boutique_id argument").
ai.ts:925 patch customer_activity_summaries, ai.ts:930 insert
customer_activity_summaries, fn upsertActivitySummary(913, internalMutation) —
boutique_id from: explicit internal argument, same as above.

auth.ts:156 patch users, fn merchantLogin(113) — no new boutique_id needed on
this patch (it only stamps session_token/session_last_seen on the merchant's
own existing row; the row's boutique_id is already set at creation time, not
written here).
auth.ts:183 patch users, fn merchantLogout(175) — same, no boutique_id write.
auth.ts:211 patch users, fn merchantHeartbeat(202) — same, no boutique_id write.
auth.ts:233 patch users, inside issueMagicToken (shared helper, auth.ts
~lines 215-247, called by generateMagicTokenSelf:258,
generateMagicTokenForCustomer:304, generateMagicToken:327) — no boutique_id
write (only sets magic_token/magic_token_created_at on an existing row whose
boutique_id was already set at creation).
auth.ts:423 patch users, fn saveResetToken(416) — no boutique_id write.

crons.ts:196 insert ai_message_drafts, fn insertDraft(188, internalMutation) —
boutique_id from: explicit internal argument passed down from
generateDailyDrafts(239), which per section 10 must loop over boutiques and
pass boutique_id into each per-boutique call.
crons.ts:368 insert notifications, fn insertNotification(358,
internalMutation) — boutique_id from: explicit internal argument, same
per-boutique-loop pattern from generateDailyNotifications(416).

customers.ts:476 patch users, fn updateMeasurements(458) — no boutique_id
write (patches an existing row the caller already owns; ownership check per
spec 4.4 happens before the patch, not a write to boutique_id itself).
customers.ts:501 patch users, fn addStaffNote(485) — same, no boutique_id write.
customers.ts:519 patch users, fn updateCustomTags(507) — same.
customers.ts:558 patch users, fn updateCustomerProfile(525) — same.
customers.ts:740 insert message_actions, fn recordMessageAction(713) —
boutique_id from: the merchant session (spec 4.1), since recordMessageAction
is an MS-guarded mutation.
customers.ts:792 patch users (points), customers.ts:794 insert points_ledger —
same function recordMessageAction(713), a conditional points-award branch
inside it — boutique_id from: the merchant session.
customers.ts:840 awardPoints(840) — customers.ts:861 patch users (points),
customers.ts:863 insert points_ledger — boutique_id from: the merchant session.
customers.ts:1048,1053,1060 patch users (existing._id, dedup-reactivation
branch), customers.ts:1072 insert users — fn createCustomer(976) — boutique_id
from: the merchant session when called from the CRM, OR the resolved slug/
default boutique when called from the public /join path (spec 4.3's slug
resolution; createCustomer's existing conditional-guard shape at
customers.ts:1003 must not be widened per spec 5 — the boutique resolution is
added alongside the existing guard check, not instead of it).
customers.ts:1129 patch users (is_deleted), fn deleteCustomer(1114) — no
boutique_id write (ownership check happens first).
customers.ts:1180 patch users (is_deleted, loop), fn bulkDeleteCustomers(1154)
— no boutique_id write, ownership check per id in the loop.
customers.ts:1301,1305,1309 patch users (existing._id, dedup-reactivation
branch), customers.ts:1334 insert users — fn bulkCreateCustomers(1237) —
boutique_id from: the merchant session (CSV import is always merchant-only,
MS-guarded).

events.ts:84 insert events, fn createEvent(71) — boutique_id from: the
merchant session.
events.ts:329 patch events (status), fn markEventDispatchedInternal(326,
internalMutation) — boutique_id not written here (patches an existing row;
boutique_id was set at createEvent time).

lookbooks.ts:91 insert lookbooks, inside getOrCreateHomeLookbook (shared
helper, lookbooks.ts:83-98, called by addCatalogueItem(374) and other mutations
that need a default "Current catalogue" lookbook) — boutique_id from: the
merchant session of the caller that triggered the helper (the helper itself
must take boutique_id as a parameter once multi-boutique exists, since it is
not itself a guarded entry point).
lookbooks.ts:307 insert lookbooks, fn createLookbook(294) — boutique_id from:
the merchant session.
lookbooks.ts:332 patch lookbooks, fn updateLookbook(316) — no boutique_id
write, ownership check first.
lookbooks.ts:366 patch catalogue_items, lookbooks.ts:368 patch lookbooks, fn
deleteLookbook(345) — no boutique_id write, ownership check first.
lookbooks.ts:409 insert catalogue_items, fn addCatalogueItem(374) — boutique_id
from: the parent lookbook record (stamped to match lookbook_id's boutique,
same pattern spec 4.3 calls "parent record").
lookbooks.ts:439 patch catalogue_items, fn updateCatalogueItem(414) — no
boutique_id write, ownership check first.
lookbooks.ts:472 insert lookbooks, fn createPdfLookbook(466, internalMutation)
— boutique_id from: explicit internal argument (called by generatePdfUploadUrl's
caller chain, which itself runs through checkMerchantSession(499), so the
boutique is known from the merchant session one level up).

notifications.ts:68 patch notifications (seen, loop), fn markAllSeen(58) — no
boutique_id write, ownership/boutique-scope filter happens on the read before
the patch loop.

orders.ts:84 patch users (points), orders.ts:87 insert orders, fn
createOrder(31) — boutique_id from: the merchant session (createOrder is
MS-guarded).

reviews.ts:97 insert reviews, fn createReview(51) — boutique_id from: the
reviewing customer's own row (createReview is PUB/rate-limited, called by a
customer's own magic-link session, same resolution pattern as trackActivity).
reviews.ts:177 patch users (points), reviews.ts:180 patch reviews (status), fn
approveReview(113) — no boutique_id write (patches existing rows; ownership
check first).
reviews.ts:204 patch reviews (status), fn declineReview(195) — same, no write.

settings.ts:425 patch settings, settings.ts:431 insert settings, inside
upsertSettings (shared helper, settings.ts ~405-440, called by
updateSettings(496), updateTemplate(530), setTemplateCardUrl(584),
setWhatsAppTemplate(636), clearWhatsAppTemplate(678),
setWhatsAppTemplateConfig(736), resetSettings(765) — all 7 settings-writing
functions funnel through this one helper) — boutique_id from: the merchant
session, passed into upsertSettings as a new parameter alongside the existing
key parameter (so by_boutique_key can look up/patch the right boutique's row).

3. READ SITES

Total from grep -c "ctx\.db\.get(\|ctx\.db\.query(\|\.withIndex(" convex/*.ts:
110 raw matches, of which ONE (convex/schema.ts:206) is a code comment
mentioning ".withIndex(...)" in prose, not real code — real total is 109.
Per-file real counts: ai.ts 9, auth.ts 9, crons.ts 7, customers.ts 19,
dashboard.ts 8, events.ts 9, lookbooks.ts 15, notifications.ts 2, orders.ts 7,
platformStats.ts 13, reviews.ts 8, settings.ts 3. Sum = 109, matches
(schema.ts's 1 comment match is excluded).

Full-table .collect()-without-.withIndex() or .filter()-without-.withIndex()
scans found (spec 5's "no .collect() or .filter() over a whole table" target
list), each needing a boutique-scoped .withIndex() instead:
- getCustomers (customers.ts, full users .collect() per Phase 0a audit section
  9) — needs by_boutique_role_name_lower.
- getCustomerCatalogue (lookbooks.ts:230, lookbooks.query("lookbooks").collect())
  — needs by_boutique on lookbooks; this is the Phase 0 audit's #1 leak (section
  6 below).
- getOrCreateHomeLookbook (lookbooks.ts:84, lookbooks.query("lookbooks").collect())
  — same whole-lookbooks-table scan as getCustomerCatalogue, just to find one
  "catalogue"-kind row; needs by_boutique on lookbooks plus a kind filter.
- getLookbooks / getLookbooksForSelector (lookbooks.ts, full lookbooks
  .collect(), no index exists on lookbooks today per section 1.2) — needs
  by_boutique.
- dashboard.ts:38 getDashboardSummary — points_ledger.query().collect() (all
  boutiques' ledger rows), orders.query().collect() (all boutiques' orders),
  reviews.query("by_status","approved").collect() then no further filter
  (all boutiques' approved reviews) — needs by_boutique_customer /
  by_boutique_created_at / by_boutique_status respectively.
- platformStats.ts:35 computeStats — same three whole-table reads as
  dashboard.ts plus users.collect()-equivalent for the customer count; this
  function is the spec 5 exception (aggregates across ALL boutiques by
  design, grouped per spec 9) so it does NOT get a single boutique_id filter —
  it loops per boutique instead.
- findUpcomingInternal (customers.ts:624) reads users by_role_birthday_md /
  by_role_anniversary_md with NO boutique filter today — needs
  by_boutique_role_birthday_md / by_boutique_role_anniversary_md.

Id-based reads needing the spec 4.4 ownership check (loads one record by its
_id and must assert boutique_id matches the caller's boutique before use):
- getCustomerById (customers.ts:444) — customer by id.
- updateMeasurements/addStaffNote/updateCustomTags/updateCustomerProfile
  (customers.ts:458,485,507,525) — customer by id (ctx.db.get before patch).
- awardPoints, recordMessageAction (customers.ts:840,713) — customer by id.
- deleteCustomer (customers.ts:1114), bulkDeleteCustomers (customers.ts:1154,
  per id in its loop) — customer by id.
- getPointsHistory, getDraftForCustomer, getCustomerIntelligenceProfile
  (customers.ts:894,1569,1474) — customer by id.
- getOrdersByUser (orders.ts:118) — user id (not the order's own id, but the
  target customer's id — same ownership question).
- updateLookbook, deleteLookbook (lookbooks.ts:316,345) — lookbook by id.
- updateCatalogueItem, deleteCatalogueItem (lookbooks.ts:414,444) — catalogue
  item by id (and transitively its parent lookbook).
- getLookbookById, getCatalogueItemById (lookbooks.ts:154,278) — PUBLIC reads
  by id; per spec 4.3 these need the ownership check too (return nothing if
  the record's boutique doesn't match the resolved public boutique).
- getEventAccess, deleteEvent, markEventDispatchedInternal,
  getEventForDispatchInternal (events.ts:493,122,326,425) — event by id.
- approveReview, declineReview (reviews.ts:113,195) — review by id (and its
  linked user_id).
- getSettings, getTemplateCardUrls (settings.ts:486,565) — PUBLIC reads keyed
  by `key` only today, not by id, but per spec 4.3 need a boutique resolution
  argument added since there is no id to anchor on yet.
- markAllSeen, deleteNotification (notifications.ts:58,80) — notification(s)
  by id/by customer.
- getDraftForCustomer (customers.ts:1569) — already listed above (customer id).

4. FUNCTION CHANGE LIST

Confirmed total: npx convex function-spec in this NEW folder (aware-rabbit-290)
returned 121 functions when last run during revision 1 of this audit
(2026-10-16, before this revision), matching the Phase 0a audit's count
exactly. No convex command was run during this revision (see section 14 item
30) — this count is carried forward unchanged, since no code changed. Below,
"ARGS+" marks a function whose argument shape changes; "OWN" marks the spec
4.4 ownership check is needed; "FE" marks a required src/ call-site change
(file:line given in section 5, not repeated here); boutiqueId source is
abbreviated SESSION (merchant session), TOKEN (customer magic-token row),
SLUG (resolved public slug), PARENT (parent record), INTERNAL (explicit
argument from an internal/cron caller), or N/A (helper takes no new field,
see section 2 entries for the handful of patch-only functions that write no
boutique_id).

SESSION HELPER SHAPE (item 12). requireMerchantSession (convex/auth.ts:92-105)
takes (ctx, userId, token) and returns the FULL merchant UserDoc (ctx.db.get's
result unchanged — see auth.ts:97-104: it loads the row, checks role/token/
expiry, and returns `user` as-is, with no field selection). Because
boutique_id will simply be a field ON that same UserDoc once the schema has
it, requireMerchantSession's call signature and return TYPE do not change at
all — every caller that does `const merchant = await
requireMerchantSession(ctx, userId, token)` and then reads `merchant.xyz`
keeps working byte-for-byte; callers that want the boutique just read
`merchant.boutique_id` off the same object, no new destructuring pattern
required. Current caller count: `grep -o 'await requireMerchantSession(ctx'
convex/*.ts | wc -l` = 62 (baseline, unchanged by this revision since no code
was touched). EVERY batch's test in section 10 below now includes re-running
this exact grep and confirming it is still exactly 62 — a function count that
drops below 62 would mean a caller was accidentally deleted or a guard was
accidentally removed, which must never happen in Phase 1 (spec 5: "the guard
must not be widened" applies equally to "must not be removed").

MOBILE UNIQUENESS SITES (item 13). Every place that checks for a duplicate
mobile, each needing to switch from the global by_mobile index to
by_boutique_mobile, scoped to the resolved boutique:
- customers.ts:1031 createCustomer's dup check (`.withIndex("by_mobile", (q)
  => q.eq("mobile", normalized))`) — batch 6 (customers.ts scoping).
- customers.ts:955 findCustomerByMobile — batch 6.
- customers.ts:1288 bulkCreateCustomers's per-row dup check — batch 6.
- customers.ts:1428 checkMobilesStatus's per-row lookup — batch 6.
- auth.ts:289 generateMagicTokenSelf's mobile lookup — batch 4 (auth.ts
  scoping).
- auth.ts:348 generateMagicToken's (deprecated alias) mobile lookup — batch 4.
All six sites must resolve the SAME boutique_id (from the slug for the public
auth.ts paths, from the merchant session for the customers.ts paths) before
querying by_boutique_mobile, so "duplicate" means "duplicate within that one
boutique," matching spec 3.4's "the same person can be a customer of two
boutiques."

MERCHANT EMAIL UNIQUENESS (item 14). Merchant users are looked up by email at:
auth.ts:113 (merchantLogin, `.withIndex("by_email", ...)`), auth.ts:400
(findMerchantByEmail), auth.ts:469 (forgotPassword). All three stay on the
GLOBAL by_email index per spec 3.4 ("Merchant emails must be unique across
all boutiques") — none of these three functions switch to a boutique-scoped
index; this is confirmed in section 1.1 above and repeated here because it is
the one users-table lookup that does NOT get a by_boutique_* replacement.

RATE LIMITER KEYS (item 15). convex/rateLimits.ts defines three named limiters
via @convex-dev/rate-limiter:
- magicTokenByMobile (rateLimits.ts:26) — called at auth.ts:282
  (`rateLimiter.limit(ctx, "magicTokenByMobile", { key: digits })`, inside
  generateMagicTokenSelf) and auth.ts:341 (same call, inside
  generateMagicToken). Key is the raw mobile digits, with NO boutique in the
  key today. RISK: once two boutiques can share the same customer mobile
  number (spec 3.4), one boutique's customer hitting this limit would also
  block a DIFFERENT boutique's customer who happens to share the same mobile
  digits (e.g. a wrong-number test, or the same real person signing up at
  both boutiques in quick succession) — their rate-limit buckets would
  incorrectly share state. FIX: the key must become
  `${boutiqueId}:${digits}` once the boutique is resolved, so each boutique's
  mobile-rate-limit bucket is independent. Batch: 4 (auth.ts scoping).
- createCustomerByMobile (rateLimits.ts:35) — called at customers.ts:1021
  (`rateLimiter.limit(ctx, "createCustomerByMobile", { key: normalized })`,
  inside createCustomer). Same risk and same fix (key becomes
  `${boutiqueId}:${normalized}`). Batch: 6 (customers.ts scoping).
- createReviewByUser (rateLimits.ts:43) — called at reviews.ts:72
  (`rateLimiter.limit(ctx, "createReviewByUser", { key: String(args.user_id) })`).
  Key is already a Convex user _id, which is globally unique across every
  boutique by construction (no two users, in any boutique, ever share an
  _id) — NO boutique change needed here; flagged only to confirm it is
  already safe, not a gap.

ONE-DEVICE LOCK UNCHANGED (item 16). Phase 1 does not touch
convex/sessionLock.ts (86 lines, confirmed unread/unchanged this revision) or
the `process.env.ONE_DEVICE_LOCK` read at auth.ts:150 inside merchantLogin —
the per-boutique lock (spec D5, moving the switch onto the boutiques row) is
explicitly Phase 2 work, not Phase 1. Batch 4 (auth.ts scoping)'s test gains
an explicit regression check: after batch 4 ships, merchantLogin's one-device
refusal behaviour (a second device's login attempt while a live session
exists, with ONE_DEVICE_LOCK="on") must produce the exact same `{ locked:
true }` result it does today, proving the scoping changes elsewhere in
auth.ts did not disturb sessionLock.ts's logic path.

PUBLIC FUNCTIONS WITHOUT CONTEXT IN PHASE 1 (item 17). In Phase 1 (before
Phase 2 adds slugs to every public link), these public functions receive no
slug and no token, and must resolve to the DEFAULT boutique (85 Lansdowne) so
behaviour is unchanged for the live app:
- getSettings (settings.ts:486) and getTemplateCardUrls (settings.ts:565) —
  called from a context with no slug/token (e.g. before any login) — batch 9
  (settings.ts scoping).
- generateMagicTokenSelf (auth.ts:258) and generateMagicToken (auth.ts:327) —
  the slug-less /join path per spec D1 — batch 4 (auth.ts scoping).
- AccessDenied (src/pages/AccessDenied.jsx, a static page with no Convex call
  of its own) and the /login page (src/pages/Login.jsx) — these are frontend
  pages, not Convex functions; they show the default boutique's branding
  (deferred to Phase 3 per spec 7, not a Phase 1 item, listed here only for
  completeness since the task asked for "each such function" and these are
  the two page-level equivalents).

PAGINATION CURSOR BEHAVIOUR (item 25). getCustomersPaginated (customers.ts:412)
is the only paginated query among the 121 functions (grep of "paginate\(" /
".paginate(" across convex/ confirms this; no other function uses Convex's
pagination helper). Switching its index from by_role_name_lower to
by_boutique_role_name_lower keeps the exact same trailing sort field
(name_lower) and the exact same equality-prefix pattern (role, now preceded
by boutique_id) — Convex's cursor is an opaque position marker tied to the
index's sort order, and since the NEW index's sort order (name_lower, within
a boutique+role partition) is identical to the OLD index's sort order (within
a role partition) restricted to one boutique's rows, a cursor obtained before
the switch is not expected to need translation — the CALLER (CRM paging UI)
is unaffected, since it only ever holds a cursor opaque to itself; this
requires an explicit regression test in batch 6 (customers.ts scoping): page
through all of 85 Lansdowne's seeded customers with getCustomersPaginated
before and after the switch and confirm the same customers come back in the
same order across the same number of pages.

--- auth.ts (10)
findMerchantByEmail auth.ts:400 internalQuery INT -> boutiqueId: PARENT (the
  found row already carries it; returned to the caller unchanged) -> index:
  by_email stays global -> OWN: no -> ARGS+: no -> FE: no.
forgotPassword auth.ts:469 action PUB -> boutiqueId: PARENT (resolved from the
  found merchant row) -> index: by_email stays global -> OWN: no -> ARGS+: no
  -> FE: no.
generateMagicToken auth.ts:327 mutation PUB(rate-limited, deprecated alias) ->
  boutiqueId: SLUG (must accept a boutique slug once mobile is ambiguous) ->
  index: by_boutique_mobile -> OWN: no -> ARGS+: YES (adds boutique slug/id) ->
  FE: YES.
generateMagicTokenForCustomer auth.ts:304 mutation MS -> boutiqueId: SESSION
  (token already carries the target customer's boutique, asserted against the
  merchant's own session boutique) -> index: none new -> OWN: YES (target
  customer must be in caller's boutique) -> ARGS+: no -> FE: no.
generateMagicTokenSelf auth.ts:258 mutation PUB(rate-limited) -> boutiqueId:
  SLUG -> index: by_boutique_mobile (mobile lookup must be scoped to the
  resolved boutique) -> OWN: no -> ARGS+: YES (adds boutique slug) -> FE: YES.
merchantHeartbeat auth.ts:202 mutation MS -> boutiqueId: SESSION (no write
  needed, already on the row) -> index: none -> OWN: no -> ARGS+: no -> FE: no.
merchantLogin auth.ts:113 mutation PUB -> boutiqueId: PARENT (the found
  merchant row) -> index: by_email stays global -> OWN: no (returns boutiqueId
  in its reply per spec 4.1) -> ARGS+: no -> FE: YES (return shape gains
  boutiqueId; caller should store it, though not strictly required to work).
merchantLogout auth.ts:175 mutation PUB(token-checked) -> boutiqueId: N/A ->
  index: none -> OWN: no -> ARGS+: no -> FE: no.
saveResetToken auth.ts:416 internalMutation INT -> boutiqueId: N/A (patches
  existing row only) -> index: none -> OWN: no -> ARGS+: no -> FE: no.
validateMagicToken auth.ts:364 query MAGIC/PUB -> boutiqueId: TOKEN (returns
  the customer's boutique_id, this IS "how a customer's boutique is known
  without a domain" per spec 4.2) -> index: by_magic_token stays global ->
  OWN: no -> ARGS+: no (return shape gains boutique_id) -> FE: YES (caller
  should keep the returned boutique_id if it is later used for branding).

--- customers.ts (21)
getCustomers customers.ts:376 query MS -> SESSION -> by_boutique_role_name_lower
  -> OWN: no (list, not by-id) -> ARGS+: no -> FE: no.
getCustomersPaginated customers.ts:412 query MS -> SESSION ->
  by_boutique_role_name_lower -> OWN: no -> ARGS+: no -> FE: no.
getCustomerById customers.ts:444 query MS -> SESSION -> none new -> OWN: YES
  -> ARGS+: no -> FE: no.
updateMeasurements customers.ts:458 mutation MS -> SESSION -> none new ->
  OWN: YES -> ARGS+: no -> FE: no.
addStaffNote customers.ts:485 mutation MS -> SESSION -> none new -> OWN: YES
  -> ARGS+: no -> FE: no.
updateCustomTags customers.ts:507 mutation MS -> SESSION -> none new ->
  OWN: YES -> ARGS+: no -> FE: no.
updateCustomerProfile customers.ts:525 mutation MS -> SESSION -> none new ->
  OWN: YES -> ARGS+: no -> FE: no.
getUpcomingBirthdays customers.ts:564 query MS -> SESSION ->
  by_boutique_role_birthday_md -> OWN: no -> ARGS+: no -> FE: no.
getUpcomingAnniversaries customers.ts:584 query MS -> SESSION ->
  by_boutique_role_anniversary_md -> OWN: no -> ARGS+: no -> FE: no.
findUpcomingInternal customers.ts:624 internalQuery INT -> INTERNAL ->
  by_boutique_role_birthday_md / by_boutique_role_anniversary_md -> OWN: no ->
  ARGS+: YES (adds boutique_id) -> FE: no.
recordMessageAction customers.ts:713 mutation MS -> SESSION -> none new ->
  OWN: YES -> ARGS+: no -> FE: no.
awardPoints customers.ts:840 mutation MS -> SESSION -> none new -> OWN: YES ->
  ARGS+: no -> FE: no.
getPointsHistory customers.ts:894 query MS -> SESSION -> by_boutique_customer
  -> OWN: YES -> ARGS+: no -> FE: no.
findCustomerByMobile customers.ts:947 query MS -> SESSION -> by_boutique_mobile
  -> OWN: no (list within boutique) -> ARGS+: no -> FE: no.
createCustomer customers.ts:976 mutation MS(conditional, see note below) ->
  SESSION or SLUG (depending on call path, see section 2) -> by_boutique_mobile
  (dup check scoped to boutique) -> OWN: no (creating, not loading) -> ARGS+:
  YES (adds boutique id/slug on the public path) -> FE: YES.
deleteCustomer customers.ts:1114 mutation MS -> SESSION -> none new -> OWN:
  YES -> ARGS+: no -> FE: no.
bulkDeleteCustomers customers.ts:1154 mutation MS -> SESSION -> none new ->
  OWN: YES (per id) -> ARGS+: no -> FE: no.
bulkCreateCustomers customers.ts:1237 mutation MS -> SESSION ->
  by_boutique_mobile -> OWN: no -> ARGS+: no -> FE: no.
checkMobilesStatus customers.ts:1393 query MS -> SESSION -> by_boutique_mobile
  -> OWN: no -> ARGS+: no -> FE: no.
getCustomerIntelligenceProfile customers.ts:1474 query MS -> SESSION -> none
  new on this function directly (reads orders/reviews by user_id, which pick
  up the ownership check transitively) -> OWN: YES -> ARGS+: no -> FE: no.
getDraftForCustomer customers.ts:1569 query MS -> SESSION ->
  by_boutique_customer_occasion_date -> OWN: YES -> ARGS+: no -> FE: no.
NOTE createCustomer's guard (customers.ts:976-1003, requireMerchantSession
inside a conditional at line 1003) must not be widened per spec 5 — add
boutique resolution alongside it, not instead of it.

--- settings.ts (11)
getSettings settings.ts:486 query PUB(NONE) -> SLUG or TOKEN (whichever public
  context calls it) -> by_boutique_key -> OWN: YES (must assert the key's
  boutique matches the resolved one) -> ARGS+: YES (adds boutique
  slug/id) -> FE: YES.
updateSettings settings.ts:496 mutation MS -> SESSION -> by_boutique_key ->
  OWN: no (writing own boutique's settings) -> ARGS+: no -> FE: no.
updateTemplate settings.ts:530 mutation MS -> SESSION -> by_boutique_key ->
  OWN: no -> ARGS+: no -> FE: no.
getTemplateCardUrls settings.ts:565 query PUB(NONE) -> SLUG/TOKEN ->
  by_boutique_key -> OWN: YES -> ARGS+: YES -> FE: YES.
setTemplateCardUrl settings.ts:584 mutation MS -> SESSION -> by_boutique_key
  -> OWN: no -> ARGS+: no -> FE: no.
getWhatsAppTemplates settings.ts:609 query MS -> SESSION -> by_boutique_key ->
  OWN: no -> ARGS+: no -> FE: no.
setWhatsAppTemplate settings.ts:636 mutation MS -> SESSION -> by_boutique_key
  -> OWN: no -> ARGS+: no -> FE: no.
clearWhatsAppTemplate settings.ts:678 mutation MS -> SESSION -> by_boutique_key
  -> OWN: no -> ARGS+: no -> FE: no.
getWhatsAppTemplateConfig settings.ts:708 query MS -> SESSION ->
  by_boutique_key -> OWN: no -> ARGS+: no -> FE: no.
setWhatsAppTemplateConfig settings.ts:736 mutation MS -> SESSION ->
  by_boutique_key -> OWN: no -> ARGS+: no -> FE: no.
resetSettings settings.ts:765 mutation MS -> SESSION -> by_boutique_key ->
  OWN: no -> ARGS+: no -> FE: no.

--- lookbooks.ts (14)
getLookbooks lookbooks.ts:103 query MS -> SESSION -> by_boutique -> OWN: no ->
  ARGS+: no -> FE: no.
getLookbooksForSelector lookbooks.ts:133 query MS -> SESSION -> by_boutique ->
  OWN: no -> ARGS+: no -> FE: no.
getLookbookById lookbooks.ts:154 query PUB(NONE) -> SLUG/TOKEN -> by_boutique
  (point lookup still by _id, then boutique asserted) -> OWN: YES -> ARGS+:
  YES (adds boutique context for the assertion) -> FE: YES.
getCustomerCatalogue lookbooks.ts:204 query MAGIC -> TOKEN -> by_boutique on
  lookbooks + catalogue_items -> OWN: no (already boutique-scoped list) ->
  ARGS+: no (id+token already identify the boutique via the token) -> FE: no
  (see section 6, this is the #1 fix but needs no new frontend argument).
getCatalogueItemById lookbooks.ts:278 query PUB(NONE) -> SLUG/TOKEN ->
  by_boutique (transitively via lookbook_id) -> OWN: YES -> ARGS+: YES -> FE: YES.
createLookbook lookbooks.ts:294 mutation MS -> SESSION -> by_boutique -> OWN:
  no -> ARGS+: no -> FE: no.
updateLookbook lookbooks.ts:316 mutation MS -> SESSION -> none new -> OWN: YES
  -> ARGS+: no -> FE: no.
deleteLookbook lookbooks.ts:345 mutation MS -> SESSION -> none new -> OWN: YES
  -> ARGS+: no -> FE: no.
addCatalogueItem lookbooks.ts:374 mutation MS -> PARENT (lookbook's boutique)
  -> by_lookbook (unchanged) + new by_boutique -> OWN: YES (the parent
  lookbook must belong to the caller) -> ARGS+: no -> FE: no.
updateCatalogueItem lookbooks.ts:414 mutation MS -> SESSION -> none new ->
  OWN: YES -> ARGS+: no -> FE: no.
deleteCatalogueItem lookbooks.ts:444 mutation MS -> SESSION -> none new ->
  OWN: YES -> ARGS+: no -> FE: no.
createPdfLookbook lookbooks.ts:466 internalMutation INT -> INTERNAL -> by_boutique
  -> OWN: no -> ARGS+: YES (adds boutique_id) -> FE: no (internal only).
checkMerchantSession lookbooks.ts:499 internalQuery INT(MS) -> SESSION
  (returns boutiqueId for the action caller, per Phase 0a audit) -> none new
  -> OWN: no -> ARGS+: no (return shape gains boutiqueId) -> FE: no.
generatePdfUploadUrl lookbooks.ts:526 action PUB(calls checkMerchantSession) ->
  SESSION (via checkMerchantSession) -> none new -> OWN: no -> ARGS+: no -> FE: no.
UPLOAD PATH (item 19): generatePdfUploadUrl's PDF upload (lookbooks.ts:546
`put(filename, file, {...})`) builds its Blob pathname directly from
`filename`, with no boutique slug prefix today. Per spec 6 ("new upload paths
start with the boutique slug"), this call's `filename` argument gains a
`${boutiqueSlug}/` prefix in batch 8 (lookbooks.ts remaining scoping, since
generatePdfUploadUrl lives in that batch's file). Existing uploaded files are
NOT moved or renamed — only new uploads after batch 8 ships get the prefix.

--- orders.ts (5)
createOrder orders.ts:31 mutation MS -> SESSION -> by_boutique_user (via
  stamped field) -> OWN: YES (target customer must be caller's boutique) ->
  ARGS+: no -> FE: no.
getOrders orders.ts:109 query MS -> SESSION -> by_boutique_created_at -> OWN:
  no -> ARGS+: no -> FE: no.
getOrdersByUser orders.ts:118 query MS -> SESSION -> by_boutique_user -> OWN:
  YES -> ARGS+: no -> FE: no.
getTodayOrders orders.ts:151 query MS -> SESSION -> by_boutique_created_at ->
  OWN: no -> ARGS+: no -> FE: no.
getTodaySummary orders.ts:160 query MS -> SESSION -> by_boutique_created_at ->
  OWN: no -> ARGS+: no -> FE: no.

--- reviews.ts (5)
createReview reviews.ts:51 mutation PUB(rate-limited) -> TOKEN (the reviewing
  customer's own row) -> by_boutique_user on write -> OWN: no (self-write) ->
  ARGS+: no (customer id already identifies the boutique) -> FE: no.
approveReview reviews.ts:113 mutation MS -> SESSION -> none new -> OWN: YES ->
  ARGS+: no -> FE: no.
declineReview reviews.ts:195 mutation MS -> SESSION -> none new -> OWN: YES ->
  ARGS+: no -> FE: no.
getPendingReviews reviews.ts:219 query MS -> SESSION -> by_boutique_status ->
  OWN: no -> ARGS+: no -> FE: no.
getReviews reviews.ts:237 query MS -> SESSION -> by_boutique_status -> OWN:
  no -> ARGS+: no -> FE: no.

--- templates.ts (2)
checkMerchantSession templates.ts:30 internalQuery INT(MS) -> SESSION -> none
  -> OWN: no -> ARGS+: no (return gains boutiqueId) -> FE: no.
generateTemplateMediaUploadUrl templates.ts:55 action PUB(calls
  checkMerchantSession) -> SESSION -> none -> OWN: no -> ARGS+: no -> FE: no.
UPLOAD PATH (item 19): generateTemplateMediaUploadUrl's media upload
(templates.ts:78 `put(filename, file, {...})`) has the same no-prefix pathname
issue as lookbooks.ts:546. Fixed in batch 11 (ai.ts/whatsapp.ts/templates.ts
scoping, since generateTemplateMediaUploadUrl lives in that batch's file),
same `${boutiqueSlug}/` prefix rule, existing files not moved.

--- whatsapp.ts (4)
checkMerchantSession whatsapp.ts:116 internalQuery INT(MS) -> SESSION -> none
  -> OWN: no -> ARGS+: no -> FE: no.
sendWhatsAppTemplateMessage whatsapp.ts:148 action PUB(calls
  checkMerchantSession) -> SESSION -> by_boutique (reads boutique_secrets
  instead of process.env per spec 6 D3) -> OWN: no -> ARGS+: no -> FE: no.
sendWhatsAppServiceMessage whatsapp.ts:233 action PUB(calls
  checkMerchantSession) -> SESSION -> by_boutique (boutique_secrets) -> OWN:
  no -> ARGS+: no -> FE: no.
sendAllUpcomingOccasionMessages whatsapp.ts:404 action PUB(calls
  checkMerchantSession) -> SESSION -> by_boutique_role_consent_vvip (recipient
  scoping) + boutique_secrets -> OWN: no -> ARGS+: no -> FE: no.

--- ai.ts (16)
checkMerchantSession ai.ts:287 internalQuery INT(MS) -> SESSION -> none -> OWN:
  no -> ARGS+: no -> FE: no.
generateActivitySummaryPublic ai.ts:1082 action PUB(calls checkMerchantSession)
  -> SESSION -> none -> OWN: no -> ARGS+: no (boutique name threaded into the
  prompt internally) -> FE: no.
generateCombinedMessageDraft ai.ts:640 internalAction INT -> INTERNAL -> none
  -> OWN: no -> ARGS+: YES (adds boutique_id for the prompt's boutique name,
  replacing the hardcoded "85 Lansdowne" string per spec 7) -> FE: no.
generateCombinedMessageDraftPublic ai.ts:691 action PUB(calls
  checkMerchantSession) -> SESSION -> none -> OWN: no -> ARGS+: no -> FE: no.
generateCustomerActivitySummary ai.ts:844 internalAction INT -> INTERNAL ->
  none -> OWN: no -> ARGS+: YES -> FE: no.
generateMessageDraft ai.ts:356 internalAction INT -> INTERNAL -> none -> OWN:
  no -> ARGS+: YES -> FE: no.
generateMessageDraftManual ai.ts:590 action PUB(calls checkMerchantSession) ->
  SESSION -> none -> OWN: no -> ARGS+: no -> FE: no.
generateMessageDraftPublic ai.ts:454 action PUB(calls checkMerchantSession) ->
  SESSION -> none -> OWN: no -> ARGS+: no -> FE: no.
getActiveCustomers ai.ts:962 query MS -> SESSION -> by_boutique_role_name_lower
  -> OWN: no -> ARGS+: no -> FE: no.
getCachedActivitySummaryInternal ai.ts:1037 internalQuery INT -> INTERNAL ->
  by_boutique_customer -> OWN: no -> ARGS+: YES -> FE: no.
getPurchaseSummaryInternal ai.ts:810 internalQuery INT -> INTERNAL ->
  by_boutique_user -> OWN: no -> ARGS+: YES -> FE: no.
getRecentActivityCountsInternal ai.ts:766 internalQuery INT -> INTERNAL ->
  by_boutique_customer_created_at -> OWN: no -> ARGS+: YES -> FE: no.
getWhatsAppTemplateConfigInternal ai.ts:317 internalQuery INT -> INTERNAL ->
  by_boutique_key -> OWN: no -> ARGS+: YES -> FE: no.
overwriteCachedDraft ai.ts:539 internalMutation INT -> INTERNAL ->
  by_boutique_customer_occasion_date -> OWN: no -> ARGS+: YES -> FE: no.
testGeminiConnection ai.ts:728 action PUB -> N/A (no boutique data touched,
  harmless connectivity check per Phase 0a audit) -> none -> OWN: no -> ARGS+:
  no -> FE: no.
upsertActivitySummary ai.ts:913 internalMutation INT -> INTERNAL ->
  by_boutique_customer -> OWN: no -> ARGS+: YES -> FE: no.

--- crons.ts (13)
hasExistingDraft crons.ts:119 internalQuery INT -> INTERNAL ->
  by_boutique_customer_occasion_date -> OWN: no -> ARGS+: YES -> FE: no.
getCachedDraftTextInternal crons.ts:155 internalQuery INT -> INTERNAL ->
  by_boutique_customer_occasion_date -> OWN: no -> ARGS+: YES -> FE: no.
insertDraft crons.ts:188 internalMutation INT -> INTERNAL -> none (write) ->
  OWN: no -> ARGS+: YES -> FE: no.
generateDailyDrafts crons.ts:239 internalAction INT -> INTERNAL (must loop
  over active boutiques per spec 10) -> by_boutique_role_birthday_md/
  anniversary_md -> OWN: no -> ARGS+: YES (becomes per-boutique, see section
  7/10) -> FE: no.
hasExistingNotification crons.ts:331 internalQuery INT -> INTERNAL ->
  by_boutique_customer_occasion_date -> OWN: no -> ARGS+: YES -> FE: no.
insertNotification crons.ts:358 internalMutation INT -> INTERNAL -> none
  (write) -> OWN: no -> ARGS+: YES -> FE: no.
deleteExpiredNotifications crons.ts:385 internalMutation INT -> N/A (global
  sweep by created_at, safe to stay a global scan since it only deletes
  expired rows, never returns data) -> by_boutique_created_at (optional
  optimization) -> OWN: no -> ARGS+: no -> FE: no.
generateDailyNotifications crons.ts:416 internalAction INT -> INTERNAL (loop
  over boutiques) -> by_boutique_role_birthday_md/anniversary_md -> OWN: no ->
  ARGS+: YES -> FE: no.
getRecentActivityCustomerIdsInternal crons.ts:520 internalQuery INT ->
  INTERNAL -> by_boutique_created_at -> OWN: no -> ARGS+: YES -> FE: no.
getCustomerNameInternal crons.ts:539 internalQuery INT -> INTERNAL -> none ->
  OWN: no -> ARGS+: no -> FE: no.
generateWeeklyActivityNotifications crons.ts:571 internalAction INT ->
  INTERNAL (loop over boutiques) -> by_boutique_created_at -> OWN: no -> ARGS+:
  YES -> FE: no.
getCustomerTierInternal crons.ts:680 internalQuery INT -> INTERNAL -> none ->
  OWN: no -> ARGS+: no -> FE: no.
generateDailyActivitySummaries crons.ts:709 internalAction INT -> INTERNAL
  (loop over boutiques) -> by_boutique_role_name_lower -> OWN: no -> ARGS+:
  YES -> FE: no.
CRON BEHAVIOUR DURING PHASE 1 (item 20): the three registered cron jobs
(crons.cron(...) calls at crons.ts:779, 806, 831) fire
generateDailyNotifications, generateWeeklyActivityNotifications, and
generateDailyActivitySummaries respectively, on their existing fixed IST
schedules — unchanged by Phase 1 (spec 10 only changes what happens INSIDE
each action, not when it fires). On aware-rabbit-290 with the two seeded test
boutiques (section 8), each per-boutique loop iterates exactly 2 times and
writes drafts/notifications/summaries scoped to each. With ZERO boutiques
(e.g. right after Step A, before Step B creates the default boutique, or on a
freshly-reset test deployment with no seed run yet), the loop iterates over
an empty boutiques list and does nothing — zero writes, no error, no crash;
this is simply what a `for (const boutique of activeBoutiques)` loop does
over an empty array. This zero-boutique case is explicitly tested in batch 12
(crons.ts+dashboard.ts scoping): trigger each cron action on aware-rabbit-290
before running the test seed and confirm it completes with no error and no
writes.

--- events.ts (12)
createEvent events.ts:71 mutation MS -> SESSION -> by_boutique_event_datetime
  -> OWN: no -> ARGS+: no -> FE: no.
getEvents events.ts:108 query MS -> SESSION -> by_boutique_event_datetime ->
  OWN: no -> ARGS+: no -> FE: no.
deleteEvent events.ts:122 mutation MS -> SESSION -> none new -> OWN: YES ->
  ARGS+: no -> FE: no.
getEventPromptFieldsInternal events.ts:142 internalQuery INT -> INTERNAL ->
  none -> OWN: no -> ARGS+: no -> FE: no.
generateEventDraft events.ts:190 internalAction INT -> INTERNAL -> none ->
  OWN: no -> ARGS+: YES (boutique name in prompt) -> FE: no.
generateEventDraftPublic events.ts:256 action PUB(calls checkMerchantSession)
  -> SESSION -> none -> OWN: no -> ARGS+: no -> FE: no.
checkMerchantSession events.ts:281 internalQuery INT(MS) -> SESSION -> none ->
  OWN: no -> ARGS+: no -> FE: no.
getDispatchRecipientsInternal events.ts:299 internalQuery INT -> INTERNAL ->
  by_boutique_role_consent_vvip -> OWN: no -> ARGS+: YES -> FE: no.
markEventDispatchedInternal events.ts:326 internalMutation INT -> INTERNAL ->
  none -> OWN: no -> ARGS+: no -> FE: no.
dispatchEvent events.ts:365 action PUB(calls checkMerchantSession) -> SESSION
  -> by_boutique_role_consent_vvip + boutique_secrets -> OWN: YES (event must
  belong to caller's boutique) -> ARGS+: no -> FE: no.
getEventForDispatchInternal events.ts:425 internalQuery INT -> INTERNAL ->
  none -> OWN: no -> ARGS+: no -> FE: no.
getEventAccess events.ts:493 query PUB(NONE) -> TOKEN (the viewing customer's
  resolved boutique) -> none -> OWN: YES (THE spec 13 risk: must assert
  customer's boutique == event's boutique) -> ARGS+: YES (adds the viewer's
  token/boutique context) -> FE: YES if/when a customer events page is built
  (spec 8 rule: no page calls this today, per grep of src/ for "getEventAccess"
  — zero matches).

--- notifications.ts (3)
getNotifications notifications.ts:38 query MS -> SESSION -> by_boutique_seen
  -> OWN: no -> ARGS+: no -> FE: no.
markAllSeen notifications.ts:58 mutation MS -> SESSION -> by_boutique_seen ->
  OWN: no (bulk, scoped by read) -> ARGS+: no -> FE: no.
deleteNotification notifications.ts:80 mutation MS -> SESSION -> none new ->
  OWN: YES -> ARGS+: no -> FE: no.

--- activity.ts (1)
trackActivity activity.ts:47 mutation PUB(NONE, by design) -> TOKEN (spec 4.3
  fix: the mutation gains a required token argument, resolves the customer
  and boutique from it, and refuses to write if the token doesn't match) ->
  none new -> OWN: YES (the new token-match check IS the ownership check for
  this function) -> ARGS+: YES -> FE: YES (see section 5/6, three call sites).

--- dashboard.ts (2)
getDashboardSummary dashboard.ts:38 query MS -> SESSION -> by_boutique_customer
  (ledger) + by_boutique_created_at (orders) + by_boutique_status (reviews) ->
  OWN: no -> ARGS+: no -> FE: no.
getRecentCustomerActivity dashboard.ts:103 query MS -> SESSION ->
  by_boutique_created_at (customer_activity_events) -> OWN: no -> ARGS+: no ->
  FE: no.

--- platformStats.ts (1)
computeStats platformStats.ts:35 internalQuery INT -> N/A, see spec 5's
  exception: this is the one function allowed to read every boutique, and per
  spec 9 it is changed to group its sums by boutique_id and support a
  boutique parameter + list mode, rather than being scoped to a single
  boutique like every other function -> index: iterates by_boutique_* ranges
  per boutique in a loop rather than one boutique_id filter -> OWN: no ->
  ARGS+: YES (adds an optional boutique filter / list mode per spec 9) ->
  FE: no (Platform Admin repo, out of scope for this LoyaltyOS-side audit).
STATS ENDPOINT RESPONSE SHAPE (item 18): the response fields that must NOT
change (confirmed from the live platformStats.ts return statement) are:
schemaVersion, generatedAt, customersActive, testCustomersExcluded,
reviewsApproved, pointsIssued, weeklyHistory, weeklyUses, ownerOnlineAt,
ownerLastActionAt, firstRecordAt — the Platform Admin's own validateStats
check (loyaltyos-platform-admin/convex/lib/stats.ts, per the earlier
session's cross-repo audit) checks every one of these field names and types;
batch 13 (platformStats.ts+http.ts) adds the new boutique parameter/list mode
as an ADDITIONAL optional argument/field, never removing or renaming any of
the eleven fields above, so a call with no boutique parameter (today's
Platform Admin, unmodified) must keep returning the exact same shape for 85
Lansdowne as it does right now.

--- http.ts (1)
(httpAction for GET /platform/stats) http.ts:37 httpAction PUB(bearer secret)
  -> N/A, calls computeStats -> none -> OWN: no -> ARGS+: YES (accepts the new
  boutique parameter/list mode and forwards it) -> FE: no.

Per-file function totals confirmed: auth 10, customers 21, settings 11,
lookbooks 14, orders 5, reviews 5, templates 2, whatsapp 4, ai 16, crons 13,
events 12, notifications 3, activity 1, dashboard 2, platformStats 1, http 1.
Sum = 121, matching the function-spec count recorded in revision 1 (not
re-run this revision, since no code changed — see section 14 item 30).

5. FRONTEND IMPACT OF PHASE 1

src/lib/db.js is NOT a protected file (it is in the explicitly allowed list
per CLAUDE.md section 5.4: "Allowed files: src/lib/db.js, src/main.jsx"), so
every change below can be made without the ask-before-edit frontend-protection
gate that applies to src/pages/merchant/*.jsx etc.

- src/lib/db.js:1663-1708 (likeItem) and its call at src/lib/db.js:1700
  (client.mutation(api.activity.trackActivity, {...})) — must add a token
  argument. Caller: src/pages/Lookbook.jsx:337 (onClick handler). NOT
  protected under the strict list, but Lookbook.jsx is not in the protected
  list either (the protected list is Dashboard/Shell/Customers/Campaigns/
  Templates/PointsLedger/Settings/seed.js/index.css/App.jsx — Lookbook.jsx is
  an approved-flow file per CLAUDE.md 5.4 "Lookbook.jsx (auth/waLink)").
  Smallest change: likeItem's signature gains a `token` parameter; its one
  call site (Lookbook.jsx:337) already has `lastAuthRef.token` in scope
  (Lookbook.jsx:79) and just needs to pass it through.
- src/lib/db.js:1717-1731 (trackCartAdd), call at src/lib/db.js:1725. Caller:
  src/pages/Lookbook.jsx:229. Same smallest change: add `token` parameter,
  Lookbook.jsx:229 passes `lastAuthRef.token`.
- src/lib/db.js:1739-1751 (trackLookbookView), call at src/lib/db.js:1745.
  Caller: src/pages/Lookbook.jsx:189 (mount-effect). Same smallest change.
- src/lib/db.js:1633 (hydrateCustomerCatalogue calling
  api.lookbooks.getCustomerCatalogue) — NO argument change needed; id+token
  already identify the boutique via the token row (section 4). No frontend
  change required for the #1 fix itself.
- src/lib/db.js:296 (generateMagicTokenSelf alias) and src/lib/db.js:2879
  (the real self-onboarding call) — once /join gains a slug (spec 4.3, a
  later Phase 2 item, not Phase 1), these calls will need a boutique
  slug/id argument. NOT required for Phase 1 itself (Phase 1 keeps the
  existing slug-less behaviour defaulting to 85 Lansdowne per spec D1); flagged
  here only so Phase 2's frontend work is not a surprise.
- No protected file (Dashboard.jsx, Shell.jsx, Customers.jsx, Campaigns.jsx,
  Templates.jsx, PointsLedger.jsx, Settings.jsx, seed.js, index.css, App.jsx)
  needs ANY argument change in Phase 1 — every merchant-side function keeps
  its exact current argument shape (boutiqueId comes from the session
  server-side, per spec 4.1, "never from a client argument"). Phase 1 touches
  convex/ and src/lib/db.js only.

BROWSER CACHE KEYS (item 21). Every localStorage/sessionStorage key used in
src/ (grep of "localStorage\.\(setItem\|getItem\)\|sessionStorage\." across
src/lib/db.js, src/pages/*.jsx, src/main.jsx — the only matches are in
src/lib/db.js, no sessionStorage usage exists anywhere):
- KEY = 'loyaltyos85_v2' (src/lib/db.js:21, read at :32, written at :46) — the
  WHOLE app state cache: catalogue items, customers, settings, campaigns,
  everything `state` holds. Holds boutique data (every table's client-side
  mirror).
- CUST_KEY = 'loyaltyos_customer_session' (src/lib/db.js:2503, written at
  :2505 by saveCustomerSession, read at :2508) — the customer's {id, token,
  ts} session. Holds boutique-identifying data (the customer _id, whose row
  carries boutique_id once Phase 2's token resolution reads it).
- MERC_KEY = 'loyaltyos_merchant_session' (src/lib/db.js:2504, written at
  :2518, read at :2522) — the merchant's {id, token, ts} session. Same
  concern: a merchant id implicitly belongs to one boutique.
All three keys are FIXED STRINGS today, with no boutique in the key name. If
the same browser is ever used for two different boutiques (a merchant testing
two merchant accounts in one browser profile, or — per spec 3.4 — the same
customer being a customer of two boutiques and opening both magic links in
the same browser), the second boutique's session/cache SILENTLY OVERWRITES
the first's under the identical key, and a stale 'loyaltyos85_v2' cache from
boutique A could render boutique B's page with boutique A's cached catalogue
until the next successful fetch overwrites it. WHICH PHASE: this is NOT
required for Phase 1's safety — Phase 1 has exactly one boutique live (85
Lansdowne) on pleasant-cobra-560, so there is no second boutique's cache to
collide with yet; the collision risk only becomes real once Phase 2/5 puts a
second real boutique in front of real browsers. RECOMMENDATION: fix this in
Phase 2 (boutique identity), when slugs/boutique ids are first threaded
through the frontend anyway — the three key names should become
boutique-suffixed (e.g. `loyaltyos85_v2:${boutiqueId}`), a one-line change at
each of the three constant definitions (db.js:21,2503,2504) plus their
read/write call sites. This touches ONLY src/lib/db.js, which is not a
protected file — no protected-file approval gate applies to this future fix
either.

6. THE TWO FIRST FIXES

6.1 getCustomerCatalogue (convex/lookbooks.ts:204-268).
Current code: lookbooks.ts:230 `const lookbooks = await ctx.db.query("lookbooks").collect();`
reads EVERY lookbook in the table regardless of boutique, then lookbooks.ts:248-251
reads that lookbook's items via the by_lookbook index — so today, with one
boutique, this returns the whole (single) boutique's catalogue; once a second
boutique's lookbooks exist, this returns BOTH boutiques' items to any customer
with a valid token, mixed together with no indication of which item belongs
to which boutique. This is the audit's #1 cross-boutique leak (Phase 0a audit
section 13, risk 1).
Planned change: replace `ctx.db.query("lookbooks").collect()` with
`ctx.db.query("lookbooks").withIndex("by_boutique", (q) => q.eq("boutique_id",
customer.boutique_id)).collect()`, where `customer.boutique_id` comes from the
already-validated customer row (lookbooks.ts:211-216 already loads this row
via by_magic_token — the boutique_id is already in hand at that point, no new
argument needed). Every frontend caller (src/lib/db.js:1633
hydrateCustomerCatalogue, called from src/pages/Lookbook.jsx at lines
93,114,132,158) needs NO change — the fix is entirely server-side.
ALSO IN THIS FIX (batch 5, not a separate batch — see section 10/11):
getOrCreateHomeLookbook (lookbooks.ts:83-98, the shared helper also inside
lookbooks.ts) does the identical whole-table `ctx.db.query("lookbooks").collect()`
at lookbooks.ts:84, just to find one "catalogue"-kind row. It is fixed in the
SAME batch as getCustomerCatalogue (not deferred to the later lookbooks batch)
because it shares the exact same root cause and the exact same file; its own
test: with two seeded test boutiques (section 8), each lacking a home
lookbook, a call that triggers getOrCreateHomeLookbook for boutique Alpha must
create (or find) ONLY Alpha's home lookbook, never Beta's, and vice versa.

6.2 trackActivity (convex/activity.ts:47-73).
Current code: args are `{ customerId: v.id("users"), action, catalogueItemId?,
lookbookId?, eventId? }` — activity.ts:61 inserts the row directly from the
raw customerId the caller supplies, with no proof the caller actually is that
customer. Phase 0a audit section 13, risk: "should verify the customer_id
matches a valid magic session and stamp that customer's boutique_id, so
activity can't be written against another boutique's customer."
Planned change (per spec 4.3): add a required `token: v.string()` argument.
Handler first does the same by_magic_token lookup pattern
getCustomerCatalogue/validateMagicToken already use (activity.ts gains a
`ctx.db.query("users").withIndex("by_magic_token", (q) =>
q.eq("magic_token", token)).first()` call), asserts the found row's `_id`
equals the given `customerId` and `role === "customer"`, and only then
inserts with `boutique_id: customer.boutique_id` stamped onto the new
customer_activity_events row. A missing or mismatched token writes nothing
(returns null early, same fire-and-forget-safe shape the function already
has at activity.ts:71).
Every frontend caller needs a one-line change (see section 5):
- src/lib/db.js:1663-1708 likeItem -> src/lib/db.js:1700 call -> caller
  src/pages/Lookbook.jsx:337.
- src/lib/db.js:1717-1731 trackCartAdd -> src/lib/db.js:1725 call -> caller
  src/pages/Lookbook.jsx:229.
- src/lib/db.js:1739-1751 trackLookbookView -> src/lib/db.js:1745 call ->
  caller src/pages/Lookbook.jsx:189.
All three callers already have the customer's token available via
src/pages/Lookbook.jsx:79 `lastAuthRef` (set at lines 113,132,158 whenever the
page successfully authenticates), so the smallest change is: thread a `token`
parameter through likeItem/trackCartAdd/trackLookbookView's own signatures,
and pass `lastAuthRef.token` at each of the three Lookbook.jsx call sites.

DEPLOY ORDER FOR THIS CHANGE (item 6). All three call sites
(src/lib/db.js:1700,1725,1745) wrap their `client.mutation(api.activity.
trackActivity, {...})` call in `.catch(() => { /* tracking failure must never
surface to the customer */ })`, AND wrap that in an outer try/catch too
(db.js:1699-1706,1724-1730,1744-1750) — confirmed by reading the actual code,
not assumed. Convex rejects a mutation call whose arguments don't match the
function's declared validator (an unknown extra argument, or a missing
required one, both fail ArgumentValidationError-style) — so: a NEW frontend
build that sends `token` against the OLD (not-yet-redeployed) backend fails
(the old `trackActivity` validator has no `token` field, so the call is
rejected as an unexpected argument); an OLD cached frontend that does NOT
send `token` against a NEW backend also fails, once the backend makes
`token` a required argument (missing required argument). EITHER MISMATCH
DIRECTION FAILS, and because of the double catch above, EVERY one of these
failures is swallowed completely silently — no error banner, no toast, no
console-visible-to-the-customer message, nothing the customer ever sees.
RECOMMENDED ORDER for Release B (section 15): deploy the BACKEND
(convex/activity.ts's new token-requiring trackActivity) first, then the
Vercel frontend build (which sends `token`) within minutes after — backend-
first means the brief gap has OLD frontends (no token) failing against the
NEW backend, which is the safer failure direction, since it only means
"activity from browsers that haven't reloaded yet is silently dropped," not
"activity sent with a token the backend doesn't understand is silently
dropped" (functionally the same silent-drop outcome either order, but
backend-first avoids ever having a NEW frontend talk to an OLD backend that
rejects the unexpected `token` argument on EVERY customer action, which is a
strictly worse failure surface since newly-loaded browsers, not just stale
cached ones, would be affected). WHAT HAPPENS TO ACTIVITY FROM OLD CACHED
BROWSERS IN BETWEEN: it is DROPPED SILENTLY — no customer-facing error of
any kind, confirmed directly by the three `.catch()` comments above; likes,
cart-adds, and lookbook-view tracking simply do not get recorded in
`customer_activity_events` for any customer whose browser has not yet
fetched the new Vercel build, for as long as that gap lasts (typically
minutes, until the browser's next page load pulls the new frontend bundle).
This exact scenario is added to the 85-Lansdowne regression checklist (spec
12, referenced in section 11): after Release B's backend-then-frontend
deploy, confirm that an OLD cached tab attempting to like/cart-add/view a
lookbook shows NO error to the customer (matches today's always-silent
tracking-failure behaviour) and that a freshly-reloaded tab's same actions
ARE recorded once both halves of Release B are live.

7. MIGRATION PLAN DETAIL

MIGRATION FUNCTIONS (item 1). Steps B's work is done by THREE named internal
functions in a new file convex/migrations.ts (not the schema file, not
testSeed.ts — a dedicated file so migration code is easy to find and delete
once Phase 1 is fully live):
- createDefaultBoutique (internal mutation) — creates the single 85 Lansdowne
  boutiques row exactly as spec 3.5 Step B describes (is_default: true, slug
  "85-lansdowne", one_device_lock: true, flags: {}). IDEMPOTENT: if a row with
  is_default: true already exists (checked via the by_default index), it
  returns that row's id and does nothing further, rather than creating a
  second default boutique.
- backfillBoutiqueId (internal mutation) — takes a table name and a cursor
  argument; one call handles ONE table. Reads up to a fixed batch size of
  rows whose boutique_id is undefined (see the batch-size design below),
  patches boutique_id onto each, and returns `{ patched: <count>, remaining:
  <boolean> }`. Safe to re-run: a row that already has boutique_id set is
  never matched by the "boutique_id is undefined" filter again, so re-running
  with the same table name only ever touches rows still missing the field.
- countMissingBoutiqueId (internal query) — takes a table name, returns ONLY
  the count of rows in that table whose boutique_id is undefined (counts
  only, no row contents, matching this project's audit convention). Used
  before, during, and after the backfill to confirm progress and completion.
These three functions are what batch 14 (Step B backfill, formerly batch 13 —
see the renumbering in section 10) actually runs — NOT functions from the
schema batch (batch 1) or the shared-helper batch (batch 2), which is the gap
this revision closes.

LEGACY TEST DATA FOR THE BACKFILL (item 2). The backfill cannot be proven on
aware-rabbit-290 using section 8's seedMultiBoutiqueTestData alone, because
that mutation creates rows WITH boutique_id already set (it seeds rows that
already belong to the two test boutiques) — there would be nothing for
backfillBoutiqueId to actually patch. convex/testSeed.ts therefore also gets
a THIRD function, seedLegacyRows (internal mutation, same ALLOW_TEST_SEED
guard as the other two), which creates 85-Lansdowne-shaped rows in all 14
tables WITHOUT setting boutique_id at all — exactly mimicking what the real
live data looks like before Step B runs. The test sequence on aware-rabbit-290
becomes: (1) run seedLegacyRows; (2) run countMissingBoutiqueId per table,
confirm count > 0 for every table that got legacy rows; (3) run
createDefaultBoutique then backfillBoutiqueId per table (looping until
`remaining: false`); (4) run countMissingBoutiqueId again, confirm count = 0
for every table; (5) run backfillBoutiqueId a second time per table, confirm
`patched: 0` (proving it is safe to re-run on already-migrated data).
wipeMultiBoutiqueTestData (section 8) is extended to also remove the rows
seedLegacyRows created (matched the same way: an obvious name-prefix/fake-
mobile marker, never touching any other row).

Step A (spec 3.5): schema change only — add `boutiques` and `boutique_secrets`
tables (section 1.15/1.16), add `boutique_id: v.optional(v.id("boutiques"))`
to all 14 existing tables, add every new by_boutique_* index alongside
(not replacing) the current indexes. Deploy to aware-rabbit-290 first; no
function changes yet, so every existing read/write keeps working unchanged
(optional field, nothing reads it yet) — this step cannot break 85 Lansdowne
even if deployed to pleasant-cobra-560, since it is purely additive schema.

Step B (spec 3.5): run createDefaultBoutique, then backfillBoutiqueId per
table (looping each until `remaining: false`), confirming with
countMissingBoutiqueId that every table reaches 0. See the exact live order
in the new subsection below (item 8) — Step B is NOT run casually; on the
live backend it is one step inside a strict 7-step sequence.
- Batch size: 200 rows per invocation for every table except
  customer_activity_events (354 rows, the largest table per section 1.13) and
  reviews (75 rows) — 200 is comfortably above every table's live row count
  (max 354), so in practice each table finishes in 1-2 batches; the batch
  size exists for safety margin on a future boutique's much larger table, not
  because 85 Lansdowne's current data is large.
- BACKFILL LIMITS (item 7): Convex caps a single mutation at 16384 documents
  read and 8192 documents written per execution (the platform's documented
  per-mutation read/write ceiling). backfillBoutiqueId's chosen batch size of
  200 reads + 200 writes per call is roughly 80x under the read ceiling and
  roughly 40x under the write ceiling, for even the largest current table
  (customer_activity_events, 354 rows — comfortably inside ONE 200-row batch
  plus a tiny second batch). This design scales to a future boutique with
  many thousands of rows in the same table, because the mutation is called
  REPEATEDLY in a loop (per the `remaining: boolean` return value) rather
  than attempting the whole table in one call — a boutique with, say, 50,000
  customer_activity_events rows would simply need ~250 successive
  backfillBoutiqueId calls at 200 rows each, each individual call still
  comfortably inside the platform's per-mutation limits, rather than ever
  needing a single call to process more rows than Convex allows.
- Release A vs Release B (item 2, see section 15 for the full definition):
  Step B's backfillBoutiqueId mutation is part of Release A (deployed at
  live-order step 1, alongside Step A's schema and createDefaultBoutique),
  and runs BEFORE Release B — the code that makes every NEW insert stamp
  boutique_id (every insert site in section 2, using the boutiqueId-source
  column from section 4) is itself part of Release B, deployed SEPARATELY
  and LATER, at live-order step 5. These are DELIBERATELY two separate
  deploys, not one combined deploy — this is exactly why the window in item
  9 below exists (old, not-yet-scoped code is still the one handling writes
  between Release A's backfill finishing and Release B actually going live),
  and exactly why the mandatory catch-up backfillBoutiqueId pass (live-order
  step 6, still part of Release A's already-deployed migrations.ts) is what
  closes that window, rather than the two deploys shipping together.
- SOFT-DELETED AND TEST ROWS (item 26): backfillBoutiqueId's row-selection
  filter is only "boutique_id is undefined" — it does NOT exclude
  soft-deleted rows (is_deleted: true) or rows whose name/content looks like
  test data. Every row in every table, deleted or not, real or test-looking,
  gets the SAME 85-Lansdowne boutique_id, because every one of them
  genuinely belongs to 85 Lansdowne today — nothing is lost, and no row count
  changes as a side effect of the backfill. This also means the counts the
  Delight Desk and Platform Admin already report today (customers 97, reviews
  61 approved, points 54,002 — the live numbers recorded in the ledger after
  the earlier Points-issued and Platform-Admin-stats fixes) are the exact
  numbers that must still come back after the backfill, since backfilling
  boutique_id changes no other field and deletes no row (see item 27 below,
  the regression-number test this implies for batch 15).

Step C (spec 3.5): switch every read in section 3 to its boutique-scoped
index (the by_boutique_* replacements from section 1), add the ownership
check from section 4.4 to every id-based read/write, then make boutique_id
required (v.id("boutiques") instead of v.optional) in the schema, and only
THEN drop the old global indexes that are superseded (by_mobile, by_tier,
by_role_name_lower, by_role_birthday_md, by_role_anniversary_md,
by_role_consent_vvip on users; by_user, by_created_at on orders; by_key on
settings; by_user, by_status on reviews; by_customer_occasion_date on
message_actions/ai_message_drafts/notifications; by_customer on
points_ledger/customer_activity_summaries; by_customer_created_at,
by_created_at on customer_activity_events; by_event_datetime on events).
by_magic_token and by_email (section 1.1) are NEVER dropped — they stay global
permanently per spec 3.4. Drop order: only after confirming (via
function-spec + a manual read-path grep, same technique as section 2/3 of
this audit) that zero remaining query in convex/ references the old index
name — dropping an index a live query still names would break that query
immediately on deploy.

LIVE ORDER FOR pleasant-cobra-560 (item 8, using the Release A/B/C packaging
defined in section 15). Phase 8 (spec 13) runs these seven steps in this
exact order, each one run by the user himself, after an `npx convex export`
backup taken immediately before step (1):
(1) Deploy RELEASE A (Step A's schema, batch 1, plus convex/migrations.ts,
    batch 3 — see section 15 for the exact file list) to pleasant-cobra-560.
    Purely additive — every existing function keeps working unchanged, and
    createDefaultBoutique now actually EXISTS on this deployment, which is
    the reason Release A must include migrations.ts and not just the schema
    (the earlier draft's gap, item 2, that this revision closes: a schema-
    only step 1 would leave step (2) below with no function to call).
(2) Run createDefaultBoutique on pleasant-cobra-560 (now live, from Release
    A). Creates the one 85-Lansdowne boutiques row.
(3) Run backfillBoutiqueId per table on pleasant-cobra-560 (also from
    Release A), looping each table until `remaining: false`.
(4) Confirm countMissingBoutiqueId is 0 for every one of the 14 tables on
    pleasant-cobra-560 before proceeding.
(5) Deploy RELEASE B (every scoped-code batch, 2 and 4-13 — see section 15
    for the exact file list; convex/testSeed.ts is NEVER part of this or any
    release, per item 3) to pleasant-cobra-560. The live app keeps running
    throughout a Convex deploy (Convex deploys are atomic function-code
    swaps, not downtime), but between the backfill finishing (step 4) and
    this deploy actually going live, the OLD (pre-Release-B) code is still
    running and still inserts new rows with no boutique_id (see item 9's
    "invisible-row window" below).
(6) IMMEDIATELY run a catch-up backfillBoutiqueId pass per table (Release
    A's migrations.ts is still deployed and callable at this point, even
    though Release B has just gone live for every other function) — this
    catches any row the old code inserted between step 3's backfill
    finishing and step 5's new code actually taking over.
(7) Confirm countMissingBoutiqueId is 0 for every table again after the
    catch-up pass, before RELEASE C ever runs.
RELEASE C (batch 15, deploying required-boutique_id schema + dropping old
indexes — see section 15) is then its OWN separate, later deploy — not
folded into step 7 above — run only after a full regression pass (section
9's leak tests plus item 27's regression-number check, plus item 6's
trackActivity-deploy-order regression item) has been repeated against
pleasant-cobra-560's own data post-backfill.
CRONS DURING THE LIVE MIGRATION: Release B's per-boutique cron loops
(generateDailyDrafts / generateDailyNotifications /
generateWeeklyActivityNotifications / generateDailyActivitySummaries, all
per spec 10) must NEVER be the live code before step (2) has created the
default boutique — if Release B deploys at step (5) and a cron fires before
step (2) has run (it hasn't, by the ordering above, but this is the explicit
safeguard this audit records), the loop would iterate over zero boutiques
and do nothing (item 20's zero-boutique behaviour) rather than erroring, so
even an out-of-order deploy fails SAFE (silently does nothing) rather than
crashing — but the correct order above still always runs step (2) before
step (5), so this should never actually happen.

THE INVISIBLE-ROW WINDOW (item 9). Between step (3)'s backfill finishing and
step (5)'s Release B actually going live, the OLD (pre-Release-B, currently
running) code is still the one handling every merchant click and customer
action — and the OLD code's insert sites (section 2's list) do not know
about boutique_id at all, so any row the OLD code inserts during this window
has NO boutique_id. Once step (5)'s Release B is live, every READ in it goes
through a
boutique-scoped index (by_boutique_*), which by definition does NOT return a
row whose boutique_id is undefined — so a row written during the window
becomes effectively INVISIBLE to the new scoped reads (it exists in the
table, but no boutique-filtered query will ever surface it) until something
patches boutique_id onto it. HOW LONG THE WINDOW LASTS: from the moment step
(3)'s backfill call returns `remaining: false` for every table, to the
moment step (5)'s deploy actually finishes and the new function code is
serving traffic — in practice, however long it takes the user to run `npx
convex deploy` (typically well under a minute for this project's bundle
size), not an extended period, but non-zero. SAFEGUARD: step (6)'s immediate
catch-up backfillBoutiqueId pass closes the window by patching any row
inserted during it — this is why step (6) is a MANDATORY, not optional, part
of the live order, run right after step (5)'s deploy completes, before any
user-visible verification happens. WHETHER SCOPED READS SHOULD FALL BACK TO
THE DEFAULT BOUTIQUE for undefined-boutique_id rows until Step C: this audit
recommends AGAINST a fallback-to-default read path. A silent fallback would
mean a boutique-scoped query could, for a few seconds during every future
deploy of scoped code, return a row that might belong to a DIFFERENT
boutique's in-flight write (not just 85 Lansdowne's) if this pattern is ever
reused for a later deploy after a second boutique exists — baking in a
fallback now would need to be deliberately removed later, which is a worse
shape than relying on the mandatory immediate catch-up backfill (step 6),
which is a one-time, bounded, explicitly-run action with a confirming count
check (step 7) rather than a standing read-time behaviour. The RECOMMENDED
approach is: no fallback in read code, ever; close the window with the
mandatory catch-up step instead, and accept that the window only exists
during the ONE deploy that flips old code to scoped code, never again
afterward.

8. TEST DATA PLAN FOR aware-rabbit-290

Design: internal mutations in a new file convex/testSeed.ts:
seedMultiBoutiqueTestData, seedLegacyRows (item 2, described in section 7
above), and wipeMultiBoutiqueTestData — all three guarded by the SAME check
at the top of their handler: `if (process.env.ALLOW_TEST_SEED !== "true") {
throw new Error("test seed is disabled"); }`.
TEST ENV VARS (item 7): ALLOW_TEST_SEED (and, when the one-device lock itself
needs testing per batch 4's new test, ONE_DEVICE_LOCK) are Convex deployment
env vars set ONLY by the user himself, running `npx convex env set
ALLOW_TEST_SEED true` (and similarly for ONE_DEVICE_LOCK) directly in the NEW
folder against aware-rabbit-290 — no agent ever runs an env command, per the
STRICT rule in every task in this project. ALLOW_TEST_SEED must NEVER be set
on pleasant-cobra-560, AND convex/testSeed.ts itself is never part of any
code deployed there (see section 15 — Release A and Release B are both
built without this file; it stays only on the multi-boutique branches until
Phase 8, where it is removed entirely, never released).
TEST MARKER (item 3, replacing the earlier "Test "-prefix convention with one
strong, mechanically-checkable marker): every row this file's mutations
create uses the name prefix "MBTEST " (note the trailing space) wherever a
name field exists, AND, for `users` rows specifically, a mobile number in the
fixed range "0000000001" to "0000000099" — both conditions together, not
either alone, so a coincidental real customer whose name happens to start
with "MBTEST " (vanishingly unlikely, but not impossible) is still never
touched unless their mobile ALSO happens to fall in that 99-number synthetic
range (effectively impossible for a real 10-digit Indian mobile, which never
starts with nine zeros).
SECOND LOCK (item 3, replacing the earlier weak version): the earlier
version only refused when "a boutiques row with is_default: true already
exists AND that default boutique already has more than a handful of real
customer rows" — this check is WEAK exactly in the window this revision
closes: immediately after Release A is deployed (Step A's schema +
migrations.ts) but BEFORE createDefaultBoutique has ever run, there is NO
default boutique row yet at all, so the old lock's "if a default boutique
exists" condition was simply FALSE and provided zero protection in exactly
the moment a mistaken ALLOW_TEST_SEED=true on pleasant-cobra-560 would be
most dangerous (a freshly-deployed Release A with 107 real users and no
boutique yet). THE NEW LOCK does not depend on any boutique existing at all:
all three functions (seedMultiBoutiqueTestData, seedLegacyRows,
wipeMultiBoutiqueTestData) query the `users` table directly and refuse to
run if ANY row exists whose name does NOT start with "MBTEST " (regardless
of whether a default boutique exists, regardless of ALLOW_TEST_SEED's
value) — on a genuine test deployment (aware-rabbit-290, freshly reset or
already fully test-seeded), every single user row is expected to be
MBTEST-marked, so this check passes trivially; on pleasant-cobra-560, where
107 real, non-MBTEST customer/merchant rows already exist today, this check
refuses immediately and permanently, with or without a default boutique,
with or without ALLOW_TEST_SEED mistakenly set. This is strictly stronger
than the old lock and closes the exact gap the old one had.
seedMultiBoutiqueTestData creates:
- Two boutiques rows: "MBTEST Boutique Alpha" (slug "mbtest-alpha",
  is_default: true, since aware-rabbit-290 starts with zero boutiques and
  the test environment needs its own default) and "MBTEST Boutique Beta"
  (slug "mbtest-beta", is_default: false) — exactly the two-boutique shape
  every leak test in section 9 needs, and both names carry the "MBTEST "
  marker per the TEST MARKER definition above, so wipeMultiBoutiqueTestData
  can find them directly by name.
- One merchant user per boutique. TEST MERCHANT LOGIN (item 6): names are
  obviously fake ("MBTEST Merchant Alpha"/"MBTEST Merchant Beta") and emails
  are obviously fake ("merchant-alpha@test.invalid"/"merchant-beta@test.invalid"),
  but the PASSWORD is never hardcoded, never written into convex/testSeed.ts,
  never committed, and never printed in chat — the mutation takes the
  password as an ARGUMENT, supplied by the user himself when he invokes
  seedMultiBoutiqueTestData (e.g. via `npx convex run testSeed:
  seedMultiBoutiqueTestData '{"password":"<whatever the user types>"}'` run
  by the user, not by an agent), and the handler hashes it with the exact
  same bcrypt method auth.ts's merchantLogin/createCustomer already use
  before storing it on the merchant row — identical to how a real merchant's
  password is handled today, just test-boutique-scoped.
- A few (3-5) customer users per boutique with names "MBTEST Customer A1",
  "MBTEST Customer A2", etc., and mobiles drawn from the fixed range
  "0000000001" to "0000000099" (item 3's marker — split across both test
  boutiques, e.g. Alpha uses ..0001-..0010, Beta uses ..0011-..0020, leaving
  the rest of the range free for seedLegacyRows), no email field set.
- 1-2 lookbooks and 2-4 catalogue_items per boutique.
- 1-2 orders, 1-2 reviews (one pending, one approved), a couple of
  points_ledger rows, and a couple of customer_activity_events rows per
  boutique customer, so every table in section 1 has at least one row under
  each test boutique.
EVERY inserted row carries the "MBTEST " name-prefix marker wherever a name
field exists (users, boutiques, lookbooks, campaigns all have a name/title
field; catalogue_items/orders/reviews/message_actions/points_ledger/
ai_message_drafts/events/notifications/customer_activity_events/
customer_activity_summaries do not, and are instead matched transitively —
see WIPE MATCHING below). wipeMultiBoutiqueTestData deletes:
- `users` rows matching BOTH the "MBTEST " name prefix AND a mobile in
  "0000000001".."0000000099" (both conditions, not either alone, per the
  TEST MARKER definition above).
- `boutiques` rows whose name starts with "MBTEST " (the two test boutiques).
- Every row in every OTHER table (catalogue_items, orders, reviews,
  message_actions, points_ledger, ai_message_drafts, events, notifications,
  customer_activity_events, customer_activity_summaries, lookbooks,
  campaigns) that belongs to one of the matched boutiques (via boutique_id,
  once Step A's field exists) OR one of the matched customers (via
  customer_id/user_id) — i.e. wipe never deletes by content-matching a
  table that itself carries no marker; it always joins back to an already-
  verified MBTEST boutique or customer row first.
This two-part match (name prefix AND mobile range for users; boutique_id/
customer_id join for everything else) means a real customer whose name
happens to start with "Test" (a plausible real name, unlike "MBTEST") can
NEVER be deleted by this mutation, since their real mobile number will not
also fall in the synthetic "0000000001".."0000000099" range. The same
ALLOW_TEST_SEED + second-lock guard (above) applies to the wipe mutation too.

9. LEAK TEST LIST

For every id-taking function listed in section 3's ownership-check list and
section 4's "OWN: YES" column, using the two test boutiques from section 8:
- getCustomerById/updateMeasurements/addStaffNote/updateCustomTags/
  updateCustomerProfile/awardPoints/recordMessageAction/deleteCustomer/
  getPointsHistory/getDraftForCustomer/getCustomerIntelligenceProfile
  (customers.ts): merchant-alpha's session + a Test Beta customer's id must be
  refused (not silently return null — refused with an explicit error, so a
  future caller can't mistake "refused" for "not found").
- bulkDeleteCustomers (customers.ts:1154): merchant-alpha's session + a list
  mixing Test Alpha and Test Beta customer ids must refuse the Beta ids and
  only act on the Alpha ones (or refuse the whole batch — either is
  acceptable, but it must never delete a Beta row).
- getOrdersByUser, createOrder (orders.ts): merchant-alpha + Test Beta
  customer id must be refused.
- updateLookbook, deleteLookbook, updateCatalogueItem, deleteCatalogueItem
  (lookbooks.ts): merchant-alpha + a Test Beta lookbook/item id must be
  refused.
- getLookbookById, getCatalogueItemById (lookbooks.ts): a Test Alpha
  customer's token/slug + a Test Beta lookbook/item id must return nothing
  (not the Beta item).
- getCustomerCatalogue (lookbooks.ts:204): a Test Alpha customer's token must
  NEVER see a Test Beta catalogue item in the returned list (the core Phase 0
  leak test, repeated here as the primary regression check for section 6.1's
  fix).
- getOrCreateHomeLookbook (lookbooks.ts:83-98, see section 6.1's extended
  fix): seeding two boutiques that each lack a home lookbook must produce TWO
  separate "Current catalogue" rows, one per boutique, never one shared row.
- deleteEvent, markEventDispatchedInternal, dispatchEvent (events.ts):
  merchant-alpha + a Test Beta event id must be refused.
- getEventAccess (events.ts:493): a Test Alpha customer's resolved boutique +
  a Test Beta event id must return access-denied, not the Beta event's
  details.
- approveReview, declineReview (reviews.ts): merchant-alpha + a Test Beta
  review id must be refused.
- getSettings, getTemplateCardUrls (settings.ts): a request resolved to Test
  Alpha's boutique must return Test Alpha's settings/template, never Test
  Beta's, even if both boutiques have a document under the same `key`.
- markAllSeen, deleteNotification (notifications.ts): merchant-alpha + a Test
  Beta notification id must be refused.
- trackActivity (activity.ts:47, after the section 6.2 fix): a token
  belonging to a Test Alpha customer, combined with a `customerId` argument
  that is actually a Test Beta customer's id, must write nothing (the token-
  to-customerId mismatch check is itself the leak test for this function).
- createCustomer, generateMagicTokenSelf, generateMagicToken (the public-path
  functions): a mobile number that exists as a Test Alpha customer must be
  creatable as a SEPARATE, independent customer under Test Beta (per spec 3.4,
  "the same person can be a customer of two boutiques") — this is a positive
  test (must succeed, not refuse) proving per-boutique mobile uniqueness
  works as designed, not a leak refusal.
- magicTokenByMobile / createCustomerByMobile rate limiters (item 15): a Test
  Alpha customer and a Test Beta customer sharing the SAME mobile digits must
  each get their OWN rate-limit bucket (exhausting Alpha's bucket must not
  block Beta's attempt with the same mobile) — the positive proof that the
  boutique-prefixed rate-limiter key fix (section 4) actually works.
- backfillBoutiqueId / countMissingBoutiqueId (item 1, convex/migrations.ts):
  using seedLegacyRows (section 7/8), the full before/zero/re-run-is-0 sequence
  described in section 7's "LEGACY TEST DATA" paragraph is itself a leak-
  adjacent correctness test — it proves the migration cannot leave a row
  permanently invisible nor double-process an already-migrated row.

10. BUILD BATCHES

Batch 1 — schema Step A (1 file): convex/schema.ts. Adds boutiques,
boutique_secrets, optional boutique_id on all 14 tables, every new
by_boutique_* index alongside the old ones. Test: npx convex function-spec
total is 121 (unchanged — no function signatures changed yet, schema only),
plus a manual check that every existing query in convex/ still compiles/
deploys unchanged (the field is optional, nothing reads it). Needs a deploy
to aware-rabbit-290: YES (schema changes require a deploy to take effect,
even with nothing else changed).

Batch 2 — shared boutique helper and test seed (2 files): a new
convex/boutiques.ts (boutique-resolution helpers: resolve-by-slug,
resolve-default, the shared ownership-assert helper for spec 4.4 — plain
TypeScript helpers, not themselves registered Convex functions, so they add
0 to the function-spec count) plus convex/testSeed.ts (section 8's
seedMultiBoutiqueTestData, seedLegacyRows, and wipeMultiBoutiqueTestData — 3
new internalMutation functions). Test: `npx convex run` (against
aware-rabbit-290 only, folder and .env.local confirmed first) of
seedMultiBoutiqueTestData and seedLegacyRows with ALLOW_TEST_SEED unset,
confirming both refuse; set ALLOW_TEST_SEED (by the user, not this batch's
test) and re-run, confirming success; `npm run build` passes. Needs a deploy
to aware-rabbit-290: YES. Expected npx convex function-spec total after this
batch: 124 (121 + seedMultiBoutiqueTestData + seedLegacyRows +
wipeMultiBoutiqueTestData).

Batch 3 — migration functions (1 file): a new convex/migrations.ts
(createDefaultBoutique, backfillBoutiqueId, countMissingBoutiqueId — item 1,
3 new internal functions). Test: with seedLegacyRows (batch 2) already run,
`npx convex run` countMissingBoutiqueId per table confirms count > 0;
createDefaultBoutique then backfillBoutiqueId per table (looping to
`remaining: false`); countMissingBoutiqueId confirms 0 for every table; a
second backfillBoutiqueId run confirms `patched: 0` (re-run safety, section
7's full sequence). Needs a deploy to aware-rabbit-290: YES. Expected
function-spec total: 127 (124 + 3).

Batch 4 — auth.ts scoping (1 file): all 10 functions' boutiqueId source
(mostly PARENT/SLUG per section 4), the generateMagicToken/
generateMagicTokenSelf slug-argument additions, the mobile-uniqueness-site
fixes at auth.ts:289,348 (item 13), and the rate-limiter key fix for
magicTokenByMobile (item 15, auth.ts:282,341). Test: merchantLogin's reply
carries boutiqueId; generateMagicTokenSelf/generateMagicToken accept and
resolve a boutique slug without breaking the slug-less 85-Lansdowne default
(item 17); a Test Alpha and Test Beta customer sharing one mobile digit
string each get an independent magicTokenByMobile bucket (item 15's leak
test); the one-device-lock regression check (item 16) confirms
sessionLock.ts's refusal behaviour is byte-identical to today; `grep -o
'await requireMerchantSession(ctx' convex/*.ts | wc -l` is still exactly 62
(item 12, run in every remaining batch's test too). Needs a deploy: YES.
Expected function-spec total: 127 (unchanged — no new functions, only
argument/logic changes to the existing 10).

Batch 5 — the two first fixes (3 files): convex/lookbooks.ts
(getCustomerCatalogue AND getOrCreateHomeLookbook together, section 6.1 —
item 3 closes the earlier draft's placement error), convex/activity.ts
(trackActivity, section 6.2), and src/lib/db.js (the 3 trackActivity
call-site touch-ups, section 5). Test: using the two seeded test boutiques
(batch 2), confirm getCustomerCatalogue for a Test Alpha token never returns
a Test Beta item (section 9's primary leak test); confirm two boutiques each
lacking a home lookbook get their OWN separate "Current catalogue" row
(section 9's getOrCreateHomeLookbook test); confirm trackActivity refuses a
token/customerId mismatch; the 62-caller requireMerchantSession grep still
holds. Needs a deploy to aware-rabbit-290: YES. Expected function-spec total:
127 (unchanged — these are modifications to existing functions, not new
ones).

Batch 6 — customers.ts scoping (1 file): all 21 functions' boutiqueId
source + index switch + ownership checks from section 4, the
mobile-uniqueness fixes at customers.ts:1031,955,1288,1428 (item 13), the
createCustomerByMobile rate-limiter key fix (item 15, customers.ts:1021), and
the getCustomersPaginated cursor-behaviour regression test (item 25). Test:
section 9's customer-table leak tests, plus a regression check that
getCustomers/getCustomersPaginated for the 85-Lansdowne-shaped seed data
still returns the same customers in the same order it did before (item 25's
pagination test, sanity not a leak test); 62-caller grep still holds. Needs
a deploy: YES. Expected function-spec total: 127 (unchanged).

Batch 7 — orders.ts and reviews.ts scoping (2 files): 5 + 5 functions. Test:
section 9's order/review leak tests; 62-caller grep still holds. Needs a
deploy: YES. Expected function-spec total: 127 (unchanged).

Batch 8 — lookbooks.ts remaining scoping (1 file): the other 12 functions in
lookbooks.ts not already covered by batch 5 (getLookbooks,
getLookbooksForSelector, getLookbookById, getCatalogueItemById,
createLookbook, updateLookbook, deleteLookbook, addCatalogueItem,
updateCatalogueItem, deleteCatalogueItem, createPdfLookbook,
checkMerchantSession), PLUS generatePdfUploadUrl's upload-path boutique-slug
prefix fix (item 19, lookbooks.ts:546) — generatePdfUploadUrl itself is
counted in this batch's 13 functions (getOrCreateHomeLookbook's own fix is
already done in batch 5, correctly removed from this batch's scope per item
3). Test: section 9's lookbook/item leak tests; a new PDF upload on
aware-rabbit-290 produces a pathname starting with the resolved boutique's
slug; existing (pre-batch-8) uploaded files are confirmed unmoved; 62-caller
grep still holds. Needs a deploy: YES. Expected function-spec total: 127
(unchanged).

Batch 9 — settings.ts scoping (1 file): all 11 functions, including the
upsertSettings shared helper (section 2) and the default-boutique resolution
for the un-authenticated getSettings/getTemplateCardUrls callers (item 17).
Test: section 9's settings leak test (same key, two boutiques, two different
values, each boutique only ever sees its own); a call with no slug/token at
all still returns 85 Lansdowne's settings (item 17's regression); 62-caller
grep still holds. Needs a deploy: YES. Expected function-spec total: 127
(unchanged).

Batch 10 — events.ts and notifications.ts scoping (2 files): 12 + 3
functions, including the getEventAccess fix (section 9's dedicated leak test
for that function). Test: as above plus the events/notifications leak tests;
62-caller grep still holds. Needs a deploy: YES. Expected function-spec
total: 127 (unchanged).

Batch 11 — ai.ts, whatsapp.ts, templates.ts scoping (3 files): 16 + 4 + 2 = 22
functions, each change mechanical (add an explicit boutique_id/boutiqueId
argument and switch the index/read boutique_secrets instead of
process.env, no new logic), PLUS generateTemplateMediaUploadUrl's upload-path
boutique-slug prefix fix (item 19, templates.ts:78). Test: AI drafts and
WhatsApp sends for the two seeded test boutiques never mix boutique names/
credentials; a new template-media upload produces a boutique-slug-prefixed
pathname; 62-caller grep still holds. Needs a deploy: YES. Expected
function-spec total: 127 (unchanged).

Batch 12 — crons.ts and dashboard.ts scoping (2 files): 13 + 2 = 15
functions, including turning generateDailyDrafts/generateDailyNotifications/
generateWeeklyActivityNotifications/generateDailyActivitySummaries
(crons.ts) into per-boutique loops per spec 10, and the zero-boutique
no-crash test (item 20). Test: trigger each cron action on aware-rabbit-290
BEFORE running the test seed, confirm it completes with no error and no
writes (item 20's zero-boutique case); re-trigger after seeding the two test
boutiques, confirming each produces drafts/notifications/summaries scoped to
the right boutique only; getDashboardSummary's three sums (ledger/orders/
reviews) each return only the calling merchant's boutique total; 62-caller
grep still holds. Needs a deploy: YES. Expected function-spec total: 127
(unchanged).

Batch 13 — platformStats.ts and http.ts (2 files): the spec 9 "gains a
boutique parameter and a list mode" change, the one exception to per-boutique
scoping (spec 5), keeping the exact 11-field response shape (item 18) for a
no-boutique-parameter call. Test: the stats endpoint, called exactly as the
Platform Admin calls it today (no new parameter), returns the exact same 11
fields it does today for 85 Lansdowne (item 18's regression — the actual
numbers, per item 27 below, must also match: customers 97, approved reviews
61, points 54,002); called with a list mode against the two test boutiques,
returns one row per boutique with no cross-boutique mixing; 62-caller grep
still holds (irrelevant to this batch's own functions, but re-checked
anyway since it is now every batch's standing test). Needs a deploy: YES.
Expected function-spec total: 127 (unchanged).

Batch 14 — Step B backfill (0 new files, one run of batch 3's
createDefaultBoutique/backfillBoutiqueId/countMissingBoutiqueId against
aware-rabbit-290 first with seedLegacyRows's synthetic legacy data — section
7's full test sequence — then, per item 8's 7-step live order, against
pleasant-cobra-560 after a manual npx convex export backup, run by the user
himself). Test: after backfill, countMissingBoutiqueId is 0 for every one of
the 14 tables on whichever deployment just ran it; the regression-number
check (item 27) on pleasant-cobra-560 specifically: Delight Desk and the
stats endpoint return the same numbers (97 customers, 61 approved reviews,
54,002 points) before and after the backfill, proving no row was lost or
double-counted. Needs a deploy: NO new code deploy on the aware-rabbit-290
run (the mutations already shipped in batch 3); the pleasant-cobra-560 run is
a DATA operation per item 8's live-order steps (2)-(4) and (6)-(7), not a
code batch, interleaved with the actual code deploy at step (5).

Batch 15 — Step C required fields and old-index removal (1 file:
convex/schema.ts again). Makes boutique_id required, drops every superseded
old index per section 7's drop list (by_magic_token and by_email excluded,
stay forever). Test: npx convex function-spec total is still 127 (no function
count change, only schema tightening), and a full re-run of every section 9
leak test plus the item 27 regression-number check plus the full
85-Lansdowne regression checklist from spec 12. Needs a deploy: YES — this
is the last and highest-risk batch, since it is the only one that can break
a live read if any function was missed in batches 4-13 (hence running it
last, after every other batch is proven, and only after item 8's live-order
steps (1)-(7) are already confirmed complete on pleasant-cobra-560).

15 batches total (13 code batches + 1 data-only backfill batch + 1
schema-finisher batch), every batch within the 1-to-3-file limit. Function
coverage check: batch 1 (0 new, 121 existing unaffected) + batch 2 (3 new:
seedMultiBoutiqueTestData, seedLegacyRows, wipeMultiBoutiqueTestData) + batch
3 (3 new: createDefaultBoutique, backfillBoutiqueId, countMissingBoutiqueId)
+ batch 4 (10 existing, auth.ts) + batch 5 (1 existing modified in place,
trackActivity; getCustomerCatalogue and getOrCreateHomeLookbook are both
inside lookbooks.ts's existing 14, modified not added) + batch 6 (21
existing, customers.ts) + batch 7 (10 existing, orders.ts+reviews.ts) +
batch 8 (13 existing, lookbooks.ts's remaining 13 of 14 — getCustomerCatalogue
already done in batch 5) + batch 9 (11 existing, settings.ts) + batch 10 (15
existing, events.ts+notifications.ts) + batch 11 (22 existing,
ai.ts+whatsapp.ts+templates.ts) + batch 12 (15 existing,
crons.ts+dashboard.ts) + batch 13 (2 existing, platformStats.ts+http.ts) =
existing-function sum: 10+1+21+10+13+11+15+22+15+2 = 120, plus
getCustomerCatalogue's companion getOrCreateHomeLookbook fix (counted once,
inside lookbooks.ts's 14, split across batch 5 and batch 8 exactly as before)
= 121 existing functions, all covered with no gap. New-function sum: batch 2
(3) + batch 3 (3) = 6 new functions. TOTAL after all 15 batches: 121 + 6 =
127 functions, matching every batch's "expected function-spec total" column
above.

11. RISKS FOR 85 LANSDOWNE

- VERCEL PREVIEW BACKEND — BLOCKER BEFORE ANY CODE PUSH (item 22). The
  frontend gets its Convex backend URL from `import.meta.env.VITE_CONVEX_URL`
  (src/main.jsx:10-11: `new ConvexReactClient(import.meta.env.VITE_CONVEX_URL)`
  and `setConvexClient(convex, import.meta.env.VITE_CONVEX_URL)`). When any
  branch of this repository is pushed to GitHub, Vercel automatically builds
  a Preview deployment for it, and that Preview build resolves
  VITE_CONVEX_URL from whatever value Vercel's Preview environment has
  configured for this project TODAY — which may be the LIVE pleasant-cobra-560
  URL (this audit did not open the Vercel dashboard to check, per the STRICT
  rule, so this must be treated as unconfirmed and risky by default). If so,
  pushing any Phase 1 CODE batch (batches 1-13, 15) to a branch would produce
  a live Vercel Preview URL that talks directly to the LIVE 85 Lansdowne
  backend while running code that has not yet been deployed to that backend
  via `npx convex dev`/`deploy` — at best a broken preview, at worst (once
  Phase 1 code assumes boutique_id exists before the live backend's schema
  has it) a crash on every preview page load. THIS IS A BLOCKER: before any
  Phase 1 CODE batch is pushed to GitHub, the user must set a BRANCH-SPECIFIC
  Preview-environment value of VITE_CONVEX_URL, pointed at the
  aware-rabbit-290 URL, for feat/multi-boutique-phase1 AND for the
  feat/multi-boutique integration branch AND for every later
  feat/multi-boutique-phase* branch (section 15's branching strategy — main
  itself is never affected, since per section 15 no phase branch is ever
  merged into main until Phase 8), in the Vercel dashboard, himself (this audit does not
  open Vercel, per the STRICT rule). Pushing DOCUMENTATION-ONLY commits (like
  this audit itself, and the earlier Phase 0 audit/spec commits) is SAFE,
  since no code path changes and the Preview build's behaviour is identical
  to main's — the blocker applies only once batch 1 or later actually ships
  code.
- CONVEX DEV IN THE WORKTREE (item 23). Every deploy to aware-rabbit-290
  across all 15 batches uses `npx convex dev --once` run in THIS NEW folder
  only (/mnt/c/Users/ASUS/Downloads/loyaltyos-boutique/loyaltyos-multi-boutique)
  — never in the OLD folder, which stays on main pointed at pleasant-cobra-560
  throughout all of Phase 1's build-and-test work. As observed during Phase
  0b/0c of this build, running the Convex CLI in this worktree can rewrite
  CLAUDE.md and convex/_generated/ai/* as a side effect; after every such
  deploy, these must be restored with `git restore CLAUDE.md
  convex/_generated/ai/ai-files.state.json convex/_generated/ai/guidelines.md`
  (or whichever of the three actually shows modified) and NEVER committed,
  exactly as done after the Phase 0b/0c test-backend setup.
- AGGREGATE SCALE (item 24). Even after every batch in section 10 ships,
  getDashboardSummary (dashboard.ts:38) and computeStats (platformStats.ts:35)
  still SUM EVERY ROW of a boutique's points_ledger/orders/reviews on every
  call (a boutique-scoped range read is still a full read of that boutique's
  rows, just no longer of every OTHER boutique's rows too) — this is correct
  and sufficient for Phase 1's goal (no cross-boutique leak, no scan of the
  WHOLE multi-boutique table), but at a large single boutique's customer
  count (thousands of orders/ledger rows), these two functions' per-call cost
  still grows linearly with that one boutique's own data size. A later
  per-boutique running counter or a periodically-refreshed summary row (the
  same pattern customer_activity_summaries already uses) is the natural
  follow-up, but it is explicitly NOT part of Phase 1 — Phase 1's job is the
  data wall (no leak, no whole-multi-boutique-table scan), not a performance
  rewrite of these two functions.
- An earlier draft of section 10 left auth.ts's 10 functions with no batch of
  their own; this is corrected above (batch 4, after the renumbering this
  revision introduces, is now explicitly "auth.ts scoping"), so this is
  recorded here as a caught-and-fixed risk, not an open one — a reminder to
  re-check section 10's function-coverage arithmetic whenever this audit is
  revised.
- An earlier draft also put the backfill's "Test" in batch 13 (now 14)
  without ever specifying WHICH functions it tests, and used seed data that
  already had boutique_id set, so the backfill could never actually be
  exercised; this is corrected by section 7's new migrations.ts functions
  (item 1) and seedLegacyRows (item 2) — recorded here as another
  caught-and-fixed gap, not an open one.
- convex/lookbooks.ts:230 and convex/lookbooks.ts:84 (getOrCreateHomeLookbook)
  both .collect() the whole lookbooks table today; this is now explicitly
  fixed together with getCustomerCatalogue in batch 5 (item 3 — corrected
  from the earlier draft's cross-referencing wording that never actually
  moved it), with its own dedicated leak test in section 9.
- convex/schema.ts's Step A (batch 1) and Step C (batch 15) are the only two
  batches that touch the schema file; if Step C's required-field change ships
  before EVERY function in batches 2-13 has actually been redeployed with its
  boutique_id write path, any function still writing a row without
  boutique_id will fail outright on deploy (a required field with no default)
  — safeguard: batch 15 must run its own `npx convex function-spec` check
  first and confirm zero TypeScript errors on a deploy attempt before making
  the field required; the task's own STRICT rule (no deploy without the
  user's live-step approval) already forces this to be a deliberate,
  separate action.
- Old-index removal (batch 15, section 7's drop list) risks breaking a query
  that still references a dropped index by name if that function's section-4
  "index switch" was missed. Safeguard: the drop order explicitly requires a
  fresh grep (same technique this audit used) for zero remaining references
  before dropping, repeated at drop time, not just planned here.
- settings.ts:565 getTemplateCardUrls and settings.ts:486 getSettings are
  PUBLIC reads with NO guard today (Phase 0a audit section 13); until batch 9
  ships, they remain boutique-unaware and — once ANY second boutique's
  settings row exists in the SAME table — could theoretically be called with
  a key that resolves ambiguously if the by_key index ever returns more than
  one document for a key (it won't, by construction, until boutique_id
  exists on the row, so this is a Step-A/Step-B ordering safeguard: do not
  create a second boutique's settings rows under the SAME `key` value until
  by_boutique_key is live and reads have switched, i.e. do not start Phase 2
  (onboarding a real second boutique) until batch 9 and batch 15 are both
  done).
- getEventAccess (events.ts:493) has zero frontend callers today (grep of
  src/ found none) — safeguard already correct: it is listed in batch 10 for
  completeness and the section 9 leak test exists for when a customer events
  page is eventually built, but it carries no live-break risk for 85
  Lansdowne today since nothing currently calls it.
- The trackActivity frontend change (section 6.2) touches src/lib/db.js,
  which is an ALLOWED file, but its only three call sites are inside
  src/pages/Lookbook.jsx, an approved-flow file (CLAUDE.md 5.4) restricted to
  "auth/waLink" sections — likeItem/trackCartAdd/trackLookbookView's call
  sites (Lookbook.jsx:337,229,189) are NOT auth/waLink sections. Safeguard:
  get explicit approval before editing these three lines in Lookbook.jsx even
  though db.js itself needs no approval, since the CLAUDE.md allowed-edit
  list for Lookbook.jsx is narrower than "the whole file."
- Browser cache keys (item 21, section 5): not a Phase 1 risk today (only one
  boutique is live), but flagged here so Phase 2 does not forget to
  boutique-suffix the three localStorage keys before a second real boutique
  shares a browser with the first.
- No new package may be added to package.json without the user's explicit
  approval (item 4) — every batch's test in section 10 above uses only `npx
  convex run`/`npx convex function-spec` and `npm run build`, with NO new
  dependency (no unit-testing framework package or any other package); if a future batch's
  implementation genuinely needs a new package, that is a separate approval
  request, not something this audit or any batch silently assumes.

12. COUNTS SUMMARY

Insert, patch, replace sites: 50 (grep-confirmed; 0 of these are .replace, all
are .insert or .patch) — unchanged by this revision, since these are counted
against the CURRENT code, not the planned code.
Id-based reads needing the spec 4.4 ownership check: 26 (getCustomerById,
updateMeasurements, addStaffNote, updateCustomTags, updateCustomerProfile,
awardPoints, recordMessageAction, deleteCustomer, bulkDeleteCustomers,
getPointsHistory, getDraftForCustomer, getCustomerIntelligenceProfile,
getOrdersByUser, updateLookbook, deleteLookbook, updateCatalogueItem,
deleteCatalogueItem, getLookbookById, getCatalogueItemById, getEventAccess,
deleteEvent, approveReview, declineReview, getSettings, getTemplateCardUrls,
markAllSeen, deleteNotification — 26 named functions; see section 3's exact
list for the authoritative enumeration).
Full-table scans (no boutique-scoped index) found: 8 (getCustomers,
getCustomerCatalogue, getOrCreateHomeLookbook, getLookbooks/
getLookbooksForSelector counted together as one lookbooks-table scan site,
dashboard.ts's 3 reads [ledger/orders/reviews], platformStats.ts's matching
3 reads [kept as the spec-5 exception, not "fixed" the same way],
findUpcomingInternal's 2 reads — see section 3's full list; the number of
DISTINCT whole-table .collect()/.filter() call sites enumerated in section 3
is 8).
Functions changing among the 121 EXISTING functions (any column in section 4
other than fully "none/no/no/no"): 114 of 121 (the 7 unchanged-in-every-column
functions are: merchantLogout, saveResetToken, getCustomerNameInternal,
getCustomerTierInternal, testGeminiConnection, generateEventPromptFieldsInternal,
markEventDispatchedInternal — each either patches an existing row with no
boutique_id write and no new guard, or does genuinely boutique-agnostic work).
NEW functions added in Phase 1 (item 28): 6 — seedMultiBoutiqueTestData,
seedLegacyRows, wipeMultiBoutiqueTestData (convex/testSeed.ts, batch 2),
createDefaultBoutique, backfillBoutiqueId, countMissingBoutiqueId
(convex/migrations.ts, batch 3). TOTAL functions after Phase 1: 127 (121
existing + 6 new), matching every batch's "expected function-spec total" in
section 10.
Functions whose arguments change (ARGS+ in section 4, among the 121 existing):
41 — unchanged by this revision's additions, since the 6 new functions are
brand-new (they do not "change" an argument shape, they define one).
Frontend call sites changing in Phase 1 itself: 3 (the trackActivity callers
in src/lib/db.js:1700,1725,1745, themselves called from
src/pages/Lookbook.jsx:337,229,189) — the getCustomerCatalogue caller needs
no change (section 6.1), the browser-cache-key fix (item 21) is explicitly
deferred to Phase 2 (not counted here), and the /join slug argument (section
5's last bullet) is explicitly deferred to Phase 2, not counted as a Phase 1
change.
Protected files touched: 0 (Dashboard.jsx, Shell.jsx, Customers.jsx,
Campaigns.jsx, Templates.jsx, PointsLedger.jsx, Settings.jsx, seed.js,
index.css, App.jsx are all untouched by every batch in section 10).
Number of build batches: 15 (13 code batches + 1 data-only backfill batch +
1 schema-finisher batch), every batch within the task's 1-to-3-file limit,
auth.ts included as its own batch (batch 4) with no function-coverage gap,
and the migration functions (item 1) now their own batch (batch 3) rather
than missing one entirely.

13. ROLLBACK

THE GOVERNING CONVEX CONSTRAINT (item 4, corrects a wrong claim in the
previous revision): Convex refuses to deploy a schema that does not match
the documents already stored in the table. This means: the moment ANY row
in ANY table has boutique_id actually set, or the moment ANY row exists in
the new `boutiques` or `boutique_secrets` tables, the schema can NEVER again
be redeployed WITHOUT boutique_id (as a field) or WITHOUT those two tables
(as tables) — Convex would refuse that deploy, because existing documents
would no longer match the (narrower) schema being deployed. The previous
revision's Batch 1 rollback wrongly implied the pre-Step-A schema could
simply be "redeployed" generally; the corrected rule below applies instead.
EVERY rollback in this section is therefore a CODE revert only — reverting
FUNCTION LOGIC to its pre-batch behaviour while the SCHEMA keeps
boutique_id as v.optional and keeps both new tables permanently (once
either has ever been deployed and populated with even one row). The DATA
stays exactly as it is; nothing is ever deleted or unpatched as part of a
rollback.

Batch 1 (schema Step A), BEFORE any data has been written under it: undo by
redeploying the schema without boutiques/boutique_secrets/boutique_id — this
is the ONLY point in the whole plan where a true schema rollback (removing
the fields/tables entirely) is possible, because no document anywhere yet
references them. Batch 1 (schema Step A), AFTER Step B (or any seed/backfill
run) has written even one row: there is NO rollback of the schema itself any
more, per the governing constraint above — the only available action is to
keep the schema (optional boutique_id, both new tables, permanently) and
revert any LATER batch's function code if needed. This distinction — safe to
fully undo only in the brief window before any data exists, permanent
afterward — did not exist clearly in the previous revision and is the
correction this revision makes.
RELEASE A (section 15: schema Step A + migrations.ts together), on
pleasant-cobra-560 specifically: by live-order step (2), createDefaultBoutique
has already run, so Release A's schema can never be un-deployed on
pleasant-cobra-560 once step (2) has executed — only Release A's FUNCTION
CODE (migrations.ts) can later be removed from a subsequent deploy; the
schema and the one boutiques row stay.
Batch 2 (boutiques.ts + testSeed.ts) on aware-rabbit-290 (testSeed.ts is
NEVER deployed to pleasant-cobra-560, so this batch's rollback is
aware-rabbit-290-only): undo by redeploying without these two files (or
reverting the commit). The only state this batch can leave behind is seeded
test rows — run wipeMultiBoutiqueTestData before rolling back the code, or
simply leave the test rows (harmless, isolated by the "MBTEST " name +
mobile-range marker per section 8) if the wipe mutation itself is being
rolled back too. This batch never runs on pleasant-cobra-560 at all (section
15), so it has no live-rollback concern.
Batch 3 (migrations.ts): undo by redeploying without this file — the
FUNCTION CODE (createDefaultBoutique/backfillBoutiqueId/
countMissingBoutiqueId) is removable independently of the schema, per the
governing constraint above. The boutiques row and the patched boutique_id
fields this batch's functions wrote are themselves permanent data (not
removable, not needing removal) once they exist — rolling back the CODE
does not, and cannot, roll back this DATA.
Batches 4-13 (per-file scoping, part of Release B per section 15): undo each
by redeploying the previous version of that one file (every batch is 1-3
files, so a revert is always a small, targeted `git revert`/redeploy of just
those files). Since every function in these batches is a MODIFICATION of an
existing function's internals (argument shape, index, guard), not a schema
change, rolling back any of these batches on either deployment is a pure
code revert with no data implication — the boutique_id fields already
backfilled (if Step B has already run by this point on that deployment) are
simply ignored again by the old, unscoped code, exactly as they were before
Step A. None of these batches can be rolled back on their OWN schema (there
is none to roll back — Release A's schema stays fixed throughout).
Batch 14 (Step B backfill, run under Release A per section 15): has NO
rollback action, by design — not "cannot be undone" in the sense of being
risky, but literally nothing to undo: a backfilled boutique_id is permanent,
harmless additive data (per the governing constraint, it cannot be
unpatched without violating schema-vs-data consistency if boutique_id were
ever later made required, and there is no reason to want to anyway, since
old unscoped code simply ignores the field). If a rollback is needed right
after backfilling live data and before Release B goes live, the backfill is
simply left in place.
Batch 15 / RELEASE C (Step C required fields + old-index removal, section
15): this is the ONE batch where "redeploy the optional version" IS a valid,
safe operation — but only because going from required BACK to optional
WIDENS the constraint (every document that satisfied the stricter required
version automatically still satisfies the looser optional version), which
is the opposite direction from the governing constraint's prohibition (that
constraint blocks NARROWING the schema below what existing data already
has, not widening it back). So: undo by redeploying boutique_id as
v.optional again — safe and reversible as long as every row still has
boutique_id actually set (which it does, since Release A's backfill plus
the live order's step 6/7 catch-up already closed every gap before Release
C ever runs). The DROPPED old indexes (by_mobile, by_tier, etc., per section
7's drop list) are the ONE piece of this batch with NO instant rollback —
dropping an index removes it immediately, and if it is needed again (e.g.
because some function was missed, per section 11's own flagged risk), it
must be RE-ADDED and Convex must rebuild it from scratch over the table's
current row count, costing the same one-time build time Step A's original
add cost, not an instant undo. This is why section 11 insists on a fresh
zero-remaining-references grep immediately before Release C's index drop,
not just once during planning.

STEPS WITH NO ROLLBACK AT ALL (item 4's explicit list): (a) Batch 14 /
Release A's backfill data (harmless to keep, nothing to undo, as above); (b)
any row's boutique_id value, once set by the backfill or by Release B's
scoped inserts, is never unset by any mutation this plan defines — there is
no "un-backfill" function, and none is needed; (c) Release C's dropped
indexes have no INSTANT rollback (only a slower rebuild, as above). Every
OTHER step's rollback is a pure, always-available function-code revert.

14. SELF-CHECK

Item 1 (migration batch, convex/migrations.ts, createDefaultBoutique/
  backfillBoutiqueId/countMissingBoutiqueId): PASS — section 7 ("MIGRATION
  FUNCTIONS"), section 10 (batch 3).
Item 2 (legacy test data, seedLegacyRows): PASS — section 7 ("LEGACY TEST
  DATA FOR THE BACKFILL"), section 8, section 9 (last bullet).
Item 3 (getOrCreateHomeLookbook moved into batch 5, "must move" wording
  removed): PASS — section 6.1 ("ALSO IN THIS FIX"), section 10 (batch 5),
  section 11 (corrected-risk bullet).
Item 4 (no new unit-testing package, no new packages without approval): PASS — section 10
  (every batch's test now says `npx convex run`/`npx convex function-spec`/
  `npm run build` only), section 11 (closing bullet); confirmed by the grep
  in the Report (zero matches for that package name).
Item 5 (expected function-spec total per batch instead of "still returns
  121"): PASS — section 10 (every batch states "Expected function-spec
  total: ###"); confirmed by the grep in the Report (zero "still returns
  121" matches).
Item 6 (test merchant login password as a user-supplied argument, never
  written/committed/printed): PASS — section 8 ("TEST MERCHANT LOGIN").
Item 7 (test env vars set by the user with npx convex env set; never on
  pleasant-cobra-560; double lock): PASS — section 8 ("TEST ENV VARS").
Item 8 (exact 7-step live order for pleasant-cobra-560, crons never live
  before the default boutique exists): PASS — section 7 ("LIVE ORDER FOR
  pleasant-cobra-560").
Item 9 (the invisible-row window, its length, the catch-up safeguard, the
  no-fallback recommendation): PASS — section 7 ("THE INVISIBLE-ROW WINDOW").
Item 10 (rollback per batch, which cannot be undone): PASS — section 13
  (ROLLBACK), new section.
Item 11 (index counts per table today/after Step A vs the 32 limit, build
  cost note): PASS — section 1 ("INDEX COUNT CHECK" under every table,
  summary paragraph at the end of section 1).
Item 12 (session helper return shape unchanged, 62-caller baseline in every
  batch test): PASS — section 4 ("SESSION HELPER SHAPE"), section 10 (every
  batch's test includes the 62-caller grep).
Item 13 (every mobile-dup-check site, file:line, its batch): PASS — section
  4 ("MOBILE UNIQUENESS SITES"), section 9 (positive test), section 10
  (batches 4 and 6).
Item 14 (merchant email stays global, where it's looked up): PASS — section
  4 ("MERCHANT EMAIL UNIQUENESS"), section 1.1 (by_email entry), section 11.
Item 15 (rate limiter names/keys, boutique-in-key fix, which need it): PASS —
  section 4 ("RATE LIMITER KEYS"), section 9 (leak test), section 10 (batches
  4 and 6).
Item 16 (one-device lock unchanged in Phase 1, auth batch test added): PASS —
  section 4 ("ONE-DEVICE LOCK UNCHANGED"), section 10 (batch 4's test).
Item 17 (public functions with no slug/token default to 85 Lansdowne, listed
  with file:line): PASS — section 4 ("PUBLIC FUNCTIONS WITHOUT CONTEXT IN
  PHASE 1"), section 10 (batches 4 and 9).
Item 18 (stats endpoint response fields that must not change): PASS —
  section 4 ("STATS ENDPOINT RESPONSE SHAPE"), section 10 (batch 13).
Item 19 (upload paths get boutique-slug prefix, which batch, file:line,
  existing files not moved): PASS — section 4 (two "UPLOAD PATH" notes under
  lookbooks.ts and templates.ts), section 10 (batches 8 and 11).
Item 20 (cron behaviour with two boutiques and with zero boutiques): PASS —
  section 4 ("CRON BEHAVIOUR DURING PHASE 1"), section 7 (live-order crons
  note), section 10 (batch 12's test).
Item 21 (browser cache keys, file:line, which hold boutique data, which
  phase, protected-file status): PASS — section 5 ("BROWSER CACHE KEYS"),
  section 11 (deferred-to-Phase-2 risk note).
Item 22 (Vercel preview backend blocker before any code push): PASS —
  section 11 (first bullet, explicitly marked BLOCKER).
Item 23 (convex dev in the worktree, CLAUDE.md/generated-ai restore, old
  folder never used): PASS — section 11 ("CONVEX DEV IN THE WORKTREE").
Item 24 (aggregate scale follow-up, not part of Phase 1): PASS — section 11
  ("AGGREGATE SCALE").
Item 25 (pagination cursor/ordering confirmation): PASS — section 4
  ("PAGINATION CURSOR BEHAVIOUR"), section 10 (batch 6's test).
Item 26 (backfill includes soft-deleted and test rows, counts unchanged):
  PASS — section 7 ("SOFT-DELETED AND TEST ROWS" under Step B).
Item 27 (regression-number proof on aware-rabbit-290 and live after Phase
  8): PASS — section 7 (cross-referenced from item 26), section 10 (batches
  13 and 14's tests), section 13 (batch 14 entry).
Item 28 (renumbered batches, recounted function coverage, section 12
  updated, every batch still 1-3 files): PASS — section 10 (batches 1-15,
  renumbered and recounted), section 12 (all counts updated: 127 total
  functions, 6 new, 15 batches).
Item 29 (this self-check table): PASS — this section (14), new section.
Item 30 (no app file other than this audit changed; no commit; no convex
  command run in this revision): PASS — see the Report's confirmation line
  and the final git status --short output, both showing only this one file
  touched and zero convex commands run during this revision.
Item 31 (branching/release strategy: feat/multi-boutique integration
  branch, main stays live-equal until Phase 8, urgent-fix path, Vercel
  blocker extended to feat/multi-boutique*): PASS — section 15 ("RELEASE
  PLAN"), section 11 (Vercel-preview-blocker bullet, updated).
Item 32 (Release A must contain migrations.ts so createDefaultBoutique can
  actually run at live-order step 2): PASS — section 15 ("THE THREE
  RELEASES"), section 7 ("LIVE ORDER FOR pleasant-cobra-560", rewritten).
Item 33 (testSeed.ts excluded from every release; strong second lock keyed
  on any non-marked users row, independent of boutique existence): PASS —
  section 8 ("TEST ENV VARS", "SECOND LOCK"), section 15 ("THE THREE
  RELEASES", testSeed.ts exclusion), section 9/13 (marker updated to
  "MBTEST ").
Item 34 (rollback correction: Convex refuses a narrower schema once data
  exists; rollback means code revert only, data stays; which steps have no
  rollback): PASS — section 13 (rewritten in full, "THE GOVERNING CONVEX
  CONSTRAINT" and "STEPS WITH NO ROLLBACK AT ALL").
Item 35 (consistency pass: fixed the Step-B same-deploy claim, old
  live-order wording, the old name-prefix marker, confirmed batch counts
  unchanged and correct): PASS — section 7 (Step B bullet rewritten),
  section 13 (rewritten), section 8/9 (marker updated); see the Report's
  consistency-pass list for every exact change.
Item 36 (trackActivity deploy order: backend-before-frontend for Release B,
  silent-drop behaviour for old cached browsers confirmed from the actual
  code, added to the regression checklist): PASS — section 6.2 ("DEPLOY
  ORDER FOR THIS CHANGE"), section 7 (live-order cross-reference), section
  15 (Release B definition).
Item 37 (backfill per-mutation read/write limits, batch size margin, scales
  by looping): PASS — section 7 ("BACKFILL LIMITS").
Item 28 recheck (batch/function counts unchanged by this revision): CONFIRMED
  STILL ACCURATE — this revision added no new convex/ files or functions
  beyond revision 2's migrations.ts/testSeed.ts (6 new functions, 127 total,
  15 batches); section 12's counts are unchanged and still match section 10
  exactly, since this revision's changes are to the LIVE RELEASE PACKAGING
  (section 15) and to documentation accuracy (sections 7/8/9/13), not to the
  build batches themselves.

15. RELEASE PLAN

BRANCHING STRATEGY (item 1, the user's decision). Every multi-boutique phase
branch (feat/multi-boutique-phase1, and every later feat/multi-boutique-
phase2, phase3, etc.) is merged with --no-ff into ONE integration branch,
feat/multi-boutique — NEVER into main. main stays EXACTLY equal to what is
live for 85 Lansdowne (pleasant-cobra-560 plus the live Vercel frontend)
until Phase 8, when the full multi-boutique build is finally ready to go
live. Any URGENT 85-Lansdowne-only fix (a bug on the live app that cannot
wait for Phase 8) is made on its OWN branch cut from main, merged back into
main the usual way (per CLAUDE.md's branch flow), deployed to
pleasant-cobra-560 as normal — and THEN, separately, merged from main INTO
feat/multi-boutique, so the integration branch stays current with whatever
is actually live and never diverges permanently from production fixes.
WHY NOT MERGE PHASE BRANCHES INTO MAIN: Vercel builds and deploys a
PRODUCTION frontend from whatever is on main (not a preview — main IS the
production branch). If any Phase 1+ branch were merged into main, the next
Vercel production deploy would ship the NEW frontend (expecting boutique_id,
slugs, the new `token` argument on trackActivity, etc.) to real customers
and merchants, while pleasant-cobra-560 (the live Convex backend) STILL RUNS
THE OLD, UNSCOPED FUNCTIONS — because no Phase 1+ code has been deployed to
pleasant-cobra-560 yet (that only happens at Phase 8's live order, section
7). The new frontend calling the old backend would immediately break real
customer/merchant flows (missing arguments, unknown fields, exactly the
mismatch class item 6/36 describes for trackActivity, but potentially for
every scoped function). Keeping main untouched until Phase 8 is what
prevents this. A SECONDARY reason: main would also then hold convex/ source
code that does not match what is actually deployed on pleasant-cobra-560 —
confusing for anyone reading main expecting it to reflect the live backend's
real behaviour, and risky if `npx convex dev`/`deploy` were ever accidentally
run against pleasant-cobra-560 from a main checkout before Phase 8 is ready.
VERCEL PREVIEW BLOCKER EXTENDED (ties to section 11's existing BLOCKER
bullet): the blocker applies to feat/multi-boutique itself and to every
feat/multi-boutique-* phase branch — any push of CODE (not documentation) on
ANY of these branches triggers a Vercel Preview build, and that Preview
build's VITE_CONVEX_URL must be pointed at aware-rabbit-290 (not
pleasant-cobra-560) in the Vercel dashboard, by the user, before the first
code push to ANY of these branches — not just feat/multi-boutique-phase1.

THE THREE RELEASES (item 2). Phase 1's code is packaged into three named
releases for the LIVE deploy to pleasant-cobra-560 (Phase 8, section 7's live
order) — these release names do NOT change the build-batch numbering in
section 10 (batches 1-15 are still the TEST-branch build-and-verify order
against aware-rabbit-290; releases are how that already-proven code gets
bundled for the ONE-TIME live deploy):
- RELEASE A = batch 1 (convex/schema.ts's Step A changes: boutiques table,
  boutique_secrets table, optional boutique_id on all 14 existing tables,
  every new by_boutique_* index) PLUS batch 3 (convex/migrations.ts:
  createDefaultBoutique, backfillBoutiqueId, countMissingBoutiqueId). Files:
  convex/schema.ts, convex/migrations.ts. Built from feat/multi-boutique (the
  integration branch, once batches 1 and 3 have both been merged into it from
  feat/multi-boutique-phase1). Release A deliberately EXCLUDES
  convex/boutiques.ts and convex/testSeed.ts (batch 2) — the ownership-check
  helper is not needed until Release B's scoped functions use it, and
  testSeed.ts must NEVER be deployed to pleasant-cobra-560 at all (item 3).
  Deployed at live-order step (1); createDefaultBoutique and
  backfillBoutiqueId run at steps (2)-(3)/(6) from this release.
- RELEASE B = every remaining scoped-code batch: batch 2's
  convex/boutiques.ts ONLY (NOT convex/testSeed.ts — excluded, same reason
  as above), plus batches 4-13 in full (convex/auth.ts, convex/lookbooks.ts,
  convex/activity.ts, src/lib/db.js, convex/customers.ts, convex/orders.ts,
  convex/reviews.ts, convex/settings.ts, convex/events.ts,
  convex/notifications.ts, convex/ai.ts, convex/whatsapp.ts,
  convex/templates.ts, convex/crons.ts, convex/dashboard.ts,
  convex/platformStats.ts, convex/http.ts). Built from feat/multi-boutique
  once every one of batches 2 (boutiques.ts only) and 4-13 has been merged
  into it. Deployed at live-order step (5) — per item 6/36, the CONVEX half
  of Release B (everything except src/lib/db.js, which is a Vercel frontend
  file) deploys first, and the Vercel production build (picking up
  src/lib/db.js's trackActivity token-threading change) follows within
  minutes, per section 6.2's recommended order.
- RELEASE C = batch 15 (convex/schema.ts's Step C changes: boutique_id
  becomes required, every superseded old index is dropped). Files:
  convex/schema.ts (a second, later change to the same file Release A
  already touched once). Built from feat/multi-boutique once batch 15 has
  been merged into it, and deployed as its OWN separate, later live step,
  only after Release A+B's full regression pass (section 7/9/13) is
  complete on pleasant-cobra-560's own data.
EVERY deploy of every release to pleasant-cobra-560 is run by THE USER
HIMSELF — exactly as every other live-step in this project's convention
(Points-issued card, Platform Admin stats, and now Phase 1), never by an
agent.
