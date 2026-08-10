import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getData, subscribe, customers, customerLedger, adjustPoints, addStaffNote,
  pendingGmbReviews, setReviewStatus, waMessage, waDigits,
} from '../../lib/db.js';
import { inr, fmtDate, parseMD, tierLabel, cls } from '../../lib/util.js';
import { Modal, TierBadge, Tag, Stars, Empty } from '../../components/ui.jsx';

const useDb = () => {
  const [, setV] = useState(0);
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  return getData();
};
const PAGE = 6;

export default function Customers() {
  const db = useDb();
  const location = useLocation();
  const [q, setQ] = useState(location.state?.q || '');
  const [filter, setFilter] = useState(location.state?.tab === 'reviews' ? 'reviews' : 'all');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('basic');
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState(null);
  const waToken = (c) => ({ wa: waDigits(c.whatsapp || c.mobile), m: `/lookbook?id=${c.id}&token=${c.magic_token}` });
  const magicUrl = (c) => `${window.location.origin}${waToken(c).m}`;
  const copyLink = (c) => { if (navigator.clipboard) navigator.clipboard.writeText(magicUrl(c)); setCopiedId(c.id); setTimeout(() => setCopiedId(null), 1600); };
  const openLookbook = (c) => {
    if (!c.magic_token) { alert('Generate magic link first'); return; }
    window.open(magicUrl(c), '_blank', 'noopener,noreferrer');
  };
  const shareWa = (c) => `https://wa.me/${waToken(c).wa}?text=${encodeURIComponent(waMessage(c, waToken(c).m))}`;

  const list = useMemo(() => {
    let l = customers();
    const query = q.trim().toLowerCase();
    if (filter === 'birthday') l = l.filter((c) => c.birthday === todayMD());
    if (filter === 'anniversary') l = l.filter((c) => c.anniversary === todayMD());
    if (query.startsWith('b:')) { const md = query.slice(2); l = l.filter((c) => c.birthday === md); }
    else if (query.startsWith('a:')) { const md = query.slice(2); l = l.filter((c) => c.anniversary === md); }
    else if (query) l = l.filter((c) => (c.name + ' ' + c.mobile + ' ' + (c.custom_tags || []).join(' ')).toLowerCase().includes(query));
    return l;
  }, [db, q, filter]);

  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const safePage = Math.min(page, pages - 1);
  const rows = list.slice(safePage * PAGE, safePage * PAGE + PAGE);
  const pending = pendingGmbReviews();
  const active = selected ? db.users.find((u) => u.id === selected) : null;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow mb-1">Client directory</div>
          <h1 className="luxe-title text-3xl">Customer CRM</h1>
        </div>
        <button onClick={() => navigate('/merchant/onboarding')} className="btn-ink !py-2 text-[10px]">＋ New client</button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <input className="input sm:max-w-xs" placeholder="Search name, mobile, tag…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        <div className="flex gap-2 text-[10px] tracking-wide2 uppercase">
          {[['all', 'All clients'], ['birthday', 'Birthdays today'], ['anniversary', 'Anniversaries'], ['reviews', `Reviews · ${pending.length}`]].map(([k, label]) => (
            <button key={k} onClick={() => { setFilter(k); setPage(0); }} className={cls('px-3 py-2 border transition-colors', filter === k ? 'border-ink bg-ink text-white' : 'border-line text-steel hover:border-ink hover:text-ink')}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {filter === 'reviews' && pending.length > 0 && (
        <div className="space-y-3">
          {pending.map((r) => (
            <div key={r.id} className="card px-5 py-4 flex items-center gap-3">
              <div className="flex-1">
                <Stars value={r.stars} size={16} />
                <p className="text-sm mt-1">“{r.review_text}”</p>
                <div className="text-xs text-steel mt-1">{db.users.find((u) => u.id === r.userId)?.name} · {fmtDate(r.createdAt)}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setReviewStatus(r.id, 'approved')} className="btn-ink !py-1.5">Approve</button>
                <button onClick={() => setReviewStatus(r.id, 'resolved')} className="btn-ghost !py-1.5">Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="tbl min-w-[680px]">
          <thead>
            <tr><th>Client</th><th>Mobile</th><th>Points</th><th>Tier</th><th>Birthday</th><th>Anniversary</th><th>Magic link</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-mist cursor-pointer" onClick={() => { setSelected(c.id); setTab('basic'); }}>
                <td>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-steel">{c.custom_tags?.map((t) => t).join(' · ')}</div>
                </td>
                <td className="text-sm text-steel">{c.mobile}</td>
                <td className="font-medium">{c.points.toLocaleString('en-IN')}</td>
                <td><TierBadge tier={c.tier} /></td>
                <td className="text-sm text-steel">{parseMD(c.birthday)}</td>
                <td className="text-sm text-steel">{parseMD(c.anniversary)}</td>
                <td className="text-center whitespace-nowrap">
                  <div className="inline-flex gap-1.5 items-center">
                    <button onClick={(e) => { e.stopPropagation(); openLookbook(c); }} title="Open lookbook" className="btn-ghost !px-2 !py-1.5 text-[11px]" aria-label="Open lookbook">
                      👁
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); copyLink(c); }} title="Copy magic link" className="btn-ghost !px-2 !py-1.5 text-[11px]" aria-label="Copy link">
                      {copiedId === c.id ? '✓' : '🔗'}
                    </button>
                    <a href={shareWa(c)} target="_blank" rel="noreferrer" title="Share on WhatsApp" onClick={(e) => e.stopPropagation()} className="btn-gold !px-2 !py-1.5 text-[11px]" aria-label="WhatsApp">✆</a>
                  </div>
                </td>
                <td className="text-right text-gold">→</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7}><Empty>No clients match.</Empty></td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-steel">
        <span>Showing {rows.length} of {list.length}</span>
        <div className="flex gap-2">
          <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="btn-ghost !py-1.5 disabled:opacity-40">← Prev</button>
          <span className="px-3 py-1.5">Page {safePage + 1} / {pages}</span>
          <button disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} className="btn-ghost !py-1.5 disabled:opacity-40">Next →</button>
        </div>
      </div>

      {active && (
        <Modal open onClose={() => setSelected(null)} title={active.name} wide>
          <div className="flex gap-2 flex-wrap mb-5">
            {['basic', 'profiling', 'notes', 'ledger', 'points'].map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cls('px-4 py-2 text-[10px] tracking-wide2 uppercase border transition-colors', tab === t ? 'border-ink bg-ink text-white' : 'border-line text-steel hover:border-ink hover:text-ink')}>
                {t === 'basic' ? 'Basic info' : t === 'profiling' ? 'Boutique profiling' : t === 'notes' ? 'Staff notes' : t === 'ledger' ? 'Activity ledger' : 'Points tool'}
              </button>
            ))}
          </div>

          {tab === 'basic' && (
            <div className="grid sm:grid-cols-2 gap-4">
              <Info label="Name" value={active.name} />
              <Info label="Mobile" value={active.mobile} />
              <Info label="Birthday" value={parseMD(active.birthday)} />
              <Info label="Anniversary" value={parseMD(active.anniversary)} />
              <Info label="Points balance" value={active.points.toLocaleString('en-IN') + ' pts'} />
              <Info label="Tier" value={<TierBadge tier={active.tier} />} />
              <div className="sm:col-span-2">
                <div className="label">Magic link (personal WhatsApp access)</div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gold select-all border border-line bg-mist px-3 py-2 min-w-0 max-w-full break-all">{magicUrl(active)}</span>
                  <button onClick={() => openLookbook(active)} className="btn-ghost !px-3 !py-1.5 text-[9px]">Open lookbook 👁</button>
                  <button onClick={() => copyLink(active)} className="btn-ghost !px-3 !py-1.5 text-[9px]">{copiedId === active.id ? '✓ Copied' : 'Copy'}</button>
                  <a href={shareWa(active)} target="_blank" rel="noreferrer" className="btn-gold !px-3 !py-1.5 text-[9px]">WhatsApp ✆</a>
                </div>
              </div>
              <div className="sm:col-span-2"><Info label="Custom tags" value={<div className="flex gap-2 flex-wrap">{active.custom_tags?.length ? active.custom_tags.map((t) => <Tag key={t}>{t}</Tag>) : <span className="text-steel">—</span>}</div>} /></div>
            </div>
          )}

          {tab === 'profiling' && (
            <div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
                <Info label="Bust" value={active.measurements?.bust || '—'} />
                <Info label="Waist" value={active.measurements?.waist || '—'} />
                <Info label="Hips" value={active.measurements?.hips || '—'} />
                <Info label="Size tag" value={active.measurements?.size || '—'} />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Info label="Preferred colours" value={active.measurements?.colours?.join(' · ') || '—'} />
                <Info label="Preferred fabrics" value={active.measurements?.fabrics?.join(' · ') || '—'} />
              </div>
              <p className="text-[10px] tracking-wide2 uppercase text-steel mt-5">Confidential — visible to boutique staff only.</p>
            </div>
          )}

          {tab === 'notes' && <StaffNotes userId={active.id} />}

          {tab === 'ledger' && <Ledger userId={active.id} db={db} />}

          {tab === 'points' && <PointsTool userId={active.id} />}
        </Modal>
      )}
    </div>
  );
}

