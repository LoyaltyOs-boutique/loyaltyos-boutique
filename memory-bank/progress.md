# Progress — LoyaltyOS

> Mirror of `.superpowers/sdd/progress.md` per permanent rule. Updated after every task.

## Timeline

- **2026-08-06:** Downloaded superpowers 607KB (codeload.github.com workaround for proxy 127.0.0.1:8892); audited `C:\Mould_AI_Agency` as **15% spec-driven**; `git init`; cloned to `C:\Mould_AI_Agency-SpecDriven\` (excluded `superpowers/` + `superpowers.zip`); converted to **100% spec-driven** with ledger, specs, plans, `.clinerules`, memory-bank (6 files), `tasks.md`, `.worklogs/`, `.gitignore`; stored permanent rule in 3 places.

## Task Status (from implementation plan)

| Task | Description | Status |
|---|---|---|
| 1 | Scaffold monorepo, DB schema, Docker Compose | ⏳ Pending (approved) |
| 2 | Points engine service (TDD) | ✅ Complete (`e2ff5b9`, 30/30 tests) |
| 3 | Auth middleware + merchant login | ⏳ Pending |
| 4 | Dashboard endpoints | ⏳ Pending |
| 5 | Customers (CRM) CRUD + confidential records | ⏳ Pending |
| 6 | Atomic order creation + points accrual/redemption | ⏳ Pending |
| 7 | Settings endpoints | ⏳ Pending |
| 8 | Insights endpoints | ⏳ Pending |
| 9 | Campaigns + reach estimation + send | ⏳ Pending |
| 10 | Lookbooks + import stubs | ⏳ Pending |
| 11 | Customer Portal API | ⏳ Pending |
| 12 | Frontend scaffold (Vite PWA, tokens, routing) | ⏳ Pending |
| 13 | Frontend: Dashboard, Settings, Portal home | ⏳ Pending |
| 14 | Frontend: CRM, POS, Campaigns | ⏳ Pending |
| 15 | Final whole-branch review + polish | ⏳ Pending |

## Log

- 2026-08-06: Spec-driven conversion complete. Permanent rule stored in `.clinerules`, `memory-bank/systemPatterns.md`, `memory-bank/activeContext.md`. Implementation awaits HARD-GATE approval to begin coding.
- 2026-08-06: Task 2 complete — points engine (`apps/api/src/services/points.js`) + TDD suite (`apps/api/test/points.test.js`, 30/30 pass) in commit `e2ff5b9`.
- 2026-08-07: **Convex amendment approved** (`docs/superpowers/specs/2026-08-07-convex-amendment-design.md`) — backend provider changed from Express+PG+Redis+Docker to Convex (Dec #2/#3/#8). This supersedes the original Mould Express/PG implementation plan for backend work.
- 2026-08-07: **Step 1 complete** — Convex project `loyaltyos-boutique` created in team `loyaltyos-boutique` (CLI slug `loyoltyos-boutique`; `wowcirclemould`/`perfect-skunk-360` was the OLD training account, not used), `convex/` scaffolded, env in `.env.local` (gitignored), branch `feat/step1-connect-convex` pushed. Tester agent: convex/ ✅, VITE_CONVEX_URL ✅, build CSS 27.74 kB ✅, `/login` HTTP 200 ✅ (commits `cf2cdd4`, `f90f9d1`). No `src/` edits.
- 2026-08-07: **Step 2 complete** — `convex/schema.ts` written from PRD §6 (users, lookbooks, catalogue_items, orders, campaigns — 5 tables, 5 indexes, paise integer money) and pushed to the correct deployment `pleasant-cobra-560` (team `loyaltyos-boutique`, dashboard https://dashboard.convex.dev/t/loyaltyos-boutique); verified via `npx convex data` (all 5 tables live) + `npx convex dev --once` (5 indexes added). Build stays **27.74 kB CSS**; no `src/` edits, no `.env.local` in git. Branch `feat/step2-convex-schema` pushed (commits `53e0d79`, `1255b70`). Preview: https://loyaltyos-boutique-rho14woih-loyalty-os1.vercel.app (state=success).
- 2026-08-07: **Step 3 complete** — secure auth per PRD §3.1/§3.2 in `convex/auth.ts`: `merchantLogin` (by_email + `bcrypt.compareSync` + 256-bit session token 7-day), `generateMagicToken` (by_mobile + 256-bit token + `magic_token_created_at`), `validateMagicToken` (by_magic_token + id match + 180-day expiry), `forgotPassword` (256-bit reset token 24h, mock email log, anti-enumeration). Schema: `users.by_email` index + `magic_token_created_at`/`reset_token`/`reset_expiry`/`session_token`/`session_expiry`. bcryptjs installed (Convex-side only; `src/` untouched). Deployed `pleasant-cobra-560`; tester verified live: merchant login owner@boutique.in/owner123 → 64-hex token + user (wrong pw/unknown → null); magic link `https://loyaltyos-boutique-three.vercel.app/lookbook?id=…&token=…` valid → user, wrong token → null, >180d → null; forgotPassword ok:true both known/unknown + RESET LINK logged. Build **27.74 kB CSS**. Branch `feat/step3-merchant-auth` (`687062b`, `0fab65d` fix: async bcrypt setTimeout → compareSync). No `src/` edits, `.env.local` untracked.
