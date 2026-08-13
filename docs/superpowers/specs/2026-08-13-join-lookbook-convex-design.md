# Design: Join + Lookbook Convex Integration (2026-08-13)

## Task
Wire the Join flow and Customer Lookbook to use Convex as the source of truth, maintaining local persistence for offline reliability.

## Design Decisions
1. **Join Flow (`onboardCustomer` in `src/lib/db.js`):**
   - Refactor `onboardCustomer` to perform the logic currently in `onboardCustomerRemote`.
   - Call `api.customers.createCustomer` to create a real Convex user.
   - Implement "mobile-unique" check (Improvement 4) on the backend.
   - Handle offline/Convex failure gracefully by falling back to local seed/persistence (maintaining the existing return shape `{ user, magicLink }`).
   - Sync the local state with the newly created Convex customer.

2. **Customer Lookbook View:**
   - Continue using `hydrateCatalogue` to populate `state.catalogueItems` from Convex.
   - The UI components (`Lookbook.jsx`) read from `state` which is kept in sync with Convex via hydration.
   - No changes needed to `Lookbook.jsx` or `Join.jsx` as requested.

3. **Global Constraints (Verbatim):**
   - Currency Invariant: All money fields are INTEGER PAISE — never floats.
   - Strict Editing: Modify ONLY `src/lib/db.js`.
   - Build Size: Must remain 27.74kB.
   - Error Handling: Graceful degradation for offline use.

## Verification Steps
1. Verify Build: `npm run build` (CSS 27.74kB).
2. Functional Test:
   - Create lookbook item (Merchant).
   - Open Customer Lookbook (Magic Link) -> Real products visible.
   - Open `/join` -> Submit name + unique mobile -> Verify Convex users table insertion.
   - Open `/join` -> Submit SAME mobile -> Verify duplication blocked (Improvement 4).
   - Verify: `npm run build` unchanged, `src/` diff only `lib/db.js`.