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
 *    helpers." — so this file uses `crons.cron(name, "<cron-expression>", ...)`,
 *    never `crons.daily()`/`.hourly()`/`.weekly()`, and registers via the
 *    same top-level `cronJobs()` -> `export default crons` shape as the
 *    guidelines' own worked example (guidelines.md:378-396).
 *
 * FIXED WALL-CLOCK SCHEDULE (2026-09-07 fix — was `crons.interval({hours:24})`):
 * `crons.interval({hours: 24})` fires exactly 24h after the last deploy, so
 * its fire time silently drifts every redeploy — it could land at 3am, 11am,
 * anything, with no relation to the boutique's actual calendar day. These two
 * crons compute "tomorrow's" birthday/anniversary window for 85 Lansdowne,
 * which operates in India Standard Time (UTC+5:30, no daylight-saving — see
 * customers.ts's `IST_OFFSET_MS` fix, same fixed-offset assumption reused
 * here), so they need a PREDICTABLE fixed local time, not a deploy-relative
 * one. Target: 00:05 AM IST (5 minutes past local midnight) daily.
 *
 * IST -> UTC arithmetic (double-checked both directions):
 *   IST = UTC + 5:30  =>  UTC = IST - 5:30
 *   00:05 - 5:30  =>  borrow a day: 24:05 - 5:30 = 18:35, on the PREVIOUS
 *   UTC calendar day. So 00:05 IST = 18:35 UTC (the day before).
 *   Forward check: 18:35 UTC + 5:30 = 24:05 = 00:05 IST the NEXT day. Matches.
 * => cron expression "35 18 * * *" (minute=35, hour=18 UTC, every day),
 *    per `crons.cron()`'s real signature (node_modules/convex/src/server/cron.ts):
 *    `cron(cronIdentifier: string, cron: CronString, functionReference, ...args)`
 *    where CronString is a standard 5-field expression, e.g. "15 7 * * *".
 *    `crons.daily({hourUTC, minuteUTC}, ...)` is a real, documented Convex
 *    helper too, but this project's own guidelines explicitly forbid it — so
 *    `crons.cron()` with an equivalent expression is the correct choice here.
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

/**
 * getCachedDraftTextInternal — 2026-09-09 addition for on-demand draft
 * generation + caching (see ai.ts's generateMessageDraftPublic, the new
 * caller). Reads the SAME by_customer_occasion_date index hasExistingDraft
 * already uses (above) for the SAME (customer, occasion, occasion_date)
 * tuple shape, but returns the actual cached `draft_text` string instead of
 * just a boolean — this is the read side of the cache; hasExistingDraft
 * remains the cron's own existence-only dedup check and is NOT modified or
 * reused here, per this task's STRICT scope (no logic changes to
 * hasExistingDraft/insertDraft themselves).
 *
 * "Cached" = the newest "pending"-status row for the tuple, same
 * newest-pending-wins semantics customers.ts's getDraftForCustomer already
 * uses for its own read of this table — kept consistent rather than
 * inventing a different selection rule for what is conceptually the same
 * "current draft for this tuple" read. Returns null when no such row exists,
 * which the caller (generateMessageDraftPublic) treats as a genuine cache
 * miss requiring a fresh Gemini call.
 */
export const getCachedDraftTextInternal = internalQuery({
  args: {
    customerId: v.id("users"),
    occasion: v.union(v.literal("birthday"), v.literal("anniversary")),
    occasionDate: v.string(),
  },
  handler: async (ctx, { customerId, occasion, occasionDate }): Promise<string | null> => {
    const rows = await ctx.db
      .query("ai_message_drafts")
      .withIndex("by_customer_occasion_date", (q) =>
        q.eq("customer_id", customerId).eq("occasion", occasion).eq("occasion_date", occasionDate),
      )
      .collect();

    const pending = rows.filter((r) => r.status === "pending");
    if (pending.length === 0) return null;
    pending.sort((a, b) => b.generated_at - a.generated_at);
    return pending[0].draft_text;
  },
});

