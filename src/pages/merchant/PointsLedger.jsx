import { useEffect, useState } from 'react';
import { getData, subscribe, saveTierSettings, customers } from '../../lib/db.js';
import { cls, tierLabel } from '../../lib/util.js';
import { Toggle } from '../../components/ui.jsx';

// Points Ledger — Phase A (frontend shell)
// Design spec: docs/superpowers/specs/2026-08-27-points-ledger-phase-a-design.md
//
// Section 1 "Point Rules" is REAL — it reuses the exact same
// saveTierSettings()/getData() bridge as Settings.jsx (src/lib/db.js), just
// exposing two additional per-tier fields (anniversaryBonus,
// testimonialBonus) that convex/settings.ts already accepts. No new bridge
// functions were needed: saveTierSettings(tierKey, patch) generically
// spreads whatever keys are passed, and the full tier object is sent to
// api.settings.updateSettings on every save.
//
// Section 2 "Give Points" is UI-ONLY (Phase A) — the Submit button is
// disabled and wired to nothing. Real manual-award logic is Phase B.

const useDb = () => {
  const [, setV] = useState(0);
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  return getData();
};

const TIERS = ['global', 'silver', 'gold', 'platinum'];
const ROWS = [
  ['purchasePercent', 'Purchase points rule', 'points per 100', 'of order value'],
  ['birthdayBonus', 'Birthday bonus points', 'pts', 'on client birthday'],
  ['anniversaryBonus', 'Anniversary bonus points', 'pts', 'on client anniversary'],
  ['testimonialBonus', 'Testimonial bonus points', 'pts', 'per approved testimonial'],
];

const REASON_TYPES = ['Normal', 'Birthday', 'Anniversary', 'Testimonial'];

export default function PointsLedger() {
  const db = useDb();
  const [tier, setTier] = useState('global');
  const [saved, setSaved] = useState(false);

  const cfg = db.settings.tiers[tier];
  const on = tier === 'global' ? true : cfg?.on;

  const save = () => {
    saveTierSettings(tier, { on: on });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };
  const setVal = (key, val) => saveTierSettings(tier, { [key]: Number(val) || 0 });

  // Give Points — Phase A UI shell only, not wired to any mutation.
  const [giveQuery, setGiveQuery] = useState('');
  const [giveCustomerId, setGiveCustomerId] = useState('');
  const [giveReasonType, setGiveReasonType] = useState('Normal');
  const [giveAmount, setGiveAmount] = useState('');
  const [giveNote, setGiveNote] = useState('');
  const allCustomers = customers();
  const q = giveQuery.trim().toLowerCase();
  const filteredCustomers = q
    ? allCustomers.filter((c) => (c.name + ' ' + c.mobile).toLowerCase().includes(q))
    : allCustomers;

  return (
    <div className="space-y-10">
      <div>
        <div className="eyebrow mb-1">Points engine</div>
        <h1 className="luxe-title text-3xl">Points Ledger</h1>
      </div>

      <div className="grid lg:grid-cols-[1fr_380px] gap-8">
        {/* Point Rules — REAL, wired to getSettings/updateSettings */}
        <section>
          <div className="flex gap-2 mb-5">
            {TIERS.map((t) => (
              <button key={t} onClick={() => { setTier(t); setSaved(false); }} className={cls('px-4 py-2 text-[10px] tracking-wide2 uppercase border transition-colors', tier === t ? 'border-ink bg-ink text-white' : 'border-line text-steel hover:border-ink hover:text-ink')}>
                {t === 'global' ? 'Global default' : tierLabel(t)}
              </button>
            ))}
          </div>

          <div className="card divide-y divide-line">
            {ROWS.map(([key, label, unit, desc]) => (
              <div key={key} className="px-6 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium text-sm">{label}</div>
                  <div className="text-xs text-steel mt-0.5">{desc}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {tier !== 'global' && <Toggle on={on} onChange={() => saveTierSettings(tier, { on: !on })} />}
                  <div className="relative">
                    <input
                      className="input !w-24 text-right pr-7 disabled:opacity-40"
                      type="number"
                      value={cfg[key]}
                      disabled={tier !== 'global' && !on}
                      onChange={(e) => setVal(key, e.target.value)}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-steel">{unit === 'points per 100' ? 'pts/₹100' : 'pts'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-steel max-w-sm">The Global default applies to any rule left untuned; each tier can override with its own ON/OFF and points.</p>
            {tier !== 'global' && <button onClick={save} className="btn-ink">{saved ? '✓ Saved' : 'Save tier'}</button>}
          </div>
        </section>

        {/* Give Points — Phase A UI shell only, no mutation wired */}
        <section className="space-y-6">
          <div className="card p-6">
            <div className="eyebrow mb-1">Manual award</div>
            <h2 className="luxe-title text-lg mb-4">Give Points</h2>
            <div className="space-y-3">
              <div>
                <label className="label">Client</label>
                <input className="input mb-2" placeholder="Search name, mobile…" value={giveQuery} onChange={(e) => setGiveQuery(e.target.value)} />
                <select className="input" value={giveCustomerId} onChange={(e) => setGiveCustomerId(e.target.value)}>
                  <option value="">Select a client…</option>
                  {filteredCustomers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} · {c.mobile}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Reason type</label>
                  <select className="input" value={giveReasonType} onChange={(e) => setGiveReasonType(e.target.value)}>
                    {REASON_TYPES.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Points {`(+add / −deduct)`}</label>
                  <input className="input" type="number" value={giveAmount} onChange={(e) => setGiveAmount(e.target.value)} placeholder="e.g. 100" />
                </div>
              </div>
              <div>
                <label className="label">Note</label>
                <input className="input" value={giveNote} onChange={(e) => setGiveNote(e.target.value)} placeholder="e.g. goodwill credit" />
              </div>
              <button className="btn-gold w-full" disabled>Coming soon</button>
              <p className="text-[10px] tracking-wide2 uppercase text-steel">Manual point awards will be available in a future update.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
