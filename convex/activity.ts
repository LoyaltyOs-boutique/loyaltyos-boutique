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
 * AUTH — PUBLIC, but now boutique-scoped and magic-token-checked (Batch 5,
 * 2026-10-17, data-wall audit §6.2): the caller here is always the
 * CUSTOMER's own browser session (Lookbook.jsx's like/cart-add/mount-view
 * calls via src/lib/db.js), which has no merchant token at all — customers
 * authenticate via a completely separate magic-link mechanism (see
 * auth.ts's validateMagicToken). This still mirrors the codebase's existing
 * posture for createReview/generateMagicTokenSelf (public, not
 * requireMerchantSession-gated) — but a caller must now ALSO present a
 * matching magic `token` for the given `customerId`, and every referenced
 * catalogueItemId/lookbookId/eventId must belong to that SAME customer's
 * boutique. `token` is optional purely so an old cached frontend bundle
 * (sent before this change shipped) never trips a validator error — a
 * missing or non-matching token simply writes nothing (see handler below),
 * it never throws.
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
 *
 * Batch 5 (2026-10-17, audit §6.2) — token is v.optional(v.string()) so a
 * stale cached frontend that never sends it still passes validation; the
 * handler below just writes nothing for that caller instead of throwing.
 * When a token IS sent, the SAME by_magic_token lookup + validity checks
 * getCustomerCatalogue uses (convex/lookbooks.ts) are repeated here — no
 * more, no fewer — and every provided catalogueItemId/lookbookId/eventId is
 * read back and must belong to the SAME boutique as the validated customer,
 * or the whole call writes nothing.
 */
export const trackActivity = mutation({
  args: {
    customerId: v.id("users"),
    token: v.optional(v.string()),
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
  handler: async (ctx, { customerId, token, action, catalogueItemId, lookbookId, eventId }) => {
    // Batch 5 (2026-10-17, audit §6.2 correction 4) — old cached frontends
    // never send `token` at all; treat that exactly like an invalid token
    // (write nothing, return null) rather than throwing a validator error.
    if (!token) return null;

    // --- Inline magic-link validation (byte-for-byte the same checks as
    // convex/lookbooks.ts's getCustomerCatalogue — do not let the two drift
    // apart; see that function's own comment for why it is duplicated
    // rather than shared). ---
    const customer = await ctx.db
      .query("users")
      .withIndex("by_magic_token", (q) => q.eq("magic_token", token))
      .first();
    if (!customer || customer.role !== "customer") return null;
    if (String(customer._id) !== String(customerId)) return null;

    const createdAt = customer.magic_token_created_at;
    if (!createdAt || Number.isNaN(createdAt)) return null;

    const MAGIC_LINK_DAYS = 180; // PRD §3.2 — same lifespan as auth.ts/getCustomerCatalogue
    const DAY_MS = 86_400_000;
    const expiresAt = createdAt + MAGIC_LINK_DAYS * DAY_MS;
    if (Date.now() > expiresAt) return null;

    // Batch 5 (2026-10-17, audit §6.2 correction 2) — a customer with no
    // boutique_id of their own cannot be scoped to anything; refuse exactly
    // like an invalid token (same reasoning as getCustomerCatalogue).
    if (customer.boutique_id === undefined) return null;

    // Batch 5 (2026-10-17, audit §6.2 correction 2) — each referenced
    // document must exist AND belong to this SAME customer's boutique, or
    // the whole call writes nothing (never a partial write).
    if (catalogueItemId) {
      const catalogueItem = await ctx.db.get(catalogueItemId);
      if (!catalogueItem || catalogueItem.boutique_id !== customer.boutique_id) return null;
    }
    if (lookbookId) {
      const lookbook = await ctx.db.get(lookbookId);
      if (!lookbook || lookbook.boutique_id !== customer.boutique_id) return null;
    }
    if (eventId) {
      const event = await ctx.db.get(eventId);
      if (!event || event.boutique_id !== customer.boutique_id) return null;
    }

    await ctx.db.insert("customer_activity_events", {
      customer_id: customerId,
      action,
      catalogue_item_id: catalogueItemId,
      lookbook_id: lookbookId,
      event_id: eventId,
      created_at: Date.now(),
      boutique_id: customer.boutique_id,
    });
    // No return value needed — the frontend never awaits/reads this
    // mutation's result (fire-and-forget), so keep the response minimal.
    return null;
  },
});
