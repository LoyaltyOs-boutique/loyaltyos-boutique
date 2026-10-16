MULTI-BOUTIQUE PHASE 0a — FULL APP AUDIT
Date: 2026-10-15
Branch: feat/multi-boutique-phase0 (from main 0d9da32)
Purpose: read-only map of the whole app so that no table, function, tab or
feature is missed when every record later belongs to one boutique. Boutiques
share one app address; boutique identity comes from the merchant login, the
customer magic token, or a boutique slug in public links. Custom domain is an
optional later add-on. No app file was changed; only this audit file was added.

Row counts below were taken from the live 85 Lansdowne deployment
(pleasant-cobra-560) via: npx convex data <table> --limit 2000 --format jsonl,
piped straight to node printing only a line count. No rows, names, mobiles,
emails, prices, tokens or secrets were read or printed.

NAMING NOTE: convex/schema.ts defines tables; convex compiles .ts to .js, so
function-spec identifiers below say e.g. "customers.js:getCustomers". Source
file:line evidence points at the .ts file.


====================================================================
1. TABLES
====================================================================

Schema file: convex/schema.ts (defineSchema at line 29). 14 tables total.

Convention across the schema: data is currently GLOBAL to the single boutique.
For multi-boutique, every per-boutique table needs a new field
boutique_id: v.id("boutiques") (a new "boutiques" table must be created, not in
schema today), and every index that today starts with role / status / customer_id
/ created_at / lookbook_id must be re-prefixed to start with boutique_id so a
query for one boutique never scans another boutique's rows.

--- 1.1 users (convex/schema.ts:31-130) — row count 107
Fields: email (opt str), mobile (str), password_hash (opt str), magic_token
(opt str), magic_token_created_at (opt num), reset_token (opt str), reset_expiry
(opt num), session_token (opt str), session_expiry (opt num), session_last_seen
(opt num), role ("customer"|"merchant"), name (str), name_lower (opt str), points
(opt num), birthday (opt str), anniversary (opt str), birthday_md (opt str),
anniversary_md (opt str), tier (opt "silver"|"gold"|"platinum"), vvip (opt bool),
custom_tags (opt str[]), whatsapp_consent (opt bool), is_deleted (opt bool),
measurements (opt obj), staff_notes (opt obj[]).
Indexes (schema.ts:95-130):
  .index("by_mobile", ["mobile"])                              (95)
  .index("by_email", ["email"])                                (96)
  .index("by_magic_token", ["magic_token"])                    (97)
  .index("by_tier", ["tier"])                                  (98)
  .index("by_role_name_lower", ["role", "name_lower"])         (106)
  .index("by_role_birthday_md", ["role", "birthday_md"])       (111)
  .index("by_role_anniversary_md", ["role", "anniversary_md"]) (112)
  .index("by_role_consent_vvip", ["role","whatsapp_consent","vvip"]) (130)
Classification: PER-BOUTIQUE. Holds BOTH merchants and customers (role field).
Needs: boutique_id on every row. Re-prefix the role/tier/md/consent indexes to
  by_boutique_role_name_lower ["boutique_id","role","name_lower"],
  by_boutique_role_birthday_md, by_boutique_role_anniversary_md,
  by_boutique_role_consent_vvip, by_boutique_tier.
  by_mobile -> by_boutique_mobile ["boutique_id","mobile"] (the same mobile can
  belong to different customers at different boutiques — uniqueness must be
  per-boutique, see section 13). by_email stays global IF merchant emails must be
  globally unique for login; otherwise -> by_boutique_email. by_magic_token stays
  global (a 256-bit token already uniquely identifies the customer AND, via that
  customer's row, the boutique — see section 3).

--- 1.2 lookbooks (convex/schema.ts:133-161) — row count 32
Fields: title, designer, source ("manual"|"pdf"|"csv"|"instagram"), created_at
(opt num), kind (opt "catalogue"|"designer"|"pdf"), pdf_url (opt str), is_deleted
(opt bool), deleted_at (opt num).
Indexes: NONE declared (no .index chained after defineTable at schema.ts:161).
  getLookbooks reads the whole table with .order("desc").collect() (lookbooks.ts:107).
Classification: PER-BOUTIQUE.
Needs: boutique_id. Add .index("by_boutique", ["boutique_id"]) so getLookbooks /
getCustomerCatalogue read only one boutique's lookbooks instead of .collect() of
all (today an unindexed full-table read — see section 9).

--- 1.3 catalogue_items (convex/schema.ts:164-190) — row count 42
Fields: lookbook_id (id lookbooks), title, price (num, paise), image_url,
instagram_link (opt), size (opt), colour (opt), is_deleted (opt), deleted_at
(opt), media (opt {url,type}[]).
Indexes (schema.ts:190): .index("by_lookbook", ["lookbook_id"]).
Classification: PER-BOUTIQUE (via its parent lookbook).
Needs: boutique_id (denormalized from parent lookbook) so a customer catalogue
read filters by boutique directly. Add .index("by_boutique",["boutique_id"]) and
keep by_lookbook for per-lookbook reads. by_lookbook alone is already
boutique-safe once lookbook_id is boutique-scoped, but a boutique-wide feed needs
the boutique index.

--- 1.4 orders (convex/schema.ts:193-209) — row count 16
Fields: user_id (id users), subtotal (paise), points_applied (opt), discount_value,
payment_method ("online"|"offline"), final_total, points_earned, created_at (num).
Indexes (schema.ts:203-209):
  .index("by_user", ["user_id"])        (203)
  .index("by_created_at", ["created_at"]) (209)
Classification: PER-BOUTIQUE.
Needs: boutique_id. Re-prefix by_created_at ->
by_boutique_created_at ["boutique_id","created_at"] so getTodayOrders /
getTodaySummary / getOrders range-read one boutique's orders. by_user is
boutique-safe once user_id is boutique-scoped but a dashboard "today across my
boutique" needs the boutique+created_at index. getOrders today is an unindexed
full-table .collect() (orders.ts:113) — see section 9.

--- 1.5 campaigns (convex/schema.ts:212-224) — row count 0
Fields: title, creative_url, message_body, audience_segment (obj: tiers opt[],
min_points opt, custom_tags opt[]), sent_count (opt), clicks_count (opt),
sent_at (opt).
Indexes: NONE.
Classification: PER-BOUTIQUE.
Needs: boutique_id + .index("by_boutique",["boutique_id"]). Currently 0 rows live.

--- 1.6 settings (convex/schema.ts:234-239) — row count 4
Fields: key (str: "tier_rules"|"templates"|"general"), value (any JSON),
updated_at (num), updated_by (opt str).
Indexes (schema.ts:239): .index("by_key", ["key"]).
Classification: SINGLETON-PER-KEY (one row per settings group) TODAY — i.e.
GLOBAL config for the one boutique. Live row count 4 (expected 3 keys plus likely
one legacy row).
Needs: this is the biggest shape change. Must become one settings set PER BOUTIQUE.
Either add boutique_id and change the index to
by_boutique_key ["boutique_id","key"] (singleton-per-key-per-boutique), or move
per-boutique config (tier rules, templates, whatsapp config, card urls) onto the
new boutiques row. Every getSettings/updateSettings caller must pass/derive the
boutique. See sections 11/12 — getSettings is PUBLIC today (settings.ts:486).

--- 1.7 reviews (convex/schema.ts:242-253) — row count 75
Fields: user_id (id users), type ("product"|"gmb"|"testimonial"), text, rating
(opt), status ("pending"|"approved"|"declined"), points_awarded (opt),
catalogue_item_id (opt id), created_at (num).
Indexes (schema.ts:252-253):
  .index("by_user", ["user_id"])    (252)
  .index("by_status", ["status"])   (253)
Classification: PER-BOUTIQUE.
Needs: boutique_id. Re-prefix by_status ->
by_boutique_status ["boutique_id","status"] so getPendingReviews /
platformStats "approved" read one boutique. by_user boutique-safe once user_id
scoped. getReviews builds a query on by_status when filtered, else full table
(reviews.ts:246) — see section 9.

--- 1.8 message_actions (convex/schema.ts:283-293) — row count 33
Fields: customer_id (id users), occasion ("birthday"|"anniversary"), occasion_date
(str "M-D"), action ("sent"|"link_opened"|"cancelled"), decided_at (num), channel
(opt "cloud_api"|"wa_fallback").
Indexes (schema.ts:293):
  .index("by_customer_occasion_date", ["customer_id","occasion","occasion_date"]).
Classification: PER-BOUTIQUE (via customer).
Needs: boutique_id. Index is already customer-prefixed so per-boutique-safe once
customer_id is boutique-scoped; add boutique_id for any future
boutique-wide decision-log scan. platformStats reads this whole table (section 11).

--- 1.9 points_ledger (convex/schema.ts:313-330) — row count 69
Fields: customer_id (id users), delta (num signed), reason_type ("normal"|
"birthday"|"anniversary"|"testimonial"|"purchase"), note (opt), resulting_balance
(num), created_by ("admin"|"system"), created_at (num).
Indexes (schema.ts:330): .index("by_customer", ["customer_id"]).
Classification: PER-BOUTIQUE (via customer).
Needs: boutique_id. by_customer already per-customer so boutique-safe once
customer_id scoped; add by_boutique for the dashboard "points issued this
boutique" aggregate, which today is a full-table .collect() (dashboard.ts:49,
platformStats.ts:62) — see section 9.

