import { mutation, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/**
 * LoyaltyOS Boutique — Lookbook Catalogue backend (Step 6.1)
 * Source        : PRD Module 2 (Catalogue & Lookbook)
 * Design spec   : docs/superpowers/specs/2026-08-13-lookbook-backend-design.md
 * 
 * CURRENCY INVARIANT (Global Constraint):
 *   All money fields are INTEGER PAISE — never floats.
 *   ₹1 = 100 paise.
 */

// --- CONSTANTS ---
export const LOOKBOOK_SOURCES = v.union(
  v.literal("manual"),
  v.literal("pdf"),
  v.literal("csv"),
  v.literal("instagram"),
);

// --- HELPERS ---

/** Aggregates catalogue items count for a lookbook. */
async function getItemCount(ctx: QueryCtx, lookbookId: Id<"lookbooks">): Promise<number> {
  const items = await ctx.db
    .query("catalogue_items")
    .withIndex("by_lookbook", (q) => q.eq("lookbook_id", lookbookId))
    .collect();
  return items.length;
}

// --- PUBLIC API ---

/** Get all lookbooks with item_count, sorted by created_at desc. */
export const getLookbooks = query({
  args: {},
  handler: async (ctx) => {
    const lookbooks = await ctx.db.query("lookbooks").order("desc").collect();
    return await Promise.all(
      lookbooks.map(async (lb) => ({
        ...lb,
        item_count: await getItemCount(ctx, lb._id),
      }))
    );
  },
});

/** Get lookbook + items (by_lookbook index). */
export const getLookbookById = query({
  args: { id: v.id("lookbooks") },
  handler: async (ctx, { id }) => {
    const lb = await ctx.db.get(id);
    if (!lb) return null;
    const items = await ctx.db
      .query("catalogue_items")
      .withIndex("by_lookbook", (q) => q.eq("lookbook_id", id))
      .collect();
    return { ...lb, items };
  },
});

/** Create lookbook. */
export const createLookbook = mutation({
  args: {
    title: v.string(),
    designer: v.string(),
    source: LOOKBOOK_SOURCES,
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("lookbooks", {
      ...args,
      created_at: Date.now(),
    });
    return { ok: true, id };
  },
});

/** Patch lookbook. */
export const updateLookbook = mutation({
  args: {
    id: v.id("lookbooks"),
    title: v.optional(v.string()),
    designer: v.optional(v.string()),
    source: v.optional(LOOKBOOK_SOURCES),
  },
  handler: async (ctx, { id, ...patch }) => {
    await ctx.db.patch(id, patch);
  },
});

/** Delete lookbook + items (cleanup). */
export const deleteLookbook = mutation({
  args: { id: v.id("lookbooks") },
  handler: async (ctx, { id }) => {
    // Delete all items first
    const items = await ctx.db
      .query("catalogue_items")
      .withIndex("by_lookbook", (q) => q.eq("lookbook_id", id))
      .collect();
    for (const item of items) {
      await ctx.db.delete(item._id);
    }
    await ctx.db.delete(id);
  },
});

/** Add catalogue item. Price in paise (Integer). */
export const addCatalogueItem = mutation({
  args: {
    lookbook_id: v.id("lookbooks"),
    title: v.string(),
    price: v.number(), // PAISE integer
    image_url: v.string(),
    instagram_link: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("catalogue_items", args);
  },
});

/** Patch catalogue item. */
export const updateCatalogueItem = mutation({
  args: {
    id: v.id("catalogue_items"),
    title: v.optional(v.string()),
    price: v.optional(v.number()),
    image_url: v.optional(v.string()),
    instagram_link: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    await ctx.db.patch(id, patch);
  },
});

/** Delete item. */
export const deleteCatalogueItem = mutation({
  args: { id: v.id("catalogue_items") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});