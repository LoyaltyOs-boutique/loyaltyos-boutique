Title: Lookbook orders in the merchant AI summary and Customer Intelligence Profile

Goal: Let the merchant-facing AI activity summary and the Customer Intelligence Profile know about a customer's placed lookbook orders (order_requests), without mixing them into paid purchase totals and without ever sending confidential data to the AI.

Evidence (read-only audit, feat/customer-orders 570104c, 2026-11-17): getPurchaseSummaryInternal (convex/ai.ts:816) reads only the orders table, so the summary says "Purchase history: no orders yet" for a customer who placed lookbook orders. getRecentActivityCountsInternal already counts order_placed in the 7-day activity line. getCustomerIntelligenceProfile (convex/customers.ts:1474) returns orders from the orders table only and has no caller today. order_requests has index by_customer_created_at; its items carry confidential measurements and notes plus prices.

Decisions:
1. Two separate lines. The existing "Purchase history" line (orders table, paid) is unchanged. A new "Lookbook orders" line describes placed order_requests and states that payment is not collected yet. The two are never summed.
2. Only status "placed" counts. Cancelled order_requests are excluded.
3. The AI may see, for the most recent placed lookbook order lines (at most 3 lines in total), only: title, size, qty. Measurements, measurement notes, prices, subtotals, mobile, search_text and ids never reach a prompt. This is enforced by a field whitelist inside a new internal query, which returns only those fields.
4. Titles are merchant-entered text: each is truncated with truncateForPrompt and the whole line goes through wrapUntrustedField, under the existing DATA_NOT_INSTRUCTIONS_NOTICE.
5. The prompt tells the model that lookbook orders are requests whose payment is not collected yet and must not be described as spending.
6. getCustomerIntelligenceProfile gets a NEW field lookbook_orders with the same whitelist; the existing orders field is unchanged.
7. Caching is unchanged: daily cron regeneration and the 24-hour on-demand cache rule stay as they are.

Known limits: A new order shows in the AI summary at the next regeneration (daily cron or when the cached summary is older than 24 hours). getCustomerIntelligenceProfile still has no screen that shows it. Customer-facing WhatsApp and event drafts do not use order data.

Test plan: Deploy clean. Terminal test with ZTEST data: the new query returns only whitelisted fields and excludes cancelled orders; the generated summary contains the lookbook orders line and no measurement value, price, mobile or notes text; the old purchase line and activity counts are unchanged; getCustomerIntelligenceProfile returns lookbook_orders with the whitelist. ZTEST data cleaned afterwards.

Amendment 2026-11-17: total pieces

Problem: a test customer had 3 placed lookbook orders with 5 pieces total (M x1, CUSTOM x1, FREE x1, NONE x2). The AI summary received only placedCount plus at most 3 recent example lines (the oldest line fell outside the 3-line cap), so Gemini added up only the 3 examples and wrote "3 lookbook orders totaling 4 pieces" — wrong; real total is 5.

Fix:
1. getLookbookOrderSummaryInternal (convex/ai.ts) now also returns placedPieces = sum of qty over ALL items of ALL placed orders (same placed set placedCount counts; cancelled excluded). Return shape: { placedCount, placedPieces, recentLines }. recentLines unchanged (max 3, newest first, title/size/qty only).
2. generateCustomerActivitySummary (convex/ai.ts): when placedCount > 0 the line now reads "Lookbook orders: N placed, P pieces in total (payment not collected yet). Recent pieces (examples only, not the full list): ..."; "Lookbook orders: none yet." unchanged. New instruction added: "Use the pieces-in-total number exactly as given; never add up the recent pieces yourself." The "payment not collected yet / not money spent" instruction is unchanged.
3. getCustomerIntelligenceProfile (convex/customers.ts): lookbook_orders now includes placed_pieces (same rule, same order set as placed_count); placed_count and recent unchanged. Same field whitelist as before (no measurements, notes, prices, mobile).

No schema, index, table or dependency change. The confidential-field whitelist is unchanged: placedPieces/placed_pieces is a pure qty sum, carries no new confidential data.

END OF DESIGN