--- 1.10 ai_message_drafts (convex/schema.ts:349-361) — row count 33
Fields: customer_id (id users), occasion ("birthday"|"anniversary"), occasion_date
(str), draft_text, generated_at (num), status ("pending"|"used"|"discarded").
Indexes (schema.ts:361):
  .index("by_customer_occasion_date", ["customer_id","occasion","occasion_date"]).
Classification: PER-BOUTIQUE (via customer).
Needs: boutique_id. Index per-customer so boutique-safe once customer scoped.
Crons that generate these must iterate per boutique (section 4).

--- 1.11 events (convex/schema.ts:380-394) — row count 14
Fields: designer_name, event_datetime (num), vvip_only (bool), description,
draft_text (opt), status ("draft"|"dispatched"), created_at (num).
Indexes (schema.ts:394): .index("by_event_datetime", ["event_datetime"]).
Classification: PER-BOUTIQUE.
Needs: boutique_id. Re-prefix ->
by_boutique_event_datetime ["boutique_id","event_datetime"] so getEvents shows
only this boutique's events. getEventAccess must also check the customer's
boutique == the event's boutique (section 3/13).

--- 1.12 notifications (convex/schema.ts:422-439) — row count 36
Fields: customer_id (id users), occasion ("birthday"|"anniversary"|
"weekly_activity"), occasion_date (str), message, created_at (num), seen (bool).
Indexes (schema.ts:433-439):
  .index("by_customer_occasion_date", ["customer_id","occasion","occasion_date"]) (433)
  .index("by_seen", ["seen"])         (436)
  .index("by_created_at", ["created_at"]) (439)
Classification: PER-BOUTIQUE (merchant-facing bell).
Needs: boutique_id. Re-prefix by_seen -> by_boutique_seen ["boutique_id","seen"]
(unseen-count per boutique) and by_created_at -> by_boutique_created_at (expiry
sweep per boutique). getNotifications/markAllSeen must scope to the merchant's
boutique — today getNotifications reads by_created_at across all (notifications.ts).

--- 1.13 customer_activity_events (convex/schema.ts:458-480) — row count 354
Fields: customer_id (id users), action ("cart_add"|"like"|"lookbook_view"|
"event_link_click"), catalogue_item_id (opt), lookbook_id (opt), event_id (opt),
created_at (num).
Indexes (schema.ts:475-480):
  .index("by_customer_created_at", ["customer_id","created_at"]) (475)
  .index("by_created_at", ["created_at"])                        (480)
Classification: PER-BOUTIQUE (via customer).
Needs: boutique_id. Re-prefix by_created_at ->
by_boutique_created_at so the weekly "who's active" scan and platformStats'
7-day activity count (platformStats.ts:76) read one boutique. by_customer_created_at
boutique-safe once customer scoped.

--- 1.14 customer_activity_summaries (convex/schema.ts:505-514) — row count 38
Fields: customer_id (id users), summary_text, generated_at (num).
Indexes (schema.ts:514): .index("by_customer", ["customer_id"]).
Classification: PER-BOUTIQUE (via customer).
Needs: boutique_id (denormalized) for any boutique-wide listing; by_customer is
boutique-safe once customer scoped.

MISSING TABLE: there is NO "boutiques" table today. One must be created, holding
at minimum: slug (str, unique, used in public links), display name, logo url,
tagline, inquire WhatsApp number, and per-boutique service config (or references
to settings rows). This is the anchor every boutique_id points at.


====================================================================
2. FUNCTIONS
====================================================================

Authoritative total from npx convex function-spec: 121 (verified, see section
14 and the report). Breakdown below is grouped by source file with file:line of
each definition in the .ts source (grep of export const/default + the guard line).

Guard legend:
  MS   = requireMerchantSession(ctx,userId,token) (convex/auth.ts:92)
  MAGIC= validates a customer magic token (by_magic_token lookup)
  PUB  = public by design, no auth (customer-browser or server-to-server)
  INT  = internalQuery/Mutation/Action — only callable from other convex code
  NONE = public-callable with NO guard (risk — see section 13)

Boutique scoping column: what each function must do once multi-boutique exists.

