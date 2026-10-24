import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { isMerchantSessionLive } from "./sessionLock";
import { getBoutiqueBySlug, getDefaultBoutique } from "./boutiques";

/**
 * Read-only numbers for the LoyaltyOS Platform Admin (Phase 2B).
 * Design spec: docs/superpowers/specs/2026-10-09-platform-stats-endpoint-design.md
 *
 * Internal only: reachable from convex/http.ts, never from a client.
 * Returns aggregates only, never names, mobiles, emails or message text.
 * Never writes.
 *
 * Multi-boutique Phase 1 (proposal) — computeStats now scopes every read to
 * one boutique at a time via `statsForBoutique` below. Three modes:
 *   - no args: today's exact Platform Admin call -> stats for the default
 *     boutique (getDefaultBoutique), or the empty-tables reply if there is
 *     no default boutique yet.
 *   - { boutique: slug }: stats for that one boutique (by slug), or
 *     { error: "unknown_boutique" } if the slug doesn't resolve.
 *   - { list: true }: one row per boutique (active AND suspended).
 * Rows with no boutique_id (pre-Phase-1 legacy data) are never counted in
 * ANY mode — there is no "or undefined" fallback anywhere in this file.
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

/** The 11 reply fields, shared by every mode (no-parameter/single/list). */
type StatsFields = {
  schemaVersion: 1;
  generatedAt: number;
  customersActive: number;
  testCustomersExcluded: number;
  reviewsApproved: number;
  pointsIssued: number;
  weeklyHistory: Array<{ date: string; count: number }>;
  weeklyUses: number;
  ownerOnlineAt: number | null;
  ownerLastActionAt: number | null;
  firstRecordAt: number | null;
};

/** The empty-tables reply (S1) — same shape a non-existent default boutique
 *  would produce if every read below ran against zero rows. Used both when
 *  there is no default boutique (no-parameter mode) and is derived, not
 *  hand-rolled, so it can never drift from the real computation's shape. */
function emptyStats(now: number): StatsFields {
  const perDay = new Map<string, number>();
  const todayStart = istDayStart(now);
  const historyStart = todayStart - (HISTORY_DAYS - 1) * DAY_MS;
  for (let i = 0; i < HISTORY_DAYS; i++) {
    perDay.set(istDate(historyStart + i * DAY_MS), 0);
  }
  const weeklyHistory = [...perDay].map(([date, count]) => ({ date, count }));
  return {
    schemaVersion: 1,
    generatedAt: now,
    customersActive: 0,
    testCustomersExcluded: 0,
    reviewsApproved: 0,
    pointsIssued: 0,
    weeklyHistory,
    weeklyUses: 0,
    ownerOnlineAt: null,
    ownerLastActionAt: null,
    firstRecordAt: null,
  };
}

/**
 * Per-boutique computation (S5) — every statement below is the SAME
 * statement from the pre-Phase-1 computeStats body, with only the table
 * read / index lines changed to their by_boutique_* equivalents. No logic
 * (filters, windows, positive-only rules) was rewritten from memory.
 */
