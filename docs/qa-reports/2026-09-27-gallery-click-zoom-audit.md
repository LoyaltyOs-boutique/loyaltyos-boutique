# Gallery Click-to-Zoom — Read-Only Audit (2026-09-27)

**Branch:** `feat/gallery-click-zoom` (cut from `main` @ `a4b0914`, which already contains `feat/lookbook-delete` merge `d7d069d`)
**Scope:** Read-only. No code changed. This report only.

## Plain-language summary

**What's already there:** the customer lookbook, public lookbook, and public piece pages already use a shared `ProductGallery` component. For a piece with **2+ photos**, clicking the photo already opens a full-screen zoom viewer (arrows + dots + thumbnails + counter, powered by `yet-another-react-lightbox`). For a piece with **exactly 1 photo**, the code *attaches* a click handler that tries to open the same viewer, but the component's `return` statement short-circuits before the viewer is ever added to the page — so today, clicking a single-photo piece silently does nothing visible. That's a small, precisely-located bug, not a missing feature from scratch.

**Merchant side is different:** Lookbook Manager's "Current catalogue" grid and the selected-designer-lookbook grid don't use `ProductGallery` at all today — they render a plain `<img>`. Wiring click-to-zoom there means introducing the component for the first time, and there is one real collision risk: `ProductGallery`'s own built-in dot-indicator row would visually overlap the merchant card's existing bottom gradient overlay ("source · likes ♥" + "+N" badge), since both are bottom-anchored, full-width, absolutely-positioned elements in the same stacking context. The safe fix is to open the full-screen viewer directly from the plain `<img>`'s click (skip `ProductGallery`'s own card-level arrows/dots on the merchant grid), and let the *viewer itself* provide the multi-photo slider once open.

**Library capability confirmed:** the installed `yet-another-react-lightbox` package (already a dependency, already lazy-loaded) has documented, typed options to fully suppress navigation arrows (`render.buttonPrev`/`buttonNext` returning `null`) and to omit the Thumbnails/Counter plugins entirely when there's only one slide — verified against the package's own `.d.ts` files and bundled source below, not assumed.

**Bottom line:** this is a small, surgical fix — no backend/db.js changes, no new dependency, no layout-shift risk on customer pages (the click handler already exists there), and one specific overlap risk to design around on the merchant grid. Full evidence below.

---

## 3. Core gallery files

### `src/components/ProductGallery.jsx`

**The count === 1 early return** — `src/components/ProductGallery.jsx:77`:
```js
if (count === 1) return mainElement;
```

**`mainElement`** is built *before* that check, `src/components/ProductGallery.jsx:55-75`:
```js
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
```

**Key finding:** `mainElement` already carries `onClick={openViewer}` regardless of `count`. So a single-photo piece today is *not* missing a click handler — clicking it already calls `openViewer()` (`src/components/ProductGallery.jsx:39`: `const openViewer = () => { setHasOpened(true); setOpen(true); };`), which sets `hasOpened`/`open` state and triggers a re-render. But because line 77 returns `mainElement` alone — before the component ever reaches the `<Suspense>`/`<ProductGalleryViewer>` block below — the re-render still only returns `mainElement`. The viewer component is never mounted, so nothing visibly happens. This is the exact, narrow gap to close: not "add a click handler," but "let the click's existing state change actually reach a rendered viewer."

**Card view — video/image elements, click, touch handlers:** quoted in full above (lines 55-75). Both branches share identical `onClick`/`onTouchStart`/`onTouchEnd` wiring.

**Arrows** — `src/components/ProductGallery.jsx:82-97`:
```js
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
```

**Dots** — `src/components/ProductGallery.jsx:98-108`:
```js
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
```
Both arrows and dots are only reached when `count > 1` (they sit after the `if (count === 1) return mainElement;` early return, in the JSX returned at `src/components/ProductGallery.jsx:79-123`). They are **already** absent for single-photo pieces — that part needs no change.

