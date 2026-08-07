# LoyaltyOS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build LoyaltyOS v1 — a boutique-grade loyalty, CRM and client-experience platform for 85 Lansdowne — per the approved design spec, with atomic billing+points transactions and a confidential styling-record model.

**Architecture:** React 18 + TypeScript PWA frontend; Node.js 20 + Express REST API; PostgreSQL 16 (single transactional store with `points_transactions` immutable ledger) + Redis (sessions, reach cache, rate limiting); WhatsApp Business API + Razorpay integrations; Docker Compose → VPS. Frontend screens mirror the prototype 1:1 (Dashboard, CRM, Lookbooks, Campaigns, Billing, Insights, Settings, Customer Portal).

**Tech Stack:** React 18, TypeScript, Vite, Zustand, Recharts, Tailwind (luxury tokens); Node.js 20, Express, pg, Redis client, bcrypt, jsonwebtoken; PostgreSQL 16, Redis 7; Docker Compose.

**Design spec:** `docs/superpowers/specs/2026-08-06-loyaltyos-design.md`. Read it before starting any task. Full API surface and DDL in `PRD.md` §6–§7.

## Global Constraints

> Copied verbatim from the approved spec. EVERY task implicitly includes this section.

- **Atomicity:** order creation, points accrual and redemption must commit in one DB transaction (no lost/double points).
- **Security:** bcrypt password hashing, JWT expiry + refresh, HTTPS-only, rate-limit auth endpoints; `staff_notes` and `customer_measurements` are confidential — never exposed to the customer portal.
- **Performance:** client list searches < 300 ms at 10k customers; dashboard loads < 1 s.
- **Availability:** POS billing must keep working offline (PWA + local queue) synced when back online.
- **Compliance (India):** collect only necessary PII; honor opt-out for marketing WhatsApp messages; DPDP Act consent record per customer.
- **Currency handling:** store money as `NUMERIC(12,2)` (integer paise semantics) — never floats.
- **Data protection:** daily PostgreSQL backups; phone numbers treated as sensitive data.
- **Points engine:** earn ₹100 = 1 pt; redeem 1 pt = ₹1; tiers Ivory 0–999 (1x), Champagne 1000–2999 (1.5x), Noir 3000+ (2x); review bonus +150, GMB +300, testimonial ₹500, birthday +500, referral +300.
- **Schema:** use the DDL in `PRD.md` §6 without modification unless a task says otherwise.
- **Ledger discipline:** after every task append `Task <N>: complete (commits <base7>..<head7>, review clean)` to `.superpowers/sdd/progress.md`.

## File Structure

```
loyaltyos/
├── docker-compose.yml              # app + db + redis
├── apps/
│   ├── api/                        # Node 20 + Express
│   │   ├── src/
│   │   │   ├── index.js            # bootstrap + middleware
│   │   │   ├── db/pool.js          # pg pool
│   │   │   ├── db/schema.sql       # PRD §6 DDL
│   │   │   ├── middleware/auth.js  # JWT merchant + OTP customer
│   │   │   ├── routes/*.js         # auth, dashboard, customers, lookbooks,
│   │   │   │                       # campaigns, orders, insights, settings, portal, webhooks
│   │   │   └── services/*.js       # points engine, reach estimator, whatsapp
│   │   └── test/*.test.js
│   └── web/                        # React 18 + TS (Vite PWA)
│       ├── src/
│       │   ├── app/                # router, providers, stores (Zustand)
│       │   ├── features/
│       │   │   ├── dashboard/
│       │   │   ├── crm/
│       │   │   ├── lookbooks/
│       │   │   ├── campaigns/
│       │   │   ├── billing/
│       │   │   ├── insights/
│       │   │   ├── settings/
│       │   │   └── portal/
│       │   └── components/ui/
│       └── test/
└── docs/superpowers/               # spec + this plan (already present)
```

---

### Task 1: Scaffold the monorepo, database schema, and Docker Compose

