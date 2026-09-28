Title: One-Device Merchant Login Lock

Goal: While the merchant account is logged in and active on one device, a second device cannot log in. The second device sees a clear message and a button, and the first device is never disturbed.

Facts from the audit (verified on the current code):
- Sessions live on the users row as session_token and session_expiry (convex/schema.ts:39-40). Expiry is 7 days (convex/auth.ts:34).
- merchantLogin (convex/auth.ts:112-147) is one mutation and always overwrites the old token. It has no rate limit.
- requireMerchantSession (convex/auth.ts:91-104) guards 59 call sites across 11 files. It must not be modified.
- There is no server-side logout. Shell.jsx:361 signOut only clears local state.
- Login.jsx:16-22 checks locally and navigates immediately; the real token arrives later inside db.js merchantLogin (src/lib/db.js:79-152).
- getMerchantSession (src/lib/db.js:2280-2289) never validates against the server.
- The app has no reactive subscriptions. Polling is the existing pattern (Dashboard.jsx:65-69).

Decisions (approved by the user):
1. Feature switch: a Convex environment variable ONE_DEVICE_LOCK. Unset or any value other than "on" means OFF, and merchantLogin behaves exactly as today. The switch is turned on only after the frontend is live.
2. New optional field users.session_last_seen (number, epoch ms). Additive only. No new index is needed.
3. Login flow when the switch is ON: the server first verifies the password. Wrong password gives the existing "Incorrect email or password." A correct password with a live session on another device is refused with a distinct, structured refusal that the frontend can tell apart from a wrong password. No token is issued and no session field is changed on refusal.
4. A session is "live" when session_token exists, session_expiry is in the future, session_last_seen exists, and now minus session_last_seen is less than 5 minutes. A session with no session_last_seen (legacy sessions) counts as not live, so nobody is locked out at rollout.
5. On successful login, set session_last_seen to now together with the token and expiry, in the same patch.
6. New mutation merchantLogout(userId, token): if the token matches, clear session_token, session_expiry and session_last_seen. If the token does not match, do nothing and return ok (idempotent, never throws for a stale token).
7. New mutation merchantHeartbeat(userId, token): validates with requireMerchantSession (called, not modified), then patches session_last_seen to now. Skip the write if the stored value is less than 30 seconds old, to avoid needless writes. A bad token throws the existing session errors.
8. Frontend Login.jsx: login must wait for the server result before navigating (no optimistic navigation). On refusal, show a message such as "This account is already logged in on another device. Please log out from that device first." with an OK button. OK returns to the login form with the email kept and the password cleared. On refusal nothing is saved: no saveMerchantSession, no hydrate, no token stored.
9. Frontend Shell.jsx: send a heartbeat every 60 seconds while the merchant shell is mounted, plus one immediately on mount and one whenever the tab becomes visible again. If a heartbeat is rejected with an existing session error (use the existing isSessionRejected helper pattern), clear the local session and go to /login with a clear message that the session ended because the account was used elsewhere or timed out. Clean up timers on unmount.
10. signOut in Shell.jsx: call merchantLogout first (best effort, short timeout), then clear the local session and navigate. If the server call fails, still log out locally.
11. UI styling: reuse only existing classes found by a read-only audit (quote exact className strings). No new CSS classes. CSS baseline must stay 30.42 kB unless a new class is proven necessary.
12. Do not touch: requireMerchantSession and its 59 call sites, convex/rateLimits.ts, any customer-facing magic-link flow, /join, and the existing customer session code.
13. Protected files approved by the user for this work: src/pages/Login.jsx and src/components/merchant/Shell.jsx. src/lib/db.js is always allowed. Shell.jsx has broken before, so extra regression checks are required whenever it is touched.

Rollout order (mandatory):
1. Backend deployed with the switch OFF. Everything behaves as before.
2. Frontend built, tested and merged to main.
3. Before switching ON, every device must refresh or log in once so that heartbeats start.
4. Switch ON.
5. Emergency rollback: set the switch OFF. Old behavior returns immediately.