**`openViewer` / `hasOpened` logic** — `src/components/ProductGallery.jsx:26-39`:
```js
const [open, setOpen] = useState(false);
// Stays true after the first open so the lazy import above only ever fires
// once per mount, even across later close/reopen cycles.
const [hasOpened, setHasOpened] = useState(false);
const touchStartX = useRef(null);
...
const openViewer = () => { setHasOpened(true); setOpen(true); };
```
and the guarded render — `src/components/ProductGallery.jsx:109-121`:
```js
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
```
`hasOpened` is a one-way latch (never reset) so the `lazy()` import in `src/components/ProductGallery.jsx:10` (`const ProductGalleryViewer = lazy(() => import('./ProductGalleryViewer.jsx'));`) only fires once per mount. This whole block is unreachable for `count === 1` today because of the line-77 early return.

**What would have to change** for a single-item piece to open the viewer while an unclicked single-item piece renders identical DOM to today:
- The `if (count === 1) return mainElement;` early return (line 77) must stop being a full bail-out. The `hasOpened`/`Suspense`/`ProductGalleryViewer` block (lines 109-121) must render alongside `mainElement` in the `count === 1` case too — but the **arrows** (lines 82-97) and **dots** (lines 98-108) must not. Concretely: split the current single `return` at line 79-123 so the arrow/dot JSX is only emitted `{count > 1 && (...)}`, while `mainElement` + the `hasOpened`-gated viewer block are emitted unconditionally.
- Before any click, `hasOpened` is `false` and `open` is `false` in both the current code and the changed code, so `{hasOpened && (...)}` renders nothing (`null`) either way — meaning the closed-state DOM for a single-item piece is provably identical to today's (`mainElement` only) except for the click handler, which is *already* present today and unchanged. No new wrapper element is required around `mainElement` itself since `mainElement`'s own click handler already exists — only the sibling viewer block needs to stop being skipped.
- The `ProductGalleryViewer` invocation (or the `plugins`/`render` props it forwards to `Lightbox`) needs to know when `slides.length === 1` so it can drop the Thumbnails/Counter plugins and hide the nav buttons — see next section for exactly which props do that, confirmed against the installed library.

### `src/components/ProductGalleryViewer.jsx`

Full file (37 lines) — **Lightbox props** in use today, `src/components/ProductGalleryViewer.jsx:25-36`:
```js
export default function ProductGalleryViewer({ slides, index, open, onClose, onViewChange }) {
  return (
    <Lightbox
      open={open}
      close={onClose}
      index={index}
      on={{ view: ({ index: i }) => onViewChange(i) }}
      slides={slides}
      plugins={[Zoom, Video, Thumbnails, Counter]}
      styles={LIGHTBOX_STYLES}
    />
  );
}
```
`plugins={[Zoom, Video, Thumbnails, Counter]}` is a static array — it does not vary by `slides.length` today. This is the second (and only other) place that needs a change.

**Library evidence — proving each hide-mechanism exists, quoted from the installed package:**

1. **`render.buttonPrev` / `render.buttonNext`** exist and are documented as override slots — `node_modules/yet-another-react-lightbox/dist/types.d.ts:357-360`:
   ```ts
   /** render custom Prev button */
   buttonPrev?: RenderFunction;
   /** render custom Next button */
   buttonNext?: RenderFunction;
   ```
   And the core `Navigation` component actually calls them instead of rendering its own button when supplied — `node_modules/yet-another-react-lightbox/dist/index.js:1396-1402`:
   ```js
   function Navigation({ render: { buttonPrev, buttonNext, iconPrev, iconNext }, styles }) {
       const { prev, next, subscribeSensors } = useController();
       const { prevDisabled, nextDisabled } = useNavigationState();
       useKeyboardNavigation(subscribeSensors);
       return (React.createElement(React.Fragment, null,
           buttonPrev ? (buttonPrev()) : (React.createElement(NavigationButton, ...)),
           buttonNext ? (buttonNext()) : (React.createElement(NavigationButton, ...))));
   }
   ```
   Passing `render={{ buttonPrev: () => null, buttonNext: () => null }}` when `slides.length === 1` fully removes the arrow buttons from the DOM (not just disables them).

