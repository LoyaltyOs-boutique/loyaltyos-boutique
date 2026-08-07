# Active Context — LoyaltyOS

**Date:** 2026-08-06
**Current phase:** Spec-driven conversion complete; implementation pending (plan has 15 tasks, none executed yet).

## What Just Happened

1. Downloaded superpowers reference (607KB, 235 entries) via codeload.github.com workaround for proxy 127.0.0.1:8892.
2. Audited `C:\Mould_AI_Agency` → **15% spec-driven** (had PRD.md only; no git, no specs/, no plans/, no ledger, no memory-bank).
3. `git init` in original.
4. Cloned to `C:\Mould_AI_Agency-SpecDriven\` (excluded `superpowers/` + `superpowers.zip`), `git init` there.
5. Converted clone to **100% spec-driven**:
   - `.clinerules` (permanent rule)
   - `.superpowers/sdd/progress.md` (exact-format ledger + log line)
   - `docs/superpowers/specs/2026-08-06-loyaltyos-design.md` (from PRD, approved-design format: Problems, Design Decisions table, etc.)
   - `docs/superpowers/plans/2026-08-06-loyaltyos-implementation.md` (15 bite-sized TDD tasks with verification + commit steps)
   - `memory-bank/` 6 files (projectbrief, productContext, techContext, systemPatterns, activeContext, progress)
   - `specs/` duplicate for compatibility, `.worklogs/`, `tasks.md`, `.gitignore`
   - Kept `bin/`, `config/`, `logs/`, `85 Lansdowne LoyaltyOS.html`, `PRD.md`, and original scaffolding.

## Next Up

- Commit the conversion in `C:\Mould_AI_Agency-SpecDriven`.
- Start executing `docs/superpowers/plans/2026-08-06-loyaltyos-implementation.md` task-by-task (TDD, ledger line per task) — requires HARD-GATE approval to begin coding.

## Active Decisions

- v1 scope = single merchant login + all 8 merchant screens + customer portal (per PRD §9).
- Points engine constants locked in spec; schema = PRD §6 DDL verbatim.
- Import (IG/CSV/PDF) endpoints are stubs in v1.

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