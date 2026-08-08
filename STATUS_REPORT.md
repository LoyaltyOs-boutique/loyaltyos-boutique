# LoyaltyOS Boutique — Status Report

**Project:** LoyaltyOS Boutique (85 Lansdowne) — luxury retail loyalty platform
**Repo:** https://github.com/LoyaltyOs-boutique/loyaltyos-boutique (public · default branch `main`)
**Production (main):** https://loyaltyos-boutique-three.vercel.app
**Backend (Convex):** deployment `pleasant-cobra-560.eu-west-1.convex.cloud`
**Convex Dashboard:** https://dashboard.convex.dev/t/loyaltyos-boutique/loyaltyos-boutique
**Resend Dashboard:** https://resend.com/emails · https://resend.com/domains
**Report generated:** 2026-08-08

> **Architecture decision (2026-08-07):** original Express/PG/Redis/Docker backend (PRD Modules 1–10)
> replaced by **Convex** (all-TypeScript functions + database + storage) via approved HARD-GATE amendment
> `docs/superpowers/specs/2026-08-07-convex-amendment-design.md` (`cf2cdd4`). Frontend remains Vite + React + Tailwind on Vercel. **`src/`, `components/`, `pages/`, `lib/`, `data/` are Ma'am's complete frontend — never edited except the sanctioned auth-wiring step (Step 3.5, only `src/lib/db.js` + `src/main.jsx`).**

---

## Quick Links (production)

| Link | Purpose | Credentials |
|---|---|---|
| https://loyaltyos-boutique-three.vercel.app/lookbook | Client portal — invitation link (also works personalized with `?id=<id>&token=<token>`) | — |
| https://loyaltyos-boutique-three.vercel.app/join | Client self-onboarding | — |
| https://loyaltyos-boutique-three.vercel.app/login | Merchant login → `/merchant/dashboard` etc. | `owner@boutique.in` / `owner123` |

---

## ✅ DONE

### Phase 0 — Ma'am's Frontend Intact + Spec-Driven Template (on `main`)

5 commits, all verified working, build matches Ma'am's luxury target:

| Commit | What |
|---|---|
| `c227573` | Intact frontend + spec-driven template (`.clinerules`, `.superpowers/`, `memory-bank/`, `docs/`) — **no `src/` edits** |
| `4c6788f` | Build fix — `package.json`, `vite.config.js`, `index.html`, `canvas-confetti` |
| `5f75638` | Luxury fonts — Playfair Display + Montserrat + favicon |
| `8e3f765` | Tailwind output **2 KB → 27.74 KB** (matches Ma'am's 27.79 KB luxury benchmark) |
| `f9aad23` | `vercel.json` SPA 404 fix (`/login`, `/join`, `/lookbook` deep links) |

**Proof of zero `src/` edits:** `git diff <phase0>^ <phase0> -- src/ components/ pages/ lib/ data/` → empty.

### Step 1 — Convex Connected (branch `feat/step1-connect-convex`)

- Commits: `cf2cdd4` (HARD-GATE amendment Express/PG → Convex), `f90f9d1` (convex/ scaffold, 96 files)
- **Team `loyaltyos-boutique`** (corrected from old `wowcirclemould` training account) → project `loyaltyos-boutique` → deployment `pleasant-cobra-560.eu-west-1.convex.cloud`
- `convex/` folder deployed; `VITE_CONVEX_URL` in `.env.local` (gitignored — never in GitHub)
- Preview: https://loyaltyos-boutique-hfi57gnwu-loyalty-os1.vercel.app (SSO-protected)

### Step 2 — Convex Schema from PRD §6 (branch `feat/step2-convex-schema`)

- Commits: `53e0d79`, `1255b70`, `7117805`
- **5 core tables** + 2 extra, **6 indexes**, integer paise money (₹1 = 100 paise):

| Table | Key fields / indexes |
|---|---|
| `users` | `by_mobile`, `by_magic_token`, `by_tier`, `by_email`; measurements (JSON), staff_notes, custom_tags, birthday/anniversary, tier `silver`/`gold`/`platinum` |
| `lookbooks` | — |
| `catalogue_items` | `by_lookbook` |
| `orders` | `by_user` |
| `campaigns` | — |
| `settings`, `reviews` | extras |

- Verified live via `npx convex data` (all tables) + `npx convex dev --once` (indexes)
- Preview: https://loyaltyos-boutique-rho14woih-loyalty-os1.vercel.app

### Step 3 — Merchant Auth + Magic-Link (branch `feat/step3-merchant-auth`)

- Commits: `687062b`, `0fab65d` (bcrypt async→`compareSync` fix), `7557746` (ledgers)
- `convex/auth.ts` — 4 secure functions:

| Function | Type | Behaviour |
|---|---|---|
| `merchantLogin` | mutation | `users.by_email` lookup + `bcrypt.compareSync` + 256-bit session token, 7-day expiry, persisted |
| `generateMagicToken` | mutation | `users.by_mobile` + 256-bit crypto token, PRD-format link |
| `validateMagicToken` | query | `users.by_magic_token` + id match + 180-day expiry |
| `forgotPassword` | (see Step 3.6b) | 24h reset token, anti-enumeration `{ ok: true }` |