2. **`carousel.finite`** exists — `node_modules/yet-another-react-lightbox/dist/types.d.ts:190-193`:
   ```ts
   interface CarouselSettings {
       /** if `true`, the lightbox carousel doesn't wrap around */
       finite: boolean;
   ```
   and it only *disables* the buttons at the edges, it does not hide them — `node_modules/yet-another-react-lightbox/dist/index.js:1353-1358`:
   ```js
   function useNavigationState() {
       const { carousel } = useLightboxProps();
       const { slides, currentIndex } = useLightboxState();
       const prevDisabled = slides.length === 0 || (carousel.finite && currentIndex === 0);
       const nextDisabled = slides.length === 0 || (carousel.finite && currentIndex === slides.length - 1);
       return { prevDisabled, nextDisabled };
   }
   ```
   With one slide (`currentIndex === 0 === slides.length - 1`) and `finite: true`, both `prevDisabled` and `nextDisabled` become `true` — but per `NavigationButton`, `disabled` only sets the HTML `disabled` attribute (dimmed via `.yarl__button:disabled` CSS), the button element itself still renders. **`finite` alone is not sufficient to satisfy "no arrows" — `render.buttonPrev`/`buttonNext` returning `null` is the mechanism that actually removes them from the DOM.**

3. **Thumbnails plugin `hidden` option** exists — `node_modules/yet-another-react-lightbox/dist/plugins/thumbnails/index.d.ts:38-40`:
   ```ts
   /** if `true`, thumbnails are hidden when the lightbox opens */
   hidden?: boolean;
   ```
   But this only controls the *initial* open/closed toggle state of the thumbnails strip — it does not depend on slide count, and (per `showToggle`, line 41-42 of the same file) a toggle button can still reveal it. **The Thumbnails plugin has no built-in "don't show for 1 slide" behavior; the reliable mechanism is to exclude `Thumbnails` from the `plugins` array entirely when `slides.length === 1`,** not to pass `thumbnails={{ hidden: true }}`.

4. **Counter plugin has no slide-count guard at all** — full plugin body, `node_modules/yet-another-react-lightbox/dist/plugins/counter/index.js`:
   ```js
   function CounterComponent({ counter }) {
       const { slides, currentIndex } = useLightboxState();
       const { separator, container: {...}, ...legacyRest } = resolveCounterProps(counter);
       if (slides.length === 0)
           return null;
       return (React.createElement("div", {...},
           currentIndex + 1, " ", separator, " ", slides.length));
   }
   ```
   The only early-return guard is `slides.length === 0` — with exactly 1 slide it renders `"1 / 1"` unconditionally. **The only way to suppress it is to exclude `Counter` from the `plugins` array when `slides.length === 1`** (there is no prop that hides it while keeping the plugin active).

**Conclusion for section 3:** the smallest correct viewer-side change is conditionally building the `plugins` array (`slides.length > 1 ? [Zoom, Video, Thumbnails, Counter] : [Zoom, Video]`) and conditionally passing `render={{ buttonPrev: () => null, buttonNext: () => null }}` when `slides.length <= 1`, inside `ProductGalleryViewer.jsx`. `Video` is safe to always include — `mediaList.js`'s `validateList` (`src/lib/mediaList.js:42-44`) guarantees `list[0].type === 'image'`, so a single-item piece is always an image and the Video plugin is simply inert for it, no behavior difference either way.

### `src/lib/mediaList.js` — `fromPiece` (read only)

`src/lib/mediaList.js:106-111`:
```js
export function fromPiece(piece) {
  if (!piece) return [];
  if (Array.isArray(piece.media) && piece.media.length > 0) return piece.media;
  if (piece.image_url) return [{ url: piece.image_url, type: 'image' }];
  return [];
}
```
Single source of truth for "what is this piece's photo list," already used identically by `ProductGallery.jsx:23` (`const media = fromPiece(piece);`) and by the merchant Edit-photos modal (`src/pages/merchant/Catalogue.jsx:235`: `setEditMedia(fromPiece(item));`). No change needed here — it already returns a 1-item list for legacy `image_url`-only pieces, which is exactly the `count === 1` case under audit.

---

## 4. Customer surfaces

