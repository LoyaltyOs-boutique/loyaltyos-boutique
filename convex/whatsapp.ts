import { action, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireMerchantSession } from "./auth";

/**
 * WhatsApp Cloud API integration — Templates section (server-side send).
 * Design spec: docs/superpowers/specs/2026-08-24-whatsapp-cloud-api-design.md
 *
 * Same env-secret / guard-clause / try-catch shape as convex/templates.ts's
 * generateTemplateMediaUploadUrl (BLOB_READ_WRITE_TOKEN pattern) — secrets are
 * read from process.env INSIDE each handler (never module scope) so a missing
 * credential fails loudly and safely at call time, not at deploy time.
 *
 * Credentials (Convex env vars, set later via `npx convex env set`, never
 * committed):
 *  - WHATSAPP_ACCESS_TOKEN     — permanent System User access token
 *  - WHATSAPP_PHONE_NUMBER_ID  — business phone number ID
 *
 * Until those are set, both actions below throw a clear guard-clause error.
 * The frontend (Templates.jsx) catches that and falls through to the
 * existing wa.me link-open — merchants are never blocked (Decision 3 of the
 * design spec).
 */

// ============================================================================
// SECTION 1 — Shared helpers
// ============================================================================

/** Graph API version — pinned to a stable dated release, not "latest". */
const GRAPH_API_VERSION = "v23.0";

/**
 * Normalize a bare/typed mobile number to WhatsApp's expected "91XXXXXXXXXX"
 * format. Exact same transform as Templates.jsx's toWaPhone, relocated here
 * so the server-side send path doesn't depend on the frontend running it
 * first (defense in depth — callers may pass either a bare 10-digit number
 * or one that already has the 91 prefix).
 */
function toWaPhone(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.startsWith("91") ? digits : `91${digits}`;
}

/** Shape of a component in a WhatsApp template-message payload. */
type TemplateComponent =
  | { type: "header"; parameters: [{ type: "image"; image: { link: string } }] }
  | { type: "body"; parameters: { type: "text"; text: string }[] };

/**
 * POST a message payload to the Graph API's /messages endpoint and normalize
 * the result to { ok: true, messageId } or a thrown, user-facing Error.
 * Shared by both actions below so the fetch/try-catch/log shape is defined
 * exactly once.
 */
async function postToGraphApi(
  phoneNumberId: string,
  token: string,
  body: Record<string, unknown>,
  actionLabel: string,
): Promise<{ ok: true; messageId: string }> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      // Log Meta's structured error body for debugging — NEVER log the
      // Authorization header or token itself.
      console.error(`[${actionLabel}] WhatsApp Graph API error response:`, data);
      throw new Error("Failed to send WhatsApp message. Please try again.");
    }

    const messageId = data?.messages?.[0]?.id;
    return { ok: true, messageId };
  } catch (err) {
    // Re-thrown Errors above already carry the clean user-facing message —
    // avoid double-wrapping. Only network/parse failures fall through here.
    if (err instanceof Error && err.message === "Failed to send WhatsApp message. Please try again.") {
      throw err;
    }
    console.error(`[${actionLabel}] WhatsApp send failed:`, err instanceof Error ? err.message : String(err));
    throw new Error("Failed to send WhatsApp message. Please try again.");
  }
}

// ============================================================================
// SECTION 2 — Merchant Session Lock helper
// ============================================================================

/**
 * Merchant Session Lock (2026-09-01) — internal helper shared by both actions
 * below. Actions have no ctx.db, so requireMerchantSession (which needs
 * ctx.db.get) cannot be called directly from an action — it is wrapped in
 * this internalQuery and invoked via ctx.runQuery, mirroring the identical
 * checkMerchantSession pattern already used in convex/lookbooks.ts
 * (generatePdfUploadUrl) and convex/templates.ts (generateTemplateMediaUploadUrl)
 * for the same reason. One shared internalQuery here serves both
 * sendWhatsAppTemplateMessage and sendWhatsAppServiceMessage — no need to
 * duplicate it per-function.
 * Throws (via requireMerchantSession) rather than returning a boolean, so the
 * action's runQuery call rejects and the action never proceeds to the
 * WhatsApp Graph API call for an unauthenticated/expired caller.
 */
export const checkMerchantSession = internalQuery({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    return null;
  },
});

// ============================================================================
// SECTION 3 — Actions
// ============================================================================

