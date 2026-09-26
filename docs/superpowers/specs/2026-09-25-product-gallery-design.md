# Product gallery: multiple photos and videos per piece — Design (2026-09-25)

## Problem
Each catalogue piece has one picture (catalogue_items.image_url, required). Merchants cannot add more photos, cannot change photos after creation (no edit UI; updateCatalogueItem has no frontend caller), uploaded videos render as broken images (no video element anywhere), and customers cannot enlarge, zoom or swipe photos. Reference: the client's own product page https://85lansdowne.com/products/koakh-paula-blouse (large image, thumbnail strip, click to enlarge). Evidence: docs/qa-reports/2026-09-25-product-gallery-audit.md.

## Decisions (approved by Saidul)
1. Data: add catalogue_items.media, an optional ordered array of { url: string, type: "image" | "video" }. The first entry is the cover and must be an image. image_url stays required and is always set by the backend to media[0].url when media is provided, so OG previews, cards, AI and every existing reader keep working. Pieces without media behave exactly as today (treated as a one-image gallery from image_url).
2. Limits: at most 8 media entries per piece, at most 2 of them videos. PDFs are not allowed in the gallery.
3. Merchant: Manual Entry accepts several photos and videos at once (and the existing image URL input adds an image entry), shows small previews, lets the merchant remove and reorder entries, and blocks a video from being first. Every piece in the merchant Current catalogue grid gets an "Edit photos" button opening the same editor in the existing Modal; saving calls updateCatalogueItem with the new media list. The merchant grid shows the cover plus a small count when there is more than one entry.
4. Customer: the customer lookbook, public lookbook and public piece pages show a slider on each piece (arrows, dots, swipe). Clicking opens a full-screen viewer with zoom (pinch, double tap, buttons), pan, previous/next (arrows, swipe, keyboard), a counter, thumbnails, video playback with controls, and close (X and Esc).
5. Viewer: a small, proven, MIT-licensed React lightbox library with zoom, video, thumbnails and counter plugins (for example yet-another-react-lightbox), themed to the gold/ink palette without editing src/index.css. Its CSS adds a known, explained amount to the CSS bundle. The card slider is hand-built with existing classes.
6. Out of scope: CSV linesheet multi-image columns, moving the Instagram base64 image into Blob storage, the Current catalogue fallback known issue.

## Backend
- Schema: catalogue_items.media: v.optional(v.array(v.object({ url: v.string(), type: v.union(v.literal("image"), v.literal("video")) }))). Additive only.
- addCatalogueItem and updateCatalogueItem accept an optional media argument. When present, validate: 1 to 8 entries, at most 2 videos, every url a non-empty string, media[0].type is "image". On success store media and set image_url to media[0].url. Invalid input throws a clear ConvexError and writes nothing. Existing soft-delete and session checks stay first. When media is absent, behaviour is unchanged.
- Every read path that returns pieces (getLookbookById, getCatalogueItemById, getCustomerCatalogue and any other found) includes media. Explicit projections gain the media field.

## Tests
Backend: add with a valid gallery (image_url equals the first entry), add without media unchanged, invalid galleries rejected with no write (9 entries, 3 videos, video first, empty url, empty array), update media on an existing piece, update on a soft-deleted piece still rejected, every read path returns media and legacy pieces return no media. Frontend and browser: merchant multi-upload, previews, remove, reorder, video-first blocked, Edit photos on an existing piece, customer slider and viewer on all three pages (mobile and desktop), video playback, keyboard and Esc, legacy single-photo pieces unchanged, OG preview unchanged, CSS growth explained.
