import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import confetti from 'canvas-confetti';
import { useConvex } from 'convex/react';
import { onboardCustomerRemote, waMessage, waDigits, getData, subscribe, customers } from '../../lib/db.js';
import { COUNTRIES, BRAND } from '../../data/seed.js';

const useDb = () => {
  const [, setV] = useState(0);
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  return getData();
};

/** Parse a free-text birthday/anniversary CSV cell into "M-D" (matches the single-add flow's format). */
const csvToMD = (v) => {
  if (!v) return '';
  const trimmed = v.trim();
  if (/^\d{1,2}-\d{1,2}$/.test(trimmed)) return trimmed; // already M-D
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}-${d.getDate()}`;
};

export default function Onboarding() {
  useDb(); // hydrate local customer cache so CSV preview can detect duplicates
  const convex = useConvex(); // shared client from <ConvexProvider> in main.jsx
  const [f, setF] = useState({ name: '', whatsapp: '', calling: '', birthday: '', anniversary: '', city: '', country: 'India', note: '' });
  const [result, setResult] = useState(null); // {user, magicLink}
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mobileError, setMobileError] = useState('');
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); if (k === 'whatsapp') setMobileError(''); };

  // Gate 1 — CSV bulk import (same parsing pattern as Catalogue.jsx's onCsv()).
  const [csvPreview, setCsvPreview] = useState(null); // {rows, toCreate, toSkip}
  const [bulkResult, setBulkResult] = useState(null); // {createdCount, skippedCount, skipped}
  const [bulkBusy, setBulkBusy] = useState(false);
  const csvRef = useRef(null);

  const onBulkCsv = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      const lines = String(r.result).split(/\r?\n/).filter((l) => l.trim());
      const dataLines = lines.length && /^name\s*,/i.test(lines[0]) ? lines.slice(1) : lines;
      const existingMobiles = new Set(customers().map((c) => c.mobile));
      const seen = new Set();
      const rows = dataLines.map((line) => {
        const [name = '', whatsapp = '', birthday = '', anniversary = '', city = '', country = ''] = line.split(',').map((c) => c.trim());
        const digits = waDigits(whatsapp);
        const invalid = !name || digits.length !== 10;
        const isDup = !invalid && (existingMobiles.has(digits) || seen.has(digits));
        if (!invalid) seen.add(digits);
        return { name, whatsapp, birthday, anniversary, city, country: country || 'India', invalid, isDup };
      }).filter((row) => row.name || row.whatsapp);
      const toCreate = rows.filter((row) => !row.invalid && !row.isDup).length;
      setCsvPreview({ rows, toCreate, toSkip: rows.length - toCreate });
      setBulkResult(null);
    };
    r.readAsText(file);
  };

  const confirmBulkImport = async () => {
    if (!csvPreview) return;
    setBulkBusy(true);
    try {
      const { api } = await import('../../../convex/_generated/api.js');
      const payload = csvPreview.rows
        .filter((row) => !row.invalid)
        .map((row) => ({
          name: row.name,
          whatsapp: row.whatsapp,
          ...(row.birthday ? { birthday: csvToMD(row.birthday) } : {}),
          ...(row.anniversary ? { anniversary: csvToMD(row.anniversary) } : {}),
          ...(row.city ? { city: row.city } : {}),
          ...(row.country ? { country: row.country } : {}),
        }));
      const res = await convex.mutation(api.customers.bulkCreateCustomers, { rows: payload });
      setBulkResult(res);
      setCsvPreview(null);
    } finally {
      setBulkBusy(false);
    }
  };

  // Magic-link fix: creates the client on Convex (ONE profile per WhatsApp
  // number) and mints a backend-issued 256-bit token, so the client's personal
  // module opens DIRECTLY from any device — no local-only validation.
  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim() || !f.whatsapp.trim()) return;
    setCreating(true);
    const res = await onboardCustomerRemote(f);
    setCreating(false);
    if (res.error) {
      // If existing customer (duplicate mobile), generate magic link and show it
          if (res.existingId) {
        const client = await import('../../lib/db.js').then(m => m.getConvex());
        if (client) {
          const { api } = await import('../../../convex/_generated/api.js');
          const linkRes = await client.mutation(api.auth.generateMagicToken, {
            mobile: waDigits(f.whatsapp || f.calling),
            baseUrl: location.origin,
          });
          if (linkRes && linkRes.user) {
            const { syncMagicLinkCustomer } = await import('../../lib/db.js');
            const synced = syncMagicLinkCustomer(linkRes.user, linkRes.token, linkRes.user.id, {
              location: { city: f.city || '', country: f.country || 'India' },
            });
            if (synced) {
              setResult({ user: synced, magicLink: `/lookbook?id=${linkRes.user.id}&token=${linkRes.token}` });
              setCopied(false);
              confetti({ particleCount: 120, spread: 90, origin: { y: 0.3 }, colors: ['#C5A880', '#111111', '#E9DFCF'] });
              return;
            }
          }
        }
        // Fallback to local
        const { createLocalCustomer } = await import('../../lib/db.js');
        const local = createLocalCustomer(f);
        setResult(local);
        setCopied(false);
        confetti({ particleCount: 120, spread: 90, origin: { y: 0.3 }, colors: ['#C5A880', '#111111', '#E9DFCF'] });
        return;
      }
      // Invalid number - show inline error
      setMobileError(res.error);
      return;
    }
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
                <input className={`input ${mobileError ? 'border-red-500' : ''}`} inputMode="tel" value={f.whatsapp} onChange={set('whatsapp')} placeholder="+91 98…" required />
                {mobileError && <div className="text-red-600 text-xs mt-1">{mobileError}</div>}
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
            <button className="btn-ink w-full" type="submit" disabled={creating}>
              {creating ? 'Minting secure link…' : 'Generate magic link'}
            </button>
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

      {/* Gate 1 — CSV bulk import */}
      <section className="card p-6">
        <div className="eyebrow mb-1">Bulk onboarding</div>
        <h3 className="luxe-title text-lg mb-3">Import clients from CSV</h3>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onBulkCsv(e.dataTransfer.files?.[0]); }}
          onClick={() => csvRef.current?.click()}
          className="border-2 border-dashed border-line hover:border-gold p-6 text-center cursor-pointer transition-colors"
        >
          <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onBulkCsv(e.target.files?.[0])} />
          <div className="text-2xl mb-2">📄</div>
          <div className="text-sm">Drag & drop a client CSV</div>
          <div className="text-xs text-steel mt-1">Columns: Name, WhatsApp, Birthday, Anniversary, City, Country</div>
        </div>

        {csvPreview && (
          <div className="mt-4">
            <div className="text-sm mb-2">
              <span className="text-gold font-medium">{csvPreview.toCreate} new customers</span>
              {csvPreview.toSkip > 0 && <span className="text-steel"> · {csvPreview.toSkip} skipped as duplicates/invalid</span>}
            </div>
            <div className="max-h-56 overflow-y-auto scroll-thin mb-3">
              <table className="tbl text-xs">
                <thead><tr><th>Name</th><th>WhatsApp</th><th>Status</th></tr></thead>
                <tbody>
                  {csvPreview.rows.map((row, i) => (
                    <tr key={i}>
                      <td>{row.name || '—'}</td>
                      <td>{row.whatsapp || '—'}</td>
                      <td className={row.invalid || row.isDup ? 'text-steel' : 'text-gold'}>
                        {row.invalid ? 'Invalid mobile' : row.isDup ? 'Duplicate' : 'Will be created'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <button onClick={confirmBulkImport} className="btn-ink flex-1" disabled={bulkBusy || csvPreview.toCreate === 0}>
                {bulkBusy ? 'Importing…' : `Confirm import (${csvPreview.toCreate})`}
              </button>
              <button onClick={() => setCsvPreview(null)} className="btn-ghost flex-1" disabled={bulkBusy}>Cancel</button>
            </div>
          </div>
        )}

        {bulkResult && (
          <div className="mt-4 text-sm border border-line bg-mist px-4 py-3">
            <span className="text-gold font-medium">{bulkResult.createdCount} customers created</span>
            {bulkResult.skippedCount > 0 && <span className="text-steel"> · {bulkResult.skippedCount} skipped</span>}
          </div>
        )}
      </section>
    </div>
  );
}