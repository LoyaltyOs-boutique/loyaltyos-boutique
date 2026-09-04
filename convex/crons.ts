import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";

/**
 * LoyaltyOS Boutique — Daily AI WhatsApp draft-generation cron (Phase 3, Feature A).
 * Design spec: docs/superpowers/specs/2026-09-04-phase3-whatsapp-ai-drafts-design.md
 * Architecture spec: docs/superpowers/specs/2026-09-03-ai-automation-architecture-design.md §2, §7
 *
 * SCOPE (Option 3 — draft-creation only, per design doc §c): this cron's
 * responsibility ends at writing rows into `ai_message_drafts` with
 * status:"pending". It has ZERO access to sendWhatsAppTemplateMessage or
 * recordMessageAction (convex/whatsapp.ts / convex/customers.ts) — neither is
 * imported or called anywhere in this file. The ApprovalModal UI / actual
 * send-wiring is a deferred, separate task (design doc §c is not decided
 * yet). This mirrors the architecture spec's own stated boundary
 * ("this job only writes drafts").
 *
 * CRON SYNTAX — pinned per this project's own guidelines file
 * (convex/_generated/ai/guidelines.md:372-396, "Cron guidelines"):
 *   "Only use the `crons.interval` or `crons.cron` methods to schedule cron
 *    jobs. Do NOT use the `crons.hourly`, `crons.daily`, or `crons.weekly`
 *    helpers." — so this file uses `crons.interval(name, { hours: 24 }, ...)`,
 *    never `crons.daily()`, and registers via the same top-level
 *    `cronJobs()` -> `.interval(...)` -> `export default crons` shape as the
 *    guidelines' own worked example (guidelines.md:378-396).
 */

// ============================================================================
// SECTION 1 — Pacing helper (scalability §7: batched, rate-limited AI calls)
// ============================================================================

/**
 * Small fixed delay between sequential Gemini calls inside one cron run.
 *
 * JUDGMENT CALL (documented per this task's report requirement): the design
 * doc's §7 leaves the exact pacing mechanism to implementation-time judgment
 * ("a fixed maximum number of generateMessageDraft calls per cron
 * invocation... with pacing between calls... e.g. ctx.scheduler staggered
 * follow-up runs, or an in-action delay loop"). This cron uses the simplest
 * idiomatic option for a Convex action calling an external API in a
 * sequential loop: a plain `await new Promise(setTimeout)` between calls,
 * rather than a fan-out via ctx.scheduler (which would need its own
 * coordination/aggregation step to know when the whole batch is done, adding
 * complexity this single-daily-run job doesn't need) or firing all calls
 * concurrently (which is exactly the "unbounded tight loop" the scalability
 * principle forbids — concurrent calls would spike Gemini's per-second rate
 * and this cron's own latency/cost together as customer count grows).
 * A short, fixed 500ms gap keeps per-run latency predictable (bounded by
 * batch size × delay) while trivially staying under any reasonable per-key
 * Gemini rate limit.
 */
const GEMINI_CALL_DELAY_MS = 500;

/**
 * Hard cap on how many Gemini calls this cron makes in a single run.
 *
 * JUDGMENT CALL: per §7 ("a fixed maximum number of generateMessageDraft
 * calls per cron invocation"), rather than looping over an unbounded
 * eligible-customer list. 50/day comfortably covers 85 Lansdowne's current
 * and near-term customer base (birthdays+anniversaries landing on any single
 * day are a small fraction of the total customer count) while keeping this
 * daily job's worst-case latency and Gemini spend flat and predictable even
 * as the customer base grows toward the 1000+ figure cited in the
 * architecture spec. Any customers beyond the cap on an unusually large day
 * simply don't get a draft generated that run; the cron's duplicate-check
 * (hasExistingDraft) makes this safe/idempotent — they're picked up on the
 * next daily run while still eligible (days_until would only be 0 or 1 for
 * a 1-day window, so in practice this cap is a generous ceiling, not a
 * routine bottleneck).
 */
const MAX_DRAFTS_PER_RUN = 50;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// SECTION 2 — DB helpers (actions have no ctx.db — wrapped as internal query/mutation)
// ============================================================================

