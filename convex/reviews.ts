import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { DEFAULT_SETTINGS, SETTINGS_KEYS } from "./settings";
import { requireMerchantSession } from "./auth";

// ============================================================================
// SECTION 1 — Validators
// ============================================================================

const reviewTypeValidator = v.union(
  v.literal("product"),
  v.literal("gmb"),
  v.literal("testimonial"),
);

const reviewStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
);

// ============================================================================
// SECTION 2 — Mutations
// ============================================================================

// Double-submit guard window (ms) for createReview's duplicate check below.
// Narrow on purpose: this only catches an accidental rapid double-submit
// (double-click, or a hydrate/write-through race in src/lib/db.js), not a
// genuine second review written minutes/hours later.
const DUPLICATE_SUBMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * createReview: Insert a new review.
 *
 * PUBLIC + UNGUARDED by design (called from the customer-facing lookbook
 * review flow — no merchant session exists at this point). Do NOT add
 * requireMerchantSession here.
 *
 * Duplicate-submit guard (2026-09-02): before inserting, check for an
 * existing review from the SAME customer (user_id) with the SAME text,
 * created within the last DUPLICATE_SUBMIT_WINDOW_MS. If found, return the
 * existing row instead of inserting a second one. This is narrowly scoped
 * to "prevent an accidental double-submit creating two near-identical rows"
 * — it does not touch the separate one-review-per-product business rule
 * (unrelated, already enforced elsewhere per CLAUDE.md's documented review
 * rules). Only queries the submitting customer's OWN reviews (by_user
 * index, filtered to user_id === args.user_id), so no other customer's data
 * is read or exposed — safe for a public/unauthenticated function.
 */
export const createReview = mutation({
  args: {
    user_id: v.id("users"),
    type: reviewTypeValidator,
    text: v.string(),
    rating: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - DUPLICATE_SUBMIT_WINDOW_MS;
    const recentOwnReviews = await ctx.db
      .query("reviews")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .order("desc")
      .take(10); // small, recent-only scan — cheap and sufficient for a double-click window

    const duplicate = recentOwnReviews.find(
      (r) =>
        r.type === args.type &&
        r.text === args.text &&
        r.created_at >= cutoff,
    );
    if (duplicate) {
      // No-op: hand back the existing row so the caller's flow completes
      // normally (frontend still gets a valid review doc), without minting
      // a second near-identical database row.
      return duplicate;
    }

    return await ctx.db.insert("reviews", {
      ...args,
      status: "pending",
      points_awarded: 0,
      created_at: Date.now(),
    });
  },
});

/**
 * approveReview: Atomic approval + points update.
 * Merchant Session Lock (2026-09-01): merchant-only — requireMerchantSession
 * runs FIRST so an unauthenticated caller cannot approve reviews / mint points.
 * No naming collision: this function's own id param is "id" (the review's
 * _id), not "userId", so adding the merchant userId/token args is unambiguous.
 */
export const approveReview = mutation({
  args: { userId: v.id("users"), token: v.string(), id: v.id("reviews") },
  handler: async (ctx, { userId, token, id }) => {
    await requireMerchantSession(ctx, userId, token);

    const review = await ctx.db.get(id);
    if (!review) throw new Error("Review not found");
    if (review.status !== "pending") throw new Error("Review already processed");

    // Fetch user
    const user = await ctx.db.get(review.user_id);
    if (!user) throw new Error("User not found");

    // Get current loyalty rules (fallback to defaults if empty)
    const settingsDoc = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEYS.LOYALTY_RULES))
      .first();

    const rules = settingsDoc?.value?.tiers || DEFAULT_SETTINGS.tiers;
    const globalRules = rules.global;

    // Calculate points
    let points = 0;
    if (review.type === "testimonial") {
      points = globalRules.testimonialBonus;
    } else if (review.type === "gmb") {
      points = globalRules.gmbPoints;
    } else if (review.type === "product") {
      points = globalRules.productReviewPoints;
    }

    // Atomic Update: Review Status + User Points
    await ctx.db.patch(review.user_id, {
      points: (user.points || 0) + points,
    });
    await ctx.db.patch(id, {
      status: "approved",
      points_awarded: points,
    });

    return { ok: true, points_awarded: points };
  },
});

/**
 * declineReview: Update status to "declined".
 * Merchant Session Lock (2026-09-01): merchant-only — requireMerchantSession
 * runs FIRST. Same collision check as approveReview: own id param is "id",
 * not "userId" — no rename needed.
 */
export const declineReview = mutation({
  args: { userId: v.id("users"), token: v.string(), id: v.id("reviews") },
  handler: async (ctx, { userId, token, id }) => {
    await requireMerchantSession(ctx, userId, token);

    const review = await ctx.db.get(id);
    if (!review) throw new Error("Review not found");
    if (review.status !== "pending") throw new Error("Review already processed");

    await ctx.db.patch(id, { status: "declined" });
    return { ok: true };
  },
});

// ============================================================================
// SECTION 3 — Queries
// ============================================================================

/**
 * getPendingReviews: Fetch all pending reviews, newest first.
 * Merchant Session Lock (2026-09-01): merchant-only — this is the Delight
 * Desk approval queue, never customer-facing. No pre-existing args, so no
 * collision — userId/token are the only params.
 */
export const getPendingReviews = query({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);

    return await ctx.db
      .query("reviews")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("desc")
      .collect();
  },
});

/**
 * getReviews: Fetch reviews with optional status filter.
 * Merchant Session Lock (2026-09-01): merchant-only. Existing "status" param
 * is unrelated to the merchant identity, no collision with userId/token.
 */
export const getReviews = query({
  args: {
    userId: v.id("users"),
    token: v.string(),
    status: v.optional(reviewStatusValidator),
  },
  handler: async (ctx, { userId, token, status }) => {
    await requireMerchantSession(ctx, userId, token);

    const q = ctx.db.query("reviews");
    if (status) {
      return await q
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc")
        .collect();
    }
    return await q.order("desc").collect();
  },
});