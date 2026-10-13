Title: Delight Desk Points issued counts every point given
Goal: the Delight Desk "Points issued" card must show all points the boutique has actually given, not only manual ledger points.
Evidence: the card reads pointsIssued (src/pages/merchant/Dashboard.jsx:138) from dashboardSummaryCache (src/lib/db.js:2490, 2729), which comes from getDashboardSummary in convex/dashboard.ts:45-49; that query sums only positive points_ledger.delta, so purchase points (orders.points_earned) and approved review points (reviews.points_awarded) are never counted; the Platform Admin already sums all three (convex/platformStats.ts:139); audit numbers on 2026-10-13: card 6,678, purchase points 22,724, approved review points 24,600, total 54,002 for all customers (46,211 with test customers excluded).
Decisions (approved by the user):
1. getDashboardSummary computes pointsIssued as the sum of positive points_ledger.delta, plus orders.points_earned, plus points_awarded of approved reviews, where "approved" uses exactly the same condition as convex/platformStats.ts.
2. All customers are counted; there is no name-based test-customer exclusion. The total will drop by itself when test data is cleaned up.
3. Only convex/dashboard.ts changes. Dashboard.jsx, db.js and every other file stay the same, and the card keeps its label and "lifetime earned" text.
4. getDashboardSummary keeps its merchant session guard and returns every other field exactly as before.
5. LoyaltyOS has one Convex deployment, pleasant-cobra-560, so the new total is live on production as soon as it is deployed, before the merge.
Known limits: test customers stay in the total until the test data cleanup; the query reads three whole tables, which is fine at the current size (users 106, points_ledger 59, orders 16, reviews 75) but will need an index-based or stored total if the tables grow large.
Test plan: a read-only data check reproduces the new total (54,002 on 2026-10-13, or the current value if data changed) using the same rules; function count stays 121; requireMerchantSession count stays 62; ONE_DEVICE_LOCK stays on; convex/auth.ts and convex/schema.ts diffs are empty; the user checks the Delight Desk card in the browser.
END OF DESIGN.
