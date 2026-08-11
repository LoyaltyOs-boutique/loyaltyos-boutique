import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";

/**
 * LoyaltyOS Boutique — Centralized Settings backend (Step 5, PRD §8)
 * Source        : PRD §8 Settings (editable loyalty tiers, point redemption
 *                 value, store details, global message templates)
 * Design spec   : docs/superpowers/specs/2026-08-06-loyaltyos-design.md
 *                 (Decision #5 — "Merchant can tune thresholds in Settings
 *                 without schema changes")
 * Amendment     : docs/superpowers/specs/2026-08-07-convex-amendment-design.md
 *                 (Loyalty Rules Engine table: earning rate, tiers, bonuses)
 *
 * ARCHITECTURE (scalable + clean):
 *   - Singleton-per-key pattern: the `settings` table holds at most ONE
 *     document per settings group (`tier_rules` | `templates` | `general`),
 *     looked up via the `by_key` index. Bounded table — never grows with
 *     usage, no unbounded list fields.
 *   - Defaults as the single source of truth: DEFAULT_TIERS and
 *     DEFAULT_TEMPLATES live here (exported). getSettings merges stored
 *     overrides on top of defaults, so the config is COMPLETE even when the
 *     DB is empty (fresh deployment → defaults fallback). Stored wins.
 *   - Upsert helper centralizes the get-or-patch/get-or-insert logic — one
 *     implementation, reused by every settings mutation (no duplication).
 *   - Read merge is shared: getSettings and every mutation return the same
 *     merged shape via readMergedSettings(), so callers always get the full
 *     effective config after a write.
 *
 * CURRENCY INVARIANT (Global Constraint): all money/earning fields are
 * INTEGER PAISE. `earnPer100Paise` = 10,000 → 1 pt per ₹100 (Task 2).
 *
 * TIER ENUM: stored tier keys follow the schema enum
 * (silver | gold | platinum); display labels (Silver/Gold/Platinum) are
 * configurable per tier below.
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
  TIER_RULES: "tier_rules",
  TEMPLATES: "templates",
  GENERAL: "general",
} as const;

/** Union type of the known settings group keys. */
export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];

// ============================================================================
// SECTION 2 — Tier rules (PRD §8 + design spec Decision #5)
// ============================================================================

/** Tier keys — match the users.tier schema enum (silver | gold | platinum). */
export const TIER_KEYS = ["silver", "gold", "platinum"] as const;

/** Union type of the loyalty tier keys. */
export type TierKey = (typeof TIER_KEYS)[number];

/**
 * A single loyalty tier rule.
 *
 * @field label            — display label (e.g. "Silver").
 * @field multiplier       — points earning multiplier (1x / 1.5x / 2x).
 * @field earnPer100Paise  — points earned per ₹100 (10,000 paise) spent.
 * @field minPoints        — minimum points required to reach this tier.
 */
export interface TierConfig {
  label: string;
  multiplier: number;
  earnPer100Paise: number;
  minPoints: number;
}

/**
 * Validator for a partial tier-config override sent by the merchant.
 * All fields optional — only the provided fields are patched onto the
 * existing (default or stored) tier rule.
 */
export const tierConfigOverrideValidator = v.object({
  label: v.optional(v.string()),
  multiplier: v.optional(v.number()),
  earnPer100Paise: v.optional(v.number()),
  minPoints: v.optional(v.number()),
});

/**
 * DEFAULT TIERS — board-approved defaults.
 * Mirrors the Task 2 points engine: ₹100 = 1 pt (10,000 paise), tier bands
 * 0–999 / 1000–2999 / 3000+, multipliers 1x / 1.5x / 2x.
 * (Design spec display names Ivory/Champagne/Noir ↔ stored silver/gold/
 *  platinum enum per schema.)
 */
export const DEFAULT_TIERS: Record<TierKey, TierConfig> = {
  silver: { label: "Silver", multiplier: 1, earnPer100Paise: 10000, minPoints: 0 },
  gold: { label: "Gold", multiplier: 1.5, earnPer100Paise: 10000, minPoints: 1000 },
  platinum: { label: "Platinum", multiplier: 2, earnPer100Paise: 10000, minPoints: 3000 },
};

