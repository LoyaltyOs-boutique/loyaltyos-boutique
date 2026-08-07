import { useEffect, useState } from 'react';
import { getData, subscribe, saveTierSettings, createTicket, getMerchantSession } from '../../lib/db.js';
import { cls, fmtDate, tierLabel } from '../../lib/util.js';
import { Toggle, Tag, Empty } from '../../components/ui.jsx';

const useDb = () => {
  const [, setV] = useState(0);
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  return getData();
};

const TIERS = ['global', 'silver', 'gold', 'platinum'];
const ROWS = [
  ['purchasePercent', 'Purchase points rule', 'points per 100', 'of order value'],
  ['birthdayBonus', 'Birthday bonus points', 'pts', 'on client birthday'],
  ['gmbPoints', 'GMB review points', 'pts', 'per Google review'],
  ['productReviewPoints', 'Product review points', 'pts', 'per product review'],
];

export default function Settings() {
  const db = useDb();
  const [tier, setTier] = useState('global');
  const [saved, setSaved] = useState(false);
  const [me] = useState(() => getMerchantSession());
  const [ticket, setTicket] = useState({ category: 'Bug', priority: 'Medium', message: '' });
  const [ticketSent, setTicketSent] = useState(false);

  const cfg = db.settings.tiers[tier];
  const on = tier === 'global' ? true : cfg?.on;

  const save = () => {
    saveTierSettings(tier, { on: on });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };
  const setVal = (key, val) => saveTierSettings(tier, { [key]: Number(val) || 0 });

  const submitTicket = () => {
    if (!ticket.message.trim()) return;
    createTicket({ ownerId: me?.id || 'owner', ...ticket });
    setTicket({ category: 'Bug', priority: 'Medium', message: '' });
    setTicketSent(true);
    setTimeout(() => setTicketSent(false), 2500);
  };

  return (
    <div className="space-y-10">
      <div>
        <div className="eyebrow mb-1">Centralized controls</div>
        <h1 className="luxe-title text-3xl">Settings</h1>
      </div>

      <div className="grid lg:grid-cols-[1fr_380px] gap-8">
        {/* Tier rules */}
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

        {/* Support tickets */}
        <section className="space-y-6">
          <div className="card p-6">
            <div className="eyebrow mb-1">Boutique support</div>
            <h2 className="luxe-title text-lg mb-4">File a ticket</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Category</label>
                  <select className="input" value={ticket.category} onChange={(e) => setTicket({ ...ticket, category: e.target.value })}>
                    {['Bug', 'Billing', 'Feature request', 'Training'].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Priority</label>
                  <select className="input" value={ticket.priority} onChange={(e) => setTicket({ ...ticket, priority: e.target.value })}>
                    {['Low', 'Medium', 'High', 'Urgent'].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Message</label>
                <textarea className="input min-h-[90px]" placeholder="Describe the issue or request…" value={ticket.message} onChange={(e) => setTicket({ ...ticket, message: e.target.value })} />
              </div>
              <button onClick={submitTicket} className="btn-gold w-full" disabled={!ticket.message.trim()}>Submit ticket</button>
              {ticketSent && <div className="text-sm text-gold animate-fadeUp">✓ Request logged with the LoyaltyOS support desk.</div>}
            </div>
          </div>

          <div className="card p-6">
            <div className="eyebrow mb-3">Your tickets</div>
            {db.tickets.length ? (
              <div className="space-y-3">
                {db.tickets.map((t) => (
                  <div key={t.id} className="border border-line px-4 py-3 text-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <Tag>{t.category}</Tag>
                      <span className={cls('text-[10px] tracking-wide2 uppercase', t.status === 'open' ? 'text-gold' : 'text-steel')}>{t.status}</span>
                      <span className="text-xs text-steel ml-auto">{fmtDate(t.createdAt)}</span>
                    </div>
                    <div className="text-xs text-steel mb-1">Priority · {t.priority}</div>
                    {t.message}
                  </div>
                ))}
              </div>
            ) : <Empty>No tickets filed yet.</Empty>}
          </div>
        </section>
      </div>
    </div>
  );
}
