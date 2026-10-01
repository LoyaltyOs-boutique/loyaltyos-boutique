// Design spec: docs/superpowers/specs/2026-09-30-dashboard-real-data-design.md
//
// Delight Desk dashboard real-data queries. Two merchant-only, read-only
// queries that replace the browser-local demo numbers with real Convex
// counts. Nothing else on the backend changes for this task — see the spec's
// "Decisions" section, item 1.

import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireMerchantSession } from "./auth";

// Caller-supplied limit clamp for getRecentCustomerActivity — never trust a
// client-passed value directly (spec: "clamp server-side, don't trust the
// caller").
const DEFAULT_ACTIVITY_LIMIT = 50;
const MAX_ACTIVITY_LIMIT = 100;

/**
 * getDashboardSummary: real counts for the Delight Desk cards that today
 * show browser-local, demo-mixed numbers (spec "Evidence" section).
 *
 * totalCustomers — users with role "customer", excluding soft-deleted rows.
 * Uses the by_role_name_lower index: its leading field is an equality match
 * on `role`, which is exactly the narrowing this query needs (the trailing
 * name_lower range is simply left unconstrained, a valid prefix use of a
 * compound index, same pattern customers.ts already relies on elsewhere).
 * A dedicated by_role-only index would duplicate what this prefix already
 * gives us, so no schema change is needed.
 *
 * pointsIssued — sum of every positive points_ledger delta (awards only;
 * negative deltas are deductions and are excluded per the spec).
 */
export const getDashboardSummary = query({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);

    const customers = await ctx.db
      .query("users")
      .withIndex("by_role_name_lower", (q) => q.eq("role", "customer"))
      .filter((q) => q.neq(q.field("is_deleted"), true))
      .collect();

    const ledgerRows = await ctx.db.query("points_ledger").collect();
    const pointsIssued = ledgerRows.reduce(
      (total, row) => (row.delta > 0 ? total + row.delta : total),
      0,
    );

    return {
      totalCustomers: customers.length,
      pointsIssued,
    };
  },
});

// One combined activity-feed row shape, shared by both source kinds below.
type ActivityItem = {
  id: string;
  customerId: Id<"users">;
  customerName: string;
  kind: "like" | "cart_add" | "lookbook_view" | "event_link_click" | "review";
  itemTitle?: string;
  createdAt: number;
};

/**
 * getRecentCustomerActivity: newest real customer actions across two
 * sources — customer_activity_events (likes/cart adds/lookbook views/event
 * link clicks) and submitted reviews of every type — merged and capped.
 *
 * Known limit (see spec "Known limits"): reviews has no created_at index
 * usable here (only by_user and by_status), so review rows are read in full
 * and placed into age-based position in memory. Accepted for the current
 * row count; revisit before real scale.
 */
export const getRecentCustomerActivity = query({
  args: {
    userId: v.id("users"),
    token: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { userId, token, limit }) => {
    await requireMerchantSession(ctx, userId, token);

    const cappedLimit = Math.max(
      1,
      Math.min(limit ?? DEFAULT_ACTIVITY_LIMIT, MAX_ACTIVITY_LIMIT),
    );

    // Bounded, indexed read — newest first, at most cappedLimit rows.
    const activityEvents = await ctx.db
      .query("customer_activity_events")
      .withIndex("by_created_at")
      .order("desc")
      .take(cappedLimit);

    // No usable created_at index on reviews for this read shape — read
    // every row of this small collection and age-sort in memory (see doc
    // comment above).
    const allReviews = await ctx.db.query("reviews").collect();
    const reviewRows = allReviews
      .slice()
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, cappedLimit);

    // Look up each distinct customer only once per request.
    const customerIds = new Set<string>();
    for (const row of activityEvents) customerIds.add(row.customer_id);
    for (const row of reviewRows) customerIds.add(row.user_id);

    const customerNameById = new Map<string, string>();
    for (const idString of customerIds) {
      const id = idString as Id<"users">;
      const customer = await ctx.db.get(id);
      if (
        customer &&
        customer.role === "customer" &&
        customer.is_deleted !== true
      ) {
        customerNameById.set(idString, customer.name);
      }
      // Missing or soft-deleted customers stay unset — their rows are
      // skipped below (spec: "skip any item whose customer is missing or
      // soft-deleted").
    }

    // Look up each distinct catalogue item only once per request, for the
    // optional itemTitle field on activity rows that carry one.
    const catalogueItemIds = new Set<string>();
    for (const row of activityEvents) {
      if (row.catalogue_item_id) catalogueItemIds.add(row.catalogue_item_id);
    }
    const itemTitleById = new Map<string, string>();
    for (const idString of catalogueItemIds) {
      const id = idString as Id<"catalogue_items">;
      const item = await ctx.db.get(id);
      if (item) itemTitleById.set(idString, item.title);
    }

    const merged: ActivityItem[] = [];

    for (const row of activityEvents) {
      const customerName = customerNameById.get(row.customer_id);
      if (!customerName) continue; // missing/soft-deleted — skip
      merged.push({
        id: "act_" + row._id,
        customerId: row.customer_id,
        customerName,
        kind: row.action,
        itemTitle: row.catalogue_item_id
          ? itemTitleById.get(row.catalogue_item_id)
          : undefined,
        createdAt: row.created_at,
      });
    }

    for (const row of reviewRows) {
      const customerName = customerNameById.get(row.user_id);
      if (!customerName) continue; // missing/soft-deleted — skip
      merged.push({
        id: "rev_" + row._id,
        customerId: row.user_id,
        customerName,
        kind: "review",
        createdAt: row.created_at,
      });
    }

    merged.sort((a, b) => b.createdAt - a.createdAt);
    return merged.slice(0, cappedLimit);
  },
});