function todayMD() { const d = new Date(); return `${d.getMonth() + 1}-${d.getDate()}`; }
function Info({ label, value }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function StaffNotes({ userId }) {
  const db = useDb();
  const [text, setText] = useState('');
  const user = db.users.find((u) => u.id === userId);
  const submit = () => { if (text.trim()) { addStaffNote(userId, text.trim(), 'Owner'); setText(''); } };
  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input className="input" placeholder="Add a private designer note…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <button onClick={submit} className="btn-ink shrink-0">Add note</button>
      </div>
      {user?.staff_notes?.length ? (
        <div className="space-y-3 max-h-72 overflow-y-auto scroll-thin">
          {user.staff_notes.map((n) => (
            <div key={n.id} className="border border-line px-4 py-3 text-sm bg-mist">
              <div className="text-[10px] tracking-wide2 uppercase text-gold mb-1">{fmtDate(n.ts)} · {n.by}</div>
              {n.text}
            </div>
          ))}
        </div>
      ) : <Empty>No private notes yet.</Empty>}
    </div>
  );
}

function Ledger({ userId, db }) {
  const entries = customerLedger(userId);
  const icon = { order: '🛍', review: '★', earned: '✦', redeemed: '▼', adjustment: '⚙' };
  return (
    <div className="max-h-80 overflow-y-auto scroll-thin">
      <table className="tbl">
        <thead><tr><th>Date</th><th>Type</th><th>Detail</th><th className="text-right">Points</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="text-xs text-steel whitespace-nowrap">{fmtDate(e.createdAt)}</td>
              <td><span className="text-sm">{icon[e.kind] || '·'}</span></td>
              <td className="text-sm">
                {e.kind === 'order' ? `Order · ${e.items?.[0]?.title || 'lookbook'} · ${e.paymentMethod === 'online' ? 'paid online' : 'reserved'} ${inr(e.finalTotal)}` : e.kind === 'review' ? `Review · ${e.platform === 'gmb' ? 'Google' : 'product'} ${e.stars}★` : `${e.reason}`}
              </td>
              <td className={cls('text-right font-medium whitespace-nowrap', e.kind === 'order' ? '' : e.action === 'redeemed' ? 'text-steel' : 'text-gold')}>
                {e.kind === 'order' ? inr(e.finalTotal) : `${e.action === 'redeemed' ? '−' : '+'}${e.points}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PointsTool({ userId }) {
  const db = useDb();
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const user = db.users.find((u) => u.id === userId);
  const submit = (sign) => {
    const n = Number(delta);
    if (!n || !reason.trim()) return;
    adjustPoints(userId, sign * n, reason.trim());
    setDelta(''); setReason('');
  };
  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <span className="eyebrow">Current balance</span>
        <span className="luxe-title text-3xl">{user.points.toLocaleString('en-IN')}</span>
        <span className="text-xs text-steel">pts</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <div><label className="label">Points {`(+add / −deduct)`}</label><input className="input" type="number" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="e.g. 100" /></div>
        <div><label className="label">Audit reason (mandatory)</label><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. walk-in goodwill credit" /></div>
      </div>
      <div className="flex gap-2">
        <button onClick={() => submit(1)} className="btn-ink flex-1" disabled={!delta || !reason.trim()}>Add points</button>
        <button onClick={() => submit(-1)} className="btn-ghost flex-1" disabled={!delta || !reason.trim()}>Deduct points</button>
      </div>
      <p className="text-[10px] tracking-wide2 uppercase text-steel mt-4">Every adjustment is logged with its reason in the audit ledger.</p>
    </div>
  );
}
