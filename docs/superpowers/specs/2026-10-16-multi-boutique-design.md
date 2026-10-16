LoyaltyOS Multi-Boutique Design
Date: 2026-10-16
Status: draft v2 for approval
Branch: feat/multi-boutique-phase0
Source audit: docs/superpowers/audits/2026-10-15-multi-boutique-audit.md

1. GOAL
- LoyaltyOS becomes one app that serves many boutiques. 85 Lansdowne is the first boutique.
- The Platform Admin (super admin) creates a boutique with a name, a slug, an owner email and password, and a logo. The new boutique starts with zero data.
- Every boutique sees the same luxury UI, fonts and colours. Only the boutique name and logo differ.
- The Platform Admin can switch every tab, and every feature inside each tab, on or off per boutique. Everything is ON by default, including for 85 Lansdowne.
- No boutique needs its own domain. All boutiques run on the one app address. A custom domain is an optional later add-on and is out of scope for this build.
- 85 Lansdowne must keep working with no break, and every existing customer link must keep working.
- The design must stay fast when there are many boutiques and each boutique has many customers.

2. DECISIONS (approved by the user on 2026-10-16)
- D1 Public links carry a boutique slug in the path, for example /join/85-lansdowne. The old /join link without a slug always opens the default boutique (85 Lansdowne).
- D2 One shared Gemini key (environment variable, paid by Mould Innovation). AI features are switched on or off per boutique with feature toggles.
- D3 WhatsApp is per boutique: each boutique has its own access token and phone number id, entered in the Platform Admin, stored server side, never returned to any browser.
- D4 Email uses one shared sender (digital@mouldinnovation.com). The boutique name appears in the sender name and in the email body.
- D5 The one-device login lock is a per-boutique setting, default ON. 85 Lansdowne stays ON.
- D6 The "reset demo data" button on the login page (src/pages/Login.jsx:96-98) is removed from the app.
- D7 The Platform Admin creates and manages boutiques through secured HTTP endpoints on the LoyaltyOS backend, using a shared secret, the same pattern as the existing stats endpoint.

3. DATA MODEL

3.1 New table boutiques
- name: string (display name, for example "85 Lansdowne")
- slug: string, lowercase letters, digits and hyphens, 3 to 40 characters, unique, never changed after creation (links depend on it). 85 Lansdowne uses "85-lansdowne".
- logo_storage_id: optional file storage id; logo_url resolved server side
- status: "active" or "suspended". A suspended boutique cannot log in and its public links show an unavailable message.
- is_default: boolean. Exactly one boutique (85 Lansdowne) is the default; slug-less links resolve to it.
- one_device_lock: boolean, default true
- flags: record of string to boolean. A missing key means ON. Tab keys look like "tab.customers"; feature keys look like "customers.bulk_send_all".
- custom_domain: optional string, reserved for the later custom-domain add-on, unused in this build
- created_at, updated_at: numbers
- Indexes: by_slug (slug), by_default (is_default)

3.2 New table boutique_secrets
- boutique_id, whatsapp_access_token, whatsapp_phone_number_id
- Index: by_boutique (boutique_id)
- Read only by internal functions. No query or mutation ever returns these fields to a client.

3.3 boutique_id on every existing table
All 14 tables get boutique_id: v.id("boutiques"): users, lookbooks, catalogue_items, orders, campaigns, settings, reviews, message_actions, points_ledger, ai_message_drafts, events, notifications, customer_activity_events, customer_activity_summaries.

3.4 Index rules
- Every index used to list or count records starts with boutique_id, for example users.by_boutique_mobile, users.by_boutique_role_birthday_md, orders.by_boutique_created_at, reviews.by_boutique_status, settings.by_boutique_key, notifications.by_boutique_seen.
- users.by_magic_token stays global: tokens are random and unique, and the boutique is read from the row.
- users.by_email stays global for merchant login. Merchant emails must be unique across all boutiques.
- Customer mobile numbers are unique per boutique (by_boutique_mobile), not across boutiques. The same person can be a customer of two boutiques.
- settings becomes one document per boutique per key (by_boutique_key).
- Old indexes are removed only after every read has moved to the new ones.

