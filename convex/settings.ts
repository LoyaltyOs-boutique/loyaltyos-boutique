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
  // Templates Phase 3 — merchant-replaceable Anniversary/Birthday card
  // images. Deliberately NOT named "templates" — that key already means
  // WhatsApp message-copy templates (PRD §8) and would silently collide.
  TEMPLATE_CARDS: "template_cards",
  // WhatsApp Cloud API integration — approved template METADATA (name +
  // language) registered in WhatsApp Manager for Anniversary/Birthday sends.
  // Distinct from both "templates" (message-copy text) and "template_cards"
  // (card image URLs) — confirmed no collision (grep shows only those two
  // existing string values in this file).
  WHATSAPP_TEMPLATES: "whatsapp_templates",
  // Merchant-editable promo copy (Discount%, Coupon Code, Valid Days) shown
  // in the Approve & Send modal for Anniversary/Birthday. DELIBERATELY a
  // DIFFERENT key from WHATSAPP_TEMPLATES above, even though the names look
  // similar side-by-side: WHATSAPP_TEMPLATES holds the Meta-approved
  // template's {name, language} metadata (gates whether Cloud API can send
  // at all); WHATSAPP_TEMPLATE_CONFIG holds free-text discount/coupon/
  // validity fields the merchant can edit anytime, unrelated to template
  // approval status. Same naming-collision-avoidance discipline as
  // TEMPLATE_CARDS vs "templates" above — confirmed no collision via grep.
  WHATSAPP_TEMPLATE_CONFIG: "whatsapp_template_config",
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
 * @field anniversaryBonus    — flat bonus points awarded on a customer's anniversary.
 * @field gmbPoints           — bonus points per approved Google review.
 * @field productReviewPoints — bonus points per in-app product review.
 * @field testimonialBonus    — bonus points per approved testimonial.
 * @field on                  — UI toggle; true → the tier's own rule set applies
 *                              (silver/gold/platinum only — global is always on).
 */
export const tierRuleValidator = v.object({
  purchasePercent: v.optional(v.number()),
  birthdayBonus: v.optional(v.number()),
  anniversaryBonus: v.optional(v.number()),
  gmbPoints: v.optional(v.number()),
  productReviewPoints: v.optional(v.number()),
  testimonialBonus: v.optional(v.number()),
  on: v.optional(v.boolean()),
});

