# createCustomer VVIP guard — Design (2026-09-24)

## Problem
Pre-merge verification (2026-09-23) confirmed that createCustomer is public and unguarded, and that this branch added a vvip argument to it. Any caller who knows a mobile number can set vvip: true on a new or existing customer, which unlocks VVIP-only events (events.ts getEventAccess and dispatch recipients). The merchant Onboarding form and the public /join page both call createCustomer through the same bridge without a merchant session, so the VVIP checkbox is protected only by the UI.

## Decision (approved by Saidul)
1. createCustomer accepts two new optional args, userId and token (the merchant session).
2. If vvip is true, a valid merchant session is required (requireMerchantSession). Without one, or with an invalid one, createCustomer throws "Only the boutique can mark a customer as VVIP. Please sign in again." before any read or write, including the rate limiter.
3. If vvip is not true, the session args are ignored and not validated; behaviour is unchanged.
4. Unchanged by decision: self-onboarding through /join, the whatsapp_consent upgrade-only patch for an existing customer, and reactivation of a soft-deleted customer through /join (Saidul chose to keep self-reactivation; known risk: anyone who knows the mobile can reactivate a deleted customer, to be closed with the OTP work for the two open critical issues).
5. Out of scope: the two open critical issues (magic-link takeover, duplicate-mobile data leak) and the unauthenticated consent upgrade; all to be handled with OTP verification.

## Frontend (next prompt)
The merchant Onboarding form sends the merchant session with createCustomer. The /join page never sends vvip or a session.

## Tests
Unauthenticated VVIP on new and existing customers is rejected with no writes; merchant VVIP on new and existing works; invalid token rejected; /join-style calls without vvip unchanged (create, consent upgrade, reactivation); response shape unchanged.

## Amendment — 2026-09-24 (frontend error handling)
The read-only check found that onboardCustomerRemote (src/lib/db.js) wraps its whole body in one try/catch whose catch returns createLocalCustomer(f), so any thrown backend error, including the new VVIP guard, becomes a fake success: confetti and a link for a customer that was never saved in Convex. Approved scope A: when called from the merchant Onboarding form (options.asMerchant true), the bridge sends the merchant session if one exists, requires it only when vvip is ticked, and returns { error: <message> } instead of the local fallback when anything throws, so the form's existing error display shows it. Normal onboarding without VVIP behaves exactly as before. The public /join path is unchanged and keeps the local fallback; that silent fallback on /join is a known pre-existing issue to handle with the OTP work.
