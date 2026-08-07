# SDD Progress Ledger — LoyaltyOS

> Exact-format ledger per superpowers reference. A task is DONE iff it has a `Task <N>: complete` line. Trust this ledger and `git log` over recollection.

## Log

- 2026-08-06: Downloaded superpowers 607KB (codeload.github.com workaround for proxy 127.0.0.1:8892), audited Mould_AI_Agency as 15% spec-driven, cloned to SpecDriven, converted to 100% spec-driven with ledger, specs, plans, .clinerules, permanent rule stored
- 2026-08-06: Task 2 complete — points engine service (`apps/api/src/services/points.js`) implemented TDD with 30/30 passing tests (`apps/api/test/points.test.js`).
- 2026-08-07: **Convex amendment approved** (`docs/superpowers/specs/2026-08-07-convex-amendment-design.md`) — amends Dec #2/#3/#8: Express+PG+Redis+Docker → Convex functions/DB/storage + Vercel statics. Original Mould task list below is treated as superseded for backend implementation.
- 2026-08-07: **Step 1 complete** — Convex project `loyaltyos-boutique` created in team `loyaltyos-boutique` (CLI slug `loyoltyos-boutique`; `wowcirclemould`/`perfect-skunk-360` was the OLD training account, not used), `convex/` scaffolded, env in `.env.local` (gitignored), branch `feat/step1-connect-convex` pushed; tester agent verified convex/, VITE_CONVEX_URL, build 27.74 kB CSS, `/login` HTTP 200. Commits: `cf2cdd4` (amendment), `f90f9d1` (convex folder). No `src/` edits.
- 2026-08-07: **Step 2 complete** — `convex/schema.ts` written from PRD §6 (users, lookbooks, catalogue_items, orders, campaigns — 5 tables, 5 indexes, paise integer money) and pushed via `npx convex dev --once` to the correct deployment `pleasant-cobra-560` (team `loyaltyos-boutique`, dashboard https://dashboard.convex.dev/t/loyaltyos-boutique); verified with `npx convex data` (campaigns, catalogue_items, lookbooks, orders, users); build stays 27.74 kB CSS; no `src/` edits, no `.env.local` in git. Branch `feat/step2-convex-schema` pushed (`53e0d79` schema, `1255b70` regenerated `_generated`). Preview: https://loyaltyos-boutique-rho14woih-loyalty-os1.vercel.app (state=success).

## Task Ledger

- Task 1: complete (commits —, spec-driven conversion scaffold) — the spec-driven structure itself was established on 2026-08-06: ledger, .clinerules, spec, plan, memory-bank, tasks.md.
- Task 2: complete (commits 750d7c5..e2ff5b9, review clean) — points engine service with tiers and redemption, TDD 30/30 pass.
- Step 1 (Convex connect): complete (commits cf2cdd4, f90f9d1 on feat/step1-connect-convex, tester verified) — Convex backend scaffolded; original Mould Express/PG task list superseded by Convex amendment.
- Step 2 (Convex schema): complete (commits 53e0d79, 1255b70 on feat/step2-convex-schema, tester verified) — 5-table schema (users, lookbooks, catalogue_items, orders, campaigns) with indexes + paise money deployed to pleasant-cobra-560; `npx convex data` confirms all 5 tables live.