--- auth.ts (10 functions) — convex/auth.ts
findMerchantByEmail       auth.ts:400  internalQuery  reads users         INT   | login lookup must return boutique_id too
forgotPassword            auth.ts:469  action(public) reads users(via INT)/sends email PUB | scope reset to the boutique's merchant
generateMagicToken        auth.ts:327  mutation       reads/writes users  PUB(rate-limited) | must resolve boutique from the mobile's boutique (deprecated alias)
generateMagicTokenForCustomer auth.ts:304 mutation     reads/writes users MS    | token carries customer's boutique already
generateMagicTokenSelf    auth.ts:258  mutation       reads/writes users  PUB(rate-limited) | /join must pass a boutique slug; mobile is unique only within a boutique
merchantHeartbeat         auth.ts:202  mutation       reads/writes users  MS    | ok as-is (per-merchant)
merchantLogin             auth.ts:113  mutation       reads/writes users  PUB   | must return the merchant's boutique_id; one-device lock is per merchant row = per boutique already
merchantLogout            auth.ts:175  mutation       reads/writes users  PUB(token-checked) | ok as-is
saveResetToken            auth.ts:416  internalMutation writes users      INT   | ok as-is
validateMagicToken        auth.ts:364  query          reads users        MAGIC/PUB | returns the customer -> their boutique_id (how a customer's boutique is known without a domain)

--- customers.ts (21 functions) — convex/customers.ts
getCustomers              customers.ts:376  query     reads users             MS  | scope to merchant's boutique (today full .collect())
getCustomersPaginated     customers.ts:412  query     reads users             MS  | by_boutique_role_name_lower
getCustomerById           customers.ts:444  query     reads users             MS  | assert customer.boutique_id == merchant.boutique_id
updateMeasurements        customers.ts:458  mutation  writes users            MS  | same cross-boutique ownership assert
addStaffNote              customers.ts:485  mutation  writes users            MS  | same
updateCustomTags          customers.ts:507  mutation  writes users            MS  | same
updateCustomerProfile     customers.ts:525  mutation  writes users            MS  | same
getUpcomingBirthdays      customers.ts:564  query     reads users,message_actions MS | by_boutique_role_birthday_md
getUpcomingAnniversaries  customers.ts:584  query     reads users,message_actions MS | by_boutique_role_anniversary_md
findUpcomingInternal      customers.ts:624  internalQuery reads users,message_actions INT | crons must pass boutique_id (section 4)
recordMessageAction       customers.ts:713  mutation  writes message_actions  MS  | stamp boutique_id on the row
awardPoints               customers.ts:840  mutation  writes users,points_ledger MS | ownership assert + stamp boutique_id on ledger
getPointsHistory          customers.ts:894  query     reads points_ledger     MS  | ownership assert
findCustomerByMobile      customers.ts:947  query     reads users             MS  | scope lookup to merchant's boutique (mobile unique per boutique)
createCustomer            customers.ts:976  mutation  reads/writes users      MS (see note) | stamp boutique_id; dup-mobile check must be per boutique
deleteCustomer            customers.ts:1114 mutation  writes users            MS  | ownership assert
bulkDeleteCustomers       customers.ts:1154 mutation  writes users            MS  | ownership assert per id
bulkCreateCustomers       customers.ts:1237 mutation  reads/writes users      MS  | stamp boutique_id; per-boutique dup-mobile
checkMobilesStatus        customers.ts:1393 query     reads users             MS  | scope to merchant boutique
getCustomerIntelligenceProfile customers.ts:1474 query reads users,orders,reviews,... MS | ownership assert
getDraftForCustomer       customers.ts:1569 query     reads ai_message_drafts MS  | ownership assert
NOTE createCustomer (customers.ts:976-1003): requireMerchantSession is called
INSIDE a conditional (line 1003) — createCustomer is reachable both from the
merchant CRM (guarded) AND the public self-onboarding path. This is the
Critical #2 area flagged in CLAUDE.md; multi-boutique must not widen it.

--- settings.ts (11 functions) — convex/settings.ts
getSettings               settings.ts:486  query     reads settings   PUB(NONE) | MUST become boutique-scoped; public read leaks nothing sensitive today but will cross boutiques
updateSettings            settings.ts:496  mutation  writes settings  MS  | by_boutique_key, stamp boutique
updateTemplate            settings.ts:530  mutation  writes settings  MS  | per boutique
getTemplateCardUrls       settings.ts:565  query     reads settings   PUB(NONE) | per boutique
setTemplateCardUrl        settings.ts:584  mutation  writes settings  MS  | per boutique
getWhatsAppTemplates      settings.ts:609  query     reads settings   MS  | per boutique
setWhatsAppTemplate       settings.ts:636  mutation  writes settings  MS  | per boutique
clearWhatsAppTemplate     settings.ts:678  mutation  writes settings  MS  | per boutique
getWhatsAppTemplateConfig settings.ts:708  query     reads settings   MS  | per boutique
setWhatsAppTemplateConfig settings.ts:736  mutation  writes settings  MS  | per boutique
resetSettings             settings.ts:765  mutation  writes settings  MS  | per boutique

--- lookbooks.ts (14 functions) — convex/lookbooks.ts
getLookbooks              lookbooks.ts:103  query     reads lookbooks,catalogue_items MS | by_boutique (today full .collect())
getLookbooksForSelector   lookbooks.ts:133  query     reads lookbooks         MS  | by_boutique
getLookbookById           lookbooks.ts:154  query     reads lookbooks,catalogue_items PUB(NONE) | assert lookbook.boutique_id; used by public pages + OG
getCustomerCatalogue      lookbooks.ts:204  query     reads lookbooks,catalogue_items MAGIC | filter to the customer's boutique (today returns ALL boutiques' items)
getCatalogueItemById      lookbooks.ts:278  query     reads catalogue_items   PUB(NONE) | assert boutique; used by public piece + OG
createLookbook            lookbooks.ts:294  mutation  writes lookbooks        MS  | stamp boutique
updateLookbook            lookbooks.ts:316  mutation  writes lookbooks        MS  | ownership assert
deleteLookbook            lookbooks.ts:345  mutation  writes lookbooks,catalogue_items MS | ownership assert
addCatalogueItem          lookbooks.ts:374  mutation  writes catalogue_items  MS  | stamp boutique from parent
updateCatalogueItem       lookbooks.ts:414  mutation  writes catalogue_items  MS  | ownership assert
deleteCatalogueItem       lookbooks.ts:444  mutation  writes catalogue_items  MS  | ownership assert
createPdfLookbook         lookbooks.ts:466  internalMutation writes lookbooks INT | stamp boutique
checkMerchantSession      lookbooks.ts:499  internalQuery reads users         INT(MS) | returns boutique_id for the action caller
generatePdfUploadUrl      lookbooks.ts:526  action    (blob upload)           PUB(calls checkMerchantSession) | ok via guard

--- orders.ts (5 functions) — convex/orders.ts
createOrder               orders.ts:31   mutation  writes orders,users,points_ledger MS | stamp boutique; ownership assert on user
getOrders                 orders.ts:109  query     reads orders             MS  | by_boutique_created_at (today full .collect())
getOrdersByUser           orders.ts:118  query     reads orders             MS  | ownership assert
getTodayOrders            orders.ts:151  query     reads orders             MS  | by_boutique_created_at
getTodaySummary           orders.ts:160  query     reads orders             MS  | by_boutique_created_at

--- reviews.ts (5 functions) — convex/reviews.ts
createReview              reviews.ts:51   mutation  writes reviews          PUB(rate-limited) | stamp boutique from the reviewing customer
approveReview             reviews.ts:113  mutation  writes reviews,users,points_ledger MS | ownership assert
declineReview             reviews.ts:195  mutation  writes reviews          MS  | ownership assert
getPendingReviews         reviews.ts:219  query     reads reviews           MS  | by_boutique_status
getReviews                reviews.ts:237  query     reads reviews           MS  | by_boutique_status (today full table when unfiltered)

--- templates.ts (2 functions) — convex/templates.ts
checkMerchantSession      templates.ts:30  internalQuery reads users        INT(MS) | returns boutique_id
generateTemplateMediaUploadUrl templates.ts:55 action (blob upload)         PUB(calls checkMerchantSession) | ok via guard

--- whatsapp.ts (4 functions) — convex/whatsapp.ts
checkMerchantSession      whatsapp.ts:116  internalQuery reads users        INT(MS) | returns boutique_id
sendWhatsAppTemplateMessage whatsapp.ts:148 action reads settings/env,sends WA PUB(calls checkMerchantSession) | per-boutique WA creds (section 5)
sendWhatsAppServiceMessage  whatsapp.ts:233 action reads settings/env,sends WA PUB(calls checkMerchantSession) | per-boutique WA creds
sendAllUpcomingOccasionMessages whatsapp.ts:404 action reads users,sends WA PUB(calls checkMerchantSession) | scope recipients to boutique

--- ai.ts (16 functions) — convex/ai.ts
checkMerchantSession      ai.ts:287  internalQuery reads users            INT(MS) | returns boutique_id
generateActivitySummaryPublic ai.ts:1082 action    AI call                PUB(calls checkMerchantSession) | boutique context in prompt
generateCombinedMessageDraft  ai.ts:640  internalAction AI call           INT | boutique name in prompt (today hardcoded 85 Lansdowne, section 7)
generateCombinedMessageDraftPublic ai.ts:691 action AI call               PUB(calls checkMerchantSession) | same
generateCustomerActivitySummary ai.ts:844 internalAction AI call          INT | same
generateMessageDraft      ai.ts:356  internalAction AI call               INT | same
generateMessageDraftManual ai.ts:590 action    AI call                    PUB(calls checkMerchantSession) | same
generateMessageDraftPublic ai.ts:454 action    AI call                    PUB(calls checkMerchantSession) | same
getActiveCustomers        ai.ts:962  query     reads users                MS  | scope to boutique
getCachedActivitySummaryInternal ai.ts:1037 internalQuery reads customer_activity_summaries INT | ok
getPurchaseSummaryInternal ai.ts:810 internalQuery reads orders           INT | boutique via customer
getRecentActivityCountsInternal ai.ts:766 internalQuery reads customer_activity_events INT | boutique via customer
getWhatsAppTemplateConfigInternal ai.ts:317 internalQuery reads settings  INT | per-boutique settings
overwriteCachedDraft      ai.ts:539  internalMutation writes ai_message_drafts INT | stamp boutique
testGeminiConnection      ai.ts:728  action    AI call                    PUB | harmless; per-boutique key if BYO-key (section 5)
upsertActivitySummary     ai.ts:913  internalMutation writes customer_activity_summaries INT | stamp boutique

