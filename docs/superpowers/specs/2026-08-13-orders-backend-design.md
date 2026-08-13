# Design: Orders + Points Backend (PRD Module 7)

## Design Decisions
| Decision | Rationale |
| :--- | :--- |
| **Atomic Transaction** | Mutation `createOrder` wraps order insertion + user points update to ensure consistency. |
| **Currency Invariant** | All money operations use integer paise (₹1 = 100 paise). |
| **Points Engine** | 1pt = ₹1 (100 paise). Earn rate: floor(subtotal / 10000). |
| **Scalability** | Standard Convex `defineTable` with indexes; no complex aggregations in main hot path. |

## Global Constraints
- All money fields are INTEGER PAISE — never floats.
- ₹1 = 100 paise · ₹23,500 = 2,350,000 paise.
- Earning rate: 1 pt per ₹100 = 10,000 paise spent, floored.
- Redemption: 1 pt = ₹1 = 100 paise.

## API Specification (convex/orders.ts)
1. `createOrder`: mutation
   - Args: `user_id`, `subtotal_paise`, `payment_method`, `points_applied?`
   - Logic: Validate inputs, check points balance, calculate final total and points earned (incorporating tier multiplier), atomic update of user and order table.
2. `getOrders`: query
   - Logic: All orders sorted by `created_at` descending.
3. `getTodayOrders`: query
   - Logic: Filter `created_at` >= start of today.
4. `getTodaySummary`: query
   - Logic: Aggregate count, revenue, issued points, redeemed points for today.
5. `getOrdersByUser`: query (optional)
   - Logic: Filter by `user_id`.

## Verification Steps
1. Verify `createOrder` atomic updates (success & failure cases).
2. Verify points calculation logic matches business rules (₹100=1pt floor).
3. Verify `getTodaySummary` accurately reports totals.
4. Verify zero frontend changes via git diff.