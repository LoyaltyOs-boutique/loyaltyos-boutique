import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { requireMerchantSession } from "./auth";
import { rateLimiter } from "./rateLimits";

/**
 * LoyaltyOS Boutique — Video Consultations backend.
 * Design spec: docs/superpowers/specs/2026-11-25-video-consultations-design.md
 *
 * This file owns the NEW video_call_requests table only, mirroring
 * convex/orderRequests.ts's patterns exactly (magic-link validation, rate
 * limiting, activity row, paginated date query, search query, idempotent
 * status-flip mutation) — no existing table or function is touched.
 *
 * requestVideoCall is PUBLIC and magic-link gated (same validation shape as
 * orderRequests.placeOrderRequest) — the customer's own browser carries no
 * merchant session. The three merchant functions below are guarded with
 * requireMerchantSession exactly like every other merchant query/mutation.
 */

const MAGIC_LINK_DAYS = 180; // PRD §3.2 — same lifespan as auth.ts / orderRequests.ts
const DAY_MS = 86_400_000;

/**
 * requestVideoCall — PUBLIC, magic-link gated. A customer requests a video
 * call about one piece. Validates the caller exactly like placeOrderRequest,
 * applies the requestVideoCallByCustomer rate limit, then checks for a
 * duplicate request (same customer + same piece within the last 24 hours):
 * if found, returns { ok:true, duplicate:true } and writes nothing; otherwise
 * inserts the video_call_requests row and one customer_activity_events row.
 * Never writes a notifications row. Returns { ok:false, error } with nothing
 * written on any validation failure. Never returns another customer's data.
 */
export const requestVideoCall = mutation({
  args: {
    id: v.string(),
    token: v.string(),
    catalogue_item_id: v.id("catalogue_items"),
  },
  handler: async (ctx, { id, token, catalogue_item_id }) => {
    // --- Magic-link validation (mirrors orderRequests.placeOrderRequest) ---
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

    // --- Rate limit (non-throwing, same convention as placeOrderRequest) ---
    const rl = await rateLimiter.limit(ctx, "requestVideoCallByCustomer", { key: String(customer._id) });
    if (!rl.ok) {
      return { ok: false, error: "Too many requests in a short time — please try again in a minute.", rateLimited: true };
    }

    // --- Piece must exist and not be deleted ---
    const item = await ctx.db.get(catalogue_item_id);
    if (!item || item.is_deleted === true) {
      return { ok: false, error: "This piece is no longer available." };
    }

    // --- 24h duplicate check (same customer + same piece) — write nothing,
    // the customer still sees the same confirmation message either way ---
    const recent = await ctx.db
      .query("video_call_requests")
      .withIndex("by_customer_created_at", (q) =>
        q.eq("customer_id", customer._id).gte("created_at", Date.now() - DAY_MS),
      )
      .collect();
    const alreadyRequested = recent.some((r) => r.catalogue_item_id === catalogue_item_id);
    if (alreadyRequested) {
      return { ok: true, duplicate: true };
    }

    const searchText = [customer.name, customer.mobile, item.title]
      .join(" ")
      .toLowerCase();

    const requestId = await ctx.db.insert("video_call_requests", {
      customer_id: customer._id,
      catalogue_item_id,
      product_title: item.title,
      status: "new",
      created_at: Date.now(),
      search_text: searchText,
    });

    // One activity row so Recent Activity / weekly scoring / AI summary see
    // it, same as order_placed. Never a notifications row.
    await ctx.db.insert("customer_activity_events", {
      customer_id: customer._id,
      action: "video_call_requested",
      catalogue_item_id,
      created_at: Date.now(),
    });

    return { ok: true, duplicate: false, requestId };
  },
});

// Thin merchant-facing projection of one video-call request row + its
// customer's name/mobile.
async function toMerchantVideoCall(
  ctx: { db: { get: (id: Id<"users">) => Promise<{ name: string; mobile: string } | null> } },
  row: {
    _id: Id<"video_call_requests">;
    catalogue_item_id: Id<"catalogue_items">;
    product_title: string;
    status: "new" | "contacted";
    contacted_at?: number;
    created_at: number;
    customer_id: Id<"users">;
  },
) {
  const customer = await ctx.db.get(row.customer_id);
  return {
    _id: row._id,
    created_at: row.created_at,
    status: row.status,
    contacted_at: row.contacted_at,
    product_title: row.product_title,
    catalogue_item_id: row.catalogue_item_id,
    customerName: customer?.name ?? "Unknown",
    mobile: customer?.mobile ?? "",
  };
}

const MAX_DATE_WINDOW_MS = 2 * DAY_MS; // toMs - fromMs must be at most 2 days

/**
 * getVideoCallRequestsByDate — MERCHANT-ONLY. Paginated, newest-first list of
 * video call requests created within [fromMs, toMs]. The window is capped at
 * 2 days so the by_created_at range read stays bounded.
 */
export const getVideoCallRequestsByDate = query({
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
      .query("video_call_requests")
      .withIndex("by_created_at", (q) => q.gte("created_at", fromMs).lte("created_at", toMs))
      .order("desc")
      .paginate(paginationOpts);

    const rows = await Promise.all(page.page.map((row) => toMerchantVideoCall(ctx, row)));
    return { ...page, page: rows };
  },
});

/**
 * searchVideoCallRequests — MERCHANT-ONLY. Full-text search over search_text
 * (customer name, mobile, product title), newest first, at most 50 rows.
 */
export const searchVideoCallRequests = query({
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
      .query("video_call_requests")
      .withSearchIndex("search_video_calls", (s) => s.search("search_text", q.toLowerCase()))
      .take(50);

    // Search relevance order is not time order; sort newest first.
    matches.sort((a, b) => b.created_at - a.created_at);

    return await Promise.all(matches.map((row) => toMerchantVideoCall(ctx, row)));
  },
});

/**
 * markVideoCallContacted — MERCHANT-ONLY. Flips a request to "contacted".
 * Idempotent: an already-contacted request returns
 * { ok:true, alreadyContacted:true } and changes nothing.
 */
export const markVideoCallContacted = mutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    requestId: v.id("video_call_requests"),
  },
  handler: async (ctx, { userId, token, requestId }) => {
    await requireMerchantSession(ctx, userId, token);
    const request = await ctx.db.get(requestId);
    if (!request) {
      throw new ConvexError("That request could not be found.");
    }
    if (request.status === "contacted") {
      return { ok: true, alreadyContacted: true };
    }

    await ctx.db.patch(requestId, { status: "contacted", contacted_at: Date.now() });
    return { ok: true, alreadyContacted: false };
  },
});