Known limits (accepted):
- If the first device's browser data is cleared, the server cannot tell. The lock releases after 5 minutes without a heartbeat. During that time the same person also gets the refusal message.
- A device offline for more than 5 minutes is treated as gone and sees a "session ended" message when it returns.
- Agent or CLI testing that calls merchantLogin will be refused while a real device is active, and will end a real device's session if it succeeds. Tests must be planned for quiet times, with the browser logged out.
- merchantLogin has no rate limit today. Out of scope here, only noted.

Test plan (to be run later, in a separate prompt):
- Switch OFF: login, logout and all pages behave exactly as before.
- Switch ON: correct password with no live session logs in. Second login within 5 minutes is refused. Wrong password shows the old error. Logout frees the account at once. No heartbeat for over 5 minutes frees the account. Legacy session with no last_seen is treated as free. Two simultaneous logins cannot both succeed.
- Heartbeat rejection sends the device to /login with the clear message.
- Full regression across merchant pages, Customers.jsx and Shell.jsx checks, cache-cleared build with CSS compared to 30.42 kB.

## AMENDMENTS (2026-09-28, after first review)

14. Refusal transport: when the switch is ON and a correct password meets a live session, merchantLogin RETURNS the object { locked: true } (not a thrown error). The existing return shapes stay unchanged: null for no such merchant or wrong password, and { user, token, expiresAt } for success. With the switch OFF, merchantLogin never returns { locked: true }.
15. Frontend login: add a NEW async function in src/lib/db.js used only by Login.jsx. It waits for the Convex result and navigates only after success. On success it reproduces every side effect of the existing merchantLogin success path (documented in the behavior table appendix). The existing merchantLogin function stays untouched. If the server is unreachable or throws, show "Could not reach the server. Please try again." and do NOT log in locally and do NOT save a session. With the switch OFF the new function must give the same user-visible results as today for wrong password and for success.
16. Shell.jsx heartbeat: one single useEffect keyed on the merchant token. It sends the first heartbeat only after the existing hydrate has been started or finished (must not race it), then every 60 seconds, and again on visibilitychange to visible. Cleanup must remove BOTH the interval and the visibilitychange listener. No duplicate timers when the token changes. Use the existing rejected-session helper by its real name in each file (isSessionRejectedError in src/lib/db.js, isSessionRejected in Customers.jsx). A rejected heartbeat clears the local session and goes to /login with the "session ended" message.
17. Additional known limits: (a) a legacy session with no session_last_seen counts as not live, so during the rollout window a second device can log in and end that session; the rollout step "every device refreshes or logs in once before the switch is ON" mitigates this. (b) A stale session_last_seen never blocks the active user's own actions, because requireMerchantSession is unchanged; it only lets a NEW login succeed. (c) A frozen or throttled background tab can let the lock expire; the visibility heartbeat and the session-ended message cover the return.
18. UI audit appendix: the exact classNames quoted from the audit in step 2 are the only classes the frontend build may use. No new CSS classes. CSS baseline 30.42 kB (verified in the ledger; the ~30.00 kB in CLAUDE.md is stale).

## APPENDIX A: merchantLogin behavior table and UI class audit

### A.1 Frontend merchantLogin behavior table (src/lib/db.js:79-152)

Note: the CURRENT `merchantLogin` is SYNCHRONOUS. It decides its return value from the LOCAL seed check ONLY (db.js:85-86) and fires the Convex mutation in a non-awaited `.then()` (db.js:94-145). So the Convex outcome never changes what `merchantLogin` returns today; it only affects async side effects (session token, hydration). Login.jsx:18-21 acts entirely on the synchronous return.

