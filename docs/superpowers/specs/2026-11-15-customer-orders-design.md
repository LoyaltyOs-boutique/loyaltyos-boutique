Title: Customer Orders with Size, Quantity and Stock (85 Lansdowne)

Goal: Let a customer choose size (M, L, XL, XXL, Free size, or Custom size with measurements) and quantity before adding a piece to the bag; save the customer's order in Convex so the merchant really receives it; let the merchant set per-size stock in Lookbook Manager; give the merchant a new "Orders" tab (above Settings & Support) with a date selector, search and cancel; and tell the merchant about each order through Recent Activity, weekly activity and the AI summary.

Evidence (read-only audit, main 2f23afa, 2026-11-15):
- The bag is only React state (src/pages/Lookbook.jsx:36). Customer checkout writes to Convex only when a merchant session exists (src/lib/db.js:1813-1823), so a real customer order never reaches the backend. The success screen is built from local state.
- catalogue_items.size and .colour are unused (0 readers or writers; 0 live rows). There is no stock field anywhere.
- The existing orders table has 9+ readers (points, AI summary, platform stats, dashboard revenue, merchant order queries). Changing it would entangle all of them.
- getCustomerCatalogue (convex/lookbooks.ts:204-269) holds the safe magic-link validation pattern. trackActivity (convex/activity.ts) is unguarded and must NOT be copied for orders. Rate limiting uses convex/rateLimits.ts rateLimiter buckets.
- users.measurements exists (bust, waist, hip, height, blouse_size); Ma'am's merchant form labels these in cm.

Decisions:
1. Sizes are M, L, XL, XXL. A piece is either "sized" (separate stock for M, L, XL, XXL), "free" (one stock count, no size selector shown), or unset (legacy pieces, which behave exactly as today: quantity only, no stock limit, no size).
2. Custom size is available on "sized" pieces only. It is made to order and never reduces or checks stock.
3. Stock is reduced at the moment the order is placed, inside the same Convex mutation, so two customers cannot both buy the last piece. If stock is too low, the whole order is rejected with a clear message and nothing is written.
4. A NEW table order_requests stores customer orders. The existing orders table, createOrder, points, revenue, the AI purchase summary over orders, and platformStats are not changed.
5. Order status is only "placed" or "cancelled". There is no merchant confirm step and no delivered status. Cancelling restores stock for non-custom lines and can never restore twice.
6. No loyalty points are given for these orders (to be designed together with Razorpay later).
7. Custom measurements are saved on the order only, never written back to the customer profile. The customer form is prefilled from users.measurements. Each saved measurement set records its unit ("cm" or "in").
8. Measurements: required bust, waist, hip, shoulder, top_length; optional sleeve_length, armhole, bottom_length, height, and notes (max 300 characters).
9. Price is always read from the database by the server, never trusted from the browser.
10. The customer's payment choice (online or in-store) is saved as payment_preference, and payment_status is always "not_collected" until Razorpay exists.
11. The merchant Orders tab shows the selected date (default today, India time), page by page. A search box (customer name, mobile, product name) searches across all dates, newest first, up to 50 results, using a Convex search index on a stored search text.
12. Orders do NOT create bell notifications, so the bell stays focused on birthdays, anniversaries and weekly activity. Each placed order inserts one customer_activity_events row (new action "order_placed") so Recent Activity, the weekly most-active scoring and the AI activity summary include it. The merchant also sees every order in the Orders tab.
13. The customer success screen text ("Payment successful", "Razorpay") is left unchanged for now and is a known issue until Razorpay.

Build order (one branch feat/customer-orders, push only at the end): Step 1 backend; Step 2 Lookbook Manager stock UI; Step 3 customer size, quantity, custom size and real order placement; Step 4 merchant Orders tab plus Recent Activity text. Each UI step reuses Ma'am's existing classes only (Campaigns.jsx:272 pill pattern for sizes, Lookbook.jsx:421-424 quantity buttons, Lookbook.jsx:462-468 modal, input type="date" className="input", Customers.jsx .tbl table, Shell.jsx NAV item, App.jsx route pattern).

Known limits: No real payment. Customer success screen still says "Payment successful" until Razorpay. Search matches whole words or word starts, not the middle of a number. Legacy pieces without stock never run out. No bell notification for orders by design.

Test plan: Backend: deploy clean; schema accepts all existing data; magic-link rejection for wrong or expired token; rate limit; price taken from the database; stock decrements and rejects oversell atomically; custom lines skip stock; cancel restores once only; date list, search and pagination; merchant guard on every merchant function; activity row written and no notifications row written; existing orders, platformStats, dashboard and AI order readers byte-identical. Frontend: CSS stays near 30.42 kB with no invented classes; manual tester checklist on the branch preview for both customer and merchant sides. All test data named ZTEST and cleaned up with the dry-run temporary-mutation pattern.

END OF DESIGN
