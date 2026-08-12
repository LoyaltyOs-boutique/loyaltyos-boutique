# System Patterns — LoyaltyOS

## Architecture Pattern

Single Vite app (`src/` React 18 + Tailwind 3) + **Convex** backend (`convex/`). No monorepo, no Express, no PostgreSQL, no Redis, no Docker. Frontend calls Convex functions directly via the Convex client; Vercel hosts frontend statics, Convex cloud hosts DB/functions/HTTPS.

## Convex Function Patterns

- **query** — reads only; reactive (frontend `useQuery` subscribes to live data). Used for dashboard, customer lists, settings, lookbooks.
- **mutation** — writes; runs as a single atomic transaction. Billing + points accrual/redemption happen inside one mutation so an order/points pair can never diverge.
- **action** — for external side-effects not allowed inside transactions: **external fetch** (e.g., WhatsApp API, gateway calls, Resend email send via `fetch`/SDK).

## Data Patterns

- **Customers are unique by mobile number** (`mobile-unique` constraint in `convex/schema.ts`) — single customer record per phone.
- **Settings are singleton-per-key** (`convex/settings.ts`) — one doc per settings key, upserted by key.
- **Points/ledger:** `points_transactions` immutable ledger; balance derived with `balance_after`. Write path is a single Convex mutation (atomic).
- **Confidentiality:** `staff_notes` + `customer_measurements` exposed only via merchant queries; customer portal never returns notes.
- **Money:** fixed-point (₹ in paise / decimal), never floats.
- **Reserved orders** support the portal "Reserve & Pay in Store" flow.

## Workflow Patterns (spec-driven)

1. **HARD-GATE:** no code until design presented and approved by user. Applies to EVERY project regardless of perceived simplicity.
2. **Spec → Plan → Ledger → TDD:** approved spec saved to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (with Design Decisions table) and committed; implementation plan saved to `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` with Global Constraints copied verbatim; execute per task — failing test → pass → commit.
3. **Findability for Codegen:** short targeted list of source file paths (e.g. `convex/schema.ts`, `convex/customers.ts`, `convex/settings.ts`, `convex/auth.ts`) to check if task falls under any existing spec/feature.
4. **Ledger for memory — CANONICAL:** progress is tracked in `.superpowers/sdd/progress.md` with exact line formats — `Task <N>: complete (commits <base7>..<head7>, review clean)`, `Task <N>: fix round <R>/5 (...)`, `Task <N>: minor (deferred): ...`, `Task <N>: parked — ...`, `Task <N>: BLOCKED — ...`. A task is DONE iff it has a `Task <N>: complete` line. `memory-bank/progress.md` is a **mirror only** — the canonical ledger is `.superpowers/sdd/progress.md`. Trust the ledger and `git log` over recollection.
5. **Every new project/folder:** FIRST scan for spec-driven compliance (`.clinerules`, `.superpowers/sdd/progress.md`, `docs/superpowers/specs/`, `docs/superpowers/plans/`, `memory-bank/`, git repo). If NOT spec-driven or < 50% spec-driven, FIRST clone and convert to spec-driven (create `.clinerules`, ledger, specs/, plans/, memory-bank 6 files, `.worklogs/`, `tasks.md`, git init).
6. **Verification steps in every plan task:** run command + expected output.

---

# PERMANENT RULE - FROM MA'AM - Reference: obra/superpowers (607KB, 235 entries)
# Date: 2026-08-06

HARD-GATE (from skills/brainstorming/SKILL.md): Do NOT write any code until you have presented a design and user has approved it. Applies to EVERY project regardless of perceived simplicity. Save approved design to docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md and commit.

Whenever user gives ANY new project/folder in future:
1. FIRST scan if spec-driven (check .clinerules, .superpowers/sdd/progress.md with format Task N: complete (commits ...), docs/superpowers/specs/, docs/superpowers/plans/, memory-bank/, git repo)
2. If NOT spec-driven or <50% spec-driven (like current 15%), FIRST clone and convert to spec-driven using superpowers reference: create .clinerules, .superpowers/sdd/progress.md ledger, docs/superpowers/specs/, plans/, memory-bank/ (6 files), .worklogs/, tasks.md, git init
3. Use progress ledger for memory (not just context) - trust ledger and git log over recollection
4. Create spec as dated approved artifact with Design Decisions table, then plan as executable contract with Global Constraints copied verbatim, verification steps
5. Always update memory-bank/progress.md and .superpowers/sdd/progress.md after every task with exact format
6. Never start coding without HARD-GATE approval

This rule applies to ALL future projects. This is standing instruction from Ma'am.