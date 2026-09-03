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
 *
 * AUTH (Step 3): PRD §3.1 merchant email+password (bcrypt) with self-service
 * forgot-password reset link; PRD §3.2 customer zero-login crypto magic-link.
 *   - password_hash        : bcrypt hash (never plaintext)
 *   - magic_token          : 256-bit hex, valid 180 days (PRD §3.2)
 *   - magic_token_created_at: epoch ms for the 180-day expiry check
 *   - session_token/expiry : merchant login session, 7 days
 *   - reset_token/expiry   : forgot-password token, 24h
 * All tokens are cryptographically random (32 bytes → 64 hex chars).
 */
export default defineSchema({
  /** PRD §6 Table `users` — customers + merchant(s). */
  users: defineTable({
    email: v.optional(v.string()), // unique; required for merchant, optional for customer (normalized lowercase)
    mobile: v.string(), // unique customer lookup key (Billing Desk searches by phone)
    password_hash: v.optional(v.string()), // merchant only — bcrypt hash (PRD §3.1)
    magic_token: v.optional(v.string()), // customer zero-login magic-link token (256-bit hex)
    magic_token_created_at: v.optional(v.number()), // epoch ms — 180-day magic-link expiry (PRD §3.2)
    reset_token: v.optional(v.string()), // forgot-password token (256-bit hex)
    reset_expiry: v.optional(v.number()), // epoch ms — reset token expiry (24h)
    session_token: v.optional(v.string()), // merchant session token (256-bit hex)
    session_expiry: v.optional(v.number()), // epoch ms — merchant session expiry (7 days)
    role: v.union(v.literal("customer"), v.literal("merchant")),
    name: v.string(),
    // Scaling Fix 1 — lowercased mirror of `name`, kept in sync on every name
    // write (createCustomer / bulkCreateCustomers / updateCustomerProfile).
    // The `by_role_name_lower` index sorts on this so getCustomersPaginated
    // streams customers in the SAME case-insensitive A-Z order that
    // getCustomers produces in-memory via localeCompare. Optional because
    // pre-backfill rows don't have it (see backfillNameLower); missing values
    // sort first, then are populated by the one-off backfill.
    name_lower: v.optional(v.string()),
    points: v.optional(v.number()), // default 0 — treat missing as 0 in app code (Convex has no field defaults)
    birthday: v.optional(v.string()),
    anniversary: v.optional(v.string()),
    tier: v.optional(
      v.union(v.literal("silver"), v.literal("gold"), v.literal("platinum")),
    ),
    custom_tags: v.optional(v.array(v.string())), // e.g. "Saree Enthusiast", "Needs Care"
    whatsapp_consent: v.optional(v.boolean()), // Gate 1 — customer opted in to WhatsApp messages
    is_deleted: v.optional(v.boolean()), // Gate 1 — soft-delete flag; missing/false = active
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
    .index("by_email", ["email"]) // merchant login + forgot-password lookup (PRD §3.1)
    .index("by_magic_token", ["magic_token"]) // magic-link validation (PRD §3.2)
    .index("by_tier", ["tier"]) // campaign segmentation by loyalty tier
    // Scaling Fix 1 — sorted pagination for the CRM customer list. Equality on
    // `role` + range on `name_lower` lets getCustomersPaginated stream
    // customers in case-insensitive A-Z order (matching getCustomers'
    // in-memory localeCompare sort) without a full-table .collect() + .sort().
    // Indexing on `name_lower` (not `name`) is required: Convex indexes sort by
    // raw byte order (all uppercase before any lowercase), which would NOT
    // match getCustomers' case-insensitive localeCompare ordering.
    .index("by_role_name_lower", ["role", "name_lower"]),

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
    // Gate 2 (Step A) — distinguishes a designer-lookbook from a future PDF-lookbook
    // for the Catalogue.jsx selector dropdown. Missing/undefined on existing rows =
    // treated as "catalogue" grouping (unaffected), same optional-field pattern as
    // reviews.catalogue_item_id above.
    kind: v.optional(
      v.union(v.literal("catalogue"), v.literal("designer"), v.literal("pdf")),
    ),
    // Gate 2 (Step B) — public Vercel Blob URL for a PDF-kind lookbook
    // (kind: "pdf"). Optional: only set when a PDF was actually uploaded via
    // lookbooks.generatePdfUploadUrl -> createPdfLookbook; catalogue/designer
    // lookbooks never set this field.
    pdf_url: v.optional(v.string()),
  }),

  /** PRD §6 Table `catalogue_items` — items inside a lookbook. */
  catalogue_items: defineTable({
    lookbook_id: v.id("lookbooks"),
    title: v.string(),
    price: v.number(), // PAISE (₹12,500 → 1,250,000)
    image_url: v.string(),
    instagram_link: v.optional(v.string()),
    size: v.optional(v.string()), // Gate 2 — e.g. "S", "M", "L", "Free Size"
    colour: v.optional(v.string()), // Gate 2 — e.g. "Ivory", "Blush"
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

  /**
   * Step 5 — PRD §8 Settings (centralized).
   * Singleton-per-key pattern: exactly ONE document per settings group,
   * keyed by `key` ("tier_rules" | "templates" | "general"). `value` holds
   * the full JSON payload for that group (defaults + overrides merged in
   * convex/settings.ts). Upserted via the `by_key` index so the table stays
   * bounded (max one row per known key) — scalable and simple for callers.
   */
  settings: defineTable({
    key: v.string(), // "tier_rules" | "templates" | "general"
    value: v.any(), // JSON payload for that settings group
    updated_at: v.number(), // epoch ms — last write (mutations set Date.now())
    updated_by: v.optional(v.string()), // actor identifier (e.g. merchant email) when known
    }).index("by_key", ["key"]), // singleton lookup per settings group

  /** PRD Module 3 — Reviews & Testimonials. */
  reviews: defineTable({
    user_id: v.id("users"),
    type: v.union(v.literal("product"), v.literal("gmb"), v.literal("testimonial")),
    text: v.string(),
    rating: v.optional(v.number()),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("declined")),
    points_awarded: v.optional(v.number()),
    catalogue_item_id: v.optional(v.id("catalogue_items")), // which product this review is about (type "product" only)
    created_at: v.number(),
  })
    .index("by_user", ["user_id"])
    .index("by_status", ["status"]),

  /**
   * Design spec: docs/superpowers/specs/2026-08-26-message-action-tracking-design.md
   *
   * message_actions — admin decision-log for birthday/anniversary WhatsApp
   * reminders. Recording a "sent" or "cancelled" row here for a given
   * (customer_id, occasion, occasion_date) hides that customer from the
   * "Birthdays tomorrow" / "Anniversaries tomorrow" Delight Queue lists
   * (see customers.ts getUpcomingBirthdays / getUpcomingAnniversaries).
   *
   * `occasion_date` is an "M-D" string (e.g. "8-27") — not a full date — so
   * the row naturally stops matching once the year rolls over and the
   * customer reappears in next year's queue. No cleanup/cron job needed.
   */
  message_actions: defineTable({
    customer_id: v.id("users"),
    occasion: v.union(v.literal("birthday"), v.literal("anniversary")),
    occasion_date: v.string(), // "M-D" e.g. "8-27" — matches parseMD's format in customers.ts
    action: v.union(v.literal("sent"), v.literal("cancelled")),
    decided_at: v.number(), // epoch ms
    channel: v.optional(v.union(v.literal("cloud_api"), v.literal("wa_fallback"))), // only meaningful for action:"sent"
  })
    // Exclusion lookup used by getUpcomingBirthdays/getUpcomingAnniversaries —
    // named after the exact field tuple, matching this file's by_<field(s)> convention.
    .index("by_customer_occasion_date", ["customer_id", "occasion", "occasion_date"]),

  /**
   * Design spec: docs/superpowers/specs/2026-08-27-points-ledger-phase-b1-design.md
   *
   * points_ledger — durable, append-only audit trail for every points change
   * (manual awards + future automated ones), replacing the local-only,
   * refresh-losing array in src/lib/db.js's Points Tool tab. Each row is one
   * transaction: written by convex/customers.ts's awardPoints mutation
   * alongside the users.points patch (same mutation = atomic).
   *
   * reason_type:
   *   "normal" | "birthday" | "anniversary" — selectable in manual admin UIs
   *   "testimonial" — reserved for the automated review-approval flow
   *                   (reviews.ts approveReview) only, not manual UIs
   *   "purchase"    — reserved for the existing order-checkout flow
   *                   (orders.ts createOrder) only, not manual UIs
   * (Phase B1 does not enforce this split at the mutation level — see
   * awardPoints's own comment — it is enforced by which callers exist.)
   */
  points_ledger: defineTable({
    customer_id: v.id("users"),
    delta: v.number(), // signed points change (positive = award, negative = deduction)
    reason_type: v.union(
      v.literal("normal"),
      v.literal("birthday"),
      v.literal("anniversary"),
      v.literal("testimonial"),
      v.literal("purchase"),
    ),
    note: v.optional(v.string()),
    resulting_balance: v.number(), // customer's points AFTER this transaction (post-clamp)
    created_by: v.union(v.literal("admin"), v.literal("system")),
    created_at: v.number(), // epoch ms
  })
    // Per-customer history lookup (Activity Ledger tab, future task) — matches
    // this file's by_<field> index-naming convention.
    .index("by_customer", ["customer_id"]),
});
