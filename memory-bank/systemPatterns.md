# System Patterns — LoyaltyOS

## Architecture Pattern

Monorepo: `apps/api` (Express REST) + `apps/web` (React 18 PWA) + `docker-compose.yml` (PostgreSQL 16 + Redis 7). API routes grouped by domain (auth, dashboard, customers, lookbooks, campaigns, orders, insights, settings, portal, webhooks); pure logic in `services/` (points engine, reach estimator, WhatsApp wrapper, ledger).

## Data Patterns

- **Points are authoritative in `customers.points`**; `points_transactions` entries written atomically in the same transaction as the order — a points/order pair can never diverge.
- **Tier is computed** from points against `tiers` ranges (or maintained by trigger); thresholds editable in Settings.
- **Confidentiality:** `staff_notes` + `customer_measurements` read only by merchant routes; customer portal exposes read-only measurement slice, never notes.
- **Money:** `NUMERIC(12,2)`, never floats.
- **Reserved orders** (`orders.status = 'Reserved'`) support the portal "Reserve & Pay in Store" flow.

## Workflow Patterns (spec-driven)

1. **HARD-GATE:** no code until design presented and approved by user. Applies to EVERY project regardless of perceived simplicity.
2. **Spec → Plan → Execute:** approved spec saved to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and committed; implementation plan saved to `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` with Global Constraints copied verbatim; execute per task (TDD: failing test → pass → commit).
3. **Ledger for memory:** progress tracked in `.superpowers/sdd/progress.md` with exact line formats — `Task <N>: complete (commits <base7>..<head7>, review clean)`, `Task <N>: fix round <R>/5 (...)`, `Task <N>: minor (deferred): ...`, `Task <N>: parked — ...`, `Task <N>: BLOCKED — ...`. A task is DONE iff it has a `Task <N>: complete` line. Trust the ledger and `git log` over recollection.
4. **Every new project/folder:** FIRST scan for spec-driven compliance (`.clinerules`, `.superpowers/sdd/progress.md`, `docs/superpowers/specs/`, `docs/superpowers/plans/`, `memory-bank/`, git repo). If NOT spec-driven or < 50% spec-driven, FIRST clone and convert to spec-driven (create `.clinerules`, ledger, specs/, plans/, memory-bank 6 files, `.worklogs/`, `tasks.md`, git init).
5. **Verification steps in every plan task:** run command + expected output.

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