3.5 Migration of 85 Lansdowne data (Phase 1), in three deploys
- Step A: add the boutiques and boutique_secrets tables, add boutique_id as optional on all 14 tables, add the new indexes. Nothing reads them yet.
- Step B: create the 85 Lansdowne boutique row (is_default true, slug 85-lansdowne, one_device_lock true, empty flags = all ON), then backfill boutique_id on every existing row with an internal mutation that works in batches and can be safely re-run.
- Step C: switch all reads and writes to the boutique-scoped indexes, then make boutique_id required.
- Every step runs first on the test backend (aware-rabbit-290) with synthetic test data, then on the live backend (pleasant-cobra-560) only after approval. The user takes a full backup with npx convex export himself before each live step; the backup file stays on his machine and is never committed.

4. KNOWING THE BOUTIQUE (no domain needed)

4.1 Merchant
- Login by email and password as today. The user row gives boutique_id.
- requireMerchantSession returns the merchant and boutiqueId. Every merchant function takes boutiqueId only from the session, never from a client argument.
- A suspended boutique's merchant cannot log in.
- One owner login per boutique in this build.

4.2 Customer with a magic link
- The link stays the same (/lookbook?id=...&token=...). The token's user row gives boutique_id. Old links keep working because existing rows are backfilled with the 85 Lansdowne boutique_id.

4.3 Public links and public functions
- /join/:slug: self-onboarding into that boutique. /join without a slug opens the default boutique.
- /lookbook/public/:lookbookId and /lookbook/piece/:pieceId: the boutique is read from the lookbook or piece record; name and logo shown are that boutique's.
- getEventAccess, getLookbookById, getCatalogueItemById, getSettings and getTemplateCardUrls must check that the requested record belongs to the boutique resolved from the slug, token or record, and return nothing otherwise.
- generateMagicTokenSelf and the /join flow look up the mobile number only inside the resolved boutique.
- trackActivity (convex/activity.ts:47) must require the customer's magic token, check that the token belongs to the given customer, and stamp the boutique_id from that customer's row. A call with a missing or wrong token writes nothing. The customer pages already hold the token, so they pass it.
- AccessDenied and the login page show the default boutique's name and logo unless a slug or token identifies another boutique.

4.4 Ownership check on every by-id call
- A shared helper asserts that any record loaded by id (customer, lookbook, piece, order, review, event, campaign, notification, draft, activity event, activity summary, message action, ledger row) has the same boutique_id as the caller. Every function that takes an id uses it. Merchant A can never read or change merchant B's records by id.

5. FUNCTION SCOPING
- All 121 functions are scoped (see audit section 2 for the list): merchant functions through the session boutiqueId, customer functions through the token's boutique, public functions through the slug or record, internal and cron functions through an explicit boutique_id argument.
- Exception, aggregate functions: computeStats (convex/platformStats.ts) and the stats HTTP route (convex/http.ts) are the only functions that may read more than one boutique, and only behind the platform secret. They are handled as described in section 9.
- getCustomerCatalogue (convex/lookbooks.ts:204-268) must read only the customer's boutique's lookbooks and pieces through an index. This is the first fix in Phase 1 because it is a cross-boutique leak.
- createCustomer keeps its current guard behaviour exactly and gains boutique scoping only; the guard must not be widened.
- No .collect() or .filter() over a whole table remains. Lists use boutique-scoped indexes and pagination.
- Session, logout and heartbeat helpers keep working per merchant row.

