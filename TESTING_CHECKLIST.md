# LoyaltyOS Boutique — Testing Checklist (for Testing Team)

**Project status:** Phase 0 ✅ · Steps 1, 2, 3, 3.5, 3.6, 3.6b ✅ · Steps 4–10 ⏳ pending
**Repo:** https://github.com/LoyaltyOs-boutique/loyaltyos-boutique (public, `main`)
**Production:** https://loyaltyos-boutique-three.vercel.app
**Convex deployment:** `pleasant-cobra-560.eu-west-1.convex.cloud` · Dashboard: https://dashboard.convex.dev/t/loyaltyos-boutique
**Resend:** https://resend.com/emails · Domains: https://resend.com/domains
**Prerequisite accounts:** GitHub (view repo), Convex dashboard (team access), Resend (Ma'am's account)

> **How far is the project done?** Frontend (Phase 0) is complete and live on production with the luxury 27.74 KB build. Backend (Convex) has: schema (5 core + 2 tables), merchant auth + magic-link (all live-tested PASS), frontend auth wired to Convex (login data lands), and real reset email plumbing (**works end-to-end except sender-domain DNS verification pending** — sandbox email already delivered `id cc54ad8a-… last_event: sent`). Remaining: Steps 4–10 (CRM, Lookbook, Reviews, Billing, Tickets, Final Integration).

---

## Global context for every test

- **Access links:** main = https://loyaltyos-boutique-three.vercel.app · branch previews = SSO-protected (see per-step preview URLs below)
- **Main routes:** client lookbook https://loyaltyos-boutique-three.vercel.app/lookbook (works without token; also personalizes with `?id=<id>&token=<token>`) · client join https://loyaltyos-boutique-three.vercel.app/join · merchant login https://loyaltyos-boutique-three.vercel.app/login (`owner@boutique.in` / `owner123`) → dashboard `/merchant/dashboard` etc.
- **Build:** `npm run build` must succeed; CSS bundle must stay **≥ ~27.74 kB** (luxury Tailwind); no 404 on deep links; no blank white page (env vars fixed)
- **Security:** `src/`, `components/`, `pages/`, `lib/`, `data/` must be untouched (except sanctioned Step 3.5 `src/lib/db.js` + `src/main.jsx`); `.env.local` gitignored; `RESEND_API_KEY` only in Convex env, never GitHub
- **How to verify data lands:** `npx convex dev --once` (compile+push) then `npx convex data <table>` or `npx convex run auth:merchantLogin` from repo root

---

## ✅ Phase 0 — Ma'am's Frontend Intact + Spec Template (main)

Commits: `c227573` · `4c6788f` · `5f75638` · `8e3f765` · `f9aad23`

| # | Check | Expected |
|---|---|---|
| 1 | GitHub file exists: `package.json`, `vite.config.js`, `index.html`, `tailwind.config.js`, `postcss.config.js`, `vercel.json`, `.gitignore`, `.clinerules`, `.superpowers/`, `memory-bank/`, `docs/` | ✅ present on `main` |
| 2 | Convex dashboard | not applicable (frontend-only step) |
| 3 | Vercel main https://loyaltyos-boutique-three.vercel.app/lookbook + /join + /login | HTTP 200, luxury layout, **CSS bundle ≈ 27.74 kB**, no 404, no blank page |
| 4 | `npm run build` | ✅ succeeds; `dist/assets/index-*.css` ≈ 27.74 kB |
| 5 | Security: `git diff` shows Phase 0 touched **zero** `src/` files; `.env.local` not committed | ✅ empty diff for src/ |

---

## ✅ Step 1 — Convex Connected (branch `feat/step1-connect-convex`)

Commits: `cf2cdd4` (amendment) · `f90f9d1` (convex scaffold, 96 files)
Preview (SSO): https://loyaltyos-boutique-hfi57gnwu-loyalty-os1.vercel.app

