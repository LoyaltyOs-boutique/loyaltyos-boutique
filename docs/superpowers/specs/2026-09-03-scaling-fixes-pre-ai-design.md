# LoyaltyOS Boutique — Pre-AI Scaling Fixes (Phase 0)
Design doc — 4 performance fixes identified in the 2026-08-31 scalability audit, required before the AI Automation phase adds new load

## Why now
The 2026-08-31 scalability audit (docs/superpowers/reports/2026-08-31-scalability-audit-300-to-1000.html) flagged 4 Medium-risk items that will be directly touched/worsened by the upcoming AI Automation phase (customer lists + personalization). Per the AI Automation Phase Build Plan's own recommendation, these are fixed first, as their own branch/build/test/merge cycle, before the AI work begins.

## Non-negotiable: zero user-visible regression
Every fix here changes ONLY how data is fetched internally — never what data is shown or how it looks. For each fix, the exact same result set that the old (slow) query produced must come back from the new (fast) query, for the same underlying data — same customers, same totals, same dates, same page appearance. If a before/after comparison shows even one different row, count, or visual difference, that fix is not done, no matter how fast it is.

## Fix 1 — CRM customer list full-pull (convex/customers.ts getCustomers, src/pages/merchant/Customers.jsx)
Today: every page open pulls the entire customer table even though only 6 rows are shown at a time.
Fix: paginate getCustomers (cursor-based, using Convex's built-in pagination helper) so only the currently-viewed page's rows are fetched; Customers.jsx wires pagination controls (or infinite-scroll) instead of client-side slicing of a full-table fetch. Regression check: total customer count and the full set of customers (paged through) must exactly match today's full-pull result.

## Fix 2 — Dashboard "today's orders" full-history scan (convex/orders.ts getTodayOrders / getTodaySummary)
Today: every order ever placed is read, then filtered down to today's date in application code.
Fix: add a Convex index on the order's date field (or a derived "date_key" field formatted as a sortable string) and query using that index with a range filter for today only — no full-table read. Regression check: today's order list and summary totals (count, revenue, points) must exactly match what the old full-scan version returns for the same data.

## Fix 3 — Birthday/Anniversary reminder list full scan (convex/customers.ts getUpcomingBirthdays / getUpcomingAnniversaries)
Today: every customer row is checked one-by-one to build the "tomorrow" list.
Fix: add a Convex index on birthday/anniversary stored as a sortable "MM-DD" string, query by that index for tomorrow's MM-DD directly. This query is also what the new AI draft-generation cron (a later phase of the AI Automation work) will call daily, so this fix directly benefits that feature too. Regression check: the exact same set of customers must appear as before, for the same test data.

## Fix 4 — Frontend single-bundle loading
Today: the whole app loads as one JS bundle for every visitor (customer and merchant alike).
Fix: introduce route-based code-splitting (React.lazy + Suspense, or Vite's dynamic import) so merchant-only pages (Dashboard, Customers, Settings, Points Ledger, Templates) load separately from the customer-facing Lookbook/PublicLookbook pages — a customer opening their lookbook link never downloads merchant-dashboard code, and vice versa. Regression check: every existing page (merchant and customer side) must still render and function identically — no blank screens, no broken routes, no missing lazy-loaded chunk errors.

## What stays untouched (STRICT)
No change to requireMerchantSession, whatsapp_consent gate, the WhatsApp send/approve flow, or any table's actual data — these are pure query-efficiency and bundle-splitting changes. No visual/UI change for the merchant or customer (pin-to-pin — pagination is under the hood; if pagination controls are visibly needed, they must reuse existing .btn-ghost/.input classes verbatim per this project's UI-matching discipline).

## Test approach
Each fix is verified with real before/after evidence: (a) a functional regression diff — same query run before and after the fix, on the same data, confirming identical results, (b) query timing or document-read counts for Fixes 1-3 (e.g. Convex dashboard function stats, or explicit console.time around the call), and (c) `npm run build` bundle-size-per-chunk output for Fix 4 (confirming merchant and customer bundles are now separate files, not one, and every route still loads).

## Build order
One branch (feat/scale-fixes-pre-ai) off main, 4 fixes built and tested individually within it (small chunks, same discipline as Task 1 — one fix fully tested before starting the next), then one team-tested merge to main before the AI Automation phase branch is rebased on the updated main.
