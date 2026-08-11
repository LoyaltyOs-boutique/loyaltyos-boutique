# Design: Fix Client Onboarding Magic Link Validation

## Problem
Merchant-created clients (via `/merchant/onboarding`) are only persisted locally (`localStorage`) and not validated against Convex, causing magic links to fail validation in `Lookbook.jsx` (which checks `db.js:validateLookbook` synchronously).

## Proposed Solution
Extend `Lookbook.jsx` to perform an asynchronous validation check. 
1. **Local-first validation**: Keep existing synchronous `validateLookbook` check for performance.
2. **Convex fallback**: If the local check fails, perform an `async` call to `validateMagicToken` (Convex) to verify if the token is valid on the backend.
3. **Redirect logic**: Only redirect to `/join` if *both* local and backend validation fail (truly invalid link).

## Design Decisions
- `Lookbook.jsx`: `useEffect` hook updated to be `async`.
- `Lookbook.jsx`: Maintain loading state while checking the backend.
- `db.js`: No changes required to existing `validateLookbook` (keep local-first contract).
- `validateMagicToken` (Convex): Already available and suitable for this fallback.

## Verification Plan
1. **T1**: Create client in `/merchant/onboarding` -> Open magic link -> Should open module directly (will hit Convex validation).
2. **T2**: Invalid ID/Token -> Redirects to `/join` (maintained).
3. **T3**: Self-onboarding share link (`/join`) -> Unchanged flow.
4. **T4**: No params -> Invitation page (maintained).
5. **T5**: Existing valid token (Priya) -> Lookbook (maintained).