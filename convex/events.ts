import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal, api } from "./_generated/api";
import { requireMerchantSession } from "./auth";
import { callGemini } from "./ai";

/**
 * LoyaltyOS Boutique — Phase 5 (Feature C): Virtual Events + VVIP
 * Design spec: docs/superpowers/specs/2026-09-04-phase5-virtual-events-vvip-design.md
 * Architecture spec: docs/superpowers/specs/2026-09-03-ai-automation-architecture-design.md §4, §7
 *
 * BACKEND ONLY (this file). The Campaigns.jsx "Event Setter" UI and the
 * Onboarding.jsx VVIP checkbox are separate, later tasks (design doc (c)/(d)).
 *
 * Six functions, per the design doc:
 *  - createEvent / getEvents / deleteEvent — merchant-guarded CRUD, same
 *    requireMerchantSession(userId, token) pattern as customers.ts/lookbooks.ts.
 *  - generateEventDraft — internal action, reuses ai.ts's callGemini. Prompt
 *    built ONLY from event title/designer/description — structurally cannot
 *    see customer data because it never fetches a customer doc at all.
 *  - dispatchEvent — merchant-guarded ACTION (not a mutation: it must call
 *    into convex/whatsapp.ts's send actions, and actions can only be invoked
 *    via ctx.runAction from another action, never from a mutation). Uses the
 *    new by_role_consent_vvip compound index for a pure indexed recipient
 *    read — no full-table scan, no in-memory filter over the whole customer
 *    base (design doc (g), Option 2).
 *  - getEventAccess — public query, mirrors validateMagicToken's exact
 *    now/expiry-verdict split (auth.ts:261-284): server always computes the
 *    unlock verdict itself, client only ever supplies a clock reading.
 *
 * "Nothing auto-sends" (design doc (e)): dispatchEvent only ever runs when a
 * merchant explicitly calls it (via the future Dispatch Event button). The
 * event_datetime - 5min lock in getEventAccess controls only WHEN an
 * already-sent link becomes OPENABLE, never WHEN it is sent. These two
 * mechanisms are fully independent and must never be conflated.
 */

type EventDoc = import("./_generated/dataModel").Doc<"events">;

/** Merchant/public view of an event doc — currently identical (no secrets on this table). */
function toEventView(doc: EventDoc) {
  return {
    _id: doc._id,
    id: String(doc._id),
    designer_name: doc.designer_name,
    event_datetime: doc.event_datetime,
    vvip_only: doc.vvip_only,
    description: doc.description,
    draft_text: doc.draft_text ?? null,
    status: doc.status,
    created_at: doc.created_at,
  };
}

// ============================================================================
// SECTION 1 — Merchant-guarded CRUD (createEvent / getEvents / deleteEvent)
// ============================================================================

/**
 * Create a draft event. MERCHANT-ONLY. Always starts life as status:"draft" —
 * dispatchEvent is the only path that flips it to "dispatched", and only on
 * an explicit merchant click (design doc (e), "nothing auto-sends").
 */
export const createEvent = mutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    designer_name: v.string(),
    event_datetime: v.number(),
    vvip_only: v.boolean(),
    description: v.string(),
    draft_text: v.optional(v.string()),
  },
  handler: async (ctx, { userId, token, designer_name, event_datetime, vvip_only, description, draft_text }) => {
    await requireMerchantSession(ctx, userId, token);

    const id = await ctx.db.insert("events", {
      designer_name: designer_name.trim(),
      event_datetime,
      vvip_only,
      description: description.trim(),
      draft_text: draft_text?.trim() || undefined,
      status: "draft",
      created_at: Date.now(),
    });
    const doc = await ctx.db.get(id);
    return doc ? toEventView(doc) : null;
  },
});

/**
 * List events, soonest-first. MERCHANT-ONLY.
 *
 * Reads via the by_event_datetime index (order("asc") on the range field) —
 * NEVER a full .collect() over the whole table, matching design doc (a)/(g)'s
 * "no full-table scans" constraint. events is expected to stay a small table
 * (one row per virtual event, not per customer), so a plain range index with
 * no equality prefix is sufficient here (see schema.ts's by_event_datetime
 * comment for why this differs from the users table's role-prefixed indexes).
 */
export const getEvents = query({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const events = await ctx.db
      .query("events")
      .withIndex("by_event_datetime")
      .order("asc")
      .collect();
    return events.map(toEventView);
  },
});