/**
 * Duplicate-prevention check — does a non-discarded draft already exist for
 * this exact (customer_id, occasion, occasion_date) tuple? Queried via the
 * by_customer_occasion_date index (schema.ts), mirroring customers.ts's
 * hasDecidedAction pattern for message_actions.
 *
 * "discarded" rows do NOT count as existing — a merchant explicitly
 * discarding a draft (later task, not built yet) should allow the cron to
 * try again on a future run, not permanently block regeneration for that
 * tuple. Today the cron only ever writes "pending", so in practice this
 * checks for a "pending" row, but the discarded-excluded semantics are
 * correct for the eventual send-wiring task too.
 */
export const hasExistingDraft = internalQuery({
  args: {
    customerId: v.id("users"),
    occasion: v.union(v.literal("birthday"), v.literal("anniversary")),
    occasionDate: v.string(),
  },
  handler: async (ctx, { customerId, occasion, occasionDate }) => {
    const rows = await ctx.db
      .query("ai_message_drafts")
      .withIndex("by_customer_occasion_date", (q) =>
        q.eq("customer_id", customerId).eq("occasion", occasion).eq("occasion_date", occasionDate),
      )
      .collect();
    return rows.some((r) => r.status !== "discarded");
  },
});

/** Insert a new pending draft row — the cron's only write to ai_message_drafts. */
export const insertDraft = internalMutation({
  args: {
    customerId: v.id("users"),
    occasion: v.union(v.literal("birthday"), v.literal("anniversary")),
    occasionDate: v.string(),
    draftText: v.string(),
  },
  handler: async (ctx, { customerId, occasion, occasionDate, draftText }) => {
    await ctx.db.insert("ai_message_drafts", {
      customer_id: customerId,
      occasion,
      occasion_date: occasionDate,
      draft_text: draftText,
      generated_at: Date.now(),
      status: "pending",
    });
  },
});

// ============================================================================
// SECTION 3 — generateDailyDrafts (the cron's internal action)
// ============================================================================

type EligibleCustomer = {
  _id: import("./_generated/dataModel").Id<"users">;
  name: string;
  tier: "silver" | "gold" | "platinum";
  whatsapp_consent: boolean;
  days_until: number;
  occasion_date: string | null;
};

/**
 * generateDailyDrafts — the cron's body. Runs once per day (see SECTION 4).
 *
 * Steps (per design doc §b):
 *   1. Fetch tomorrow's (days: 1) birthday + anniversary candidates via the
 *      internal-query variant in customers.ts (indexed reads only — no
 *      full-table scan, reusing the SAME findUpcoming() the public
 *      Delight Queue queries use).
 *   2. Filter to whatsapp_consent === true BEFORE any Gemini call — a
 *      customer who hasn't opted in must never have their name/tier/occasion
 *      sent to Gemini at all, not just never receive a send.
 *   3. Filter out any customer who already has a pending/used draft for this
 *      exact (customer_id, occasion, occasion_date) tuple — via the new
 *      by_customer_occasion_date index — so re-running the cron never
 *      produces a duplicate row.
 *   4. For each remaining eligible customer (capped + paced, see SECTION 1):
 *      call generateMessageDraft; on non-null text, insert a new
 *      ai_message_drafts row with status:"pending".
 */
