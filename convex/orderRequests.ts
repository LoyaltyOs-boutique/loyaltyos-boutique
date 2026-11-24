import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { requireMerchantSession } from "./auth";
import { rateLimiter } from "./rateLimits";
import { projectSizeAvailability } from "./lookbooks";

/**
 * LoyaltyOS Boutique — Customer Orders backend (Build Step 1 of 4).
 * Design spec: docs/superpowers/specs/2026-11-15-customer-orders-design.md
 *
 * CURRENCY INVARIANT: all money is INTEGER PAISE, never floats.
 *
 * This file owns the NEW order_requests table only. The existing `orders`
 * table, its createOrder mutation, points, revenue, the AI purchase summary
 * and platformStats are not touched. No loyalty points are awarded here (D6).
 *
 * placeOrderRequest is PUBLIC and magic-link gated (same validation shape as
 * lookbooks.getCustomerCatalogue) — the customer's own browser carries no
 * merchant session. The three merchant functions below are guarded with
 * requireMerchantSession exactly like every other merchant query/mutation.
 */

// Valid sizes a customer line may carry, by the piece's size_mode.
// Amendment: docs/superpowers/specs/2026-11-24-sizes-availability-amendment.md
const SIZE_LITERALS = v.union(
  v.literal("S"),
  v.literal("M"),
  v.literal("L"),
  v.literal("XL"),
  v.literal("XXL"),
  v.literal("FREE"),
  v.literal("ONE"),
  v.literal("CUSTOM"),
  v.literal("NONE"),
);

// Shape of the optional custom-size measurements on an order line (D8).
const MEASUREMENTS_ARG = v.object({
  unit: v.union(v.literal("cm"), v.literal("in")),
  bust: v.number(),
  waist: v.number(),
  hip: v.number(),
  shoulder: v.number(),
  top_length: v.number(),
  sleeve_length: v.optional(v.number()),
  armhole: v.optional(v.number()),
  bottom_length: v.optional(v.number()),
  height: v.optional(v.number()),
  notes: v.optional(v.string()),
});

const MAGIC_LINK_DAYS = 180; // PRD §3.2 — same lifespan as auth.ts
const DAY_MS = 86_400_000;

/**
 * placeOrderRequest — PUBLIC, magic-link gated. A customer places an order of
 * 1..20 lines. Validates the caller exactly like getCustomerCatalogue, applies
 * the placeOrderByCustomer rate limit, server-sources every price, validates
 * each line's size against the piece's effective size availability (amendment
 * 2026-11-24 — stock numbers are gone; only out-of-stock SIZES/pieces are
 * checked), then inserts the order_requests row and one customer_activity_events
 * row. Never writes a notifications row (D12). Returns { ok:false, error }
 * with nothing written on any validation failure. Never returns another
 * customer's data.
 */