/** Delete an event. MERCHANT-ONLY. No cascade needed — events own no child rows. */
export const deleteEvent = mutation({
  args: { userId: v.id("users"), token: v.string(), id: v.id("events") },
  handler: async (ctx, { userId, token, id }) => {
    await requireMerchantSession(ctx, userId, token);
    await ctx.db.delete(id);
  },
});

// ============================================================================
// SECTION 2 — generateEventDraft (Gemini, confidentiality-boundary precedent)
// ============================================================================

/**
 * Internal read of ONE event's title/designer/description fields — the ONLY
 * data generateEventDraft is allowed to see. Deliberately narrow (not a full
 * ctx.db.get(eventId) inline in the action) so the confidentiality boundary
 * is structural: this internalQuery has no way to return a customer document
 * even if someone tried to widen the projection later, because it only ever
 * queries the `events` table, which has no customer fields at all.
 */
export const getEventPromptFieldsInternal = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const doc = await ctx.db.get(eventId);
    if (!doc) return null;
    return {
      designer_name: doc.designer_name,
      description: doc.description,
    };
  },
});

/**
 * Cleanup (follow-up task): the design doc says generateEventDraft "Reuses
 * the Phase 2 callGemini shared helper from convex/ai.ts verbatim." An
 * earlier version of this file could not import callGemini because it was
 * module-private in ai.ts, so it carried a byte-for-byte duplicate
 * (callGeminiForEvents) as a temporary workaround. ai.ts's callGemini is now
 * exported (visibility-only change, no logic change), so that duplicate has
 * been removed and generateEventDraft below calls the real shared helper
 * imported at the top of this file.
 */

/**
 * generateEventDraft — Phase 5 equivalent of ai.ts's generateMessageDraft.
 * Builds a Gemini prompt from event title/designer_name/description ONLY.
 *
 * CONFIDENTIALITY: this function never fetches a customer document — it only
 * reads event fields via getEventPromptFieldsInternal above, which itself
 * cannot return measurements/staff_notes because it queries the `events`
 * table, not `users`. This is a STRUCTURAL guarantee (no customer-data read
 * path exists in this function at all), not just a coding convention — same
 * confidentiality boundary already established in Phase 1's
 * getCustomerIntelligenceProfile (confidential fields excluded from the
 * returned profile) and Phase 3's generateMessageDraft (drafts built from
 * non-confidential context only).
 *
 * eventTitle is accepted as a plain string arg (not stored on the events
 * table — the design doc's events schema has no separate "title" field,
 * only designer_name + description) so the merchant's in-progress Event
 * Setter form (title input, not yet persisted before the draft is
 * generated) can pass it straight through without an extra save round-trip.
 *
 * Returns null on ANY failure — never throws — matching Phase 2/3's
 * established fail-gracefully contract for callGemini callers, so a missing
 * GEMINI_API_KEY (or any Gemini failure) never blocks the merchant from
 * typing the message manually.
 */
export const generateEventDraft = internalAction({
  args: {
    eventId: v.id("events"),
    eventTitle: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, eventTitle }): Promise<string | null> => {
    const fields = await ctx.runQuery(internal.events.getEventPromptFieldsInternal, { eventId });
    if (!fields) return null;

    const titleLine = eventTitle?.trim() ? `titled "${eventTitle.trim()}"` : "";

    const prompt = [
      `You are writing a short, warm WhatsApp invitation message on behalf of "85 Lansdowne", a luxury fashion boutique in Kolkata.`,
      `The message announces an upcoming virtual event ${titleLine} with designer ${fields.designer_name}.`,
      `Event description: ${fields.description}`,
      `Write a warm, on-brand, exciting invitation (2-4 sentences, luxury tone, no emoji overload, not generic/spammy). Mention the designer's name naturally.`,
      `Return ONLY the message text — no preamble, no quotation marks, no explanation.`,
    ]
      .filter(Boolean)
      .join(" ");

    const result = await callGemini(prompt);
    if (!result.success) return null;

    const trimmed = result.text.trim();
    if (!trimmed) return null;
    return trimmed;
  },
});

/**
 * generateEventDraftPublic — thin public entry point in front of
 * generateEventDraft (internalAction, above). Internal Convex functions are
 * never exposed on the generated `api.*` surface, so the frontend has no way
 * to invoke generateEventDraft directly — this wrapper is the fix.
 *
 * Mirrors dispatchEvent's own shape exactly (session-guard-then-delegate):
 *  1. ctx.runQuery(internal.events.checkMerchantSession, ...) — SAME guard
 *     dispatchEvent uses below, actions have no ctx.db so the guard is
 *     wrapped in an internalQuery (see checkMerchantSession's own comment).
 *  2. ctx.runAction(internal.events.generateEventDraft, ...) — delegates to
 *     the existing, already-built-and-tested internal action verbatim. No
 *     logic duplicated, no behavior changed — this wrapper only adds the
 *     merchant-session check in front of it and forwards the result.
 */