| # | Check | Expected |
|---|---|---|
| 1 | GitHub: `convex/` folder exists (~96 files: `auth.ts`, `schema.ts`, `_generated/`, `convex.config.ts`); `package.json` has `convex` dependency; amendment `docs/superpowers/specs/2026-08-07-convex-amendment-design.md` exists | ✅ |
| 2 | Convex dashboard https://dashboard.convex.dev/t/loyaltyos-boutique → project `loyaltyos-boutique` → deployment **`pleasant-cobra-560`** (not old `wowcirclemould`) | ✅ correct team/project |
| 3 | `npx convex dev --once` (needs `.env.local` with `VITE_CONVEX_URL`) | ✅ "Convex functions ready!" + push succeeds |
| 4 | `npm run build` | ✅ 27.74 kB |
| 5 | Security: `git diff main <step1> -- src/` empty; `.env.local` gitignored | ✅ |

---

## ✅ Step 2 — Convex Schema (branch `feat/step2-convex-schema`)

Commits: `53e0d79` · `1255b70` · `7117805`
Preview (SSO): https://loyaltyos-boutique-rho14woih-loyalty-os1.vercel.app

| # | Check | Expected |
|---|---|---|
| 1 | GitHub: `convex/schema.ts` present; schema tables `users` (by_mobile, by_magic_token, by_tier, by_email), `lookbooks`, `catalogue_items` (by_lookbook), `orders` (by_user), `campaigns`, `settings`, `reviews`; 6 indexes; paise integer money | ✅ |
| 2 | Convex dashboard → `Data` → tables list | ✅ all 5 core + settings/reviews live (from PRD §6 + extras) |
| 3 | `npx convex data users` (and lookbooks, catalogue_items, orders, campaigns) — tables readable | ✅ |
| 4 | `npm run build` | ✅ 27.74 kB |
| 5 | Security: `git diff main <step2> -- src/` empty | ✅ |

---

## ✅ Step 3 — Merchant Auth + Magic-Link (branch `feat/step3-merchant-auth`)

Commits: `687062b` · `0fab65d` · `7557746`
Preview (SSO): https://loyaltyos-boutique-…-loyalty-os1.vercel.app (per step deployment)

| # | Check | Expected |
|---|---|---|
| 1 | GitHub: `convex/auth.ts` has `merchantLogin`, `generateMagicToken`, `validateMagicToken`, `forgotPassword`; schema has `by_email` + reset/session/magic fields; `bcryptjs` in package.json | ✅ |
| 2 | Convex dashboard → Functions → `auth:merchantLogin` etc. listed; Data → `users` shows reset_token/reset_expiry/magic_token_created_at/session_token/session_expiry columns | ✅ |
| 3 | Live via `npx convex run auth:merchantLogin -- args '{ "email":"owner@boutique.in", "password":"owner123" }'` | ✅ returns user + 64-hex token + expiresAt (7 days); wrong password → null; unknown email → null |
| 4 | Live: `npx convex run auth:generateMagicToken` (valid mobile) → 256-bit token + `…/lookbook?id=…&token=…`; `npx convex run auth:validateMagicToken` valid → user; wrong token → null; >180-day → null | ✅ |
| 5 | Security: `git diff main <step3> -- src/` empty; `.env.local` untracked | ✅ |

---

## ✅ Step 3.5 — Frontend Auth Wired to Convex (branch `feat/step3b-wire-auth` — merged to main)

Commits: `f87c2b1` · `cbb7678`. NOTE: this is the ONLY step that touched `src/` — sanctioned (`src/lib/db.js` + `src/main.jsx` only, 106+/8-). **No components/pages/data/index.css.**

| # | Check | Expected |
|---|---|---|
| 1 | GitHub: `src/main.jsx` wraps `<App/>` in `<ConvexProvider client={convex}>`; `src/lib/db.js` `merchantLogin` calls `api.auth.merchantLogin`; `saveMerchantSession` stores `{id, token, ts}` — no plaintext password anywhere | ✅ |
| 2 | Convex dashboard → `users` row for owner: `session_token` + `session_expiry` **populated** after login (previously empty) | ✅ **data lands** |
| 3 | Vercel prod https://loyaltyos-boutique-three.vercel.app/login → login with owner@boutique.in/owner123 → merchant dashboard reachable; build 27.74 kB; luxury fonts intact | ✅ |
| 4 | `npm run build` | ✅ 27.74 kB |
| 5 | Security: `git diff main -- src/` shows ONLY src/lib/db.js + src/main.jsx | ✅ |

---