**Files:**
- Create: `docker-compose.yml`
- Create: `apps/api/src/db/schema.sql` (exact DDL from `PRD.md` §6)
- Create: `apps/api/src/db/pool.js`
- Create: `apps/api/package.json`
- Create: `apps/api/.env.example`
- Create: `apps/web/package.json` (scaffold config only)
- Create: `.gitignore`

**Interfaces:**
- Produces: `pool.js` exporting `pool` (pg Pool) + `query` — all later API tasks consume this.
- Produces: `schema.sql` — the single source of truth for all data-layer tests.

- [ ] **Step 1: Create `.gitignore`**
  - [ ] Write `.gitignore` covering `node_modules/`, `.env`, `dist/`, `*.log`, `.superpowers/sdd/`.

- [ ] **Step 2: Create `docker-compose.yml`**
  - [ ] Services: `db` (postgres:16, env POSTGRES_DB/POSTGRES_USER/POSTGRES_PASSWORD, volume, port 5432), `redis` (redis:7, port 6379).
- [ ] **Step 3: Create `apps/api/src/db/schema.sql`**
  - [ ] Copy the complete DDL from `PRD.md` §6 verbatim (`merchants` … `customer_events`).
- [ ] **Step 4: Create `apps/api/src/db/pool.js`**
  - [ ] `pg.Pool` reading `DATABASE_URL` from env; export `pool` and `query`.
- [ ] **Step 5: Create `apps/api/package.json`**
  - [ ] `dependencies`: express, pg, bcrypt, jsonwebtoken, ioredis, cors, helmet, dotenv.
  - [ ] `scripts`: `start`, `dev`, `test` (node --test).