export const generateEventDraftPublic = action({
  args: {
    userId: v.id("users"),
    token: v.string(),
    eventId: v.id("events"),
    eventTitle: v.optional(v.string()),
  },
  handler: async (ctx, { userId, token, eventId, eventTitle }): Promise<string | null> => {
    await ctx.runQuery(internal.events.checkMerchantSession, { userId, token });
    return await ctx.runAction(internal.events.generateEventDraft, { eventId, eventTitle });
  },
});

// ============================================================================
// SECTION 3 — dispatchEvent (merchant-guarded ACTION)
// ============================================================================

/**
 * Merchant Session Lock helper — actions have no ctx.db, so
 * requireMerchantSession (which needs ctx.db.get) is wrapped in an
 * internalQuery and invoked via ctx.runQuery, the SAME pattern already used
 * by ai.ts's checkMerchantSession and whatsapp.ts's checkMerchantSession.
 * A local copy (not a shared cross-file export) matches this codebase's
 * existing convention of one checkMerchantSession per file that needs it.
 */
export const checkMerchantSession = internalQuery({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    return null;
  },
});

/**
 * Internal, indexed recipient read for dispatchEvent. Reads via the new
 * by_role_consent_vvip compound index (schema.ts) — role first (matches the
 * by_role_birthday_md / by_role_anniversary_md precedent), then
 * whatsapp_consent (always constrained), then vvip (constrained ONLY when
 * the event is vvip_only). Convex compound indexes support querying any
 * leading prefix, so the non-VVIP path (role, whatsapp_consent) and the VVIP
 * path (role, whatsapp_consent, vvip) are BOTH pure indexed equality reads —
 * no in-memory filter step, no full-table scan (design doc (g), Option 2).
 */
export const getDispatchRecipientsInternal = internalQuery({
  args: { vvipOnly: v.boolean() },
  handler: async (ctx, { vvipOnly }) => {
    const recipients = vvipOnly
      ? await ctx.db
          .query("users")
          .withIndex("by_role_consent_vvip", (q) =>
            q.eq("role", "customer").eq("whatsapp_consent", true).eq("vvip", true),
          )
          .collect()
      : await ctx.db
          .query("users")
          .withIndex("by_role_consent_vvip", (q) =>
            q.eq("role", "customer").eq("whatsapp_consent", true),
          )
          .collect();
    // Only the fields dispatchEvent needs to send a WhatsApp message —
    // never the full user doc (no measurements/staff_notes/auth secrets).
    return recipients.map((r) => ({ _id: r._id, mobile: r.mobile, name: r.name }));
  },
});

/** Internal mutation — flips an event's status to "dispatched" after send completes. */
export const markEventDispatchedInternal = internalMutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await ctx.db.patch(eventId, { status: "dispatched" });
  },
});

/**
 * dispatchEvent — merchant-guarded ACTION, triggered ONLY by an explicit
 * merchant click on the future "Dispatch Event" button (design doc (c)/(e)).
 * No cron, no time trigger, no automation of any kind sends on its own.
 *
 * Recipient set: EXACTLY
 *   role === "customer" && whatsapp_consent === true
 *   [&& vvip === true, only when the event's vvip_only === true]
 * fetched via ONE indexed query (getDispatchRecipientsInternal above) — no
 * full customer-table scan, no in-memory filter over the whole base.
 *
 * WhatsApp send: reuses whatsapp.ts's sendWhatsAppServiceMessage (free-form
 * text service message), NOT sendWhatsAppTemplateMessage. Justification:
 * sendWhatsAppTemplateMessage requires a pre-approved Meta template name +
 * language code registered in WhatsApp Manager ahead of time — appropriate
 * for the fixed birthday/anniversary Templates.jsx cards, but an event's
 * draft_text is free-form, per-event, merchant-edited-or-AI-generated
 * content with no matching approved template. sendWhatsAppServiceMessage's
 * type:"text" shape is structurally the right fit (arbitrary body text) and
 * is the same choice the design doc left open ("pick whichever is
 * structurally appropriate"). Per whatsapp.ts's own doc comment, a
 * service message additionally requires an open 24h customer-service
 * window; if Meta rejects a given recipient for that reason, THIS action
 * catches that per-recipient failure (see try/catch below) and continues
 * dispatching to the rest of the recipient set rather than aborting the
 * whole batch — the event is still marked "dispatched" once the loop
 * completes, with per-recipient results returned to the caller.
 *
 * Marks the event status:"dispatched" once the send loop completes
 * (regardless of individual per-recipient failures — see above), so retried
 * dispatches remain visible to the merchant as already-attempted.
 */
