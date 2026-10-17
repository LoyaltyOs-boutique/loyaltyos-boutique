import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { getBoutiqueBySlug, getDefaultBoutique } from "./boutiques";

/**
 * LoyaltyOS Boutique — one-time Step B migration tools (Phase 1 Batch 3).
 * Design spec: docs/superpowers/specs/2026-10-16-multi-boutique-design.md §3.5 Step B
 * Phase 1 audit: docs/superpowers/audits/2026-10-16-phase1-data-wall-audit.md §7
 *
 * These are one-time migration tools, not test-only code — they are meant to
 * run on the LIVE backend in Phase 8's Release A (audit §7's live order), so
 * there is deliberately no ALLOW_TEST_SEED-style lock here. Internal only.
 * None of these ever return ids, cursors, or row contents.
 */

const DEFAULT_SLUG = "85-lansdowne";
const DEFAULT_NAME = "85 Lansdowne"; // BRAND.name in src/data/seed.js:3

const TABLE_NAMES = v.union(
  v.literal("users"),
  v.literal("lookbooks"),
  v.literal("catalogue_items"),
  v.literal("orders"),
  v.literal("campaigns"),
  v.literal("settings"),
  v.literal("reviews"),
  v.literal("message_actions"),
  v.literal("points_ledger"),
  v.literal("ai_message_drafts"),
  v.literal("events"),
  v.literal("notifications"),
  v.literal("customer_activity_events"),
  v.literal("customer_activity_summaries"),
);

export const createDefaultBoutique = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await getBoutiqueBySlug(ctx, DEFAULT_SLUG);
    if (existing) {
      return { created: false };
    }

    const otherDefault = await getDefaultBoutique(ctx);
    if (otherDefault) {
      throw new Error("a different default boutique already exists");
    }

    const now = Date.now();
    await ctx.db.insert("boutiques", {
      name: DEFAULT_NAME,
      slug: DEFAULT_SLUG,
      status: "active",
      is_default: true,
      one_device_lock: true,
      flags: {},
      created_at: now,
      updated_at: now,
    });
    return { created: true };
  },
});