--- crons.ts (13 functions) — convex/crons.ts (cron registrations crons.ts:779-838)
hasExistingDraft          crons.ts:119  internalQuery  reads ai_message_drafts INT | per-boutique dedup
getCachedDraftTextInternal crons.ts:155 internalQuery  reads ai_message_drafts INT | ok
insertDraft               crons.ts:188  internalMutation writes ai_message_drafts INT | stamp boutique
generateDailyDrafts       crons.ts:239  internalAction reads/writes drafts   INT | iterate per boutique (section 4)
hasExistingNotification   crons.ts:331  internalQuery  reads notifications   INT | per-boutique dedup
insertNotification        crons.ts:358  internalMutation writes notifications INT | stamp boutique
deleteExpiredNotifications crons.ts:385 internalMutation writes notifications INT | per boutique sweep ok global
generateDailyNotifications crons.ts:416 internalAction reads/writes notifications INT | iterate per boutique
getRecentActivityCustomerIdsInternal crons.ts:520 internalQuery reads customer_activity_events INT | per boutique
getCustomerNameInternal   crons.ts:539  internalQuery  reads users          INT | ok
generateWeeklyActivityNotifications crons.ts:571 internalAction reads/writes INT | iterate per boutique
getCustomerTierInternal   crons.ts:680  internalQuery  reads users          INT | ok
generateDailyActivitySummaries crons.ts:709 internalAction reads/writes     INT | iterate per boutique

--- events.ts (12 functions) — convex/events.ts
createEvent               events.ts:71   mutation  writes events            MS  | stamp boutique
getEvents                 events.ts:108  query     reads events             MS  | by_boutique_event_datetime
deleteEvent               events.ts:122  mutation  writes events            MS  | ownership assert
getEventPromptFieldsInternal events.ts:142 internalQuery reads events       INT | ok
generateEventDraft        events.ts:190  internalAction AI call             INT | boutique name in prompt
generateEventDraftPublic  events.ts:256  action    AI call                  PUB(calls checkMerchantSession) | same
checkMerchantSession      events.ts:281  internalQuery reads users          INT(MS) | returns boutique_id
getDispatchRecipientsInternal events.ts:299 internalQuery reads users       INT | scope recipients to boutique (by_boutique_role_consent_vvip)
markEventDispatchedInternal events.ts:326 internalMutation writes events    INT | ok
dispatchEvent             events.ts:365  action    reads/sends WA           PUB(calls checkMerchantSession) | per-boutique WA creds + recipients
getEventForDispatchInternal events.ts:425 internalQuery reads events        INT | ok
getEventAccess            events.ts:493  query     reads events             PUB(NONE) | MUST assert the viewing customer's boutique == event's boutique (section 13)

--- notifications.ts (3 functions) — convex/notifications.ts
getNotifications          notifications.ts:38  query     reads notifications MS  | by_boutique (today reads by_created_at across all)
markAllSeen               notifications.ts:58  mutation  writes notifications MS  | per boutique
deleteNotification        notifications.ts:80  mutation  writes notifications MS  | ownership assert

--- activity.ts (1 function) — convex/activity.ts
trackActivity             activity.ts:47  mutation  writes customer_activity_events PUB(NONE, by design) | stamp boutique from the customer; verify customer_id owns a valid magic session (today unguarded — section 13)

--- dashboard.ts (2 functions) — convex/dashboard.ts
getDashboardSummary       dashboard.ts:38  query  reads points_ledger,orders,reviews MS | all three reads must scope to boutique (today full .collect())
getRecentCustomerActivity dashboard.ts:103 query  reads customer_activity_events,users MS | by_boutique

--- platformStats.ts (1 function) — convex/platformStats.ts
computeStats              platformStats.ts:35 internalQuery reads users,reviews,points_ledger,orders,customer_activity_events,message_actions,events,lookbooks,settings,catalogue_items INT | must GROUP BY boutique (section 11)

--- http.ts (1 function) — convex/http.ts
(httpAction for GET /platform/stats) http.ts:37 httpAction  calls computeStats PUB(bearer secret) | returns per-boutique breakdown (section 11)

PER-FILE TOTALS: auth 10, customers 21, settings 11, lookbooks 14, orders 5,
reviews 5, templates 2, whatsapp 4, ai 16, crons 13, events 12, notifications 3,
activity 1, dashboard 2, platformStats 1, http 1. SUM = 121. Matches
npx convex function-spec total of 121 exactly.


====================================================================
3. AUTH, SESSIONS AND BOUTIQUE IDENTITY
====================================================================

3.1 Merchant login (convex/auth.ts:113 merchantLogin).
Looks up users by_email (auth.ts:121-124), requires role=="merchant" and a
password_hash, verifies with bcrypt.compareSync (auth.ts:136). On success issues
a 256-bit session_token with 7-day expiry (SESSION_DAYS, auth.ts:35,154-160) and
stamps session_last_seen. Returns toPublicUser + token + expiresAt (auth.ts:162).
requireMerchantSession (auth.ts:92-105) re-validates every merchant call:
ctx.db.get(userId), role=="merchant", session_token match, session_expiry in the
future. Merchant count: merchants are rows in `users` with role=="merchant";
total users live = 107 (customers + merchants combined — the exact merchant
count was not isolated to avoid reading rows; by_role_name_lower splits them).

3.2 One-device lock (convex/sessionLock.ts + env ONE_DEVICE_LOCK).
sessionLock.ts is dependency-free pure TS. isMerchantSessionLive (sessionLock.ts:47)
= token present + expiry future + session_last_seen within LIVE_WINDOW_MS (5 min,
line 19). lockEnabled (line 59) true only when ONE_DEVICE_LOCK === "on".
shouldRefuseLogin (line 73) refuses a password-verified login only when the lock
is on, a live session exists, and currentToken != stored token (different device).
merchantHeartbeat (auth.ts:202) re-stamps session_last_seen at most every 30s
(HEARTBEAT_MIN_WRITE_MS, sessionLock.ts:26). Because the lock state lives on each
merchant's OWN users row, it is ALREADY per-merchant; multi-boutique just needs
each boutique to have its own merchant row (its own owner login), which the schema
supports once boutique_id is added. ONE_DEVICE_LOCK is a single global env switch
(auth.ts:150) — to make the lock per-boutique-controllable it would need to move
to the boutiques row / per-boutique settings instead of one env var.

3.3 Customer magic token (convex/auth.ts).
issueMagicToken (auth.ts:225) mints a 256-bit token, stamps
magic_token_created_at, and builds <base>/lookbook?id=<_id>&token=<token>
(auth.ts:239). validateMagicToken (auth.ts:364) looks up by_magic_token, checks
role=="customer", id match, and 180-day expiry (MAGIC_LINK_DAYS, auth.ts:37).
The token row IS the customer row, which will carry boutique_id — so a customer's
boutique is known from the token alone, no domain needed.

3.4 How the boutique is known WITHOUT a custom domain.
 (a) Merchant: merchantLogin returns the merchant users row -> its boutique_id.
     Every subsequent MS call re-derives boutique from ctx.db.get(userId).
 (b) Customer with a token: validateMagicToken / getCustomerCatalogue resolve
     the customer row -> its boutique_id (auth.ts:364, lookbooks.ts:204).
 (c) Public link with no token: must carry a boutique SLUG in the path/query so
     the page can resolve the boutique before any token exists.

