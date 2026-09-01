# Merchant Session Lock — Design Spec

## Problem
No Convex function checks the merchant session token. Confirmed via live audit (2026-09-01): an unauthenticated caller can read the full customer list, all orders, pending reviews, and settings directly from the public Convex URL. session_token/session_expiry are written on merchant login but never verified on any subsequent call. This is a critical security and DPDP compliance issue.

## What we're building
1. A requireMerchantSession(ctx, userId, token) helper in convex/ that:
   - Looks up the user by userId (ctx.db.get)
   - Confirms role === "merchant"
   - Confirms session_token matches the provided token
   - Confirms session_expiry > Date.now()
   - Throws a clear ConvexError if any check fails
2. Every merchant-only function gets one added guard line at the top calling this helper with (userId, token) arguments added to that function's existing args.
3. src/lib/db.js is updated so every merchant-only call automatically attaches the stored session's userId + token as extra arguments, using the existing saveMerchantSession/getMerchantSession pattern already in the file. No merchant-facing UI component changes — same function names, same call sites in Ma'am's components.

## Functions that stay PUBLIC (no changes)
merchantLogin, validateMagicToken, forgotPassword, getLookbookById, getCatalogueItemById, createReview, createCustomer, getSettings, getTemplateCardUrls
(internal-only functions — findMerchantByEmail, saveResetToken, createPdfLookbook — are already not client-reachable, no change needed)

## Functions split (generateMagicToken)
generateMagicToken is split into:
- generateMagicTokenSelf — public, customer-only, no merchant args, used by /join
- generateMagicTokenForCustomer — merchant-only, requires session args, used by merchant onboarding UI

## Functions that get LOCKED (requireMerchantSession added)
customers.ts: getCustomers, getCustomerById, updateMeasurements, addStaffNote, updateCustomTags, updateCustomerProfile, getUpcomingBirthdays, getUpcomingAnniversaries, recordMessageAction, awardPoints, findCustomerByMobile, bulkCreateCustomers
lookbooks.ts: getLookbooks, getLookbooksForSelector, createLookbook, updateLookbook, deleteLookbook, addCatalogueItem, updateCatalogueItem, deleteCatalogueItem, generatePdfUploadUrl
orders.ts: createOrder, getOrders, getOrdersByUser, getTodayOrders, getTodaySummary
reviews.ts: approveReview, declineReview, getPendingReviews, getReviews
settings.ts: updateSettings, updateTemplate, setTemplateCardUrl, getWhatsAppTemplates, setWhatsAppTemplate, clearWhatsAppTemplate, getWhatsAppTemplateConfig, setWhatsAppTemplateConfig, resetSettings
templates.ts: generateTemplateMediaUploadUrl
whatsapp.ts: sendWhatsAppTemplateMessage, sendWhatsAppServiceMessage
auth.ts: generateMagicTokenForCustomer (new, see split above)

## Schema change
Add a by_session_token index to the users table in schema.ts so requireMerchantSession can verify efficiently without a full table scan, OR verify via ctx.db.get(userId) + compare token (no new index needed) — implementer's choice, document which was used in the ledger.

## Build order (separate prompts, one per file, tested individually)
1. auth.ts: add requireMerchantSession helper + generateMagicToken split
2. customers.ts: lock all 12 functions
3. lookbooks.ts: lock 9 functions
4. orders.ts: lock 5 functions
5. reviews.ts: lock 4 functions
6. settings.ts: lock 9 functions
7. templates.ts: lock 1 function
8. whatsapp.ts: lock 2 functions
9. src/lib/db.js: attach session args to every merchant-only call site
10. Full regression: every locked function tested with no-token / wrong-token / expired-token / valid-token, plus all core flows re-verified end to end

## Test standard (every step)
Real command output required for every change — no bare claims. Each locked function must be shown failing with no/wrong/expired token AND succeeding with a valid one.

## STRICT
Do not touch any src/components/, src/pages/ files, App.jsx, or index.css — only convex/*.ts and src/lib/db.js are in scope. No merchant-facing UI changes.