- Schema additions: `users.by_email` index + `reset_token`, `reset_expiry`, `magic_token_created_at`, `session_token`, `session_expiry`
- Dep: `bcryptjs`. **All live tests PASS** (correct login → token + user; wrong password/unknown email → null; magic link valid/wrong/expired; forgotPassword ok:true both known/unknown + RESET LINK logged)

### Step 3.5 — Frontend Auth Wired to Convex (branch `feat/step3b-wire-auth`, merged to `main`)

- Commits: `f87c2b1` (code), `cbb7678` (ledgers) — **only** `src/lib/db.js` + `src/main.jsx` (106+ / 8-); no components/pages/data/index.css
- `<ConvexProvider client={convex}>` wraps `<App/>`; `merchantLogin` now calls `api.auth.merchantLogin`
- `saveMerchantSession` stores only `{ id, token (64-hex), ts }` — **never the plaintext password**
- **Data landing proof:** `npx convex run auth:merchantLogin` → `users` row `session_token = b245b872…` + `session_expiry` populated (previously empty)
- Build CSS **27.74 KB identical**, luxury fonts intact
- Merged to `main`; prod serves fresh bundle `index-45s7xkIU.js`, `/login` 200

### Step 3.6 + 3.6b — Real Reset Email via Resend (branches `feat/step3c-resend-email`, `feat/step3c-resend-fix`)

- Commits: `2b1d105` (Resend), `dbac121` (ledgers, merged to main), `7d747da` (action fix), `e23592c` (ledgers, on fix branch)
- `convex/auth.ts`: `import { Resend } from "resend"` + `sendResetEmail()` helper from **`LoyaltyOS Boutique <digital@mouldinnovation.com>`**; subject "Reset your LoyaltyOS password - 85 Lansdowne"; tokenized link `<base>/reset-password?id=…&token=…`, "Valid for 24 hours"
- `RESEND_API_KEY` set in Convex dashboard env (masked, `re_CuZWh…`); dep `resend ^6.18.1`
- **Root-cause fix (3.6b):** Convex **mutations cannot fetch external APIs** — `forgotPassword` converted to an **action**; because actions have no `ctx.db`, the flow uses `internalQuery findMerchantByEmail` + `internalMutation saveResetToken` + fetch in `sendResetEmail`, with try/catch mock-log fallback and anti-enumeration `{ ok: true }` intact
- Previews (SSO-protected): https://loyaltyos-boutique-iztz41xyh-loyalty-os1.vercel.app · https://loyaltyos-boutique-acbjout5l-loyalty-os1.vercel.app

**Tester verification (Step 3.6b):**
- `npx convex dev --once` → compile + push ready
- `RESEND_API_KEY` set + **valid (HTTP 200)**; `api.resend.com` reachable
- Known email `owner@boutique.in` → Resend **REAL API responded** `validation_error: The mouldinnovation.com domain is not verified` — proves action + key + fetch work (was network error before the fix)
- Fallback mock link logged; `reset_token` rotated + persisted 24h
- Unknown email → `{ ok: true }` only (no enumeration)
- Sandbox proof: email `onboarding@resend.dev → digital@mouldinnovation.com`, id `cc54ad8a-413f-41b7-b1fb-2e1501d34733`, `last_event: sent`
- Resend `/domains` → `data: []` — **no verified domain = the ONLY remaining blocker**

---

## ⏳ REMAINING

### 1. Domain verification (unblocks the real reset email) — needs DNS access

Resend requires a verified sender domain. Steps (~20 min, GoDaddy DNS):

1. Open **https://resend.com/domains** → **Add Domain** → `mouldinnovation.com`
2. Copy the TXT verification records (**`resend._domainkey`** + **`_resend`**)
3. Add them in **GoDaddy → DNS → Manage** for `mouldinnovation.com`
4. Click **Verify** in Resend (DNS propagation 1–10 min)
5. Re-run `forgotPassword` → real email **From `digital@mouldinnovation.com`** → **To `owner@boutique.in`** (Gmail inbox)

### 2. Steps 4–10 (per PRD Modules)

| Step | Module | Scope |
|---|---|---|
| 4 | Module 1 — CRM customers | measurements, staff_notes, custom_tags, **Relationship Heat**, Style, Type, **Product Affinity**, **Delight Queue**, birthday/anniversary workflows |
| 5 | Module 2 — Lookbook | PDF/CSV export, Instagram likes, notification |
| 6 | Module 3 — Reviews | approval flow, point credit |
| 7 | Module 7 — Billing | **Hybrid Checkout** (online/offline), **Razorpay mock**, manual points, offline caching |
| 8 | Module 4 — Support Tickets | ticket inbox + status |
| 9 | (Module 5/6/8/9 as scheduled per plan) | — |
| 10 | Module 10 — Final Integration | **GDPR**, **Token Validation**, **Security Audit** (`npm audit`), **Deploy to main** |

---

## 🔒 Security / Compliance Proof

- `git diff <step> <main> -- src/ components/ pages/ lib/ data/` → **empty** for all steps except Step 3.5 (`src/lib/db.js` + `src/main.jsx` only, sanctioned)
- `.env.local` (with `VITE_CONVEX_URL`) → **gitignored**, untracked
- `RESEND_API_KEY` → **only in Convex env vars**, never in GitHub
- Passwords: bcrypt-hashed server-side (never plaintext, never localStorage)
- `forgotPassword` anti-enumeration + 24h expiry; magic links 180-day per PRD