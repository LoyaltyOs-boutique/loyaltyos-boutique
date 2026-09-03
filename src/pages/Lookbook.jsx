import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import confetti from 'canvas-confetti';
import { BRAND } from '../data/seed.js';
import {
  validateLookbook, getCustomerSession, saveCustomerSession, clearCustomerSession,
  allCatalogue, likeItem, checkout, submitGmbReview, submitProductReview,
  getData, subscribe, customerLedger,
  validateMagicToken, syncMagicLinkCustomer,
} from '../lib/db.js';
import { inr, inrFull, first, tierLabel, fmtDate, cls } from '../lib/util.js';
import AccessDenied from './AccessDenied.jsx';
import { Stars } from '../components/ui.jsx';

const useDb = () => {
  const [, setV] = useState(0);
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  return getData();
};
const goldBurst = () => {
  confetti({
    particleCount: 160, spread: 90, origin: { y: 0.35 },
    colors: ['#C5A880', '#E9DFCF', '#F5EFE6', '#111111'], scalar: 0.9, ticks: 220,
  });
  confetti({ particleCount: 40, angle: 60, spread: 55, origin: { x: 0 }, colors: ['#C5A880', '#111111'] });
  confetti({ particleCount: 40, angle: 120, spread: 55, origin: { x: 1 }, colors: ['#C5A880', '#111111'] });
};

