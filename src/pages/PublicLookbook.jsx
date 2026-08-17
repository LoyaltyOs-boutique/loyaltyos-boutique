import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BRAND } from '../data/seed.js';
import { getLookbookById } from '../lib/db.js';
import { inr, cls } from '../lib/util.js';

export default function PublicLookbook() {
  const { lookbookId } = useParams();
  const [lookbook, setLookbook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    getLookbookById(lookbookId)
      .then((data) => {
        if (mounted) {
          if (data) setLookbook(data);
          else setError(true);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) { setError(true); setLoading(false); }
      });
    return () => { mounted = false; };
  }, [lookbookId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-5">
        <div className="text-center">
          <div className="eyebrow mb-3">Loading lookbook…</div>
          <div className="luxe-title text-2xl text-gold animate-pulse">85 Lansdowne</div>
        </div>
      </div>
    );
  }

  if (error || !lookbook) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-5">
        <div className="max-w-sm text-center">
          <div className="text-5xl mb-4">📖</div>
          <div className="eyebrow mb-2">Lookbook not found</div>
          <h1 className="luxe-title text-2xl mb-3">This lookbook doesn't exist or has been removed.</h1>
          <p className="text-sm text-steel mb-6">Please check the link or contact the boutique.</p>
        </div>
      </div>
    );
  }

  const items = lookbook.items || [];
  const waLink = (item) =>
    `https://wa.me/${BRAND.wa}?text=${encodeURIComponent(
      `Hi! I'm interested in the ${item.title} from ${lookbook.title || '85 Lansdowne'}.`
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

      <main className="max-w-6xl mx-auto px-5 pb-24">
        {/* Lookbook hero */}
        <section className="py-10">
          <div className="eyebrow mb-2 text-gold">{lookbook.designer || '85 Lansdowne Atelier'}</div>
          <h1 className="luxe-title text-4xl md:text-5xl">{lookbook.title}</h1>
          <p className="text-steel mt-3 max-w-2xl text-sm leading-relaxed">
            {items.length} curated piece{items.length !== 1 ? 's' : ''} — tap to inquire via WhatsApp.
          </p>
        </section>

        {/* Product grid */}
        {items.length > 0 ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
            {items.map((item) => (
              <article key={item._id || item.id} className="animate-fadeUp group">
                <div className="relative bg-mist overflow-hidden border border-line">
                  <img
                    src={item.image_url}
                    alt={item.title}
                    loading="lazy"
                    className="aspect-[3/4] w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <div className="pt-4">
                  <div className="eyebrow text-[9px] mb-1">85 Lansdowne Atelier</div>
                  <h3 className="luxe-title text-lg leading-snug">{item.title}</h3>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm font-medium">{inr(item.price ? item.price / 100 : 0)}</span>
                  </div>
                  <a
                    href={waLink(item)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-gold w-full mt-3 !py-2 text-[9px] border-gold text-ink hover:bg-gold/10"
                  >
                    Inquire via WhatsApp ✆
                  </a>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="border border-dashed border-line py-16 text-center text-steel">
            <div className="text-3xl mb-2">📖</div>
            <div>This lookbook is empty.</div>
          </div>
        )}
      </main>
    </div>
  );
}