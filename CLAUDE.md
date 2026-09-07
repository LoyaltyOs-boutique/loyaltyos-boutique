# CLAUDE.md — LoyaltyOS Boutique (MASTER CONTEXT)

> READ THIS FILE COMPLETELY BEFORE ANY WORK. Single source of truth for how to work on this project.

## 1. IDENTITY & PEOPLE
- User: AI Developer at Mould Innovation. Hinglish. Casual but expects professional work.
- Ma'am: designed the entire frontend. STRICT RULE: never touch the frontend, never break working things.
- Client: 85 Lansdowne — luxury fashion boutique, Kolkata.
- Project: LoyaltyOS Boutique — loyalty, CRM & client-experience platform. Phase 1 = MVP.

## 2. COMMUNICATION STYLE
1. Explain first in simple words before doing work.
2. Hinglish fine in chat, code/commits in English.
3. Use PASS/FAIL tables and checklists.
4. Be honest always — no sugarcoating.
5. Every task must verify: "kuch nahi tootega na" (regression safety).
6. Testing instructions for team must be simple, non-technical.
7. Deadline-driven — prioritize what's visible in demos.
8. Never assume — verify pushes via git branch -vv.

## 3. PROJECT SUMMARY
Client gets WhatsApp magic link (/lookbook?id=X&token=Y), no login, 180-day session.
Merchant logs in with email+password, manages Dashboard/CRM/Onboarding/Lookbook/Settings/Billing.
Public lookbook /lookbook/public/:id — no login needed.
Self-onboarding at /join.
Reviews: pending -> owner approves -> points credited.