export const generateDailyDrafts = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scanned: number; eligible: number; drafted: number }> => {
    // Step 1 — indexed, tomorrow-only candidate fetch (matches the existing
    // "tomorrow" tabs' window in Customers.jsx: days_until === 1).
    const [birthdayHits, anniversaryHits] = await Promise.all([
      ctx.runQuery(internal.customers.findUpcomingInternal, { days: 1, field: "birthday" }),
      ctx.runQuery(internal.customers.findUpcomingInternal, { days: 1, field: "anniversary" }),
    ]);

    const candidates: Array<{ hit: EligibleCustomer; occasion: "birthday" | "anniversary" }> = [
      ...birthdayHits.map((h) => ({ hit: h as EligibleCustomer, occasion: "birthday" as const })),
      ...anniversaryHits.map((h) => ({ hit: h as EligibleCustomer, occasion: "anniversary" as const })),
    ].filter(({ hit }) => hit.days_until === 1);

    let eligibleCount = 0;
    let draftedCount = 0;

    for (const { hit, occasion } of candidates) {
      // Step 2 — consent gate BEFORE any Gemini call. A customer without
      // whatsapp_consent is skipped here, before generateMessageDraft is
      // ever invoked for them — no Gemini call is attempted.
      if (hit.whatsapp_consent !== true) continue;
      if (!hit.occasion_date) continue; // defensive — should never happen, see findUpcomingInternal's comment

      eligibleCount += 1;

      // Step 3 — duplicate-prevention via the by_customer_occasion_date
      // index: skip if a draft already exists for this exact tuple, so
      // re-running the cron never regenerates/duplicates.
      const alreadyHasDraft = await ctx.runQuery(internal.crons.hasExistingDraft, {
        customerId: hit._id,
        occasion,
        occasionDate: hit.occasion_date,
      });
      if (alreadyHasDraft) continue;

      // Step 4 — cap: stop generating new drafts once this run's batch limit
      // is reached, per §7's "capped batch per run" scalability principle
      // (eligibility is still counted above, for observability).
      if (draftedCount >= MAX_DRAFTS_PER_RUN) continue;

      const draftText: string | null = await ctx.runAction(internal.ai.generateMessageDraft, {
        customerName: hit.name,
        tier: hit.tier,
        occasion,
      });

      if (draftText) {
        await ctx.runMutation(internal.crons.insertDraft, {
          customerId: hit._id,
          occasion,
          occasionDate: hit.occasion_date,
          draftText,
        });
        draftedCount += 1;
      }

      // Pacing — sequential, spaced-out Gemini calls (see SECTION 1's
      // documented judgment call), not a tight concurrent/back-to-back loop.
      await delay(GEMINI_CALL_DELAY_MS);
    }

    return { scanned: candidates.length, eligible: eligibleCount, drafted: draftedCount };
  },
});

// ============================================================================
// SECTION 5 — Dashboard Notifications (bell icon) daily cron
// Design spec: docs/superpowers/specs/2026-09-04-dashboard-notifications-design.md
//
// SIBLING to generateDailyDrafts above — generateDailyDrafts itself is NOT
// modified anywhere in this addition. This section reuses the SAME
// internal.customers.findUpcomingInternal read (now automatically
// benefiting from the is_deleted exclusion fix in customers.ts's
// findUpcoming), but:
//   - has NO consent gate (whatsapp_consent is irrelevant — this never
//     messages the customer, it only informs the merchant), and
//   - makes NO Gemini call (no ai.ts import anywhere in this section).
// ============================================================================

/** Notification rows older than this are expired and get swept at the end of each run. */
const NOTIFICATION_THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * hasExistingNotification — duplicate-prevention check, mirrors
 * hasExistingDraft's exact shape (SECTION 2 above) but reads the
 * `notifications` table's by_customer_occasion_date index instead of
 * ai_message_drafts'. Unlike hasExistingDraft there is no "discarded"
 * status to exclude here (notifications have no status field) — any
 * existing row for the tuple counts as "already notified".
 */
export const hasExistingNotification = internalQuery({
  args: {
    customerId: v.id("users"),
    occasion: v.union(v.literal("birthday"), v.literal("anniversary")),
    occasionDate: v.string(),
  },
  handler: async (ctx, { customerId, occasion, occasionDate }) => {
    const existing = await ctx.db
      .query("notifications")
      .withIndex("by_customer_occasion_date", (q) =>
        q.eq("customer_id", customerId).eq("occasion", occasion).eq("occasion_date", occasionDate),
      )
      .first();
    return existing !== null;
  },
});

/**
 * insertNotification — the cron's only write for a new hit. Mirrors
 * insertDraft's exact shape (SECTION 2 above). `message` is a plain,
 * generic string built in code — no Gemini call, no ai.ts import.
 */
export const insertNotification = internalMutation({
  args: {
    customerId: v.id("users"),
    occasion: v.union(v.literal("birthday"), v.literal("anniversary")),
    occasionDate: v.string(),
    message: v.string(),
  },
  handler: async (ctx, { customerId, occasion, occasionDate, message }) => {
    await ctx.db.insert("notifications", {
      customer_id: customerId,
      occasion,
      occasion_date: occasionDate,
      message,
      created_at: Date.now(),
      seen: false,
    });
  },
});

