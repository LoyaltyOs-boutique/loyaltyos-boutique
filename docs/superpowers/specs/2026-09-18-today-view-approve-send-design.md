# Today View — Approve & Send (Phase 1: plumbing only, no combined AI draft yet)

**Problem:** Dashboard's "Birthdays today"/"Anniversaries pending" arrows land on the generic "All clients" search view, which has no Approve & Send/Cancel/points UI at all (that UI only renders for `filter === 'birthday_tomorrow'/'anniversary_tomorrow'`).

## Scope for THIS task

1. Add Approve & Send/Cancel UI to today-filtered rows in the "All clients" view (reached via Dashboard navigation, not a new visible tab button), reusing the exact existing row JSX/ApprovalModal pattern from the tomorrow tabs.
2. New case — customer has BOTH birthday and anniversary today (confirmed live example: "sneha"): render ONE combined Approve & Send button (not two separate rows/buttons) for that customer.
3. On combined-click, `sendViaWaLink` fires the existing single-occasion message TWICE in sequence — once with `occasion="birthday"` (using the existing AI draft/fallback text generation, unchanged), once with `occasion="anniversary"` — as two separate wa.me link opens (or a single wa.me open containing both texts concatenated with a clear separator — pick whichever is the simpler, less-invasive change given the real code structure; report which was chosen and why), followed by two sequential `recordMessageAction` calls (one per occasion, both dated today's real `occasion_date`), so both birthday and anniversary points bonuses correctly credit per the existing (already-tested) auto-points logic.
4. If only one occasion is today for a given customer, behave exactly like the existing single-occasion flow — no change.
5. Use a `canonicalTodayOccasionDate()` (today's real date, not tomorrow's — `canonicalTomorrowOccasionDate()` must NOT be reused verbatim, since it hardcodes `+1` day) for both calls' `occasion_date`.
6. `Dashboard.jsx`'s two stat-card arrows navigate via `{ state: { tab: 'birthday_today' } }` / `'anniversary_today'` (or equivalent mechanism already used by the existing `'reviews'` chip's tab-state navigation) instead of the current `todayList()`-based search marker — reuse that exact existing navigation-state mechanism.
7. The "Send via Cloud API instead" secondary button: for a combined (both-occasion) customer specifically, disable it with a short inline note (e.g. "Not available for combined occasions yet") — its fixed-template mechanism cannot represent two occasions in one send. For a single-occasion-today customer, the Cloud API button works completely unchanged.
8. AI draft generation itself is NOT modified in this task — `generateMessageDraftRemote`/`generateMessageDraftPublic` keep their existing single-occasion signature and prompt. This task only calls that existing function twice (once per occasion) for the combined case — it does not add any new "combined" AI mode. That is explicitly a separate, later task.

## Explicitly NOT touched
`convex/ai.ts`, `convex/whatsapp.ts`'s template/Graph API mechanics, `message_actions` schema, the existing points-crediting logic inside `recordMessageAction` (reused as-is, called twice), the tomorrow tabs' existing behavior.
