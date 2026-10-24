import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * HTTP routes. Today there is one: the read-only stats feed for the
 * LoyaltyOS Platform Admin.
 * Design spec: docs/superpowers/specs/2026-10-09-platform-stats-endpoint-design.md
 */
const http = httpRouter();

/** Plain JSON reply that no cache may keep. No CORS headers: server to server only. */
function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** SHA-256 digest bytes of a string, so both sides of a comparison have equal length. */
async function digest(text: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(buf);
}

/** Constant-time equality of two strings: compares digests, never exits early. */
async function secretMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

http.route({
  path: "/platform/stats",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const expected = process.env.PLATFORM_STATS_SECRET;
    // Feed is off until the owner sets the secret.
    if (!expected) return reply(503, { error: "unavailable" });

    // Missing or wrong header: same empty 401, no detail about why.
    const match = /^Bearer (.+)$/.exec(req.headers.get("Authorization") ?? "");
    if (!match || !(await secretMatches(match[1], expected))) {
      return reply(401, { error: "unauthorized" });
    }

    // Multi-boutique Phase 1 (proposal) — optional query-string params.
    // `mode` may only be absent or "list"; anything else is a 400 before
    // computeStats is even called. With no query string at all (today's
    // exact Platform Admin call), `boutique` and `list` are both omitted
    // from the args object below, so computeStats takes its S1 no-parameter
    // branch exactly as it does today.
    const url = new URL(req.url);
    const boutique = url.searchParams.get("boutique");
    const mode = url.searchParams.get("mode");
    if (mode !== null && mode !== "list") {
      return reply(400, { error: "bad_request" });
    }

    const result = await ctx.runQuery(internal.platformStats.computeStats, {
      ...(boutique !== null ? { boutique } : {}),
      ...(mode === "list" ? { list: true } : {}),
    });

    if (result && typeof result === "object" && "error" in result) {
      if (result.error === "unknown_boutique") return reply(404, { error: "unknown_boutique" });
      if (result.error === "bad_request") return reply(400, { error: "bad_request" });
    }

    return reply(200, result);
  }),
});

export default http;