/**
 * deleteExpiredNotifications — sweeps every notification row older than 30
 * days. Range-reads via by_created_at (no full-table scan) and deletes each
 * match. Run once at the end of generateDailyNotifications — this is the
 * feature's "auto-expiry, no separate cron needed" mechanism.
 */
export const deleteExpiredNotifications = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - NOTIFICATION_THIRTY_DAYS_MS;
    const expired = await ctx.db
      .query("notifications")
      .withIndex("by_created_at", (q) => q.lt("created_at", cutoff))
      .collect();
    await Promise.all(expired.map((r) => ctx.db.delete(r._id)));
    return { deleted: expired.length };
  },
});

/**
 * generateDailyNotifications — the notifications cron's body. Runs once per
 * day (see SECTION 6). Sibling to generateDailyDrafts — does NOT call or
 * modify it.
 *
 * Steps:
 *   1. Fetch tomorrow's (days: 1) birthday + anniversary candidates via the
 *      SAME internal.customers.findUpcomingInternal calls generateDailyDrafts
 *      already makes (now is_deleted-excluded per customers.ts's fix).
 *   2. NO consent gate — this never messages the customer, only the
 *      merchant sees it.
 *   3. Skip any customer who already has a notification for this exact
 *      (customer_id, occasion, occasion_date) tuple, so re-running the cron
 *      never duplicates a row.
 *   4. Insert a new notification row per remaining eligible hit — NO Gemini
 *      call, just a generic templated string.
 *   5. Sweep expired (30+ day old) rows once at the end of the run.
 */
export const generateDailyNotifications = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scanned: number; created: number; expiredDeleted: number }> => {
    // Step 1 — same indexed, tomorrow-only candidate fetch generateDailyDrafts uses.
    const [birthdayHits, anniversaryHits] = await Promise.all([
      ctx.runQuery(internal.customers.findUpcomingInternal, { days: 1, field: "birthday" }),
      ctx.runQuery(internal.customers.findUpcomingInternal, { days: 1, field: "anniversary" }),
    ]);

    const candidates: Array<{ hit: EligibleCustomer; occasion: "birthday" | "anniversary" }> = [
      ...birthdayHits.map((h) => ({ hit: h as EligibleCustomer, occasion: "birthday" as const })),
      ...anniversaryHits.map((h) => ({ hit: h as EligibleCustomer, occasion: "anniversary" as const })),
    ].filter(({ hit }) => hit.days_until === 1);

    let createdCount = 0;

    for (const { hit, occasion } of candidates) {
      if (!hit.occasion_date) continue; // defensive — should never happen, see findUpcomingInternal's comment

      // Step 3 — duplicate-prevention via the by_customer_occasion_date index.
      const alreadyExists = await ctx.runQuery(internal.crons.hasExistingNotification, {
        customerId: hit._id,
        occasion,
        occasionDate: hit.occasion_date,
      });
      if (alreadyExists) continue;

      // Step 4 — generic, non-AI message string.
      const message = `${hit.name}'s ${occasion} is tomorrow!`;

      await ctx.runMutation(internal.crons.insertNotification, {
        customerId: hit._id,
        occasion,
        occasionDate: hit.occasion_date,
        message,
      });
      createdCount += 1;
    }

    // Step 5 — sweep expired rows once at the end of this run.
    const { deleted: expiredDeleted } = await ctx.runMutation(internal.crons.deleteExpiredNotifications, {});

    return { scanned: candidates.length, created: createdCount, expiredDeleted };
  },
});

// ============================================================================
// SECTION 6 — Cron registration
// ============================================================================

const crons = cronJobs();

// Runs once every 24 hours — crons.interval, per this project's pinned
// guidelines (never crons.daily()/.hourly()/.weekly()).
crons.interval("generate whatsapp ai drafts", { hours: 24 }, internal.crons.generateDailyDrafts, {});

// New, separate registration — added alongside (not replacing/merging into)
// the drafts cron above.
crons.interval("generate dashboard notifications", { hours: 24 }, internal.crons.generateDailyNotifications, {});

export default crons;
