import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { DEFAULT_SETTINGS, SETTINGS_KEYS } from "./settings";
import { requireMerchantSession } from "./auth";

/**
 * LoyaltyOS Boutique — Orders + Points Backend (Step 7, PRD Module 7)
 *
 * Atomic transaction logic for creating orders and updating user points.
 * Uses integer paise for all financial calculations (₹1 = 100 paise).
 */

/** Verify user exists and get their points. */
async function getUserPoints(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("User not found");
  return {
    id: user._id,
    points: user.points ?? 0,
  };
}

/** Get start of today (UTC midnight). */
function getStartOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** Create a new order, applying points and updating user balance atomically. */
export const createOrder = mutation({
  args: {
    // `customerId` is the customer this order is for. `userId` (below) is the
    // authenticated merchant creating the order — kept distinct to avoid the
    // ambiguous `user_id`/`userId` collision (matches customers.ts precedent).
    customerId: v.id("users"),
    subtotal_paise: v.number(),
    payment_method: v.union(v.literal("online"), v.literal("offline")),
    points_applied: v.optional(v.number()),
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, { customerId, subtotal_paise, payment_method, points_applied, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);

    // 1. Verify User
    const user = await ctx.db.get(customerId);
    if (!user) return { ok: false, error: "User not found" };

    // 2. Validate Inputs
    if (subtotal_paise <= 0) return { ok: false, error: "Invalid subtotal" };
    const applied = points_applied ?? 0;
    if (applied < 0) return { ok: false, error: "Invalid points applied" };

    // 3. Check Points Balance
    const currentPoints = user.points ?? 0;
    if (applied > currentPoints) return { ok: false, error: "Insufficient points" };

    // 4. Calculate Values
    const discount_value = applied * 100; // 1pt = ₹1 = 100 paise
    const final_total = subtotal_paise - discount_value;

    if (final_total < 0) return { ok: false, error: "Discount exceeds total" };

    // Earn Rate: tier-specific purchasePercent points per ₹100 (10,000 paise),
    // floored. Fetches the merchant's loyalty rules (falling back to defaults
    // when unset) and resolves the customer's tier rule, defaulting to the
    // `global` rule when the customer has no tier — mirrors reviews.ts's
    // settings fetch and src/lib/db.js's `rules[user.tier] || rules.global`.
    const settingsDoc = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEYS.LOYALTY_RULES))
      .first();
    const rules = settingsDoc?.value?.tiers || DEFAULT_SETTINGS.tiers;
    const rule = rules[user.tier] || rules.global;
    const points_earned = Math.floor((subtotal_paise * (rule.purchasePercent || 5)) / 10000);

    // 5. Update User Balance (Atomic)
    const new_balance = currentPoints - applied + points_earned;
    await ctx.db.patch(customerId, { points: new_balance });

    // 6. Insert Order
    const order_id = await ctx.db.insert("orders", {
      user_id: customerId,
      subtotal: subtotal_paise,
      points_applied: applied,
      discount_value,
      payment_method,
      final_total,
      points_earned,
      created_at: Date.now(),
    });

    const order = await ctx.db.get(order_id);

    return {
      ok: true,
      order,
      user_balance: new_balance,
    };
  },
});

/** Get all orders sorted by created_at desc. */
export const getOrders = query({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    return await ctx.db.query("orders").order("desc").collect();
  },
});

/** Get orders for a specific user. */
export const getOrdersByUser = query({
  // `customerId` is the customer whose orders are fetched. `userId` is the
  // authenticated merchant — kept distinct to avoid the ambiguous
  // `user_id`/`userId` collision (matches customers.ts precedent).
  args: { customerId: v.id("users"), userId: v.id("users"), token: v.string() },
  handler: async (ctx, { customerId, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    return await ctx.db
      .query("orders")
      .withIndex("by_user", (q) => q.eq("user_id", customerId))
      .order("desc")
      .collect();
  },
});

/**
 * Internal helper to fetch orders created today.
 *
 * Scaling Fix 2 (docs/superpowers/specs/2026-09-03-scaling-fixes-pre-ai-design.md
 * Addendum 2026-09-04): previously a full-table .filter() scan of every order
 * ever placed. Now an indexed range read via by_created_at — only orders with
 * created_at >= startOfToday are pulled from the database.
 */
async function getTodayOrdersInternal(ctx: QueryCtx) {
  const startOfToday = getStartOfToday();
  return await ctx.db
    .query("orders")
    .withIndex("by_created_at", (q) => q.gte("created_at", startOfToday))
    .order("desc")
    .collect();
}

/** Get orders created today. */
export const getTodayOrders = query({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    return await getTodayOrdersInternal(ctx);
  },
});

/** Get aggregate summary for today. */
export const getTodaySummary = query({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const orders = await getTodayOrdersInternal(ctx);
    const summary = orders.reduce(
      (
        acc: {
          order_count: number;
          revenue_paise: number;
          points_issued: number;
          points_redeemed: number;
        },
        order
      ) => {
        acc.order_count += 1;
        acc.revenue_paise += order.final_total;
        acc.points_issued += order.points_earned;
        acc.points_redeemed += (order.points_applied ?? 0);
        return acc;
      },
      { order_count: 0, revenue_paise: 0, points_issued: 0, points_redeemed: 0 }
    );
    return summary;
  },
});