/**
 * Insert a new pending draft row into ai_message_drafts.
 *
 * DUAL USE (2026-09-09 — on-demand draft generation + caching): originally
 * "the cron's only write to ai_message_drafts" (generateDailyDrafts, SECTION
 * 3 below). Now ALSO called from ai.ts's generateMessageDraftPublic, the new
 * on-demand path triggered from the Approve & Send modal the moment a
 * merchant actually needs a draft that doesn't exist yet (rather than only
 * ever waiting for the next nightly cron run). Both callers write the exact
 * same shape/status ("pending") into the exact same table — this mutation's
 * own logic is unchanged, only its set of callers has grown.
 */
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
    // Widened additively (Customer Activity Intelligence Part 2/3) to also
    // cover "weekly_activity" — generateDailyNotifications itself is
    // unmodified and only ever passes "birthday"/"anniversary" here, exactly
    // as before; generateWeeklyActivityNotifications (SECTION 5B below) is
    // the sole new caller that passes "weekly_activity".
    occasion: v.union(v.literal("birthday"), v.literal("anniversary"), v.literal("weekly_activity")),
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
    // Widened additively (Customer Activity Intelligence Part 2/3) — same
    // reasoning as hasExistingNotification's args above.
    occasion: v.union(v.literal("birthday"), v.literal("anniversary"), v.literal("weekly_activity")),
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
// SECTION 5B — Weekly "most active customers" bell notification
// Design spec: docs/superpowers/specs/2026-09-07-customer-activity-intelligence-design.md §b.5
//
// SIBLING to generateDailyNotifications above — that function (and
// generateDailyDrafts in SECTION 3) is NOT modified anywhere in this
// addition. Reuses the SAME `notifications` table and the SAME
// hasExistingNotification/insertNotification dedup+insert shape, now that
// schema.ts additively widens `notifications.occasion` to include
// "weekly_activity" (see schema.ts's own comment on that table). Reads the
// NEW customer_activity_events table (Part 1, commit 6abc85f) via its
// by_created_at index — a global, indexed, 7-day-bounded range read, no
// full-table .collect(). No Gemini call (plain templated string, matching
// generateDailyNotifications' "no AI, no consent gate" posture).
// ============================================================================

/**
 * Hard cap on how many "most active" customers get a notification row in a
 * single run.
 *
 * JUDGMENT CALL: mirrors MAX_DRAFTS_PER_RUN's reasoning (SECTION 1 above) —
 * a fixed ceiling keeps this weekly job's worst-case latency/write-volume
 * flat and predictable as the customer base grows, instead of looping over
 * an unbounded "everyone who did anything this week" list. 10 is chosen
 * over 50 (the daily-drafts cap) because this is a "most active" TOP-N
 * digest by design (design doc §b.5: "caps the 'most active' list at a
 * fixed N (e.g. top 10)") — it is not meant to notify about every active
 * customer, only highlight the most engaged ones, so a small top-N is the
 * correct shape here, not just a scalability ceiling. Any customer beyond
 * the top 10 by activity count simply doesn't get a notification that week;
 * the dedup check makes re-running this job safe regardless of the cap.
 */