export default function Lookbook() {
  const [params] = useSearchParams();
  const db = useDb();
  const [customer, setCustomer] = useState(null);
  const [denied, setDenied] = useState(false);
  const [cart, setCart] = useState([]);
  const [view, setView] = useState('feed'); // feed | cart | success
  const [lastOrder, setLastOrder] = useState(null);
  const [gmbOpen, setGmbOpen] = useState(false);
  const [gmbStars, setGmbStars] = useState(0);
  const [gmbText, setGmbText] = useState('');
  const [reviewing, setReviewing] = useState(null); // {item}
  const [reviewStars, setReviewStars] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [points, setPoints] = useState(0);
  const [payMethod, setPayMethod] = useState('online');
  const [likeAnim, setLikeAnim] = useState(null);

  const navigate = useNavigate();

  // Authenticate via magic link (query) or 180-day session
  useEffect(() => {
    const id = params.get('id');
    const token = params.get('token');

    // Improvement 3b: Redirect to onboarding form if params are present but invalid/incomplete
    if (id && !token) {
      navigate(`/join?id=${id}`, { replace: true });
      return;
    }
    if (id && token) {
      const u = validateLookbook(id, token);
      if (u) { 
        saveCustomerSession(id, token); 
        setCustomer(u); 
        return; 
      }
      
      // Fallback: Validate against Convex for merchant-created clients (local-only
      // check above may fail because the client exists in the Convex users table,
      // not in this browser's localStorage). Convex validateMagicToken checks the
      // 256-bit token + 180-day lifespan — on success we sync the backend customer
      // into local state so likes/checkout/ledger target the right user, then open
      // the module DIRECTLY (NO /join redirect).
      validateMagicToken(id, token, Date.now()).then((res) => {
        if (res && res.user) {
          const synced = syncMagicLinkCustomer(res.user, token, res.user.id);
          saveCustomerSession(id, token);
          setCustomer(synced || res.user);
        } else {
          // Truly invalid token (id doesn't exist in Convex OR local) → join form
          navigate(`/join?id=${id}&token=${token}`, { replace: true });
        }
      });
      return;
    }

    // No params: check existing session
    const s = getCustomerSession();
    if (s) {
      const u = validateLookbook(s.id, s.token);
      if (u) {
        setCustomer(u);
        // Background refresh: local cache may be stale (e.g. points credited via
        // a review approval since this browser's last visit). Re-validate against
        // Convex in the background and merge in the live data once resolved —
        // mirrors the first-visit fallback pattern above (lines 76-85).
        validateMagicToken(s.id, s.token, Date.now()).then((res) => {
          if (res && res.user) {
            const synced = syncMagicLinkCustomer(res.user, s.token, res.user.id);
            if (synced) setCustomer(synced);
          }
        });
        return;
      }
    }

    // No params and no valid session: show invitation page (public landing)
    setDenied(true);
  }, [params, navigate]);

  const catalogue = useMemo(() => allCatalogue(), [db]);
  const reviewedItemIds = useMemo(
    () => customer ? db.reviews.filter((r) => r.userId === customer.id && r.platform === 'in-app').map((r) => r.catalogueItemId) : [],
    [db, customer]
  );
  const myOrders = useMemo(() => customer ? customerLedger(customer.id).filter((e) => e.kind === 'order') : [], [db, customer]);

  if (denied) return <AccessDenied />;
  if (!customer) return <div className="min-h-screen flex items-center justify-center"><div className="eyebrow">Verifying your secure link…</div></div>;

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const maxRedeem = Math.min(customer.points, subtotal);
  const discount = Math.min(points, subtotal);
  const finalTotal = subtotal - discount;
  const waLink = (item) => {
    const namePart = customer.name ? `, I'm ${customer.name}` : '';
    return `https://wa.me/${BRAND.wa}?text=${encodeURIComponent(
      `Hi${namePart}! I'm interested in the ${item.title} from 85 Lansdowne.`
    )}`;
  };

  const addToCart = (item) => {
    setCart((c) => {
      const ex = c.find((i) => i.id === item.id);
      return ex ? c.map((i) => (i.id === item.id ? { ...i, qty: i.qty + 1 } : i)) : [...c, { id: item.id, title: item.title, price: item.price, image_url: item.image_url, qty: 1 }];
    });
  };
  const setQty = (id, q) => setCart((c) => c.map((i) => (i.id === id ? { ...i, qty: Math.max(0, q) } : i)).filter((i) => i.qty > 0));
  const doCheckout = (method) => {
    const order = checkout({ userId: customer.id, items: cart, pointsApplied: discount, paymentMethod: method });
    setCart([]); setCheckoutOpen(false); setPayOpen(false); setPoints(0); setLastOrder(order); setView('success');
    goldBurst();
  };

  const submitGmb = () => {
    if (gmbStars < 1) return;
    const { bonus } = submitGmbReview(customer.id, gmbStars, gmbText.trim());
    setGmbOpen(false); setGmbStars(0); setGmbText('');
    goldBurst();
    setTimeout(() => alert(`✨ Thank you! Your review is now with our boutique — ${bonus} points on the way once approved.`), 250);
  };
  const submitProductRev = () => {
    if (!reviewing || reviewStars < 1) return;
    const { bonus } = submitProductReview(customer.id, reviewing.id, reviewStars, reviewText.trim());
    setReviewing(null); setReviewStars(0); setReviewText('');
    goldBurst();
    setTimeout(() => alert(`✨ Thank you! Your review is pending approval — ${bonus} points on the way once approved.`), 250);
  };

  const reviewableItems = myOrders.flatMap((o) => o.items || []).filter((i) => !reviewedItemIds.includes(i.catalogueItemId));
  const chat = customer.chat || [];

  return (
    <div className="min-h-screen bg-paper">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-line">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
          <img src={BRAND.logo} alt="85 Lansdowne" className="h-9 object-contain" />
          <button onClick={() => setView(view === 'cart' ? 'feed' : 'cart')} className="relative btn-outline !py-1.5">
            Bag {cart.length > 0 && <span className="absolute -top-1.5 -right-1.5 bg-gold text-white text-[10px] h-5 w-5 flex items-center justify-center">{cart.reduce((s, i) => s + i.qty, 0)}</span>}
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 pb-24">
        {view === 'feed' && (
          <>
            {/* Welcome + gold card */}
            <section className="flex flex-col md:flex-row md:items-end justify-between gap-6 py-10">
              <div>
                <div className="eyebrow mb-2">Your private boutique</div>
                <h1 className="luxe-title text-4xl md:text-5xl">Namaste, {first(customer.name)}</h1>
                <p className="text-steel mt-3 max-w-md text-sm leading-relaxed">
                  Curated pieces from the 85 Lansdowne atelier — reserved for you. Tap ♥ on anything you love.
                </p>
              </div>
              <div className="card bg-ink text-white px-7 py-6 w-full md:w-80 animate-goldPulse">
                <div className="text-[10px] tracking-luxe uppercase text-gold">Membership</div>
                <div className="luxe-title text-4xl mt-1 text-gold">{inrFull(customer.points)}</div>
                <div className="text-[11px] tracking-wide2 uppercase text-white/60 mt-1">active points</div>
                <div className="mt-4 flex items-center justify-between border-t border-white/15 pt-3">
                  <span className="text-[11px] tracking-wide2 uppercase text-white/60">Tier</span>
                  <span className="text-gold text-xs tracking-wide2 uppercase">{tierLabel(customer.tier)}</span>
                </div>
              </div>
            </section>

            {/* Google review banner */}
            <button onClick={() => setGmbOpen(true)} className="card w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-5 hover:border-gold transition-colors cursor-pointer mb-10">
              <div className="text-left">
                <div className="eyebrow mb-1 text-gold">★ ★ ★ ★ ★ · Google</div>
                <div className="font-medium">Post a feedback on our Google page and earn <span className="text-gold">500 bonus points!</span></div>
              </div>
              <span className="btn-gold !py-2">Write review</span>
            </button>

            {/* Lookbook grid */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
              {catalogue.map((item) => (
                <article key={item.id} className="animate-fadeUp group">
                  <div className="relative bg-mist overflow-hidden border border-line">
                    <img src={item.image_url} alt={item.title} loading="lazy" className="aspect-[3/4] w-full object-cover transition-transform duration-500 group-hover:scale-105" />
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
                    <div className="eyebrow text-[9px] mb-1">85 Lansdowne Atelier</div>
                    <h3 className="luxe-title text-lg leading-snug">{item.title}</h3>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-sm font-medium">{inr(item.price)}</span>
                      <button onClick={() => addToCart(item)} className="btn-outline !py-1.5 !px-3 text-[9px]">Add to bag</button>
                    </div>
                    <a href={waLink(item)} target="_blank" rel="noreferrer" className="btn-ghost w-full mt-3 !py-2 text-[9px] border-gold/50 text-gold hover:border-gold">
                      Inquire via WhatsApp ✆
                    </a>
                  </div>
                </article>
              ))}
            </div>

            {/* Product review block */}
            <section className="mt-16">
              <div className="eyebrow mb-1">Earn more points</div>
              <h2 className="luxe-title text-2xl mb-5">Review your past pieces</h2>
              {reviewableItems.length === 0 ? (
                <p className="text-sm text-steel">No pending product reviews — thank you! 🖤</p>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {reviewableItems.map((i) => (
                    <div key={i.catalogueItemId} className="card p-4 flex items-center gap-4">
                      <img src={catalogue.find((c) => c.id === i.catalogueItemId)?.image_url || ''} className="h-16 w-14 object-cover border border-line" alt="" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{i.title}</div>
                        <div className="text-xs text-steel mt-1">{inr(i.price)}</div>
                        <button onClick={() => { setReviewing({ id: i.catalogueItemId, title: i.title }); setReviewStars(0); setReviewText(''); }} className="btn-outline !py-1 !px-3 text-[9px] mt-2">
                          Write review
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Chat history from boutique */}
            {chat.length > 0 && (
              <section className="mt-16 border-t border-line pt-10">
                <div className="eyebrow mb-1">From our atelier</div>
                <h2 className="luxe-title text-2xl mb-5">Messages from 85 Lansdowne</h2>
                <div className="space-y-3 max-w-2xl">
                  {chat.slice(0, 6).map((m) => (
                    <div key={m.id} className="bg-mist border border-line px-4 py-3 text-sm">
                      <div className="flex justify-between mb-1"><span className="text-gold text-[10px] tracking-wide2 uppercase">{m.from}</span><span className="text-steel text-xs">{new Date(m.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></div>
                      {m.text}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {view === 'cart' && (
          <section className="py-10">
            <h1 className="luxe-title text-3xl mb-6">Your bag</h1>
            {cart.length === 0 ? (
              <div className="border border-dashed border-line py-16 text-center text-steel">
                <div className="text-3xl mb-2">🛍</div>Your bag is empty.
                <button onClick={() => setView('feed')} className="btn-ink mt-5">Return to lookbook</button>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {cart.map((i) => (
                    <div key={i.id} className="card p-4 flex items-center gap-4">
                      <img src={i.image_url} alt="" className="h-20 w-16 object-cover border border-line" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{i.title}</div>
                        <div className="text-sm text-steel mt-1">{inr(i.price)} × {i.qty}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setQty(i.id, i.qty - 1)} className="btn-ghost !px-3 !py-1">−</button>
                        <span className="w-6 text-center">{i.qty}</span>
                        <button onClick={() => setQty(i.id, i.qty + 1)} className="btn-ghost !px-3 !py-1">+</button>
                      </div>
                      <div className="w-24 text-right font-medium">{inr(i.price * i.qty)}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-6 max-w-md ml-auto">
                  <span className="eyebrow">Subtotal</span>
                  <span className="luxe-title text-2xl">{inr(subtotal)}</span>
                </div>
                <div className="flex justify-end mt-4 gap-3">
                  <button onClick={() => setView('feed')} className="btn-ghost">Continue shopping</button>
                  <button onClick={() => { setPoints(0); setPayMethod('online'); setCheckoutOpen(true); }} className="btn-ink">Checkout</button>
                </div>
              </>
            )}
          </section>
        )}

        {view === 'success' && lastOrder && (
          <section className="py-16 max-w-lg mx-auto text-center">
            <div className="text-5xl mb-4">✨</div>
            <div className="eyebrow mb-2">85 Lansdowne · Order confirmed</div>
            <h1 className="luxe-title text-3xl mb-3">{lastOrder.paymentMethod === 'online' ? 'Payment successful' : 'Reserved in store'}</h1>
            <p className="text-steel text-sm mb-6">Final total <span className="text-ink font-medium">{inr(lastOrder.finalTotal)}</span> · You earned <span className="text-gold font-medium">+{lastOrder.pointsEarned}</span> points.</p>
            <div className="card px-6 py-5 text-left text-sm">
              {lastOrder.items.map((i) => (
                <div key={i.catalogueItemId} className="flex justify-between py-2 border-b border-line last:border-0"><span>{i.title}</span><span>{inr(i.price)}</span></div>
              ))}
            </div>
            {lastOrder.paymentMethod === 'online' && <p className="text-xs text-steel mt-4">Razorpay · Order ID {lastOrder.id.slice(0, 8).toUpperCase()}</p>}
            <button onClick={() => { setView('feed'); }} className="btn-ink mt-8">Back to lookbook</button>
          </section>
        )}
      </main>

      {/* Checkout modal */}
      {checkoutOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 overflow-y-auto" onClick={() => setCheckoutOpen(false)}>
          <div className="card bg-white w-full max-w-md my-6 animate-fadeUp" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h3 className="luxe-title text-lg">Checkout</h3>
              <button onClick={() => setCheckoutOpen(false)} className="text-steel hover:text-ink text-xl">×</button>
            </div>
            <div className="p-6 space-y-5">
              <div className="flex justify-between text-sm border-b border-line pb-3"><span className="text-steel">Subtotal</span><span>{inr(subtotal)}</span></div>
              <div>
                <div className="flex justify-between text-sm mb-2"><span className="text-steel">Redeem loyalty points</span><span className="text-gold font-medium">{inrFull(points)} pts = {inr(discount)} off</span></div>
                <input type="range" min="0" max={maxRedeem} value={points} onChange={(e) => setPoints(Number(e.target.value))} className="w-full accent-[#C5A880]" />
                <div className="flex justify-between text-[10px] tracking-wide2 uppercase text-steel mt-1"><span>0</span><span>Available {inrFull(maxRedeem)}</span></div>
              </div>
              <div className="flex justify-between text-sm border-b border-line pb-3"><span className="text-steel">Points discount</span><span className="text-gold">−{inr(discount)}</span></div>
              <div className="flex justify-between text-sm font-medium"><span>Final total</span><span className="luxe-title text-xl">{inr(finalTotal)}</span></div>
              <div className="space-y-2">
                <button onClick={() => setPayMethod('online')} className={cls('w-full border px-4 py-3 text-left text-sm', payMethod === 'online' ? 'border-ink bg-mist' : 'border-line hover:border-ink')}>
                  <div className="font-medium">Pay Online <span className="text-[9px] tracking-wide2 uppercase text-steel">· Razorpay</span></div>
                  <div className="text-xs text-steel mt-0.5">Cards · UPI · NetBanking</div>
                </button>
                <button onClick={() => setPayMethod('offline')} className={cls('w-full border px-4 py-3 text-left text-sm', payMethod === 'offline' ? 'border-ink bg-mist' : 'border-line hover:border-ink')}>
                  <div className="font-medium">Pay Offline & Reserve in Store</div>
                  <div className="text-xs text-steel mt-0.5">Cash / card swipe at the boutique</div>
                </button>
              </div>
              <button
                onClick={() => (payMethod === 'online' ? setPayOpen(true) : doCheckout('offline'))}
                className="btn-ink w-full"
              >
                {payMethod === 'online' ? `Pay ${inr(finalTotal)} online` : `Reserve & pay at store`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Simulated Razorpay modal */}
      {payOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/40 p-4 overflow-y-auto" onClick={() => !paying && setPayOpen(false)}>
          <div className="w-full max-w-sm my-8 bg-white animate-fadeUp" onClick={(e) => e.stopPropagation()}>
            <div className="bg-[#3395FF] text-white px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2"><span className="text-lg">🔵</span><span className="font-medium tracking-wide">Razorpay</span></div>
              <span className="text-xs opacity-80">Trusted checkout</span>
            </div>
            <div className="p-5">
              <div className="flex justify-between items-center border-b border-line pb-4 mb-4">
                <div><div className="text-[10px] tracking-wide2 uppercase text-steel">85 Lansdowne</div><div className="font-medium text-sm">LoyaltyOS Order</div></div>
                <div className="luxe-title text-xl">{inr(finalTotal)}</div>
              </div>
              <div className="text-[10px] tracking-wide2 uppercase text-steel mb-2">Pay using</div>
              <div className="flex gap-2 mb-4">
                {['Card', 'UPI', 'NetBanking', 'Wallet'].map((m, i) => (
                  <span key={m} className={cls('flex-1 border py-2 text-center text-xs', i === 0 ? 'border-ink bg-mist font-medium' : 'border-line text-steel')}>{m}</span>
                ))}
              </div>
              <label className="label">Card number</label>
              <input className="input mb-3" placeholder="4242 4242 4242 4242" readOnly />
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div><label className="label">Expiry</label><input className="input" placeholder="MM / YY" readOnly /></div>
                <div><label className="label">CVV</label><input className="input" placeholder="•••" readOnly /></div>
              </div>
              <button onClick={() => { setPaying(true); setTimeout(() => { setPaying(false); doCheckout('online'); }, 1400); }} className="btn-ink w-full" disabled={paying}>
                {paying ? 'Processing payment…' : `Pay ${inr(finalTotal)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Google review modal */}
      {gmbOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 overflow-y-auto" onClick={() => setGmbOpen(false)}>
          <div className="card bg-white w-full max-w-md my-6 animate-fadeUp" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-line px-6 py-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-[#F4B400] flex items-center justify-center text-white font-bold">G</div>
              <div><div className="font-medium text-sm">Google Business Review</div><div className="text-xs text-steel">85 Lansdowne · Kolkata</div></div>
              <button onClick={() => setGmbOpen(false)} className="ml-auto text-steel hover:text-ink text-xl">×</button>
            </div>
            <div className="p-6">
              <div className="eyebrow mb-3">How was your experience?</div>
              <Stars value={gmbStars} onChange={setGmbStars} size={30} />
              <textarea className="input mt-4 min-h-[110px]" placeholder="Share your experience at 85 Lansdowne…" value={gmbText} onChange={(e) => setGmbText(e.target.value)} />
              <div className="flex items-center justify-between mt-4">
                <span className="text-xs text-gold font-medium">+500 points on submit</span>
                <button onClick={submitGmb} className="btn-gold" disabled={gmbStars < 1}>Submit to Google</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Product review modal */}
      {reviewing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 overflow-y-auto" onClick={() => setReviewing(null)}>
          <div className="card bg-white w-full max-w-md my-6 animate-fadeUp" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h3 className="luxe-title text-lg">Review · {reviewing.title}</h3>
              <button onClick={() => setReviewing(null)} className="text-steel hover:text-ink text-xl">×</button>
            </div>
            <div className="p-6">
              <div className="eyebrow mb-3">Your rating</div>
              <Stars value={reviewStars} onChange={setReviewStars} size={26} />
              <textarea className="input mt-4 min-h-[100px]" placeholder="How does it fit? The fabric, the drape…" value={reviewText} onChange={(e) => setReviewText(e.target.value)} />
              <div className="flex items-center justify-between mt-4">
                <span className="text-xs text-gold font-medium">+150 points on submit</span>
                <button onClick={submitProductRev} className="btn-gold" disabled={reviewStars < 1}>Submit review</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
