import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import bcrypt from "bcryptjs";

/**
 * LoyaltyOS Boutique — Auth functions (Step 3)
 * Source        : PRD §3.1 (Secure Merchant Access), §3.2 (Frictionless Magic-Link)
 * Design spec   : docs/superpowers/specs/2026-08-06-loyaltyos-design.md
 * Amendment     : docs/superpowers/specs/2026-08-07-convex-amendment-design.md
 *
 * Security model:
 *  - Merchant: bcrypt-hashed password (never plaintext), email+password login,
 *    self-service forgot-password token (24h, logged as mock email), 7-day session token.
 *  - Customer : zero-login crypto magic link — 256-bit random token, 180-day validity
 *    (PRD §3.2 "Secure sessions persist ... for 180 days unless cleared").
 *
 * Tokens use globalThis.crypto.getRandomValues (Web Crypto — available in the
 * Convex default runtime; Node's crypto randomBytes is NOT). 32 bytes → 64 hex chars.
 *
 * Contract parity: merchantLogin returns the full merchant user object (or null),
 * mirroring src/lib/db.js merchantLogin so the frontend can swap in later without
 * changing its caller shape.
 */

/** Portal base URL used in generated magic links (Vercel main site). */
const PORTAL_BASE_URL = "https://loyaltyos-boutique-three.vercel.app";

/** PRD §3.1 — merchant session lifespan: 7 days. */
const SESSION_DAYS = 7;
/** PRD §3.2 — customer magic-link lifespan: 180 days. */
const MAGIC_LINK_DAYS = 180;
/** Forgot-password reset token lifespan: 24 hours. */
const RESET_HOURS = 24;

const DAY_MS = 86_400_000;

/** Cryptographically secure random hex string (Web Crypto, sync, no Node builtins). */
function randomHex(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fixed bcrypt hash of a random string — used for timing-safe compare when no user exists. */
const DUMMY_HASH =
  "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

type UserDoc = import("./_generated/dataModel").Doc<"users">;

/** Public projection of a user doc — never leaks password/reset/session secrets. */
function toPublicUser(doc: UserDoc) {
  return {
    id: String(doc._id),
    _id: doc._id,
    email: doc.email ?? null,
    mobile: doc.mobile,
    role: doc.role,
    name: doc.name,
    points: doc.points ?? 0,
    birthday: doc.birthday ?? null,
    anniversary: doc.anniversary ?? null,
    tier: doc.tier ?? "silver",
    custom_tags: doc.custom_tags ?? [],
  };
}

/**
 * PRD §3.1 — Merchant email + password login.
 * Looks up users.by_email, verifies role === "merchant" and the bcrypt hash,
 * then issues a 256-bit session token (7-day expiry) persisted on the user.
 * Returns { user, token, expiresAt } or null on bad credentials.
 */
export const merchantLogin = mutation({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, { email, password }) => {
    const normalized = email.trim().toLowerCase();
    const merchant = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .first();

    if (!merchant || merchant.role !== "merchant" || !merchant.password_hash) {
      // Timing-safe no-op compare so missing users don't respond faster.
      await bcrypt.compare(password, DUMMY_HASH);
      return null;
    }

    const valid = await bcrypt.compare(password, merchant.password_hash);
    if (!valid) return null;

    const token = randomHex();
    const now = Date.now();
    const expiresAt = now + SESSION_DAYS * DAY_MS;
    await ctx.db.patch(merchant._id, {
      session_token: token,
      session_expiry: expiresAt,
    });

    return { user: toPublicUser(merchant), token, expiresAt };
  },
});

/**
 * PRD §3.2 — Generate a zero-login crypto magic link for a customer.
 * Finds the user by users.by_mobile, rotates the magic token (256-bit),
 * stamps magic_token_created_at for the 180-day expiry check, and returns
 * the personalised portal link: <base>/lookbook?id=<_id>&token=<token>
 */
export const generateMagicToken = mutation({
  args: {
    mobile: v.string(),
    baseUrl: v.optional(v.string()),
  },
  handler: async (ctx, { mobile, baseUrl }) => {
    const digits = mobile.replace(/\D/g, "");
    const customer = await ctx.db
      .query("users")
      .withIndex("by_mobile", (q) => q.eq("mobile", digits))
      .first();
    if (!customer || customer.role !== "customer") return null;

    const token = randomHex();
    const now = Date.now();
    const expiresAt = now + MAGIC_LINK_DAYS * DAY_MS;
    await ctx.db.patch(customer._id, {
      magic_token: token,
      magic_token_created_at: now,
    });

    const base = (baseUrl ?? PORTAL_BASE_URL).replace(/\/+$/, "");
    const magicLink = `${base}/lookbook?id=${customer._id}&token=${token}`;
    return {
      user: toPublicUser(customer),
      magicLink,
      token,
      expiresAt,
    };
  },
});

/**
 * PRD §3.2 — Validate a customer magic link.
 * Looks up users.by_magic_token, checks the token belongs to the given id,
 * and enforces the 180-day lifespan via magic_token_created_at.
 * Accepts an optional `now` (epoch ms) so the client can refresh the clock —
 * queries must not read the wall clock (reactive-cache guideline).
 * Returns { user, expiresAt } or null when invalid/expired.
 */
export const validateMagicToken = query({
  args: {
    id: v.string(),
    token: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, { id, token, now }) => {
    const customer = await ctx.db
      .query("users")
      .withIndex("by_magic_token", (q) => q.eq("magic_token", token))
      .first();
    if (!customer || customer.role !== "customer") return null;
    if (String(customer._id) !== id) return null;

    const createdAt = customer.magic_token_created_at;
    if (!createdAt || Number.isNaN(createdAt)) return null;

    const nowMs = now ?? Date.now();
    const expiresAt = createdAt + MAGIC_LINK_DAYS * DAY_MS;
    if (nowMs > expiresAt) return null;

    return { user: toPublicUser(customer), expiresAt };
  },
});

/**
 * PRD §3.1 — Forgot password (merchant self-service reset).
 * Finds the merchant by email, issues a 256-bit reset token valid 24h,
 * persists it (reset_token, reset_expiry), and logs the reset link to the
 * console as the mock email channel (Phase 1). Always returns { ok: true }
 * so the endpoint cannot be used for account enumeration.
 */
export const forgotPassword = mutation({
  args: {
    email: v.string(),
    baseUrl: v.optional(v.string()),
  },
  handler: async (ctx, { email, baseUrl }) => {
    const normalized = email.trim().toLowerCase();
    const merchant = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .first();

    if (merchant && merchant.role === "merchant") {
      const resetToken = randomHex();
      const resetExpiry = Date.now() + RESET_HOURS * 3_600_000;
      await ctx.db.patch(merchant._id, { reset_token: resetToken, reset_expiry: resetExpiry });
      const base = (baseUrl ?? PORTAL_BASE_URL).replace(/\/+$/, "");
      // Mock email channel — Phase 2 will send via a real email provider.
      console.log(
        `[forgotPassword] RESET LINK for ${merchant.email}: ${base}/reset-password?id=${merchant._id}&token=${resetToken}`,
      );
    }
    // Deliberately identical response whether or not the account exists.
    return { ok: true };
  },
});