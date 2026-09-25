import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import confetti from 'canvas-confetti';
import { onboardCustomerRemote, waMessage, waDigits, getData, subscribe, bulkCreateCustomers, checkMobilesStatusRemote } from '../../lib/db.js';
import { parseCsv, mapRows, validMobiles, buildPreview, SAMPLE_CSV } from '../../lib/csvImport.js';
import { COUNTRIES, BRAND } from '../../data/seed.js';

const useDb = () => {
  const [, setV] = useState(0);
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  return getData();
};

// 2026-09-23 CSV bulk onboarding design — date parsing (day-first DD-MM-YYYY
// etc.) now lives in src/lib/csvImport.js's parseDateToMD, used inside
// buildPreview() below. The old csvToMD (US-order `new Date()` parsing) is
// removed; buildPreview() already returns each row's birthday/anniversary
// as the stored "M-D" string.

// Skip-reason codes returned by the backend, mapped to merchant-readable text.
const SKIP_REASON_TEXT = {
  invalid_mobile: 'Invalid mobile',
  missing_name: 'Missing name',
  duplicate_in_file: 'Duplicate in file',
  duplicate_existing: 'Already a customer',
};

// Preview-row status codes (buildPreview) mapped to merchant-readable labels.
const STATUS_LABEL = {
  new: 'New',
  duplicate_in_file: 'Duplicate in file',
  existing: 'Already a customer',
  reactivate: 'Will be reactivated',
};

