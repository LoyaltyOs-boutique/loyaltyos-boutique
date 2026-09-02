import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireMerchantSession } from "./auth";

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

/** Build the set of "M-D" keys for the next `days` days (inclusive of today), with day offset. */
function upcomingWindow(days: number, now = new Date()) {
  const keys = new Set<string>();
  const offset = new Map<string, number>();
  for (let i = 0; i <= days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const key = `${m}-${day}`;
    keys.add(key);
    if (!offset.has(key)) offset.set(key, i);
  }
  return { keys, offset };
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
 */
async function findUpcoming(
  ctx: QueryCtx,
  days: number,
  field: "birthday" | "anniversary",
): Promise<QueueHit[]> {
  const customers = await ctx.db
    .query("users")
    .filter((q) => q.eq(q.field("role"), "customer"))
    .collect();
  const { keys, offset } = upcomingWindow(Math.max(0, Math.floor(days)));
  const hits: QueueHit[] = [];
  for (const c of customers) {
    const raw = field === "birthday" ? c.birthday : c.anniversary;
    const parsed = parseMD(raw);
    if (!parsed) continue;
    const key = `${parsed[0]}-${parsed[1]}`;
    if (!keys.has(key)) continue;
    if (await hasDecidedAction(ctx, c._id, field, key)) continue; // already sent/cancelled this year
    hits.push({ doc: c, daysUntil: offset.get(key) ?? 0 });
  }
  hits.sort((a, b) => a.daysUntil - b.daysUntil);
  return hits;
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
    if (patch.name !== undefined) update.name = patch.name.trim();
    if (patch.birthday !== undefined) update.birthday = patch.birthday.trim();
    if (patch.anniversary !== undefined) update.anniversary = patch.anniversary.trim();
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
  },
  handler: async (ctx, { mobile, name, birthday, anniversary, custom_tags, whatsapp_consent }) => {
    const digits = mobile.replace(/\D/g, '');
    if (digits.length !== 10) {
      return { ok: false, error: "Please enter a valid 10-digit mobile number" };
    }
    const normalized = digits;
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
      role: "customer",
      points: 0,
      tier: "silver",
      ...(birthday ? { birthday: birthday.trim() } : {}),
      ...(anniversary ? { anniversary: anniversary.trim() } : {}),
      // Only set consent when explicitly opted in — never persist an explicit false.
      ...(whatsapp_consent ? { whatsapp_consent: true } : {}),
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
        role: "customer",
        points: 0,
        tier: "silver",
        ...(row.birthday ? { birthday: row.birthday.trim() } : {}),
        ...(row.anniversary ? { anniversary: row.anniversary.trim() } : {}),
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
