import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * LoyaltyOS Boutique — Customer Activity Intelligence: real tracking backend.
 * Design spec: docs/superpowers/specs/2026-09-07-customer-activity-intelligence-design.md
 *
 * This is Part 1 of 3 (data-tracking only). Replaces today's frontend-only
 * like/cart behaviour with real Convex persistence for four non-purchase
 * engagement signals: cart_add, like, lookbook_view, event_link_click.
 * Purchases are intentionally NOT tracked here — a future summary function
 * reads purchase history directly from the existing `orders` table.
 *
 * OUT OF SCOPE for this file (separate, later tasks per the design doc):
 *   - the weekly "most active customers" notification (reuses `notifications`
 *     as-is, no schema change to it)
 *   - generateCustomerActivitySummary (the AI summary function)
 *
 * AUTH — deliberately PUBLIC / UNGUARDED (no requireMerchantSession):
 * the caller here is always the CUSTOMER's own browser session
 * (Lookbook.jsx's like/cart-add/mount-view calls), which has no merchant
 * token at all — customers authenticate via a completely separate
 * magic-link mechanism (see auth.ts's validateMagicToken). This mirrors the
 * exact posture this codebase already has for createReview and
 * generateMagicTokenSelf (see rateLimits.ts's own comment: "public +
 * intentionally unguarded ... worst case is spam, not a data/security
 * incident"). It only needs the customer's real `_id` (v.id("users")), not a
 * session/token.
 *
 * RATE LIMITING: intentionally NOT added in this task — the design doc
 * (§b.2) flags this as an implementation-time follow-up, not part of this
 * task's scope. Do not add it here without a separate, explicit task.
 */

/**
 * trackActivity — single-purpose insert into `customer_activity_events`.
 * Fire-and-forget from the frontend: callers must never `await` this in a
 * way that blocks/gates the real user-facing action (like toggle, cart add,
 * page render) — see src/lib/db.js (likeItem/trackCartAdd) and
 * src/pages/Lookbook.jsx for the `.catch(() => {})` calling convention.
 *
 * Exactly one of catalogue_item_id / lookbook_id / event_id is expected to
 * be set, depending on `action` — enforced by caller convention, not by a
 * discriminated union (matches this schema's existing flat-optional-field
 * style used by `reviews`/`orders`, see schema.ts's own reasoning).
 */
export const trackActivity = mutation({
  args: {
    customerId: v.id("users"),
    action: v.union(
      v.literal("cart_add"),
      v.literal("like"),
      v.literal("lookbook_view"),
      v.literal("event_link_click"),
    ),
    catalogueItemId: v.optional(v.id("catalogue_items")),
    lookbookId: v.optional(v.id("lookbooks")),
    eventId: v.optional(v.id("events")),
  },
  handler: async (ctx, { customerId, action, catalogueItemId, lookbookId, eventId }) => {
    await ctx.db.insert("customer_activity_events", {
      customer_id: customerId,
      action,
      catalogue_item_id: catalogueItemId,
      lookbook_id: lookbookId,
      event_id: eventId,
      created_at: Date.now(),
    });
    // No return value needed — the frontend never awaits/reads this
    // mutation's result (fire-and-forget), so keep the response minimal.
    return null;
  },
});
