Title: Sizes & Availability Amendment (85 Lansdowne)

Amends: docs/superpowers/specs/2026-11-15-customer-orders-design.md

New requirement from Ma'am (replaces per-size stock counts):
1. No stock numbers anywhere. Stock is no longer counted, reduced on order, or restored on cancel.
2. When adding a piece the merchant chooses one of three size types: "Free size", "One size" or "Sizes". With "Sizes" the merchant toggles which of S, M, L, XL, XXL the piece is available in (at least one). "Free size" and "One size" have no size choice for the customer (quantity only); they differ only in the label shown.
3. Edit stock: the merchant can change the size type, the available sizes, and mark individual available sizes as out of stock. A Free size or One size piece has a single out-of-stock flag. The customer sees out-of-stock sizes but cannot order them.

Decisions:
- New size "S" is added.
- Custom size (measurements) stays available on "Sizes" pieces only, unchanged.
- Pieces with no size_mode (legacy, currently "no size") are treated as Free size everywhere. Orders for them store size "FREE". Existing order rows with size "NONE" stay valid.
- Orders store size "FREE" for Free size pieces and "ONE" for One size pieces.
- Quantity per order line: 1 to 10.

Files changed:
- convex/schema.ts — catalogue_items.size_mode gains "one"; new optional sizes/out_of_stock_sizes/out_of_stock fields; old stock field kept (unused); order_requests.items[].size gains "S"/"ONE".
- convex/lookbooks.ts — validateStockMode replaced by validateSizeAvailability; addCatalogueItem/updateCatalogueItem accept sizes/out_of_stock_sizes/out_of_stock instead of stock; new exported projectSizeAvailability helper (legacy-stock size derivation, missing size_mode -> "free") applied to getLookbookById, getCustomerCatalogue and getCatalogueItemById.
- convex/orderRequests.ts — placeOrderRequest validates each line against projectSizeAvailability instead of stock tally/check/decrement; cancelOrderRequest no longer restores stock.

END OF AMENDMENT
