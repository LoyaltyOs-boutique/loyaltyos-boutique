import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { put } from "@vercel/blob";
import { internal } from "./_generated/api";
import { requireMerchantSession } from "./auth";

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

/** Get all lookbooks with item_count, sorted by created_at desc. MERCHANT-ONLY. */
export const getLookbooks = query({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const lookbooks = await ctx.db.query("lookbooks").order("desc").collect();
    return await Promise.all(
      lookbooks.map(async (lb) => ({
        ...lb,
        item_count: await getItemCount(ctx, lb._id),
      }))
    );
  },
});

/**
 * Gate 2 (Step A) — flat projection for the Catalogue.jsx lookbook/PDF selector
 * dropdown. Returns only what the UI needs (_id, name, kind) — deliberately NOT
 * the full lookbook doc, matching the toMerchantCustomer-style thin-projection
 * pattern used elsewhere (see convex/customers.ts) to keep confidential/unused
 * fields out of client responses.
 *
 * Note: the table's display-name field is `title`, but the design spec's
 * selector shape is `{_id, name, kind}` — so we relabel title -> name here.
 * The implicit "Current catalogue" pseudo-option is UI-only and NOT included
 * in this list (it isn't a real lookbooks row).
 *
 * MERCHANT-ONLY (Merchant Session Lock, 2026-09-01).
 */
export const getLookbooksForSelector = query({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const lookbooks = await ctx.db.query("lookbooks").collect();
    return lookbooks.map((lb) => ({
      _id: lb._id,
      name: lb.title,
      kind: lb.kind,
    }));
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

/**
 * Get a single catalogue item by id (O(1) lookup).
 * Server-side counterpart to src/lib/db.js's getCatalogueItemById() client
 * helper (which scans all lookbooks) — needed by the OG-preview middleware,
 * which cannot use client-side helpers.
 */
export const getCatalogueItemById = query({
  args: { id: v.id("catalogue_items") },
  handler: async (ctx, { id }) => {
    const item = await ctx.db.get(id);
    if (!item) return null;
    return item;
  },
});

/**
 * Create lookbook. MERCHANT-ONLY.
 * `kind` is optional (Gate 2 Step C): pass "designer" to tag a manually-created
 * designer-lookbook so it shows in the Step A selector's designer list; omit for
 * legacy/catalogue rows (missing kind is treated as catalogue grouping).
 */
export const createLookbook = mutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    title: v.string(),
    designer: v.string(),
    source: LOOKBOOK_SOURCES,
    kind: v.optional(
      v.union(v.literal("catalogue"), v.literal("designer"), v.literal("pdf")),
    ),
  },
  handler: async (ctx, { userId, token, ...args }) => {
    await requireMerchantSession(ctx, userId, token);
    const id = await ctx.db.insert("lookbooks", {
      ...args,
      created_at: Date.now(),
    });
    return { ok: true, id };
  },
});

/** Patch lookbook. MERCHANT-ONLY. */
export const updateLookbook = mutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    id: v.id("lookbooks"),
    title: v.optional(v.string()),
    designer: v.optional(v.string()),
    source: v.optional(LOOKBOOK_SOURCES),
  },
  handler: async (ctx, { userId, token, id, ...patch }) => {
    await requireMerchantSession(ctx, userId, token);
    await ctx.db.patch(id, patch);
  },
});

/** Delete lookbook + items (cleanup). MERCHANT-ONLY. */
export const deleteLookbook = mutation({
  args: { userId: v.id("users"), token: v.string(), id: v.id("lookbooks") },
  handler: async (ctx, { userId, token, id }) => {
    await requireMerchantSession(ctx, userId, token);
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

/** Add catalogue item. Price in paise (Integer). MERCHANT-ONLY. */
export const addCatalogueItem = mutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    lookbook_id: v.id("lookbooks"),
    title: v.string(),
    price: v.number(), // PAISE integer
    image_url: v.string(),
    instagram_link: v.optional(v.string()),
  },
  handler: async (ctx, { userId, token, ...args }) => {
    await requireMerchantSession(ctx, userId, token);
    return await ctx.db.insert("catalogue_items", args);
  },
});

/** Patch catalogue item. MERCHANT-ONLY. */
export const updateCatalogueItem = mutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    id: v.id("catalogue_items"),
    title: v.optional(v.string()),
    price: v.optional(v.number()),
    image_url: v.optional(v.string()),
    instagram_link: v.optional(v.string()),
  },
  handler: async (ctx, { userId, token, id, ...patch }) => {
    await requireMerchantSession(ctx, userId, token);
    await ctx.db.patch(id, patch);
  },
});