export const placeOrderRequest = mutation({
  args: {
    id: v.string(),
    token: v.string(),
    items: v.array(
      v.object({
        catalogue_item_id: v.id("catalogue_items"),
        size: SIZE_LITERALS,
        qty: v.number(),
        measurements: v.optional(MEASUREMENTS_ARG),
      }),
    ),
    payment_preference: v.union(v.literal("online"), v.literal("offline")),
  },
  handler: async (ctx, { id, token, items, payment_preference }) => {
    // --- Magic-link validation (mirrors lookbooks.getCustomerCatalogue) ---
    const customer = await ctx.db
      .query("users")
      .withIndex("by_magic_token", (q) => q.eq("magic_token", token))
      .first();
    if (!customer || customer.role !== "customer") {
      return { ok: false, error: "We could not verify your link. Please reopen it from WhatsApp." };
    }
    if (String(customer._id) !== id) {
      return { ok: false, error: "We could not verify your link. Please reopen it from WhatsApp." };
    }
    if (customer.is_deleted === true) {
      return { ok: false, error: "We could not verify your link. Please reopen it from WhatsApp." };
    }
    const createdAt = customer.magic_token_created_at;
    if (!createdAt || Number.isNaN(createdAt)) {
      return { ok: false, error: "Your link has expired. Please ask the boutique for a new one." };
    }
    if (Date.now() > createdAt + MAGIC_LINK_DAYS * DAY_MS) {
      return { ok: false, error: "Your link has expired. Please ask the boutique for a new one." };
    }

    // --- Rate limit (non-throwing, same convention as createReview) ---
    const rl = await rateLimiter.limit(ctx, "placeOrderByCustomer", { key: String(customer._id) });
    if (!rl.ok) {
      return { ok: false, error: "Too many orders in a short time — please try again in a minute.", rateLimited: true };
    }

    // --- Line count bound ---
    if (items.length < 1 || items.length > 20) {
      return { ok: false, error: "An order must have between 1 and 20 items." };
    }

    // Validate every line and build the rows to insert — all BEFORE any
    // write, so a failure writes nothing.
    const orderLines: Array<{
      catalogue_item_id: Id<"catalogue_items">;
      title: string;
      price_paise: number;
      size: "S" | "M" | "L" | "XL" | "XXL" | "FREE" | "ONE" | "CUSTOM" | "NONE";
      qty: number;
      measurements?: {
        unit: "cm" | "in";
        bust: number;
        waist: number;
        hip: number;
        shoulder: number;
        top_length: number;
        sleeve_length?: number;
        armhole?: number;
        bottom_length?: number;
        height?: number;
        notes?: string;
      };
    }> = [];

    let subtotalPaise = 0;
    const titles: string[] = [];

    for (const line of items) {
      // qty must be an integer 1..10.
      if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > 10) {
        return { ok: false, error: "Each item quantity must be a whole number from 1 to 10." };
      }

      const item = await ctx.db.get(line.catalogue_item_id);
      if (!item || item.is_deleted === true) {
        return { ok: false, error: "One of the pieces in your bag is no longer available." };
      }

      // Size must match the piece's EFFECTIVE size availability — the exact
      // same projection the customer is shown (amendment 2026-11-24).
      const availability = projectSizeAvailability(item);
      // What actually gets stored on the order line — legacy/free input
      // ("FREE" or the legacy "NONE") is always normalized to "FREE".
      let storedSize: "S" | "M" | "L" | "XL" | "XXL" | "FREE" | "ONE" | "CUSTOM" | "NONE" = line.size;

      if (availability.size_mode === "sized") {
        const validSizes = (availability.sizes ?? []) as string[];
        if (line.size !== "CUSTOM" && !validSizes.includes(line.size)) {
          return { ok: false, error: "Please choose a valid size for this piece." };
        }
        const outOfStockSizes = (availability.out_of_stock_sizes ?? []) as string[];
        if (line.size !== "CUSTOM" && outOfStockSizes.includes(line.size)) {
          return { ok: false, error: `${item.title} (${line.size}) is out of stock` };
        }
      } else if (availability.size_mode === "one") {
        if (line.size !== "ONE") {
          return { ok: false, error: "This piece is one size only." };
        }
        if (availability.out_of_stock) {
          return { ok: false, error: `${item.title} (${line.size}) is out of stock` };
        }
      } else {
        // "free" — includes legacy pieces with no size_mode set (treated as
        // Free size everywhere, per the amendment). Legacy "NONE" input is
        // still accepted so an un-updated customer page keeps working.
        if (line.size !== "FREE" && line.size !== "NONE") {
          return { ok: false, error: "This piece is free size only." };
        }
        storedSize = "FREE";
        if (availability.out_of_stock) {
          return { ok: false, error: `${item.title} (FREE) is out of stock` };
        }
      }

      // CUSTOM requires a complete, sane measurement set (D8). Only valid on
      // "sized" pieces, which the size check above already enforces.
      let measurements = line.measurements;
      if (line.size === "CUSTOM") {
        const m = line.measurements;
        if (!m) {
          return { ok: false, error: "Custom size needs your measurements." };
        }
        const required: Array<number> = [m.bust, m.waist, m.hip, m.shoulder, m.top_length];
        for (const value of required) {
          if (typeof value !== "number" || value <= 0 || value > 200) {
            return { ok: false, error: "Please enter valid measurements (each between 1 and 200)." };
          }
        }
        if (m.notes !== undefined && m.notes.length > 300) {
          return { ok: false, error: "Measurement notes can be at most 300 characters." };
        }
        measurements = m;
      } else {
        // Non-custom lines never carry measurements, even if the client sent some.
        measurements = undefined;
      }

      // Price ALWAYS from the database (D9) — never from the browser.
      const pricePaise = item.price || 0;
      subtotalPaise += pricePaise * line.qty;
      titles.push(item.title);

      orderLines.push({
        catalogue_item_id: line.catalogue_item_id,
        title: item.title,
        price_paise: pricePaise,
        size: storedSize,
        qty: line.qty,
        measurements,
      });
    }

    const searchText = [customer.name, customer.mobile, ...titles]
      .join(" ")
      .toLowerCase();

    const orderId = await ctx.db.insert("order_requests", {
      customer_id: customer._id,
      items: orderLines,
      subtotal_paise: subtotalPaise,
      payment_preference,
      payment_status: "not_collected",
      status: "placed",
      created_at: Date.now(),
      search_text: searchText,
    });

    // One activity row so Recent Activity / weekly scoring / AI summary see it
    // (D12). Never a notifications row.
    await ctx.db.insert("customer_activity_events", {
      customer_id: customer._id,
      action: "order_placed",
      catalogue_item_id: orderLines[0].catalogue_item_id,
      created_at: Date.now(),
    });

    return { ok: true, orderId };
  },
});

