# Tech Context — LoyaltyOS

## Tech Stack (approved in design spec)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 18 + TypeScript (Vite, PWA) | Zustand state; Recharts charts; Tailwind with luxury tokens |
| Styling tokens | BG `#F8F6F3`, panel `#FFFFFF`, border `#EDEBE7`, gold `#C5A880`, ink `#111111` | DM Sans (UI) + Playfair Display (headings) |
| Backend | Node.js 20 + Express (REST) | JWT merchant auth; OTP/passwordless customer portal |
| Database | PostgreSQL 16 | Atomic order+points transactions; DDL in `PRD.md` §6 |
| Cache/session | Redis | Sessions, campaign reach cache, rate limiting |
| Integrations | WhatsApp Business API, Razorpay, GMB, Instagram Graph, S3-compatible storage | v1: WhatsApp + Razorpay primary; IG/CSV/PDF import stubs |
| Deploy | Docker Compose → VPS | Caddy/Nginx HTTPS; nightly pg_dump |

## Key Technical Invariants

- Order creation, points accrual, redemption: **one DB transaction** (atomic).
- `points_transactions` immutable ledger; balance derived with `balance_after`.
- Money stored as `NUMERIC(12,2)` — never floats.
- `staff_notes` + `customer_measurements` confidential — merchant routes only.
- POS works offline via PWA + local queue, synced when back online.
- Client search < 300 ms @ 10k customers; dashboard < 1 s.

## Loyalty Rule Constants (from spec/PRD)

| Rule | Value |
|---|---|
| Earn | 1 pt per ₹100 |
| Redeem | 1 pt = ₹1 (configurable) |
| Ivory / Champagne / Noir | 0–999 (1x) / 1000–2999 (1.5x) / 3000+ (2x) |
| Review / GMB / Testimonial | +150 / +300 / ₹500 credit |
| Birthday / Referral | +500 / +300 |

## Environment Variables (`apps/api/.env.example`)

`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `WHATSAPP_TOKEN`, `RAZORPAY_KEY`; web: `VITE_API_URL`.

## Development Setup

```bash
docker compose up -d db redis
cd apps/api && npm install && npm test
cd apps/web && npm install && npm run dev