/** Delete item. MERCHANT-ONLY. */
export const deleteCatalogueItem = mutation({
  args: { userId: v.id("users"), token: v.string(), id: v.id("catalogue_items") },
  handler: async (ctx, { userId, token, id }) => {
    await requireMerchantSession(ctx, userId, token);
    await ctx.db.delete(id);
  },
});

// ---------------------------------------------------------------------------
// Gate 2 (Step B) — PDF Lookbook Upload + Storage
// Design spec: docs/superpowers/specs/2026-08-22-lookbook-share-and-selector-design.md
//
// Pattern mirrors convex/auth.ts's forgotPassword: actions can fetch external
// services (Vercel Blob) but cannot touch ctx.db directly, so the DB write is
// delegated to a paired internalMutation via ctx.runMutation.
// ---------------------------------------------------------------------------

/**
 * Persists a new PDF-kind lookbook row, including its Vercel Blob URL.
 * `pdf_url` on the `lookbooks` table (convex/schema.ts) closed the prior
 * blocker where this URL had nowhere to be stored — now written directly.
 */
export const createPdfLookbook = internalMutation({
  args: {
    name: v.string(),
    pdf_url: v.string(),
  },
  handler: async (ctx, { name, pdf_url }) => {
    const id = await ctx.db.insert("lookbooks", {
      title: name,
      // `designer` is a required string on the schema; no PDF-specific
      // designer concept exists, so a neutral placeholder is used.
      designer: "—", // em dash — "not applicable" placeholder
      // `source` is a required union; "pdf" is the correct existing literal
      // for a PDF-originated lookbook (see LOOKBOOK_SOURCES above).
      source: "pdf",
      kind: "pdf",
      pdf_url,
      created_at: Date.now(),
    });
    return { ok: true, id, pdf_url };
  },
});

/**
 * Merchant Session Lock (2026-09-01) — internal helper for generatePdfUploadUrl.
 * Actions have no ctx.db, so requireMerchantSession (which needs ctx.db.get)
 * cannot be called directly from an action — it is wrapped in this
 * internalQuery and invoked via ctx.runQuery, mirroring the existing
 * action -> internalMutation delegation pattern already used below
 * (createPdfLookbook) for the same reason (actions lack direct DB access).
 * Throws (via requireMerchantSession) rather than returning a boolean, so
 * the action's runQuery call rejects and generatePdfUploadUrl never proceeds
 * to the Blob upload for an unauthenticated/expired caller.
 */
export const checkMerchantSession = internalQuery({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    return null;
  },
});

/**
 * Gate 2 (Step B) — Upload a PDF lookbook to Vercel Blob and record it.
 * MERCHANT-ONLY (Merchant Session Lock, 2026-09-01) — session is verified via
 * checkMerchantSession (see above) before any Blob upload or DB write.
 *
 * Actions (not mutations) can perform external fetches; Convex mutations
 * cannot. Reads BLOB_READ_WRITE_TOKEN from the Convex deployment's env vars,
 * same pattern as auth.ts's sendResetEmail() reading RESEND_API_KEY.
 *
 * Args:
 *  - userId, token : merchant session credentials, verified before any
 *                     Blob upload or DB write happens.
 *  - file      : raw file bytes (v.bytes() -> ArrayBuffer at the Convex
 *                boundary — see convex/_generated/ai/guidelines.md's binary
 *                data table; this project has no Next.js API route to do the
 *                upload server-side, so the action itself receives the bytes).
 *  - filename  : original filename, used to build the Blob pathname.
 *  - lookbookName : display name for the new lookbook row.
 */
export const generatePdfUploadUrl = action({
  args: {
    userId: v.id("users"),
    token: v.string(),
    file: v.bytes(),
    filename: v.string(),
    lookbookName: v.string(),
  },
  handler: async (ctx, { userId, token, file, filename, lookbookName }) => {
    await ctx.runQuery(internal.lookbooks.checkMerchantSession, { userId, token });

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      throw new Error(
        "[generatePdfUploadUrl] BLOB_READ_WRITE_TOKEN is not set in the Convex deployment environment.",
      );
    }

    let url: string;
    try {
      const blob = await put(filename, file, {
        access: "public",
        token: blobToken,
        contentType: "application/pdf",
        addRandomSuffix: true, // avoid overwriting an existing PDF with the same filename
      });
      url = blob.url;
    } catch (err) {
      console.error(
        "[generatePdfUploadUrl] Vercel Blob upload failed:",
        err instanceof Error ? err.message : String(err),
      );
      throw new Error("Failed to upload PDF to storage. Please try again.");
    }

    // Actions have no ctx.db — persist via the paired internalMutation.
    const created = await ctx.runMutation(internal.lookbooks.createPdfLookbook, {
      name: lookbookName,
      pdf_url: url,
    });

    return { ok: true, pdf_url: url, lookbookId: created.id, ...created };
  },
});