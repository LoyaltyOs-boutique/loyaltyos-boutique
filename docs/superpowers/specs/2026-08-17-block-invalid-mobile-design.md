# Design: Block Invalid Mobile Numbers (Improvement 2)

## Problem
Currently, the system might accept or normalize mobile numbers in a way that allows invalid or non-10-digit inputs. We need to strictly enforce 10-digit mobile numbers for customer profiles.

## Goals
1.  Block invalid mobile numbers (length != 10 digits).
2.  Store mobile numbers exactly as entered (preserving input format if valid, but restricting to 10-digit clean sequences).
3.  Ensure user-friendly error surfacing (popup/message).
4.  Maintain existing behavior for valid numbers.

## Proposed Changes
1.  **Backend (`convex/customers.ts`):**
    *   Update `createCustomer`:
        *   `const digits = mobile.replace(/\D/g, '')`
        *   `if (digits.length !== 10) return {ok:false, error:"Please enter a valid 10-digit mobile number"}`
        *   Store `mobile` as the input string (raw).
    *   *Note:* Need to ensure `findCustomerByMobile` and `by_mobile` index logic handles this correctly. If we store raw, we might need to search by raw. Wait, if I change storage to raw, `by_mobile` index lookup will fail if I search by something else. The instruction says "Numbers stored exactly as entered" but also "No +91, no normalization prefix". If I enforce 10 digits via the check, the input effectively becomes just the 10 digits.

2.  **Frontend (`src/lib/db.js` + UI):**
    *   Verify `res.error` is displayed to the user if validation fails in `createCustomer`.

## Verification Steps
1.  Input "123" -> Expect `{ok:false, error: "Please enter a valid 10-digit mobile number"}`.
2.  Input "abcdef" -> Expect `{ok:false, error: "Please enter a valid 10-digit mobile number"}`.
3.  Input valid "9876500001" -> Success.
4.  Check `customers` table in Convex dashboard to verify raw storage.