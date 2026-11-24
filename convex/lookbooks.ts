import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
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

/**
 * Design spec: docs/superpowers/specs/2026-09-25-product-gallery-design.md
 * (Backend section) — shape of one catalogue_items.media entry, shared by the
 * schema, addCatalogueItem, and updateCatalogueItem so the three never drift.
 */
const MEDIA_ITEM = v.object({
  url: v.string(),
  type: v.union(v.literal("image"), v.literal("video")),
});

type MediaItem = { url: string; type: "image" | "video" };

/**
 * Design spec: docs/superpowers/specs/2026-09-25-product-gallery-design.md
 * (Backend section) — validates an optional catalogue_items.media gallery
 * before insert/patch: 1 to 8 entries, at most 2 videos, every url non-empty,
 * and the first entry (the cover) must be an image. Throws a ConvexError on
 * any violation; both callers must not write anything if this throws.
 */
function validateMedia(media: MediaItem[]) {
  if (media.length < 1 || media.length > 8) {
    throw new ConvexError("A piece can have between 1 and 8 photos or videos.");
  }
  if (media.filter((m) => m.type === "video").length > 2) {
    throw new ConvexError("A piece can have at most 2 videos.");
  }
  if (media.some((m) => !m.url || !m.url.trim())) {
    throw new ConvexError("Every photo or video needs a URL.");
  }
  if (media[0].type !== "image") {
    throw new ConvexError("The first photo (the cover) must be an image, not a video.");
  }
}

/**
 * Design spec: docs/superpowers/specs/2026-11-15-customer-orders-design.md
 * Amendment: docs/superpowers/specs/2026-11-24-sizes-availability-amendment.md
 *
 * Stock is no longer counted — these fields track size AVAILABILITY only
 * (which sizes exist, which are out of stock), shared by addCatalogueItem,
 * updateCatalogueItem and the projection helper below so they never drift.
 */
const SIZE_LITERAL = v.union(
  v.literal("S"),
  v.literal("M"),
  v.literal("L"),
  v.literal("XL"),
  v.literal("XXL"),
);
const SIZES_ARG = v.array(SIZE_LITERAL);
type Size = "S" | "M" | "L" | "XL" | "XXL";

// Legacy per-size stock object shape (pre-amendment). Never written anymore —
// kept only so a "sized" piece that predates this amendment (old M/L/XL/XXL
// stock keys, no `sizes` array yet) can still have its sizes derived.
type LegacyStock = {
  M?: number;
  L?: number;
  XL?: number;
  XXL?: number;
  FREE?: number;
};

/**
 * Design spec: docs/superpowers/specs/2026-11-15-customer-orders-design.md
 * Amendment: docs/superpowers/specs/2026-11-24-sizes-availability-amendment.md
 *
 * Validates the EFFECTIVE (post-patch) size_mode/sizes/out_of_stock_sizes/
 * out_of_stock combination before insert/patch. "sized" needs at least one
 * unique size, with out_of_stock_sizes a subset of sizes with no duplicates
 * and no separate out_of_stock flag (sizes are flagged individually); "free"
 * and "one" carry no sizes/out_of_stock_sizes, only the single out_of_stock
 * flag. A legacy piece (size_mode undefined) must carry none of these fields.
 * Throws a ConvexError on any violation so the caller writes nothing.
 */
function validateSizeAvailability(
  sizeMode: "sized" | "free" | "one" | undefined,
  sizes: Size[] | undefined,
  outOfStockSizes: Size[] | undefined,
  outOfStock: boolean | undefined,
) {
  if (sizeMode === undefined) {
    if (sizes !== undefined || outOfStockSizes !== undefined || outOfStock !== undefined) {
      throw new ConvexError("Choose a size type before setting size availability.");
    }
    return;
  }
  if (sizeMode === "sized") {
    if (outOfStock !== undefined) {
      throw new ConvexError("A sized piece marks sizes out of stock individually, not the whole piece.");
    }
    if (!sizes || sizes.length < 1) {
      throw new ConvexError("Choose at least one size for a sized piece.");
    }
    if (new Set(sizes).size !== sizes.length) {
      throw new ConvexError("Each size can only be chosen once.");
    }
    const available = new Set(sizes);
    for (const s of outOfStockSizes ?? []) {
      if (!available.has(s)) {
        throw new ConvexError("A size can only be marked out of stock if the piece is available in it.");
      }
    }
    if (outOfStockSizes && new Set(outOfStockSizes).size !== outOfStockSizes.length) {
      throw new ConvexError("Each out-of-stock size can only be listed once.");
    }
  } else {
    // "free" or "one"
    if (sizes !== undefined || outOfStockSizes !== undefined) {
      throw new ConvexError("Free size and one size pieces do not have a size list.");
    }
  }
}