/**
 * Send a pre-approved WhatsApp template message (required for first-contact
 * outreach). Used by Templates.jsx's MomentCard (Anniversary/Birthday cards)
 * once a real template has been created & approved in WhatsApp Manager.
 *
 * MERCHANT-ONLY (Merchant Session Lock, 2026-09-01) — session is verified via
 * checkMerchantSession (see above) before any Graph API call.
 *
 * Args:
 *  - userId, token : merchant session credentials, verified before any
 *                     WhatsApp send happens.
 *  - to           : bare 10-digit customer mobile (or already-prefixed; both
 *                    normalized via toWaPhone).
 *  - templateName : the approved template's name in WhatsApp Manager.
 *  - languageCode : the approved template's language code (e.g. "en").
 *  - imageUrl     : optional card image — sent as the template's image
 *                    header component when provided.
 *  - bodyParams   : optional ordered list of text values filling the
 *                    template's body placeholders (e.g. [name, nickname]).
 */
export const sendWhatsAppTemplateMessage = action({
  args: {
    userId: v.id("users"),
    token: v.string(),
    to: v.string(),
    templateName: v.string(),
    languageCode: v.string(),
    imageUrl: v.optional(v.string()),
    bodyParams: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { userId, token, to, templateName, languageCode, imageUrl, bodyParams }) => {
    await ctx.runQuery(internal.whatsapp.checkMerchantSession, { userId, token });

    // Guard-clauses — read secrets inside the handler, fail clearly if unset.
    // Renamed from `token` to `waAccessToken` — the merchant session arg above
    // already owns the name `token` in this scope (same collision + same fix
    // as generateTemplateMediaUploadUrl's BLOB_READ_WRITE_TOKEN var rename to
    // `blobToken` in convex/templates.ts).
    const waAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!waAccessToken) {
      throw new Error(
        "[sendWhatsAppTemplateMessage] WHATSAPP_ACCESS_TOKEN is not set in the Convex deployment environment.",
      );
    }
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!phoneNumberId) {
      throw new Error(
        "[sendWhatsAppTemplateMessage] WHATSAPP_PHONE_NUMBER_ID is not set in the Convex deployment environment.",
      );
    }

    const normalizedTo = toWaPhone(to);

    // Build components array per Meta's official template-message syntax —
    // image header only if provided, body text params only if non-empty.
    const components: TemplateComponent[] = [];
    if (imageUrl) {
      components.push({
        type: "header",
        parameters: [{ type: "image", image: { link: imageUrl } }],
      });
    }
    if (bodyParams && bodyParams.length > 0) {
      components.push({
        type: "body",
        parameters: bodyParams.map((text) => ({ type: "text" as const, text })),
      });
    }

    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedTo,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    };

    return postToGraphApi(phoneNumberId, waAccessToken, body, "sendWhatsAppTemplateMessage");
  },
});

/**
 * Send a free-form service message — only valid inside an open 24-hour
 * customer service window. Used by Templates.jsx's MediaCard (Card 3).
 *
 * MERCHANT-ONLY (Merchant Session Lock, 2026-09-01) — session is verified via
 * checkMerchantSession (see above) before any Graph API call.
 *
 * Decision 1 (design spec): no session-window tracking is implemented here.
 * The action is simply called; if Meta rejects because no window is open,
 * that rejection surfaces as a normal try/catch failure and the frontend
 * falls back to the wa.me link — no new infrastructure needed.
 *
 * Args:
 *  - userId, token : merchant session credentials, verified before any
 *                     WhatsApp send happens.
 *  - to       : bare 10-digit customer mobile (or already-prefixed).
 *  - type     : "text" | "image" — which service-message shape to send.
 *  - text     : message body, required when type === "text".
 *  - imageUrl : image link, required when type === "image".
 */
export const sendWhatsAppServiceMessage = action({
  args: {
    userId: v.id("users"),
    token: v.string(),
    to: v.string(),
    type: v.union(v.literal("text"), v.literal("image")),
    text: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, { userId, token, to, type, text, imageUrl }) => {
    await ctx.runQuery(internal.whatsapp.checkMerchantSession, { userId, token });

    // Same secret-reading/guard-clause pattern as sendWhatsAppTemplateMessage.
    // Renamed from `token` to `waAccessToken` — same collision + fix as above.
    const waAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!waAccessToken) {
      throw new Error(
        "[sendWhatsAppServiceMessage] WHATSAPP_ACCESS_TOKEN is not set in the Convex deployment environment.",
      );
    }
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!phoneNumberId) {
      throw new Error(
        "[sendWhatsAppServiceMessage] WHATSAPP_PHONE_NUMBER_ID is not set in the Convex deployment environment.",
      );
    }

    const normalizedTo = toWaPhone(to);

    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedTo,
      type,
    };
    if (type === "text") {
      body.text = { body: text };
    } else {
      body.image = { link: imageUrl };
    }

    return postToGraphApi(phoneNumberId, waAccessToken, body, "sendWhatsAppServiceMessage");
  },
});
