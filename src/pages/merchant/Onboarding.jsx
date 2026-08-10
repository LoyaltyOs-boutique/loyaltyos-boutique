import { useState } from 'react';
import { Link } from 'react-router-dom';
import confetti from 'canvas-confetti';
import { onboardCustomer, waMessage, waDigits } from '../../lib/db.js';
import { COUNTRIES, BRAND } from '../../data/seed.js';

export default function Onboarding() {
  const [f, setF] = useState({ name: '', whatsapp: '', calling: '', birthday: '', anniversary: '', city: '', country: 'India', note: '' });
  const [result, setResult] = useState(null); // {user, magicLink}
  const [copied, setCopied] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = (e) => {
    e.preventDefault();
    if (!f.name.trim() || !f.whatsapp.trim()) return;
    const res = onboardCustomer(f);
    setResult(res);
    setCopied(false);
    confetti({ particleCount: 120, spread: 90, origin: { y: 0.3 }, colors: ['#C5A880', '#111111', '#E9DFCF'] });
  };

  const genUrl = (path) => `${location.origin}${path}`;
  const shareWa = result
    ? `https://wa.me/${waDigits(f.whatsapp || f.calling || BRAND.wa)}?text=${encodeURIComponent(waMessage(result.user, result.magicLink))}`
    : '#';

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="eyebrow mb-1">New client</div>
          <h1 className="luxe-title text-3xl">Client Onboarding</h1>
          <p className="text-sm text-steel mt-2">Add a client at the store (or send them the <Link to="/join" className="text-gold underline">client form</Link>) — we instantly mint their private magic link.</p>
          <button
            type="button"
            onClick={() => window.open('https://wa.me/?text=' + encodeURIComponent("Your personal boutique lookbook is ready - open your secure link: https://loyaltyos-boutique-three.vercel.app/join - no password needed"), '_blank', 'noopener,noreferrer')}
            className="mt-2 inline-flex items-center gap-2 text-[11px] tracking-luxe uppercase text-gold underline hover:text-ink transition-colors cursor-pointer"
          >
            Share the self-onboarding link
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Form */}
        <section className="card p-6">
          <div className="eyebrow mb-4">1 · Client details</div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label">Full name *</label>
              <input className="input" value={f.name} onChange={set('name')} placeholder="e.g. Sneha Das" required />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label">WhatsApp number *</label>
                <input className="input" inputMode="tel" value={f.whatsapp} onChange={set('whatsapp')} placeholder="+91 98…" required />
              </div>
              <div>
                <label className="label">Calling number</label>
                <input className="input" inputMode="tel" value={f.calling} onChange={set('calling')} placeholder="optional" />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Date of birth</label>
                <input className="input" type="date" value={f.birthday} onChange={set('birthday')} />
              </div>
              <div>
                <label className="label">Anniversary</label>
                <input className="input" type="date" value={f.anniversary} onChange={set('anniversary')} />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label">City</label>
                <input className="input" value={f.city} onChange={set('city')} placeholder="e.g. Kolkata" />
              </div>
              <div>
                <label className="label">Country</label>
                <select className="input" value={f.country} onChange={set('country')}>
                  {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">Staff note (optional)</label>
              <input className="input" value={f.note} onChange={set('note')} placeholder="e.g. prefers ivory & blushed tones" />
            </div>
            <button className="btn-ink w-full" type="submit">Generate magic link</button>
          </form>
        </section>

        {/* Result */}
        <section className="space-y-4">
          {!result ? (
            <div className="card border-2 border-dashed border-line p-6 flex flex-col items-center justify-center text-center h-full min-h-[220px]">
              <div className="text-3xl mb-3">🔗</div>
              <div className="text-sm text-steel">The client's unique magic link will appear here — share it on WhatsApp or copy it.</div>
              <div className="text-[10px] tracking-wide2 uppercase text-steel mt-2">or share the <Link to="/join" className="text-gold">client form</Link> instead</div>
            </div>
          ) : (
            <div className="card bg-ink text-white p-6 animate-fadeUp">
              <div className="eyebrow text-gold mb-2">2 · Magic link ready ✨</div>
              <div className="luxe-title text-2xl mb-1">{result.user.name}</div>
              <div className="text-[11px] text-white/60 uppercase tracking-wide2 mb-5">Silver tier · 0 pts · {result.user.location.country || 'India'}</div>
              <div className="bg-white/10 border border-white/15 px-4 py-3 text-xs break-all text-gold mb-4 select-all">{genUrl(result.magicLink)}</div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => { navigator.clipboard && navigator.clipboard.writeText(genUrl(result.magicLink)); setCopied(true); }} className="btn-gold !py-2 text-[10px]">
                  {copied ? '✓ Copied' : 'Copy link'}
                </button>
                <a href={shareWa} target="_blank" rel="noreferrer" className="btn-outline !border-white/30 !text-white hover:!text-ink !py-2 text-[10px] justify-center">
                  Send on WhatsApp ✆
                </a>
              </div>
              <a href={genUrl(result.magicLink)} target="_blank" rel="noreferrer" className="btn-ghost w-full mt-2 !border-transparent !text-gold text-[10px]">
                Preview their lookbook ↗
              </a>
              <button onClick={() => { setResult(null); setF({ name: '', whatsapp: '', calling: '', birthday: '', anniversary: '', city: '', country: 'India', note: '' }); }} className="btn-ghost w-full mt-2 !py-2 text-[10px] border-white/10 text-white/70 hover:text-ink">
                ＋ Onboard another client
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}