- [ ] **Step 6: Create `apps/api/.env.example`**
  - [ ] `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `WHATSAPP_TOKEN`, `RAZORPAY_KEY`.
- [ ] **Step 7: Verify schema parses**
  - [ ] Run: `docker compose up -d db && docker compose exec -T db psql -U postgres -d loyaltyos -f /dev/stdin < apps/api/src/db/schema.sql`
  - [ ] Expected: no errors; `\dt` shows 14 tables.
- [ ] **Step 8: Commit**
  - [ ] Run: `git add -A && git commit -m "feat(db): scaffold monorepo, schema.sql, docker-compose"`

---

### Task 2: Points engine service (pure logic, TDD)

**Files:**
- Create: `apps/api/src/services/points.js`
- Test: `apps/api/test/points.test.js`

**Interfaces:**
- Produces: `earnForAmount(amountInPaise)` → integer points (₹100 = 1 pt).
- Produces: `tierForPoints(points)` → `'ivory' | 'champagne' | 'noir'` per ranges 0–999 / 1000–2999 / 3000+.
- Produces: `applyMultiplier(baseRupa, tier)` → floating multiplier at order time (1x / 1.5x / 2x), rounded down.
- Produces: `redemptionFor(points, redemptionValue)` → paise (1 pt = ₹1).
- Consumes: `PRD.md` §4 rules table.

- [ ] **Step 1: Write failing tests** (`test/points.test.js`)
  - [ ] `earnForAmount(2350000)` = 235 (₹23,500 → 235 pts); `earnForAmount(500)` = 5.
  - [ ] `tierForPoints(0)` = 'ivory'; `tierForPoints(1500)` = 'champagne'; `tierForPoints(5000)` = 'noir'.
  - [ ] `redemptionFor(200)` = 20000 (₹200).
- [ ] **Step 2: Run and confirm fail**
  - [ ] Run: `cd apps/api && npm test`
  - [ ] Expected: FAIL — module not found.
- [ ] **Step 3: Implement `services/points.js`**
- [ ] **Step 4: Run and confirm pass**
  - [ ] Run: `cd apps/api && npm test`
  - [ ] Expected: PASS (all).
- [ ] **Step 5: Commit**
  - [ ] Run: `git add apps/api && git commit -m "feat(points): points engine with tiers and redemption (TDD)"`

---

### Task 3: Auth middleware + merchant login endpoint

**Files:**
- Create: `apps/api/src/middleware/auth.js`
- Create: `apps/api/src/routes/auth.js`
- Modify: `apps/api/src/index.js`

**Interfaces:**
- Consumes: `pool.query` (Task 1); `merchants` table.
- Produces: `POST /v1/auth/merchant/login` → `{ token, refreshToken }`; `requireAuth` middleware used by all merchant routes.

- [ ] **Step 1: Write failing request-level tests**
  - [ ] Seed a merchant (bcrypt hash of `test-password`), POST login → 200 + JWT.
  - [ ] Wrong password → 401.
- [ ] **Step 2: Run and confirm fail**
  - [ ] Run: `cd apps/api && npm test`
  - [ ] Expected: FAIL — 404 route.
- [ ] **Step 3: Implement middleware + route + mount in index.js**
  - [ ] `requireAuth` verifies `Authorization: Bearer <JWT>` and attaches `req.merchant`.
- [ ] **Step 4: Run and confirm pass**
  - [ ] Run: `cd apps/api && npm test`
  - [ ] Expected: PASS.
- [ ] **Step 5: Commit**
  - [ ] Run: `git add apps/api && git commit -m "feat(auth): merchant login + JWT middleware"`

---

### Task 4: Dashboard endpoints

**Files:**
- Create: `apps/api/src/routes/dashboard.js`
- Modify: `apps/api/src/index.js`

**Interfaces:**
- Produces: `GET /v1/dashboard/metrics` → `{ totalClients, activePoints, monthlyRevenue, repeatRate }`.
- Produces: `GET /v1/dashboard/delight-queue`, `GET /v1/dashboard/recent-orders`, `GET /v1/dashboard/tier-distribution` (spec §3.2 values as seed expectations).

- [ ] **Step 1: Write failing tests** (seed 247 customers, ₹1,24,500 active points, ₹18.4L revenue, 68% repeat).
- [ ] **Step 2: Run and confirm fail**
  - [ ] Expected: FAIL — 404.
- [ ] **Step 3: Implement the four SELECTs** (single queries; no N+1).
- [ ] **Step 4: Run and confirm pass**
  - [ ] Expected: PASS; response matches spec §3.2 numbers for seed.
- [ ] **Step 5: Commit**
  - [ ] Run: `git add apps/api && git commit -m "feat(dashboard): metrics, delight queue, recent orders, tier distribution"`

---

### Task 5: Customers (CRM) CRUD + search + confidential records

**Files:**
- Create: `apps/api/src/routes/customers.js`
- Modify: `apps/api/src/index.js`

**Interfaces:**
- Consumes: `customers`, `customer_measurements`, `staff_notes`, `orders` (read-only).
- Produces: `GET /v1/customers?q=&tier=&tag=` (search < 300 ms @ 10k), `POST /v1/customers`, `GET /v1/customers/:id` (incl. measurements + notes), `PATCH /v1/customers/:id`, `POST /v1/customers/:id/measurements`, `POST /v1/customers/:id/notes`.

- [ ] **Step 1: Write failing tests** — search by name/phone/tag; tier filter; confidential fields only on merchant routes (portal must 404 on these).
- [ ] **Step 2: Run and confirm fail** — Expected: FAIL 404.
- [ ] **Step 3: Implement routes** with ILIKE search + GIN index on `tags`.
- [ ] **Step 4: Run and confirm pass** — Expected: PASS.
- [ ] **Step 5: Commit**
  - [ ] Run: `git add apps/api && git commit -m "feat(crm): customers CRUD, search, measurements, staff notes"`

---

### Task 6: Atomic order creation with points accrual/redemption

**Files:**
- Create: `apps/api/src/routes/orders.js`
- Create: `apps/api/src/services/ledger.js`
- Modify: `apps/api/src/index.js`

**Interfaces:**
- Consumes: `points.js` (Task 2), `customers` table.
- Produces: `POST /v1/orders` — transaction writes `orders`, `order_items`, updates `customers.points`, appends `points_transactions`; `GET /v1/orders/today`, `GET /v1/orders/today/summary`.

- [ ] **Step 1: Write failing tests**
  - [ ] Create order with points discount (200 pts = −₹200) and earn (+235 on ₹23,500) — assert balance + ledger entries consistent.
  - [ ] Insufficient points → 400 and NO partial writes (rollback).
- [ ] **Step 2: Run and confirm fail**
  - [ ] Expected: FAIL — 404.
- [ ] **Step 3: Implement `ledger.js` + `orders.js`**
  - [ ] One `BEGIN … COMMIT`; `points_transactions.type` = 'earn' / 'redeem'; `balance_after` recorded.
- [ ] **Step 4: Run and confirm pass**
  - [ ] Expected: PASS; atomicity asserted (no orphan ledger rows).
- [ ] **Step 5: Commit**
  - [ ] Run: `git add apps/api && git commit -m "feat(orders): atomic POS order + points accrual/redemption"`

---

### Task 7: Settings endpoints (tiers, store, loyalty config)

**Files:**
- Create: `apps/api/src/routes/settings.js`
- Modify: `apps/api/src/index.js`

**Interfaces:**
- Consumes: `loyalty_config`, `tiers`, `merchants`.
- Produces: `GET/PATCH /v1/settings/store`, `GET/PATCH /v1/settings/tiers`, `GET/PATCH /v1/settings/loyalty`.

- [ ] **Step 1: Write failing tests** — edit tier thresholds; loyalty rates; store details; recompute membership after threshold change.
- [ ] **Step 2: Run and confirm fail** — Expected: FAIL 404.
- [ ] **Step 3: Implement routes** (single merchant scope; merchant_id filter on every query).
- [ ] **Step 4: Run and confirm pass** — Expected: PASS.
- [ ] **Step 5: Commit**
  - [ ] Run: `git add apps/api && git commit -m "feat(settings): store, tiers, loyalty config CRUD"`

---

### Task 8: Insights endpoints

**Files:**
- Create: `apps/api/src/routes/insights.js`
- Modify: `apps/api/src/index.js`

**Interfaces:**
- Consumes: `campaigns`, `reviews`, `orders`, `lookbook_items`.
- Produces: `GET /v1/insights/metrics`, `top-lookbooks`, `revenue-loyalty-vs-walkin?months=6`, `pending-reviews`, `POST /v1/insights/reviews/:id/approve|decline`.

- [ ] **Step 1: Write failing tests** — CTR 34.2%, testimonials 48/12 pending, loyalty share 72%, 6-month bar aggregates.
- [ ] **Step 2: Run and confirm fail** — Expected: FAIL 404.
- [ ] **Step 3: Implement routes** (GROUP BY month; review approve/decline updates status).
- [ ] **Step 4: Run and confirm pass** — Expected: PASS.
- [ ] **Step 5: Commit**
  - [ ] Run: `git add apps/api && git commit -m "feat(insights): metrics, lookbook engagement, revenue vs walk-in, review approvals"`

---

### Task 9: Campaigns (WhatsApp Broadcast Studio) — reach estimation + send

**Files:**
- Create: `apps/api/src/services/reach.js`
- Create: `apps/api/src/services/whatsapp.js`
- Create: `apps/api/src/routes/campaigns.js`
- Modify: `apps/api/src/index.js`

**Interfaces:**
- Consumes: `customers`, `campaigns`.
- Produces: `POST /v1/campaigns/preview` → `{ estimatedReach }` (tags cap reach at ~60%); `POST /v1/campaigns/:id/send` → WhatsApp Business API wrapper; `GET /v1/campaigns/:id/stats`.

- [ ] **Step 1: Write failing tests**
  - [ ] Reach math: tier × points bracket × tag overlap, cap ~60%.
  - [ ] Send calls mocked WhatsApp client (no real network in tests).
- [ ] **Step 2: Run and confirm fail** — Expected: FAIL 404.
- [ ] **Step 3: Implement `reach.js`, `whatsapp.js`, routes** (creative upload ≤ 5 MB, status Draft→Sent).
- [ ] **Step 4: Run and confirm pass** — Expected: PASS.
- [ ] **Step 5: Commit**
  - [ ] Run: `git add apps/api && git commit -m "feat(campaigns): WhatsApp broadcast studio with reach estimation"`

---

### Task 10: Lookbooks (catalogue) + import stubs

**Files:**
- Create: `apps/api/src/routes/lookbooks.js`
- Modify: `apps/api/src/index.js`

**Interfaces:**
- Produces: `GET/POST /v1/lookbooks`, `GET /v1/lookbooks/:id`, `POST /v1/lookbooks/:id/items`, `DELETE /v1/lookbooks/:id/items/:itemId`, `PATCH /v1/lookbooks/:id`, `POST /v1/lookbooks/import/instagram`, `POST /v1/lookbooks/import/upload`.

- [ ] **Step 1: Write failing tests** — CRUD; status transitions; like count.
- [ ] **Step 2: Run and confirm fail** — Expected: FAIL 404.
- [ ] **Step 3: Implement routes** (import endpoints: stub that records source; full IG/CSV/PDF parsing is post-v1).
- [ ] **Step 4: Run and confirm pass** — Expected: PASS.
- [ ] **Step 5: Commit**
  - [ ] Run: `git add apps/api && git commit -m "feat(lookbooks): catalogue CRUD + import stubs"`

---

### Task 11: Customer Portal API (OTP auth, balance, lookbooks, reviews)

**Files:**
- Create: `apps/api/src/routes/portal.js`
- Modify: `apps/api/src/index.js`

**Interfaces:**
- Produces: `POST /v1/auth/customer/otp|verify`, `GET /v1/portal/me|balance|lookbooks|measurements|reviewable-purchases`, `POST /v1/portal/orders` (reserve), `POST /v1/portal/reviews`, `POST /v1/portal/reviews/gmb`, `POST /v1/portal/lookbooks/:id/like`.
- **Security invariant from spec:** measurements/notes/exposes only read-only slice; `staff_notes` NEVER returned.

- [ ] **Step 1: Write failing tests** — OTP flow (mocked SMS); portal must NOT return `staff_notes` or full measurements edit; review award +150; GMB +300 via idempotency key.
- [ ] **Step 2: Run and confirm fail** — Expected: FAIL 404.
- [ ] **Step 3: Implement routes.**
- [ ] **Step 4: Run and confirm pass** — Expected: PASS; security assertion green (no staff_notes leak).
- [ ] **Step 5: Commit**
  - [ ] Run: `git add apps/api && git commit -m "feat(portal): customer OTP auth, balance, lookbooks, reviews"`

---

### Task 12: Frontend scaffold — Vite React-TS PWA + design tokens + routing

**Files:**
- Create: `apps/web/` via `npm create vite@latest web -- --template react-ts`
- Create: `apps/web/src/app/router.tsx`
- Create: `apps/web/src/app/store.ts` (Zustand: session, customers cache, cart/bill)
- Create: `apps/web/tailwind.config.js` + `index.css` with luxury tokens
- Create: `apps/web/public/manifest.webmanifest` + service worker registration

**Interfaces:**
- Consumes: REST API base URL from `import.meta.env.VITE_API_URL`.
- Produces: route tree matching the 8 merchant screens + customer portal; token-gated routes.

- [ ] **Step 1: Scaffold Vite app** — Run: `npm create vite@latest web -- --template react-ts` in `apps/`; Expected: app runs at `npm run dev`.
- [ ] **Step 2: Install deps** — Run: `cd apps/web && npm install react-router-dom zustand recharts tailwindcss`; then `npx tailwindcss init -p`.
- [ ] **Step 3: Define design tokens**
  - [ ] BG `#F8F6F3`, panel `#FFFFFF`, border `#EDEBE7`, accent gold `#C5A880`, ink `#111111`; fonts DM Sans + Playfair Display.
