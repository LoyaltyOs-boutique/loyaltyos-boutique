import { action, internalQuery } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { put } from "@vercel/blob";
import { internal } from "./_generated/api";
import { requireMerchantSession } from "./auth";
import type { Id, Doc } from "./_generated/dataModel";

/**
 * Templates section — Video/Image/PDF Send (Phase 1, structure only)
 * Design spec: docs/superpowers/specs/2026-08-22-templates-section-phase1-design.md
 *
 * Same Vercel Blob pattern as convex/lookbooks.ts's generatePdfUploadUrl,
 * generalized to accept any content type instead of hardcoding
 * "application/pdf". Unlike the PDF-lookbook flow, Phase 1 has no DB table
 * to persist template media to — Card 3 only needs a shareable Blob URL to
 * build the wa.me message text — so this action returns the URL directly,
 * with no paired internalMutation.
 */

/**
 * Multi-boutique Phase 1 — own copy of the same guard ai.ts/whatsapp.ts each
 * keep privately: requireMerchantSession confirms the caller IS a merchant,
 * this additionally guarantees that merchant has a boutique_id, so the
 * uploaded media's Blob pathname can be namespaced per-boutique below.
 */
function requireMerchantBoutique(merchant: Doc<"users">): Id<"boutiques"> {
  if (merchant.boutique_id === undefined) {
    throw new ConvexError("Not authorized");
  }
  return merchant.boutique_id;
}

/**
 * Merchant Session Lock (2026-09-01) — internal helper for
 * generateTemplateMediaUploadUrl. Actions have no ctx.db, so
 * requireMerchantSession (which needs ctx.db.get) cannot be called directly
 * from an action — it is wrapped in this internalQuery and invoked via
 * ctx.runQuery, mirroring convex/lookbooks.ts's checkMerchantSession
 * (built for the identical reason: generatePdfUploadUrl is also an action).
 * Throws (via requireMerchantSession) rather than returning a boolean, so
 * the action's runQuery call rejects and generateTemplateMediaUploadUrl
 * never proceeds to the Blob upload for an unauthenticated/expired caller.
 *
 * Multi-boutique Phase 1 — also resolves the merchant's boutique_id and
 * loads that boutique's own slug, returned so the caller can namespace the
 * uploaded media's Blob pathname by boutique (same pattern lookbooks.ts's
 * generatePdfUploadUrl already uses for PDFs).
 */
export const checkMerchantSession = internalQuery({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    const merchant = await requireMerchantSession(ctx, userId, token);
    const boutiqueId = requireMerchantBoutique(merchant);

    const boutique = await ctx.db.get(boutiqueId);
    if (!boutique) throw new ConvexError("Not authorized");

    return { boutiqueId, slug: boutique.slug };
  },
});

/**
 * Gate: Templates Phase 1 — Upload arbitrary media (video/image/PDF) to
 * Vercel Blob. Reads BLOB_READ_WRITE_TOKEN from the Convex deployment's env
 * vars, same pattern as lookbooks.ts's generatePdfUploadUrl / auth.ts's
 * sendResetEmail().
 * MERCHANT-ONLY (Merchant Session Lock, 2026-09-01) — session is verified via
 * checkMerchantSession (see above) before any Blob upload.
 *
 * Args:
 *  - userId, token : merchant session credentials, verified before any
 *                     Blob upload happens.
 *  - file        : raw file bytes (v.bytes() -> ArrayBuffer at the Convex
 *                  boundary).
 *  - filename    : original filename, used to build the Blob pathname.
 *  - contentType : the uploaded file's actual MIME type (video/image/pdf),
 *                  passed through to Vercel Blob instead of a hardcoded value.
 */
export const generateTemplateMediaUploadUrl = action({
  args: {
    userId: v.id("users"),
    token: v.string(),
    file: v.bytes(),
    filename: v.string(),
    contentType: v.string(),
  },
  handler: async (ctx, { userId, token, file, filename, contentType }) => {
    const { slug } = await ctx.runQuery(internal.templates.checkMerchantSession, { userId, token });

    // Renamed from `token` to `blobToken` — the merchant session arg above
    // already owns the name `token` in this scope (same collision + same
    // fix as generatePdfUploadUrl's BLOB_READ_WRITE_TOKEN var in lookbooks.ts).
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      throw new Error(
        "[generateTemplateMediaUploadUrl] BLOB_READ_WRITE_TOKEN is not set in the Convex deployment environment.",
      );
    }

    let url: string;
    try {
      // Multi-boutique Phase 1 — namespaced by slug, same pattern
      // lookbooks.ts's generatePdfUploadUrl already uses for PDFs, so two
      // boutiques uploading a same-named file can never collide/overwrite.
      const blob = await put(`${slug}/${filename}`, file, {
        access: "public",
        token: blobToken,
        contentType,
        addRandomSuffix: true, // avoid overwriting an existing file with the same filename
      });
      url = blob.url;
    } catch (err) {
      console.error(
        "[generateTemplateMediaUploadUrl] Vercel Blob upload failed:",
        err instanceof Error ? err.message : String(err),
      );
      throw new Error("Failed to upload media to storage. Please try again.");
    }

    return { ok: true, url };
  },
});