### `src/pages/Lookbook.jsx:330-358` (full card)
```jsx
{catalogueState === 'ready' && (
  <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
    {catalogue.map((item) => (
      <article key={item.id} className="animate-fadeUp group">
        <div className="relative bg-mist overflow-hidden border border-line">
          <ProductGallery piece={item} className="aspect-[3/4] w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          <button
            onClick={() => { likeItem(customer.id, item.id); setLikeAnim(item.id); setTimeout(() => setLikeAnim(null), 400); }}
            className={cls('absolute top-3 right-3 h-9 w-9 bg-white/90 border border-line flex items-center justify-center text-lg transition-transform cursor-pointer hover:scale-110', likeAnim === item.id && 'animate-pop')}
            aria-label="Like"
          >
            <span className={cls('text-gold', item.likes > 0 && 'drop-shadow')}>♥</span>
          </button>
          {item.likes > 0 && <div className="absolute bottom-3 left-3 bg-white/90 border border-line px-2 py-0.5 text-[10px] tracking-wide2 uppercase text-steel">{item.likes} loved</div>}
        </div>
        <div className="pt-4">
          ...
          <button onClick={() => addToCart(item)} className="btn-outline !py-1.5 !px-3 text-[9px]">Add to bag</button>
          <a href={waLink(item)} target="_blank" rel="noreferrer" className="btn-ghost w-full mt-3 !py-2 text-[9px] border-gold/50 text-gold hover:border-gold">
            Inquire via WhatsApp ✆
          </a>
        </div>
      </article>
    ))}
  </div>
)}
```
Wrapper (`div.relative.bg-mist.overflow-hidden.border.border-line`, line 334) has **no `onClick`** of its own. The `<article>` (line 333) also has **no `onClick`**.

**Overlays positioned over the image, in this exact container:**
| Overlay | Line | Own click handler? | Would still receive its own clicks with an `onClick` on the image? |
|---|---|---|---|
| Like button (`absolute top-3 right-3 ...`) | 336-342 | Yes, its own `onClick` | Yes — it's a sibling `<button>` element rendered *after* `ProductGallery` in the DOM, so it sits on top in the same stacking context and intercepts its own clicks regardless of the image's handler. |
| "N loved" badge (`absolute bottom-3 left-3 ...`) | 343 | No (static, not interactive) | N/A — not clickable today, not affected. |
| "Add to bag" button | 350 | Yes, own `onClick`, outside the image container entirely | Yes. |
| "Inquire via WhatsApp" link | 352-354 | Yes, own `href`/anchor, outside the image container | Yes. |

`group-hover:scale-105` (image hover-zoom) is on the `className` passed into `ProductGallery`, applied directly to `mainElement` (the `<img>`/`<video>`) — unaffected by adding/keeping a click handler on that same element.

**Parent click that would fight a new click:** none. No `<article>`- or wrapper-level `onClick` exists to navigate or open anything else — confirmed via `grep -n "onClick" src/pages/Lookbook.jsx` (full output above in section 7): the only relevant `onClick`s near this block are the like button (337) and add-to-bag (350), both independent, unrelated buttons.

### `src/pages/PublicLookbook.jsx:83-107`
```jsx
) : items.length > 0 ? (
  <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
    {items.map((item) => (
      <article key={item._id || item.id} className="animate-fadeUp group">
        <div className="relative bg-mist overflow-hidden border border-line">
          <ProductGallery piece={item} className="aspect-[3/4] w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        </div>
        <div className="pt-4">
          ...
          <a href={waLink(item)} target="_blank" rel="noreferrer" className="btn-gold w-full mt-3 !py-2 text-[9px] border-gold text-ink hover:bg-gold/10">
            Inquire via WhatsApp ✆
          </a>
        </div>
      </article>
    ))}
  </div>
```
**No sibling overlays at all** inside the image container here — `grep -n "onClick" src/pages/PublicLookbook.jsx` returned **zero matches** (confirmed above in section 7). This is the simplest of the three surfaces: just the image, no like button, no badge, no parent click. Lowest risk.

### `src/pages/PublicPiece.jsx:68-73`
```jsx
<section className="grid md:grid-cols-2 gap-x-10 gap-y-6 py-10 items-start">
  {/* Image */}
  <div className="relative bg-mist overflow-hidden border border-line">
    <ProductGallery piece={piece} className="aspect-[3/4] w-full object-cover" />
  </div>
```
No `group-hover:scale-105` here (static detail page, not a grid card) and no sibling overlay in the image container. The only `onClick` in the whole file is the unrelated "Buy Now" button (`src/pages/PublicPiece.jsx:91`: `onClick={() => alert('Coming soon')}`), physically in a separate `<div>` (the "Details" column, line 76), not inside the image wrapper.

**Section 4 conclusion:** all three customer surfaces already call `ProductGallery` with an identical `relative` wrapper pattern; every overlay in every surface is a DOM sibling with its own click handler, positioned after `ProductGallery` in source order, so none would lose their own clickability if the image gained a working `onClick` (it already has one — the bug is purely in the `count === 1` render gap documented in section 3).

