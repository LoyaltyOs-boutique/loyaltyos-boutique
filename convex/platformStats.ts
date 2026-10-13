import { internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { isMerchantSessionLive } from "./sessionLock";

/**
 * Read-only numbers for the LoyaltyOS Platform Admin (Phase 2B).
 * Design spec: docs/superpowers/specs/2026-10-09-platform-stats-endpoint-design.md
 *
 * Internal only: reachable from convex/http.ts, never from a client.
 * Returns aggregates only, never names, mobiles, emails or message text.
 * Never writes.
 */

// IST is UTC+5:30 with no daylight saving.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 7;

/** YYYY-MM-DD of an epoch-ms instant, read on the IST calendar. */
function istDate(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Epoch ms of 00:00 IST for the IST day that contains `ms`. */
function istDayStart(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}

/** Largest of the given timestamps, or null when there are none. */
function newest(values: Array<number | undefined>): number | null {
  const present = values.filter((v): v is number => typeof v === "number");
  return present.length ? Math.max(...present) : null;
}

export const computeStats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Customers: every active one that is not soft-deleted, same rule as the
    // Delight Desk. No name-based exclusion — every real customer is counted.
    const customers = await ctx.db
      .query("users")
      .withIndex("by_role_name_lower", (q) => q.eq("role", "customer"))
      .collect();
    const counted = new Set<Id<"users">>();
    for (const c of customers) {
      if (c.is_deleted === true) continue;
      counted.add(c._id);
    }

    // Approved reviews of every type, and the points they awarded. Every
    // approved review counts, with no customer filter, like the Delight Desk.
    const approved = await ctx.db
      .query("reviews")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
    const pointsFromReviews = approved.reduce((s, r) => s + (r.points_awarded ?? 0), 0);

    // Points issued: every positive ledger delta, plus points earned on every
    // purchase. No customer filter — every point given is counted.
    const ledger = await ctx.db.query("points_ledger").collect();
    const pointsFromLedger = ledger
      .filter((row) => row.delta > 0)
      .reduce((s, row) => s + row.delta, 0);
    const purchases = await ctx.db.query("orders").collect();
    const pointsFromPurchases = purchases.reduce((s, o) => s + (o.points_earned ?? 0), 0);

    // Activity per IST day for the last 7 days, oldest first, ending today.
    const todayStart = istDayStart(now);
    const historyStart = todayStart - (HISTORY_DAYS - 1) * DAY_MS;
    const perDay = new Map<string, number>();
    for (let i = 0; i < HISTORY_DAYS; i++) {
      perDay.set(istDate(historyStart + i * DAY_MS), 0);
    }
    const activity = await ctx.db
      .query("customer_activity_events")
      .withIndex("by_created_at", (q) => q.gte("created_at", historyStart))
      .collect();
    for (const e of activity) {
      if (!counted.has(e.customer_id)) continue;
      const day = istDate(e.created_at);
      if (perDay.has(day)) perDay.set(day, perDay.get(day)! + 1);
    }
    const weeklyHistory = [...perDay].map(([date, count]) => ({ date, count }));
    const weeklyUses = weeklyHistory.reduce((s, d) => s + d.count, 0);

    // Owner presence: the newest heartbeat among merchants with a live session.
    const merchants = await ctx.db
      .query("users")
      .withIndex("by_role_name_lower", (q) => q.eq("role", "merchant"))
      .collect();
    const ownerOnlineAt = newest(
      merchants
        .filter((m) => isMerchantSessionLive(m, now))
        .map((m) => m.session_last_seen),
    );

    // Owner's last action: newest timestamp over the records the owner creates.
    const newestPurchase = await ctx.db
      .query("orders")
      .withIndex("by_created_at")
      .order("desc")
      .first();
    const newestCatalogueItem = await ctx.db.query("catalogue_items").order("desc").first();
    const decisions = await ctx.db.query("message_actions").collect();
    const events = await ctx.db.query("events").collect();
    const lookbooks = await ctx.db.query("lookbooks").collect();
    const settings = await ctx.db.query("settings").collect();
    const ownerLastActionAt = newest([
      newest(ledger.filter((row) => row.created_by === "admin").map((row) => row.created_at)) ?? undefined,
      newestPurchase?.created_at,
      newest(decisions.map((d) => d.decided_at)) ?? undefined,
      newest(events.map((e) => e.created_at)) ?? undefined,
      newest(lookbooks.map((l) => l.created_at)) ?? undefined,
      newest(settings.map((s) => s.updated_at)) ?? undefined,
      newestCatalogueItem?._creationTime,
    ]);

    // Earliest record of any user (merchant or customer).
    const firstUser = await ctx.db.query("users").order("asc").first();

    return {
      schemaVersion: 1,
      generatedAt: now,
      customersActive: counted.size,
      testCustomersExcluded: 0,
      reviewsApproved: approved.length,
      pointsIssued: pointsFromLedger + pointsFromPurchases + pointsFromReviews,
      weeklyHistory,
      weeklyUses,
      ownerOnlineAt,
      ownerLastActionAt,
      firstRecordAt: firstUser?._creationTime ?? null,
    };
  },
});
