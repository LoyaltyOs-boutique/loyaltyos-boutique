import { mutation, query, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { requireMerchantSession } from "./auth";
import { rateLimiter } from "./rateLimits";

/**
 * LoyaltyOS Boutique — Customer CRM backend (Step 4, PRD Module 1)
 * Source        : PRD Module 1 (Privacy-First Architecture, Experience-Based
 *                 Segments & Custom Tagging, Anniversary & Birthday Tracking
 *                 Delight Queue)
 * Design spec   : docs/superpowers/specs/2026-08-06-loyaltyos-design.md
 * Amendment     : docs/superpowers/specs/2026-08-07-convex-amendment-design.md
 *
 * CONTRACT PARITY: function names mirror the frontend localStorage surface in
 * src/lib/db.js (getCustomers / addStaffNote / …) so Step 4.5 wiring can point
 * the UI at `api.customers.*` WITHOUT any component edits.
 *
 * CONFIDENTIALITY (PRD Module 1 — Privacy-First Architecture):
 *   `measurements` (body fit) and `staff_notes` (internal staff-only context)
 *   are MERCHANT-ONLY fields. They are included in these merchant-facing
 *   queries/mutations but must NEVER be projected into any customer-portal
 *   response, analytics export, or campaign payload. All projections here
 *   deliberately omit auth secrets (password_hash, magic_token, session_token,
 *   reset_token).
 *
 * CURRENCY INVARIANT (Global Constraint): money fields are INTEGER PAISE —
 * never floats. This module touches no money; `points` is an integer from
 * the users schema and is read/written as-is.
 *
 * AUTH NOTE: session-based auth gating (requireMerchant) is a follow-up when
 * the shared Convex auth middleware lands (Step 3 stores session_token but the
 * CRM step inherits the same un-gated surface as auth.ts for now).
 *
 * IMPROVEMENT 4 (WhatsApp number as UNIQUE key — Ma'am's rule):
 *   ONE WhatsApp number = ONE customer profile. Convex has no native unique
 *   constraint, so uniqueness is enforced in code: createCustomer checks the
 *   by_mobile index first and refuses to insert a duplicate row.
 */

type UserDoc = import("./_generated/dataModel").Doc<"users">;

/**
 * Merchant view of a customer — all CRM fields, no auth secrets.
 * `measurements` + `staff_notes` are confidential merchant-only (PRD Module 1).
 */
function toMerchantCustomer(doc: UserDoc) {
  return {
    _id: doc._id,
    id: String(doc._id),
    name: doc.name,
    mobile: doc.mobile,
    email: doc.email ?? null,
    points: doc.points ?? 0,
    tier: doc.tier ?? "silver",
    birthday: doc.birthday ?? null,
    anniversary: doc.anniversary ?? null,
    custom_tags: doc.custom_tags ?? [],
    // PRD §3.2 — magic link fields for merchant eye/copy buttons + session persistence.
    magic_token: doc.magic_token ?? null,
    magic_token_created_at: doc.magic_token_created_at ?? null,
    // Consent flag drives the Approve & Send gate (WhatsApp wishes cannot fire without it).
    whatsapp_consent: doc.whatsapp_consent ?? false,
    // Phase 5 (Feature C) — VVIP flag drives dispatchEvent's vvip-only recipient filter.
    vvip: doc.vvip ?? false,
    // CONFIDENTIAL — merchant-only: body-fit measurements + internal staff notes.
    measurements: doc.measurements ?? {},
    staff_notes: doc.staff_notes ?? [],
  };
}

/** Fetch a single customer doc by _id, or null if missing / not a customer. */
async function getCustomerDoc(ctx: QueryCtx | MutationCtx, id: Id<"users">) {
  const doc = await ctx.db.get(id);
  if (!doc || doc.role !== "customer") return null;
  return doc;
}

/** Parse "M-D" or "MM-DD" (e.g. "8-10", "05-17") into [month, day] or null. */
function parseMD(s: string | null | undefined): [number, number] | null {
  if (!s) return null;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return [month, day];
}

/**
 * Scaling Fix 3 — normalize a birthday/anniversary string to zero-padded
 * "MM-DD" (e.g. "8-1" and "08-01" both become "08-01"), for storage in the
 * birthday_md/anniversary_md sort-mirror fields. Returns undefined when the
 * input is missing/unparseable, so callers can spread it away (never write
 * an explicit undefined field into Convex).
 */
function toMD(s: string | null | undefined): string | undefined {
  const parsed = parseMD(s);
  if (!parsed) return undefined;
  const [month, day] = parsed;
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * IST fix (2026-09-02): 85 Lansdowne operates in India Standard Time
 * (UTC+5:30), but Convex server functions always run in UTC (the V8 isolate
 * has zero local offset — Date's getMonth()/getDate() read back UTC's
 * calendar day, never IST's). Any time between 00:00 and 05:30 IST, IST's
 * calendar date is already one day ahead of UTC's. A client onboarded with
 * birthday/anniversary = "tomorrow" per the merchant's IST-timezone date
 * picker (see mdFromDate in src/lib/db.js) would be stored correctly as that
 * IST calendar date, but the OLD code below computed "today"/"tomorrow"
 * from raw server UTC — so during that ~5.5-hour daily window the stored
 * date was actually 2 days away by UTC reckoning, not 1, and silently
 * dropped out of the days_until===1 "tomorrow" tabs (Customers.jsx).
 * Fix: shift the UTC instant by the fixed +5:30 IST offset before reading
 * the calendar Y/M/D, so "today" here always matches the boutique's actual
 * local calendar day. IST has no daylight-saving, so this fixed offset is
 * always correct (no DST edge cases to handle).
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Build the set of "M-D" keys for the next `days` days (inclusive of today, IST calendar), with day offset. */
function upcomingWindow(days: number, now = new Date()) {
  const keys = new Set<string>();
  const offset = new Map<string, number>();
  // Shift the UTC instant into IST before reading Y/M/D, so "today" reflects
  // the boutique's real local calendar day (see IST fix note above).
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  for (let i = 0; i <= days; i++) {
    const d = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + i));
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const key = `${m}-${day}`;
    keys.add(key);
    if (!offset.has(key)) offset.set(key, i);
  }
  return { keys, offset };
}

/**
 * Scaling Fix 3 — the zero-padded "MM-DD" range(s) covering the same window
 * upcomingWindow() describes (today..today+days, IST calendar, inclusive),
 * for use as index-range bounds against birthday_md/anniversary_md.
 *
 * Returns ONE range [todayMD, endMD] when the window stays within the same
 * calendar year, or TWO ranges when it crosses year-end: [todayMD, "12-31"]
 * and ["01-01", wrappedEndMD]. Callers run one .withIndex(...) query per
 * range and merge the results — a single range query cannot express "wraps
 * past Dec 31 back to Jan 1" because index ranges are contiguous.
 */
function upcomingMDRanges(days: number, now = new Date()): Array<[string, string]> {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const startDay = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()));
  const endDay = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + days));

  const pad = (n: number) => String(n).padStart(2, "0");
  const toMDKey = (d: Date) => `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

  const startMD = toMDKey(startDay);
  const endMD = toMDKey(endDay);

  if (startDay.getUTCFullYear() === endDay.getUTCFullYear()) {
    // Same calendar year — one contiguous range.
    return [[startMD, endMD]];
  }
  // Crosses year-end — two contiguous ranges: today..Dec 31, and Jan 1..wrapped end.
  return [
    [startMD, "12-31"],
    ["01-01", endMD],
  ];
}

interface QueueHit {
  doc: UserDoc;
  daysUntil: number;
}

/**
 * message_actions exclusion check (docs/superpowers/specs/2026-08-26-message-action-tracking-design.md).
 * Returns true when the admin has already recorded a "sent" or "cancelled"
 * decision for this exact (customer_id, occasion, occasion_date) — i.e. this
 * specific year's occurrence has already been handled and must not
 * reappear in the Delight Queue tomorrow-tabs.
 *
 * Uses the by_customer_occasion_date index (no full-table scan).
 */
async function hasDecidedAction(
  ctx: QueryCtx,
  customerId: Id<"users">,
  occasion: "birthday" | "anniversary",
  occasionDate: string,
): Promise<boolean> {
  const existing = await ctx.db
    .query("message_actions")
    .withIndex("by_customer_occasion_date", (q) =>
      q.eq("customer_id", customerId).eq("occasion", occasion).eq("occasion_date", occasionDate),
    )
    .first();
  return existing !== null;
}

/**
 * Delight Queue core (PRD Module 1 — Anniversary & Birthday Tracking):
 * customers whose `field` month/day falls within the next `days` days
 * (today inclusive, year-boundary aware). Returns hits sorted by urgency.
 *
 * Excludes any customer already decided (sent/cancelled) for that exact
 * occasion_date via message_actions — see hasDecidedAction above.
 *
 * Scaling Fix 3 (docs/superpowers/specs/2026-09-03-scaling-fixes-pre-ai-design.md
 * Addendum 2026-09-04): previously scanned EVERY customer row and parsed
 * their raw birthday/anniversary string one by one. Now runs one or two
 * indexed range reads on birthday_md/anniversary_md (via
 * by_role_birthday_md / by_role_anniversary_md) covering exactly the
 * requested window — only customers whose occasion falls in-window are
 * fetched from the database at all. Two ranges are needed when the window
 * crosses a year boundary (e.g. Dec 29 + 7 days reaches Jan 5); see
 * upcomingMDRanges. Matching, exclusion, and sort behavior are byte-identical
 * to the prior full-scan version — this is a fetch-strategy change only.
 */
async function findUpcoming(
  ctx: QueryCtx,
  days: number,
  field: "birthday" | "anniversary",
): Promise<QueueHit[]> {
  const clampedDays = Math.max(0, Math.floor(days));
  const { keys, offset } = upcomingWindow(clampedDays);
  const ranges = upcomingMDRanges(clampedDays);

  // Fetch one page of candidate customers per MD range (1 range in the
  // common case, 2 when the window wraps year-end), using the matching
  // typed index per field — Convex's index query builder needs the field
  // name as a literal, not a dynamic string, so branch per field rather
  // than parameterizing the index/field name.
  const seen = new Map<string, UserDoc>();
  for (const [lo, hi] of ranges) {
    const rows =
      field === "birthday"
        ? await ctx.db
            .query("users")
            .withIndex("by_role_birthday_md", (q) =>
              q.eq("role", "customer").gte("birthday_md", lo).lte("birthday_md", hi),
            )
            .collect()
        : await ctx.db
            .query("users")
            .withIndex("by_role_anniversary_md", (q) =>
              q.eq("role", "customer").gte("anniversary_md", lo).lte("anniversary_md", hi),
            )
            .collect();
    for (const row of rows) seen.set(row._id, row);
  }

  const hits: QueueHit[] = [];
  for (const c of seen.values()) {
    // Soft-delete exclusion (schema.ts:74 — "Gate 1 — soft-delete flag;
    // missing/false = active"): a customer marked is_deleted:true must never
    // appear in the Delight Queue / AI-drafts cron / Dashboard Notifications,
    // all three of which share this function. Strict === true check so
    // missing/undefined/false rows (the vast majority) are unaffected.
    if (c.is_deleted === true) continue;
    const raw = field === "birthday" ? c.birthday : c.anniversary;
    const parsed = parseMD(raw);
    if (!parsed) continue;
    const key = `${parsed[0]}-${parsed[1]}`;
    if (!keys.has(key)) continue; // index range can include the same MM-DD across two years' worth of edge dates; keys is the exact-match filter
    if (await hasDecidedAction(ctx, c._id, field, key)) continue; // already sent/cancelled this year
    hits.push({ doc: c, daysUntil: offset.get(key) ?? 0 });
  }
  hits.sort((a, b) => a.daysUntil - b.daysUntil);
  return hits;
}

/**
 * Single-customer occasion check — reuses the SAME upcomingWindow() date-math
 * that powers findUpcoming()'s Delight Queue (birthdays/anniversaries) list,
 * but for exactly one customer's raw birthday/anniversary string instead of
 * scanning/filtering a whole table. Returns the days-until (0..days) if the
 * given "M-D"/"MM-DD" string falls within the window, or null otherwise.
 *
 * Factored out so getCustomerIntelligenceProfile (below) can determine ONE
 * customer's upcoming-occasion status without duplicating the window-building
 * logic in upcomingWindow()/findUpcoming().
 */
function checkUpcoming(raw: string | null | undefined, days: number): number | null {
  const parsed = parseMD(raw);
  if (!parsed) return null;
  const { keys, offset } = upcomingWindow(Math.max(0, Math.floor(days)));
  const key = `${parsed[0]}-${parsed[1]}`;
  if (!keys.has(key)) return null;
  return offset.get(key) ?? 0;
}

/** All customers — merchant CRM list view (all fields, no auth secrets). */
export const getCustomers = query({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const customers = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("role"), "customer"))
      .collect();
    return customers
      .map(toMerchantCustomer)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Scaling Fix 1 (docs/superpowers/specs/2026-09-03-scaling-fixes-pre-ai-design.md):
 * cursor-paginated customer list for the CRM view.
 *
 * getCustomers (above) collects the WHOLE users table on every load even
 * though the Customers.jsx grid only shows 6 rows at a time — an O(n) full
 * pull that degrades as the boutique's customer base grows. This function is
 * the paginated equivalent: SAME underlying query (users, role="customer"
 * filter) but returns one cursor page via Convex's built-in .paginate()
 * instead of .collect(), so the frontend can fetch pages on demand.
 *
 * Added as a NEW function so the live getCustomers path is untouched — the
 * frontend switch-over to this is a separate, later task.
 *
 * Merchant-only: guarded with requireMerchantSession(userId, token), the
 * SAME auth pattern as getCustomers. Returns Convex's native paginated shape
 * { page, isDone, continueCursor }; each page row is projected through
 * toMerchantCustomer (no auth secrets, confidential fields merchant-only).
 */
export const getCustomersPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, { paginationOpts, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const result = await ctx.db
      .query("users")
      .withIndex("by_role_name_lower", (q) => q.eq("role", "customer"))
      .order("asc")
      .paginate(paginationOpts);
    return {
      ...result,
      page: result.page.map(toMerchantCustomer),
    };
  },
});

/** Full customer profile by _id — measurements + staff_notes (merchant-only). */
export const getCustomerById = query({
  args: { id: v.id("users"), userId: v.id("users"), token: v.string() },
  handler: async (ctx, { id, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const doc = await getCustomerDoc(ctx, id);
    return doc ? toMerchantCustomer(doc) : null;
  },
});

/**
 * Patch a customer's body-fit measurements. CONTAINS CONFIDENTIAL
 * merchant-only data (PRD Module 1) — never project into customer-portal views.
 * Merges the given fields onto the existing measurements object (partial patch).
 */
export const updateMeasurements = mutation({
  args: {
    customerId: v.id("users"),
    measurements: v.object({
      bust: v.optional(v.number()),
      waist: v.optional(v.number()),
      hip: v.optional(v.number()),
      height: v.optional(v.string()),
      blouse_size: v.optional(v.string()),
    }),
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, { customerId, measurements, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const doc = await getCustomerDoc(ctx, customerId);
    if (!doc) return null;
    const merged = { ...(doc.measurements ?? {}), ...measurements };
    await ctx.db.patch(customerId, { measurements: merged });
    return toMerchantCustomer({ ...doc, measurements: merged });
  },
});

/**
 * Append an internal staff note. CONFIDENTIAL merchant-only context
 * (PRD Module 1) — never exposed to the customer portal.
 */
export const addStaffNote = mutation({
  args: {
    customerId: v.id("users"),
    text: v.string(),
    author: v.optional(v.string()),
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, { customerId, text, author, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Staff note text is required.");
    const doc = await getCustomerDoc(ctx, customerId);
    if (!doc) return null;
    const note = { text: trimmed, date: Date.now(), author: author?.trim() || "Owner" };
    const staff_notes = [...(doc.staff_notes ?? []), note];
    await ctx.db.patch(customerId, { staff_notes });
    return toMerchantCustomer({ ...doc, staff_notes });
  },
});

/** Replace a customer's custom tags (e.g. ["Hot Lead", "Saree Enthusiast"]). */
export const updateCustomTags = mutation({
  args: {
    customerId: v.id("users"),
    tags: v.array(v.string()),
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, { customerId, tags, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const doc = await getCustomerDoc(ctx, customerId);
    if (!doc) return null;
    const custom_tags = tags.map((t) => t.trim()).filter(Boolean);
    await ctx.db.patch(customerId, { custom_tags });
    return toMerchantCustomer({ ...doc, custom_tags });
  },
});

/** Update customer profile (name, birthday, anniversary, tier). */
export const updateCustomerProfile = mutation({
  args: {
    customerId: v.id("users"),
    name: v.optional(v.string()),
    birthday: v.optional(v.string()),
    anniversary: v.optional(v.string()),
    tier: v.optional(v.union(v.literal("silver"), v.literal("gold"), v.literal("platinum"))),
    custom_tags: v.optional(v.array(v.string())),
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, { customerId, userId, token, ...patch }) => {
    await requireMerchantSession(ctx, userId, token);
    const doc = await getCustomerDoc(ctx, customerId);
    if (!doc) return null;
    const update: any = {};
    if (patch.name !== undefined) {
      update.name = patch.name.trim();
      // Keep the sort mirror in sync (Scaling Fix 1) — same trim as `name`.
      update.name_lower = update.name.toLowerCase();
    }
    if (patch.birthday !== undefined) {
      update.birthday = patch.birthday.trim();
      // Scaling Fix 3 — keep the zero-padded sort mirror in sync. A blank
      // string clears birthday_md too (toMD returns undefined for "").
      update.birthday_md = toMD(update.birthday);
    }
    if (patch.anniversary !== undefined) {
      update.anniversary = patch.anniversary.trim();
      update.anniversary_md = toMD(update.anniversary);
    }
    if (patch.tier !== undefined) update.tier = patch.tier;
    if (patch.custom_tags !== undefined) update.custom_tags = patch.custom_tags.map((t: string) => t.trim()).filter(Boolean);
    await ctx.db.patch(customerId, update);
    return toMerchantCustomer({ ...doc, ...update });
  },
});

/** Delight Queue — customers with a birthday within the next `days` days. */
export const getUpcomingBirthdays = query({
  args: { days: v.optional(v.number()), userId: v.id("users"), token: v.string() },
  handler: async (ctx, { days, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const hits = await findUpcoming(ctx, days ?? 7, "birthday");
    return hits.map(({ doc, daysUntil }) => ({
      _id: doc._id,
      name: doc.name,
      birthday: doc.birthday ?? null,
      mobile: doc.mobile,
      tier: doc.tier ?? "silver",
      points: doc.points ?? 0,
      // Consent flag drives the Approve & Send gate (WhatsApp wishes cannot fire without it).
      whatsapp_consent: doc.whatsapp_consent ?? false,
      days_until: daysUntil,
    }));
  },
});

/** Delight Queue — customers with an anniversary within the next `days` days. */
export const getUpcomingAnniversaries = query({
  args: { days: v.optional(v.number()), userId: v.id("users"), token: v.string() },
  handler: async (ctx, { days, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const hits = await findUpcoming(ctx, days ?? 7, "anniversary");
    return hits.map(({ doc, daysUntil }) => ({
      _id: doc._id,
      name: doc.name,
      anniversary: doc.anniversary ?? null,
      mobile: doc.mobile,
      tier: doc.tier ?? "silver",
      points: doc.points ?? 0,
      // Consent flag drives the Approve & Send gate (WhatsApp wishes cannot fire without it).
      whatsapp_consent: doc.whatsapp_consent ?? false,
      days_until: daysUntil,
    }));
  },
});

/**
 * Design spec: docs/superpowers/specs/2026-09-04-phase3-whatsapp-ai-drafts-design.md §b
 *
 * findUpcomingInternal — internal-query variant of getUpcomingBirthdays /
 * getUpcomingAnniversaries for callers with NO live merchant session (i.e.
 * the daily drafts cron in crons.ts). A cron fires on a schedule with no
 * human in the loop supplying userId/token, so it cannot call
 * requireMerchantSession — this function is the same underlying read,
 * exposed via `internalQuery` (private, callable only from other Convex
 * functions via ctx.runQuery(internal.customers.findUpcomingInternal, ...)),
 * with the session-guard line simply omitted.
 *
 * REUSES, does not duplicate, the existing date-window/index logic:
 * delegates straight to findUpcoming() (same function that powers both
 * public queries above), which itself runs indexed range reads via
 * by_role_birthday_md / by_role_anniversary_md — no new scanning path.
 *
 * Returns the SAME fields getUpcomingBirthdays/getUpcomingAnniversaries
 * return (including whatsapp_consent, the gate the cron filters on before
 * ever calling Gemini — see crons.ts).
 */
export const findUpcomingInternal = internalQuery({
  args: {
    days: v.optional(v.number()),
    field: v.union(v.literal("birthday"), v.literal("anniversary")),
  },
  handler: async (ctx, { days, field }) => {
    const hits = await findUpcoming(ctx, days ?? 7, field);
    return hits.map(({ doc, daysUntil }) => {
      // Same parseMD() call findUpcoming() itself already used internally to
      // match this hit — re-derive the exact "M-D" key (unpadded, matching
      // message_actions'/ai_message_drafts' occasion_date convention, e.g.
      // "8-27") here so callers (the drafts cron) get a ready-to-use
      // occasion_date string without duplicating date-parsing logic.
      const raw = field === "birthday" ? doc.birthday : doc.anniversary;
      const parsed = parseMD(raw);
      const occasionDate = parsed ? `${parsed[0]}-${parsed[1]}` : null;
      return {
        _id: doc._id,
        name: doc.name,
        birthday: doc.birthday ?? null,
        anniversary: doc.anniversary ?? null,
        mobile: doc.mobile,
        tier: doc.tier ?? "silver",
        points: doc.points ?? 0,
        // Consent flag drives the Approve & Send gate (WhatsApp wishes cannot fire without it) —
        // and, for the AI drafts cron, the gate on whether Gemini is ever called at all.
        whatsapp_consent: doc.whatsapp_consent ?? false,
        days_until: daysUntil,
        // "M-D" string, e.g. "8-27" — see comment above. Should never be null
        // in practice (findUpcoming already required a valid parseMD to
        // produce this hit), but typed nullable defensively.
        occasion_date: occasionDate,
      };
    });
  },
});

/**
 * Design spec: docs/superpowers/specs/2026-08-26-message-action-tracking-design.md
 *
 * recordMessageAction — admin decision-log write for the Delight Queue's
 * tomorrow-tabs. Called by:
 *   - Approve & Send button (existing) — after a successful/attempted send,
 *     action:"sent" (+ channel: "cloud_api" | "wa_fallback")
 *   - Cancel button (new, Customers.jsx follow-up) — action:"cancelled",
 *     no send attempted
 *
 * IDEMPOTENCY: rejects with a clear error if a row already exists for the
 * exact (customer_id, occasion, occasion_date) tuple — prevents duplicate
 * rows from a double-click on Approve/Cancel or a duplicate call.
 *
 * Out of scope (per spec): no cron, no change to the Cloud-API-then-fallback
 * send mechanism itself, no "cancel forever" — this only ever records ONE
 * decision per occasion_date, and next year's differing M-D naturally resets it.
 */
export const recordMessageAction = mutation({
  args: {
    customer_id: v.id("users"),
    occasion: v.union(v.literal("birthday"), v.literal("anniversary")),
    occasion_date: v.string(),
    action: v.union(v.literal("sent"), v.literal("cancelled")),
    channel: v.optional(v.union(v.literal("cloud_api"), v.literal("wa_fallback"))),
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, { customer_id, occasion, occasion_date, action, channel, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const doc = await getCustomerDoc(ctx, customer_id);
    if (!doc) throw new Error("Customer not found.");

    const trimmedDate = occasion_date.trim();
    if (!parseMD(trimmedDate)) {
      throw new Error(`occasion_date must be an "M-D" string (e.g. "8-27"), got "${occasion_date}".`);
    }

    // IDEMPOTENCY — same tuple already decided → reject, don't insert a duplicate.
    if (await hasDecidedAction(ctx, customer_id, occasion, trimmedDate)) {
      throw new Error(
        `An action has already been recorded for this customer's ${occasion} on ${trimmedDate}.`,
      );
    }

    const id = await ctx.db.insert("message_actions", {
      customer_id,
      occasion,
      occasion_date: trimmedDate,
      action,
      decided_at: Date.now(),
      ...(channel ? { channel } : {}),
    });
    return { ok: true, id };
  },
});