// Thin merchant-facing projection of one order row + its customer name/mobile.
async function toMerchantOrder(
  ctx: { db: { get: (id: Id<"users">) => Promise<{ name: string; mobile: string } | null> } },
  row: {
    _id: Id<"order_requests">;
    customer_id: Id<"users">;
    items: unknown;
    subtotal_paise: number;
    payment_preference: "online" | "offline";
    payment_status: "not_collected";
    status: "placed" | "cancelled";
    cancelled_at?: number;
    created_at: number;
  },
) {
  const customer = await ctx.db.get(row.customer_id);
  return {
    _id: row._id,
    customer_id: row.customer_id,
    customerName: customer?.name ?? "Unknown",
    customerMobile: customer?.mobile ?? "",
    items: row.items,
    subtotal_paise: row.subtotal_paise,
    payment_preference: row.payment_preference,
    payment_status: row.payment_status,
    status: row.status,
    cancelled_at: row.cancelled_at,
    created_at: row.created_at,
  };
}

const MAX_DATE_WINDOW_MS = 2 * DAY_MS; // toMs - fromMs must be at most 2 days

/**
 * getOrderRequestsByDate — MERCHANT-ONLY. Paginated, newest-first list of
 * orders created within [fromMs, toMs]. The window is capped at 2 days so the
 * by_created_at range read stays bounded.
 */
export const getOrderRequestsByDate = query({
  args: {
    userId: v.id("users"),
    token: v.string(),
    fromMs: v.number(),
    toMs: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { userId, token, fromMs, toMs, paginationOpts }) => {
    await requireMerchantSession(ctx, userId, token);
    if (toMs < fromMs) {
      throw new ConvexError("Invalid date range.");
    }
    if (toMs - fromMs > MAX_DATE_WINDOW_MS) {
      throw new ConvexError("Date range is too wide (max 2 days).");
    }

    const page = await ctx.db
      .query("order_requests")
      .withIndex("by_created_at", (q) => q.gte("created_at", fromMs).lte("created_at", toMs))
      .order("desc")
      .paginate(paginationOpts);

    const rows = await Promise.all(page.page.map((row) => toMerchantOrder(ctx, row)));
    return { ...page, page: rows };
  },
});

/**
 * searchOrderRequests — MERCHANT-ONLY. Full-text search over search_text
 * (customer name, mobile, product titles), newest first, at most 50 rows.
 */
export const searchOrderRequests = query({
  args: {
    userId: v.id("users"),
    token: v.string(),
    query: v.string(),
  },
  handler: async (ctx, { userId, token, query: rawQuery }) => {
    await requireMerchantSession(ctx, userId, token);
    const q = rawQuery.trim();
    if (q.length < 2 || q.length > 60) {
      throw new ConvexError("Please type between 2 and 60 characters to search.");
    }

    const matches = await ctx.db
      .query("order_requests")
      .withSearchIndex("search_orders", (s) => s.search("search_text", q.toLowerCase()))
      .take(50);

    // Search relevance order is not time order; sort newest first (D11).
    matches.sort((a, b) => b.created_at - a.created_at);

    return await Promise.all(matches.map((row) => toMerchantOrder(ctx, row)));
  },
});

/**
 * cancelOrderRequest — MERCHANT-ONLY. Cancels an order. Idempotent: an
 * already-cancelled order returns { ok:true, alreadyCancelled:true } and
 * changes nothing (D5). Stock is no longer tracked (amendment 2026-11-24),
 * so there is nothing to restore — this only flips status/cancelled_at.
 */
export const cancelOrderRequest = mutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    orderId: v.id("order_requests"),
  },
  handler: async (ctx, { userId, token, orderId }) => {
    await requireMerchantSession(ctx, userId, token);
    const order = await ctx.db.get(orderId);
    if (!order) {
      throw new ConvexError("That order could not be found.");
    }
    if (order.status === "cancelled") {
      return { ok: true, alreadyCancelled: true };
    }

    await ctx.db.patch(orderId, { status: "cancelled", cancelled_at: Date.now() });
    return { ok: true, alreadyCancelled: false };
  },
});
