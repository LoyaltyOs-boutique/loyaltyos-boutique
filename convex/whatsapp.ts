import { action, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal, api } from "./_generated/api";
import { requireMerchantSession } from "./auth";
import type { Id } from "./_generated/dataModel";

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

// ============================================================================
// SECTION 4 — "Send All" bulk AI-drafted outreach (2026-09-22)
// Design spec: docs/superpowers/specs/2026-09-22-send-all-bulk-whatsapp-design.md
//
// PURE ADDITION — does not modify sendWhatsAppTemplateMessage/
// sendWhatsAppServiceMessage above, or any existing per-customer
// Approve & Send code path (convex/customers.ts's recordMessageAction is
// CALLED, never edited; convex/ai.ts's generateMessageDraft/
// generateCombinedMessageDraft are CALLED, never edited).
//
// This is architecture-only until a real Meta-approved WhatsApp template
// exists (D-17, blocked on Ma'am's Meta Business approval — see spec). Today,
// live Convex data has whatsapp_templates.birthday === null AND
// .anniversary === null, so this action's guard clause (step 2 below) always
// takes the graceful "no_template" early-return path and NEVER reaches the
// Graph API. It is written now so it activates immediately, with no further
// code changes, once a real template is configured.
// ============================================================================

/** One eligible tomorrow-occasion recipient, after merging birthday+anniversary hits by customer. */
interface OccasionRecipient {
  customerId: Id<"users">;
  name: string;
  mobile: string;
  tier: "silver" | "gold" | "platinum";
  /** true when this SAME customer_id appears in both tomorrow's birthday AND anniversary lists. */
  combined: boolean;
  /** Present when NOT combined — the single occasion this customer is being messaged for. */
  occasion: "birthday" | "anniversary" | null;
  /** Canonical "YYYY-M-D" occasion_date for the birthday leg (used for recordMessageAction). */
  birthdayOccasionDate: string | null;
  /** Canonical "YYYY-M-D" occasion_date for the anniversary leg (used for recordMessageAction). */
  anniversaryOccasionDate: string | null;
}

/** Per-customer outcome row returned to the merchant after a send attempt (or a skip). */
interface SendAllResult {
  customerId: Id<"users">;
  name: string;
  occasion: "birthday" | "anniversary" | "combined";
  status: "sent" | "skipped" | "failed";
  reason?: string;
}

/**
 * Merge tomorrow's birthday + anniversary hit lists (both already filtered to
 * days_until === 1 by findUpcomingInternal's `days` arg) by customer_id, so a
 * customer with BOTH occasions tomorrow becomes ONE combined recipient
 * instead of two separate sends — same "same customer, same date, both
 * occasions" idea as Customers.jsx's isCombinedToday, adapted for tomorrow's
 * date (that frontend check is `c.birthday === c.anniversary` on the MD
 * string; here we instead check "did this exact customer_id appear in both
 * already-date-filtered internal lists", which is equivalent and needs no MD
 * string comparison since findUpcomingInternal already did the date match).
 * Consent (`whatsapp_consent`) is filtered here too — non-consenting
 * customers are silently excluded, never sent to, never listed as "skipped"
 * (they were never eligible in the first place).
 */
function mergeOccasionHits(
  birthdayHits: Array<{
    _id: Id<"users">;
    name: string;
    mobile: string;
    tier: "silver" | "gold" | "platinum";
    whatsapp_consent: boolean;
    occasion_date: string;
  }>,
  anniversaryHits: Array<{
    _id: Id<"users">;
    name: string;
    mobile: string;
    tier: "silver" | "gold" | "platinum";
    whatsapp_consent: boolean;
    occasion_date: string;
  }>,
): OccasionRecipient[] {
  const byCustomer = new Map<Id<"users">, OccasionRecipient>();

  for (const b of birthdayHits) {
    if (!b.whatsapp_consent) continue;
    byCustomer.set(b._id, {
      customerId: b._id,
      name: b.name,
      mobile: b.mobile,
      tier: b.tier,
      combined: false,
      occasion: "birthday",
      birthdayOccasionDate: b.occasion_date,
      anniversaryOccasionDate: null,
    });
  }

  for (const a of anniversaryHits) {
    if (!a.whatsapp_consent) continue;
    const existing = byCustomer.get(a._id);
    if (existing) {
      // Same customer already has a tomorrow birthday hit — upgrade to combined.
      existing.combined = true;
      existing.occasion = null;
      existing.anniversaryOccasionDate = a.occasion_date;
    } else {
      byCustomer.set(a._id, {
        customerId: a._id,
        name: a.name,
        mobile: a.mobile,
        tier: a.tier,
        combined: false,
        occasion: "anniversary",
        birthdayOccasionDate: null,
        anniversaryOccasionDate: a.occasion_date,
      });
    }
  }

  return Array.from(byCustomer.values());
}

