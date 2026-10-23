import { internalMutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import bcrypt from "bcryptjs";
import type { Id } from "./_generated/dataModel";
import { getDefaultBoutique } from "./boutiques";

/**
 * LoyaltyOS Boutique — multi-boutique test data (Phase 1 Batch 2).
 * Design spec: docs/superpowers/specs/2026-10-16-multi-boutique-design.md
 * Phase 1 audit: docs/superpowers/audits/2026-10-16-phase1-data-wall-audit.md §8
 *
 * TEST BACKEND ONLY. Never deploy to pleasant-cobra-560. Excluded from every
 * live release (Phase 1 audit section 15).
 */

/** Name prefix stamped on every row this file creates, wherever a name/title field exists. */
const TEST_PREFIX = "MBTEST ";

/** Synthetic mobile marker — exactly 10 digits, "00000000" + a value from 01 to 99. Real Indian mobiles never start with 0, so this can never collide with a real customer. */
function isTestMobile(m: string): boolean {
  if (!/^00000000\d\d$/.test(m)) return false;
  const n = Number(m.slice(8));
  return n >= 1 && n <= 99;
}

/**
 * Both locks shared by every function in this file, run before any write:
 * LOCK 1 — the ALLOW_TEST_SEED deployment env var must be exactly "true".
 * LOCK 2 — refuse immediately if ANY users row is not itself MBTEST-marked
 * (name prefix AND fake mobile), regardless of whether a default boutique
 * exists yet. On a real backend (pleasant-cobra-560) this refuses
 * permanently; on a genuine test backend every row is expected to already
 * be MBTEST-marked, so this passes trivially.
 */
async function assertSeedAllowed(ctx: MutationCtx): Promise<void> {
  if (process.env.ALLOW_TEST_SEED !== "true") {
    throw new Error("test seed is disabled");
  }
  for await (const row of ctx.db.query("users")) {
    if (!row.name.startsWith(TEST_PREFIX) || !isTestMobile(row.mobile)) {
      throw new Error("test seed refused: real data present");
    }
  }
}

/** 64 lowercase hex characters (32 random bytes) — same Web Crypto pattern as auth.ts's randomHex. */
function randomHex64(): string {
  const buf = new Uint8Array(32);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

type BoutiqueSeedConfig = {
  label: "Alpha" | "Beta";
  slug: string;
  name: string;
  isDefault: boolean;
  flags: Record<string, boolean>;
  merchantMobile: string;
  merchantEmail: string;
  customerMobiles: [string, string, string];
  sharedMobile: string;
  sharedName: string;
  probeValue: string;
};

const BOUTIQUE_CONFIGS: BoutiqueSeedConfig[] = [
  {
    label: "Alpha",
    slug: "mbtest-alpha",
    name: `${TEST_PREFIX}Boutique Alpha`,
    isDefault: true,
    flags: { "tab.customers": true, "customers.bulk_send_all": false },
    merchantMobile: "0000000091",
    merchantEmail: "merchant-alpha@test.invalid",
    customerMobiles: ["0000000011", "0000000012", "0000000013"],
    sharedMobile: "0000000050",
    sharedName: `${TEST_PREFIX}Shared A`,
    probeValue: "alpha",
  },
  {
    label: "Beta",
    slug: "mbtest-beta",
    name: `${TEST_PREFIX}Boutique Beta`,
    isDefault: false,
    flags: {},
    merchantMobile: "0000000092",
    merchantEmail: "merchant-beta@test.invalid",
    customerMobiles: ["0000000021", "0000000022", "0000000023"],
    sharedMobile: "0000000050",
    sharedName: `${TEST_PREFIX}Shared B`,
    probeValue: "beta",
  },
];

const TIERS: Array<"silver" | "gold" | "platinum"> = ["silver", "gold", "platinum"];

type SeedCounts = {
  boutiques: number;
  users: number;
  lookbooks: number;
  catalogue_items: number;
  orders: number;
  campaigns: number;
  settings: number;
  reviews: number;
  message_actions: number;
  points_ledger: number;
  ai_message_drafts: number;
  events: number;
  notifications: number;
  customer_activity_events: number;
  customer_activity_summaries: number;
};

function emptyCounts(): SeedCounts {
  return {
    boutiques: 0,
    users: 0,
    lookbooks: 0,
    catalogue_items: 0,
    orders: 0,
    campaigns: 0,
    settings: 0,
    reviews: 0,
    message_actions: 0,
    points_ledger: 0,
    ai_message_drafts: 0,
    events: 0,
    notifications: 0,
    customer_activity_events: 0,
    customer_activity_summaries: 0,
  };
}

/** Inserts one boutique's full set of per-table rows; mutates `counts` in place. */
async function seedOneBoutique(
  ctx: MutationCtx,
  cfg: BoutiqueSeedConfig,
  passwordHash: string,
  now: number,
  counts: SeedCounts,
): Promise<void> {
  const boutiqueId = await ctx.db.insert("boutiques", {
    name: cfg.name,
    slug: cfg.slug,
    status: "active",
    is_default: cfg.isDefault,
    one_device_lock: true,
    flags: cfg.flags,
    created_at: now,
    updated_at: now,
  });
  counts.boutiques += 1;

  const merchantName = `${TEST_PREFIX}Merchant ${cfg.label}`;
  await ctx.db.insert("users", {
    role: "merchant",
    name: merchantName,
    name_lower: merchantName.toLowerCase(),
    mobile: cfg.merchantMobile,
    email: cfg.merchantEmail,
    password_hash: passwordHash,
    boutique_id: boutiqueId,
  });
  counts.users += 1;

  const customerIds: Id<"users">[] = [];
  for (let i = 0; i < 3; i += 1) {
    const name = `${TEST_PREFIX}Customer ${cfg.label[0]}${i + 1}`;
    const id = await ctx.db.insert("users", {
      role: "customer",
      name,
      name_lower: name.toLowerCase(),
      mobile: cfg.customerMobiles[i],
      tier: TIERS[i],
      magic_token: randomHex64(),
      magic_token_created_at: now,
      whatsapp_consent: i === 0 || i === 1,
      ...(i === 0 ? { vvip: true } : {}),
      ...(i === 1 ? { vvip: false } : {}),
      boutique_id: boutiqueId,
    });
    customerIds.push(id);
    counts.users += 1;
  }
  const firstCustomerId = customerIds[0];

  await ctx.db.insert("users", {
    role: "customer",
    name: cfg.sharedName,
    name_lower: cfg.sharedName.toLowerCase(),
    mobile: cfg.sharedMobile,
    magic_token: randomHex64(),
    magic_token_created_at: now,
    boutique_id: boutiqueId,
  });
  counts.users += 1;

  const lookbookId = await ctx.db.insert("lookbooks", {
    title: `${TEST_PREFIX}Lookbook ${cfg.label}`,
    designer: `${TEST_PREFIX}Designer`,
    source: "manual",
    created_at: now,
    boutique_id: boutiqueId,
  });
  counts.lookbooks += 1;

  for (let i = 0; i < 2; i += 1) {
    await ctx.db.insert("catalogue_items", {
      lookbook_id: lookbookId,
      title: `${TEST_PREFIX}Piece ${cfg.label[0]}${i + 1}`,
      price: 1000,
      image_url: "https://example.invalid/mbtest.jpg",
      boutique_id: boutiqueId,
    });
    counts.catalogue_items += 1;
  }

  await ctx.db.insert("orders", {
    user_id: firstCustomerId,
    subtotal: 100000,
    discount_value: 0,
    payment_method: "offline",
    final_total: 100000,
    points_earned: 10,
    created_at: now,
    boutique_id: boutiqueId,
  });
  counts.orders += 1;

  await ctx.db.insert("reviews", {
    user_id: firstCustomerId,
    type: "testimonial",
    text: `${TEST_PREFIX}review pending ${cfg.label}`,
    status: "pending",
    created_at: now,
    boutique_id: boutiqueId,
  });
  await ctx.db.insert("reviews", {
    user_id: firstCustomerId,
    type: "testimonial",
    text: `${TEST_PREFIX}review approved ${cfg.label}`,
    status: "approved",
    created_at: now,
    boutique_id: boutiqueId,
  });
  counts.reviews += 2;

  await ctx.db.insert("points_ledger", {
    customer_id: firstCustomerId,
    delta: 10,
    reason_type: "normal",
    resulting_balance: 10,
    created_by: "system",
    created_at: now,
    boutique_id: boutiqueId,
  });
  counts.points_ledger += 1;

  await ctx.db.insert("message_actions", {
    customer_id: firstCustomerId,
    occasion: "birthday",
    occasion_date: "2026-1-15",
    action: "sent",
    decided_at: now,
    boutique_id: boutiqueId,
  });
  counts.message_actions += 1;

  await ctx.db.insert("ai_message_drafts", {
    customer_id: firstCustomerId,
    occasion: "birthday",
    occasion_date: "2026-1-15",
    draft_text: `${TEST_PREFIX}draft ${cfg.label}`,
    generated_at: now,
    status: "pending",
    boutique_id: boutiqueId,
  });
  counts.ai_message_drafts += 1;

  await ctx.db.insert("events", {
    designer_name: `${TEST_PREFIX}Designer`,
    event_datetime: now + 86_400_000,
    vvip_only: false,
    description: `${TEST_PREFIX}event ${cfg.label}`,
    status: "draft",
    created_at: now,
    boutique_id: boutiqueId,
  });
  counts.events += 1;

  await ctx.db.insert("events", {
    designer_name: `${TEST_PREFIX}Designer VVIP`,
    event_datetime: now + 86_400_000,
    vvip_only: true,
    description: `${TEST_PREFIX}vvip event ${cfg.label}`,
    status: "draft",
    created_at: now,
    boutique_id: boutiqueId,
  });
  counts.events += 1;

  await ctx.db.insert("notifications", {
    customer_id: firstCustomerId,
    occasion: "birthday",
    occasion_date: "2026-1-15",
    message: `${TEST_PREFIX}notification ${cfg.label}`,
    created_at: now,
    seen: false,
    boutique_id: boutiqueId,
  });
  counts.notifications += 1;

  await ctx.db.insert("notifications", {
    customer_id: firstCustomerId,
    occasion: "anniversary",
    occasion_date: "2026-2-20",
    message: `${TEST_PREFIX}seen notification ${cfg.label}`,
    created_at: now,
    seen: true,
    boutique_id: boutiqueId,
  });
  counts.notifications += 1;

  await ctx.db.insert("customer_activity_events", {
    customer_id: firstCustomerId,
    action: "like",
    created_at: now,
    boutique_id: boutiqueId,
  });
  counts.customer_activity_events += 1;

  await ctx.db.insert("customer_activity_summaries", {
    customer_id: firstCustomerId,
    summary_text: `${TEST_PREFIX}summary ${cfg.label}`,
    generated_at: now,
    boutique_id: boutiqueId,
  });
  counts.customer_activity_summaries += 1;

  await ctx.db.insert("campaigns", {
    title: `${TEST_PREFIX}Campaign ${cfg.label}`,
    creative_url: "https://example.invalid/mbtest.jpg",
    message_body: `${TEST_PREFIX}campaign body ${cfg.label}`,
    audience_segment: {},
    boutique_id: boutiqueId,
  });
  counts.campaigns += 1;

  await ctx.db.insert("settings", {
    key: "mbtest_probe",
    value: { boutique: cfg.probeValue },
    updated_at: now,
    boutique_id: boutiqueId,
  });
  counts.settings += 1;
}

export const seedMultiBoutiqueTestData = internalMutation({
  args: { password: v.string() },
  handler: async (ctx, { password }) => {
    await assertSeedAllowed(ctx);

    if (password.length < 8) {
      throw new Error("password must be at least 8 characters");
    }

    const existingAlpha = await ctx.db
      .query("boutiques")
      .withIndex("by_slug", (q) => q.eq("slug", "mbtest-alpha"))
      .unique();
    const existingBeta = await ctx.db
      .query("boutiques")
      .withIndex("by_slug", (q) => q.eq("slug", "mbtest-beta"))
      .unique();
    if (existingAlpha || existingBeta) {
      throw new Error("already seeded: run wipeMultiBoutiqueTestData first");
    }

    // Alpha is the default only when no default boutique exists yet, so the
    // backend never has two defaults (getDefaultBoutique uses .unique()).
    const defaultExists = (await getDefaultBoutique(ctx)) !== null;

    // Same bcryptjs sync hashing convex/auth.ts's merchantLogin verifies
    // against (bcrypt.compareSync) — never logged, returned, or stored
    // anywhere other than this one password_hash field.
    const passwordHash = bcrypt.hashSync(password, 10);
    const now = Date.now();

    const counts = emptyCounts();
    for (const cfg of BOUTIQUE_CONFIGS) {
      const isDefault = cfg.label === "Alpha" ? !defaultExists : false;
      await seedOneBoutique(ctx, { ...cfg, isDefault }, passwordHash, now, counts);
    }
    return counts;
  },
});

export const seedLegacyRows = internalMutation({
  args: {},
  handler: async (ctx) => {
    await assertSeedAllowed(ctx);

    for await (const row of ctx.db.query("users")) {
      if (row.name.startsWith(`${TEST_PREFIX}Legacy `)) {
        throw new Error("legacy rows already seeded: run wipeMultiBoutiqueTestData first");
      }
    }

    const now = Date.now();
    const counts = emptyCounts();

    const customerIds: Id<"users">[] = [];
    const legacyMobiles = ["0000000061", "0000000062", "0000000063"];
    for (let i = 0; i < 3; i += 1) {
      const name = `${TEST_PREFIX}Legacy C${i + 1}`;
      const id = await ctx.db.insert("users", {
        role: "customer",
        name,
        name_lower: name.toLowerCase(),
        mobile: legacyMobiles[i],
        tier: TIERS[i],
        magic_token: randomHex64(),
        magic_token_created_at: now,
        ...(i === 0 ? { whatsapp_consent: true } : {}),
      });
      customerIds.push(id);
      counts.users += 1;
    }
    const firstCustomerId = customerIds[0];

    const lookbookId = await ctx.db.insert("lookbooks", {
      title: `${TEST_PREFIX}Legacy Lookbook`,
      designer: `${TEST_PREFIX}Legacy Designer`,
      source: "manual",
      created_at: now,
    });
    counts.lookbooks += 1;

    await ctx.db.insert("catalogue_items", {
      lookbook_id: lookbookId,
      title: `${TEST_PREFIX}Legacy Piece`,
      price: 1000,
      image_url: "https://example.invalid/mbtest.jpg",
    });
    counts.catalogue_items += 1;

    await ctx.db.insert("orders", {
      user_id: firstCustomerId,
      subtotal: 100000,
      discount_value: 0,
      payment_method: "offline",
      final_total: 100000,
      points_earned: 10,
      created_at: now,
    });
    counts.orders += 1;

    await ctx.db.insert("campaigns", {
      title: `${TEST_PREFIX}Legacy Campaign`,
      creative_url: "https://example.invalid/mbtest.jpg",
      message_body: `${TEST_PREFIX}Legacy campaign body`,
      audience_segment: {},
    });
    counts.campaigns += 1;

    await ctx.db.insert("settings", {
      key: "mbtest_legacy_probe",
      value: { legacy: true },
      updated_at: now,
    });
    counts.settings += 1;

    await ctx.db.insert("reviews", {
      user_id: firstCustomerId,
      type: "testimonial",
      text: `${TEST_PREFIX}Legacy review`,
      status: "pending",
      created_at: now,
    });
    counts.reviews += 1;

    await ctx.db.insert("message_actions", {
      customer_id: firstCustomerId,
      occasion: "birthday",
      occasion_date: "2026-1-15",
      action: "sent",
      decided_at: now,
    });
    counts.message_actions += 1;

    await ctx.db.insert("points_ledger", {
      customer_id: firstCustomerId,
      delta: 10,
      reason_type: "normal",
      resulting_balance: 10,
      created_by: "system",
      created_at: now,
    });
    counts.points_ledger += 1;

    await ctx.db.insert("ai_message_drafts", {
      customer_id: firstCustomerId,
      occasion: "birthday",
      occasion_date: "2026-1-15",
      draft_text: `${TEST_PREFIX}Legacy draft`,
      generated_at: now,
      status: "pending",
    });
    counts.ai_message_drafts += 1;

    await ctx.db.insert("events", {
      designer_name: `${TEST_PREFIX}Legacy Designer`,
      event_datetime: now + 86_400_000,
      vvip_only: false,
      description: `${TEST_PREFIX}Legacy event`,
      status: "draft",
      created_at: now,
    });
    counts.events += 1;

    await ctx.db.insert("notifications", {
      customer_id: firstCustomerId,
      occasion: "birthday",
      occasion_date: "2026-1-15",
      message: `${TEST_PREFIX}Legacy notification`,
      created_at: now,
      seen: false,
    });
    counts.notifications += 1;

    await ctx.db.insert("customer_activity_events", {
      customer_id: firstCustomerId,
      action: "like",
      created_at: now,
    });
    counts.customer_activity_events += 1;

    await ctx.db.insert("customer_activity_summaries", {
      customer_id: firstCustomerId,
      summary_text: `${TEST_PREFIX}Legacy summary`,
      generated_at: now,
    });
    counts.customer_activity_summaries += 1;

    return counts;
  },
});

export const wipeMultiBoutiqueTestData = internalMutation({
  args: { includeDefaultBoutique: v.optional(v.boolean()) },
  handler: async (ctx, { includeDefaultBoutique }) => {
    await assertSeedAllowed(ctx);

    const markedUserIds = new Set<Id<"users">>();
    for await (const row of ctx.db.query("users")) {
      if (row.name.startsWith(TEST_PREFIX) && isTestMobile(row.mobile)) {
        markedUserIds.add(row._id);
      }
    }

    const markedBoutiqueIds = new Set<Id<"boutiques">>();
    for await (const row of ctx.db.query("boutiques")) {
      if (row.name.startsWith(TEST_PREFIX)) {
        markedBoutiqueIds.add(row._id);
      }
    }
    if (includeDefaultBoutique === true) {
      const legacyDefault = await ctx.db
        .query("boutiques")
        .withIndex("by_slug", (q) => q.eq("slug", "85-lansdowne"))
        .unique();
      if (legacyDefault) {
        markedBoutiqueIds.add(legacyDefault._id);
      }
    }

    const counts: Record<string, number> = {
      boutiques: 0,
      boutique_secrets: 0,
      users: 0,
      lookbooks: 0,
      catalogue_items: 0,
      orders: 0,
      campaigns: 0,
      settings: 0,
      reviews: 0,
      message_actions: 0,
      points_ledger: 0,
      ai_message_drafts: 0,
      events: 0,
      notifications: 0,
      customer_activity_events: 0,
      customer_activity_summaries: 0,
    };

    // Lookbooks matched first, so catalogue_items can also match on a
    // deleted lookbook_id (spec: "or a deleted lookbook").
    const markedLookbookIds = new Set<Id<"lookbooks">>();
    for await (const row of ctx.db.query("lookbooks")) {
      if (
        (row.boutique_id !== undefined && markedBoutiqueIds.has(row.boutique_id)) ||
        row.title.startsWith(TEST_PREFIX)
      ) {
        markedLookbookIds.add(row._id);
      }
    }

    for await (const row of ctx.db.query("catalogue_items")) {
      if (
        (row.boutique_id !== undefined && markedBoutiqueIds.has(row.boutique_id)) ||
        markedLookbookIds.has(row.lookbook_id) ||
        row.title.startsWith(TEST_PREFIX)
      ) {
        await ctx.db.delete(row._id);
        counts.catalogue_items += 1;
      }
    }

    for await (const row of ctx.db.query("lookbooks")) {
      if (markedLookbookIds.has(row._id)) {
        await ctx.db.delete(row._id);
        counts.lookbooks += 1;
      }
    }

    for await (const row of ctx.db.query("orders")) {
      if (
        (row.boutique_id !== undefined && markedBoutiqueIds.has(row.boutique_id)) ||
        markedUserIds.has(row.user_id)
      ) {
        await ctx.db.delete(row._id);
        counts.orders += 1;
      }
    }

    for await (const row of ctx.db.query("campaigns")) {
      if (
        (row.boutique_id !== undefined && markedBoutiqueIds.has(row.boutique_id)) ||
        row.title.startsWith(TEST_PREFIX)
      ) {
        await ctx.db.delete(row._id);
        counts.campaigns += 1;
      }
    }

    for await (const row of ctx.db.query("settings")) {
      if (
        (row.boutique_id !== undefined && markedBoutiqueIds.has(row.boutique_id)) ||
        row.key === "mbtest_probe" ||
        row.key === "mbtest_legacy_probe"
      ) {
        await ctx.db.delete(row._id);
        counts.settings += 1;
      }
    }

    for await (const row of ctx.db.query("reviews")) {
      if (
        (row.boutique_id !== undefined && markedBoutiqueIds.has(row.boutique_id)) ||
        markedUserIds.has(row.user_id) ||
        row.text.startsWith(TEST_PREFIX)
      ) {
        await ctx.db.delete(row._id);
        counts.reviews += 1;
      }
    }

    for await (const row of ctx.db.query("message_actions")) {
      if (
        (row.boutique_id !== undefined && markedBoutiqueIds.has(row.boutique_id)) ||
        markedUserIds.has(row.customer_id)
      ) {
        await ctx.db.delete(row._id);
        counts.message_actions += 1;
      }
    }

    for await (const row of ctx.db.query("points_ledger")) {
      if (
        (row.boutique_id !== undefined && markedBoutiqueIds.has(row.boutique_id)) ||
        markedUserIds.has(row.customer_id)
      ) {
        await ctx.db.delete(row._id);
        counts.points_ledger += 1;
      }
    }

    for await (const row of ctx.db.query("ai_message_drafts")) {
      if (
        (row.boutique_id !== undefined && markedBoutiqueIds.has(row.boutique_id)) ||
        markedUserIds.has(row.customer_id)
      ) {
        await ctx.db.delete(row._id);
        counts.ai_message_drafts += 1;
      }
    }

    for await (const row of ctx.db.query("events")) {
      if (
        (row.boutique_id !== undefined && markedBoutiqueIds.has(row.boutique_id)) ||
        row.designer_name.startsWith(TEST_PREFIX)
      ) {
        await ctx.db.delete(row._id);
        counts.events += 1;
      }
    }

    for await (const row of ctx.db.query("notifications")) {
      if (
        (row.boutique_id !== undefined && markedBoutiqueIds.has(row.boutique_id)) ||
        markedUserIds.has(row.customer_id)
      ) {
        await ctx.db.delete(row._id);
        counts.notifications += 1;
      }
    }

    for await (const row of ctx.db.query("customer_activity_events")) {
      if (
        (row.boutique_id !== undefined && markedBoutiqueIds.has(row.boutique_id)) ||
        markedUserIds.has(row.customer_id)
      ) {
        await ctx.db.delete(row._id);
        counts.customer_activity_events += 1;
      }
    }

    for await (const row of ctx.db.query("customer_activity_summaries")) {
      if (
        (row.boutique_id !== undefined && markedBoutiqueIds.has(row.boutique_id)) ||
        markedUserIds.has(row.customer_id)
      ) {
        await ctx.db.delete(row._id);
        counts.customer_activity_summaries += 1;
      }
    }

    for await (const row of ctx.db.query("boutique_secrets")) {
      if (markedBoutiqueIds.has(row.boutique_id)) {
        await ctx.db.delete(row._id);
        counts.boutique_secrets += 1;
      }
    }

    for (const id of markedUserIds) {
      await ctx.db.delete(id);
      counts.users += 1;
    }
    for (const id of markedBoutiqueIds) {
      await ctx.db.delete(id);
      counts.boutiques += 1;
    }

    return counts;
  },
});