6. PER-BOUTIQUE SETTINGS AND SERVICES
- Tier and points rules, template card images and all other settings documents: per boutique (settings by_boutique_key). A new boutique starts with the same built-in defaults the code uses today when no settings document exists.
- WhatsApp: boutique_secrets per boutique. If a boutique has no credentials, sends fall back to the existing wa.me link flow.
- Gemini (GEMINI_API_KEY): one shared key from the environment; prompts use the boutique's name instead of a hardcoded name.
- Email (RESEND_API_KEY): shared sender; sender name and body use the boutique name.
- ONE_DEVICE_LOCK environment variable stays as a global kill switch. The lock applies only when the environment allows it AND the boutique's one_device_lock is true.
- PLATFORM_STATS_SECRET stays for the stats endpoint. A new separate secret, PLATFORM_ADMIN_SECRET, protects the boutique management endpoints.
- BLOB_READ_WRITE_TOKEN (file uploads) stays one shared token for all boutiques. Uploaded file URLs are saved only on boutique-scoped records, and new upload paths start with the boutique slug so files of different boutiques never mix.
- VITE_CONVEX_URL stays one value: the one Convex backend that serves every boutique.
- PORTAL_BASE_URL stays the one app address; links add the slug where section 4.3 says.

7. BRANDING AND EMPTY START
- Every hardcoded boutique name, logo import, address, phone and email found in audit section 7 is replaced by the boutique's name and logo from the backend. The visual design, fonts, colours and layout do not change.
- While the branding loads, the default boutique's current name and logo are shown, so 85 Lansdowne looks exactly as today.
- A new boutique starts with zero customers, lookbooks, pieces, orders, reviews, campaigns, events and ledger rows.
- Demo and seed data (src/data/seed.js, local fallbacks such as createLocalCustomer and hardcoded catalogue items) must never appear for a non-default boutique. For 85 Lansdowne the current behaviour is kept in this build and reviewed later.
- The reset demo data button is removed (D6).

8. TABS AND FEATURE TOGGLES

Rules:
- A tab that is OFF is hidden from the sidebar, its route redirects to the first enabled tab, and every backend function that belongs only to that tab refuses with a clear "feature_disabled" error.
- A feature that is OFF is hidden in the UI and its backend function refuses with "feature_disabled".
- A feature inside a tab that is OFF is treated as OFF.
- Core functions are never toggles: login, logout, session, customer list and search, magic-link lookbook access, the consent checkbox, AccessDenied.
- Missing flag keys mean ON, so new features added later are ON for every boutique until switched off.
- Parts that belong to a feature are switched with it: the campaign message body (Campaigns.jsx:247) belongs to campaigns.dispatch; the "Send via WhatsApp" button of a card (Templates.jsx:403) belongs to that card's key (templates.anniversary_card or templates.birthday_card); the Card 3 send belongs to templates.media_send.
- Virtual events have no customer page today (getEventAccess is not used by any page). Events are switched with campaigns.event_setter; a customer events key is added only when a customer events page is built.

Merchant tabs (8):
- tab.dashboard (Delight Desk)
- tab.customers (Customer CRM)
- tab.onboarding (Client Onboarding)
- tab.campaigns (WhatsApp Campaigns)
- tab.catalogue (Lookbook Manager)
- tab.templates (Templates)
- tab.points (Points Ledger)
- tab.settings (Settings and Support)

Merchant features (43):
- Delight Desk (8): dashboard.onboard_cta, dashboard.review_chip, dashboard.occasion_chips, dashboard.stats_tiles, dashboard.google_review_approval, dashboard.recent_activity, dashboard.active_this_week, dashboard.ai_summary
- Customer CRM (9): customers.occasion_tabs, customers.reviews, customers.lookbook_preview, customers.magic_link_share, customers.manual_points, customers.edit_profile, customers.occasion_approve_send, customers.bulk_send_all, customers.delete
- Client Onboarding (4): onboarding.join_link_whatsapp, onboarding.manual_add, onboarding.vvip, onboarding.csv_import
- WhatsApp Campaigns (6): campaigns.event_setter, campaigns.ai_event_draft, campaigns.flyer_upload, campaigns.audience_filters, campaigns.dispatch, campaigns.history
- Lookbook Manager (7): catalogue.add_piece, catalogue.edit_piece, catalogue.media_gallery, catalogue.csv_import, catalogue.pdf_lookbook, catalogue.delete_lookbook, catalogue.share_piece
- Templates (5): templates.anniversary_card, templates.birthday_card, templates.ai_regenerate, templates.replace_card_image, templates.media_send
- Points Ledger (2): points.tier_rules, points.give_points
- Settings and Support (1): settings.support_ticket
- Shell (1): shell.notifications_bell

