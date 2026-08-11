import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";

/**
 * LoyaltyOS Boutique — Centralized Settings backend (Step 5 + Step 5.5, PRD §8)
 * Source        : PRD §8 Settings (editable loyalty tiers, point redemption
 *                 value, store details, global message templates)
 * Design spec   : docs/superpowers/specs/2026-08-06-loyaltyos-design.md
 *                 (Decision #5 — "Merchant can tune thresholds in Settings
 *                 without schema changes")
 * Amendment     : docs/superpowers/specs/2026-08-07-convex-amendment-design.md
 *                 (Express/PG → Convex)
 * Step 5.5      : Aligns the backend to the ACTUAL merchant Settings UI model
 *                 (src/pages/merchant/Settings.jsx) — per-tier loyalty rules
 *                 (purchasePercent / birthdayBonus / gmbPoints /
 *                 productReviewPoints / on) with a "global" fallback tier.
 *                 The UI is the source of the model; the backend adapts.
 *
 * ARCHITECTURE (scalable + clean):
 *   - Singleton-per-key pattern: the `settings` table holds at most ONE
 *     document per settings group (`loyalty_rules` | `templates`), looked up
 *     via the `by_key` index. Bounded table — never grows with usage.
 *   - Defaults as the single source of truth: DEFAULT_SETTINGS (mirrors the
 *     approved seed values in src/data/seed.js) and DEFAULT_TEMPLATES live
 *     here (exported). getSettings merges stored overrides on top of the
 *     defaults, so the config is COMPLETE even when the DB is empty (fresh
 *     deployment → defaults fallback). Stored wins.
 *   - Upsert helper centralizes the get-or-patch/get-or-insert logic — one
 *     implementation, reused by every settings mutation (no duplication).
 *   - Read merge is shared: getSettings and every mutation return the same
 *     merged shape via readMergedSettings(), so callers always get the full
 *     effective config after a write.
 *
 * TIER MODEL (Step 5.5): stored keys follow the Settings UI enum
 * (global | silver | gold | platinum). `global` is the fallback rule used by
 * the points engine when a tier has no override; `on` (boolean) enables a
 * tier's own rule set in the UI.
 */

// ============================================================================
// SECTION 1 — Settings group keys (single source of truth for allowed keys)
// ============================================================================

/**
 * Settings group keys — exactly one singleton document per key in the
 * `settings` table. Add new groups here as the app grows (e.g. "general"
 * for store details / point redemption value per PRD §8).
 */
export const SETTINGS_KEYS = {
  LOYALTY_RULES: "loyalty_rules",
  TEMPLATES: "templates",
} as const;

/** Union type of the known settings group keys. */
export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];

// ============================================================================
// SECTION 2 — Loyalty rules (the merchant Settings UI model, Step 5.5)
// ============================================================================

/** Tier keys — match the Settings UI tabs (global default + three tiers). */
export const TIER_KEYS = ["global", "silver", "gold", "platinum"] as const;

/** Union type of the loyalty rule tier keys. */
export type TierKey = (typeof TIER_KEYS)[number];

/**
 * A single loyalty rule group — the exact shape the Settings UI edits.
 * All fields optional so partial patches merge cleanly over the defaults.
 *
 * @field purchasePercent     — points earned per ₹100 of order value (e.g. 5 → 5 pts/₹100).
 * @field birthdayBonus       — flat bonus points awarded on a customer's birthday.
 * @field gmbPoints           — bonus points per approved Google review.
 * @field productReviewPoints — bonus points per in-app product review.
 * @field on                  — UI toggle; true → the tier's own rule set applies
 *                              (silver/gold/platinum only — global is always on).
 */
export const tierRuleValidator = v.object({
  purchasePercent: v.optional(v.number()),
  birthdayBonus: v.optional(v.number()),
  gmbPoints: v.optional(v.number()),
  productReviewPoints: v.optional(v.number()),
  on: v.optional(v.boolean()),
});

/** Validator for the complete `loyalty_rules` payload the Settings UI sends. */
export const loyaltyRulesValidator = v.object({
  tiers: v.object({
    global: v.object({
      purchasePercent: v.optional(v.number()),
      birthdayBonus: v.optional(v.number()),
      gmbPoints: v.optional(v.number()),
      productReviewPoints: v.optional(v.number()),
    }),
    silver: tierRuleValidator,
    gold: tierRuleValidator,
    platinum: tierRuleValidator,
  }),
});

/**
 * DEFAULT SETTINGS — board-approved defaults, mirroring the seed values in
 * src/data/seed.js so a fresh deployment renders identically to the demo.
 */
