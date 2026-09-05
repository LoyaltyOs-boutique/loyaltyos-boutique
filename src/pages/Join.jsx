import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import confetti from 'canvas-confetti';
import { waMessage, waDigits, customerById, syncMagicLinkCustomer } from '../lib/db.js';
import { COUNTRIES, BRAND } from '../data/seed.js';

const input = 'w-full border border-line bg-white px-3 py-3 text-sm outline-none focus:border-ink transition-colors placeholder:text-steel/50';

// Same ISO-date -> "M-D" conversion as db.js's private mdFromDate (not
// exported, so mirrored here 1:1) — createCustomer expects "M-D", but the
// <input type="date"> fields on this form give an ISO "YYYY-MM-DD" string.
const mdFromDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}-${d.getDate()}`;
};

export default function Join() {
  const [params] = useSearchParams();
  // Improvement 3b: when the customer clicks a magic link / onboarding link the
  // merchant sent, Lookbook redirects here with id/token preserved in the query.
  // The standard onboarding form still works; we prefill when we can.
  const fromLink = Boolean(params.get('id') || params.get('token'));
  const [f, setF] = useState({ name: '', whatsapp: '', calling: '', birthday: '', anniversary: '', city: '', country: 'India', whatsapp_consent: false });
  const [result, setResult] = useState(null); // {user, magicLink}
  const [copied, setCopied] = useState(false);
  const [mobileError, setMobileError] = useState('');
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); if (k === 'whatsapp') setMobileError(''); };

  // Prefill known fields when the link carries a customer id we already know.
  useEffect(() => {
    const id = params.get('id');
    if (!id) return;
    const existing = customerById(id);
    if (!existing) return;
    setF((prev) => ({
      ...prev,
      name: prev.name || existing.name || '',
      whatsapp: prev.whatsapp || existing.mobile || existing.whatsapp || '',
    }));
  }, [params]);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim() || !f.whatsapp.trim()) return;

    // Validate 10 digits locally
    const mobile = waDigits(f.whatsapp);
    if (mobile.length !== 10) {
      setMobileError("Please enter a valid 10-digit mobile number");
      return;
    }

    // SECURITY FIX (2026-09-05): call createCustomer directly instead of the
    // old db.js onboardCustomerRemote -> generateMagicTokenSelf two-call
    // chain. createCustomer now issues the magic link for a brand-new
    // signup in this SAME call (see convex/customers.ts) — no separate
    // self-service token call needed. On a duplicate mobile it now returns
    // only a minimal { alreadyRegistered: true } signal, never the existing
    // customer's magic_token/measurements/staff_notes (closes the anonymous
    // account-takeover + data-leak hole the old flow had).
    try {
      const client = await import('../lib/db.js').then((m) => m.getConvex());
      const { api } = await import('../../convex/_generated/api.js');
      if (!client) {
        setMobileError('Unable to connect — please try again.');
        return;
      }

      const created = await client.mutation(api.customers.createCustomer, {
        mobile,
        name: f.name.trim(),
        ...(mdFromDate(f.birthday) ? { birthday: mdFromDate(f.birthday) } : {}),
        ...(mdFromDate(f.anniversary) ? { anniversary: mdFromDate(f.anniversary) } : {}),
        ...(f.whatsapp_consent ? { whatsapp_consent: true } : {}),
        baseUrl: location.origin,
      });

      if (!created || !created.ok) {
        // Invalid mobile (createCustomer's own 10-digit check) — show inline error.
        setMobileError((created && created.error) || 'Please enter a valid 10-digit mobile number');
        return;
      }

      if (created.alreadyRegistered) {
        // Duplicate mobile — no token/profile data was returned (by design).
        // We deliberately do NOT mint a link for someone else's number from
        // an anonymous form submit; ask them to use their existing link instead.
        setMobileError('This WhatsApp number is already registered. Please use the link we sent you earlier, or contact the boutique to have it resent.');
        return;
      }

      // Brand-new signup — createCustomer already issued a working magic link.
      const synced = syncMagicLinkCustomer(created.customer, created.token, created.id, {
        location: { city: f.city || '', country: f.country || 'India' },
      });
      if (!synced) {
        setMobileError('Something went wrong — please try again.');
        return;
      }

      setResult({ user: synced, magicLink: `/lookbook?id=${created.id}&token=${created.token}` });
      confetti({ particleCount: 150, spread: 100, origin: { y: 0.3 }, colors: ['#C5A880', '#111111', '#E9DFCF', '#F5EFE6'] });
    } catch {
      setMobileError('Something went wrong — please try again.');
    }
  };

  const link = result ? `${location.origin}${result.magicLink}` : '';
  const dispatchWa = result
    ? `https://wa.me/${waDigits(f.whatsapp || f.calling)}?text=${encodeURIComponent(waMessage(result.user, result.magicLink))}`
    : '#';

  if (result) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-md animate-fadeUp text-center">
          <img src={BRAND.logo} alt="85 Lansdowne" className="h-9 object-contain mx-auto mb-6" />
          <div className="h-px w-16 bg-gold mx-auto mb-6" />
          <div className="eyebrow text-gold mb-3">You're on the list ✨</div>
          <h1 className="luxe-title text-3xl mb-3">Welcome, {result.user.name.split(' ')[0]}.</h1>
          <p className="text-sm text-steel mb-6">
            Your private 85 Lansdowne link is ready. Open it now — or tap below and we'll send it to your WhatsApp so you never lose it.
          </p>
          <div className="card bg-ink text-white px-6 py-5 mb-4">
            <div className="text-[10px] tracking-luxe uppercase text-gold mb-2">Your magic link</div>
            <div className="text-xs break-all text-gold mb-4 select-all">{link}</div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { navigator.clipboard && navigator.clipboard.writeText(link); setCopied(true); }} className="btn-gold !py-2 text-[10px]">
                {copied ? '✓ Copied' : 'Copy link'}
              </button>
              <a href={dispatchWa} target="_blank" rel="noreferrer" className="btn-outline !border-white/30 !text-white hover:!text-ink !py-2 text-[10px] justify-center">
                Send to my WhatsApp ✆
              </a>
            </div>
          </div>
          <a href={link} className="btn-ink w-full justify-center">Open my lookbook →</a>
          <Link to="/login" className="block mt-6 text-[10px] tracking-wide2 uppercase text-steel hover:text-ink">Boutique owner? Sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper flex items-start justify-center px-5 py-12">
      <div className="w-full max-w-lg animate-fadeUp">
        <div className="text-center mb-8">
          <img src={BRAND.logo} alt="85 Lansdowne" className="h-9 object-contain mx-auto mb-4" />
          <div className="eyebrow mb-2">Private client access · 85 Lansdowne</div>
          <h1 className="luxe-title text-3xl">{fromLink ? 'Complete your profile.' : 'Join our lookbook.'}</h1>
          <p className="text-sm text-steel mt-3">
            {fromLink
              ? 'Welcome — just a moment to set up your private boutique profile, then your lookbook will open instantly.'
              : "Fill this once and we'll instantly create your personal boutique link — no password needed, ever."}
          </p>
        </div>
        <form onSubmit={submit} className="card p-6 space-y-4">
          <div>
            <label className="label">Full name *</label>
            <input className={input} value={f.name} onChange={set('name')} placeholder="Your full name" required />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">WhatsApp number *</label>
              <input className={`${input} ${mobileError ? 'border-red-500' : ''}`} inputMode="tel" value={f.whatsapp} onChange={set('whatsapp')} placeholder="+91 98…" required />
              {mobileError && <div className="text-red-600 text-xs mt-1">{mobileError}</div>}
            </div>
            <div>
              <label className="label">Calling number</label>
              <input className={input} inputMode="tel" value={f.calling} onChange={set('calling')} placeholder="optional" />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Date of birth</label>
              <input className={input} type="date" value={f.birthday} onChange={set('birthday')} />
            </div>
            <div>
              <label className="label">Anniversary</label>
              <input className={input} type="date" value={f.anniversary} onChange={set('anniversary')} />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">City</label>
              <input className={input} value={f.city} onChange={set('city')} placeholder="Your city" />
            </div>
            <div>
              <label className="label">Country</label>
              <select className={input} value={f.country} onChange={set('country')}>
                {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="whatsapp_consent"
              checked={f.whatsapp_consent || false}
              onChange={(e) => setF({ ...f, whatsapp_consent: e.target.checked })}
              className="mt-1"
            />
            <label htmlFor="whatsapp_consent" className="text-sm text-steel">
              I agree to receive WhatsApp updates (birthday/anniversary wishes and offers) from 85 Lansdowne.
            </label>
          </div>
          <button className="btn-ink w-full !py-3">Create my magic link ✨</button>
          <p className="text-center text-[10px] tracking-wide2 uppercase text-steel">Your details are private to the boutique</p>
        </form>
      </div>
    </div>
  );
}