const MAX_WEEKLY_ACTIVE_NOTIFICATIONS = 10;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * getRecentActivityCustomerIdsInternal — indexed, 7-day-bounded global scan
 * of customer_activity_events via the by_created_at index (Part 1's second
 * index, purpose-built for exactly this "all activity in the last N days
 * across all customers" read pattern — see schema.ts's own comment on that
 * index). Returns raw rows (customer_id + created_at); grouping/counting by
 * customer happens in the calling action, not here, matching
 * getActiveCustomers' documented shape in the design doc (§b.4).
 *
 * "Active" threshold judgment call (stated explicitly per task instructions):
 * ANY of the three currently-tracked action types (like / cart_add /
 * lookbook_view) qualifies — at least ONE event in the last 7 days is enough
 * to count as "active this week". No minimum count, no requirement to hit
 * all three types. This matches the design doc's own framing ("who's
 * active") as a presence signal, not an engagement-depth threshold — the
 * activityCount surfaced to the merchant (via getActiveCustomers, a
 * separate query, not built in this task) is what conveys depth, not this
 * cron's inclusion criterion. event_link_click is included in the index
 * scan too (no action-type filter applied) since nothing currently writes
 * that action (Part 1's known, documented gap) — this is forward-compatible
 * with zero extra code once that tracking is wired up.
 */
export const getRecentActivityCustomerIdsInternal = internalQuery({
  args: { sinceMs: v.number() },
  handler: async (ctx, { sinceMs }) => {
    const rows = await ctx.db
      .query("customer_activity_events")
      .withIndex("by_created_at", (q) => q.gte("created_at", sinceMs))
      .collect();
    return rows.map((r) => r.customer_id);
  },
});

/**
 * getCustomerNameInternal — tiny by-_id lookup used only to build the
 * per-customer notification message text below (`"<name> was highly active
 * this week!"`, per the design doc's message convention already used by
 * generateDailyNotifications' `${hit.name}'s ${occasion} is tomorrow!`).
 * A single-document `ctx.db.get` by primary key, not a scan — safe to call
 * once per (already top-N-capped) active customer.
 */
export const getCustomerNameInternal = internalQuery({
  args: { customerId: v.id("users") },
  handler: async (ctx, { customerId }) => {
    const doc = await ctx.db.get(customerId);
    return doc?.name ?? "This customer";
  },
});

/**
 * generateWeeklyActivityNotifications — the weekly cron's body (SECTION 6
 * registers it, Mondays 00:10 IST). Runs independently of, and does not
 * call or modify, generateDailyDrafts / generateDailyNotifications.
 *
 * Steps:
 *   1. Read the last-7-days customer_activity_events rows (indexed,
 *      by_created_at) and reduce to a distinct list of active customer_ids
 *      with their event counts, sorted most-active-first.
 *   2. Cap to the top MAX_WEEKLY_ACTIVE_NOTIFICATIONS customers.
 *   3. Compute this week's Monday date in "M-D" format (same convention
 *      birthday/anniversary occasion_date already uses).
 *   4. Skip any customer who already has a "weekly_activity" notification
 *      for this exact (customer_id, "weekly_activity", mondayDate) tuple —
 *      via hasExistingNotification, now covering this occasion type too —
 *      so re-running this cron never duplicates a row.
 *   5. Insert a new notification row per remaining customer — a generic,
 *      non-AI message string, same insertNotification mutation
 *      generateDailyNotifications already uses.
 *   6. No separate expiry sweep here — deleteExpiredNotifications already
 *      runs daily via generateDailyNotifications and covers all occasion
 *      types uniformly (it ranges on created_at, not occasion), so a
 *      second sweep in this weekly job would be redundant.
 */
export const generateWeeklyActivityNotifications = internalAction({
  args: {},
  handler: async (ctx): Promise<{ activeCustomers: number; notified: number }> => {
    // Step 1 — indexed 7-day global read, then group+count in memory (bounded
    // by one week's event volume, not the full table).
    const customerIds = await ctx.runQuery(internal.crons.getRecentActivityCustomerIdsInternal, {
      sinceMs: Date.now() - SEVEN_DAYS_MS,
    });

    const countByCustomer = new Map<string, number>();
    for (const id of customerIds) {
      countByCustomer.set(id, (countByCustomer.get(id) ?? 0) + 1);
    }

    // Step 2 — sort most-active-first, cap to the top N.
    const topActive = Array.from(countByCustomer.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_WEEKLY_ACTIVE_NOTIFICATIONS);

    // Step 3 — this week's Monday, "M-D" format (matches parseMD's format
    // used by birthday/anniversary occasion_date elsewhere in this file).
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=Sunday..6=Saturday
    const diffToMonday = (dayOfWeek + 6) % 7; // days since most recent Monday
    const monday = new Date(now.getTime() - diffToMonday * 24 * 60 * 60 * 1000);
    const mondayDate = `${monday.getUTCMonth() + 1}-${monday.getUTCDate()}`;

    let notifiedCount = 0;

    for (const [customerIdStr] of topActive) {
      const customerId = customerIdStr as import("./_generated/dataModel").Id<"users">;

      // Step 4 — duplicate-prevention via the by_customer_occasion_date
      // index, same hasExistingNotification helper generateDailyNotifications
      // uses, now covering "weekly_activity" too.
      const alreadyExists = await ctx.runQuery(internal.crons.hasExistingNotification, {
        customerId,
        occasion: "weekly_activity",
        occasionDate: mondayDate,
      });
      if (alreadyExists) continue;

      // Step 5 — generic, non-AI message string with the real customer name
      // (single-document by-_id lookup, not a scan), matching
      // generateDailyNotifications' `${hit.name}'s ${occasion} is tomorrow!`
      // naming convention. `count` intentionally not included in the message
      // text (design doc keeps this a plain templated string); the
      // per-customer activityCount is surfaced elsewhere (getActiveCustomers,
      // not built in this task) for merchants who want the numeric detail.
      const name = await ctx.runQuery(internal.crons.getCustomerNameInternal, { customerId });

      await ctx.runMutation(internal.crons.insertNotification, {
        customerId,
        occasion: "weekly_activity",
        occasionDate: mondayDate,
        message: `${name} was highly active this week!`,
      });
      notifiedCount += 1;
    }

    return { activeCustomers: countByCustomer.size, notified: notifiedCount };
  },
});

// ============================================================================
// SECTION 5C — Daily per-customer AI activity summary
// Design spec: docs/superpowers/specs/2026-09-07-customer-activity-intelligence-design.md §b.3
//
// SIBLING to generateDailyDrafts (SECTION 3) and generateDailyNotifications /
// generateWeeklyActivityNotifications (SECTIONS 5/5B) — none of those three
// are modified anywhere in this addition. Finds customers with any tracked
// activity in the last 7 days (reusing getRecentActivityCustomerIdsInternal,
// SECTION 5B above, verbatim — same indexed by_created_at global scan the
// weekly cron already established, no new query invented), then calls
// ai.ts's generateCustomerActivitySummary + upsertActivitySummary for each,
// capped + paced with the SAME discipline (constant names reused, not
// reinvented) as generateDailyDrafts' MAX_DRAFTS_PER_RUN / GEMINI_CALL_DELAY_MS.
// ============================================================================

/**
 * Hard cap on how many Gemini activity-summary calls this cron makes per run.
 *
 * JUDGMENT CALL: reuses generateDailyDrafts' MAX_DRAFTS_PER_RUN reasoning
 * (SECTION 1) verbatim rather than inventing a new number — same "50/day
 * comfortably covers 85 Lansdowne's current and near-term customer base"
 * argument applies equally here: the set of customers with ANY tracked
 * activity in a 7-day window is realistically a small fraction of the total
 * customer base, so 50 is a generous ceiling, not a routine bottleneck.
 * Named separately from MAX_DRAFTS_PER_RUN (not literally the same constant)
 * because the two crons cap two independent, unrelated batches — a future
 * change to one cap should not silently change the other's behavior — but
 * the VALUE is deliberately kept identical per the instruction to reuse this
 * project's established cap discipline rather than invent new numbers
 * without reason.
 */
const MAX_ACTIVITY_SUMMARIES_PER_RUN = 50;

/**
 * getCustomerTierInternal — tiny by-_id lookup used only to fetch the tier
 * enum generateCustomerActivitySummary's args require (name is already
 * available from crons.ts's own getCustomerNameInternal, SECTION 5B — this
 * adds the one additional field that helper doesn't return). A single
 * point-lookup by primary key, not a scan.
 *
 * Defensive default: a customer row with no `tier` set (schema.ts allows
 * v.optional) falls back to "silver" — matches this codebase's existing
 * "silver is the baseline/default tier" convention (tier rules: minPoints 0
 * for silver, the lowest tier a customer can be in).
 */
export const getCustomerTierInternal = internalQuery({
  args: { customerId: v.id("users") },
  handler: async (ctx, { customerId }) => {
    const doc = await ctx.db.get(customerId);
    return (doc?.tier ?? "silver") as "silver" | "gold" | "platinum";
  },
});

/**
 * generateDailyActivitySummaries — this cron's body (SECTION 6 registers it,
 * daily at 00:15 AM IST — see registration comment for the double-checked
 * IST->UTC arithmetic). Runs independently of, and does not call or modify,
 * generateDailyDrafts / generateDailyNotifications / generateWeeklyActivityNotifications.
 *
 * Steps:
 *   1. Find all customers with any tracked activity (like/cart_add/
 *      lookbook_view/event_link_click) in the last 7 days — the SAME
 *      indexed by_created_at global scan getRecentActivityCustomerIdsInternal
 *      (SECTION 5B) already implements for the weekly notification cron;
 *      reused verbatim rather than re-implemented.
 *   2. Reduce to a distinct customer_id list (dedup — a customer with 5
 *      events should only get ONE summary call, not 5).
 *   3. Cap at MAX_ACTIVITY_SUMMARIES_PER_RUN (batch discipline, see above).
 *   4. For each remaining customer (sequential, paced): fetch name+tier,
 *      call ai.ts's generateCustomerActivitySummary, and on a non-null
 *      result upsert it via ai.ts's upsertActivitySummary. Paced with the
 *      SAME GEMINI_CALL_DELAY_MS (SECTION 1) generateDailyDrafts already
 *      uses between sequential Gemini calls — not a new delay value.
 */
export const generateDailyActivitySummaries = internalAction({
  args: {},
  handler: async (ctx): Promise<{ activeCustomers: number; summarized: number }> => {
    // Step 1 — same indexed 7-day global read the weekly cron uses.
    const customerIds = await ctx.runQuery(internal.crons.getRecentActivityCustomerIdsInternal, {
      sinceMs: Date.now() - SEVEN_DAYS_MS,
    });

    // Step 2 — dedup to distinct customers.
    const distinctCustomerIds = Array.from(new Set(customerIds));

    let summarizedCount = 0;

    for (const customerId of distinctCustomerIds) {
      // Step 3 — cap: stop generating new summaries once this run's batch
      // limit is reached (mirrors generateDailyDrafts' identical cap check).
      if (summarizedCount >= MAX_ACTIVITY_SUMMARIES_PER_RUN) break;

      // Step 4 — fetch the two fields generateCustomerActivitySummary's args
      // require beyond customerId itself.
      const name = await ctx.runQuery(internal.crons.getCustomerNameInternal, { customerId });
      const tier = await ctx.runQuery(internal.crons.getCustomerTierInternal, { customerId });

      const summaryText: string | null = await ctx.runAction(internal.ai.generateCustomerActivitySummary, {
        customerId,
        customerName: name,
        tier,
      });

      if (summaryText) {
        await ctx.runMutation(internal.ai.upsertActivitySummary, {
          customerId,
          summaryText,
        });
        summarizedCount += 1;
      }

      // Pacing — sequential, spaced-out Gemini calls, same fixed delay
      // generateDailyDrafts already uses (SECTION 1), not a new value.
      await delay(GEMINI_CALL_DELAY_MS);
    }

    return { activeCustomers: distinctCustomerIds.length, summarized: summarizedCount };
  },
});

// ============================================================================
// SECTION 6 — Cron registration
// ============================================================================

const crons = cronJobs();

// REMOVED 2026-09-09 — generateDailyDrafts' automatic cron.cron(...)
// registration line used to live here ("generate whatsapp ai drafts",
// "35 18 * * *", internal.crons.generateDailyDrafts, {}).
//
// Superseded 2026-09-09 by on-demand generation + caching in the Approve &
// Send modal — see convex/ai.ts's generateMessageDraftPublic.
// generateDailyDrafts itself is left fully intact below (SECTION 3) and
// remains manually invokable (e.g. `npx convex run crons:generateDailyDrafts
// '{}'`) — only its automatic schedule is removed. The nightly batch run had
// a real gap this closes: a customer created/updated AFTER the nightly cron
// already ran would never get a draft until the NEXT night, even though
// Gemini could generate one on demand right now. On-demand generation (first
// real need per (customer, occasion, occasion_date) tuple triggers ONE
// Gemini call, cached into this same ai_message_drafts table thereafter)
// makes the nightly batch redundant without removing any of its own code.

// New, separate registration — added alongside (not replacing/merging into)
// the drafts cron above. Same fixed 18:35 UTC (00:05 IST) daily schedule.
crons.cron("generate dashboard notifications", "35 18 * * *", internal.crons.generateDailyNotifications, {});

// Weekly "most active customers" notification (Customer Activity
// Intelligence Part 2/3, SECTION 5B above) — runs every Monday at a FIXED
// wall-clock time, 00:10 AM IST.
//
// IST -> UTC arithmetic (double-checked both directions, same method as the
// file-header comment's daily-cron derivation above):
//   IST = UTC + 5:30  =>  UTC = IST - 5:30
//   00:10 - 5:30  =>  borrow a day: 24:10 - 5:30 = 18:40, on the PREVIOUS
//   UTC calendar day. So 00:10 IST = 18:40 UTC (the day before).
//   Forward check: 18:40 UTC + 5:30 = 24:10 = 00:10 IST the NEXT day. Matches.
//
// Since the LOCAL (IST) trigger day is Monday, the UTC day one clock-step
// earlier is Sunday — so the cron expression's day-of-week field must select
// Sunday, not Monday. Confirmed Convex's actual day-of-week numbering by
// reading crons.cron()'s own doc comment in this project's installed
// package, node_modules/convex/src/server/cron.ts:522-531:
//   "Like the unix command `cron`, Sunday is 0, Monday is 1, etc."
//   "┌─ day of the week (0 - 6) (Sunday to Saturday)"
// So day-of-week = 0 (Sunday) is correct here — NOT 1. (The design doc's own
// illustrative snippet, §b.5, used "* * 1"/Monday for this field — this
// registration deliberately does NOT copy that number, since re-deriving
// and re-checking it against the installed package's own doc comment, per
// this task's explicit instruction, shows Sunday/0 is the arithmetically
// correct value for a Monday-00:10-IST trigger.)
// => cron expression "40 18 * * 0" (minute=40, hour=18 UTC, day-of-week=0/Sunday).
crons.cron(
  "generate weekly activity notifications",
  "40 18 * * 0",
  internal.crons.generateWeeklyActivityNotifications,
  {},
);

// Daily per-customer AI activity summary (Customer Activity Intelligence
// Part 3a, SECTION 5C above) — runs every day at a FIXED wall-clock time,
// 00:15 AM IST, DISTINCT from the 00:05 IST slot the two existing daily
// crons use above (deliberately staggered so all three daily jobs don't fire
// in the same minute).
//
// IST -> UTC arithmetic (double-checked both directions, same method as the
// file-header comment's and SECTION 6's weekly-cron derivation above — this
// project has already caught one real off-by-one error in the design doc's
// own worked cron example, so this is re-derived from scratch, not assumed):
//   IST = UTC + 5:30  =>  UTC = IST - 5:30
//   00:15 - 5:30  =>  borrow a day: 24:15 - 5:30 = 18:45, on the PREVIOUS
//   UTC calendar day. So 00:15 IST = 18:45 UTC (the day before).
//   Forward check: 18:45 UTC + 5:30 = 24:15 = 00:15 IST the NEXT day. Matches.
// Unlike the weekly cron above, this fires every day (no day-of-week
// restriction), so the day-of-week field stays "*", same as the two existing
// daily crons.
// => cron expression "45 18 * * *" (minute=45, hour=18 UTC, every day).
crons.cron(
  "generate daily activity summaries",
  "45 18 * * *",
  internal.crons.generateDailyActivitySummaries,
  {},
);

export default crons;