export const dispatchEvent = action({
  args: {
    userId: v.id("users"),
    token: v.string(),
    eventId: v.id("events"),
  },
  handler: async (ctx, { userId, token, eventId }) => {
    await ctx.runQuery(internal.events.checkMerchantSession, { userId, token });

    const event = await ctx.runQuery(internal.events.getEventForDispatchInternal, { eventId });
    if (!event) throw new Error("Event not found.");

    const messageText = (event.draft_text ?? "").trim();
    if (!messageText) {
      throw new Error("Event has no message text to send — add a draft before dispatching.");
    }

    const recipients = await ctx.runQuery(internal.events.getDispatchRecipientsInternal, {
      vvipOnly: event.vvip_only,
    });

    const results: { customerId: string; ok: boolean; error?: string }[] = [];
    for (const recipient of recipients) {
      try {
        // Reuses the existing guarded WhatsApp send flow verbatim — this
        // action is itself already merchant-verified (checkMerchantSession
        // above), so we pass the SAME userId/token through to satisfy
        // sendWhatsAppServiceMessage's own requireMerchantSession guard
        // (whatsapp.ts is not modified; its existing session check still runs).
        await ctx.runAction(api.whatsapp.sendWhatsAppServiceMessage, {
          userId,
          token,
          to: recipient.mobile,
          type: "text",
          text: messageText,
        });
        results.push({ customerId: String(recipient._id), ok: true });
      } catch (err) {
        // Per-recipient failure (e.g. no open 24h service window) must not
        // abort the whole dispatch batch — log and continue to the next
        // recipient, matching the "best-effort broadcast" shape expected of
        // a merchant-facing bulk send.
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[dispatchEvent] send failed for ${recipient._id}:`, reason);
        results.push({ customerId: String(recipient._id), ok: false, error: reason });
      }
    }

    await ctx.runMutation(internal.events.markEventDispatchedInternal, { eventId });

    return {
      eventId: String(eventId),
      recipientCount: recipients.length,
      sentCount: results.filter((r) => r.ok).length,
      results,
    };
  },
});

/** Internal — fetch one event's full doc for dispatchEvent's own use (actions have no ctx.db). */
export const getEventForDispatchInternal = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const doc = await ctx.db.get(eventId);
    return doc ?? null;
  },
});

// ============================================================================
// SECTION 4 — getEventAccess (public query, validateMagicToken precedent)
// ============================================================================

/**
 * getEventAccess — public query, mirrors auth.ts's validateMagicToken
 * (lines 261-284) exactly: an optional client-supplied `now` (epoch ms) is
 * accepted for the SAME reason validateMagicToken accepts one — "the client
 * can refresh the clock — queries must not read the wall clock (reactive-
 * cache guideline)." The unlock VERDICT is always computed server-side from
 * the stored event_datetime; the client only ever supplies a clock reading,
 * NEVER a trusted "is it unlocked" boolean — same now/expiry-verdict split
 * as validateMagicToken's nowMs/expiresAt check.
 *
 * Lock window: unlocked once nowMs >= event_datetime - 5*60_000 (5 minutes
 * before the event). This controls ONLY when an already-dispatched link
 * becomes openable — it has no bearing on whether/when dispatchEvent runs
 * (design doc (e)).
 *
 * customerId is accepted (per the design doc's signature) so a future
 * VVIP-gate check could be layered on here without changing the call shape;
 * Phase 5 does not add a per-customer VVIP re-check on this read path
 * because dispatchEvent already restricted WHO received the link in the
 * first place — same trust model as validateMagicToken, which does not
 * re-derive eligibility, only validates the token/expiry it already issued.
 */
export const getEventAccess = query({
  args: {
    customerId: v.id("users"),
    eventId: v.id("events"),
    now: v.optional(v.number()),
  },
  handler: async (ctx, { customerId, eventId, now }) => {
    const event = await ctx.db.get(eventId);
    if (!event) return null;

    const customer = await ctx.db.get(customerId);
    if (!customer || customer.role !== "customer") return null;

    const nowMs = now ?? Date.now();
    const unlocked = nowMs >= event.event_datetime - 5 * 60_000;

    if (!unlocked) {
      return { status: "locked" as const, event_datetime: event.event_datetime };
    }

    return {
      status: "unlocked" as const,
      event: toEventView(event),
    };
  },
});
