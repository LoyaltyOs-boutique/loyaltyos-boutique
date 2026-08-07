# LoyaltyOS — Approved Design Spec

**Status:** Approved design (derived from `PRD.md` v1.0, 2026-08-06); implementation plan to follow.
**Source PRD:** `PRD.md` (kept in repo as the product requirements reference).
**Objective:** Replace paper loyalty cards and ad-hoc WhatsApp blasts at 85 Lansdowne (85B Sarat Bose Road, Kolkata 700026) with a boutique-grade loyalty, CRM and client-experience platform for a single luxury fashion retail store.
**Hard invariant:** Billing + points accrual/redemption must be atomic in one DB transaction; customer measurements and staff notes are confidential (merchant portal only).

## Problems

Observed / stated in the source prototype and PRD:

1. **Paper loyalty cards are untracked.** The store cannot see points, tiers, or repeat-purchase behavior centrally; loyalty is not tangible, personalised or automatic.
2. **Ad-hoc WhatsApp blasts.** Marketing is not segmented, cannot estimate reach, and review-award flows (150/300/₹500 points) are manual.
3. **Confidential styling records are scattered.** Measurements and private staff notes live outside any structured, permissioned system.
4. **No unified POS-to-loyalty loop.** Billing, points accrual, and redemption are disconnected, risking double/lost points and no insights.
5. **No client self-service.** Customers have no portal for points, lookbooks, styling record or reviews.

## Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | React 18 + TypeScript frontend mirroring prototype screens (Dashboard, CRM, Lookbooks, Campaigns, Billing, Insights, Settings, Customer Portal). | Prototype is already built in HTML; component architecture maps 1:1 to verified screens. |
| 2 | Node.js 20 + Express (REST) backend; JWT merchant auth + OTP/passwordless customer portal auth. | Simple, proven; single-store scope does not need heavier frameworks. |
| 3 | PostgreSQL 16 relational DB with atomic order+points transactions; Redis for sessions/cache/rate-limit. | Points/order pair must never diverge; Redis handles estimated-reach cache and auth rate limiting. |
| 4 | Points authoritative in `customers.points`; ledger (`points_transactions`) written atomically with each order. | Principled ledger design from PRD §6 — immutable history, balance derived, atomic commit. |
| 5 | Loyalty tiers computed from points against editable `tiers` ranges (Ivory 0–999 / Champagne 1000–2999 / Noir 3000+). | Merchant can tune thresholds in Settings without schema changes. |
| 6 | WhatsApp Business API (Meta Cloud API) for campaigns + transactional messages; Razorpay for UPI/card. | Direct WhatsApp sending with delivery/read stats; Razorpay reconciliation hooks. |
| 7 | PWA for the POS counter. | Billing must keep working offline (NFR §8: "POS billing must keep working offline"). |
| 8 | Docker Compose (app + db + redis) → VPS; nightly pg_dump backups; Caddy/Nginx HTTPS. | Small-team deployment with disaster-recovery baseline. |
| 9 | v1 = single merchant login (shared staff account); staff roles deferred post-v1. | Matches prototype; role system is out of scope for MVP. |

## Product Scope (v1 MVP)

From PRD §1–§3, §9:

1. **Auth** — merchant email+password login, forgot/reset, session persistence, customer OTP portal login.
2. **Merchant Dashboard** — metric cards (clients 247, active points ₹1,24,500, monthly revenue ₹18.4L, repeat rate 68%), Delight Queue (birthdays/anniversaries + one-click wish), Recent Orders, Tier Distribution (Ivory 142 / Champagne 78 / Noir 27).
3. **CRM** — client list with search/filter (tier + tags), add client, client detail (profile, confidential measurements, private staff notes, purchase history).
4. **Lookbooks** — grid, create, import (Instagram / CSV / PDF), item counts, status (Draft/Published/Live).
5. **Campaigns (WhatsApp Broadcast Studio)** — compose with rich text/emoji, creative upload ≤5 MB, audience segmentation (tier / points bracket / tags), estimated reach, live mobile preview, SEND VIA WHATSAPP.
6. **Billing (POS)** — customer lookup by phone, line items, points discount (200 pts = −₹200), payment methods (UPI/Card/Cash), live points-to-earn (₹100 = 1 pt), today's transactions + revenue.
7. **Insights** — campaign CTR (34.2%), testimonials (48 total / 12 pending), loyalty revenue share (72% vs 28% walk-in), top lookbooks by engagement, revenue loyalty-vs-walkin 6-month bars, testimonial approvals.
8. **Settings** — editable loyalty tiers, store details, point redemption value (1 pt = ₹1).
9. **Customer Portal** — home with loyalty balance + next-tier progress, designer lookbooks (like / reserve), points ledger, read-only styling record, style reviews (+150 pts) and Google review CTA (+300 pts), testimonial CTA (₹500 credit).

