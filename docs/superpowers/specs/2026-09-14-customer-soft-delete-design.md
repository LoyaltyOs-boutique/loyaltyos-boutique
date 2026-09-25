# Customer Soft-Delete — Design (deleteCustomer / bulkDeleteCustomers)

**Status:** APPROVED — 2026-09-14 (magic-link and re-onboarding forks decided by user; ready for implementation as a separate task)
**Author:** office-tester-agent investigation, finalized by user decision
**Related:** Gate 1+2 schema (`is_deleted` field added on `users`, unused until now), Gate 8 roadmap item (DPDP Act "right to erasure"), the 46-record legacy junk-data cleanup identified in the 2026-09-14 read-only audit.

## Problem

`users.is_deleted` exists in schema.ts (Gate 1+2 merge) but no mutation ever sets it, and only one code path (`findUpcoming`, `customers.ts:299`) reads it. There is currently no way to remove a customer record at all — not even the 46 confirmed junk/duplicate/test rows found in the audit (duplicates like "Ananya Mondal" x4, "MD Saidul islam" x8, ~38 standalone junk rows like "CSV Test One", "ZTEST *", etc).

This needs to be a real, reusable feature — not a throwaway one-off script like the earlier load-test cleanup mutation — because it will also serve DPDP Act "right to erasure" compliance later (Gate 8). A frontend Delete button will be built as a separate future task; this mutation is designed so that button can call it directly with zero backend changes needed later.

## Investigation findings (read-only, 2026-09-14)

### is_deleted filter audit

| Query/mutation | File | Filters `is_deleted`? | Impact if not fixed |
|---|---|---|---|
| `getCustomers` | `customers.ts:345` | No | Deleted customer still shows in CRM full list |
| `getCustomersPaginated` | `customers.ts:378` | No | Deleted customer still shows in CRM default paginated A-Z view |
| `getCustomerById` / `getCustomerDoc` | `customers.ts:399` / `customers.ts:74` | No | Profile card (incl. confidential measurements/staff notes) still opens |
| `getCustomerIntelligenceProfile` | `customers.ts:1069` | No | AI profile still built for a "deleted" customer |
| `findUpcoming` / `findUpcomingInternal` (birthdays/anniversaries) | `customers.ts:259-322` | **Yes** — `if (c.is_deleted === true) continue;` (`customers.ts:299`) | Reference pattern — this is the one place already correct |
| `findCustomerByMobile` | `customers.ts:838` | No | Onboarding duplicate-check still finds "deleted" customer as active |
| `createCustomer` duplicate-mobile check | `customers.ts:900-927` | No | Re-onboarding a deleted customer's mobile silently patches the deleted row instead of a deliberate reactivate decision (see Decision 2 below) |
| `awardPoints`, `updateMeasurements`, `addStaffNote`, `updateCustomTags`, `updateCustomerProfile` | `customers.ts` (all via `getCustomerDoc`) | No | All still silently succeed against a "deleted" customer |
| `createOrder` | `orders.ts:47` (`ctx.db.get(customerId)`, no role/is_deleted check) | No | Merchant can still create new orders/points for a "deleted" customer |
| `createReview` | `reviews.ts:51-104` | N/A — never validates the `users` row at write time | A still-working magic link (see Decision 1) could still submit a review |
| `approveReview` | `reviews.ts:123` (`ctx.db.get(review.user_id)`) | No | Approving credits points to a "deleted" customer silently |

### Orders/reviews breakage check

Neither `orders` nor `reviews` store the customer's name directly — both store only `user_id`/`customerId` and are resolved by id at read/render time. Soft-deleting a customer causes **no crash and no blank-name UI bug**, because `ctx.db.get`/`getCustomerDoc` still resolve a soft-deleted row (it still exists, `is_deleted` is just a flag). The real risk is the opposite of a crash: soft-delete would be **silently ineffective** everywhere except the birthday/anniversary path, unless the fixes in section (c) ship alongside it.

## Design

### (a) `deleteCustomer` — single-customer soft delete

```ts
export const deleteCustomer = mutation({
  args: {
    customerId: v.id("users"),
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, { customerId, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);

    const doc = await getCustomerDoc(ctx, customerId);
    if (!doc) return { ok: false, error: "Customer not found." };
    if (doc.is_deleted === true) {
      return { ok: false, error: "Customer is already deleted." };
    }

    await ctx.db.patch(customerId, { is_deleted: true });
    return { ok: true, id: customerId };
  },
});
```

- Merchant-session-guarded via `requireMerchantSession`, same as the other 39 guarded functions.
- Reuses the existing `getCustomerDoc` helper for the existence/role check — no new logic invented.
- Idempotency guard: already-deleted returns a clear error rather than silently no-op-succeeding.

### (b) `bulkDeleteCustomers` — batch soft delete for the 46-record cleanup

```ts
export const bulkDeleteCustomers = mutation({
  args: {
    customerIds: v.array(v.id("users")),
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, { customerIds, userId, token }) => {
    await requireMerchantSession(ctx, userId, token);

    const deleted: Array<{ id: string; name: string }> = [];
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const id of customerIds) {
      const doc = await ctx.db.get(id);
      if (!doc) {
        skipped.push({ id: String(id), reason: "not_found" });
        continue;
      }
      if (doc.role !== "customer") {
        skipped.push({ id: String(id), reason: "not_a_customer" });
        continue;
      }
      if (doc.is_deleted === true) {
        skipped.push({ id: String(id), reason: "already_deleted" });
        continue;
      }
      await ctx.db.patch(id, { is_deleted: true });
      deleted.push({ id: String(id), name: doc.name });
    }

    return {
      ok: true,
      deleted,
      skipped,
      deletedCount: deleted.length,
      skippedCount: skipped.length,
    };
  },
});
```

