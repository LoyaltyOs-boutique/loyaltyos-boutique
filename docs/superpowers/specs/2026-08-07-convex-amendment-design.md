# Convex Backend Amendment — Approved Design (Step 1)

**Status:** Proposed amendment (awaiting approval) → Approved (after sign-off)
**Amends:** `2026-08-06-loyaltyos-design.md` Design Decision #2, #3, #8
**Date:** 2026-08-07
**Scope:** Phase Step 1 — connect Convex backend scaffolding to the existing frontend. No `src/` edits.

## Context

The approved spec architected a self-hosted Node.js 20 + Express + PostgreSQL 16 + Redis stack on Docker/VPS. The current repo is a fully working **frontend-only prototype** whose data layer (`src/lib/db.js`) is an in-browser persistence layer with this stated intent: *"Swappable for a real Express + Prisma backend later via the same function surface."*

This amendment changes the backend provider choice to **Convex** (managed backend-as-a-service) before any backend code is written.

## Why Convex over Express/PostgreSQL

| Criterion | Convex (proposed) | Express + PostgreSQL (original) |
|-----------|-------------------|---------------------------------|
| Ops overhead | Zero — managed database, functions, auth, file storage | Full VPS + Docker + nightly backups + SSL |
| Team skill | TS-native; reuses frontend TS skills | Requires backend ops expertise |
| Auth | Convex Auth (email/link, OTP) built-in | Custom JWT + bcrypt + refresh handling |
| Atomic transactions | Supported (server functions run in a transaction) | Requires careful PG txn wiring |
| Realtime | Built-in subscriptions | Would need WebSockets + Redis pub/sub |
| Deploy | `npx convex deploy` | CI/CD + SSH + migrations |
| Cost at single-store scale | Generous free/start tier | VPS + RDS cost regardless of usage |

## Design Decisions (amending the original table)

| # | Original Decision | Amended Decision | Rationale |
|---|-------------------|------------------|-----------|
| 2 | Node.js 20 + Express (REST) backend; JWT auth | **Convex server functions (TypeScript); Convex Auth** for merchant + customer auth | Managed BaaS — removes ops burden for a single-store MVP; TS-native matches frontend stack |
| 3 | PostgreSQL 16 + Redis | **Convex document database + Convex file storage** | Built-in indexes, realtime subscribe, file upload for campaign creatives; no Redis needed |
| 8 | Docker Compose → VPS + nightly pg_dump + Caddy/Nginx HTTPS | **Convex cloud deployment; Vercel hosts frontend statics** | Vercel already serves the frontend; Convex provides managed DB/functions/HTTPS |

## What is UNCHANGED from the approved spec

- React 18 frontend (existing `src/`) — no edits.
- Hard invariant: **billing + points accrual/redemption atomic in one DB transaction** (Convex mutation = single transaction).
- Loyalty Rules Engine table (earning rate, tiers, review bonuses, referral, birthday).
- Entities preserved in Convex tables: `merchants`, `loyalty_config`, `tiers`, `customers`, `customer_measurements`, `staff_notes`, `orders`, `order_items`, `points_transactions`, `lookbooks`, `lookbook_items`, `campaigns`, `reviews`, `customer_events`.
- Security posture: confidential measurements + staff notes merchant-only; phone numbers sensitive.
- Compliance: minimal PII, marketing opt-out, DPDP consent record.

## Step 1 Scope (this branch)

1. `npm install convex`
2. `npx convex dev` → create project **loyaltyos-boutique** in team **"loyoltyos boutique's team"** → produces `convex/` (schema.ts, README, etc.) and `.env.local` with `VITE_CONVEX_URL`.
3. Commit `convex/` only (`.env.local` stays gitignored — secrets never committed).
4. Push to `feat/step1-connect-convex`; Vercel auto-deploys preview link for team testing.
5. Tester agent verifies: convex/ exists, `.env.local` has `VITE_CONVEX_URL`, `npm run build` still ≥27KB, `/login` no 404 regression.

## Explicitly OUT of scope for Step 1

- Migrating `src/lib/db.js` calls to Convex functions (no `src/` edits this step).
- Writing schema.ts contents beyond scaffold defaults.
- Seeding data into Convex.
- Auth implementation.

## Verification (Step 1)

- `convex/` folder exists at repo root.
- `.env.local` contains `VITE_CONVEX_URL=https://...convex.cloud`.
- `npm run build` succeeds; CSS stays ~27.74 kB.
- `https://loyaltyos-boutique-three.vercel.app/login` (main) still loads — no regression.
- Preview deployment URL from Vercel branch pipeline responds 200.

## Approval

- [x] Proposed by backend agent
- [x] Approved by user (sign-off below)
