import { useEffect, useState } from 'react';
import { getData, subscribe, createTicket, getMerchantSession } from '../../lib/db.js';
import { cls, fmtDate } from '../../lib/util.js';
import { Tag, Empty } from '../../components/ui.jsx';

const useDb = () => {
  const [, setV] = useState(0);
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  return getData();
};

export default function Settings() {
  const db = useDb();
  const [me] = useState(() => getMerchantSession());
  const [ticket, setTicket] = useState({ category: 'Bug', priority: 'Medium', message: '' });
  const [ticketSent, setTicketSent] = useState(false);

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

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Support tickets */}
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
      </div>
    </div>
  );
}
