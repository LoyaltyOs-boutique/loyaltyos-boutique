import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireMerchantSession } from "./auth";

/**
 * LoyaltyOS Boutique — Dashboard Notifications (bell icon) backend.
 * Design spec: docs/superpowers/specs/2026-09-04-dashboard-notifications-design.md
 *
 * Merchant-internal, non-AI daily birthday/anniversary reminders. Rows are
 * written ONLY by the daily cron (crons.ts's generateDailyNotifications) —
 * this file is the read/ack/delete surface the merchant Dashboard UI calls.
 *
 * NON-NEGOTIABLES (design doc §d):
 *   - No AI/Gemini call anywhere in this file.
 *   - Nothing here ever sends anything to a customer (no WhatsApp/Resend
 *     call) — these are internal reads/writes to `notifications` only.
 *   - deleteNotification touches ONLY the `notifications` table — it must
 *     never read/patch/delete `users`, `ai_message_drafts`, or
 *     `message_actions`, so a merchant clearing a notification can never
 *     affect the underlying birthday/anniversary data those other features
 *     read (findUpcoming/findUpcomingInternal are completely independent).
 *
 * AUTH: every function here is merchant-guarded via requireMerchantSession,
 * the SAME pattern as every other merchant-facing query/mutation in
 * customers.ts.
 */

/** Notification rows older than this are considered expired and excluded from reads. */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * getNotifications — non-expired (created within the last 30 days)
 * notification rows, newest-first, for the Dashboard bell panel.
 *
 * Indexed range read via by_created_at (no full-table scan) — mirrors
 * getPointsHistory's `.order("desc")` idiom (customers.ts).
 */
export const getNotifications = query({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_created_at", (q) => q.gte("created_at", cutoff))
      .order("desc")
      .collect();
    return rows;
  },
});

/**
 * markAllSeen — called when the bell panel is opened (per design doc §b).
 * Patches every currently-unseen, non-expired row to seen:true. Scoped to
 * the same by_created_at non-expired window getNotifications reads, so it
 * only ever touches rows the merchant can actually see.
 */
export const markAllSeen = mutation({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_created_at", (q) => q.gte("created_at", cutoff))
      .collect();
    const unseen = rows.filter((r) => !r.seen);
    await Promise.all(unseen.map((r) => ctx.db.patch(r._id, { seen: true })));
    return { updated: unseen.length };
  },
});

/**
 * deleteNotification — removes exactly one notification row. Calls
 * ctx.db.delete ONLY on the notifications table (see NON-NEGOTIABLES above)
 * — no read/patch/delete of users, ai_message_drafts, or message_actions,
 * so the underlying birthday/anniversary data (and the separate AI-drafts
 * feature) is completely unaffected by this call.
 */
export const deleteNotification = mutation({
  args: { notificationId: v.id("notifications"), userId: v.id("users"), token: v.string() },
  handler: async (ctx, { notificationId, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    await ctx.db.delete(notificationId);
    return { ok: true };
  },
});
