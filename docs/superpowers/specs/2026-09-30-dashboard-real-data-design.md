# Delight Desk dashboard: real data alongside demo data

## Goal
The dashboard must show real Convex numbers for Total customers and Points issued, and must also show real customer activity in Recent Activity and real pending reviews of every type in the reviews list. Existing demo data is kept and not removed.

## Evidence (design check on branch fix/tab-audit at 4098547)
Total customers is counted from browser state that mixes 7 seed demo customers with real ones (screen 86, real 95 non-deleted). Points issued sums a local-only array (screen 2,975, real earned sum 6,666). hydrateReviews already loads all 12 real pending reviews (all type product, mapped to local platform in-app), but pendingGmbReviews filters platform gmb only; pendingGmbReviews is used by Dashboard.jsx:72 and Customers.jsx:303. The dashboard reviews card arrow opens the Customer CRM reviews tab. Recent Activity reads only the local state.events log (seed plus actions done in this browser). customer_activity_events has 323 real rows (lookbook_view 253, like 39, cart_add 31); no public query returns them per event today.

## Decisions (approved by the user)
1. New file convex/dashboard.ts with two queries, both guarded by the existing requireMerchantSession (called, never modified). No other Convex file changes.
2. getDashboardSummary({ userId, token }) returns { totalCustomers, pointsIssued }. totalCustomers = users with role customer and is_deleted not true. pointsIssued = sum of points_ledger delta where delta > 0.
3. getRecentCustomerActivity({ userId, token, limit }) returns the newest real customer actions, newest first, at most limit (default 50, capped at 100): customer_activity_events (like, cart_add, lookbook_view, event_link_click) read through the by_created_at index in descending order, plus submitted reviews of every type. Each item: { id (prefixed so it cannot collide with local ids), customerId, customerName, kind, itemTitle (optional), createdAt (number) }. Rows for deleted or missing customers are skipped. No token, password, measurements, staff notes or contact fields are ever returned.
4. Frontend (separate prompt): db.js caches both results, fills them from hydrateAllMerchantData, derivedMetrics prefers the server values for totalCustomers and pointsIssued (never adding them to local counts), and Recent Activity shows real items merged with the existing local events without writing real items into localStorage. For reviews, the existing db.js function pendingGmbReviews keeps its name and callers but its filter is widened from platform gmb only to every pending review of every type. Because Dashboard.jsx:72 and Customers.jsx:303 both call it, the dashboard count, the dashboard list and the Customer CRM reviews tab all show the same pending reviews, so clicking the dashboard card lands on a list that matches the count.
5. No protected file changes: Dashboard.jsx and Customers.jsx are not edited at all. All labels stay as they are, including "Google reviews to approve". The frontend prompt must confirm that the Customer CRM reviews tab renders and approves a product review without errors.
6. Clicking a Recent Activity row keeps opening the existing history popup, which shows points, orders and reviews only; likes, cart adds and lookbook views do not appear in that popup. Accepted by the user for now.
7. Demo data stays. Known effect: the reviews list and its count include demo pending reviews next to real ones until demo data is cleaned up later.

## Known limits
getRecentCustomerActivity and getDashboardSummary read small tables in full for reviews and points_ledger (74 and 56 rows today); fine now, to be revisited before large scale. The summary refreshes when the merchant shell loads (login, reload, new tab), not live.

## Test plan
Backend deploy with a clean TypeScript check; function-spec shows both new functions with the expected arguments; call-site count of requireMerchantSession goes from 60 to 62; no existing function signature changes. Frontend later: build with CSS 30.42 kB, and a browser check that Total customers shows 95 and Points issued 6,666, real pending product reviews appear on the dashboard and in the Customer CRM reviews tab with the same count, a product review can be approved from the CRM without errors, and real activity appears in Recent Activity.