/**
 * sendAllUpcomingOccasionMessages — bulk "Send All" for tomorrow's
 * consenting birthday/anniversary customers. MERCHANT-ONLY (Merchant Session
 * Lock) — session verified via checkMerchantSession before any read or send.
 *
 * See SECTION 4 header above for the "architecture-only until a real
 * template exists" framing. Today this always resolves via the `no_template`
 * early-return (step 2) — it does not throw, and it never partially sends.
 */
export const sendAllUpcomingOccasionMessages = action({
  args: {
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, { userId, token }) => {
    await ctx.runQuery(internal.whatsapp.checkMerchantSession, { userId, token });

    // Step 1 — fetch tomorrow's (days_until === 1) birthday + anniversary
    // hits via the existing no-session internal query (same one the daily
    // AI-drafts cron already uses) — reused as-is, not duplicated.
    const [birthdayHits, anniversaryHits] = await Promise.all([
      ctx.runQuery(internal.customers.findUpcomingInternal, { days: 1, field: "birthday" }),
      ctx.runQuery(internal.customers.findUpcomingInternal, { days: 1, field: "anniversary" }),
    ]);
    const tomorrowBirthdays = birthdayHits.filter((h) => h.days_until === 1);
    const tomorrowAnniversaries = anniversaryHits.filter((h) => h.days_until === 1);

    const recipients = mergeOccasionHits(tomorrowBirthdays, tomorrowAnniversaries);

    // Step 2 — guard clause: no real Meta-approved template configured yet
    // (today's live state, D-17). Return early, gracefully — no Graph API
    // call, no partial sends, no crash. This is the only path reachable
    // today; everything below only runs once a real template exists.
    const templates = await ctx.runQuery(api.settings.getWhatsAppTemplates, { userId, token });
    const hasBirthdayTemplate = Boolean(templates?.birthday);
    const hasAnniversaryTemplate = Boolean(templates?.anniversary);
    if (!hasBirthdayTemplate && !hasAnniversaryTemplate) {
      return {
        ok: false as const,
        reason: "no_template" as const,
        sent: 0,
        skipped: 0,
        failed: 0,
        results: [] as SendAllResult[],
      };
    }

    // Step 3 — for each eligible recipient, generate their AI draft, send via
    // the Cloud API template, then record the decision. Failures are caught
    // PER-CUSTOMER so one bad send never aborts the rest of the batch.
    const results: SendAllResult[] = [];
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const r of recipients) {
      const occasionLabel: "birthday" | "anniversary" | "combined" = r.combined
        ? "combined"
        : (r.occasion as "birthday" | "anniversary");

      // Which template this recipient needs. A combined customer is sent via
      // the birthday template if configured, else the anniversary template —
      // Option 1 (see spec) puts the whole AI draft into one body param
      // regardless of which template slot carries it, so either approved
      // template works as the delivery vehicle for a combined message.
      const templateType: "birthday" | "anniversary" | null = r.combined
        ? (hasBirthdayTemplate ? "birthday" : hasAnniversaryTemplate ? "anniversary" : null)
        : r.occasion === "birthday"
          ? (hasBirthdayTemplate ? "birthday" : null)
          : (hasAnniversaryTemplate ? "anniversary" : null);

      if (!templateType) {
        // This recipient's specific occasion has no approved template yet
        // (e.g. only anniversary is approved, but this row is birthday-only).
        skipped += 1;
        results.push({ customerId: r.customerId, name: r.name, occasion: occasionLabel, status: "skipped", reason: "no_template_for_occasion" });
        continue;
      }
      const template = templateType === "birthday" ? templates.birthday : templates.anniversary;
      if (!template) {
        skipped += 1;
        results.push({ customerId: r.customerId, name: r.name, occasion: occasionLabel, status: "skipped", reason: "no_template_for_occasion" });
        continue;
      }

      try {
        // Step 3a — AI draft: combined uses the single-Gemini-call combined
        // draft, single-occasion uses the existing per-occasion draft. Both
        // are called EXACTLY as they exist today (zero changes).
        const draftText: string | null = r.combined
          ? await ctx.runAction(internal.ai.generateCombinedMessageDraft, { customerName: r.name, tier: r.tier })
          : await ctx.runAction(internal.ai.generateMessageDraft, {
              customerName: r.name,
              tier: r.tier,
              occasion: r.occasion as "birthday" | "anniversary",
            });

        if (!draftText) {
          failed += 1;
          results.push({ customerId: r.customerId, name: r.name, occasion: occasionLabel, status: "failed", reason: "draft_generation_failed" });
          continue;
        }

        // Step 3b — Cloud API send. Option 1 (spec): the full AI draft is the
        // template's sole body parameter — a placeholder assumption flagged
        // in the spec for whoever configures the real Meta template.
        await postToGraphApiViaSend(r.mobile, template.name, template.language, draftText);

        // Step 3c — record the decision(s). Combined recipients need BOTH
        // legs recorded (mirrors the Today View combined flow, which also
        // performs two recordMessageAction calls under the hood) so each
        // occasion's idempotency + tier-aware points-crediting fires exactly
        // as it does for a manual Approve & Send. recordMessageAction itself
        // is the EXACT existing, unmodified mutation — called here, not
        // edited anywhere in this diff.
        if (r.combined) {
          if (r.birthdayOccasionDate) {
            await ctx.runMutation(api.customers.recordMessageAction, {
              customer_id: r.customerId,
              occasion: "birthday",
              occasion_date: r.birthdayOccasionDate,
              action: "sent",
              channel: "cloud_api",
              userId,
              token,
            });
          }
          if (r.anniversaryOccasionDate) {
            await ctx.runMutation(api.customers.recordMessageAction, {
              customer_id: r.customerId,
              occasion: "anniversary",
              occasion_date: r.anniversaryOccasionDate,
              action: "sent",
              channel: "cloud_api",
              userId,
              token,
            });
          }
        } else {
          const occasion = r.occasion as "birthday" | "anniversary";
          const occasionDate = occasion === "birthday" ? r.birthdayOccasionDate : r.anniversaryOccasionDate;
          if (occasionDate) {
            await ctx.runMutation(api.customers.recordMessageAction, {
              customer_id: r.customerId,
              occasion,
              occasion_date: occasionDate,
              action: "sent",
              channel: "cloud_api",
              userId,
              token,
            });
          }
        }

        sent += 1;
        results.push({ customerId: r.customerId, name: r.name, occasion: occasionLabel, status: "sent" });
      } catch (err) {
        // Per-customer catch — a Graph API error, an "already decided"
        // idempotency rejection from recordMessageAction, etc. — continue to
        // the next recipient rather than aborting the whole batch.
        failed += 1;
        results.push({
          customerId: r.customerId,
          name: r.name,
          occasion: occasionLabel,
          status: "failed",
          reason: err instanceof Error ? err.message : "unknown_error",
        });
      }
    }

    return { ok: true as const, sentCount: sent, skippedCount: skipped, failedCount: failed, sent, skipped, failed, results };
  },
});

