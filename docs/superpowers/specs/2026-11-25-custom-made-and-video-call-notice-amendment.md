Title: Custom made option + "already requested" video call notice (85 Lansdowne)
Amends: 2026-11-24-sizes-availability-amendment.md and 2026-11-25-video-consultations-design.md
1. Size options for a piece are: Free size, Sizes, Custom made. "One size" is removed.
   - Sizes and Custom made can be chosen together. Free size cannot be combined with either.
   - Free size: customer picks quantity only.
   - Sizes only: customer sees only the chosen sizes (S/M/L/XL/XXL), no Custom size.
   - Custom made only: customer sees only Custom size (measurements form).
   - Sizes + Custom made: customer sees the chosen sizes and Custom size.
   - Out of stock stays per size for Sizes, and a single flag for Free size. Custom size is made to measure and never out of stock.
2. Existing "One size" pieces are treated as Free size. Existing orders keep their saved size labels (including "One size").
3. Custom size is accepted on an order only when the piece is Custom made. Existing Sizes pieces show Custom size only after the merchant turns Custom made on.
4. In the customer lookbook, a piece the customer already requested a video call for in the last 24 hours shows: "You've already requested a video call for this piece. Our stylist will WhatsApp you shortly." Tapping the button again shows the same notice.

Files:
- convex/schema.ts — catalogue_items gets optional `custom_made` (boolean); size_mode union unchanged
- convex/lookbooks.ts — validateSizeAvailability, normalizeSizeFields, projectSizeAvailability updated; addCatalogueItem/updateCatalogueItem size_mode arg narrowed to "free"|"sized" + custom_made arg added
- convex/orderRequests.ts — per-line validation: CUSTOM gated on custom_made, legacy "one" merged into the free branch (accepts FREE/NONE/ONE)
- convex/videoCalls.ts — new public query getMyRecentVideoCallRequests
