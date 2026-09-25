# Merchant Hydrate-on-Mount Fix — Design Spec

**Date:** 2026-09-15
**Branch:** feat/ai-automation-gemini-phase
**Status:** APPROVED (direction — Option A, hydrate-on-mount gate in shared Shell), pending build
**Type:** Frontend data-layer fix (no visual/layout change)
**Author:** office-backend-agent (spec doc only, no code written)

> This spec fulfills Hard Rule 5.12 (SPEC-DRIVEN HARD-GATE): no code is written until this design is approved. Every existing-code claim below is cited by `file:line`, re-verified against the current working tree on 2026-09-15 (not taken from the audit memo).

---

## 1. Problem statement

Three merchant pages — **Customer CRM**, **Templates**, **Campaigns** — intermittently show **empty dropdowns / empty lists** after a page reload or in a new browser tab, even though the merchant is still logged in (session token persisted in localStorage). A fresh logout → login always fixes it; a plain reload does not. This is a **data-hydration timing bug**, not an auth bug.

### 1.1 Root cause — hydration only ever runs at fresh-login OR at module-import, both of which miss the persisted-session reload path

The session-gated Convex hydration functions (`hydrateCustomers`, `hydrateCatalogue`, `hydrateReviews`, `hydrateCustomersPage`, etc.) all short-circuit to a no-op when there is no valid merchant session yet:

- `hydrateCustomers()` — `src/lib/db.js:285-300` — `const session = merchantSessionArgs(); if (!client || !session) return;`
- `hydrateCustomersPage()` — `src/lib/db.js:348-380` — same `if (!client || !session) return;` guard (`:350-351`)
- `getCustomers()` — `src/lib/db.js:419-424` — returns `Promise.resolve([])` when `!session`
- `getLookbooksForSelector()` — `src/lib/db.js:839-844` — returns `Promise.resolve([])` when `!session`
- All gated through `merchantSessionArgs()` — `src/lib/db.js:460-464` — which returns `null` when there is no token. **None of these surface an error** — a logged-out/not-yet-stamped caller looks identical to an offline one (documented intentionally at `db.js:454-458`).

Hydration is currently triggered from only **two** places, and **both miss the persisted-session reload**:

1. **Module-import time** — `src/lib/db.js:2309-2327` fires `hydrateCustomers()`, `hydrateSettings()`, `hydrateCatalogue()`, `hydrateReviews()`, `hydrateNotifications()` **once at module load**. On a reload this runs **before** the merchant session token is reliably resolvable through `getMerchantSession()` (`db.js:1922-1931`, which also needs `state.users` loaded), so `merchantSessionArgs()` returns `null` and every one of these calls is a **silent early no-op**. They are never retried.
2. **Fresh-login success handler** — `merchantLogin()`'s centralized hydration trigger at `src/lib/db.js:121-140`, inside the Convex `merchantLogin` mutation's `.then()`. This is **the only moment** hydration reliably fires with a valid session — but it **only runs on an actual login mutation**, never on a reload where the session is restored from localStorage without re-issuing the mutation.

**Net effect:** on reload / new tab, no code path ever re-fires hydration once the persisted session becomes valid → the pages render whatever stale (or empty) data is in the local seed/state singleton.

### 1.2 Why the prior partial fix (`1420123`) did not generalize

The `merchantLogin()` centralized trigger (`db.js:121-140`, commit `1420123`, "centralize hydration trigger") was written to close this bug class "at its source" — its own inline comment (`db.js:126-134`) admits the per-page hydrate patches "kept resurfacing page-by-page (Templates.jsx, PointsLedger.jsx, Campaigns.jsx, Onboarding.jsx)." But it has **two structural gaps**:

- It is wired **only into the login mutation's success path** — so it does nothing on a persisted-session reload (the exact bug), which never calls that mutation.
- Even when it *does* fire, it calls **only** `hydrateCustomers()` / `hydrateCatalogue()` / `hydrateReviews()` (`db.js:138-140`). It does **not** call:
  - `hydrateCustomersPage(0, PAGE)` — the **paginated** cache Customers.jsx's default view actually renders (see §1.3).
  - `getLookbooksForSelector()` — Campaigns' designer dropdown source.
  - `getCustomers()` — Templates' customer dropdown source.

So even a fresh login leaves the paginated Customers view and the two dropdowns cold until each page's own mount effect fetches them.

### 1.3 The "56 but 0 rows" mechanism — two independent caches that can desync

Customers.jsx's default list footer reads `Showing {rows.length} of {list.length}` (`src/pages/merchant/Customers.jsx:381`). These two numbers come from **two completely independent caches**:

- **`list`** ← `customers()` → the **full** `.collect()`-backed customer array in `state.users`, populated by `hydrateCustomers()` (`db.js:285-300`). This drives the **count** (`list.length` = e.g. 56).
- **`rows`** ← `customersPage(page)` (`db.js:392-401`) → the **separate** `.paginate()`-backed cache (`paginatedCustomers` module singleton, `db.js:328-333`), populated by `hydrateCustomersPage(page, PAGE)` (`db.js:348-380`), fired from `Customers.jsx:106-108` (gated on `isDefaultView`). This drives the **rendered rows**.

If `hydrateCustomers()` succeeds (count = 56) but `hydrateCustomersPage(0, PAGE)` never fires with a valid session (e.g. on reload), the count shows 56 while **zero rows render** — the exact reported bug. The two mount effects that feed these caches are both at `Customers.jsx:77` (`hydrateCustomers(); hydrateReviews();`) and `Customers.jsx:106-108` (`hydrateCustomersPage(page, PAGE)`), but both are session-gated and silently no-op if the session isn't resolvable at mount.

`PAGE` = **6** (`src/pages/merchant/Customers.jsx:22` — `const PAGE = 6;`).

### 1.4 The two dropdowns fetch fresh into component state — they read NO shared cache

- **Templates** customer dropdown — `src/pages/merchant/Templates.jsx:505-509`: `useEffect(() => { getCustomers().then((rows) => …setCustomers(rows)) }, [])`. `getCustomers()` (`db.js:419-424`) **issues a fresh Convex query every call and returns a promise** — it does **not** read from or write to any shared module cache. The result lands in Templates' own `useState`.
- **Campaigns** designer dropdown — `src/pages/merchant/Campaigns.jsx:49-53`: `useEffect(() => { getLookbooksForSelector().then((rows) => …setEventLookbookOptions(rows)) }, [])`. `getLookbooksForSelector()` (`db.js:839-844`) is **also a fresh-fetch-per-call promise**, no shared cache, result lands in Campaigns' own `useState`.

**This is the decisive finding for the design (see §3):** because these two calls always issue a fresh fetch and never read a shared cache, **Shell pre-warming them cannot help those two pages** — their mount effect will fetch again regardless of what Shell did. Their real bug is the same one: their own mount effect runs before the persisted session is valid, so their one-shot fetch returns `[]`.

---

## 2. Design (approved direction — Option A)

Add a **hydrate-on-mount gate in the shared merchant Shell** (`src/components/merchant/Shell.jsx`), so hydration fires whenever **any** merchant page mounts **with a valid session** — not just at fresh login and not just at module import. Because every merchant page routes through `Shell`, this closes the login / reload / new-tab gap in **one place** and auto-covers future merchant pages.

### 2.1 The one-shot-per-session-token effect (loop-safe)

Placed inside `Shell()` (the default export, currently `src/components/merchant/Shell.jsx:356-424`). Shell already resolves the session once at mount via `const [me] = useState(() => getMerchantSession())` (`Shell.jsx:358`), so the token is already available in-component.

Detection rule — **"session just became valid for a token we haven't hydrated yet"**, guarded by a `useRef` holding the last-hydrated token:

```
const hydratedTokenRef = useRef(null);
useEffect(() => {
  const session = getMerchantSession();          // { id, token } or null
  const token = session?.token || null;
  if (!token) return;                            // logged out → nothing to do
  if (hydratedTokenRef.current === token) return;// already hydrated THIS token → no re-fetch on re-render
  hydratedTokenRef.current = token;
  hydrateAllMerchantData();                      // single convenience fn added in db.js (§3.2)
}, []);  // see loop-safety note below
```

Loop-safety / over-fetch rules this satisfies:
- **Does not re-fire on every re-render** of Shell for the same token — the `hydratedTokenRef` short-circuits repeat renders of the same session.
- **Re-fires when the token changes** — e.g. a new login issues a new token; `hydratedTokenRef.current !== token` → hydrate again. (In practice Shell unmounts on `/login`, so a new login remounts Shell fresh anyway; the ref guard is belt-and-suspenders for any SPA transition that keeps Shell mounted.)
- **Fires exactly once per Shell mount** that has a valid session — which is precisely the reload / new-tab case that is currently missed. On a fresh login, `merchantLogin()`'s existing trigger (`db.js:121-140`) may have already warmed caches; the underlying hydrate functions each self-guard via their own `xHydrating` flag (`hydrateCustomers` at `db.js:286`, etc.), so this is **safe to double-invoke — no double-fetch race**.

The dependency array can stay `[]` (fire once per mount) since the ref handles token-change re-fire within a mount; if the team prefers, `[me]` is equivalent because `me` is captured once at mount too. `[]` is simplest and matches the existing `hydrateNotifications` mount effect at `Shell.jsx:132`.

### 2.2 What gets hydrated — the FULL set, closing every known gap