| # | (a) Local seed check | (b) Convex call outcome | (c) End state of session/app + what Login.jsx:16-22 does |
|---|---|---|---|
| 1 | FAIL — email not found (db.js:85 `if (!u) return null`) | not reached (returns before Convex) | `merchantLogin` returns null. Login.jsx:19 sets error "Incorrect email or password." and returns; no navigation, no session saved. |
| 2 | FAIL — password mismatch (db.js:86 `if (u.password_hash !== password) return null`) | not reached | Same as row 1: returns null → Login.jsx:19 error path, no nav, no session. |
| 3 | PASS (db.js:85-86 both pass), client available (db.js:92) | Convex succeeds with `res.token` (db.js:97) | Sync return `u` (db.js:151) → Login.jsx:20 `saveMerchantSession(u.id)` then Login.jsx:21 navigate to dashboard. Async `.then()` later: `saveMerchantSession(u.id, res.token)` (db.js:100), stamps `convexId`/`session_token`/`session_expiry` on the local row + `persist()` (db.js:114-120), and fires `hydrateCustomers()`/`hydrateCatalogue()`/`hydrateReviews()` (db.js:139-141). |
| 4 | PASS, client available | Convex returns null / no `res.token` (db.js:97 guard false) | Sync return `u` → Login.jsx:20-21 saves LOCAL session + navigates (already succeeded on local). Async `.then()` does nothing (guard at db.js:97 fails); no Convex token stored, no hydrate. App runs on local seed session only. |
| 5 | PASS, client available | Convex throws / unreachable (db.js:144 `.catch(() => {})`) | Sync return `u` → Login.jsx:20-21 saves LOCAL session + navigates. `.catch` swallows the error (offline demo flow). No Convex token, no hydrate. |
| 6 | PASS, NO client (db.js:146 `else if (u)`) | not applicable (no client) | `saveMerchantSession(u.id)` local random token (db.js:149), sync return `u` → Login.jsx:20-21 saves local session again + navigates. |

Login.jsx:16-22 in every PASS row navigates immediately on the synchronous local result (optimistic). Decision 8 + amendment 15 require the NEW async login function to instead wait for the server and navigate only after success — this table documents the side effects that new function must reproduce on the success path.

### A.2 Every side effect inside the `.then()` callback of merchantLogin (success path to reproduce)

- db.js:100 — `saveMerchantSession(u.id, res.token)` (persists the Convex 256-bit token against the local user id).
- db.js:101-102 — `state.users.findIndex(...)` locate the local row (in-memory read, not a side effect but gates the writes below).
- db.js:114-119 — mutate `state.users[sIdx]` to set `convexId: res.user?.id`, `session_token: res.token`, `session_expiry: res.expiresAt`.
- db.js:120 — `persist()` (writes the mutated users state to localStorage).
- db.js:139 — `hydrateCustomers()`.
- db.js:140 — `hydrateCatalogue()`.
- db.js:141 — `hydrateReviews()`.

(Also note, outside the `.then()`, on the synchronous path Login.jsx:20 calls `saveMerchantSession(u.id)` — the token-less local variant — and the no-client branch db.js:149 calls `saveMerchantSession(u.id)`.)

### A.3 UI class audit — Login.jsx (verbatim)

Error-message line (Login.jsx:62):
```
{error && <div className="text-xs text-red-500">{error}</div>}
```
- Error container className: `text-xs text-red-500`
- Rendered via the conditional `{error && <div ...>{error}</div>}` — shown only when `error` is a non-empty string.

Form field (input) classNames — both email and password inputs use (Login.jsx:60-61):
```
className="input"
```
(email input line 60, password input line 61, both `className="input"`; labels use `className="label"`.)

Submit button (Login.jsx:63):
```
<button className="btn-ink w-full">Sign in to your boutique</button>
```
- Submit button className: `btn-ink w-full`

Forgot-password link button (Login.jsx:65) className: `mt-5 text-xs tracking-wide2 uppercase text-steel hover:text-ink cursor-pointer`

### A.4 UI class audit — Shell.jsx hydrate-on-mount effect + signOut (verbatim, Shell.jsx:361-378)

signOut function body (Shell.jsx:361):
```
const signOut = () => { clearMerchantSession(); navigate('/login'); };
```

Existing hydrate-on-mount effect using hydratedTokenRef (Shell.jsx:371-378):
```
  const hydratedTokenRef = useRef(null);
  useEffect(() => {
    const token = getMerchantSession()?.token || null;
    if (!token) return;
    if (hydratedTokenRef.current === token) return;
    hydratedTokenRef.current = token;
    hydrateAllMerchantData();
  });
```