/**
 * Amendment: docs/superpowers/specs/2026-11-24-sizes-availability-amendment.md
 * (switch-size-type fix)
 *
 * Drops whichever size-availability fields don't belong to `mode` BEFORE
 * validation/write — "sized" keeps sizes/out_of_stock_sizes and never an
 * out_of_stock flag; "free"/"one" keep only out_of_stock; a legacy piece
 * (mode undefined) keeps none of these fields. Called by both
 * addCatalogueItem and updateCatalogueItem so a field left over from a
 * DIFFERENT size type (e.g. a stale `out_of_stock: false` still present
 * after switching to "sized") is silently ignored instead of being
 * validated against the wrong mode's rules.
 */
function normalizeSizeFields(
  mode: "sized" | "free" | "one" | undefined,
  sizes: Size[] | undefined,
  outOfStockSizes: Size[] | undefined,
  outOfStock: boolean | undefined,
): { sizes: Size[] | undefined; out_of_stock_sizes: Size[] | undefined; out_of_stock: boolean | undefined } {
  if (mode === "sized") {
    return { sizes, out_of_stock_sizes: outOfStockSizes, out_of_stock: undefined };
  }
  if (mode === "free" || mode === "one") {
    return { sizes: undefined, out_of_stock_sizes: undefined, out_of_stock: outOfStock };
  }
  return { sizes: undefined, out_of_stock_sizes: undefined, out_of_stock: undefined };
}

/**
 * Design spec: docs/superpowers/specs/2026-11-15-customer-orders-design.md
 * Amendment: docs/superpowers/specs/2026-11-24-sizes-availability-amendment.md
 *
 * Projects a catalogue_items doc's raw size fields into what every frontend
 * reader (and orderRequests.placeOrderRequest) needs: size_mode always
 * resolved to "sized"|"free"|"one" (missing/legacy -> "free", per the
 * amendment's "legacy pieces are Free size everywhere" decision), sizes/
 * out_of_stock_sizes only present for "sized" pieces, out_of_stock only
 * present for "free"/"one" pieces. A legacy "sized" piece that predates this
 * amendment (old per-size `stock` counts, no `sizes` array yet) has its
 * sizes derived from whichever of M/L/XL/XXL exist as keys in `stock`, so it
 * keeps showing its real sizes until the merchant re-saves it through the
 * new Edit Stock UI. Exported so orderRequests.ts validates against the
 * exact same effective availability the customer is shown.
 */
export function projectSizeAvailability(item: {
  size_mode?: "sized" | "free" | "one";
  sizes?: Size[];
  out_of_stock_sizes?: Size[];
  out_of_stock?: boolean;
  stock?: LegacyStock;
}): {
  size_mode: "sized" | "free" | "one";
  sizes?: Size[];
  out_of_stock_sizes?: Size[];
  out_of_stock?: boolean;
} {
  const mode = item.size_mode ?? "free";
  if (mode !== "sized") {
    return { size_mode: mode, out_of_stock: item.out_of_stock ?? false };
  }
  let sizes = item.sizes;
  if (!sizes && item.stock) {
    sizes = (["M", "L", "XL", "XXL"] as const).filter((k) => item.stock![k] !== undefined);
  }
  return { size_mode: "sized", sizes: sizes ?? [], out_of_stock_sizes: item.out_of_stock_sizes ?? [] };
}

/**
 * Packet A (2026-10-01) — finds or lazily creates the one "Current catalogue"
 * home lookbook (kind: "catalogue"). Not an exported query/mutation/action —
 * a plain helper, only callable from inside an already-guarded mutation in
 * this file (today, addCatalogueItem), so it never needs its own session
 * check. The home row is never shown in getLookbooksForSelector and can
 * never be removed via deleteLookbook — see those functions below.
 * Design spec: docs/superpowers/specs/2026-10-01-packet-a-data-safety-design.md
 */