export const DEFAULT_SETTINGS: {
  tiers: Record<
    TierKey,
    {
      purchasePercent: number;
      birthdayBonus: number;
      gmbPoints: number;
      productReviewPoints: number;
      on?: boolean;
    }
  >;
} = {
  tiers: {
    global: { purchasePercent: 5, birthdayBonus: 200, gmbPoints: 500, productReviewPoints: 150 },
    silver: { purchasePercent: 4, birthdayBonus: 150, gmbPoints: 400, productReviewPoints: 100, on: true },
    gold: { purchasePercent: 5, birthdayBonus: 200, gmbPoints: 500, productReviewPoints: 150, on: true },
    platinum: { purchasePercent: 7, birthdayBonus: 350, gmbPoints: 750, productReviewPoints: 250, on: true },
  },
};

/**
 * Merge stored loyalty-rule overrides over the defaults.
 * Per-tier shallow merge — only known fields of the correct type are copied,
 * so a corrupt/invalid stored payload can never break the config.
 */
function mergeLoyaltyRules(
  stored: Partial<Record<TierKey, Record<string, unknown>>> | undefined,
): typeof DEFAULT_SETTINGS["tiers"] {
  const merged: typeof DEFAULT_SETTINGS["tiers"] = {
    ...DEFAULT_SETTINGS.tiers,
    silver: { ...DEFAULT_SETTINGS.tiers.silver },
    gold: { ...DEFAULT_SETTINGS.tiers.gold },
    platinum: { ...DEFAULT_SETTINGS.tiers.platinum },
  };
  if (!stored) return merged;
  for (const key of TIER_KEYS) {
    const override = stored[key];
    if (!override || typeof override !== "object") continue;
    const target = merged[key];
    // Numeric fields — copy only when a valid number is provided.
    for (const numField of ["purchasePercent", "birthdayBonus", "gmbPoints", "productReviewPoints"] as const) {
      const val = (override as Record<string, unknown>)[numField];
      if (typeof val === "number") {
        (target as Record<string, unknown>)[numField] = val;
      }
    }
    // Boolean toggle — copy only when a valid boolean is provided.
    if (typeof override.on === "boolean") {
      target.on = override.on;
    }
  }
  return merged;
}

// ============================================================================
// SECTION 3 — WhatsApp message templates (global templates)
// ============================================================================

/** Template keys — the four global WhatsApp message types. */
export const TEMPLATE_KEYS = [
  "welcome",
  "birthday",
  "anniversary",
  "review_request",
] as const;

/** Union type of the template keys. */
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Validator for the template key argument. */
export const templateKeyValidator = v.union(
  v.literal("welcome"),
  v.literal("birthday"),
  v.literal("anniversary"),
  v.literal("review_request"),
);

/**
 * DEFAULT TEMPLATES — elegant boutique WhatsApp messages.
 * `{name}` is the placeholder replaced with the customer's name at send time.
 */
export const DEFAULT_TEMPLATES: Record<TemplateKey, string> = {
  welcome:
    "Welcome to 85 Lansdowne, {name}! We are delighted to have you in our boutique family. Earn 1 point for every ₹100 you spend and unlock exclusive rewards. See you soon!",
  birthday:
    "Happy Birthday, {name}! 🎉 May your day be as beautiful as you are. Come celebrate with us at 85 Lansdowne — a little surprise awaits you.",
  anniversary:
    "Happy Anniversary, {name}! 💐 Thank you for being part of our journey. Walk in soon for a special treat crafted just for you.",
  review_request:
    "Dear {name}, thank you for shopping at 85 Lansdowne! We would love to hear about your experience. Leave us a review and earn bonus points.",
};

/**
 * Merge stored template overrides over the defaults.
 * Only non-empty string overrides are accepted for known keys.
 */
function mergeTemplates(
  stored: Partial<Record<TemplateKey, string>> | undefined,
): Record<TemplateKey, string> {
  const merged = { ...DEFAULT_TEMPLATES };
  if (!stored) return merged;
  for (const key of TEMPLATE_KEYS) {
    const text = stored[key];
    if (typeof text === "string" && text.trim()) merged[key] = text;
  }
  return merged;
}

// ============================================================================
// SECTION 4 — Shared helpers (upsert + read-merge, no duplication)
// ============================================================================

/**
 * Fetch the singleton settings document for a group key, or null if it
 * has never been written (fresh deployment → defaults apply).
 */
async function getSettingsDoc(ctx: MutationCtx, key: SettingsKey) {
  return ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
}

/**
 * Upsert a settings group — the core singleton-per-key write.
 * If a document for `key` exists → patch its value; otherwise → insert.
 * This keeps the settings table bounded (max one row per known key).
 */