export const backfillBoutiqueId = internalMutation({
  args: {
    table: TABLE_NAMES,
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, { table, cursor, batchSize }) => {
    const numItems = Math.max(1, Math.min(batchSize ?? 100, 200));

    // The target boutique id always comes from resolving DEFAULT_SLUG here —
    // never from an argument — so this function can never be pointed at the
    // wrong boutique by a caller.
    const target = await getBoutiqueBySlug(ctx, DEFAULT_SLUG);
    if (!target) {
      throw new Error("default boutique missing: run createDefaultBoutique first");
    }
    const boutiqueId = target._id;

    let scanned = 0;
    let patched = 0;
    let isDone = true;
    let continueCursor: string | null = null;

    switch (table) {
      case "users": {
        const r = await ctx.db.query("users").paginate({ cursor: cursor ?? null, numItems });
        for (const row of r.page) {
          scanned += 1;
          if (row.boutique_id === undefined) {
            await ctx.db.patch(row._id, { boutique_id: boutiqueId });
            patched += 1;
          }
        }
        isDone = r.isDone;
        continueCursor = r.continueCursor;
        break;
      }
      case "lookbooks": {
        const r = await ctx.db.query("lookbooks").paginate({ cursor: cursor ?? null, numItems });
        for (const row of r.page) {
          scanned += 1;
          if (row.boutique_id === undefined) {
            await ctx.db.patch(row._id, { boutique_id: boutiqueId });
            patched += 1;
          }
        }
        isDone = r.isDone;
        continueCursor = r.continueCursor;
        break;
      }
      case "catalogue_items": {
        const r = await ctx.db.query("catalogue_items").paginate({ cursor: cursor ?? null, numItems });
        for (const row of r.page) {
          scanned += 1;
          if (row.boutique_id === undefined) {
            await ctx.db.patch(row._id, { boutique_id: boutiqueId });
            patched += 1;
          }
        }
        isDone = r.isDone;
        continueCursor = r.continueCursor;
        break;
      }
      case "orders": {
        const r = await ctx.db.query("orders").paginate({ cursor: cursor ?? null, numItems });
        for (const row of r.page) {
          scanned += 1;
          if (row.boutique_id === undefined) {
            await ctx.db.patch(row._id, { boutique_id: boutiqueId });
            patched += 1;
          }
        }
        isDone = r.isDone;
        continueCursor = r.continueCursor;
        break;
      }
      case "campaigns": {
        const r = await ctx.db.query("campaigns").paginate({ cursor: cursor ?? null, numItems });
        for (const row of r.page) {
          scanned += 1;
          if (row.boutique_id === undefined) {
            await ctx.db.patch(row._id, { boutique_id: boutiqueId });
            patched += 1;
          }
        }
        isDone = r.isDone;
        continueCursor = r.continueCursor;
        break;
      }
      case "settings": {
        const r = await ctx.db.query("settings").paginate({ cursor: cursor ?? null, numItems });
        for (const row of r.page) {
          scanned += 1;
          if (row.boutique_id === undefined) {
            await ctx.db.patch(row._id, { boutique_id: boutiqueId });
            patched += 1;
          }
        }
        isDone = r.isDone;
        continueCursor = r.continueCursor;
        break;
      }
      case "reviews": {
        const r = await ctx.db.query("reviews").paginate({ cursor: cursor ?? null, numItems });
        for (const row of r.page) {
          scanned += 1;
          if (row.boutique_id === undefined) {
            await ctx.db.patch(row._id, { boutique_id: boutiqueId });
            patched += 1;
          }
        }
        isDone = r.isDone;
        continueCursor = r.continueCursor;
        break;
      }
      case "message_actions": {
        const r = await ctx.db.query("message_actions").paginate({ cursor: cursor ?? null, numItems });
        for (const row of r.page) {
          scanned += 1;
          if (row.boutique_id === undefined) {
            await ctx.db.patch(row._id, { boutique_id: boutiqueId });
            patched += 1;
          }
        }
        isDone = r.isDone;
        continueCursor = r.continueCursor;
        break;
      }
      case "points_ledger": {
        const r = await ctx.db.query("points_ledger").paginate({ cursor: cursor ?? null, numItems });
        for (const row of r.page) {
          scanned += 1;
          if (row.boutique_id === undefined) {
            await ctx.db.patch(row._id, { boutique_id: boutiqueId });
            patched += 1;
          }
        }
        isDone = r.isDone;
        continueCursor = r.continueCursor;
        break;
      }
      case "ai_message_drafts": {
        const r = await ctx.db.query("ai_message_drafts").paginate({ cursor: cursor ?? null, numItems });
        for (const row of r.page) {
          scanned += 1;
          if (row.boutique_id === undefined) {
            await ctx.db.patch(row._id, { boutique_id: boutiqueId });
            patched += 1;
          }
        }
        isDone = r.isDone;
        continueCursor = r.continueCursor;
        break;
      }
      case "events": {
        const r = await ctx.db.query("events").paginate({ cursor: cursor ?? null, numItems });
        for (const row of r.page) {
          scanned += 1;
          if (row.boutique_id === undefined) {
            await ctx.db.patch(row._id, { boutique_id: boutiqueId });
            patched += 1;
          }
        }
        isDone = r.isDone;
        continueCursor = r.continueCursor;
        break;
      }
      case "notifications": {
        const r = await ctx.db.query("notifications").paginate({ cursor: cursor ?? null, numItems });
        for (const row of r.page) {
          scanned += 1;
          if (row.boutique_id === undefined) {
            await ctx.db.patch(row._id, { boutique_id: boutiqueId });
            patched += 1;
          }
        }
        isDone = r.isDone;
        continueCursor = r.continueCursor;
        break;
      }
      case "customer_activity_events": {
        const r = await ctx.db.query("customer_activity_events").paginate({ cursor: cursor ?? null, numItems });
        for (const row of r.page) {
          scanned += 1;
          if (row.boutique_id === undefined) {
            await ctx.db.patch(row._id, { boutique_id: boutiqueId });
            patched += 1;
          }
        }
        isDone = r.isDone;
        continueCursor = r.continueCursor;
        break;
      }
      case "customer_activity_summaries": {
        const r = await ctx.db.query("customer_activity_summaries").paginate({ cursor: cursor ?? null, numItems });
        for (const row of r.page) {
          scanned += 1;
          if (row.boutique_id === undefined) {
            await ctx.db.patch(row._id, { boutique_id: boutiqueId });
            patched += 1;
          }
        }
        isDone = r.isDone;
        continueCursor = r.continueCursor;
        break;
      }
      default: {
        throw new Error("unknown table");
      }
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillBoutiqueId, {
        table,
        cursor: continueCursor,
        batchSize,
      });
    }

    return { scanned, patched, isDone };
  },
});

