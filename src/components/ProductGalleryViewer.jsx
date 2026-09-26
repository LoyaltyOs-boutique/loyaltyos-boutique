import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Video from 'yet-another-react-lightbox/plugins/video';
import Thumbnails from 'yet-another-react-lightbox/plugins/thumbnails';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/thumbnails.css';
import 'yet-another-react-lightbox/plugins/counter.css';

// Palette source: tailwind.config.js (gold #C5A880, ink #111111) — reused here
// as inline styles because the library reads a `styles` prop for slot
// customization, not Tailwind classes; src/index.css is never touched.
const LIGHTBOX_STYLES = {
  container: { backgroundColor: 'rgba(17, 17, 17, 0.95)' }, // ink, near-opaque
  icon: { color: '#C5A880' }, // gold
};

/**
 * Design spec: docs/superpowers/specs/2026-09-25-product-gallery-design.md
 * (decision 5) — the full-screen zoom viewer only, split out of
 * ProductGallery.jsx so the library's JS and CSS load lazily on first open
 * instead of on every page load (see ProductGallery.jsx's React.lazy call).
 * Renders the Lightbox exactly as it was configured there, unchanged.
 */
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