3.5 Public entry points a customer opens WITHOUT a merchant session (file:line).
 - /join self-onboarding — App.jsx:53 route; Join.jsx form submit Join.jsx:34;
   calls generateMagicToken (Onboarding genUrl('/join') shares the link,
   Onboarding.jsx:193). TODAY: resolves the customer only by MOBILE
   (generateMagicTokenSelf, auth.ts:258-291) — mobile is not unique across
   boutiques, so /join MUST carry a boutique slug (e.g. /join?b=85lansdowne).
 - /lookbook (magic link landing) — App.jsx:54; Lookbook.jsx auth at
   Lookbook.jsx:96-180. Token already identifies the boutique; no slug needed,
   old links keep working.
 - /lookbook/public/:lookbookId (public lookbook) — App.jsx:55; PublicLookbook.jsx
   loads getLookbookById (PublicLookbook.jsx reads lookbook). The lookbook id
   already maps to a boutique via the row; no slug strictly needed but a slug in
   the path is cleaner for branding.
 - /lookbook/piece/:pieceId (public piece) — App.jsx:56; PublicPiece.jsx uses
   getCatalogueItemById. Piece id maps to boutique via its lookbook.
 - Review flows — submitted from inside /lookbook (Lookbook.jsx:7 submitGmbReview/
   submitProductReview -> createReview reviews.ts:51). Customer already
   authenticated by magic token, so boutique is known; no separate public review
   URL exists.
 - /login merchant portal — App.jsx:52; boutique resolved AFTER login by email.
 - AccessDenied — App.jsx (fallback); static, has a hardcoded WhatsApp request
   link (AccessDenied.jsx:17) — needs per-boutique WA number.
How existing 85 Lansdowne links keep working: magic-link URLs
(/lookbook?id=..&token=..) and public lookbook/piece ids all resolve a specific
row that will be backfilled with 85 Lansdowne's boutique_id, so no slug is
required on those old links. ONLY the slug-less /join link is ambiguous once a
second boutique exists; keep the current /join defaulting to the 85 Lansdowne
boutique when no slug is present, and give new boutiques slug-bearing /join links.

3.6 What must change for per-boutique owner login + per-boutique one-device lock.
 - Each boutique gets its own merchant users row (role=="merchant",
   boutique_id set). merchantLogin must return boutique_id; requireMerchantSession
   already reads the merchant row so boutique comes for free.
 - The one-device lock is already per-merchant-row; to toggle it per boutique move
   ONE_DEVICE_LOCK off the single global env (auth.ts:150) onto the boutiques row.


====================================================================
4. CRONS AND SCHEDULED WORK
====================================================================

Registered in convex/crons.ts via cronJobs() (crons.ts:759) + export default
(crons.ts:838). Three fixed wall-clock crons (crons.ts:779, 806, 831):
 - "generate dashboard notifications" (crons.ts:779, "35 18 * * *" = 00:05 IST)
   -> internal.crons.generateDailyNotifications (crons.ts:416). Scans users for
   upcoming birthdays/anniversaries (via findUpcomingInternal), writes
   notifications rows. Must run PER BOUTIQUE: loop boutiques, scope the user scan
   and the dedup (hasExistingNotification) to each boutique_id.
 - Daily AI drafts cron (crons.ts:806) -> generateDailyDrafts (crons.ts:239).
   Reads upcoming occasions, calls Gemini, writes ai_message_drafts. Per boutique:
   scope the user scan, the dedup (hasExistingDraft), and use that boutique's
   Gemini key + boutique name in the prompt (section 5/7).
 - Weekly/daily activity cron (crons.ts:831) -> likely
   generateWeeklyActivityNotifications (crons.ts:571) and/or
   generateDailyActivitySummaries (crons.ts:709). Scans customer_activity_events,
   writes notifications + customer_activity_summaries. Per boutique: scope the
   activity scan and summary writes to each boutique_id.
Also deleteExpiredNotifications (crons.ts:385) sweeps old notifications — safe to
run globally but will touch all boutiques; fine as a shared sweep.
GENERAL RULE: every cron currently assumes ONE boutique and scans whole tables.
Each must iterate the boutiques table and run its existing logic scoped to one
boutique_id, so one boutique's data never leaks into another's drafts/notifications.


====================================================================
5. ENV VARS AND EXTERNAL SERVICES (names only)
====================================================================

convex/ (process.env):
 - GEMINI_API_KEY        ai.ts:223           | AI drafts/summaries. Per-boutique if boutiques bring their own AI key; else one shared platform key is acceptable.
 - ONE_DEVICE_LOCK       auth.ts:150         | one-device login switch. Move to per-boutique setting to toggle per boutique (section 3).
 - RESEND_API_KEY        auth.ts:437         | password-reset email sender. Shared platform key fine; sender/brand text must become per-boutique (section 7).
 - PLATFORM_STATS_SECRET http.ts:38          | bearer for the Platform Admin stats feed. Stays a single platform-level secret (not per boutique).
 - BLOB_READ_WRITE_TOKEN lookbooks.ts:537, templates.ts:69 | Vercel Blob uploads (PDF + template media). Shared platform token fine; stored blobs are already per-file.
 - WHATSAPP_ACCESS_TOKEN whatsapp.ts:166,247,586 | WhatsApp Cloud API. MUST become per-boutique (each boutique sends from its own WABA).
 - WHATSAPP_PHONE_NUMBER_ID whatsapp.ts:172,253,590 | WhatsApp sender number. MUST become per-boutique.

src/ (import.meta.env):
 - VITE_CONVEX_URL       main.jsx:10, main.jsx:11 | the Convex deployment URL the frontend talks to. Stays one shared deployment for all boutiques (section 10).

api/ (process.env): none found in api/dynamic-shell.js (no process.env references).

No env value was read or printed. npx convex env list / env get was NOT run.


====================================================================
6. TABS AND FEATURES
====================================================================

Merchant sidebar source: src/components/merchant/Shell.jsx:14-21 (8 nav items).
Routes: src/App.jsx:52-90. Each tab below lists distinct, per-boutique-toggleable
features (sections/buttons/actions/imports/sends) with file:line.

--- TAB 1: Delight Desk  (Shell.jsx:14 -> /merchant/dashboard, App.jsx:58; src/pages/merchant/Dashboard.jsx)
 - "Onboard a client" CTA button -> navigates to onboarding (Dashboard.jsx:91-92)
 - Quick chips: Reviews to approve (Dashboard.jsx:108), Birthdays today
   (Dashboard.jsx:121), Anniversaries today (Dashboard.jsx:126)
 - Stats tiles (grid) (Dashboard.jsx:135)
 - "Google reviews to approve" section with per-review Approve (Dashboard.jsx:159)
   and Dismiss (Dashboard.jsx:160) buttons
 - "Recent activity" table, row-click opens activity modal (Dashboard.jsx:171-204)
 - "Active this week" table, row-click opens summary modal (Dashboard.jsx:211-236)
 - AI activity-summary modal (Dashboard.jsx:240-264)

--- TAB 2: Customer CRM  (Shell.jsx:15 -> /merchant/customers, App.jsx:62; src/pages/merchant/Customers.jsx, 1260 lines)
 - Tabs within the page: all clients, reviews, birthday_today, anniversary_today,
   birthday_tomorrow, anniversary_tomorrow (Customers.jsx:35-51)
 - Customer list + search (Customers.jsx:75-92)
 - Per-row eye/view, copy magic link, share-on-WhatsApp token (waToken
   Customers.jsx:227), "+ Points" quick action (Customers.jsx:142)
 - Customer edit (measurements, staff notes, custom tags, profile) via the
   guarded mutations (updateMeasurements/addStaffNote/updateCustomTags/
   updateCustomerProfile)
 - "Generate magic link first" guard on share (Customers.jsx:231)
 - Birthday/Anniversary "Approve & Send" flow with promo copy
   (Customers.jsx:118-139, approveTarget:139)
 - Inline "Send All (N)" bulk occasion outreach (Customers.jsx:167-224,
   handleSendAll:218)
 - Delete / bulk delete customers (deleteCustomer/bulkDeleteCustomers)
 - Review approve/decline from the reviews tab