- Same identity-check-before-delete safety pattern as the load-test cleanup mutation and `bulkCreateCustomers`'s skip-list (`customers.ts:967-1038`): fetch and verify each record, skip with a reason rather than blindly deleting.
- Verification here = "exists, `role==="customer"`, not already deleted." There is no single tag like `LOADTEST_2026_` for this batch, so **the actual list of target ids must be assembled and reviewed by a human first** (the read-only audit already done) — this mutation's job is to safely apply an already-decided list, not to guess which customers are junk. No "looks like test data" heuristic is built into the mutation itself; that risk (a destructive mutation guessing at intent) was deliberately rejected in favor of an explicit, human-reviewed id list as input.
- Return shape mirrors `bulkCreateCustomers`'s existing `{created, skipped, createdCount, skippedCount}` family so a future admin UI renders it the same way (e.g. "42 deleted, 4 skipped").

### (c) Existing functions that need an `is_deleted` fix, as part of this same effort

1. **`getCustomers`** (`customers.ts:345`) — add an `is_deleted` filter to the existing query/filter.
2. **`getCustomersPaginated`** (`customers.ts:378`) — uses `.withIndex("by_role_name_lower", ...).paginate(...)`; a post-index `.filter()` works but will make pages "shrink" unpredictably when deleted rows are skipped mid-page. Real wrinkle to resolve at implementation time, not just a copy-paste fix.
3. **`getCustomerDoc`** (`customers.ts:74`, the shared helper) — add the `is_deleted` check once, here, since `getCustomerById`, `getCustomerIntelligenceProfile`, `updateMeasurements`, `addStaffNote`, `updateCustomTags`, `updateCustomerProfile`, `awardPoints` all already call this helper for their existence check. Fixing it once here fixes all of them (single source of truth). Confirmed safe: `deleteCustomer` itself fetches the doc *before* it's marked deleted, so the ordering isn't a problem.
4. **`findCustomerByMobile`** (`customers.ts:838`) — needs its own explicit filter; doesn't go through `getCustomerDoc`.
5. **`createCustomer`'s duplicate-mobile check** (`customers.ts:900-927`) — per Decision 2 below, when the matched existing row has `is_deleted === true`, clear the flag (reactivate) as part of the existing "welcome back" patch path, instead of leaving it deleted or creating a second row.
6. **`createOrder`** (`orders.ts:47`) / **`approveReview`** (`reviews.ts:123`) — add an `is_deleted` check and reject with the same `{ok:false, error:"Customer not found."}` shape both already use for other validation failures, so a merchant can't transact against a deleted record from the merchant side. (Customer-initiated actions via a still-working magic link are handled by Decision 1, not here.)

### Decision 1 — Magic link behavior after soft-delete: **KEEP WORKING** (approved)

Soft-delete only hides the customer from merchant-facing views/queries and merchant-initiated writes (section c). `validateMagicToken` (`auth.ts:296-319`) is **not** changed — a soft-deleted customer's existing WhatsApp magic link continues to open their lookbook/points page normally.

**Why:** the immediate, concrete need is safely cleaning up junk/test data, where the failure mode of the alternative (an accidental delete instantly locking a real customer out of their own points with no self-service recovery) is worse than the failure mode of this option (worst case: a wrongly-deleted customer temporarily disappears from merchant views, fully reversible, zero customer-facing impact).

**Known gap, explicitly not closed by this decision:** this is **not yet full DPDP "right to erasure"** — a customer's own device can still access their data via magic link after being marked "deleted." Before this feature can be called Gate-8/DPDP-complete, `validateMagicToken` must additionally check `is_deleted` and refuse. Tracked as a required follow-up, not silently dropped.

### Decision 2 — Re-onboarding a soft-deleted customer's mobile number: **REACTIVATE** (approved)

If `createCustomer`'s duplicate-mobile check matches an existing row that has `is_deleted === true`, it clears the flag (reactivate) and proceeds through the same "existing customer, patch consent/vvip" path it already uses for non-deleted duplicate matches — rather than leaving the row deleted (which would block re-onboarding entirely) or creating a second row for the same phone number.

**Why:** preserves Ma'am's "one WhatsApp number = one profile" rule and the customer's points/order history, and requires less new code than a "create fresh row" path, since `createCustomer` already has this exact reactivate-style patch path for existing matches — it just needs to also fire when `is_deleted === true`, in addition to when it's `false`/unset.

### (e) Consistency with existing return-shape patterns

`createCustomer`'s actual return shape (`customers.ts:864-954`):
- Success: `{ ok: true, id, customer }` or `{ ok: true, isExisting: true, existingId, customer }`
- Failure: `{ ok: false, error: "<message>" }`

`deleteCustomer` return shape — same `ok`/`error` keys:
- Success: `{ ok: true, id }`
- Failure: `{ ok: false, error: "<message>" }`

`bulkDeleteCustomers` return shape — consistent with `bulkCreateCustomers`'s existing `{created, skipped, createdCount, skippedCount}` family:
- `{ ok: true, deleted, skipped, deletedCount, skippedCount }`

This means a future frontend Delete button can call `deleteCustomer` and branch on `res.ok` (success toast / `res.error` in an error toast) with **zero backend changes needed later**.

## Out of scope for this design (tracked, not forgotten)

- Making `validateMagicToken` respect `is_deleted` (required before Gate-8/DPDP-complete — see Decision 1).
- The frontend Delete button itself (separate future task, per Ma'am's frontend-sacred rule — this design exists specifically so that task needs no backend changes).
- Any automatic/heuristic detection of "which customers are junk" — deliberately out of scope; `bulkDeleteCustomers` only acts on an explicit, human-reviewed id list.
