import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
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

/**
 * Aggregates catalogue items count for a lookbook. Soft-deleted items excluded
 * (design spec: docs/superpowers/specs/2026-09-25-lookbook-delete-design.md).
 */
async function getItemCount(ctx: QueryCtx, lookbookId: Id<"lookbooks">): Promise<number> {
  const items = await ctx.db
    .query("catalogue_items")
    .withIndex("by_lookbook", (q) => q.eq("lookbook_id", lookbookId))
    .collect();
  return items.filter((i) => i.is_deleted !== true).length;
}

// --- PUBLIC API ---

/** Get all lookbooks with item_count, sorted by created_at desc. MERCHANT-ONLY. */
export const getLookbooks = query({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const lookbooks = await ctx.db.query("lookbooks").order("desc").collect();
    // Soft-delete filter (2026-09-25-lookbook-delete-design.md decision 2).
    const active = lookbooks.filter((lb) => lb.is_deleted !== true);
    return await Promise.all(
      active.map(async (lb) => ({
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
    // Soft-delete filter (2026-09-25-lookbook-delete-design.md decision 2).
    return lookbooks
      .filter((lb) => lb.is_deleted !== true)
      .map((lb) => ({
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
    // Soft-delete filter (2026-09-25-lookbook-delete-design.md decision 2) —
    // a deleted lookbook is null to every caller (public pages, OG middleware,
    // merchant PDF preview), same as a genuinely missing id.
    if (!lb || lb.is_deleted === true) return null;
    const items = await ctx.db
      .query("catalogue_items")
      .withIndex("by_lookbook", (q) => q.eq("lookbook_id", id))
      .collect();
    return { ...lb, items: items.filter((i) => i.is_deleted !== true) };
  },
});

/**
 * Customer-facing global catalogue feed (design spec 2026-09-17).
 * Source: docs/superpowers/specs/2026-09-17-customer-catalogue-pipe-design.md
 *
 * PUBLIC (customer magic-link gated, NOT merchant-session gated) — this is the
 * missing piece that lets a real customer's own browser (which never carries
 * a merchant session — customers authenticate via a completely separate
 * magic-link mechanism) see live merchant-added products instead of the
 * hardcoded src/data/seed.js demo catalogue.
 *
 * Validation deliberately MIRRORS validateMagicToken's read-only checks
 * (convex/auth.ts:296-319) inline rather than calling it directly: that
 * function is a mutation with no side effects today, but a pure catalogue
 * read must never be coupled to it (or to any future token-rotation logic
 * added there) — so the same by_magic_token lookup, role check, id-match
 * check, and 180-day expiry math are duplicated here on purpose, kept
 * byte-for-byte equivalent to auth.ts. Do not let the two drift apart.
 *
 * Architecture (confirmed, see spec): the catalogue is ONE shared global
 * list — every merchant-added product is visible to every customer, no
 * per-customer filtering, no kind-based filtering (catalogue/designer/pdf
 * are all included). A future "personalized lookbook" AI feature may
 * re-order this list per customer later, but must never restrict it.
 *
 * Returns null (never throws) on any invalid/expired/non-customer caller,
 * matching Lookbook.jsx's existing null-handling convention (null = "show
 * nothing real, fall back to local state").
 *
 * On success, returns a flat array shaped IDENTICALLY to what
 * src/lib/db.js's hydrateCatalogue() already builds client-side, because a
 * later frontend task will merge this array directly into
 * state.catalogueItems and every existing reader (cart/likes/checkout)
 * expects this exact shape.
 */
export const getCustomerCatalogue = query({
  args: {
    id: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { id, token }) => {
    // --- Inline magic-link validation (mirrors auth.ts validateMagicToken) ---
    const customer = await ctx.db
      .query("users")
      .withIndex("by_magic_token", (q) => q.eq("magic_token", token))
      .first();
    if (!customer || customer.role !== "customer") return null;
    if (String(customer._id) !== id) return null;

    const createdAt = customer.magic_token_created_at;
    if (!createdAt || Number.isNaN(createdAt)) return null;

    const MAGIC_LINK_DAYS = 180; // PRD §3.2 — same lifespan as auth.ts's MAGIC_LINK_DAYS
    const DAY_MS = 86_400_000;
    const expiresAt = createdAt + MAGIC_LINK_DAYS * DAY_MS;
    if (Date.now() > expiresAt) return null;

    // --- Validated: aggregate the full shared global catalogue ---
    // Same aggregation hydrateCatalogue() does client-side (multi round-trip),
    // done here server-side in one query call. No kind/lookbook filtering —
    // every lookbook's items are included (catalogue/designer/pdf all count).
    const lookbooks = await ctx.db.query("lookbooks").collect();
    const allItems: Array<{
      id: Id<"catalogue_items">;
      convexId: Id<"catalogue_items">;
      title: string;
      price: number; // INR (converted from paise)
      image_url: string;
      instagram_link: string;
      source: string;
      lookbook_id: Id<"lookbooks">;
    }> = [];

    // Soft-delete filter (2026-09-25-lookbook-delete-design.md decision 2) —
    // a deleted lookbook and its pieces must never reach a customer's feed.
    for (const lb of lookbooks) {
      if (lb.is_deleted === true) continue;
      const items = await ctx.db
        .query("catalogue_items")
        .withIndex("by_lookbook", (q) => q.eq("lookbook_id", lb._id))
        .collect();
      for (const item of items) {
        if (item.is_deleted === true) continue;
        allItems.push({
          id: item._id,
          convexId: item._id,
          title: item.title,
          price: (item.price || 0) / 100, // Paise to INR — same conversion hydrateCatalogue() uses
          image_url: item.image_url,
          instagram_link: item.instagram_link || "",
          source: lb.source || "manual",
          lookbook_id: lb._id,
        });
      }
    }

    return allItems;
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
    // Soft-delete filter (2026-09-25-lookbook-delete-design.md decision 2).
    if (!item || item.is_deleted === true) return null;
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
    // Reject edits to a soft-deleted lookbook (2026-09-25-lookbook-delete-design.md decision 3).
    const existing = await ctx.db.get(id);
    if (!existing || existing.is_deleted === true) {
      throw new ConvexError("This lookbook has been deleted.");
    }
    await ctx.db.patch(id, patch);
  },
});

/**
 * Soft-delete lookbook + its pieces. MERCHANT-ONLY.
 * Design spec: docs/superpowers/specs/2026-09-25-lookbook-delete-design.md
 * (decisions 1, 6) — idempotent: a missing or already-deleted lookbook
 * returns { ok: true, alreadyDeleted: true, hiddenItems: 0 } instead of
 * throwing, so a double-click/retry never surfaces an error. Nothing is
 * removed from the database — is_deleted/deleted_at only — so a later
 * archive/unarchive feature can restore by clearing these fields.
 */
export const deleteLookbook = mutation({
  args: { userId: v.id("users"), token: v.string(), id: v.id("lookbooks") },
  handler: async (ctx, { userId, token, id }) => {
    await requireMerchantSession(ctx, userId, token);
    const lb = await ctx.db.get(id);
    if (!lb || lb.is_deleted === true) {
      return { ok: true, alreadyDeleted: true, hiddenItems: 0 };
    }
    const deletedAt = Date.now();
    const items = await ctx.db
      .query("catalogue_items")
      .withIndex("by_lookbook", (q) => q.eq("lookbook_id", id))
      .collect();
    const activeItems = items.filter((i) => i.is_deleted !== true);
    for (const item of activeItems) {
      await ctx.db.patch(item._id, { is_deleted: true, deleted_at: deletedAt });
    }
    await ctx.db.patch(id, { is_deleted: true, deleted_at: deletedAt });
    return { ok: true, alreadyDeleted: false, hiddenItems: activeItems.length };
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
    // Reject adding into a soft-deleted lookbook (2026-09-25-lookbook-delete-design.md decision 3).
    const lb = await ctx.db.get(args.lookbook_id);
    if (!lb || lb.is_deleted === true) {
      throw new ConvexError("This lookbook has been deleted.");
    }
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
    // Reject edits to a soft-deleted piece (2026-09-25-lookbook-delete-design.md decision 3).
    const existing = await ctx.db.get(id);
    if (!existing || existing.is_deleted === true) {
      throw new ConvexError("This piece has been deleted.");
    }
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