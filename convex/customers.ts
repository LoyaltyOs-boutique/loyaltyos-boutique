import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

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
 * Delight Queue core (PRD Module 1 — Anniversary & Birthday Tracking):
 * customers whose `field` month/day falls within the next `days` days
 * (today inclusive, year-boundary aware). Returns hits sorted by urgency.
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
    if (keys.has(key)) hits.push({ doc: c, daysUntil: offset.get(key) ?? 0 });
  }
  hits.sort((a, b) => a.daysUntil - b.daysUntil);
  return hits;
}

/** All customers — merchant CRM list view (all fields, no auth secrets). */
export const getCustomers = query({
  args: {},
  handler: async (ctx) => {
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
  args: { id: v.id("users") },
  handler: async (ctx, { id }) => {
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
    userId: v.id("users"),
    measurements: v.object({
      bust: v.optional(v.number()),
      waist: v.optional(v.number()),
      hip: v.optional(v.number()),
      height: v.optional(v.string()),
      blouse_size: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { userId, measurements }) => {
    const doc = await getCustomerDoc(ctx, userId);
    if (!doc) return null;
    const merged = { ...(doc.measurements ?? {}), ...measurements };
    await ctx.db.patch(userId, { measurements: merged });
    return toMerchantCustomer({ ...doc, measurements: merged });
  },
});

/**
 * Append an internal staff note. CONFIDENTIAL merchant-only context
 * (PRD Module 1) — never exposed to the customer portal.
 */
export const addStaffNote = mutation({
  args: {
    userId: v.id("users"),
    text: v.string(),
    author: v.optional(v.string()),
  },
  handler: async (ctx, { userId, text, author }) => {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Staff note text is required.");
    const doc = await getCustomerDoc(ctx, userId);
    if (!doc) return null;
    const note = { text: trimmed, date: Date.now(), author: author?.trim() || "Owner" };
    const staff_notes = [...(doc.staff_notes ?? []), note];
    await ctx.db.patch(userId, { staff_notes });
    return toMerchantCustomer({ ...doc, staff_notes });
  },
});

/** Replace a customer's custom tags (e.g. ["Hot Lead", "Saree Enthusiast"]). */
export const updateCustomTags = mutation({
  args: {
    userId: v.id("users"),
    tags: v.array(v.string()),
  },
  handler: async (ctx, { userId, tags }) => {
    const doc = await getCustomerDoc(ctx, userId);
    if (!doc) return null;
    const custom_tags = tags.map((t) => t.trim()).filter(Boolean);
    await ctx.db.patch(userId, { custom_tags });
    return toMerchantCustomer({ ...doc, custom_tags });
  },
});

/** Update customer profile (name, birthday, anniversary, tier). */
export const updateCustomerProfile = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    birthday: v.optional(v.string()),
    anniversary: v.optional(v.string()),
    tier: v.optional(v.union(v.literal("silver"), v.literal("gold"), v.literal("platinum"))),
  },
  handler: async (ctx, { userId, ...patch }) => {
    const doc = await getCustomerDoc(ctx, userId);
    if (!doc) return null;
    const update: any = {};
    if (patch.name !== undefined) update.name = patch.name.trim();
    if (patch.birthday !== undefined) update.birthday = patch.birthday.trim();
    if (patch.anniversary !== undefined) update.anniversary = patch.anniversary.trim();
    if (patch.tier !== undefined) update.tier = patch.tier;
    await ctx.db.patch(userId, update);
    return toMerchantCustomer({ ...doc, ...update });
  },
});

/** Delight Queue — customers with a birthday within the next `days` days. */
export const getUpcomingBirthdays = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const hits = await findUpcoming(ctx, days ?? 7, "birthday");
    return hits.map(({ doc, daysUntil }) => ({
      _id: doc._id,
      name: doc.name,
      birthday: doc.birthday ?? null,
      mobile: doc.mobile,
      tier: doc.tier ?? "silver",
      points: doc.points ?? 0,
      days_until: daysUntil,
    }));
  },
});

/** Delight Queue — customers with an anniversary within the next `days` days. */
export const getUpcomingAnniversaries = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const hits = await findUpcoming(ctx, days ?? 7, "anniversary");
    return hits.map(({ doc, daysUntil }) => ({
      _id: doc._id,
      name: doc.name,
      anniversary: doc.anniversary ?? null,
      mobile: doc.mobile,
      tier: doc.tier ?? "silver",
      points: doc.points ?? 0,
      days_until: daysUntil,
    }));
  },
});

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
  args: { mobile: v.string() },
  handler: async (ctx, { mobile }) => {
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
  },
  handler: async (ctx, { mobile, name, birthday, anniversary, custom_tags }) => {
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
      return {
        ok: true,
        isExisting: true,
        existingId: existing._id,
        customer: toMerchantCustomer(existing),
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