### A.5 UI class audit — reusable Modal / message-panel pattern (verbatim, src/components/ui.jsx:42-58)

Exported `Modal` component (src/components/ui.jsx:42), imported into Shell.jsx:10 (`import { Modal } from '../ui.jsx';`). Verbatim classNames:

- Overlay (ui.jsx:45): `fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 sm:p-8`
- Card (ui.jsx:47): `cls('card bg-white w-full my-6 animate-fadeUp', wide ? 'max-w-4xl' : 'max-w-lg')` — i.e. base `card bg-white w-full my-6 animate-fadeUp` plus `max-w-lg` (default) or `max-w-4xl` (wide).
- Header row (ui.jsx:50): `flex items-center justify-between border-b border-line px-6 py-4`
- Header title (ui.jsx:51): `luxe-title text-lg`
- Header close button (ui.jsx:52): `text-steel hover:text-ink text-xl leading-none cursor-pointer`
- Body (ui.jsx:54): `p-6`

An "OK button" for the refusal message can reuse the existing button classes already audited in A.3 — `btn-ink w-full` (submit-style, ui does not define a separate confirm button).

## AMENDMENTS (2026-09-28, second review)

19. The feature switch does not protect the frontend. The new async login path in Login.jsx and db.js applies to every user as soon as the frontend is live, even with the switch OFF. Therefore a full switch-OFF regression test is mandatory before merging: wrong email, wrong password, correct login, repeated logout and login, forgot-password flow, session-ended message, and a check that the merchant pages load real data after login.
20. Accepted behavior change: today the login succeeds locally even when the server is unreachable (Appendix A.1 rows 4, 5 and 6). The new login function refuses in that case and shows "Could not reach the server. Please try again." No local-only login remains for the merchant.
21. Stale-tab limit: a tab still running the OLD frontend after the switch is ON would treat { locked: true } like "no token" and log in locally with an empty session. The backend cannot prevent this. Before the switch is turned ON, every device must hard refresh or reopen the app, and the rollout must not turn the switch ON while old tabs may exist.

## APPENDIX B: password source and local row lookup

(a) After a password is changed through the forgot-password or reset flow on the server, is the local seed/local-state `password_hash` (the one db.js:85-86 compares against) ever updated anywhere in the code?

No code updates it. Search evidence:
- The local seed `password_hash` for the merchant is a hardcoded literal in src/data/seed.js:88 (`password_hash: 'REDACTED'` — actual value redacted). It is only ever assigned at seed time.
- `grep -rin "resetpassword" src/ convex/` returns NO MATCH anywhere. There is no `resetPassword` mutation or function in the entire repo. `convex/auth.ts` exports only merchantLogin (auth.ts:112), generateMagicTokenSelf (190), generateMagicTokenForCustomer (236), generateMagicToken (259), validateMagicToken (296), findMerchantByEmail (332), saveResetToken (348), forgotPassword (401). None sets a new password.
- The forgot-password path is send-only: Login.jsx:29 calls `forgotPassword(fpEmail, window.location.origin)`; src/lib/db.js:197 calls `client.action(api.auth.forgotPassword, ...)`; convex/auth.ts:401 forgotPassword just saves a reset token (saveResetToken) and emails/logs a reset link (auth.ts:427). There is no token-consuming mutation that actually writes a new password_hash on the server either.
- The only place `password_hash` is written on the local state is mergeConvexCustomer at src/lib/db.js:269, which does `password_hash: prev.password_hash` — i.e. it explicitly PRESERVES the existing local value and never overwrites it from Convex. Other local writes (db.js:239, db.js:2495) set `password_hash: null` for new/customer rows, not the merchant.
- Conclusion: even if a server-side reset existed, the local seed `password_hash` at seed.js:88 would remain the original literal. The two can only diverge; nothing reconciles them.

(b) What does the local check at db.js:85-86 compare exactly — what value against what field, and is it plaintext or hashed?