- [ ] **Step 4: Build router + store** — protected merchant routes + `/portal/*`.
- [ ] **Step 5: PWA manifest + service worker** — `navigator.serviceWorker.register`.
- [ ] **Step 6: Verify build**
  - [ ] Run: `npm run build`
  - [ ] Expected: PASS — TypeScript compiles, bundle produced.
- [ ] **Step 7: Commit**
  - [ ] Run: `git add apps/web && git commit -m "feat(web): Vite React-TS PWA scaffold, design tokens, routing, store"`

---

### Task 13: Frontend — Dashboard, Settings, and Portal home wired to API

**Files:**
- Create: `apps/web/src/features/dashboard/DashboardPage.tsx` (metrics cards, Delight Queue, Recent Orders, Tier Distribution via Recharts)
- Create: `apps/web/src/features/settings/SettingsPage.tsx` (tiers/store/loyalty forms)
- Create: `apps/web/src/features/portal/PortalHome.tsx` (balance card, next-tier progress, quick actions)
- Create: `apps/web/src/api/client.ts` (fetch wrapper with JWT header + refresh)

**Interfaces:**
- Consumes: Tasks 3, 4, 7, 11 endpoints.
- Produces: `apiClient.get('/v1/...')` helper consumed by all remaining screen tasks.