---

## 5. Merchant surfaces — `src/pages/merchant/Catalogue.jsx`

**Are "Current catalogue" and the selected-lookbook grid the same JSX?** Yes — confirmed by `src/pages/merchant/Catalogue.jsx:614-660`, one single `shownItems.map(...)` block. `shownItems` (defined earlier, referenced at line 550 and 614) is the variable that switches between "all pieces" and "pieces filtered to the selected lookbook" depending on the `selected` dropdown state (`src/pages/merchant/Catalogue.jsx:557`, `onChange={(e) => selectLookbook(e.target.value)}`) — the grid markup itself never branches.

**Full card**, `src/pages/merchant/Catalogue.jsx:616-658`:
```jsx
{shownItems.map((i) => (
  <div key={i.id} className="card overflow-hidden group">
    <div className="relative">
      <img src={i.image_url} alt={i.title} className="aspect-[3/4] w-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/80 to-transparent p-3 flex justify-between items-end">
        <span className="text-[9px] tracking-wide2 uppercase text-white/80">{i.source} · {i.likes || 0} ♥</span>
        {Array.isArray(i.media) && i.media.length > 1 && (
          <span className="text-[9px] tracking-wide2 uppercase text-white/80">+{i.media.length - 1}</span>
        )}
      </div>
    </div>
    <div className="p-4">
      <div className="text-sm font-medium truncate">{i.title}</div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-sm">{i.price ? inr(i.price) : 'IG · shoppable'}</span>
        <button onClick={() => onRemove(i)} disabled={removingId === i.id} className="btn-ghost !py-1 !px-3 text-[9px]">
          {removingId === i.id ? 'Removing…' : 'Remove'}
        </button>
      </div>
      {removeErrId === i.id && <div className="text-xs text-gold mt-2">{removeErrMsg}</div>}
      <div className="flex items-center gap-2 mt-3">
        <button onClick={() => copyPieceLink(i.id)} className="btn-ghost !py-1 !px-2 text-[9px] flex-1">
          {copiedId === i.id ? '✓ Copied' : '🔗 Copy Link'}
        </button>
        <a href={waPieceLink(i)} target="_blank" rel="noreferrer" className="btn-gold !py-1 !px-2 text-[9px] flex items-center justify-center" aria-label="WhatsApp">
          <svg ...>...</svg>
        </a>
      </div>
      {i.convexId && (
        <button onClick={() => openEditPhotos(i)} className="btn-ghost w-full mt-3">Edit photos</button>
      )}
      <div className="flex items-center gap-2 mt-2">
        <button onClick={() => alert('Coming soon')} className="btn-ink !py-1 !px-2 text-[9px] flex-1">
          Buy Now
        </button>
        <a href={waInquireLink(i)} target="_blank" rel="noreferrer" className="btn-ghost !py-1 !px-2 text-[9px] flex-1 text-center">
          Inquire
        </a>
      </div>
      {i.instagram_link && i.instagram_link !== '#' && <a href={i.instagram_link} target="_blank" rel="noreferrer" className="text-[10px] text-gold tracking-wide2 uppercase mt-1 inline-block">View post ↗</a>}
    </div>
  </div>
))}
```

**Key finding — this is a plain `<img>`, not `ProductGallery`.** Merchant Lookbook Manager does not use the shared component at all today. Wiring click-to-zoom here is new integration, not a bug fix.

**Gradient overlay with "source · likes ♥" and "+N" badge** — `src/pages/merchant/Catalogue.jsx:620-624`, quoted above: `absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/80 to-transparent p-3 flex justify-between items-end`. This div has **no explicit height** — its box is sized by its content (the two `<span>`s) plus `p-3` padding, `items-end` vertically anchors that content to the bottom of the flex row. It does **not** have `pointer-events-none`, so it captures clicks/taps anywhere inside its own (content-sized) box, i.e. roughly the bottom text-row strip of the image, not the full image height.

**Buttons in this card:** Edit photos (645, conditional on `i.convexId`), Copy Link (637-639), Buy Now (648-650, currently a stub `alert('Coming soon')`), Inquire (651-653), Remove (631-633) — all below the image, in the `p-4` details block, all outside the `relative` image wrapper (`div.relative`, line 618). None of them sit over the image, so none are at risk from an image-level `onClick`.