Exact lines:
```
db.js:85    if (!u) return null;
db.js:86    if (u.password_hash !== password) return null;
```
It compares the local user's `u.password_hash` field against the plaintext `password` argument passed into merchantLogin, using strict `!==`. Both sides are plaintext strings: the seed stores a plaintext value in the field NAMED `password_hash` (seed.js:88), despite the "hash" name it is not hashed. The comparison is a plaintext equality check, no bcrypt on the client (db.js:83 comment confirms "demo seed stores plaintext password_hash; real bcrypt compare happens server-side").

(c) If the local seed password and the real server (Convex) password have diverged today, tracing db.js:79-152:
- Login attempt using the SERVER's current real password (which differs from the local seed value): The synchronous local check runs first. db.js:80 `localMerchantByEmail(email)` finds the merchant row `u`. db.js:86 compares `u.password_hash !== password` — since the entered password is the server's new value and the local `password_hash` is still the old seed literal, they differ, so the function returns null at db.js:86 BEFORE any Convex call is made. Result: login is REFUSED locally; Login.jsx:19 shows "Incorrect email or password." The correct server password never reaches Convex.
- Login attempt using the ORIGINAL seed password: db.js:86 passes (matches the local seed literal). Then db.js:91-95 fires the Convex mutation with that same (old seed) password. On the server, if the real password has changed, the Convex bcrypt check would fail and `res` would be null/no token, so the `.then()` guard at db.js:97 (`if (res && res.token)`) is false and the async branch does nothing (no token, no hydrate — Appendix A.1 row 4). BUT the SYNCHRONOUS return at db.js:151 still returns `u`, so Login.jsx:20-21 saves a LOCAL session and navigates. Result: the user is "logged in" locally on the stale seed password with NO valid Convex session — merchant pages that require a session get no real data.
- Net: today the local seed password is authoritative for whether login is allowed; the real server password is effectively bypassed. This is exactly the local-only login that amendment 20 removes.

(d) In the planned NEW async login function (amendment 15 — must await the Convex result before navigating), how should it find/match the LOCAL state row once the Convex result arrives, given local seed ids differ from Convex `_id`?

Match by EMAIL, not by id. Evidence and reasoning:
- The current `.then()` callback matches by LOCAL id: db.js:101 `state.users.findIndex((x) => x.id === u.id)` — but that only works because `u` was already obtained from the LOCAL lookup (db.js:80 `localMerchantByEmail(email)`) before the Convex call. The Convex result object itself carries the real `_id` (res.user?.id), which does NOT equal the local seed id (e.g. 'owner').
- The established precedent for reconciling a Convex row to a local row is `mergeConvexCustomer` (db.js:251-258), which matches by a fallback chain: `convexId === cvx.id`, else mobile, else name (db.js:255-257) — it does NOT rely on ids being equal, because they are not. It then stamps `convexId: cvx.id` onto the local row (db.js:268) so future lookups can use `convexUserId()` (db.js:468-470, returns `u.convexId || userId`).
- For the merchant, the stable shared key between the entered credentials and the local row is the email (there is no mobile match guaranteed for the login form). So the new async function should: (1) call the Convex mutation and await it; (2) on success, locate the local row via `localMerchantByEmail(email)` (db.js:74-77 — the same email-based lookup the current merchantLogin already uses at db.js:80); (3) stamp `convexId: res.user?.id`, `session_token: res.token`, `session_expiry: res.expiresAt` onto that row and `persist()` — exactly the side effects the existing `.then()` performs at db.js:114-120. This reuses the email lookup that already exists rather than trying to match on divergent ids.

## AMENDMENTS (2026-09-28, third review)

22. Emergency unlock: the forgot-password flow cannot release the lock, because no password-reset mutation exists anywhere in the repo (verified: no resetPassword in src/ or convex/). The only emergency unlock methods are (a) set the Convex environment variable ONE_DEVICE_LOCK to off, which restores the old login behavior at once, and (b) a developer clears session_token, session_expiry and session_last_seen on the merchant users row from the backend dashboard.
23. Extra test case (mandatory before merge): log in through the new async login path with the real owner credentials, and confirm real data loads on the merchant pages. This checks that the server password and the local seed password do not differ in a way that locks the owner out. Also test wrong password, wrong email, server unreachable, and the locked refusal.
