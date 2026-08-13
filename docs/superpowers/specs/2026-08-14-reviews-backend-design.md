# Design: Reviews & Testimonials Backend
Date: 2026-08-14
Task: Step 8.1

## Overview
Implement backend for Product, GMB, and Testimonial reviews with a point award system. This enables users to earn loyalty points through reviews.

## Schema Changes
Add `reviews` table to `convex/schema.ts`:
```typescript
reviews: defineTable({
  user_id: v.id("users"),
  type: v.union(v.literal("product"), v.literal("gmb"), v.literal("testimonial")),
  text: v.string(),
  rating: v.optional(v.number()),
  status: v.union(v.literal("pending"), v.literal("approved"), v.literal("declined")),
  points_awarded: v.optional(v.number()),
  created_at: v.number(),
}).index("by_user", ["user_id"]).index("by_status", ["status"])
```

## API Functions
- `createReview`: Mutation to insert a review with status "pending".
- `getPendingReviews`: Query to fetch reviews with "pending" status.
- `getReviews`: Query to fetch reviews with optional status filter.
- `approveReview`: Atomic mutation to approve review, calculate points based on type and settings, and update user points.
- `declineReview`: Mutation to update status to "declined".

## Design Decisions
- **Atomic Updates:** `approveReview` will perform the status update, point calculation, and user balance update in a single transaction to prevent inconsistencies.
- **Anti-Double-Approval:** `approveReview` will verify the review is currently "pending" before processing.
- **Points Configuration:** Points will be fetched from `settings` table (gmbPoints, productReviewPoints) or fallback to constants (e.g., 50000 paise for testimonials).