/** Validator for the complete `loyalty_rules` payload the Settings UI sends. */
export const loyaltyRulesValidator = v.object({
  tiers: v.object({
    global: v.object({
      purchasePercent: v.optional(v.number()),
      birthdayBonus: v.optional(v.number()),
      anniversaryBonus: v.optional(v.number()),
      gmbPoints: v.optional(v.number()),
      productReviewPoints: v.optional(v.number()),
      testimonialBonus: v.optional(v.number()),
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
      anniversaryBonus: number;
      gmbPoints: number;
      productReviewPoints: number;
      testimonialBonus: number;
      on?: boolean;
    }
  >;
} = {
  tiers: {
    global: { purchasePercent: 5, birthdayBonus: 200, anniversaryBonus: 200, gmbPoints: 500, productReviewPoints: 150, testimonialBonus: 150 },
    silver: { purchasePercent: 4, birthdayBonus: 150, anniversaryBonus: 150, gmbPoints: 400, productReviewPoints: 100, testimonialBonus: 100, on: true },
    gold: { purchasePercent: 5, birthdayBonus: 200, anniversaryBonus: 200, gmbPoints: 500, productReviewPoints: 150, testimonialBonus: 150, on: true },
    platinum: { purchasePercent: 7, birthdayBonus: 350, anniversaryBonus: 350, gmbPoints: 750, productReviewPoints: 250, testimonialBonus: 250, on: true },
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
    for (const numField of ["purchasePercent", "birthdayBonus", "anniversaryBonus", "gmbPoints", "productReviewPoints", "testimonialBonus"] as const) {
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
// SECTION 3B — Template card images (Templates Phase 3)
// Design spec: docs/superpowers/specs/2026-08-22-templates-phase3-replaceable-cards-design.md
// ============================================================================

/** Card type keys — the two merchant-replaceable card images. */
export const TEMPLATE_CARD_KEYS = ["anniversary", "birthday"] as const;

/** Union type of the template card keys. */
export type TemplateCardKey = (typeof TEMPLATE_CARD_KEYS)[number];

/** Validator for the card type argument. */
export const templateCardKeyValidator = v.union(
  v.literal("anniversary"),
  v.literal("birthday"),
);

/**
 * DEFAULT TEMPLATE CARDS — Ma'am's real card designs, already uploaded to
 * Vercel Blob (Templates Phase 2). Used whenever the "template_cards"
 * settings doc doesn't exist yet, or is missing one of the two fields —
 * this guarantees getTemplateCardUrls/setTemplateCardUrl always resolve to
 * a real URL, never null/undefined.
 */
export const DEFAULT_TEMPLATE_CARDS: Record<TemplateCardKey, string> = {
  anniversary: "https://kya9cip96sntdsv4.public.blob.vercel-storage.com/anniversary-card-v3-j8Wx0uuIVRtNeJ4HPnEgYzfBdoUWdi.png",
  birthday: "https://kya9cip96sntdsv4.public.blob.vercel-storage.com/birthday-card-v3-ceGMUhD5Iwq0AP0f99yotycwhEBCJv.png",
};

/**
 * Merge the stored "template_cards" value over the defaults — same
 * missing-field-safe pattern as mergeTemplates above, so a partially
 * written doc (or none at all) still resolves both fields to real URLs.
 */
function mergeTemplateCards(
  stored: Partial<Record<TemplateCardKey, string>> | undefined,
): Record<TemplateCardKey, string> {
  return {
    anniversary: stored?.anniversary || DEFAULT_TEMPLATE_CARDS.anniversary,
    birthday: stored?.birthday || DEFAULT_TEMPLATE_CARDS.birthday,
  };
}

// ============================================================================
// SECTION 3C — WhatsApp Cloud API template metadata
// Design spec: docs/superpowers/specs/2026-08-24-whatsapp-cloud-api-design.md
// ============================================================================

/** Moment type keys — the two approved-template slots (mirrors TEMPLATE_CARD_KEYS). */
export const WHATSAPP_TEMPLATE_TYPE_KEYS = ["anniversary", "birthday"] as const;

/** Union type of the WhatsApp template type keys. */
export type WhatsAppTemplateType = (typeof WHATSAPP_TEMPLATE_TYPE_KEYS)[number];

/** Validator for the moment-type argument. */
export const whatsAppTemplateTypeValidator = v.union(
  v.literal("anniversary"),
  v.literal("birthday"),
);

/** A single approved template's metadata — name + language, as registered in WhatsApp Manager. */
export const whatsAppTemplateConfigValidator = v.object({
  name: v.string(),
  language: v.string(),
});

/** Shape of one stored (or default/empty) template config — null until approved & configured. */
type WhatsAppTemplateConfig = { name: string; language: string } | null;

/**
 * DEFAULT WHATSAPP TEMPLATES — empty until Ma'am/Saidul create & approve real
 * templates in WhatsApp Manager (Decision 2, manual — not automated here).
 * null is a real, expected state: the frontend treats it as "no template
 * configured yet" and falls back to the wa.me link (Decision 3), not an error.
 */
export const DEFAULT_WHATSAPP_TEMPLATES: Record<WhatsAppTemplateType, WhatsAppTemplateConfig> = {
  anniversary: null,
  birthday: null,
};

/**
 * Merge the stored "whatsapp_templates" value over the defaults — same
 * missing-field-safe pattern as mergeTemplateCards above, so a partially
 * written doc (or none at all) still resolves both fields, defaulting any
 * missing/unset entry to null rather than crashing or omitting the field.
 */
function mergeWhatsAppTemplates(
  stored: Partial<Record<WhatsAppTemplateType, WhatsAppTemplateConfig>> | undefined,
): Record<WhatsAppTemplateType, WhatsAppTemplateConfig> {
  return {
    anniversary: stored?.anniversary ?? DEFAULT_WHATSAPP_TEMPLATES.anniversary,
    birthday: stored?.birthday ?? DEFAULT_WHATSAPP_TEMPLATES.birthday,
  };
}

// ============================================================================
// SECTION 3D — WhatsApp promo config (Discount / Coupon / Valid Days)
// Design spec: docs/superpowers/specs/2026-08-24-whatsapp-template-config-approval-flow-design.md
//
// NOTE ON WHY THIS IS SEPARATE FROM SECTION 3C ABOVE: whatsAppTemplateConfigValidator
// (3C) validates the Meta-approved template's {name, language} METADATA — it
// gates whether a Cloud API send can happen at all. The validator below,
// whatsAppTemplateConfigFieldsValidator, validates merchant-editable PROMO
// TEXT (discount/coupon/validity) that the merchant can freely change anytime
// on the Templates page, with zero relation to template-approval status. Two
// different shapes, two different settings keys, two different purposes —
// deliberately named distinctly (…ConfigValidator vs …ConfigFieldsValidator)
// so they can't be confused when read side-by-side.
// ============================================================================

/** Validator for one moment type's promo-config fields (Discount%, Coupon Code, Valid Days). */
export const whatsAppTemplateConfigFieldsValidator = v.object({
  discountPercent: v.string(),
  couponCode: v.string(),
  validDays: v.string(),
});

/** Shape of one stored (or default) promo-config entry — plain editable text fields. */
type WhatsAppTemplateConfigFields = {
  discountPercent: string;
  couponCode: string;
  validDays: string;
};

/**
 * DEFAULT WHATSAPP TEMPLATE CONFIG — all empty strings, not null. These are
 * simple free-text fields (Discount%, Coupon Code, Valid Days); an empty
 * string is itself a valid "merchant hasn't filled this in yet" state,
 * unlike Section 3C's `null` (which means "no approved template exists").
 */
export const DEFAULT_WHATSAPP_TEMPLATE_CONFIG: Record<WhatsAppTemplateType, WhatsAppTemplateConfigFields> = {
  anniversary: { discountPercent: "", couponCode: "", validDays: "" },
  birthday: { discountPercent: "", couponCode: "", validDays: "" },
};

/**
 * Merge the stored "whatsapp_template_config" value over the defaults — same
 * missing-field-safe pattern as mergeTemplateCards/mergeWhatsAppTemplates
 * above, so a partially written doc (or none at all) still resolves both
 * moment types to a full, never-partially-undefined fields object.
 */
function mergeWhatsAppTemplateConfig(
  stored: Partial<Record<WhatsAppTemplateType, Partial<WhatsAppTemplateConfigFields>>> | undefined,
): Record<WhatsAppTemplateType, WhatsAppTemplateConfigFields> {
  return {
    anniversary: stored?.anniversary
      ? { ...DEFAULT_WHATSAPP_TEMPLATE_CONFIG.anniversary, ...stored.anniversary }
      : DEFAULT_WHATSAPP_TEMPLATE_CONFIG.anniversary,
    birthday: stored?.birthday
      ? { ...DEFAULT_WHATSAPP_TEMPLATE_CONFIG.birthday, ...stored.birthday }
      : DEFAULT_WHATSAPP_TEMPLATE_CONFIG.birthday,
  };
}

// ============================================================================
// SECTION 4 — Shared helpers (upsert + read-merge, no duplication)
// ============================================================================

/**
 * Fetch the singleton settings document for a group key, or null if it
 * has never been written (fresh deployment → defaults apply).
 */
async function getSettingsDoc(ctx: QueryCtx | MutationCtx, key: SettingsKey) {
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
      for (const numField of ["purchasePercent", "birthdayBonus", "anniversaryBonus", "gmbPoints", "productReviewPoints", "testimonialBonus"] as const) {
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
 * Get the current active Anniversary/Birthday card image URLs
 * (Templates Phase 3). Falls back to DEFAULT_TEMPLATE_CARDS for either
 * field that's missing or if the doc has never been written — never
 * returns null/undefined, matching the design spec's requirement that
 * middleware.js's fail-open path always has a real URL to redirect to.
 */
export const getTemplateCardUrls = query({
  args: {},
  handler: async (ctx) => {
    const doc = await getSettingsDoc(ctx, SETTINGS_KEYS.TEMPLATE_CARDS);
    const stored = doc?.value as Partial<Record<TemplateCardKey, string>> | undefined;
    return mergeTemplateCards(stored);
  },
});

/**
 * Replace ONE card type's active image URL, leaving the other untouched.
 *
 * CRITICAL: upsertSettings performs a WHOLE-VALUE overwrite, not a deep
 * merge (see its implementation above) — so this reads the current merged
 * value first and spreads it before overriding only `type`, exactly
 * mirroring updateTemplate's read-merge-write pattern above. A naive
 * upsertSettings(ctx, KEY, { [type]: url }) would silently wipe the other
 * card type's stored URL — this is the bug the design spec's review caught.
 */
export const setTemplateCardUrl = mutation({
  args: {
    type: templateCardKeyValidator,
    url: v.string(),
  },
  handler: async (ctx, { type, url }) => {
    const existing = await getSettingsDoc(ctx, SETTINGS_KEYS.TEMPLATE_CARDS);
    const stored = existing?.value as Partial<Record<TemplateCardKey, string>> | undefined;
    const current = mergeTemplateCards(stored); // spread the full current state first
    const nextValue: Record<TemplateCardKey, string> = { ...current, [type]: url }; // override only the changed field
    await upsertSettings(ctx, SETTINGS_KEYS.TEMPLATE_CARDS, nextValue);
    return nextValue;
  },
});

/**
 * Get the current approved WhatsApp template metadata (name + language) for
 * Anniversary/Birthday, or `{ anniversary: null, birthday: null }` if the
 * settings doc doesn't exist yet (expected state before templates are
 * approved in WhatsApp Manager — not an error).
 */
export const getWhatsAppTemplates = query({
  args: {},
  handler: async (ctx) => {
    const doc = await getSettingsDoc(ctx, SETTINGS_KEYS.WHATSAPP_TEMPLATES);
    const stored = doc?.value as
      | Partial<Record<WhatsAppTemplateType, WhatsAppTemplateConfig>>
      | undefined;
    return mergeWhatsAppTemplates(stored);
  },
});

/**
 * Set ONE moment type's approved template config, leaving the other
 * untouched.
 *
 * Same read-merge-write discipline as setTemplateCardUrl above — reads the
 * current merged value first and spreads it before overriding only `type`,
 * so this does NOT risk the whole-value-overwrite bug that an earlier
 * design review in this codebase specifically caught and fixed for
 * setTemplateCardUrl. A naive upsertSettings(ctx, KEY, { [type]: config })
 * would silently wipe the other moment type's stored config.
 */
export const setWhatsAppTemplate = mutation({
  args: {
    type: whatsAppTemplateTypeValidator,
    config: whatsAppTemplateConfigValidator,
  },
  handler: async (ctx, { type, config }) => {
    const existing = await getSettingsDoc(ctx, SETTINGS_KEYS.WHATSAPP_TEMPLATES);
    const stored = existing?.value as
      | Partial<Record<WhatsAppTemplateType, WhatsAppTemplateConfig>>
      | undefined;
    const current = mergeWhatsAppTemplates(stored); // spread the full current state first
    const nextValue: Record<WhatsAppTemplateType, WhatsAppTemplateConfig> = {
      ...current,
      [type]: config, // override only the changed field
    };
    await upsertSettings(ctx, SETTINGS_KEYS.WHATSAPP_TEMPLATES, nextValue);
    return nextValue;
  },
});

/**
 * Clear ONE moment type's approved template config back to `null`, leaving
 * the other untouched.
 *
 * WHY THIS EXISTS: `setWhatsAppTemplate`'s `config` argument is validated by
 * whatsAppTemplateConfigValidator, which requires non-optional `name`/
 * `language` strings — it CANNOT accept `null`, so there was no way to undo
 * a test/placeholder value and restore the true "not configured yet" state.
 * This mutation fills that gap with a dedicated, narrowly-scoped clear
 * operation instead of loosening setWhatsAppTemplate's validator.
 *
 * Same read-merge-write discipline as setWhatsAppTemplate/setTemplateCardUrl
 * above — reads the current merged value first and spreads it before
 * overriding only `type` to null, so this does NOT risk the whole-value-
 * overwrite bug an earlier design review in this codebase caught for
 * setTemplateCardUrl. A naive upsertSettings(ctx, KEY, { [type]: null })
 * would silently wipe the other moment type's stored config.
 */
export const clearWhatsAppTemplate = mutation({
  args: {
    type: whatsAppTemplateTypeValidator,
  },
  handler: async (ctx, { type }) => {
    const existing = await getSettingsDoc(ctx, SETTINGS_KEYS.WHATSAPP_TEMPLATES);
    const stored = existing?.value as
      | Partial<Record<WhatsAppTemplateType, WhatsAppTemplateConfig>>
      | undefined;
    const current = mergeWhatsAppTemplates(stored); // spread the full current state first
    const nextValue: Record<WhatsAppTemplateType, WhatsAppTemplateConfig> = {
      ...current,
      [type]: null, // override only the changed field, back to "not configured"
    };
    await upsertSettings(ctx, SETTINGS_KEYS.WHATSAPP_TEMPLATES, nextValue);
    return nextValue;
  },
});

/**
 * Get the current merchant-configured promo copy (Discount%, Coupon Code,
 * Valid Days) for Anniversary/Birthday. Always returns the full merged
 * shape — real stored data wins over DEFAULT_WHATSAPP_TEMPLATE_CONFIG, and
 * a never-written doc simply returns the all-empty-string defaults (not an
 * error state — matches the merchant not having filled the fields in yet).
 */
export const getWhatsAppTemplateConfig = query({
  args: {},
  handler: async (ctx) => {
    const doc = await getSettingsDoc(ctx, SETTINGS_KEYS.WHATSAPP_TEMPLATE_CONFIG);
    const stored = doc?.value as
      | Partial<Record<WhatsAppTemplateType, Partial<WhatsAppTemplateConfigFields>>>
      | undefined;
    return mergeWhatsAppTemplateConfig(stored);
  },
});

/**
 * Set ONE moment type's promo config (Discount%, Coupon Code, Valid Days),
 * leaving the other moment type untouched.
 *
 * Same read-merge-write discipline as setWhatsAppTemplate/setTemplateCardUrl
 * above — reads the current merged value first and spreads it before
 * overriding only `type`, so this does NOT risk the whole-value-overwrite
 * bug that an earlier design review in this codebase specifically caught
 * and fixed for setTemplateCardUrl. A naive
 * upsertSettings(ctx, KEY, { [type]: config }) would silently wipe the
 * other moment type's stored promo config.
 */
export const setWhatsAppTemplateConfig = mutation({
  args: {
    type: whatsAppTemplateTypeValidator,
    config: whatsAppTemplateConfigFieldsValidator,
  },
  handler: async (ctx, { type, config }) => {
    const existing = await getSettingsDoc(ctx, SETTINGS_KEYS.WHATSAPP_TEMPLATE_CONFIG);
    const stored = existing?.value as
      | Partial<Record<WhatsAppTemplateType, Partial<WhatsAppTemplateConfigFields>>>
      | undefined;
    const current = mergeWhatsAppTemplateConfig(stored); // spread the full current state first
    const nextValue: Record<WhatsAppTemplateType, WhatsAppTemplateConfigFields> = {
      ...current,
      [type]: config, // override only the changed field
    };
    await upsertSettings(ctx, SETTINGS_KEYS.WHATSAPP_TEMPLATE_CONFIG, nextValue);
    return nextValue;
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