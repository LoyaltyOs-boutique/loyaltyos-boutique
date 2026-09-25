# CSV Bulk Onboarding — first-class customers — Design (2026-09-23)

## Problem
Client Onboarding's "Import clients from CSV" creates real Convex customers, but they are second-class compared with single-client onboarding: no magic link is minted (CRM eye button blocks, copy button copies a token=undefined link, the customer cannot open their lookbook), WhatsApp consent and VVIP cannot be set, soft-deleted customers are skipped instead of reactivated, the parser breaks on quoted fields, BOM and +91 numbers, "04/05/1995" is parsed as April 5 (US order) instead of 4 May, unparseable dates are silently dropped, and there is no batch limit. Evidence: read-only audit 2026-09-23 and the live "Test Bulk Import" row (magic_token null).

## Decisions (approved by Saidul)
1. Optional Consent column (Yes/No). Optional VVIP column (Yes/No). Accepted yes values, case-insensitive: yes, y, true, 1. Blank or no, n, false, 0 means No. Any other value is treated as No and flagged in the preview.
2. A small "Download sample CSV" link under the drop zone.
3. Every newly created customer gets a working magic link at import time, using the same token helper the merchant "resend link" path uses (never generateMagicTokenSelf).
4. A mobile that belongs to a soft-deleted customer reactivates that customer, mirroring createCustomer's reactivation branch exactly, with consent/VVIP applied upgrade-only (only ever set to true, never cleared). If the reactivated customer has no magic token, one is minted.
5. A mobile that belongs to an active customer is skipped (reason duplicate_existing). Existing data is never overwritten and no data about the existing customer is returned.
6. Invalid rows are skipped and reported with a reason; valid rows still import.
7. Out of scope: staff notes, persisting City/Country (the users schema has no such fields), updating existing active customers.
8. Changing consent and VVIP after import (per-customer toggles and a bulk select-and-apply action with a consent confirmation step in Customer CRM, where consent can also be turned off) is a separate follow-up task with its own audit and design. It is not part of this design.

## Columns
Name, WhatsApp, Birthday, Anniversary, City, Country, Consent, VVIP. If the first row is a header (contains a "name" column and a "whatsapp", "mobile" or "phone" column, case-insensitive), columns are mapped by header name and may be in any order; otherwise the positional order above is used. Name and WhatsApp are required.

## Parsing rules (frontend)
- RFC 4180 style: quoted fields, commas and line breaks inside quotes, escaped double quotes (""), CRLF or LF, UTF-8 BOM stripped, blank lines ignored.
- Mobile: strip non-digits; 12 digits starting with 91 or 11 digits starting with 0 are reduced to the last 10; the result must be exactly 10 digits.
- Dates (Indian order, day first): DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, YYYY-MM-DD, and "D Mon YYYY" / "D Month YYYY" (month name). Day and month are validated as a real calendar date (Feb 29 allowed). Output is the existing stored "M-D" format (year not stored, as today). A date that is present but not understood is flagged in the preview ("Birthday not understood"); the row still imports without that date.
- Duplicate mobiles within the same file: the first occurrence is kept, later ones are flagged.

## Import flow
1. Merchant drops or picks a CSV. The preview table shows every row with its status: New, Duplicate in file, Already a customer, Invalid (reason), plus any date or consent/VVIP value warnings, and the parsed Consent and VVIP values.
2. Confirm import sends valid rows to Convex in sequential chunks of 100 rows.
3. If a chunk fails, stop, show the error, and show how many customers were already created (re-importing the same file is safe because existing mobiles are skipped).
4. Result line: "X created · Y reactivated · Z skipped", with a short list of skipped rows and their reasons.
5. The CRM refreshes without a hard refresh (existing hydrateCustomers behaviour).

## Backend (convex/customers.ts bulkCreateCustomers)
- Args: each row may additionally carry whatsapp_consent: optional boolean and vvip: optional boolean. Existing fields unchanged (city/country still accepted and not persisted).
- requireMerchantSession stays the first line. rows.length above 100 throws a clear error before any write.
- Per row: validate name and 10-digit mobile (server re-validates), in-file duplicate check, by_mobile lookup.
  - Existing and is_deleted true: reactivate exactly as createCustomer does, apply consent/VVIP upgrade-only, mint a magic token if none, count as reactivated.
  - Existing and active: skip with reason duplicate_existing, no writes, nothing about that customer returned.
  - New: insert with the same fields as today plus custom_tags: [], whatsapp_consent: true only when true, vvip: true only when true, then mint a magic token with the shared helper.
- Return: { created, reactivated, skipped, createdCount, reactivatedCount, skippedCount }. Existing keys and shapes kept for compatibility; no magic tokens are returned.

## Frontend (src/pages/merchant/Onboarding.jsx, src/lib/db.js)
- New parser per the rules above, preview statuses and warnings, chunked import, result line with reactivated count and skipped reasons, sample CSV download link generated in the browser (header row plus two example rows), and helper text listing all 8 columns, the DD-MM-YYYY date format, and a short note that Consent should be Yes only when the customer has agreed to receive WhatsApp messages. Only existing classes in Onboarding.jsx are reused; CSS must not grow unexplained.

## Tests
Backend: new with consent/VVIP, new without, invalid mobile, missing name, in-file duplicate, existing active skipped with no writes, soft-deleted reactivated with token, more than 100 rows rejected, minted token accepted by the real magic-link access path. Frontend: a real CSV through the browser covering quoting, BOM, +91, each date format, bad date, consent/VVIP values, 150+ rows chunking, CRM showing imported customers with working eye/copy links. All test data removed afterwards.

## Amendment — 2026-09-23 (after end-to-end test)

1. The end-to-end browser test showed the preview marks soft-deleted customers as "Already a customer", because the browser's local customer list never drops customers that were deleted elsewhere. The CSV preview therefore no longer uses the local list. It asks a new merchant-only query, checkMobilesStatus, which takes the file's mobiles (at most 500 per call; the frontend sends larger files in parts) and returns { active: string[], deleted: string[] } using exactly the same by_mobile lookup and is_deleted rule as bulkCreateCustomers. Only mobile numbers are returned, never names or any other customer data.
2. Preview statuses become: New, Will be reactivated, Already a customer, Duplicate in file, Invalid (reason).
3. Every parsed text value (name, city, country and the raw consent, VVIP and date cells) has line breaks, tabs and repeated spaces collapsed to a single space and is trimmed, so a quoted multi-line name is stored as one line.
4. The global stale local customer list (soft-deleted customers remaining in the browser's CRM list) is a separate, pre-existing issue and is out of scope here. It will be handled with the customer Delete button task.
