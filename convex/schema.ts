import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * LoyaltyOS Boutique — Convex schema
 * Source        : PRD §6 Database / Relational Data Model
 * Design spec   : docs/superpowers/specs/2026-08-06-loyaltyos-design.md
 * Amendment     : docs/superpowers/specs/2026-08-07-convex-amendment-design.md (Express/PG → Convex)
 *
 * CURRENCY INVARIANT (Global Constraint, from Task 2 points engine):
 *   All money fields are INTEGER PAISE — never floats.
 *   ₹1 = 100 paise · ₹23,500 = 2,350,000 paise.
 *   Earning rate: 1 pt per ₹100 = 10,000 paise spent, floored.
 *   Redemption: 1 pt = ₹1 = 100 paise.
 *
 * TIER ENUM: PRD §6 users.tier = 'silver' | 'gold' | 'platinum'
 * (Task 2 points engine's ivory/champagne/noir are display-layer names in the
 *  approved design spec; the stored enum follows PRD + this schema spec.)
 */
export default defineSchema({
  /** PRD §6 Table `users` — customers + merchant(s). */
  users: defineTable({
    email: v.optional(v.string()), // unique; required for merchant, optional for customer
    mobile: v.string(), // unique customer lookup key (Billing Desk searches by phone)
    password_hash: v.optional(v.string()), // merchant only (task: plaintext seed; real hash in auth step)
    magic_token: v.optional(v.string()), // customer zero-login magic-link token
    role: v.union(v.literal("customer"), v.literal("merchant")),
    name: v.string(),
    points: v.optional(v.number()), // default 0 — treat missing as 0 in app code (Convex has no field defaults)
    birthday: v.optional(v.string()),
    anniversary: v.optional(v.string()),
    tier: v.optional(
      v.union(v.literal("silver"), v.literal("gold"), v.literal("platinum")),
    ),
    custom_tags: v.optional(v.array(v.string())), // e.g. "Saree Enthusiast", "Needs Care"
    measurements: v.optional(
      v.object({
        bust: v.optional(v.number()),
        waist: v.optional(v.number()),
        hip: v.optional(v.number()),
        height: v.optional(v.string()),
        blouse_size: v.optional(v.string()),
      }),
    ),
    staff_notes: v.optional(
      v.array(
        v.object({
          text: v.string(),
          date: v.number(),
          author: v.optional(v.string()),
        }),
      ),
    ),
  })
    .index("by_mobile", ["mobile"]) // Billing Desk phone lookup; duplicate mobile = unique in app logic
    .index("by_magic_token", ["magic_token"]) // magic-link validation
    .index("by_tier", ["tier"]), // campaign segmentation by loyalty tier

  /** PRD §6 Table `lookbooks` — designer collection groups. */
  lookbooks: defineTable({
    title: v.string(), // e.g. "Autumn Collection 2026"
    designer: v.string(),
    source: v.union(
      v.literal("manual"),
      v.literal("pdf"),
      v.literal("csv"),
      v.literal("instagram"),
    ),
    created_at: v.optional(v.number()),
  }),

  /** PRD §6 Table `catalogue_items` — items inside a lookbook. */
  catalogue_items: defineTable({
    lookbook_id: v.id("lookbooks"),
    title: v.string(),
    price: v.number(), // PAISE (₹12,500 → 1,250,000)
    image_url: v.string(),
    instagram_link: v.optional(v.string()),
  }).index("by_lookbook", ["lookbook_id"]),

  /** PRD §6 Table `orders` — POS/hybrid checkouts; atomic with points application. */
  orders: defineTable({
    user_id: v.id("users"),
    subtotal: v.number(), // PAISE
    points_applied: v.optional(v.number()), // points redeemed at checkout
    discount_value: v.number(), // PAISE (points_applied × 100)
    payment_method: v.union(v.literal("online"), v.literal("offline")),
    final_total: v.number(), // PAISE
    points_earned: v.number(), // earnForAmount(subtotal) × tier multiplier, floored
    created_at: v.number(),
  }).index("by_user", ["user_id"]),

  /** PRD §6 Table `campaigns` — WhatsApp broadcast + creative flyer campaigns. */
  campaigns: defineTable({
    title: v.string(),
    creative_url: v.string(),
    message_body: v.string(),
    audience_segment: v.object({
      tiers: v.optional(v.array(v.string())), // ["silver","gold","platinum"]
      min_points: v.optional(v.number()),
      custom_tags: v.optional(v.array(v.string())),
    }),
    sent_count: v.optional(v.number()),
    clicks_count: v.optional(v.number()),
    sent_at: v.optional(v.number()),
  }),
});