Customer features (9):
- customer.likes, customer.cart_checkout, customer.whatsapp_inquire, customer.product_reviews, customer.google_review, customer.boutique_messages
- customer.self_onboarding (the /join page)
- customer.public_lookbook (/lookbook/public/:id)
- customer.public_piece (/lookbook/piece/:id)

Total: 8 tabs and 52 features. Before the Phase 4 build, an audit re-checks every page against this list; any feature found missing is added to this list first.

9. PLATFORM ADMIN CONNECTION
- New HTTP endpoints on the LoyaltyOS backend, protected by PLATFORM_ADMIN_SECRET: list boutiques, create boutique (name, slug, owner email, owner password, logo), update boutique (name, logo, status, one_device_lock, flags), set WhatsApp credentials (write only, never read back), and stats per boutique.
- The owner password is hashed with the same method the app uses today and is never stored or logged in the Platform Admin.
- The existing stats endpoint (convex/http.ts, convex/platformStats.ts) gains a boutique parameter and a list mode, while keeping its current response for 85 Lansdowne until the Platform Admin is updated.
- The Platform Admin's own database stores no WhatsApp credentials and no owner passwords.

10. CRONS
- The 3 registered crons (convex/crons.ts:779, 806, 831) loop over active boutiques and schedule one job per boutique, so one large boutique cannot slow down or break another. Each job reads only that boutique's rows through boutique-scoped indexes.

11. HOSTING AND ROUTING
- One Vercel app and one Convex production backend for all boutiques.
- vercel.json and api/dynamic-shell.js also serve /join/:slug with the same no-store behaviour as /join. Link previews show the boutique's name and logo.
- The later custom-domain add-on maps a host name to boutiques.custom_domain; nothing else in the app needs to change for it.

12. SAFETY RULES FOR THE BUILD
- Every phase on its own branch in the multi-boutique worktree, tested on aware-rabbit-290, merged with --no-ff only after approval. Never work on main directly.
- 85 Lansdowne regression checklist after every phase: merchant login and one-device lock, every tab, existing magic links, slug-less /join, public lookbook and piece links, activity tracking, Platform Admin stats matching the Delight Desk.
- Cross-boutique leak test after every phase: with two test boutiques, merchant A tries every function with boutique B's ids and must be refused; customer A's token must never show or write boutique B's data.
- Protected frontend files change only with approval, and only for name and logo, feature gating and slug routes. No visual change.
- Running npx convex dev in the multi-boutique worktree can rewrite CLAUDE.md and convex/_generated/ai/*; those changes are always restored and never committed.
- Live deploys and live data changes are run by the user himself.

13. PHASES
- Phase 1 Data wall: sections 3, 4.4 and 5, including the getCustomerCatalogue fix, the trackActivity fix and the three-step migration.
- Phase 2 Boutique identity: section 4 (session boutique, token boutique, slug links, default boutique).
- Phase 3 Branding and empty start: section 7.
- Phase 4 Feature toggles: section 8.
- Phase 5 Platform Admin: section 9, plus the toggle, logo, WhatsApp and per-boutique stats screens in the Platform Admin.
- Phase 6 Custom domain: deferred, out of this build.
- Phase 7 Big test: section 12 checklists in full.
- Phase 8 Go live: live migration and deploys, run by the user.

14. OUT OF SCOPE
- Plans and pricing linked to toggles.
- Custom domains.
- The two known critical security issues (magic-link takeover via generateMagicTokenSelf, createCustomer duplicate-mobile leak); they stay on the separate later OTP work.
- Per-boutique Gemini keys and per-boutique email domains.
- Several staff logins per boutique, and boutique owner self-signup.
- Logo changes by the boutique owner (Platform Admin only for now).
- A customer-facing virtual events page.