**Parent `onClick`:** none. The outer `<div className="card overflow-hidden group">` (616) and the image wrapper `<div className="relative">` (618) both have no `onClick`.

**How a merchant piece's media list is available:** `fromPiece(i)` — `mediaList.js`'s `fromPiece` is already imported at the top of this file (`src/pages/merchant/Catalogue.jsx:3`: `import { classifyFile, addEntries, moveEntry, removeEntry, fromPiece, validateList } from '../../lib/mediaList.js';`) and already used for the Edit-photos modal (`src/pages/merchant/Catalogue.jsx:235`: `setEditMedia(fromPiece(item));`). No new import needed to call `fromPiece(i)` for the click-to-zoom wiring.

**Local-only pieces without media:** every item reaching this grid already has `i.image_url` set — it's what the plain `<img src={i.image_url}>` (line 619) renders today, and manual/CSV/Instagram entry paths all set `image_url` unconditionally (`src/pages/merchant/Catalogue.jsx:295` manual: `image_url: galleryList[0].url`; `:344` Instagram: `image_url: igImg`; `:359` CSV: `image_url: url.trim()`). Since `fromPiece` falls back to a 1-item list from `image_url` when `piece.media` is absent (`src/lib/mediaList.js:109`), `fromPiece(i)` is guaranteed non-empty for every item that currently renders in this grid — no crash risk, no "no photo" edge case to handle beyond what `ProductGallery` already handles (`count === 0` → renders nothing, `src/components/ProductGallery.jsx:32`).

---

## 6. Other places a piece's photo is shown

`grep -rn "image_url" src/pages/ src/components/ 2>/dev/null | grep -v "ProductGallery.jsx|mediaList.js"`:

| File:line | What it is | In scope? |
|---|---|---|
| `src/pages/Lookbook.jsx:371` — `<img src={catalogue.find(...)?.image_url \|\| ''} className="h-16 w-14 object-cover border border-line" alt="" />` | Small thumbnail next to "Write review" in the reviewable-items block | **Out of scope** — a fixed 64×56px utility thumbnail in a review-request list item, not the piece's main product photo presentation. |
| `src/pages/Lookbook.jsx:416` — `<img src={i.image_url} alt="" className="h-20 w-16 object-cover border border-line" />` | Cart/bag drawer line-item thumbnail | **Out of scope** — same reasoning, an 80×64px cart-row thumbnail, not a product-photo gallery surface. |
| `src/pages/merchant/Catalogue.jsx:619` | Current-catalogue / selected-lookbook grid image | **In scope** — covered in section 5. |
| `src/pages/merchant/Catalogue.jsx:500` | The Manual Entry form's own `image_url` text `<input>` (not an `<img>` render) | **Out of scope** — a form field, not a photo display. |

`grep -rln "\.image_url\|item\.media\b" src/pages/merchant/*.jsx src/pages/*.jsx` returned only `Catalogue.jsx` and `Lookbook.jsx` (pasted above in the exploration, not re-pasted here) — Templates, Campaigns, Dashboard, and any order/points screens do **not** render a piece's product photo at all; they were checked and are simply not in scope because they don't display catalogue images. `PublicLookbook.jsx`'s PDF preview (`src/pages/PublicLookbook.jsx:82`: `<iframe src={lookbook.pdf_url} className="w-full h-[600px]" title="PDF preview" />`) is a whole-lookbook PDF document preview, not a per-piece photo — also out of scope.

---

## 7. Risks with quoted evidence

**(a) Touch swipe vs. click — pre-existing, not introduced by this change.**
`src/components/ProductGallery.jsx:41-47`:
```js
const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
const onTouchEnd = (e) => {
  if (touchStartX.current === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX.current;
  if (Math.abs(dx) > 40) advance(dx < 0 ? 1 : -1);
  touchStartX.current = null;
};
```
Neither handler calls `preventDefault()` or `stopPropagation()`, and neither sets any flag consumed by `onClick={openViewer}`. On a touch device, a swipe that changes `touchStartX.current` by more than 40px triggers `advance()`, but the same gesture may *also* still fire a synthetic `click` afterward (browsers generally fire `click` after `touchend` unless something explicitly suppresses it) — meaning `openViewer()` could fire immediately after a swipe on an existing (`count > 1`) multi-photo piece **today**, in already-merged code. This is a real, already-shipped risk, not something newly introduced by fixing `count === 1`. For a single-item piece specifically there is nothing to swipe to (`count === 1` means `advance()` is never meaningfully reachable in the slider sense), so wiring the viewer for `count === 1` does not add a *new* instance of this risk — it inherits the existing one unchanged.