/**
 * Merge stored tier overrides over the defaults.
 * Per-tier shallow merge — only known fields of the correct type are copied,
 * so a corrupt/invalid stored payload can never break the config.
 */
function mergeTierRules(
  stored: Partial<Record<TierKey, Partial<TierConfig>>> | undefined,
): Record<TierKey, TierConfig> {
  const merged = { ...DEFAULT_TIERS } as Record<TierKey, TierConfig>;
  if (!stored) return merged;
  for (const key of TIER_KEYS) {
    const override = stored[key];
    if (!override || typeof override !== "object") continue;
    merged[key] = {
      label:
        typeof override.label === "string"
          ? override.label
          : DEFAULT_TIERS[key].label,
      multiplier:
        typeof override.multiplier === "number"
          ? override.multiplier
          : DEFAULT_TIERS[key].multiplier,
      earnPer100Paise:
        typeof override.earnPer100Paise === "number"
          ? override.earnPer100Paise
          : DEFAULT_TIERS[key].earnPer100Paise,
      minPoints:
        typeof override.minPoints === "number"
          ? override.minPoints
          : DEFAULT_TIERS[key].minPoints,
    };
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
 * The settings table is bounded by design (one doc per known key, ~3 rows),
 * so `.collect()` is safe here and the table cannot grow with usage.
 */
async function readMergedSettings(ctx: QueryCtx | MutationCtx) {
  const docs = await ctx.db.query("settings").collect();
  const byKey = new Map(docs.map((doc) => [doc.key, doc.value]));

  const tierStored = byKey.get(SETTINGS_KEYS.TIER_RULES) as
    | Partial<Record<TierKey, Partial<TierConfig>>>
    | undefined;
  const templateStored = byKey.get(SETTINGS_KEYS.TEMPLATES) as
    | Partial<Record<TemplateKey, string>>
    | undefined;

  return {
    tier_rules: mergeTierRules(tierStored),
    templates: mergeTemplates(templateStored),
    // Last-write timestamps per group (epoch ms) — null when never customized.
    updated_at: {
      tier_rules:
        byKey.has(SETTINGS_KEYS.TIER_RULES)
          ? docs.find((d) => d.key === SETTINGS_KEYS.TIER_RULES)!.updated_at
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
 * (tier_rules + templates), even when the DB is empty (defaults fallback).
 */
export const getSettings = query({
  args: {},
  handler: async (ctx) => readMergedSettings(ctx),
});

/**
 * Update a single tier's config (partial patch, e.g. { multiplier: 2 }).
 * Validates that numeric fields are provided as numbers and non-negative,
 * persists the override as a singleton `tier_rules` doc, and returns the
 * new merged settings.
 */
export const updateTierConfig = mutation({
  args: {
    tierKey: v.union(
      v.literal("silver"),
      v.literal("gold"),
      v.literal("platinum"),
    ),
    config: tierConfigOverrideValidator,
  },
  handler: async (ctx, { tierKey, config }) => {
    // Semantic validation on top of the type validator.
    if (config.multiplier !== undefined && config.multiplier < 0) {
      throw new Error("Multiplier must be zero or greater.");
    }
    if (config.minPoints !== undefined && config.minPoints < 0) {
      throw new Error("minPoints must be zero or greater.");
    }
    if (config.earnPer100Paise !== undefined && config.earnPer100Paise < 0) {
      throw new Error("earnPer100Paise must be zero or greater.");
    }

    // Merge onto the currently stored tier_rules payload (if any).
    const existing = await getSettingsDoc(ctx, SETTINGS_KEYS.TIER_RULES);
    const stored = existing?.value as
      | Partial<Record<TierKey, Partial<TierConfig>>>
      | undefined;
    const nextValue: Partial<Record<TierKey, Partial<TierConfig>>> = {
      ...(stored ?? {}),
      [tierKey]: {
        ...(stored?.[tierKey] ?? {}),
        ...config,
      },
    };

    await upsertSettings(ctx, SETTINGS_KEYS.TIER_RULES, nextValue);
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
 * getSettings then falls back to DEFAULT_TIERS + DEFAULT_TEMPLATES, so the
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