/**
 * Design spec: docs/superpowers/specs/2026-08-27-points-ledger-phase-b1-design.md
 *
 * awardPoints — durable, real points-award mutation. Replaces (in a later,
 * separate wiring task) the local-only src/lib/db.js adjustPoints function
 * used by the Points Tool tab, which currently loses its changes on refresh
 * because it never calls Convex.
 *
 * Atomically (single Convex mutation = one transaction):
 *   1. Patches the customer's `points` field to Math.max(0, current + delta)
 *      — never negative, matching the existing local adjustPoints's exact
 *      Math.max(0, ...) safety clamp (src/lib/db.js).
 *   2. Inserts one row into points_ledger recording the transaction, with
 *      the resulting (post-clamp) balance.
 * Returns the new balance.
 *
 * reason_type is NOT restricted here at the mutation level — "testimonial"
 * and "purchase" remain technically callable, but per the design spec they
 * are UI-reserved: only the automated reviews.ts (approveReview) and
 * orders.ts (createOrder) flows are meant to ever send those values. Manual
 * admin UIs (Points Tool, future "+ Points" button) only ever offer
 * "normal"/"birthday"/"anniversary" — enforced at the frontend layer in a
 * later task, not here.
 */
export const awardPoints = mutation({
  args: {
    customer_id: v.id("users"),
    delta: v.number(),
    reason_type: v.union(
      v.literal("normal"),
      v.literal("birthday"),
      v.literal("anniversary"),
      v.literal("testimonial"),
      v.literal("purchase"),
    ),
    note: v.optional(v.string()),
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, { customer_id, delta, reason_type, note, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const doc = await getCustomerDoc(ctx, customer_id);
    if (!doc) throw new Error("Customer not found.");

    const resulting_balance = Math.max(0, (doc.points ?? 0) + delta);
    await ctx.db.patch(customer_id, { points: resulting_balance });

    await ctx.db.insert("points_ledger", {
      customer_id,
      delta,
      reason_type,
      ...(note?.trim() ? { note: note.trim() } : {}),
      resulting_balance,
      created_by: "admin",
      created_at: Date.now(),
    });

    return resulting_balance;
  },
});

/**
 * Activity Ledger fix (2026-09-02) — getPointsHistory.
 *
 * Bug: manual points_ledger transactions written by awardPoints (above) had
 * NO read path back out of Convex at all — the "future task" flagged in this
 * table's schema.ts comment. The frontend's customerLedger() (src/lib/db.js)
 * only ever read a local-only state.pointsLedger array, which awardPoints
 * never touches, so every manual award/deduction was invisible in the
 * customer's Activity Ledger tab even though the write itself succeeded.
 *
 * Fix: a new merchant-only query reading points_ledger by customer, via the
 * existing by_customer index (schema.ts), newest-first. Confidential
 * financial data — locked with requireMerchantSession(userId, token), the
 * SAME pattern as every other merchant-only query in this file (see
 * getCustomers above) — this is a brand-new guard call-site on a brand-new
 * function, not a modification of any existing one.
 */
export const getPointsHistory = query({
  args: { customer_id: v.id("users"), userId: v.id("users"), token: v.string() },
  handler: async (ctx, { customer_id, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const rows = await ctx.db
      .query("points_ledger")
      .withIndex("by_customer", (q) => q.eq("customer_id", customer_id))
      .order("desc")
      .collect();
    return rows.map((r) => ({
      id: String(r._id),
      userId: String(r.customer_id),
      action: r.delta < 0 ? "redeemed" : r.reason_type === "adjustment" ? "adjustment" : "earned",
      points: Math.abs(r.delta),
      reason: r.note?.trim() ? r.note.trim() : reasonTypeLabel(r.reason_type),
      createdAt: new Date(r.created_at).toISOString(),
    }));
  },
});

/** Human-readable fallback detail text for a points_ledger row with no merchant-typed note. */
function reasonTypeLabel(reason_type: string): string {
  switch (reason_type) {
    case "birthday": return "Birthday bonus";
    case "anniversary": return "Anniversary bonus";
    case "testimonial": return "Review bonus";
    case "purchase": return "Purchase bonus";
    default: return "Manual adjustment";
  }
}

/**
 * IMPROVEMENT 4 — WhatsApp number as UNIQUE key for customers.
 * Ma'am's rule: ONE WhatsApp number = ONE customer profile — prevent
 * duplicate accounts from the same number. Convex has no native unique
 * constraint, so uniqueness is enforced in code here (by_mobile index +
 * explicit pre-insert check in createCustomer).
 *
 * Frontend wiring (Join/Onboarding) lands in a later step — these two
 * functions are backend-only additions; the existing 7 CRM functions are
 * untouched.
 */

/** Normalize a WhatsApp mobile number: trim + digits only. */
function normalizeMobile(mobile: string): string {
  return mobile.trim().replace(/\D/g, "");
}

/**
 * Find a customer profile by their (normalized) WhatsApp number.
 * Uses the by_mobile index and filters to role="customer".
 * Returns the merchant view of the customer, or null when not found.
 */
export const findCustomerByMobile = query({
  args: { mobile: v.string(), userId: v.id("users"), token: v.string() },
  handler: async (ctx, { mobile, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const normalized = normalizeMobile(mobile);
    if (!normalized) return null;
    const doc = await ctx.db
      .query("users")
      .withIndex("by_mobile", (q) => q.eq("mobile", normalized))
      .filter((q) => q.eq(q.field("role"), "customer"))
      .first();
    return doc ? toMerchantCustomer(doc) : null;
  },
});

/**
 * Create a customer profile keyed by WhatsApp number.
 *
 * UNIQUE KEY CHECK — one WhatsApp number = ONE customer profile:
 * queries users by the by_mobile index first. If ANY user (customer or
 * merchant) already holds this mobile, returns { ok:false, error } and
 * DOES NOT insert a duplicate row.
 *
 * On success returns { ok:true, id, customer } with the merchant view of
 * the new profile (points: 0, tier: "silver").
 */
export const createCustomer = mutation({
  args: {
    mobile: v.string(),
    name: v.string(),
    birthday: v.optional(v.string()),
    anniversary: v.optional(v.string()),
    custom_tags: v.optional(v.array(v.string())),
    whatsapp_consent: v.optional(v.boolean()),
    // Phase 5 (Feature C, Virtual Events + VVIP) — mirrors whatsapp_consent's
    // optional-boolean, upgrade-only shape below (never silently downgraded).
    vvip: v.optional(v.boolean()),
  },
  handler: async (ctx, { mobile, name, birthday, anniversary, custom_tags, whatsapp_consent, vvip }) => {
    const digits = mobile.replace(/\D/g, '');
    if (digits.length !== 10) {
      return { ok: false, error: "Please enter a valid 10-digit mobile number" };
    }
    const normalized = digits;

    // Rate limit (design spec 2026-09-05, Part A4/B) — defense-in-depth
    // against Critical #2's duplicate-mobile leak vector (see rateLimits.ts).
    // Non-throwing form ONLY: src/lib/db.js's onboardCustomerRemote wraps
    // this whole call in a bare `catch { return createLocalCustomer(f) }` —
    // a thrown rejection would be silently swallowed into a fake local-only
    // phantom customer with no error shown. Returns the SAME {ok:false,
    // error} shape as the invalid-mobile check just above, which Join.jsx's
    // existing res.error / setMobileError handling already renders inline —
    // zero frontend changes needed.
    const rl = await rateLimiter.limit(ctx, "createCustomerByMobile", { key: normalized });
    if (!rl.ok) {
      return { ok: false, error: "Too many attempts — please try again in a few minutes." };
    }
    const customerName = name.trim();
    if (!customerName) throw new Error("Customer name is required.");

    // UNIQUE CHECK — block duplicate accounts from the same WhatsApp number.
    const existing = await ctx.db
      .query("users")
      .withIndex("by_mobile", (q) => q.eq("mobile", normalized))
      .first();
    if (existing) {
      // Repeat visit: only ever UPGRADE consent to true, never clear it.
      // A resubmission without the box ticked must not silently downgrade a
      // customer who consented on a prior visit — clearing consent is a
      // separate, more sensitive action outside this flow's scope.
      let record = existing;
      if (whatsapp_consent === true && existing.whatsapp_consent !== true) {
        await ctx.db.patch(existing._id, { whatsapp_consent: true });
        record = { ...existing, whatsapp_consent: true };
      }
      // Same upgrade-only shape as whatsapp_consent above — re-onboarding a
      // customer can mark them VVIP, but a resubmission without the flag
      // must never silently downgrade an already-VVIP customer.
      if (vvip === true && existing.vvip !== true) {
        await ctx.db.patch(existing._id, { vvip: true });
        record = { ...record, vvip: true };
      }
      return {
        ok: true,
        isExisting: true,
        existingId: record._id,
        customer: toMerchantCustomer(record),
      };
    }

    // No existing profile — safe to insert the new customer.
    const id = await ctx.db.insert("users", {
      mobile: normalized,
      name: customerName,
      name_lower: customerName.toLowerCase(), // Scaling Fix 1 — sort mirror
      role: "customer",
      points: 0,
      tier: "silver",
      ...(birthday ? { birthday: birthday.trim() } : {}),
      ...(toMD(birthday) ? { birthday_md: toMD(birthday) } : {}),
      ...(anniversary ? { anniversary: anniversary.trim() } : {}),
      ...(toMD(anniversary) ? { anniversary_md: toMD(anniversary) } : {}),
      // Only set consent when explicitly opted in — never persist an explicit false.
      ...(whatsapp_consent ? { whatsapp_consent: true } : {}),
      // Same "only set when true" shape — never persist an explicit false.
      ...(vvip ? { vvip: true } : {}),
      custom_tags: custom_tags ?? [],
    });
    const created = await ctx.db.get(id);
    return {
      ok: true,
      id,
      customer: created ? toMerchantCustomer(created) : null,
    };
  },
});

/**
 * Gate 1 — Bulk CSV customer import.
 * Reuses createCustomer's exact validation + duplicate-mobile-check logic
 * (10-digit mobile required, by_mobile index lookup) row by row, so a bad
 * or duplicate row is SKIPPED (reported back) rather than crashing the batch.
 * Also skips duplicate mobiles appearing more than once within the same file.
 *
 * NOTE: city/country are accepted (CSV column parity with the onboarding
 * form) but — matching createCustomer today — are not persisted; the users
 * schema has no city/country fields yet.
 */
export const bulkCreateCustomers = mutation({
  args: {
    rows: v.array(
      v.object({
        name: v.string(),
        whatsapp: v.string(),
        birthday: v.optional(v.string()),
        anniversary: v.optional(v.string()),
        city: v.optional(v.string()),
        country: v.optional(v.string()),
      }),
    ),
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, { rows, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    const created: Array<{ id: Id<"users">; name: string; mobile: string }> = [];
    const skipped: Array<{ name: string; whatsapp: string; reason: string }> = [];
    const seenInFile = new Set<string>();

    for (const row of rows) {
      const digits = row.whatsapp.replace(/\D/g, "");
      const customerName = row.name.trim();

      if (!customerName) {
        skipped.push({ name: row.name, whatsapp: row.whatsapp, reason: "missing_name" });
        continue;
      }
      if (digits.length !== 10) {
        skipped.push({ name: customerName, whatsapp: row.whatsapp, reason: "invalid_mobile" });
        continue;
      }
      if (seenInFile.has(digits)) {
        skipped.push({ name: customerName, whatsapp: digits, reason: "duplicate_in_file" });
        continue;
      }

      // Same duplicate-mobile-check as createCustomer: by_mobile index lookup.
      const existing = await ctx.db
        .query("users")
        .withIndex("by_mobile", (q) => q.eq("mobile", digits))
        .first();
      if (existing) {
        skipped.push({ name: customerName, whatsapp: digits, reason: "duplicate_existing" });
        continue;
      }

      seenInFile.add(digits);
      const id = await ctx.db.insert("users", {
        mobile: digits,
        name: customerName,
        name_lower: customerName.toLowerCase(), // Scaling Fix 1 — sort mirror
        role: "customer",
        points: 0,
        tier: "silver",
        ...(row.birthday ? { birthday: row.birthday.trim() } : {}),
        ...(toMD(row.birthday) ? { birthday_md: toMD(row.birthday) } : {}),
        ...(row.anniversary ? { anniversary: row.anniversary.trim() } : {}),
        ...(toMD(row.anniversary) ? { anniversary_md: toMD(row.anniversary) } : {}),
      });
      created.push({ id, name: customerName, mobile: digits });
    }

    return {
      created,
      skipped,
      createdCount: created.length,
      skippedCount: skipped.length,
    };
  },
});

/**
 * Design spec: docs/superpowers/specs/2026-09-04-phase1-customer-intelligence-design.md
 * Addendum 2026-09-04 (cart/likes deferred — out of scope, see bottom of spec).
 *
 * getCustomerIntelligenceProfile — Phase 1 "Customer Intelligence Foundation".
 * Combines three data paths that ALREADY exist and are indexed (no new
 * scanning/joins invented here) into one call, so future AI features (draft
 * generation, personalization) don't have to re-assemble the same joins:
 *
 *   1. Core customer row       — same safe projection as getCustomerById
 *                                 (toMerchantCustomer; measurements/staff_notes
 *                                 stay merchant-only, same as today).
 *   2. Full order history      — same rows/shape as getOrdersByUser, via the
 *                                 existing by_user index. Not truncated.
 *   3. Full points ledger      — same rows/shape as getPointsHistory, via the
 *                                 existing by_customer index. Not truncated.
 *   4. upcoming_occasion       — reuses checkUpcoming() (which itself reuses
 *                                 upcomingWindow(), the SAME date-window math
 *                                 that drives the Delight Queue) against this
 *                                 one customer's birthday/anniversary — zero
 *                                 duplicated date logic.
 *
 * ADDITIVE ONLY: this is a brand-new query. getCustomerById, getOrdersByUser,
 * getPointsHistory, getUpcomingBirthdays, getUpcomingAnniversaries are all
 * untouched — every existing call site keeps working exactly as before.
 *
 * Guarded with requireMerchantSession, same pattern as every other
 * merchant-facing query in this file.
 */
export const getCustomerIntelligenceProfile = query({
  args: { customerId: v.id("users"), userId: v.id("users"), token: v.string() },
  handler: async (ctx, { customerId, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);

    // 1. Core customer row — same base projection as getCustomerById, but
    // with measurements/staff_notes stripped out (see AI-facing note below).
    const doc = await getCustomerDoc(ctx, customerId);
    if (!doc) return null;
    // CONFIDENTIAL EXCLUSION: unlike getCustomerById, this profile is built to
    // eventually feed AI features (Phase 3+, Gemini) — measurements (body-fit
    // data) and staff_notes (private staff commentary) must never reach an AI
    // prompt. Destructure them out immediately after the shared helper call;
    // toMerchantCustomer itself is untouched so getCustomerById and every
    // other caller keep returning both fields exactly as before.
    const { measurements: _measurements, staff_notes: _staff_notes, ...customer } =
      toMerchantCustomer(doc);

    // 2. Full order history — identical query/shape to getOrdersByUser.
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_user", (q) => q.eq("user_id", customerId))
      .order("desc")
      .collect();

    // 3. Full points ledger history — identical query + row-mapping to
    // getPointsHistory (same field names/derivation, kept in sync manually
    // since it's a small, stable projection — see getPointsHistory above).
    const ledgerRows = await ctx.db
      .query("points_ledger")
      .withIndex("by_customer", (q) => q.eq("customer_id", customerId))
      .order("desc")
      .collect();
    const points_history = ledgerRows.map((r) => ({
      id: String(r._id),
      userId: String(r.customer_id),
      action: r.delta < 0 ? "redeemed" : r.reason_type === "adjustment" ? "adjustment" : "earned",
      points: Math.abs(r.delta),
      reason: r.note?.trim() ? r.note.trim() : reasonTypeLabel(r.reason_type),
      createdAt: new Date(r.created_at).toISOString(),
    }));

    // 4. Upcoming occasion (next 7 days) — reuses the SAME window logic as
    // the Delight Queue via checkUpcoming(), just scoped to this one customer.
    const OCCASION_WINDOW_DAYS = 7;
    const birthdayDays = checkUpcoming(doc.birthday, OCCASION_WINDOW_DAYS);
    const anniversaryDays = checkUpcoming(doc.anniversary, OCCASION_WINDOW_DAYS);

    // Judgment call: if BOTH fall within the window for the same customer
    // (rare, but possible), surface whichever is sooner — a single merchant-
    // facing "what's coming up" signal is simpler to consume than an array,
    // and "soonest" is the one that's actually time-sensitive/actionable
    // first. A tie (identical days_until) resolves to birthday, since that's
    // the flow the Delight Queue tab defaults to showing first.
    let upcoming_occasion: { type: "birthday" | "anniversary"; days_until: number } | null = null;
    if (birthdayDays !== null && anniversaryDays !== null) {
      upcoming_occasion =
        anniversaryDays < birthdayDays
          ? { type: "anniversary", days_until: anniversaryDays }
          : { type: "birthday", days_until: birthdayDays };
    } else if (birthdayDays !== null) {
      upcoming_occasion = { type: "birthday", days_until: birthdayDays };
    } else if (anniversaryDays !== null) {
      upcoming_occasion = { type: "anniversary", days_until: anniversaryDays };
    }

    return {
      customer,
      orders,
      points_history,
      upcoming_occasion,
    };
  },
});

/**
 * Design spec: docs/superpowers/specs/2026-09-04-phase3-whatsapp-ai-drafts-design.md
 *
 * getDraftForCustomer — merchant-guarded read of the current draft (if any)
 * for a given customer/occasion/date, written by the daily AI-drafts cron
 * (crons.ts -> ai.ts generateMessageDraft). Queries the SAME
 * by_customer_occasion_date index the cron uses for its own duplicate check,
 * so the tuple lookup semantics stay identical on both the write and read
 * sides.
 *
 * "Current" draft = the newest "pending" row for the tuple (a merchant may
 * eventually see a "used"/"discarded" history here too, in a later task —
 * for now the cron only ever writes "pending", so filtering to that status
 * is the correct/only meaningful read).
 *
 * This is a read-path-only addition for a later frontend task (per the
 * Phase 3 design doc) — no UI wiring happens in this task. Guarded with
 * requireMerchantSession, the SAME pattern as every other merchant-facing
 * query in this file.
 */
export const getDraftForCustomer = query({
  args: {
    customerId: v.id("users"),
    occasion: v.union(v.literal("birthday"), v.literal("anniversary")),
    occasionDate: v.string(),
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, { customerId, occasion, occasionDate, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);

    const rows = await ctx.db
      .query("ai_message_drafts")
      .withIndex("by_customer_occasion_date", (q) =>
        q.eq("customer_id", customerId).eq("occasion", occasion).eq("occasion_date", occasionDate),
      )
      .collect();

    const pending = rows.filter((r) => r.status === "pending");
    if (pending.length === 0) return null;
    // Newest pending row wins, in case more than one ever exists for the tuple.
    pending.sort((a, b) => b.generated_at - a.generated_at);
    const doc = pending[0];
    return {
      _id: doc._id,
      customer_id: doc.customer_id,
      occasion: doc.occasion,
      occasion_date: doc.occasion_date,
      draft_text: doc.draft_text,
      generated_at: doc.generated_at,
      status: doc.status,
    };
  },
});