`hydrateAllMerchantData()` (new convenience fn in `db.js`, §3.2) calls, in order:

1. `hydrateCustomers()` — full customer list → drives the `list.length` count and CRM.
2. `hydrateCatalogue()` — catalogue items → Lookbook Manager.
3. `hydrateReviews()` — pending reviews → Dashboard + CRM reviews tab.
4. **`hydrateCustomersPage(0, PAGE)`** — **the currently-missing paginated page-0 warm**, using `PAGE = 6` (cited from `Customers.jsx:22`; the constant must be kept single-sourced — see §3.3). This is what fixes the "56 but 0 rows" desync on reload.
5. `hydrateSettings()` — public/unguarded, but included for a complete one-call warm (harmless; already safe without a session per `db.js:135-137`).
6. `hydrateNotifications()` — bell panel data (already fired from `Shell.jsx:132`; folding it in here is optional and self-guarded — keep the existing call OR move it here, not both firing needlessly; recommend leaving `Shell.jsx:132` as-is and NOT duplicating, to avoid touching the NotificationBell component).

**`getCustomers()` and `getLookbooksForSelector()` are deliberately NOT in this list** — see §2.3.

### 2.3 The two dropdowns — Shell pre-warming does NOT fix them (decisive finding)

As established in §1.4, `getCustomers()` (Templates) and `getLookbooksForSelector()` (Campaigns) **fetch fresh per call into component-local `useState`** and read **no shared `db.js` module cache**. Therefore:

- **Shell cannot pre-warm them.** Calling them from Shell and discarding the result would warm nothing — the next call from Templates/Campaigns still hits the network fresh.
- Their bug is nonetheless the **same session-timing bug**: their own mount effect (`Templates.jsx:505-509`, `Campaigns.jsx:49-53`) runs before the persisted session is valid and resolves to `[]`.

Two ways to fix them (recommendation in §3.4):
- **(Recommended) db.js-only fix:** give `getCustomers()` / `getLookbooksForSelector()` a **shared module-level cache** that `hydrateAllMerchantData()` populates from Shell, and have those two bridge functions **return the warmed cache** (falling back to a fresh fetch if the cache is empty). Then Shell's warm-up actually reaches both pages, and **no edit to Templates.jsx / Campaigns.jsx is needed**. This keeps the whole fix inside the two allowed files (`db.js` + `Shell.jsx`).
- **(Alternative) page-side fix:** re-run each page's fetch effect once the session becomes valid (e.g. keyed on a session-token value). This requires editing `Templates.jsx` / `Campaigns.jsx` — larger blast radius on frontend-sacred files, so **not preferred**.

### 2.4 No visual / layout change to Shell

The **only** change to `Shell.jsx` is **one added `useRef` + one added `useEffect`** inside the `Shell()` function body (§2.1). No change to any markup, JSX, navigation (`NAV`), the `NotificationBell` component, the sidebar, the mobile drawer, or any className/design token. Verified against the full current file (`Shell.jsx:1-425`): the export's returned JSX (`Shell.jsx:363-423`) is untouched by this design.

---

## 3. Files this design would touch

| File | Protected? | Change |
|---|---|---|
| `src/lib/db.js` | **ALLOWED** (data-layer bridge, Hard Rule 5.4) | Add `hydrateAllMerchantData()` convenience fn bundling the §2.2 set; **recommended:** add a small shared module cache + cache-read to `getCustomers()` / `getLookbooksForSelector()` so §2.3's dropdowns are covered without touching their pages. |
| `src/components/merchant/Shell.jsx` | **PROTECTED** (`src/components/`) — **user-approved** for this specific scoped change: a hydrate-on-mount **data-fetch effect only**, no layout/markup change | Add one `useRef` + one `useEffect` (§2.1) that calls `hydrateAllMerchantData()` one-shot-per-session-token. Nothing else in the file changes. |

### 3.1 Recommended split — keep Shell's edit a one-liner, logic lives in db.js

**Recommended.** Add a single exported `hydrateAllMerchantData()` in `db.js` that bundles the full §2.2 hydration set. Shell then calls just that one function, so:
- Shell's protected-file edit is a **minimal one-shot effect calling one function** — smallest possible footprint on Ma'am's protected component.
- The actual hydration list / ordering / future additions live in the **already-allowed** `db.js`, where they can evolve without ever re-touching `Shell.jsx`. Future merchant pages get covered by adding to `hydrateAllMerchantData()` alone.

### 3.2 `hydrateAllMerchantData()` — new export in db.js

Bundles: `hydrateCustomers()`, `hydrateCatalogue()`, `hydrateReviews()`, `hydrateCustomersPage(0, PAGE)`, `hydrateSettings()`. Each callee already self-guards via its own hydrating flag, so this is idempotent and race-safe alongside `merchantLogin()`'s existing trigger (`db.js:121-140`) and the module-load calls (`db.js:2309-2327`).