- [ ] **Step 1: Write `api/client.ts`** — attach Bearer token; 401 → refresh → retry.
- [ ] **Step 2: Dashboard page** — mount 4 metric cards + delight queue list + today's orders + tier bar chart.
- [ ] **Step 3: Settings page** — three forms, PATCH on save, toast confirm.
- [ ] **Step 4: Portal home** — balance card, tier progress, test CTA.
- [ ] **Step 5: Verify build + typecheck**
  - [ ] Run: `cd apps/web && npm run build`
  - [ ] Expected: PASS.
- [ ] **Step 6: Commit**
  - [ ] Run: `git add apps/web && git commit -m "feat(web): dashboard, settings, portal home connected to API"`

---

### Task 14: Frontend — CRM, Billing (POS), and Campaigns screens

**Files:**
- Create: `apps/web/src/features/crm/ClientListPage.tsx`, `ClientDetailPage.tsx`
- Create: `apps/web/src/features/billing/PosPage.tsx` (lookup, line items, points discount, payment, live earn)
- Create: `apps/web/src/features/campaigns/CampaignStudioPage.tsx` (compose, upload ≤5MB preview, filters, reach, mobile preview)

**Interfaces:**
- Consumes: Tasks 5, 6, 9 endpoints.

- [ ] **Step 1: CRM pages** — search/filter table; detail tabs (profile, measurements, notes, purchases).
- [ ] **Step 2: POS page** — phone lookup → tier+points; items; apply points; pay; complete → POST `/v1/orders`.
- [ ] **Step 3: Campaigns page** — composer + drag-drop creative + filters + reach + WhatsApp-style preview.
- [ ] **Step 4: Verify build + typecheck** — Expected: PASS.
- [ ] **Step 5: Commit**
  - [ ] Run: `git add apps/web && git commit -m "feat(web): CRM, POS billing, campaign studio"`

---

### Task 15: Final whole-branch review and polish

**Steps:**
- [ ] **Step 1: Full API test run** — Run: `cd apps/api && npm test`; Expected: all suites PASS.
- [ ] **Step 2: Full web build** — Run: `cd apps/web && npm run build`; Expected: PASS.
- [ ] **Step 3: PWA offline check** — load app, run Lighthouse offline audit for POS route; Expected: installable + offline score ≥ 90.
- [ ] **Step 4: Security spot-check** — portal responses contain zero `staff_notes` fields (grep responses in tests); Expected: no leak.
- [ ] **Step 5: Update ledgers** — append final `Task 15: complete` + `memory-bank/progress.md`.
- [ ] **Step 6: Merge/PR** — per `superpowers:finishing-a-development-branch`.