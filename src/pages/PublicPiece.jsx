import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BRAND } from '../data/seed.js';
import { getCatalogueItemById } from '../lib/db.js';
import { inr } from '../lib/util.js';

export default function PublicPiece() {
  const { pieceId } = useParams();
  const [piece, setPiece] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    getCatalogueItemById(pieceId)
      .then((data) => {
        if (mounted) {
          if (data) setPiece(data);
          else setError(true);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) { setError(true); setLoading(false); }
      });
    return () => { mounted = false; };
  }, [pieceId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-5">
        <div className="text-center">
          <div className="eyebrow mb-3">Loading piece…</div>
          <div className="luxe-title text-2xl text-gold animate-pulse">85 Lansdowne</div>
        </div>
      </div>
    );
  }

  if (error || !piece) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-5">
        <div className="max-w-sm text-center">
          <div className="text-5xl mb-4">👗</div>
          <div className="eyebrow mb-2">Piece not found</div>
          <h1 className="luxe-title text-2xl mb-3">This piece doesn't exist or has been removed.</h1>
          <p className="text-sm text-steel mb-6">Please check the link or contact the boutique.</p>
        </div>
      </div>
    );
  }

  const waLink = `https://wa.me/${BRAND.wa}?text=${encodeURIComponent(
    `Hi! I'm interested in the ${piece.title} from 85 Lansdowne.`
  )}`;

  return (
    <div className="min-h-screen bg-paper">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-line">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
          <img src={BRAND.logo} alt="85 Lansdowne" className="h-9 object-contain" />
          <span className="text-[10px] tracking-wide2 uppercase text-steel">Public view</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 pb-24">
        <section className="grid md:grid-cols-2 gap-x-10 gap-y-6 py-10 items-start">
          {/* Image */}
          <div className="relative bg-mist overflow-hidden border border-line">
            <img
              src={piece.image_url}
              alt={piece.title}
              className="aspect-[3/4] w-full object-cover"
            />
          </div>

          {/* Details */}
          <div className="animate-fadeUp">
            <div className="eyebrow mb-2 text-gold">85 Lansdowne Atelier</div>
            <h1 className="luxe-title text-3xl md:text-4xl leading-tight">{piece.title}</h1>
            {piece.price ? (
              <div className="text-lg font-medium mt-4">{inr(piece.price / 100)}</div>
            ) : null}
            {(piece.size || piece.colour) && (
              <div className="text-sm text-steel mt-3 space-y-1">
                {piece.size && <div>Size · {piece.size}</div>}
                {piece.colour && <div>Colour · {piece.colour}</div>}
              </div>
            )}

            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={() => alert('Coming soon')}
                className="btn-ink flex-1 !py-2 text-[10px]"
              >
                Buy Now
              </button>
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                className="btn-gold flex-1 !py-2 text-[10px] border-gold text-ink hover:bg-gold/10 text-center"
              >
                Inquire via WhatsApp ✆
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