export const countMissingBoutiqueId = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Reads every row in every one of the 14 tables (about 853 rows on live
    // today, per docs/superpowers/audits/2026-10-15-multi-boutique-audit.md
    // section 1) — must become a paged count before any table grows large.
    let users = 0;
    for await (const row of ctx.db.query("users")) {
      if (row.boutique_id === undefined) users += 1;
    }

    let lookbooks = 0;
    for await (const row of ctx.db.query("lookbooks")) {
      if (row.boutique_id === undefined) lookbooks += 1;
    }

    let catalogue_items = 0;
    for await (const row of ctx.db.query("catalogue_items")) {
      if (row.boutique_id === undefined) catalogue_items += 1;
    }

    let orders = 0;
    for await (const row of ctx.db.query("orders")) {
      if (row.boutique_id === undefined) orders += 1;
    }

    let campaigns = 0;
    for await (const row of ctx.db.query("campaigns")) {
      if (row.boutique_id === undefined) campaigns += 1;
    }

    let settings = 0;
    for await (const row of ctx.db.query("settings")) {
      if (row.boutique_id === undefined) settings += 1;
    }

    let reviews = 0;
    for await (const row of ctx.db.query("reviews")) {
      if (row.boutique_id === undefined) reviews += 1;
    }

    let message_actions = 0;
    for await (const row of ctx.db.query("message_actions")) {
      if (row.boutique_id === undefined) message_actions += 1;
    }

    let points_ledger = 0;
    for await (const row of ctx.db.query("points_ledger")) {
      if (row.boutique_id === undefined) points_ledger += 1;
    }

    let ai_message_drafts = 0;
    for await (const row of ctx.db.query("ai_message_drafts")) {
      if (row.boutique_id === undefined) ai_message_drafts += 1;
    }

    let events = 0;
    for await (const row of ctx.db.query("events")) {
      if (row.boutique_id === undefined) events += 1;
    }

    let notifications = 0;
    for await (const row of ctx.db.query("notifications")) {
      if (row.boutique_id === undefined) notifications += 1;
    }

    let customer_activity_events = 0;
    for await (const row of ctx.db.query("customer_activity_events")) {
      if (row.boutique_id === undefined) customer_activity_events += 1;
    }

    let customer_activity_summaries = 0;
    for await (const row of ctx.db.query("customer_activity_summaries")) {
      if (row.boutique_id === undefined) customer_activity_summaries += 1;
    }

    return {
      users,
      lookbooks,
      catalogue_items,
      orders,
      campaigns,
      settings,
      reviews,
      message_actions,
      points_ledger,
      ai_message_drafts,
      events,
      notifications,
      customer_activity_events,
      customer_activity_summaries,
    };
  },
});