**(b) Keyboard accessibility.**
The `<img>`/`<video>` in `mainElement` (`src/components/ProductGallery.jsx:56-74`, quoted in section 3) has no `role`, no `tabIndex`, and no `onKeyDown` handler. It is a plain image element with a mouse/touch `onClick` — not reachable or activatable via keyboard (Tab won't focus it, Enter/Space won't trigger `openViewer`). This is a pre-existing gap (the click handler already exists for `count > 1` today with the same omission) that any follow-up should be aware of, but is unchanged in scope/severity by fixing the `count === 1` render gap.

**(c) Layout shift — a wrapper around a single image.**
All three customer call sites already wrap `ProductGallery` in a positioned container: `relative bg-mist overflow-hidden border border-line` (`src/pages/Lookbook.jsx:334`, `src/pages/PublicLookbook.jsx:87`, `src/pages/PublicPiece.jsx:71`, all quoted in section 4) with `aspect-[3/4]` on the `className` passed to `ProductGallery` itself. Because the fix (section 3) does not add a *new* DOM wrapper — it only changes which sibling elements render next to the already-existing `mainElement` — there is no new box in the layout tree for `count === 1`, hence no layout shift. The merchant grid (section 5) already has an equivalent `relative` wrapper (`src/pages/merchant/Catalogue.jsx:618`), so swapping its plain `<img>` for one wired the same way preserves the same box model.

**(d) Hover zoom classes.**
`group-hover:scale-105` is applied via the `className` prop straight onto `mainElement` (the actual `<img>`/`<video>` DOM node) on the two customer grid surfaces (`src/pages/Lookbook.jsx:335`, `src/pages/PublicLookbook.jsx:88`). Adding/using the element's own `onClick` does not touch `className`, so this is unaffected on either surface.

**(e) Viewer opened from a card inside a scrollable/transformed parent.**
The `Lightbox`'s outer portal is rendered via `createPortal` (`node_modules/yet-another-react-lightbox/dist/index.js:4`: `import { createPortal } from 'react-dom';`, used at `node_modules/yet-another-react-lightbox/dist/index.js:1536`) directly to `document.body` by default, and is `position: fixed` with `z-index: 9999` (`node_modules/yet-another-react-lightbox/dist/styles.css:1`: `.yarl__portal{position:fixed;...z-index:var(--yarl__portal_zindex,9999);...}`). Because it escapes to `document.body` rather than staying nested inside the scrollable grid or the `group`/`animate-fadeUp` card, it is not affected by the card's own scroll position, `overflow-hidden`, or hover-scale transform — a CSS `transform` on an ancestor would normally break `position: fixed` containment, but the portal sidesteps that entirely by rendering outside the transformed subtree.

**(f) Main CSS/JS bundle size.**
The `yet-another-react-lightbox` import and its three stylesheets (`node_modules/yet-another-react-lightbox/dist/...` — `styles.css`, `plugins/thumbnails.css`, `plugins/counter.css`) are imported exclusively inside `src/components/ProductGalleryViewer.jsx:1-8`, which is only ever reached via the `lazy()` call in `src/components/ProductGallery.jsx:10` (`const ProductGalleryViewer = lazy(() => import('./ProductGalleryViewer.jsx'));`), itself gated behind `hasOpened` (`src/components/ProductGallery.jsx:109`). This lazy chunk already exists in the current production bundle for the `count > 1` case. Wiring the `count === 1` fix reuses the exact same `lazy()` call and the same module specifier — no new chunk is created. Wiring the merchant grid to call the *same* `ProductGallery`/`ProductGalleryViewer` module (rather than a duplicate copy) means Vite resolves it to the same chunk regardless of how many pages import it, so the marginal main-bundle-size impact of this whole change is expected to be at or near zero. (Not independently re-verified with a fresh `npm run build` in this audit, per the read-only/no-build-commands constraint — flagged as something to actually run once a change is proposed.)