--- TAB 3: Client Onboarding  (Shell.jsx:16 -> /merchant/onboarding, App.jsx:66; src/pages/merchant/Onboarding.jsx)
 - "Send join link on WhatsApp" button (Onboarding.jsx:191-193)
 - Manual add-client form -> Generate magic link (Onboarding.jsx:271-274,
   generateMagicToken Onboarding.jsx:145)
 - Result card: copy link (Onboarding.jsx:292), Send on WhatsApp
   (Onboarding.jsx:296), add another (Onboarding.jsx:302)
 - VVIP + whatsapp_consent checkboxes in the form (Onboarding.jsx:256)
 - CSV import section: upload (Onboarding.jsx:317), download sample CSV
   (Onboarding.jsx:327, filename 85-lansdowne-... Onboarding.jsx:88), preview
   table, confirm import (Onboarding.jsx:366), cancel (Onboarding.jsx:369)

--- TAB 4: WhatsApp Campaigns  (Shell.jsx:17 -> /merchant/campaigns, App.jsx:70; src/pages/merchant/Campaigns.jsx)
 - Event Setter section: audience All vs VVIP only (Campaigns.jsx:182-183),
   Generate AI Draft (Campaigns.jsx:193-194), Dispatch Event
   (Campaigns.jsx:202-203, dispatchEvent)
 - Flyer upload section (Campaigns.jsx:227-232)
 - Message body section (Campaigns.jsx:247, default copy has 85 Lansdowne
   Campaigns.jsx:18)
 - Audience segmentation: tier toggles (Campaigns.jsx:259), custom-tag toggles
   (Campaigns.jsx:272)
 - Dispatch campaign button (Campaigns.jsx:285-286)
 - Sent campaigns table (Campaigns.jsx:323-344)

--- TAB 5: Lookbook Manager  (Shell.jsx:18 -> /merchant/catalogue, App.jsx:74; src/pages/merchant/Catalogue.jsx, 709 lines)
 - Lookbook selector dropdown (designer/pdf/catalogue kinds)
 - Delete lookbook (only for designer/PDF kinds) with inline confirm
   (Catalogue.jsx:175-212, confirmDeleteLookbook:199)
 - Add piece manually + ordered media gallery (move left/right/remove
   Catalogue.jsx:45-47; upload Catalogue.jsx:314-341)
 - Edit piece + edit media gallery (Catalogue.jsx:239-247)
 - Bulk CSV import of items (Catalogue.jsx:367)
 - PDF lookbook upload (Catalogue.jsx:377-409, generatePdfUploadUrl)
 - Per-piece copy/share WhatsApp link (Catalogue.jsx:166)

--- TAB 6: Templates  (Shell.jsx:19 -> /merchant/templates, App.jsx:78; src/pages/merchant/Templates.jsx, 570 lines)
 - Mode switch existing vs manual (Templates.jsx:106-115)
 - Anniversary / Birthday card send cards (Templates.jsx:547,558; default copy
   has 85 Lansdowne)
 - Regenerate AI draft (Templates.jsx:364-366)
 - Replace card image upload (Templates.jsx:394, generateTemplateMediaUploadUrl)
 - Send via WhatsApp (Templates.jsx:403)
 - Card 3 Video/Image/PDF send: upload (Templates.jsx:414-434) + send
   (Templates.jsx:456-466)

--- TAB 7: Points Ledger  (Shell.jsx:20 -> /merchant/points-ledger, App.jsx:82; src/pages/merchant/PointsLedger.jsx)
 - Tier rules editor: per-tier tabs global/silver/gold/platinum
   (PointsLedger.jsx:78), Save tier (PointsLedger.jsx:110,
   updateSettings)
 - "Give Points" section (PointsLedger.jsx:115-150; a "Coming soon" disabled
   button at PointsLedger.jsx:146)

--- TAB 8: Settings & Support  (Shell.jsx:21 -> /merchant/settings, App.jsx:86; src/pages/merchant/Settings.jsx, 83 lines)
 - "File a ticket" support form -> Submit ticket (Settings.jsx:37-57)

--- Dashboard bell (lives in Shell, all tabs): notifications bell + options
   (Shell.jsx:274, Shell.jsx:311) — getNotifications/markAllSeen/deleteNotification.

CUSTOMER-FACING PAGES AND THEIR FEATURES:
--- /lookbook  (App.jsx:54; src/pages/Lookbook.jsx, 575 lines)
 - Magic-link / 180-day session auth (Lookbook.jsx:96-180)
 - Product feed from allCatalogue (Lookbook.jsx:7)
 - Like a piece (likeItem, Lookbook.jsx:7; like animation Lookbook.jsx:50)
 - Cart + checkout (cart Lookbook.jsx:36, checkout Lookbook.jsx:7, subtotal:210)
 - Inquire on WhatsApp (wa.me link Lookbook.jsx:216-217)
 - Submit in-app product review (submitProductReview, reviewing/stars/text
   Lookbook.jsx:42-44)
 - Submit Google/GMB review (submitGmbReview, gmbText Lookbook.jsx:543)
 - "Messages from 85 Lansdowne" section (Lookbook.jsx:389)

--- /join  (App.jsx:53; src/pages/Join.jsx, 187 lines)
 - Self-onboarding form -> create magic link (Join.jsx:34, button Join.jsx:181)
 - Existing-customer (duplicate mobile) -> regenerate link (Join.jsx:47-62)
 - Result: copy link (Join.jsx:103), send on WhatsApp (Join.jsx:85)
 - whatsapp_consent checkbox (Join.jsx:178)

--- /lookbook/public/:lookbookId  (App.jsx:55; src/pages/PublicLookbook.jsx)
 - Public (no login) lookbook view (getLookbookById)
 - Inline PDF preview for pdf-kind (PublicLookbook.jsx:82)
 - Per-item inquire on WhatsApp (PublicLookbook.jsx:56-57)

--- /lookbook/piece/:pieceId  (App.jsx:56; src/pages/PublicPiece.jsx)
 - Public single-piece view (getCatalogueItemById)
 - Inquire on WhatsApp (PublicPiece.jsx:54-55)
 - "Coming soon" buy button (PublicPiece.jsx:90-91)

--- AccessDenied  (src/pages/AccessDenied.jsx)
 - Request access on WhatsApp (AccessDenied.jsx:17), Email the boutique
   (AccessDenied.jsx:18 mailto:care@85lansdowne.com)

--- /login  (App.jsx:52; src/pages/Login.jsx)
 - Merchant sign in (Login.jsx:84-89)
 - Forgot password / send recovery link (Login.jsx:91, 113)
 - Reset demo data button (Login.jsx:96-98)


====================================================================
7. HARDCODED BOUTIQUE IDENTITY (file:line + what it needs)
====================================================================

Brand object (single source of the hardcoded identity):
 - src/data/seed.js:2 BRAND = {...}
 - src/data/seed.js:3 name "85 Lansdowne"            -> per-boutique name
 - src/data/seed.js:4 tagline                         -> per-boutique tagline
 - src/data/seed.js:5 logo (85lansdowne.com CDN url)  -> per-boutique logo
 - src/data/seed.js:6 wa (placeholder WhatsApp number) -> per-boutique WA number

Logo <img> usages of BRAND.logo (all need per-boutique logo):
 - src/components/merchant/Shell.jsx:419, 429, 447
 - src/pages/Join.jsx:92, 122
 - src/pages/AccessDenied.jsx:7
 - src/pages/PublicPiece.jsx:63
 - src/pages/Lookbook.jsx:261
 - src/pages/PublicLookbook.jsx:65
 - src/pages/Login.jsx:61, 78

