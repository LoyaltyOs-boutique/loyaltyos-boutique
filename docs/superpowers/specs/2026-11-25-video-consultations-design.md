Title: Video Consultations (85 Lansdowne)
Goal: a customer can request a video call about a piece from their personal lookbook; the merchant sees every request in a new "Video Consultations" tab and contacts the customer on WhatsApp to fix a time.
Customer side:
- In the customer's personal magic-link lookbook, below "Inquire via WhatsApp" on each piece, a new button "Book a video call" (same style as the Inquire button).
- On click the request is saved and the customer sees: "Video call request received. Our stylist will WhatsApp you shortly to fix a time."
- Not shown on public share pages (no known customer there).
Rules:
- Same customer + same piece within 24 hours does not create a new request; the customer still sees the same message.
- Rate limited per customer.
Merchant side:
- New sidebar tab "Video Consultations", directly below Orders and above Settings & Support. Same layout as the Orders tab: date selector (opens on today), search by customer name, phone or product name, pagination.
- Each row: exact request date and time, customer name, phone, product name, status (New / Contacted), and a "Video call via WhatsApp" button.
- The button opens the customer's WhatsApp chat (wa.me with 91 + 10-digit mobile) with a gentle prefilled message asking for the best time for a video call about that piece, and marks the request Contacted.
- Merchant is informed through Recent Activity ("Requested a video call · <product>") and the weekly "active this week" activity / AI summary count. No bell notification.
Privacy: the AI only receives a count of video call requests, never phone numbers or names beyond what it already gets.

Files:
- convex/schema.ts — new video_call_requests table (by_created_at, by_customer_created_at indexes, search_video_calls search index); customer_activity_events.action gains "video_call_requested".
- convex/rateLimits.ts — new requestVideoCallByCustomer bucket (5/minute, capacity 5), same shape as placeOrderByCustomer.
- convex/videoCalls.ts (new) — requestVideoCall (public, magic-link gated, 24h dedup), getVideoCallRequestsByDate, searchVideoCallRequests, markVideoCallContacted (all merchant-guarded), mirroring convex/orderRequests.ts patterns.
- convex/dashboard.ts — ActivityItem.kind gains "video_call_requested" (passthrough, no other logic change).
- convex/ai.ts — getRecentActivityCountsInternal gains a videoCallsRequested count; generateCustomerActivitySummary's activitySummaryLine includes it as a plain count, nothing else.
