import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { DEFAULT_SETTINGS, SETTINGS_KEYS } from "./settings";

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

/**
 * createReview: Insert a new review.
 */
export const createReview = mutation({
  args: {
    user_id: v.id("users"),
    type: reviewTypeValidator,
    text: v.string(),
    rating: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
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
 */
export const approveReview = mutation({
  args: { id: v.id("reviews") },
  handler: async (ctx, { id }) => {
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
 */
export const declineReview = mutation({
  args: { id: v.id("reviews") },
  handler: async (ctx, { id }) => {
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
 */
export const getPendingReviews = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("reviews")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("desc")
      .collect();
  },
});

/**
 * getReviews: Fetch reviews with optional status filter.
 */
export const getReviews = query({
  args: {
    status: v.optional(reviewStatusValidator),
  },
  handler: async (ctx, { status }) => {
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