Hardcoded boutique NAME strings "85 Lansdowne" (need per-boutique name):
 - src/pages/Join.jsx:97, 123, 178
 - src/pages/AccessDenied.jsx:12, 20
 - src/pages/PublicPiece.jsx:35, 55, 77
 - src/pages/Lookbook.jsx:217, 277, 314, 346, 389, 446, 508, 537, 543
 - src/pages/PublicLookbook.jsx:35, 57, 73, 91
 - src/pages/Login.jsx:72
 - src/pages/merchant/Templates.jsx:444, 547, 558
 - src/pages/merchant/Customers.jsx:940, 953, 959
 - src/pages/merchant/Onboarding.jsx:88 (sample CSV filename), 256
 - src/pages/merchant/Catalogue.jsx:166
 - src/pages/merchant/Campaigns.jsx:18 (default message body)
 - src/data/seed.js:1, 110, 198

Hardcoded boutique name in AI prompts (need per-boutique name injected):
 - convex/ai.ts:391, 657, 881 ("85 Lansdowne, a luxury fashion boutique in Kolkata")

Hardcoded domain / platform sender (need per-boutique or platform config):
 - convex/auth.ts:32 PORTAL_BASE_URL "loyaltyos-boutique-three.vercel.app"
   -> base URL of generated magic links; must become per-boutique (slug or domain)
 - convex/auth.ts:242, 430, 442 digital@mouldinnovation.com (Resend sender)
   -> platform sender ok, but the email BODY names the boutique
 - convex/auth.ts:444, 445 reset email subject/body "85 Lansdowne"
   -> per-boutique name in the email

Hardcoded boutique email:
 - src/pages/AccessDenied.jsx:18 care@85lansdowne.com -> per-boutique contact

(Only file:line + short labels listed; no personal data reproduced.)


====================================================================
8. DEMO AND SEED DATA
====================================================================

 - src/data/seed.js — the whole demo dataset: BRAND (line 2), COUNTRIES (9),
   CATALOGUE array of real 85lansdowne products (line 15), buildSeed() assembling
   catalogueItems (items = CATALOGUE.slice(0,8), line 151), demo orders
   (lines 154-157), demo reviews (lines 173-177), demo campaigns (line 198),
   meta version 2 (line 190).
 - src/lib/db.js — local fallback / hydration layer:
    - imports buildSeed (db.js:13), localStorage KEY 'loyaltyos85_v2' (db.js:21),
      SEED_VERSION 2 (db.js:22)
    - loads/reseeds from localStorage (db.js:32-46), resetDemo() (db.js:51)
    - createLocalCustomer() local fallback (db.js:2758), used by
      onboardCustomerRemote fallbacks (db.js:2800, 2833, 2947) when Convex is
      unreachable — these mint a LOCAL seed customer in the browser only
    - hydrateCustomers/hydrateCatalogue/hydrateReviews merge live Convex data over
      the seed (db.js:139-141, 215)
 - src/pages/Login.jsx:96-98 resetDemo button; App.jsx:16 Boundary "reset demo"
   button both clear localStorage and reseed.
What must change so a NEW boutique starts with ZERO data:
 - buildSeed()/BRAND must not inject 85 Lansdowne content for a non-85-Lansdowne
   boutique. Either gate the seed behind "no boutique slug / demo mode only", or
   replace the hardcoded BRAND + CATALOGUE with values fetched from the boutiques
   table for the current slug, defaulting to an EMPTY catalogue/customer set for a
   brand-new boutique.
 - createLocalCustomer and the local seed fallback should key on the current
   boutique slug so a fallback never mixes one boutique's local customers with
   another's.


====================================================================
9. SCALE (full-table reads / unindexed scans)
====================================================================

