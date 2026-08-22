import { action } from "./_generated/server";
import { v } from "convex/values";
import { put } from "@vercel/blob";

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
 * Gate: Templates Phase 1 — Upload arbitrary media (video/image/PDF) to
 * Vercel Blob. Reads BLOB_READ_WRITE_TOKEN from the Convex deployment's env
 * vars, same pattern as lookbooks.ts's generatePdfUploadUrl / auth.ts's
 * sendResetEmail().
 *
 * Args:
 *  - file        : raw file bytes (v.bytes() -> ArrayBuffer at the Convex
 *                  boundary).
 *  - filename    : original filename, used to build the Blob pathname.
 *  - contentType : the uploaded file's actual MIME type (video/image/pdf),
 *                  passed through to Vercel Blob instead of a hardcoded value.
 */
export const generateTemplateMediaUploadUrl = action({
  args: {
    file: v.bytes(),
    filename: v.string(),
    contentType: v.string(),
  },
  handler: async (ctx, { file, filename, contentType }) => {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw new Error(
        "[generateTemplateMediaUploadUrl] BLOB_READ_WRITE_TOKEN is not set in the Convex deployment environment.",
      );
    }

    let url: string;
    try {
      const blob = await put(filename, file, {
        access: "public",
        token,
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