async function statsForBoutique(
  ctx: QueryCtx,
  boutiqueId: Id<"boutiques">,
  now: number,
): Promise<StatsFields> {
  // Customers: every active one that is not soft-deleted, same rule as the
  // Delight Desk. No name-based exclusion — every real customer is counted.
  const customers = await ctx.db
    .query("users")
    .withIndex("by_boutique_role_name_lower", (q) =>
      q.eq("boutique_id", boutiqueId).eq("role", "customer"),
    )
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
    .withIndex("by_boutique_status", (q) =>
      q.eq("boutique_id", boutiqueId).eq("status", "approved"),
    )
    .collect();
  const pointsFromReviews = approved.reduce((s, r) => s + (r.points_awarded ?? 0), 0);

  // Points issued: every positive ledger delta, plus points earned on every
  // purchase. No customer filter — every point given is counted.
  const ledger = await ctx.db
    .query("points_ledger")
    .withIndex("by_boutique_customer", (q) => q.eq("boutique_id", boutiqueId))
    .collect();
  const pointsFromLedger = ledger
    .filter((row) => row.delta > 0)
    .reduce((s, row) => s + row.delta, 0);
  const purchases = await ctx.db
    .query("orders")
    .withIndex("by_boutique_created_at", (q) => q.eq("boutique_id", boutiqueId))
    .collect();
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
    .withIndex("by_boutique_created_at", (q) =>
      q.eq("boutique_id", boutiqueId).gte("created_at", historyStart),
    )
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
    .withIndex("by_boutique_role_name_lower", (q) =>
      q.eq("boutique_id", boutiqueId).eq("role", "merchant"),
    )
    .collect();
  const ownerOnlineAt = newest(
    merchants
      .filter((m) => isMerchantSessionLive(m, now))
      .map((m) => m.session_last_seen),
  );

  // Owner's last action: newest timestamp over the records the owner creates.
  const newestPurchase = await ctx.db
    .query("orders")
    .withIndex("by_boutique_created_at", (q) => q.eq("boutique_id", boutiqueId))
    .order("desc")
    .first();
  const newestCatalogueItem = await ctx.db
    .query("catalogue_items")
    .withIndex("by_boutique", (q) => q.eq("boutique_id", boutiqueId))
    .order("desc")
    .first();
  const decisions = await ctx.db
    .query("message_actions")
    .withIndex("by_boutique_customer_occasion_date", (q) => q.eq("boutique_id", boutiqueId))
    .collect();
  const events = await ctx.db
    .query("events")
    .withIndex("by_boutique_event_datetime", (q) => q.eq("boutique_id", boutiqueId))
    .collect();
  const lookbooks = await ctx.db
    .query("lookbooks")
    .withIndex("by_boutique", (q) => q.eq("boutique_id", boutiqueId))
    .collect();
  const settings = await ctx.db
    .query("settings")
    .withIndex("by_boutique_key", (q) => q.eq("boutique_id", boutiqueId))
    .collect();
  const ownerLastActionAt = newest([
    newest(ledger.filter((row) => row.created_by === "admin").map((row) => row.created_at)) ?? undefined,
    newestPurchase?.created_at,
    newest(decisions.map((d) => d.decided_at)) ?? undefined,
    newest(events.map((e) => e.created_at)) ?? undefined,
    newest(lookbooks.map((l) => l.created_at)) ?? undefined,
    newest(settings.map((s) => s.updated_at)) ?? undefined,
    newestCatalogueItem?._creationTime,
  ]);

  // Earliest record of any user (merchant or customer). Taken from the
  // customer-role and merchant-role rows already read above for
  // customersActive/ownerOnlineAt (S5) — no extra read is needed, and since
  // `role` is a genuine two-value union (schema.ts users.role: "customer" |
  // "merchant"), these two sets are EVERY row this boutique's `users` rows
  // can be, so nothing is missed relative to the old unscoped read.
  const allUserCreationTimes = [...customers, ...merchants].map((u) => u._creationTime);
  const firstRecordAt = allUserCreationTimes.length ? Math.min(...allUserCreationTimes) : null;

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
    firstRecordAt,
  };
}

export const computeStats = internalQuery({
  args: {
    boutique: v.optional(v.string()),
    list: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // S4 — mutually exclusive modes.
    if (args.boutique !== undefined && args.list === true) {
      return { error: "bad_request" as const };
    }

    // S2 — single-boutique mode.
    if (args.boutique !== undefined) {
      const boutique = await getBoutiqueBySlug(ctx, args.boutique);
      if (!boutique) return { error: "unknown_boutique" as const };
      const stats = await statsForBoutique(ctx, boutique._id, now);
      return { ...stats, boutiqueId: boutique._id, slug: boutique.slug, status: boutique.status };
    }

    // S3 — list mode: one row per boutique, active and suspended alike.
    // Unindexed .collect() over `boutiques` mirrors the existing posture in
    // crons.ts's listActiveBoutiquesInternal — this table has one row per
    // boutique on the platform, not per-customer, so it stays small.
    if (args.list === true) {
      const boutiques = await ctx.db.query("boutiques").collect();
      const rows = await Promise.all(
        boutiques.map(async (b: Doc<"boutiques">) => {
          const stats = await statsForBoutique(ctx, b._id, now);
          return { ...stats, boutiqueId: b._id, slug: b.slug, status: b.status };
        }),
      );
      return { schemaVersion: 1 as const, generatedAt: now, boutiques: rows };
    }

    // S1 — no-parameter mode: today's exact Platform Admin call.
    const defaultBoutique = await getDefaultBoutique(ctx);
    if (!defaultBoutique) return emptyStats(now);
    return await statsForBoutique(ctx, defaultBoutique._id, now);
  },
});