61 total .collect() calls across convex/. The ones that read a WHOLE table
without a boutique/selective index (will scan every boutique's rows at scale):
 - convex/customers.ts:386 getCustomers — .collect() of the whole users table on
   every CRM load (customers.ts:397 comment acknowledges this). Needs
   by_boutique_role_name_lower; getCustomersPaginated (customers.ts:412) is the
   indexed replacement but getCustomers is still live.
 - convex/customers.ts:902 getPointsHistory, :1497/:1506 getCustomerIntelligenceProfile,
   :1585 getDraftForCustomer — per-customer .collect()s; boutique-safe once
   customer_id is boutique-scoped, but confirm they use by_customer indexes.
 - convex/lookbooks.ts:84 (createLookbook dup check), :107 getLookbooks,
   :137 getLookbooksForSelector, :230 getCustomerCatalogue — all .collect() the
   WHOLE lookbooks table (no index on lookbooks at all). Need by_boutique.
   getCustomerCatalogue (lookbooks.ts:230) is the worst: it returns EVERY
   boutique's catalogue items to a customer — a correctness + leak issue, section 13.
 - convex/orders.ts:113 getOrders — unindexed full-table .collect().
   Need by_boutique_created_at.
 - convex/dashboard.ts:49 points_ledger, :56 orders, :127 reviews — three
   full-table .collect()s per dashboard load. Need by_boutique indexes.
 - convex/reviews.ts:246 getReviews — builds a query on by_status when filtered,
   else reads the whole reviews table. Need by_boutique_status.
 - convex/settings.ts:448, :773 — .collect() of settings; small today (4 rows)
   but grows one row-set per boutique; by_boutique_key keeps it bounded.
 - convex/platformStats.ts:62,66,106,107,108,109 + the two by_role .collect()s at
   :42-44 and :89-91 — whole-table reads of ledger, orders, message_actions,
   events, lookbooks, settings, and both role partitions of users. This is the
   platform aggregate (section 11); it must group by boutique_id.
Loops over all rows: platformStats iterates all customers (platformStats.ts:47),
all approved reviews (:58), all ledger rows (:63), all purchases (:67), all
activity (:80); dashboard iterates all ledger/orders/reviews; getCustomerCatalogue
loops all lookbooks then all their items (lookbooks.ts:246-266). Each becomes a
per-boutique loop once boutique_id + boutique indexes exist.
Already-indexed per-boutique-ready reads (good patterns to copy): getTodayOrders
(by_created_at), findUpcomingInternal (by_role_birthday_md/anniversary_md,
customers.ts:310-319), dispatch recipients (by_role_consent_vvip, events.ts:305-314).


====================================================================
10. HOSTING AND ROUTING
====================================================================

 - vercel.json: functions.api/dynamic-shell.js includeFiles dist/index.html;
   rewrites send /lookbook, /join, /lookbook/public/:lookbookId,
   /lookbook/piece/:pieceId to /api/dynamic-shell, everything else to
   /index.html; assets get 1yr immutable cache, all else no-store CDN cache.
 - api/dynamic-shell.js: serves the hashed index.html for the customer-facing
   dynamic routes (its own comment, api/dynamic-shell.js:18-24) so OG/meta +
   live Convex client-side fetch work; merchant routes go to the SPA index.html.
   No process.env usage inside it.
 - Convex URL -> frontend: import.meta.env.VITE_CONVEX_URL, read in
   src/main.jsx:10-11 and passed to ConvexReactClient + setConvexClient. ONE
   shared Convex deployment serves every boutique.
What must change so one app address serves every boutique:
 - Add a boutique SLUG to public link paths (e.g. /b/:slug/join or /join?b=:slug,
   and optionally /b/:slug/lookbook/public/:id). Add matching vercel.json
   rewrites so the slug-bearing paths still reach /api/dynamic-shell and the SPA.
 - dynamic-shell.js (and the SPA) must read the slug from the path to pick the
   right boutique's name/logo/OG tags before any token exists.
 - An optional custom domain can later be mapped to a boutique by resolving the
   request Host header -> boutique slug (a lookup in the boutiques table), so no
   per-boutique code change is needed to add a domain — only a data row + a
   Vercel domain attach.
 - Magic links: PORTAL_BASE_URL (auth.ts:32) must become per-boutique (slug path
   on the shared domain today, custom domain later).


====================================================================
11. PLATFORM STATS
====================================================================

 - convex/http.ts:34-50 GET /platform/stats — bearer-secret-gated httpAction
   (PLATFORM_STATS_SECRET, http.ts:38), no CORS, server-to-server; calls
   internal.platformStats.computeStats (http.ts:48).
 - convex/platformStats.ts:35 computeStats — aggregates across ALL data today:
   active customers (platformStats.ts:42-50), approved reviews + their points
   (:54-58), points issued = ledger positives + purchase points + review points
   (:62-67, :129), 7-day activity history (:76-85), owner online/last-action
   (:89-118), first record (:121).
What must change for per-boutique numbers:
 - computeStats must return a breakdown keyed by boutique_id: iterate the
   boutiques table and compute the existing aggregates scoped to each boutique_id
   (every read currently full-table — see section 9 — becomes a per-boutique
   indexed read). The HTTP response shape grows from one object to a map/array of
   per-boutique stat objects (plus optionally a platform-wide roll-up).
 - "Owner online / last action" becomes per boutique (each boutique's own merchant
   row heartbeat). firstRecordAt becomes per boutique.


====================================================================
12. PROTECTED FILES (Ma'am's frontend) — what each needs
====================================================================

Per CLAUDE.md 5.4 these are strict. Multi-boutique touches:
 - src/pages/merchant/Dashboard.jsx — only if stats/sections must show the logged-in
   boutique's name; data already comes from guarded queries, so ideally NO edit if
   boutique scoping is done backend-side. Name/branding via a boutique context.
 - src/components/merchant/Shell.jsx — logo (lines 419/429/447) must show the
   logged-in boutique's logo instead of BRAND.logo; sidebar nav may later be
   filtered by per-boutique feature toggles (section 6). Minimal, approved edit.
 - Customers.jsx — hardcoded "85 Lansdowne" occasion copy (lines 940/953/959)
   must use the boutique name.
 - Campaigns.jsx — default message body (line 18) must use the boutique name.
 - Templates.jsx — default card copy (lines 444/547/558) must use the boutique name.
 - PointsLedger.jsx — tier rules are per-boutique settings; no copy change, but
   updateSettings must target the boutique (backend).
 - Settings.jsx — support ticket; per-boutique contact only.
 - src/data/seed.js — BRAND + CATALOGUE must become boutique-driven / empty for a
   new boutique (section 8). This is the single biggest protected-file concern.
 - src/index.css — no change expected (shared luxury theme); only touch if a
   boutique needs its own accent colour, which should stay out of scope.
 - src/App.jsx — only if slug-bearing customer routes are added (section 10).
All of the above should be done via a single boutique-context value (name, logo,
WA number, tagline) sourced from the boutique the session/token/slug resolves to,
NOT by editing each string — minimizing edits to Ma'am's files.


====================================================================
13. RISKS
====================================================================

Cross-boutique DATA LEAK:
 - getCustomerCatalogue (lookbooks.ts:204-268) returns EVERY boutique's catalogue
   to any authenticated customer — once a 2nd boutique exists, one boutique's
   customer sees another's products. Highest-priority scoping fix.
 - getCustomers/getCustomersPaginated/findCustomerByMobile (customers.ts:376/412/947)
   scan the whole users table — a merchant would see other boutiques' customers
   without a boutique filter.
 - getLookbookById (lookbooks.ts:154) + getCatalogueItemById (lookbooks.ts:278) +
   getEventAccess (events.ts:493) are PUBLIC/unguarded; getEventAccess especially
   must assert the viewing customer's boutique == the event's boutique, else a
   customer of boutique A could unlock boutique B's event by id.
 - getSettings/getTemplateCardUrls (settings.ts:486/565) are public reads — once
   per-boutique they must only return the requested boutique's config.
 - trackActivity (activity.ts:47) is public + unguarded by design and takes a raw
   customer_id — at scale it should verify the customer_id matches a valid magic
   session and stamp that customer's boutique_id, so activity can't be written
   against another boutique's customer.
 - Cross-boutique ownership: every MS mutation that takes a customerId/lookbookId/
   eventId (updateMeasurements, awardPoints, deleteCustomer, updateCatalogueItem,
   deleteEvent, etc.) must assert the target row's boutique_id == the merchant's
   boutique_id, or merchant A can edit merchant B's records by id.

BREAKING 85 LANSDOWNE / old links:
 - Slug-less /join (Join.jsx:34, generateMagicTokenSelf auth.ts:258) resolves by
   mobile only; adding a 2nd boutique makes mobile ambiguous. Must default
   slug-less /join to the 85 Lansdowne boutique so existing links keep working.
 - Existing magic links (/lookbook?id=&token=) and public lookbook/piece ids must
   be backfilled with 85 Lansdowne's boutique_id during the migration, or
   validateMagicToken/getCustomerCatalogue would return nothing.
 - PORTAL_BASE_URL (auth.ts:32) is hardcoded; changing link format risks old
   links. Keep /lookbook?id=&token= working unchanged.
 - Dup-mobile uniqueness (CLAUDE.md note) is enforced in app logic per the whole
   table today; moving to per-boutique uniqueness must not reject a mobile that
   legitimately exists at a different boutique.

SCALE:
 - Every full-table .collect() in section 9 scans all boutiques' rows; without the
   boutique-prefixed indexes, read volume grows with TOTAL customers across ALL
   boutiques, not just one. getCustomers (customers.ts:386), getCustomerCatalogue
   (lookbooks.ts:230), dashboard.ts:49/56/127, platformStats.ts:62/66/89 are the
   hot ones.


====================================================================
14. COUNTS SUMMARY
====================================================================

 - Tables total: 14. Need boutique_id (all per-boutique or singleton->per-boutique):
   14 of 14 (users, lookbooks, catalogue_items, orders, campaigns, settings,
   reviews, message_actions, points_ledger, ai_message_drafts, events,
   notifications, customer_activity_events, customer_activity_summaries). PLUS
   1 brand-new "boutiques" table to create (not counted in the 14).
 - Functions total: 121 (matches npx convex function-spec). Need boutique scoping:
   effectively all data-touching functions; counted explicitly as merchant-guarded
   reads/writes (~55 MS functions) + the 8 public/magic customer-facing data
   functions + ~15 internal cron/AI data functions + computeStats. ~7 pure
   session/no-data helpers (merchantLogout, merchantHeartbeat, saveResetToken,
   testGeminiConnection, the blob upload-url actions) need little or no scoping.
 - Public entry points (customer, no merchant session): 6 — /join, /lookbook,
   /lookbook/public/:id, /lookbook/piece/:id, /login, AccessDenied; only /join is
   slug-ambiguous today.
 - Merchant tabs: 8 (Shell.jsx:14-21) + the global notifications bell.
 - Features (distinct toggleable): ~45 across the 8 merchant tabs + ~18 across the
   5 customer-facing pages (enumerated in section 6).
 - Hardcoded identity hits: ~60 (1 BRAND object, 11 logo usages, ~40 name
   strings, 3 AI-prompt names, PORTAL_BASE_URL, 3 Resend sender/body, 1 boutique
   email) — section 7.
 - Full-table scans / unindexed reads to fix: ~18 .collect() hot spots across
   customers, lookbooks, orders, dashboard, reviews, settings, platformStats —
   section 9.
 - Crons needing per-boutique iteration: 3 registered crons (crons.ts:779/806/831)
   driving ~6 generator actions.
 - Env vars: 8 (GEMINI_API_KEY, ONE_DEVICE_LOCK, RESEND_API_KEY,
   PLATFORM_STATS_SECRET, BLOB_READ_WRITE_TOKEN, WHATSAPP_ACCESS_TOKEN,
   WHATSAPP_PHONE_NUMBER_ID, VITE_CONVEX_URL); 2 must become per-boutique
   (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID); ONE_DEVICE_LOCK optionally
   per-boutique.
