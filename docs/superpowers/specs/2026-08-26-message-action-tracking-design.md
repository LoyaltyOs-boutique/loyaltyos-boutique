# Design Doc: Approve/Cancel Action-Tracking for Birthday/Anniversary Sends

Date: 2026-08-26
Branch: feat/whatsapp-cloud-api

## Problem
"Birthdays tomorrow"/"Anniversaries tomorrow" tabs currently show every consented customer with tomorrow's occasion, every time — even after admin has already approved-and-sent or explicitly decided to skip them. No memory of past decisions exists.

## Solution — no cron/scheduler needed
Stay fully live/reactive (no time-bound background job). Add a lightweight action-log so decided rows disappear from the list.

## 1. New schema table: message_actions
- customer_id — ref to users table
- occasion — "birthday" | "anniversary"
- occasion_date — the M-D string this action applies to (e.g. "8-27"), so it naturally resets next year
- action — "sent" | "cancelled"
- decided_at — timestamp
- channel — "cloud_api" | "wa_fallback" (only for "sent", for future reference/debugging)

## 2. Query change: getUpcomingBirthdays / getUpcomingAnniversaries
- Exclude any customer where a message_actions row already exists for (customer_id, occasion, occasion_date) — i.e. already sent or cancelled for that specific date
- Next year, occasion_date naturally differs, so the customer reappears normally — no extra cleanup needed

## 3. New mutation: recordMessageAction
- Args: customer_id, occasion, occasion_date, action ("sent" | "cancelled")
- Inserts one row into message_actions
- Called by:
  - Approve & Send button (existing) — after a successful (or attempted) send, in addition to its current Cloud-API-then-fallback logic
  - Cancel button (new) — records "cancelled", no send attempted

## 4. Frontend change: Customers.jsx
- Add a Cancel button next to the existing Approve & Send button in the tomorrow-tabs' rows (same styling convention — audit exact classNames first, pin-to-pin)
- On Approve & Send success or Cancel click: call recordMessageAction, then the row disappears from the tab

## 5. Explicitly out of scope
- No cron, no scheduled background job
- No change to consent logic, no change to the Cloud-API-then-fallback send mechanism itself
- No "cancel forever" option — cancel only skips this specific year's occurrence
- Dashboard.jsx untouched
- AI-generated personalized messages (deferred — a future spec, ties into a future cron use-case for pre-generation)