/**
 * Thin internal helper so sendAllUpcomingOccasionMessages can reuse the exact
 * postToGraphApi/toWaPhone plumbing sendWhatsAppTemplateMessage already uses,
 * without duplicating the fetch/try-catch shape. NOT exported as a Convex
 * function — a plain in-module async helper, called directly (no
 * ctx.runAction indirection needed since it lives in this same file and
 * shares module scope with postToGraphApi/toWaPhone/GRAPH_API_VERSION).
 */
async function postToGraphApiViaSend(
  to: string,
  templateName: string,
  languageCode: string,
  draftText: string,
): Promise<{ ok: true; messageId: string }> {
  // Secrets are re-read here (not passed in) — same "read inside the handler,
  // never module scope" discipline as sendWhatsAppTemplateMessage above.
  const waAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!waAccessToken) {
    throw new Error("[sendAllUpcomingOccasionMessages] WHATSAPP_ACCESS_TOKEN is not set in the Convex deployment environment.");
  }
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    throw new Error("[sendAllUpcomingOccasionMessages] WHATSAPP_PHONE_NUMBER_ID is not set in the Convex deployment environment.");
  }

  const normalizedTo = toWaPhone(to);
  const components: TemplateComponent[] = [
    { type: "body", parameters: [{ type: "text", text: draftText }] },
  ];
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizedTo,
    type: "template",
    template: { name: templateName, language: { code: languageCode }, components },
  };

  return postToGraphApi(phoneNumberId, waAccessToken, body, "sendAllUpcomingOccasionMessages");
}