## ✅ Step 3.6 + 3.6b — Real Reset Email via Resend (branches `feat/step3c-resend-email`, `feat/step3c-resend-fix`)

Commits: `2b1d105` · `dbac121` (merged to main) · `7d747da` (action fix) · `e23592c` (ledgers)
Previews (SSO): https://loyaltyos-boutique-iztz41xyh-loyalty-os1.vercel.app · https://loyaltyos-boutique-acbjout5l-loyalty-os1.vercel.app

| # | Check | Expected |
|---|---|---|
| 1 | GitHub: `convex/auth.ts` has `import { Resend } from "resend"`, `sendResetEmail()` (from `LoyaltyOS Boutique <digital@mouldinnovation.com>`, subject "Reset your LoyaltyOS password - 85 Lansdowne", 24h tokenized link), `forgotPassword` is an **action** (`export const forgotPassword = action(...)`) using `internalQuery findMerchantByEmail` + `internalMutation saveResetToken`; `resend ^6.18.1` in package.json | ✅ |
| 2 | Convex env (dashboard → Environment Variables): `RESEND_API_KEY` set (masked `re_…`); `npx convex env list` shows it (not in GitHub) | ✅ |
| 3 | `npx convex dev --once` | ✅ compiles + pushes (2.2s) |
| 4 | Test reset email — see **procedure below** | known → Resend API responds; **real email pending domain DNS; sandbox proof delivered** |
| 5 | Security: `git diff main <3.6> -- src/` empty; key never committed | ✅ |

### Forgot-password test procedure (Convex Dashboard)

1. Open https://dashboard.convex.dev/t/loyaltyos-boutique → **Functions** → `auth:forgotPassword` → **Run**
2. Known email: `{ "email": "owner@boutique.in" }`
   - **Now:** returns `{ "ok": true }`; log shows Resend `validation_error: The mouldinnovation.com domain is not verified` (action + key + fetch reach Resend — expected until DNS is verified) then fallback `RESET LINK …`
   - **After Ma'am verifies `mouldinnovation.com` DNS** (https://resend.com/domains → Add Domain → TXT `resend._domainkey` + `_resend` in GoDaddy DNS → Verify): log shows "Resend real email sent" and the email arrives in the Gmail inbox (From digital@mouldinnovation.com, To owner@boutique.in)
3. Unknown email: `{ "email": "ghost@nowhere.in" }` → `{ "ok": true }` only — **no link logged** (anti-enumeration)
4. Verify send status in https://resend.com/emails (look up the email id, `last_event: sent`)
5. Users row: `reset_token` rotated (64 hex) + `reset_expiry` = now + 24h (`npx convex data users --limit 5`)

---

## ⏳ REMAINING (not yet built)

| Step | Module | Test focus when built |
|---|---|---|
| 4 | Module 1 CRM (customers) | measurements, staff_notes, custom_tags, Relationship Heat, Style, Type, Product Affinity, Delight Queue, birthday/anniversary |
| 5 | Module 2 Lookbook | PDF/CSV export, Instagram likes, notification |
| 6 | Module 3 Reviews | approval flow, point credit |
| 7 | Module 7 Billing | Hybrid Checkout (online/offline), Razorpay mock, manual points, offline caching |
| 8 | Module 4 Support Tickets | ticket inbox + status |
| 10 | Final Integration | GDPR, Token Validation, **Security Audit (`npm audit`)**, Deploy to main |

Each will get the same 5-check template (GitHub file exists · Convex data/indexes live · Vercel HTTP 200 + luxury build + no 404/blank · `npm run build` · security `src/` untouched + secrets outside GitHub).

---

## ⚠️ Known issue for testers

- **Branch previews are SSO-protected** (Vercel preview auth) — main prod links are public and should be used for visual QA unless preview auth is granted.
- **Real reset email not yet deliverable** until `mouldinnovation.com` is verified in Resend (DNS step in Ma'am's GoDaddy). Everything up to the send is tested and working.

## ✅ Definition of Done (per step)

All 5 checks in the step's table pass with evidence (screenshot/`git log`/dashboard/curl/CLI output) → mark step complete in `.superpowers/sdd/progress.md` as `Step N: complete (commits …, tester verified)`.