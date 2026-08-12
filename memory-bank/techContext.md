# Tech Context — LoyaltyOS

## Current Tech Stack (post 2026-08-07 Convex amendment)

| Layer | Choice | Notes |
|---|---|---|
| Backend | **Convex** (serverless TS) | Deployment `pleasant-cobra-560.eu-west-1.convex.cloud`; team `loyaltyos-boutique`; queries/mutations/actions all run as transactions |
| Database | **Convex document DB** | Tables in `convex/schema.ts`; indexes + realtime subscribe built in; no Redis needed |
| Auth | **Convex Auth** | `convex/auth.ts` — passkeys/OTP/email-link for merchant + customer auth |
| Frontend | React 18 + Vite 5.4.21 + Tailwind 3 | Existing `src/`; Ma'am's UI — **27.74 kB luxury CSS, minimal edits** |
| Styling tokens | BG `#F8F6F3`, panel `#FFFFFF`, border `#EDEBE7`, gold `#C5A880`, ink `#111111` | DM Sans (UI) + Playfair Display (headings) |
| Email | **Resend** | From `digital@mouldinnovation.com`; domain `mouldinnovation.com` verified via Cloudflare DNS |
| Deploy | **Vercel** (`loyaltyos-boutique-three.vercel.app`) + **GitHub** (`LoyaltyOs-boutique/loyaltyos-boutique`) | Frontend statics on Vercel; Convex cloud manages DB/functions/HTTPS |
| File storage | Convex file storage | Campaign creatives (replaces S3 stub) |

### Superseded / Archived

> **Express/PostgreSQL/Redis/Docker stack is ARCHIVED.** The original self-hosted
> Node.js 20 + Express (REST) + PostgreSQL 16 + Redis + Docker Compose → VPS design
> was **superseded 2026-08-07** by the approved Convex amendment
> (`docs/superpowers/specs/2026-08-07-convex-amendment-design.md`, Design Decisions #2, #3, #8).
> Do not reintroduce express/PG/Redis/Docker config for new work.

## Key Technical Invariants

- Billing + points accrual/redemption: **atomic in one DB transaction** — a Convex mutation runs as a single transaction.
- `points_transactions` immutable ledger; balance derived with `balance_after`.
- Money stored as fixed-point (₹ in paise / decimal) — never floats.
- `staff_notes` + `customer_measurements` confidential — merchant routes only.
- Customers unique by mobile number (`mobile-unique` constraint in Convex schema).

## Loyalty Rule Constants (from spec/PRD)

| Rule | Value |
|---|---|
| Earn | 1 pt per ₹100 |
| Redeem | 1 pt = ₹1 (configurable) |
| Ivory / Champagne / Noir | 0–999 (1x) / 1000–2999 (1.5x) / 3000+ (2x) |
| Review / GMB / Testimonial | +150 / +300 / ₹500 credit |
| Birthday / Referral | +500 / +300 |

## Environment / Secrets

- `VITE_CONVEX_URL` → `https://pleasant-cobra-560.eu-west-1.convex.cloud`
- `.env.local` (gitignored — secrets never committed)
- Convex deployment env vars for Resend API key

## Development Setup

```bash
npm install
npx convex dev          # runs local + links Convex deployment
npm run dev             # Vite dev server
npx convex deploy       # deploy backend functions
npm run build           # Vite build (CSS stays ~27.74 kB)