async function upsertSettings(
  ctx: MutationCtx,
  key: SettingsKey,
  value: unknown,
  updatedBy?: string,
) {
  const now = Date.now();
  const existing = await getSettingsDoc(ctx, key);
  if (existing) {
    await ctx.db.patch(existing._id, {
      value,
      updated_at: now,
      ...(updatedBy ? { updated_by: updatedBy } : {}),
    });
  } else {
    await ctx.db.insert("settings", {
      key,
      value,
      updated_at: now,
      ...(updatedBy ? { updated_by: updatedBy } : {}),
    });
  }
}

/**
 * The effective (merged) settings — the single response shape for
 * getSettings and every settings mutation.
 *
 * The settings table is bounded by design (one doc per known key, ~2 rows),
 * so `.collect()` is safe here and the table cannot grow with usage.
 */
async function readMergedSettings(ctx: QueryCtx | MutationCtx) {
  const docs = await ctx.db.query("settings").collect();
  const byKey = new Map(docs.map((doc) => [doc.key, doc.value]));

  const storedRules = byKey.get(SETTINGS_KEYS.LOYALTY_RULES) as
    | Partial<Record<TierKey, Record<string, unknown>>>
    | undefined;
  const templateStored = byKey.get(SETTINGS_KEYS.TEMPLATES) as
    | Partial<Record<TemplateKey, string>>
    | undefined;

  return {
    loyalty_rules: {
      tiers: mergeLoyaltyRules(storedRules),
    },
    templates: mergeTemplates(templateStored),
    // Last-write timestamps per group (epoch ms) — null when never customized.
    updated_at: {
      loyalty_rules:
        byKey.has(SETTINGS_KEYS.LOYALTY_RULES)
          ? docs.find((d) => d.key === SETTINGS_KEYS.LOYALTY_RULES)!.updated_at
          : null,
      templates:
        byKey.has(SETTINGS_KEYS.TEMPLATES)
          ? docs.find((d) => d.key === SETTINGS_KEYS.TEMPLATES)!.updated_at
          : null,
    },
  };
}

// ============================================================================
// SECTION 5 — Public API
// ============================================================================

/**
 * Get the complete effective settings.
 * Merges stored overrides over defaults — ALWAYS returns the full config
 * (loyalty_rules + templates), even when the DB is empty (defaults fallback).
 */
export const getSettings = query({
  args: {},
  handler: async (ctx) => readMergedSettings(ctx),
});

/**
 * Update the merchant loyalty rules (Step 5.5) — the exact payload shape the
 * Settings UI edits. Persists as a singleton `loyalty_rules` doc and returns
 * the new merged settings.
 */
export const updateSettings = mutation({
  args: {
    settings: loyaltyRulesValidator,
  },
  handler: async (ctx, { settings }) => {
    // Keep only the known tier keys + known numeric keys so a malformed
    // client payload can never pollute the stored document.
    const nextValue: Partial<Record<TierKey, Record<string, unknown>>> = {};
    for (const key of TIER_KEYS) {
      const tier = settings.tiers[key] as Record<string, unknown> | undefined;
      if (!tier) continue;
      const clean: Record<string, unknown> = {};
      for (const numField of ["purchasePercent", "birthdayBonus", "gmbPoints", "productReviewPoints"] as const) {
        const val = tier[numField];
        if (typeof val === "number") clean[numField] = val;
      }
      if (typeof tier.on === "boolean") clean.on = tier.on;
      if (Object.keys(clean).length > 0) nextValue[key] = clean;
    }

    await upsertSettings(ctx, SETTINGS_KEYS.LOYALTY_RULES, nextValue);
    return readMergedSettings(ctx);
  },
});

/**
 * Update a global WhatsApp message template (partial patch per template key).
 * Persists the override as a singleton `templates` doc and returns the new
 * merged settings.
 */
export const updateTemplate = mutation({
  args: {
    templateKey: templateKeyValidator,
    text: v.string(),
  },
  handler: async (ctx, { templateKey, text }) => {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Template text must not be empty.");

    // Merge onto the currently stored templates payload (if any).
    const existing = await getSettingsDoc(ctx, SETTINGS_KEYS.TEMPLATES);
    const stored = existing?.value as
      | Partial<Record<TemplateKey, string>>
      | undefined;
    const nextValue: Partial<Record<TemplateKey, string>> = {
      ...(stored ?? {}),
      [templateKey]: trimmed,
    };

    await upsertSettings(ctx, SETTINGS_KEYS.TEMPLATES, nextValue);
    return readMergedSettings(ctx);
  },
});

/**
 * Restore defaults: delete every settings document.
 * getSettings then falls back to DEFAULT_SETTINGS + DEFAULT_TEMPLATES, so the
 * config returned afterwards is exactly the board-approved defaults.
 */
export const resetSettings = mutation({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("settings").collect();
    for (const doc of docs) {
      await ctx.db.delete(doc._id);
    }
    return readMergedSettings(ctx);
  },
});