import { action, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireMerchantSession } from "./auth";

/**
 * Gemini AI integration — Phase A plumbing only.
 * Design spec: docs/superpowers/specs/2026-09-03-ai-automation-architecture-design.md §1, §6 (Phase A)
 *
 * This file introduces ONE shared internal helper (callGemini) that every
 * future AI feature (Phase B generateMessageDraft, Phase C
 * generateLookbookRanking, ...) will call. No feature is built on top of it
 * yet — this phase's only job is to prove the plumbing works end-to-end
 * while leaving the app fully functional with the key unset.
 *
 * Same env-secret / guard-clause shape as convex/whatsapp.ts (secrets read
 * from process.env INSIDE the handler, never module scope, so a missing
 * credential fails at call time not deploy time) — with ONE deliberate
 * difference from whatsapp.ts: whatsapp.ts's actions THROW on failure and
 * let the frontend catch it (message-sending is a user-initiated action that
 * should surface an error). Gemini calls are the opposite — per the design
 * spec ("fail gracefully — caught, logged, falls back to the plain
 * hardcoded template"), callGemini() NEVER throws. Every failure path
 * (missing key, network error, non-ok response, timeout) resolves to
 * { success: false } so callers can silently fall back to the existing
 * hardcoded template with zero risk of blocking the merchant's flow.
 *
 * Credentials (Convex env var, set later via `npx convex env set`, never
 * committed):
 *  - GEMINI_API_KEY — Google AI Studio / Gemini API key.
 *
 * Until that env var is set, callGemini() logs a clear message and resolves
 * to { success: false } immediately — no fetch call is attempted.
 */

// ============================================================================
// SECTION 1 — Shared helpers
// ============================================================================

/**
 * Gemini REST endpoint — pinned to a stable dated model (gemini-2.0-flash),
 * not "latest", matching whatsapp.ts's GRAPH_API_VERSION pinning discipline.
 * Endpoint shape confirmed against Google's official Gemini API reference
 * (generateContent method) — see PR/report citation for source URLs.
 */
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/** Hard timeout so a slow/hanging Gemini call can never block the merchant flow. */
const GEMINI_TIMEOUT_MS = 10_000;

/** Result shape every callGemini() caller gets — never a thrown error. */
type GeminiResult = { success: true; text: string } | { success: false };

/**
 * Shared internal helper — the ONE place that knows how to call Gemini.
 * Every future AI feature (Phase B/C) calls this instead of hand-rolling
 * its own fetch. Deliberately NOT a Convex action itself (it's a plain
 * async function) so it can be called directly from within an action's
 * handler without an extra ctx.runAction hop — same pattern as
 * whatsapp.ts's postToGraphApi shared helper.
 *
 * Guard-clause + try/catch shape mirrors whatsapp.ts's postToGraphApi
 * exactly, EXCEPT every failure resolves to { success: false } instead of
 * throwing — see file header for why.
 */
async function callGemini(prompt: string): Promise<GeminiResult> {
  // Guard-clause — read the secret inside the function (never module scope)
  // so a missing key fails clearly at call time. Unlike whatsapp.ts, we do
  // NOT throw here — we log and return the fallback signal so the caller
  // (and its caller, e.g. a future message-draft feature) can silently fall
  // back to the hardcoded template.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log("[ai] GEMINI_API_KEY not set, skipping Gemini call");
    return { success: false };
  }

  // AbortController drives the hard timeout — fetch has no built-in timeout.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
      signal: controller.signal,
    });

    const data = await response.json();

    if (!response.ok) {
      // Log Gemini's structured error body for debugging — NEVER log the
      // API key itself.
      console.error("[ai] Gemini API error response:", data);
      return { success: false };
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string" || text.length === 0) {
      console.error("[ai] Gemini response missing expected text field:", data);
      return { success: false };
    }

    return { success: true, text };
  } catch (err) {
    // Catches network errors, JSON parse failures, and the AbortController
    // timeout above — all collapse to the same clean fallback signal.
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[ai] Gemini call failed:", reason);
    return { success: false };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// SECTION 2 — Merchant Session Lock helper
// ============================================================================

/**
 * Merchant Session Lock (2026-09-01 pattern) — actions have no ctx.db, so
 * requireMerchantSession (which needs ctx.db.get) cannot be called directly
 * from an action. Wrapped in this internalQuery and invoked via
 * ctx.runQuery, mirroring convex/whatsapp.ts's checkMerchantSession and
 * convex/lookbooks.ts's identical pattern. Throws (via requireMerchantSession)
 * rather than returning a boolean, so the action's runQuery call rejects and
 * the action never proceeds to the Gemini call for an unauthenticated or
 * expired caller.
 */
export const checkMerchantSession = internalQuery({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await requireMerchantSession(ctx, userId, token);
    return null;
  },
});

// ============================================================================
// SECTION 3 — Test-only scaffolding (Phase 2 verification)
// ============================================================================

/**
 * TEMPORARY SCAFFOLDING — Phase A verification only.
 *
 * testGeminiConnection exists purely to prove the plumbing above works
 * end-to-end (guard clause, fetch call, fallback shape, merchant-session
 * lock) before any real feature is built on top of callGemini(). It calls
 * callGemini() with a trivial fixed prompt and returns the result as-is.
 *
 * This action may be REMOVED or REPURPOSED once Phase 3+ builds real
 * functions (generateMessageDraft, generateLookbookRanking) on top of
 * callGemini() — it is not part of any user-facing feature.
 *
 * MERCHANT-ONLY (Merchant Session Lock) — session is verified via
 * checkMerchantSession before any Gemini call, same as every other
 * merchant-facing function in this codebase.
 */
export const testGeminiConnection = action({
  args: {
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, { userId, token }): Promise<GeminiResult> => {
    await ctx.runQuery(internal.ai.checkMerchantSession, { userId, token });

    return callGemini("Reply with the single word: OK");
  },
});