## 4. TECH STACK
Frontend: React 18 + Vite + Tailwind (Ma'am's UI, luxury design gold #C5A880, ink #111111, Playfair Display + Montserrat)
Backend: Convex serverless, deployment pleasant-cobra-560.eu-west-1.convex.cloud, team loyaltyos-boutique
Database: Convex tables — users, lookbooks, catalogue_items, orders, campaigns, settings, reviews
Auth: convex/auth.ts — bcrypt merchant login, 256-bit magic tokens, 180-day expiry, Resend reset. auth.ts has been modified repeatedly since Step 3.7, not left untouched: 5162ac4 (requireMerchantSession helper), 5545175 (Critical #1/#2 audit fixes) + 1c19ccb (revert of that commit), 4fe1273 (rate limiting via @convex-dev/rate-limiter on generateMagicToken/createCustomer/createReview).
Backend auth guard: merchant-only Convex functions (39 fns across customers/lookbooks/orders/reviews/settings/templates/whatsapp) now require session validation via requireMerchantSession() in convex/auth.ts — built on branch feat/merchant-session-lock (commits df25962..a99837f) and MERGED to main via merge commit 85e20b4 (ledger recorded in follow-up commit ff1cbcb). auth.ts has also been modified multiple times since that merge — see TECH STACK auth.ts note below.
Email: Resend, from digital@mouldinnovation.com
Deploy: Vercel (loyaltyos-boutique-three.vercel.app) + GitHub (LoyaltyOs-boutique/loyaltyos-boutique)
Old stack (Express/Postgres/Redis/Docker) = ARCHIVED, never reintroduce.
Money: always integer paise, never floats.
Points: earn Rs100 = 1pt (floor), tiers silver/gold/platinum 0-999/1000-2999/3000+, multipliers 1x/1.5x/2x, redeem 1pt = Rs1.
Confidential: measurements + staff_notes are merchant-only, never shown to customer.

## 5. HARD RULES

### 5.1 Branch flow
1. New branch: git checkout -b feat/<stepX|fixX|improveX>-<n> from main
2. Do the work in small chunks
3. Test with real commands + outputs
4. Push: git push -u origin <branch>
5. Verify push: git branch -vv must show [origin/...]
6. Share Vercel preview link with team
7. On approval: git checkout main && git pull origin main && git merge <branch> && git push origin main
8. Verify merge: git branch --no-merged main should be empty

### 5.2 Agents by task
Backend work -> office-backend-agent
Frontend work -> office-frontend-agent
Testing/QA -> office-tester-agent

### 5.3 Clean scalable code
Readable structure, comments explaining why, typed validators, single source of truth, no duplication, no dead code.

### 5.4 Frontend strict (Ma'am's rule)
DO NOT edit: src/components/, src/pages/ (except approved flows), src/App.jsx, src/index.css, src/data/
Allowed files: src/lib/db.js, src/main.jsx
Approved flow files (specific sections only): Login.jsx (forgot-password), Lookbook.jsx (auth/waLink), Join.jsx (onboarding), Onboarding.jsx, Customers.jsx (eye/copy/share/edit), Catalogue.jsx (copy/share), PublicLookbook.jsx
Build must stay ~30.00 kB CSS (real `npm run build` on 2026-09-07 on branch feat/ai-automation-gemini-phase: dist/assets/index-CCDmCF7r.css 30.00 kB) — report exact size if it changes.

### 5.5 Ledger rules
Canonical ledger: .superpowers/sdd/progress.md
Mirror: memory-bank/progress.md — must be updated identically
Format: Task <N>: complete (commits <base7>..<head7>, review clean)
A task is not complete until committed with hash AND both ledgers have that hash.
Banned phrases: untouched, intact, zero edits — unless with real git diff --stat output.
Every "tester verified" claim must name the exact command + paste output.
Check for duplicate Task lines before committing ledger updates.

### 5.6 Ask before edit
Before editing any file, list exact files that will change and get approval, unless user said proceed without asking.

### 5.7 No redo
At session start, read this file + current-state.md. Do not redo completed tasks.

### 5.8 No unrequested work
Do not create extra files unless asked. Delete temp files before finishing.

### 5.9 Diff-scoped verification
Verify only what the diff touched. Backend-only change needs no frontend build check.

### 5.10 Convex deploy
After ANY change to convex/ functions: run npx convex dev --once. Code in git is not the same as deployed.

### 5.11 Minimal code (ponytail ladder)
Before writing code check: does it need to exist? already in codebase? stdlib? native feature? installed dependency? one line? Only then write minimum needed. Never cut validation, error handling, security.

### 5.12 Spec-driven (hard gate)
No code until design is presented and approved. Save approved design to docs/superpowers/specs/YYYY-MM-DD-topic-design.md.

## 6. SESSION READ ORDER
1. CLAUDE.md (this file)
2. current-state.md
3. memory-bank/ (6 files)
4. .superpowers/sdd/progress.md (canonical ledger)
5. docs/superpowers/specs/ + docs/superpowers/plans/
6. tasks.md

## 9. LEDGER UPDATE PATTERN
After every completed task, append to BOTH .superpowers/sdd/progress.md and memory-bank/progress.md:
- YYYY-MM-DD: Task name complete - 1-2 line summary (commit hash, tester verified) - files, build size, test results

Also update current-state.md and tasks.md checkboxes.

## 11. PROMPTING TEMPLATE
When given a task, structure work as:
1. Explain what this step is about (simple words first)
2. Context: current state
3. Task: specific, small, one-file-focus when possible
4. STRICT: what NOT to touch
5. Test: exact commands + expected output
6. Commit + push: exact message + verify push
7. Ledger: update both files with hash
8. Report: files changed, test results, build size, preview link
Keep prompts small — 1-3 files max.

## 12. COMMON ISSUES (NEVER REPEAT)
1. "Push successful" can be a lie — always verify with git branch -vv.
2. Convex functions not deployed until npx convex dev --once runs.
3. Local slug ids vs real Convex _id can mismatch — map correctly.
4. Points must never double-credit — only add after owner approval, not on submit.
5. Magic link session breaks if magic_token_created_at not preserved through hydration.
6. Frontend is sacred — ask before editing, verify git diff before merging.

## 14. CURRENT STATE + REMAINING (updated 2026-09-07)

Two tiers below. MERGED TO MAIN = live/shipped, usable today on loyaltyos-boutique-three.vercel.app. BRANCH-ONLY (feat/ai-automation-gemini-phase) = built and tested, NOT deployed/live. Always confirm via git branch -vv / git log main..feat/ai-automation-gemini-phase before telling the team something is live — do not assume from memory.

### Done and merged to main, beyond the original Step 1-8 MVP (see PROJECT SUMMARY/TECH STACK for that baseline)
- Gate 1+2 (4b828e2): CSV bulk customer import, lookbook per-piece share fix + selector, Buy Now/Inquire buttons, PDF in-app preview, OG-preview middleware, whatsapp_consent/is_deleted/size/colour schema fields.
- Templates Phase 1+2+3 (fbaca0e): media-upload backend, Anniversary/Birthday/Media-Send page, static card-image WhatsApp send via OG-preview middleware, merchant-replaceable card images.
- WhatsApp Cloud API + Points Ledger + fixes (d013ffd): WhatsApp Cloud API integration + template config + Approve & Send flow, manual-entry drag-drop media upload, WhatsApp consent checkbox + gating, Points Ledger (points_ledger table, awardPoints mutation, tier editor, reason-type dropdown), plus bundled fixes (testimonial-points hardcode, tier-multiplier, Settings layout, Lookbook staleness, stale-CRM-refresh, CRM tab removal, message-action tracking).
- Merchant Session Lock (85e20b4, ledgered ff1cbcb): requireMerchantSession() guard on 39 merchant-only functions across customers/lookbooks/orders/reviews/settings/templates/whatsapp, db.js wired with session args, plus post-merge fixes (hydration-timing gaps, broken CSV import regression fixed, Points Tool stale-session detection, Activity Ledger fixes, onboarding Staff Note fix, like-toggle fix, premature points-crediting fix, IST timezone fix for birthdays/anniversaries, Dashboard Recent Activity redesign, review-approval crash fix). auth.ts has been touched repeatedly across all of this — never assume it is untouched.

### Built and tested on branch feat/ai-automation-gemini-phase — NOT merged, NOT live
- Phase 0 scaling fixes: CRM pagination, indexed today's-orders + birthday/anniversary queries.
- Phase 1 Customer Intelligence: getCustomerIntelligenceProfile (cart/likes intelligence explicitly deferred, Option B).
- Phase 2: convex/ai.ts Gemini plumbing (fails gracefully with no key).
- Phase 3: AI message drafts backend (draft-only, does not touch send/approve flow).
- Phase 5: Events + VVIP backend/frontend (events table, users.vvip, Event Setter UI).
- Dashboard Notifications bell: notifications table + daily cron + Shell.jsx bell UI, plus UI polish and a red-dot/real-tab-navigation follow-up fix.
- 2026-09-04/05 full security audit (docs/full-system-audit-2026-09-04.html) + fix round: rate limiting (@convex-dev/rate-limiter) on generateMagicToken*/createCustomer/createReview; AI prompt-injection + output-sanitization hardening in ai.ts/events.ts; getEventAccess VVIP read-time re-check; daily-cron fixed-schedule fix (00:05 AM IST instead of deploy-relative); this CLAUDE.md correction round (an earlier pass fixed 3 stale claims; this is the broader current-state/remaining rewrite that pass deferred).
- Critical #1/#2 (magic-link account takeover, createCustomer confidential-data leak): a fix was built, pushed, and then REVERTED after it broke live CRM listing + re-onboarding — both vulnerabilities are OPEN AGAIN today, on main and on this branch. Do not re-attempt without reading the 2026-09-05 revert + root-cause-correction ledger entries first.

### Remaining / genuinely open today
1. Critical #1/#2 — still open, needs a proper fix (OTP/ownership step, or merchant-only token issuance) — last attempt regressed two live flows.
2. Forgot-password reset still incomplete — no resetPassword mutation consumes the token; /reset-password has no completion path.
3. Deployed settings data bug — gold.purchasePercent = 0 live (masked by fallback), stray gold.anniversaryBonus = 205.
4. Events dispatch uses service (24h-window) messages — most cold recipients silently fail; tied to the D-17 WhatsApp large-placeholder template, which is decided but not yet built and is blocked on Meta template approval.
5. Unbounded .collect() reads remain in getCustomers/getOrders/getReviews/getLookbooks — need pagination before real scale.
6. Cart/likes intelligence deferred (Option B); Phase 4 of the AI automation plan not started.
7. External audit items open: CORS credentials issue, customer-enumeration oracle, missing security headers (CSP/XFO/nosniff/Referrer-Policy), tokens in plain localStorage (not HttpOnly), npm audit findings needing breaking major-version bumps (vite/react-router-dom).
8. Whether/when to merge feat/ai-automation-gemini-phase to main is itself an open decision — nothing on it is live yet.
9. Phase 2 (original plan): OTP verification (directly relevant to fixing Critical #1/#2), gamification, coupons, broadcast engine, bulk Instagram parser.
Always ask user what to work on next - never assume.

---

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.
When working on Convex code, always read
`convex/_generated/ai/guidelines.md` first for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.
Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.
<!-- convex-ai-end -->