export default function Onboarding() {
  useDb(); // hydrate local customer cache so CSV preview can detect duplicates
  const [f, setF] = useState({ name: '', whatsapp: '', calling: '', birthday: '', anniversary: '', city: '', country: 'India', note: '', whatsapp_consent: false, vvip: false });
  const [result, setResult] = useState(null); // {user, magicLink}
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mobileError, setMobileError] = useState('');
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); if (k === 'whatsapp') setMobileError(''); };

  // Gate 1 — CSV bulk import (same parsing pattern as Catalogue.jsx's onCsv()).
  const [csvPreview, setCsvPreview] = useState(null); // {rows, toCreate, toReactivate, toSkip}
  const [bulkResult, setBulkResult] = useState(null); // {createdCount, skippedCount, skipped}
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState(''); // Task 1, Step 9.9 — surfaces a real bridge rejection instead of a silent reset
  const [checking, setChecking] = useState(false); // 2026-09-23 amendment — true while checkMobilesStatusRemote is in flight
  const csvRef = useRef(null);

  // 2026-09-23 amendment — the preview no longer trusts the browser's local
  // customer list (it never drops a customer soft-deleted elsewhere). It now
  // asks checkMobilesStatusRemote for real-time active/deleted status before
  // building the preview, so a reactivatable mobile shows correctly instead
  // of "Already a customer".
  const onBulkCsv = async (file) => {
    if (!file) return;
    setCsvPreview(null);
    setBulkResult(null);
    setBulkError('');
    const text = await file.text();
    const table = parseCsv(text);
    const rows = mapRows(table);
    setChecking(true);
    try {
      const status = await checkMobilesStatusRemote(validMobiles(rows));
      const preview = buildPreview(table, status);
      const toCreate = preview.filter((row) => row.status === 'new').length;
      const toReactivate = preview.filter((row) => row.status === 'reactivate').length;
      setCsvPreview({ rows: preview, toCreate, toReactivate, toSkip: preview.length - toCreate - toReactivate });
    } catch (err) {
      setBulkError(`Could not check existing customers: ${err?.message || 'unknown error'}. Please try again.`);
    } finally {
      setChecking(false);
    }
  };

  // "Download sample CSV" — builds the sample in-browser and triggers a
  // download via a temporary <a download> element (no server round trip).
  const downloadSampleCsv = (e) => {
    e.stopPropagation(); // sits inside the drop zone's clickable area
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '85-lansdowne-client-import-sample.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Task 1, Step 9.9 fix: this used to call convex.mutation(api.customers.bulkCreateCustomers, ...)
  // directly via useConvex(), bypassing db.js — so it never sent the merchant
  // session args that customers.ts's requireMerchantSession lock now requires,
  // and the resulting ArgumentValidationError was swallowed by a bare
  // try/finally with no catch. Now routed through the bulkCreateCustomers()
  // bridge (src/lib/db.js), which attaches the session and re-hydrates the
  // local customer cache on success; a real failure (offline/session/server
  // error) is caught here and shown inline instead of silently resetting.
  const confirmBulkImport = async () => {
    if (!csvPreview) return;
    setBulkBusy(true);
    setBulkError('');
    try {
      const payload = csvPreview.rows
        .filter((row) => row.status === 'new' || row.status === 'reactivate')
        .map((row) => ({
          name: row.name,
          whatsapp: row.whatsapp,
          ...(row.birthday ? { birthday: row.birthday } : {}),
          ...(row.anniversary ? { anniversary: row.anniversary } : {}),
          ...(row.city ? { city: row.city } : {}),
          ...(row.country ? { country: row.country } : {}),
          ...(row.whatsapp_consent ? { whatsapp_consent: true } : {}),
          ...(row.vvip ? { vvip: true } : {}),
        }));
      const res = await bulkCreateCustomers(payload);
      setBulkResult(res);
      setCsvPreview(null);
    } catch (err) {
      setBulkError(err?.message || 'Import failed — please try again.');
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
    const res = await onboardCustomerRemote(f, { asMerchant: true });
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
            onClick={() => window.open('https://wa.me/?text=' + encodeURIComponent(`Your personal boutique lookbook is ready - open your secure link: ${genUrl('/join')} - no password needed`), '_blank', 'noopener,noreferrer')}
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
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                id="vvip"
                checked={f.vvip || false}
                onChange={(e) => setF({ ...f, vvip: e.target.checked })}
                className="mt-1"
              />
              <label htmlFor="vvip" className="text-sm text-steel">
                Mark this customer as VVIP (for exclusive event invites).
              </label>
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
              <button onClick={() => { setResult(null); setF({ name: '', whatsapp: '', calling: '', birthday: '', anniversary: '', city: '', country: 'India', note: '', whatsapp_consent: false, vvip: false }); }} className="btn-ghost w-full mt-2 !py-2 text-[10px] border-white/10 text-white/70 hover:text-ink">
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
          <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { onBulkCsv(e.target.files?.[0]); e.target.value = ''; }} />
          <div className="text-2xl mb-2">📄</div>
          <div className="text-sm">Drag & drop a client CSV</div>
          <div className="text-xs text-steel mt-1">Columns: Name, WhatsApp, Birthday, Anniversary, City, Country, Consent, VVIP · Dates as DD-MM-YYYY</div>
          <div className="text-xs text-steel mt-1">Put Yes under Consent only if the client has agreed to receive WhatsApp messages.</div>
          <button
            type="button"
            onClick={downloadSampleCsv}
            className="mt-2 inline-flex items-center gap-2 text-[11px] tracking-luxe uppercase text-gold underline hover:text-ink transition-colors cursor-pointer"
          >
            Download sample CSV
          </button>
        </div>

        {checking && <div className="text-xs text-steel mt-3">Checking existing customers…</div>}
        {!checking && bulkError && !csvPreview && <div className="text-red-600 text-xs mt-2">{bulkError}</div>}

        {csvPreview && (
          <div className="mt-4">
            <div className="text-sm mb-2">
              <span className="text-gold font-medium">{csvPreview.toCreate} new · {csvPreview.toReactivate} to reactivate · {csvPreview.toSkip} skipped</span>
            </div>
            <div className="max-h-56 overflow-y-auto scroll-thin mb-3">
              <table className="tbl text-xs">
                <thead><tr><th>Name</th><th>WhatsApp</th><th>Consent</th><th>VVIP</th><th>Status</th></tr></thead>
                <tbody>
                  {csvPreview.rows.map((row, i) => (
                    <tr key={i}>
                      <td>{row.name || '—'}</td>
                      <td>{row.whatsapp || '—'}</td>
                      <td>{row.whatsapp_consent ? 'Yes' : 'No'}</td>
                      <td>{row.vvip ? 'Yes' : 'No'}</td>
                      <td className={row.status === 'new' || row.status === 'reactivate' ? 'text-gold' : 'text-steel'}>
                        {row.status === 'invalid'
                          ? `Invalid: ${row.warnings.find((w) => w === 'Missing name' || w === 'Invalid mobile') || 'Invalid'}`
                          : STATUS_LABEL[row.status] || row.status}
                        {row.warnings.filter((w) => w !== 'Missing name' && w !== 'Invalid mobile').map((w) => (
                          <div key={w} className="text-steel">{w}</div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <button onClick={confirmBulkImport} className="btn-ink flex-1" disabled={checking || bulkBusy || (csvPreview.toCreate + csvPreview.toReactivate) === 0}>
                {bulkBusy ? 'Importing…' : `Confirm import (${csvPreview.toCreate + csvPreview.toReactivate})`}
              </button>
              <button onClick={() => setCsvPreview(null)} className="btn-ghost flex-1" disabled={bulkBusy}>Cancel</button>
            </div>
            {bulkError && <div className="text-red-600 text-xs mt-2">{bulkError}</div>}
          </div>
        )}

        {bulkResult && bulkResult.ok === false && (
          <div className="text-red-600 text-xs mt-2">
            Import stopped: {bulkResult.error}. {bulkResult.partial?.createdCount || 0} customers were already created — importing the same file again is safe.
          </div>
        )}

        {bulkResult && (
          <div className="mt-4 text-sm border border-line bg-mist px-4 py-3">
            {(() => {
              const r = bulkResult.ok === false ? bulkResult.partial : bulkResult;
              const skippedList = r?.skipped || [];
              return (
                <>
                  <span className="text-gold font-medium">{r?.createdCount || 0} created · {r?.reactivatedCount || 0} reactivated · {r?.skippedCount || 0} skipped</span>
                  {skippedList.length > 0 && (
                    <div className="text-xs text-steel mt-2">
                      {skippedList.map((s, i) => (
                        <div key={i}>{s.name || s.whatsapp || '—'} — {SKIP_REASON_TEXT[s.reason] || s.reason}</div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </section>
    </div>
  );
}