### 3.3 `PAGE` single-source

`hydrateAllMerchantData()` needs the page size for `hydrateCustomersPage(0, PAGE)`. `PAGE = 6` currently lives only in `Customers.jsx:22`. To avoid a duplicated magic number (Hard Rule 5.3, single source of truth), the build should either (a) export `PAGE` from a shared location `db.js` can import, or (b) define the page-size constant in `db.js` and have `Customers.jsx` import it — **but (b) edits `Customers.jsx`**, an approved-flow file only for eye/copy/share/edit sections, so **(a) or a plain shared `db.js` constant is preferred**. Simplest acceptable: define `const CUSTOMERS_PAGE_SIZE = 6;` in `db.js` with a comment cross-referencing `Customers.jsx:22`, and note both must stay equal. Flag this to the team at build time.

### 3.4 Do Templates.jsx / Campaigns.jsx also need an edit? — Finding

**No — if the recommended db.js-only approach (§2.3, first bullet) is taken.** By giving `getCustomers()` / `getLookbooksForSelector()` a shared cache that `hydrateAllMerchantData()` populates and those bridges return, the fix reaches both dropdowns entirely from `db.js` + `Shell.jsx`, leaving `Templates.jsx` and `Campaigns.jsx` **untouched**.

**If instead the shared-cache approach is rejected,** then Shell's fix **alone does NOT change Templates/Campaigns behavior at all** — their `getCustomers()` / `getLookbooksForSelector()` calls always fetch fresh and read no warmed cache — and the real fix for those two pages must live in `db.js` (making those bridges cache-aware), OR each page needs its own re-fetch-on-session-valid effect (editing the pages). The **db.js-only, pages-untouched** route is recommended for minimal frontend blast radius.

---

## 4. Out of scope (deliberately NOT changed)

- **No rewrite to Convex `useQuery` / reactive subscriptions** (this was "Option B" — rejected for now as too large/risky; it would replace the entire local-first hydration bridge pattern the app is built on).
- **No visual/layout/markup change to `Shell.jsx`** — only the one data-fetch effect + ref.
- **No change to session / auth logic** — `getMerchantSession()`, `merchantSessionArgs()`, token issuance, expiry, and the login mutation are all untouched. This fix only *reacts* to a valid session existing; it never creates or validates one.
- **No change to Convex functions** — this is a pure frontend data-layer timing fix; `convex/` is not touched (so no `npx convex dev --once` needed for this task).
- **No removal** of the existing `merchantLogin()` trigger (`db.js:121-140`) or module-load calls (`db.js:2309-2327`) — they remain as complementary warm paths; the new Shell gate is additive and idempotent.

---

## 5. Verification plan (for the eventual build)

Diff-scoped (Hard Rule 5.9): frontend `src/` change → `npm run build` + browser check; no Convex suite needed.

### 5.1 Build
- `npm run build` → report exact `dist/assets/index-*.css` size; must stay ~30.00 kB (baseline `2026-09-07`). A JS-only logic change should not move CSS — flag if it does.

### 5.2 The reload case (the actual bug) — PASS/FAIL
| Step | Expected |
|---|---|
| Log in as `owner@boutique.in` / `owner123` | Dashboard loads, data present |
| **Hard-reload** the page while still logged in (persisted token, no logout) | Customer CRM list populates **without** a fresh logout/login |
| On Customer CRM after reload | Footer count (`Showing X of Y`) and **actual rendered rows agree** — no "56 of … / 0 rows" |
| Open Templates after reload | Customer dropdown is **populated** (not empty) |
| Open Campaigns after reload | Designer dropdown is **populated** (not empty) |
| Open the app in a **new tab** while logged in | Same three surfaces populate on first landing |

### 5.3 Regression (kuch nahi tootega na)
| Flow | Expected |
|---|---|
| Fresh login (not reload) | Still hydrates everything as before — no regression to `db.js:121-140` behavior |
| No infinite loop / no repeated network calls | Network tab shows the hydrate queries fire **once** per session token, not per render (ref-guard working) |
| Logged-out `/login` page | No merchant hydrate fires (session null → effect no-ops); no console errors |
| Notification bell | Still works (its own `hydrateNotifications` at `Shell.jsx:132` untouched) |
| SPA navigate between merchant pages (no reload) | No redundant re-hydrate storm; ref guard holds for the same token |
| `git diff v1-baseline..HEAD -- src/pages src/components src/index.css` | Only the approved `Shell.jsx` effect addition appears under `src/components/` — confirm no stray markup/design change |

### 5.4 Ledger (Hard Rule 5.5)
On completion, update BOTH `.superpowers/sdd/progress.md` and `memory-bank/progress.md` with the commit hash, and update `current-state.md`.
