import { lazy, Suspense, useRef, useState } from 'react';
import { fromPiece } from '../lib/mediaList.js';
import { cls } from '../lib/util.js';

// Design spec: docs/superpowers/specs/2026-09-25-product-gallery-design.md
// (decision 5) — the lightbox library and its CSS live entirely in this
// separate module now, loaded only once a customer actually opens a photo
// (see `hasOpened` below), not on every page load. React caches a given
// lazy() call's resolved module, so reopening after a close never re-fetches it.
const ProductGalleryViewer = lazy(() => import('./ProductGalleryViewer.jsx'));

/**
 * Design spec: docs/superpowers/specs/2026-09-25-product-gallery-design.md
 * (decisions 4, 5) — shared card slider + full-screen zoom viewer for one
 * piece, used identically on the customer lookbook, public lookbook and
 * public piece pages. fromPiece (mediaList.js) is the single source of truth
 * for "what is this piece's photo list": a legacy piece with only image_url
 * resolves to a one-item list, which renders below as the same plain element
 * the page rendered before this component existed — no arrows, no dots, no
 * extra wrapping element.
 */
export function ProductGallery({ piece, className, viewerOnly = false }) {
  const media = fromPiece(piece);
  const count = media.length;
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  // Stays true after the first open so the lazy import above only ever fires
  // once per mount, even across later close/reopen cycles.
  const [hasOpened, setHasOpened] = useState(false);
  const touchStart = useRef(null);
  // Set true in onTouchEnd when the finger moved past the swipe threshold, so
  // the synthetic click browsers fire after touchend is suppressed and only a
  // real tap opens the viewer.
  const swiped = useRef(false);
  // Pending id for the timer that clears `swiped` after a swipe, so a swipe's
  // flag can never outlive its own gesture and swallow a later unrelated tap.
  const swipedTimer = useRef(null);

  if (count === 0) return null; // nothing to show — same as an empty image_url today

  const safeIndex = Math.min(index, count - 1);
  const current = viewerOnly ? media[0] : media[safeIndex];
  const alt = piece?.title || '';

  const advance = (delta) => setIndex((i) => (i + delta + count) % count);
  const openViewer = () => {
    if (swiped.current) { swiped.current = false; return; }
    setHasOpened(true);
    setOpen(true);
  };

  // A single entry (or viewerOnly cover) has nothing to swipe between, so its
  // touch handlers stay undefined and only the tap-to-open click applies.
  const swipeEnabled = count > 1 && !viewerOnly;
  const onTouchStart = swipeEnabled
    ? (e) => {
        // A fresh gesture always starts clean, and any pending clear-timer from
        // a previous swipe is cancelled so timers never stack across swipes.
        if (swipedTimer.current !== null) clearTimeout(swipedTimer.current);
        swiped.current = false;
        touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    : undefined;
  const onTouchEnd = swipeEnabled
    ? (e) => {
        if (touchStart.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStart.current.x;
        const dy = e.changedTouches[0].clientY - touchStart.current.y;
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
          swiped.current = true; // suppress the click that follows a swipe
          if (Math.abs(dx) > 40) advance(dx < 0 ? 1 : -1);
          // On real phones a large move may fire no follow-up click at all, so
          // the flag would otherwise outlive this gesture and swallow the next
          // unrelated tap. Clear it after a delay longer than any real
          // click-after-touchend but far shorter than a second human tap.
          swipedTimer.current = setTimeout(() => { swiped.current = false; }, 350);
        }
        touchStart.current = null;
      }
    : undefined;

  const slides = media.map((m) => (
    m.type === 'video'
      ? { type: 'video', sources: [{ src: m.url, type: 'video/mp4' }], controls: true }
      : { src: m.url, alt }
  ));

  const mainElement = current.type === 'video' ? (
    <video
      src={current.url}
      muted
      preload="metadata"
      onClick={openViewer}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className={className}
    />
  ) : (
    <img
      src={current.url}
      alt={alt}
      loading="lazy"
      onClick={openViewer}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className={className}
    />
  );

  // The viewer opens at the card's current slide normally, or always at the
  // cover (0) in viewerOnly mode where the card never tracks a slide.
  const viewerBlock = hasOpened && (
    <Suspense fallback={null}>
      {open && (
        <ProductGalleryViewer
          slides={slides}
          index={viewerOnly ? 0 : safeIndex}
          open={open}
          onClose={() => setOpen(false)}
          onViewChange={viewerOnly ? () => {} : setIndex}
        />
      )}
    </Suspense>
  );

  // Single entry, or a viewerOnly cover: the bare element renders identically to
  // before (no wrapper, no arrows, no dots), the click just also mounts the
  // viewer. Before any click hasOpened is false so viewerBlock is null — the
  // closed-state DOM is exactly mainElement alone.
  if (count === 1 || viewerOnly) {
    return (
      <>
        {mainElement}
        {viewerBlock}
      </>
    );
  }

  return (
    <>
      {mainElement}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); advance(-1); }}
        className="absolute top-1/2 left-2 -translate-y-1/2 h-8 w-8 bg-white/90 border border-line flex items-center justify-center text-sm cursor-pointer hover:scale-110"
        aria-label="Previous photo"
      >
        ‹
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); advance(1); }}
        className="absolute top-1/2 right-2 -translate-y-1/2 h-8 w-8 bg-white/90 border border-line flex items-center justify-center text-sm cursor-pointer hover:scale-110"
        aria-label="Next photo"
      >
        ›
      </button>
      <div className="absolute bottom-3 inset-x-0 flex items-center justify-center gap-1.5">
        {media.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={(e) => { e.stopPropagation(); setIndex(i); }}
            aria-label={`Photo ${i + 1}`}
            className={cls('h-1.5 w-1.5 rounded-full', i === safeIndex ? 'bg-gold' : 'bg-white/80')}
          />
        ))}
      </div>
      {viewerBlock}
    </>
  );
}