**(g) Lightbox portal vs. the merchant Edit-photos Modal / sticky header — z-index check.**
- Merchant `Modal` (Edit photos) — `src/components/ui.jsx:45`: `<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 sm:p-8" onClick={onClose}>` → `z-50`.
- Merchant `Shell.jsx` sticky/mobile overlays — `src/components/merchant/Shell.jsx:285`: `<div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />` and `:408`: `<div className="fixed inset-0 z-40 lg:hidden">` → `z-40`.
- Lightbox portal — `z-index: 9999` (quoted in (e) above), well above both `z-50` and `z-40`.

No clash: if a merchant somehow triggers both the Edit-photos `Modal` and the gallery viewer at once (not a flow that exists today — Edit photos and the click-to-zoom viewer would be two different explicit user actions on the same card, not simultaneously default-open), the Lightbox portal (`z-9999`) would always render on top of the `Modal` (`z-50`), never underneath it. This is a display-priority question, not a correctness bug, and matches the customer-side behavior already shipped.

---

## 8. Recommended smallest safe change

**Files and line regions a build would touch:**

1. **`src/components/ProductGallery.jsx`** (~lines 77-123): restructure the single `return` so that:
   - `mainElement` (lines 55-75, unchanged) always renders.
   - The arrow buttons (82-97) and dot row (98-108) render only when `count > 1` (currently they're already gated by the early `return` at line 77, so this is a matter of moving the `if (count === 1) return mainElement;` bail-out to only skip *those* two blocks, not the viewer block below).
   - The `hasOpened`/`Suspense`/`ProductGalleryViewer` block (109-121) renders regardless of `count`, so a single-item piece's `openViewer()` (already firing today, per section 3) actually mounts the viewer.
2. **`src/components/ProductGalleryViewer.jsx`** (~lines 1-8, 25-36): make the `plugins` array conditional on `slides.length` (`slides.length > 1 ? [Zoom, Video, Thumbnails, Counter] : [Zoom, Video]`) and pass `render={{ buttonPrev: () => null, buttonNext: () => null }}` when `slides.length <= 1`, per the library evidence in section 3.
3. **`src/pages/merchant/Catalogue.jsx`** (~lines 616-626): replace the plain `<img src={i.image_url} ... />` (line 619) with `ProductGallery piece={i} className="aspect-[3/4] w-full object-cover" />` for the *click-to-open* behavior — but do **not** rely on `ProductGallery`'s own card-level arrow/dot chrome here, because (per section 7's finding) its dot row (`absolute bottom-3 inset-x-0`, `src/components/ProductGallery.jsx:98`) would visually collide with the existing bottom gradient overlay (`absolute inset-x-0 bottom-0 ...`, `src/pages/merchant/Catalogue.jsx:620`) — both are bottom-anchored and full-width in the same `relative` container (line 618). The multi-photo *slider* experience (per the task's own framing: "slider when there are several entries") should live inside the full-screen viewer (which already has its own arrows/thumbnails once `count > 1`), not duplicated as a second slider chrome on the small grid thumbnail. This is an open decision — see below.

**Backend/db.js change needed:** None. `fromPiece` (`src/lib/mediaList.js:106-111`) is read-only, already the single source of truth, already imported in both the customer components and `Catalogue.jsx`. No Convex schema, query, or mutation is touched by any of this — it's a pure rendering/wiring change on data already present in `piece.media`/`piece.image_url`.

**Open decisions for Saidul:**
1. On the merchant grid, should the card thumbnail itself gain `ProductGallery`'s own arrow/dot slider chrome (risking the gradient-overlay/badge collision documented in section 7), or should the card stay a single static thumbnail that opens straight into the full-screen viewer (which already has its own slider once open)? This audit recommends the latter as the smaller, safer change, but it's a product call.
2. Should the keyboard-accessibility gap (section 7(b) — image has no `role`/`tabIndex`/`onKeyDown`) be fixed as part of this change, or logged as a separate follow-up? It's a pre-existing gap on the customer side already, so fixing it here would slightly widen scope beyond "wire the click."
3. Should the pre-existing swipe-vs-click double-fire risk (section 7(a)) be addressed in the same change (e.g., a `preventDefault()`/suppression flag on swipe), or left as-is since it already ships today for every multi-photo piece?

---

## Final verification

```
$ git status --short
?? docs/qa-reports/2026-09-27-gallery-click-zoom-audit.md

$ git stash list
(empty)
```