## Loyalty Rules Engine

| Rule | Value |
|------|-------|
| Earning rate | 1 point per ₹100 spent |
| Redemption value | 1 point = ₹1 (configurable) |
| Tier — Ivory | 0–999 pts, 1x multiplier |
| Tier — Champagne | 1,000–2,999 pts, 1.5x multiplier |
| Tier — Noir | 3,000+ pts, 2x multiplier |
| Product review bonus | +150 pts per reviewed purchase |
| Google (GMB) review bonus | +300 pts |
| Style story / testimonial | ₹500 of points credited instantly |
| Birthday bonus | +500 pts |
| Referral bonus | +300 pts (referrer) |
| Points expiry | Not specified (recommend 12 months rolling in v1) |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│           React 18 + TypeScript (PWA) client            │
│  Dashboard · CRM · Lookbooks · Campaigns · Billing ·    │
│  Insights · Settings · Customer Portal                  │
└───────────────┬─────────────────────────────────────────┘
                │ REST / JSON (JWT or customer OTP token)
┌───────────────▼─────────────────────────────────────────┐
│          Node.js 20 + Express API (Docker)              │
│  Auth · Dashboard · Customers · Lookbooks · Campaigns ·  │
│  Orders(POS) · Insights · Settings · Portal · Webhooks  │
└───────┬──────────────────────────────┬──────────────────┘
        │                              │
┌───────▼───────────┐          ┌───────▼───────────────────┐
│ PostgreSQL 16     │          │ Redis                    │
│ (orders+points    │          │ sessions · reach cache ·  │
│  atomic txn)      │          │ rate limiting            │
└───────────────────┘          └──────────────────────────┘
        │                              │
┌───────▼──────────────────────────────────────────────────┐
│ Integrations: WhatsApp Business API · Razorpay · GMB ·   │
│ Instagram Graph · S3-compatible object storage           │
└──────────────────────────────────────────────────────────┘
```

## Data Model

Full canonical schema in `PRD.md` §6. Key entities and invariants:

- `merchants`, `loyalty_config`, `tiers` — store + loyalty configuration.
- `customers`, `customer_measurements`, `staff_notes` — CRM; measurements + notes confidential.
- `orders`, `order_items` — POS; `orders.status = 'Reserved'` supports portal reserve flow.
- `points_transactions` — immutable ledger; written atomically with orders.
- `lookbooks`, `lookbook_items` — catalogue with Instagram/CSV/PDF import sources.
- `campaigns` — tier/points/tag filters + estimated_reach.
- `reviews` — product / gmb / testimonial with points_awarded + status.
- `customer_events` — delight queue (birthdays/anniversaries).

## API Surface

Full REST list in `PRD.md` §7 (base `https://api.loyaltyos.example/v1`, Bearer JWT). Groups: Auth (7.1), Dashboard (7.2), Customers (7.3), Lookbooks (7.4), Campaigns (7.5), Billing (7.6), Insights (7.7), Settings (7.8), Customer Portal (7.9), Webhooks (7.10).

## Non-Functional Requirements

- **Atomicity:** order creation, points accrual and redemption commit in one DB transaction.
- **Security:** bcrypt, JWT expiry + refresh, HTTPS-only, rate-limited auth; measurements/notes confidential.
- **Performance:** client search < 300 ms @ 10k customers; dashboard < 1 s.
- **Availability:** POS works offline (PWA + local queue), syncs when back online.
- **Compliance (India):** minimal PII, marketing opt-out honored, DPDP Act consent record per customer.
- **Currency:** store money as integer paise (`NUMERIC(12,2)`), never floats.
- **Data protection:** nightly PostgreSQL backups; phone numbers sensitive.

## Success Metrics

| Metric | Current (demo baseline) | Target |
|--------|------------------------|--------|
| Repeat purchase rate | 68% | 75% within 12 months |
| Loyalty revenue share | 72% | 80% |
| Campaign CTR | 34.2% | 40% |
| Active clients (≥1 purchase/quarter) | — | 200+ |
| Testimonials collected | 48 | 120 |
| Redemption rate (points used) | — | ≥ 30% of issued points |
| Client notes coverage | — | ≥ 80% of top-tier clients |

## Non-Goals (Post-v1)

Multi-branch/franchise, email/push campaigns, inventory/stock levels, staff roles, reporting exports/GST invoices, automated delight-wish scheduling, points-expiry automation, tier upgrade/downgrade notifications.