async function getOrCreateHomeLookbook(ctx: { db: MutationCtx["db"] }): Promise<Id<"lookbooks">> {
  const existing = await ctx.db.query("lookbooks").collect();
  const home = existing.find((lb) => lb.kind === "catalogue" && lb.is_deleted !== true);
  if (home) return home._id;

  // None exists yet — create the one home row. `designer` and `source` are
  // required columns with no catalogue-specific value, so a neutral
  // placeholder mirrors the one createPdfLookbook already uses below.
  return await ctx.db.insert("lookbooks", {
    title: "Current catalogue",
    designer: "—", // em dash — "not applicable" placeholder, same as createPdfLookbook
    source: "manual",
    kind: "catalogue",
    created_at: Date.now(),
  });
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
    // Soft-delete filter (2026-09-25-lookbook-delete-design.md decision 2),
    // plus the home "Current catalogue" row (kind: "catalogue") — it must
    // never show up as a pickable option here (design spec 2026-10-01,
    // decision 3), even though getLookbooks/getLookbookById/
    // getCustomerCatalogue keep including it so its pieces still load.
    return lookbooks
      .filter((lb) => lb.is_deleted !== true && lb.kind !== "catalogue")
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
    // Amendment: docs/superpowers/specs/2026-11-24-sizes-availability-amendment.md —
    // project size availability for every reader of this query (merchant
    // hydrateCatalogue AND public lookbook pages — this query has no session guard).
    return {
      ...lb,
      items: items
        .filter((i) => i.is_deleted !== true)
        .map((i) => ({ ...i, ...projectSizeAvailability(i) })),
    };
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
      // Design spec: docs/superpowers/specs/2026-09-25-product-gallery-design.md
      media?: MediaItem[];
      // Design spec: docs/superpowers/specs/2026-11-15-customer-orders-design.md
      // Amendment: docs/superpowers/specs/2026-11-24-sizes-availability-amendment.md —
      // the customer lookbook needs these to show the size selector and respect availability.
      size_mode: "sized" | "free" | "one";
      sizes?: Size[];
      out_of_stock_sizes?: Size[];
      out_of_stock?: boolean;
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
          media: item.media, // Design spec: docs/superpowers/specs/2026-09-25-product-gallery-design.md
          ...projectSizeAvailability(item), // Amendment: docs/superpowers/specs/2026-11-24-sizes-availability-amendment.md
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
    // Amendment: docs/superpowers/specs/2026-11-24-sizes-availability-amendment.md —
    // PublicPiece.jsx (public, unauthenticated) reads this query directly.
    return { ...item, ...projectSizeAvailability(item) };
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
    // The home "Current catalogue" row (kind: "catalogue") is permanent —
    // design spec 2026-10-01, decision 4. Checked before any write so a
    // rejected call never soft-deletes its pieces either.
    if (lb.kind === "catalogue") {
      throw new ConvexError("The Current catalogue cannot be deleted.");
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
    // Packet A (2026-10-01, decision 2) — optional now. When omitted, the
    // piece goes into the home "Current catalogue" lookbook instead of
    // guessing the newest one; the schema column itself stays required.
    lookbook_id: v.optional(v.id("lookbooks")),
    title: v.string(),
    price: v.number(), // PAISE integer
    image_url: v.string(),
    instagram_link: v.optional(v.string()),
    // Design spec: docs/superpowers/specs/2026-09-25-product-gallery-design.md
    media: v.optional(v.array(MEDIA_ITEM)),
    // Design spec: docs/superpowers/specs/2026-11-15-customer-orders-design.md
    // Amendment: docs/superpowers/specs/2026-11-24-sizes-availability-amendment.md
    size_mode: v.optional(v.union(v.literal("sized"), v.literal("free"), v.literal("one"))),
    sizes: v.optional(SIZES_ARG),
    out_of_stock_sizes: v.optional(SIZES_ARG),
    out_of_stock: v.optional(v.boolean()),
  },
  handler: async (ctx, { userId, token, ...args }) => {
    await requireMerchantSession(ctx, userId, token);

    // Normalize before validating (switch-size-type fix, amendment 2026-11-24)
    // — drops any field that doesn't belong to this piece's size_mode (e.g. a
    // stray out_of_stock sent alongside size_mode "sized") instead of
    // validating it against the wrong mode's rules.
    const normalizedSize = normalizeSizeFields(args.size_mode, args.sizes, args.out_of_stock_sizes, args.out_of_stock);
    args.sizes = normalizedSize.sizes;
    args.out_of_stock_sizes = normalizedSize.out_of_stock_sizes;
    args.out_of_stock = normalizedSize.out_of_stock;
    validateSizeAvailability(args.size_mode, args.sizes, args.out_of_stock_sizes, args.out_of_stock);

    // Packet A (2026-10-01, decision 2) — resolve a missing lookbook_id to
    // the home lookbook, finding or creating it in the same transaction, so
    // a piece added without a chosen lookbook never lands on whichever
    // lookbook happens to be newest.
    const lookbookId = args.lookbook_id ?? (await getOrCreateHomeLookbook(ctx));

    // Reject adding into a soft-deleted lookbook (2026-09-25-lookbook-delete-design.md decision 3).
    const lb = await ctx.db.get(lookbookId);
    if (!lb || lb.is_deleted === true) {
      throw new ConvexError("This lookbook has been deleted.");
    }
    // Design spec: docs/superpowers/specs/2026-09-25-product-gallery-design.md —
    // validate the gallery and mirror the cover into image_url when provided.
    if (args.media) {
      validateMedia(args.media);
      args.image_url = args.media[0].url;
    }
    return await ctx.db.insert("catalogue_items", { ...args, lookbook_id: lookbookId });
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
    // Design spec: docs/superpowers/specs/2026-09-25-product-gallery-design.md
    media: v.optional(v.array(MEDIA_ITEM)),
    // Design spec: docs/superpowers/specs/2026-11-15-customer-orders-design.md
    // Amendment: docs/superpowers/specs/2026-11-24-sizes-availability-amendment.md
    size_mode: v.optional(v.union(v.literal("sized"), v.literal("free"), v.literal("one"))),
    sizes: v.optional(SIZES_ARG),
    out_of_stock_sizes: v.optional(SIZES_ARG),
    out_of_stock: v.optional(v.boolean()),
  },
  handler: async (ctx, { userId, token, id, ...patch }) => {
    await requireMerchantSession(ctx, userId, token);
    // Reject edits to a soft-deleted piece (2026-09-25-lookbook-delete-design.md decision 3).
    const existing = await ctx.db.get(id);
    if (!existing || existing.is_deleted === true) {
      throw new ConvexError("This piece has been deleted.");
    }
    // Amendment 2026-11-24 (switch-size-type fix) — validate the EFFECTIVE
    // size availability this patch leaves the row in. When size_mode is
    // actually CHANGING, compute the effective values from the NEW mode's
    // freshly-patched fields only — never merge in the old mode's stale
    // fields from `existing` (that was the bug: an old `sizes` array
    // surviving a switch to Free size, or an old `out_of_stock` surviving a
    // switch to Sized). When size_mode is not changing, keep the existing
    // "patch value ?? existing value" merge so editing e.g. only
    // out_of_stock_sizes still checks against the real current `sizes`.
    if (
      patch.size_mode !== undefined ||
      patch.sizes !== undefined ||
      patch.out_of_stock_sizes !== undefined ||
      patch.out_of_stock !== undefined
    ) {
      const modeChanging = patch.size_mode !== undefined && patch.size_mode !== existing.size_mode;
      const effectiveMode = patch.size_mode ?? existing.size_mode;
      const effectiveSizes = modeChanging ? patch.sizes : (patch.sizes ?? existing.sizes);
      const effectiveOutOfStockSizes = modeChanging
        ? patch.out_of_stock_sizes
        : (patch.out_of_stock_sizes ?? existing.out_of_stock_sizes);
      const effectiveOutOfStock = modeChanging ? patch.out_of_stock : (patch.out_of_stock ?? existing.out_of_stock);

      // Normalize — drops whichever fields don't belong to the effective
      // mode (e.g. a stale out_of_stock left over from before switching to
      // "sized") so validation never throws on an irrelevant leftover field.
      const normalizedSize = normalizeSizeFields(effectiveMode, effectiveSizes, effectiveOutOfStockSizes, effectiveOutOfStock);
      validateSizeAvailability(effectiveMode, normalizedSize.sizes, normalizedSize.out_of_stock_sizes, normalizedSize.out_of_stock);

      // Write the normalized values back explicitly (including explicit
      // `undefined`s, which Convex's patch treats as "remove this field")
      // so the row's stale fields from the old mode actually get cleared.
      patch.sizes = normalizedSize.sizes;
      patch.out_of_stock_sizes = normalizedSize.out_of_stock_sizes;
      patch.out_of_stock = normalizedSize.out_of_stock;
    }
    // Design spec: docs/superpowers/specs/2026-09-25-product-gallery-design.md —
    // validate the gallery and mirror the cover into image_url when provided.
    if (patch.media) {
      validateMedia(patch.media);
      patch.image_url = patch.media[0].url;
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