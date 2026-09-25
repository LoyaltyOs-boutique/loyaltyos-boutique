// ============================================================================
// Convex app component registration.
//
// Rate Limiting (design spec 2026-09-05, docs/superpowers/specs/2026-09-05-
// rate-limiting-design.md): mounts the official @convex-dev/rate-limiter
// component so convex/rateLimits.ts can define named, per-key limiters for
// the small set of public (no-auth) functions that accept attacker-
// controlled input (createCustomer, generateMagicTokenSelf/generateMagicToken,
// createReview). Component installs its own isolated tables — no change to
// convex/schema.ts needed (confirmed: components are self-contained storage,
// per this repo's own convex/_generated/ai/guidelines.md "Component
// guidelines" section).
// ============================================================================
import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";

const app = defineApp();
app.use(rateLimiter);

export default app;
