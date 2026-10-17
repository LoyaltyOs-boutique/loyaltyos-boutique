import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * LoyaltyOS Boutique — multi-boutique resolution + ownership helpers (Phase 1 Batch 2).
 * Design spec: docs/superpowers/specs/2026-10-16-multi-boutique-design.md §4.3, §4.4
 *
 * Plain TypeScript helpers only — none of these are registered as Convex
 * queries/mutations/actions, so they add 0 to `npx convex function-spec`'s
 * total (Phase 1 audit section 10, batch 2). Every merchant/customer/public
 * function that resolves "which boutique is this" or loads a record by id
 * calls into this file instead of re-implementing the lookup or the
 * ownership check inline.
 */

/** Resolve a boutique by its slug (spec §4.3 — /join/:slug, public lookbook links). */
export async function getBoutiqueBySlug(
  ctx: QueryCtx | MutationCtx,
  slug: string,
): Promise<Doc<"boutiques"> | null> {
  const s = slug.trim().toLowerCase();
  return await ctx.db
    .query("boutiques")
    .withIndex("by_slug", (q) => q.eq("slug", s))
    .unique();
}

/** Resolve the one default boutique (spec §4.3 — slug-less /join, AccessDenied/login defaults). */
export async function getDefaultBoutique(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"boutiques"> | null> {
  return await ctx.db
    .query("boutiques")
    .withIndex("by_default", (q) => q.eq("is_default", true))
    .unique();
}

/**
 * Ownership check (spec §4.4) — throws the SAME "not_found" error whether
 * the record is missing, has no boutique_id yet, or belongs to a different
 * boutique, so a caller can never learn that a record exists in another
 * boutique. Never falls back to the default boutique.
 */
export function assertSameBoutique(
  record: { boutique_id?: Id<"boutiques"> } | null | undefined,
  boutiqueId: Id<"boutiques">,
): void {
  if (!record || record.boutique_id === undefined || record.boutique_id !== boutiqueId) {
    throw new Error("not_found");
  }
}
