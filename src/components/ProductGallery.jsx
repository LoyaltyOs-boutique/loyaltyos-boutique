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
export function ProductGallery({ piece, className }) {
  const media = fromPiece(piece);
  const count = media.length;
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  // Stays true after the first open so the lazy import above only ever fires
  // once per mount, even across later close/reopen cycles.
  const [hasOpened, setHasOpened] = useState(false);
  const touchStartX = useRef(null);

  if (count === 0) return null; // nothing to show — same as an empty image_url today

  const safeIndex = Math.min(index, count - 1);
  const current = media[safeIndex];
  const alt = piece?.title || '';

  const advance = (delta) => setIndex((i) => (i + delta + count) % count);
  const openViewer = () => { setHasOpened(true); setOpen(true); };

  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 40) advance(dx < 0 ? 1 : -1);
    touchStartX.current = null;
  };

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

  if (count === 1) return mainElement;

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
      {hasOpened && (
        <Suspense fallback={null}>
          {open && (
            <ProductGalleryViewer
              slides={slides}
              index={safeIndex}
              open={open}
              onClose={() => setOpen(false)}
              onViewChange={setIndex}
            />
          )}
        </Suspense>
      )}
    </>
  );
}
