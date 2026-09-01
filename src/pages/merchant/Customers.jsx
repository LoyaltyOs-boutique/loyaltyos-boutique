import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getData, subscribe, customers, customerLedger, addStaffNote,
  pendingGmbReviews, setReviewStatus, waMessage, waDigits,
  updateCustomerProfile, updateMeasurements,
  getUpcomingBirthdays, getUpcomingAnniversaries,
  getWhatsAppTemplateConfig, getWhatsAppTemplates, sendWhatsAppTemplateMessage,
  recordMessageAction, awardPoints,
  hydrateCustomers, hydrateReviews,
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
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [isEditingProfiling, setIsEditingProfiling] = useState(false);
  const [editMeasurements, setEditMeasurements] = useState({});
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState(null);

  // "Birthdays tomorrow" / "Anniversaries tomorrow" tabs — the locally
  // hydrated customers() array has no days_until field, so these two tabs
  // fetch the real getUpcomingBirthdays/getUpcomingAnniversaries queries on
  // mount (days:1) and filter to days_until === 1 below, same fetch-on-mount
  // pattern as pendingGmbReviews's own hydration elsewhere in this codebase.
  // The remaining tabs (all/reviews) keep reading from customers() exactly
  // as before — untouched.
  const [tomorrowBirthdays, setTomorrowBirthdays] = useState([]);
  const [tomorrowAnniversaries, setTomorrowAnniversaries] = useState([]);
  useEffect(() => {
    let mounted = true;
    getUpcomingBirthdays(1).then((rows) => { if (mounted) setTomorrowBirthdays(rows || []); });
    getUpcomingAnniversaries(1).then((rows) => { if (mounted) setTomorrowAnniversaries(rows || []); });
    return () => { mounted = false; };
  }, []);

  // Main customer list + reviews tab fresh-fetch on mount. customers() and
  // pendingGmbReviews() both read the shared module-scoped state singleton,
  // which hydrateCustomers()/hydrateReviews() populate just once at module
  // load — so SPA navigation away from and back to this page (no hard
  // refresh) would otherwise keep showing the last full-page-load snapshot
  // (stale whatsapp_consent, points, tags, pending reviews, etc.). Re-running
  // both hydrate calls on every mount re-queries Convex and merges fresh rows
  // into state, calling emit() when anything changed, which useDb()'s
  // subscribe() picks up to re-render. Both self-guard via their own
  // hydrating flags, so rapid navigate-away-and-back never double-fetches.
  useEffect(() => { hydrateCustomers(); hydrateReviews(); }, []);

  // Approval modal (Birthdays tomorrow / Anniversaries tomorrow "Approve &
  // Send" flow) — the merchant-configured promo copy (discount/coupon/valid
  // days) and the approved Cloud API template metadata (name/language) are
  // both fetched once on mount, same fetch-on-mount idiom already used above
  // and in Templates.jsx (getWhatsAppTemplateConfig/getWhatsAppTemplates are
  // pre-existing bridges from a prior task on this branch, reused as-is).
  const [templateConfig, setTemplateConfig] = useState({
    anniversary: { discountPercent: '', couponCode: '', validDays: '' },
    birthday: { discountPercent: '', couponCode: '', validDays: '' },
  });
  const [waTemplates, setWaTemplates] = useState({ anniversary: null, birthday: null });
  useEffect(() => {
    let mounted = true;
    getWhatsAppTemplateConfig().then((cfg) => { if (mounted && cfg) setTemplateConfig(cfg); });
    getWhatsAppTemplates().then((tpls) => { if (mounted && tpls) setWaTemplates(tpls); });
    return () => { mounted = false; };
  }, []);

  // approveTarget: { customer, occasion } while the approval modal is open,
  // null when closed — occasion is 'birthday' | 'anniversary', matching
  // templateConfig/waTemplates' key shape directly.
  const [approveTarget, setApproveTarget] = useState(null);

  // pointsTarget: the customer row object while the "Give points" modal is
  // open (from the All-clients table's new + Points button), null when
  // closed — same conditional-render-at-bottom pattern as approveTarget.
  const [pointsTarget, setPointsTarget] = useState(null);

  // decidedActions: same-session "this row was just Approved&Sent/Cancelled"
  // memory, keyed by `${customer.id}:${occasion}` -> 'sent' | 'cancelled'.
  // The backend query already excludes decided rows on next fetch (see
  // convex/customers.ts getUpcomingBirthdays/getUpcomingAnniversaries), but
  // within THIS session the tomorrowBirthdays/tomorrowAnniversaries arrays
  // aren't re-fetched after a click — so the row would keep showing the old
  // buttons until a manual refresh. This local map lets the row swap its
  // Approve & Send/Cancel buttons for a badge immediately, without removing
  // the row from the list (per updated design decision — rows stay visible).
  const [decidedActions, setDecidedActions] = useState({});
  const decisionKey = (customerId, occasion) => `${customerId}:${occasion}`;
  const markDecided = (customerId, occasion, action) => {
    setDecidedActions((prev) => ({ ...prev, [decisionKey(customerId, occasion)]: action }));
  };

  // cancelErrors: same-session "Cancel just failed" inline message, keyed the
  // same way as decidedActions — covers the double-click race where two
  // recordMessageAction calls for the same tuple fire before local state
  // updates (backend rejects the second with an idempotency error).
  const [cancelErrors, setCancelErrors] = useState({});

  const handleCancel = async (c, occasion) => {
    const key = decisionKey(c.id, occasion);
    const occasionDate = occasion === 'birthday' ? c.birthday : c.anniversary;
    setCancelErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
    try {
      await recordMessageAction(c.id, occasion, occasionDate, 'cancelled');
      markDecided(c.id, occasion, 'cancelled');
    } catch (err) {
      // Idempotency rejection (already decided) or offline — show inline,
      // don't crash. If it was already decided, reflect that in the UI too.
      setCancelErrors((prev) => ({ ...prev, [key]: err?.message || 'Could not cancel — try again.' }));
    }
  };

  const waToken = (c) => ({ wa: waDigits(c.whatsapp || c.mobile), m: `/lookbook?id=${c.id}&token=${c.magic_token}` });
  const magicUrl = (c) => `${window.location.origin}${waToken(c).m}`;
  const copyLink = (c) => { if (navigator.clipboard) navigator.clipboard.writeText(magicUrl(c)); setCopiedId(c.id); setTimeout(() => setCopiedId(null), 1600); };
  const openLookbook = (c) => {
    if (!c.magic_token) { alert('Generate magic link first'); return; }
    window.open(magicUrl(c), '_blank', 'noopener,noreferrer');
  };
  const shareWa = (c) => `https://wa.me/${waToken(c).wa}?text=${encodeURIComponent(waMessage(c, waToken(c).m))}`;

  // The Convex getUpcomingBirthdays/getUpcomingAnniversaries rows use `_id`
  // and lack magic_token/custom_tags (see convex/customers.ts projection) —
  // row rendering below (unchanged, out of scope for this task) expects the
  // same shape customers() already produces (`id`, `magic_token`,
  // `custom_tags`, …). Re-map each tomorrow-row onto its matching local
  // hydrated customer record (already carrying those fields) so the
  // existing row JSX keeps working untouched; a fetched row with no local
  // match yet (hydration race) still renders using its own fields.
  const withLocalShape = (row) => customers().find((u) => u.id === row._id) || { ...row, id: row._id };

  const list = useMemo(() => {
    // "Tomorrow" tabs read from the separate Convex-fetched days_until state
    // (not the local customers() array) — see the fetch-on-mount effect
    // above. All other tabs are completely unchanged below.
    if (filter === 'birthday_tomorrow') return tomorrowBirthdays.filter((c) => c.days_until === 1).map(withLocalShape);
    if (filter === 'anniversary_tomorrow') return tomorrowAnniversaries.filter((c) => c.days_until === 1).map(withLocalShape);

    let l = customers();
    const query = q.trim().toLowerCase();
    if (query.startsWith('b:')) { const md = query.slice(2); l = l.filter((c) => c.birthday === md); }
    else if (query.startsWith('a:')) { const md = query.slice(2); l = l.filter((c) => c.anniversary === md); }
    else if (query) l = l.filter((c) => (c.name + ' ' + c.mobile + ' ' + (c.custom_tags || []).join(' ')).toLowerCase().includes(query));
    return l;
  }, [db, q, filter, tomorrowBirthdays, tomorrowAnniversaries]);

  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const safePage = Math.min(page, pages - 1);
  const rows = list.slice(safePage * PAGE, safePage * PAGE + PAGE);
  const pending = pendingGmbReviews();
  const active = selected ? db.users.find((u) => u.id === selected) : null;

  const handleSave = async () => {
    if (!active) return;
    const patch = {};
    if (editForm.name !== undefined) patch.name = editForm.name.trim();
    if (editForm.birthday !== undefined) patch.birthday = editForm.birthday.trim();
    if (editForm.anniversary !== undefined) patch.anniversary = editForm.anniversary.trim();
    if (editForm.tier !== undefined) patch.tier = editForm.tier;
    if (editForm.custom_tags !== undefined) patch.custom_tags = editForm.custom_tags;
    await updateCustomerProfile(active.id, patch);
    setIsEditing(false);
    setEditForm({});
  };

  const handleSaveProfiling = async () => {
    if (!active) return;
    const patch = {};
    if (editMeasurements.bust !== undefined && editMeasurements.bust !== '') patch.bust = Number(editMeasurements.bust);
    if (editMeasurements.waist !== undefined && editMeasurements.waist !== '') patch.waist = Number(editMeasurements.waist);
    if (editMeasurements.hip !== undefined && editMeasurements.hip !== '') patch.hip = Number(editMeasurements.hip);
    if (editMeasurements.height !== undefined) patch.height = editMeasurements.height.trim();
    if (editMeasurements.blouse_size !== undefined) patch.blouse_size = editMeasurements.blouse_size.trim();
    await updateMeasurements(active.id, patch);
    setIsEditingProfiling(false);
    setEditMeasurements({});
  };

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
          {[['all', 'All clients'], ['birthday_tomorrow', 'Birthdays tomorrow'], ['anniversary_tomorrow', 'Anniversaries tomorrow'], ['reviews', `Reviews · ${pending.length}`]].map(([k, label]) => (
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
            <tr><th>Client</th><th>Mobile</th><th>Points</th><th>Tier</th><th>Birthday</th><th>Anniversary</th><th>Magic link</th>{(filter === 'birthday_tomorrow' || filter === 'anniversary_tomorrow') && <th>WhatsApp wish</th>}<th></th></tr>
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
                    <a href={shareWa(c)} target="_blank" rel="noreferrer" title="Share on WhatsApp" onClick={(e) => e.stopPropagation()} className="btn-gold !px-2 !py-1.5 text-[11px]" aria-label="WhatsApp"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-1px' }}><path d="M4 11.5v7A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-7" /><path d="M14.5 9 21 2.5" /><path d="M15.5 2.5H21V8" /></svg></a>
                    <button onClick={(e) => { e.stopPropagation(); setPointsTarget(c); }} title="Give points" className="btn-ghost !px-2 !py-1.5 text-[11px]" aria-label="Give points">
                      ✦
                    </button>
                  </div>
                </td>
                {(filter === 'birthday_tomorrow' || filter === 'anniversary_tomorrow') && (() => {
                  const occasion = filter === 'birthday_tomorrow' ? 'birthday' : 'anniversary';
                  const decided = decidedActions[decisionKey(c.id, occasion)];
                  const cancelError = cancelErrors[decisionKey(c.id, occasion)];
                  return (
                    <td className="text-center whitespace-nowrap">
                      {decided ? (
                        <span className="text-[10px] tracking-wide2 uppercase text-steel">
                          {decided === 'sent' ? '✓ Sent' : '✗ Cancelled'}
                        </span>
                      ) : (
                        <div className="inline-flex gap-1.5 items-center">
                          <button onClick={(e) => { e.stopPropagation(); setApproveTarget({ customer: c, occasion }); }} className="btn-gold !px-2 !py-1.5 text-[11px]" aria-label="Approve and send">
                            Approve &amp; Send
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleCancel(c, occasion); }} className="btn-ghost !px-2 !py-1.5 text-[11px]" aria-label="Cancel">
                            Cancel
                          </button>
                        </div>
                      )}
                      {cancelError && <div className="text-red-600 text-[10px] mt-1">{cancelError}</div>}
                    </td>
                  );
                })()}
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
          <div className="flex gap-2 flex-wrap mb-5 items-center">
            {['basic', 'profiling', 'notes', 'ledger', 'points'].map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cls('px-4 py-2 text-[10px] tracking-wide2 uppercase border transition-colors', tab === t ? 'border-ink bg-ink text-white' : 'border-line text-steel hover:border-ink hover:text-ink')}>
                {t === 'basic' ? 'Basic info' : t === 'profiling' ? 'Boutique profiling' : t === 'notes' ? 'Staff notes' : t === 'ledger' ? 'Activity ledger' : 'Points tool'}
              </button>
            ))}
            {tab === 'basic' && !isEditing && active && (
              <button onClick={() => { setEditForm({ name: active.name, birthday: active.birthday || '', anniversary: active.anniversary || '', tier: active.tier, custom_tags: active.custom_tags || [] }); setIsEditing(true); }} className="btn-ghost !px-3 !py-1.5 text-[10px] ml-auto">Edit</button>
            )}
            {tab === 'profiling' && !isEditingProfiling && active && (
              <button onClick={() => { setEditMeasurements({ bust: active.measurements?.bust || '', waist: active.measurements?.waist || '', hip: active.measurements?.hips || '', height: active.measurements?.height || '', blouse_size: active.measurements?.blouse_size || '' }); setIsEditingProfiling(true); }} className="btn-ghost !px-3 !py-1.5 text-[10px] ml-auto">Edit</button>
            )}
          </div>

          {tab === 'basic' && (
            <div className="grid sm:grid-cols-2 gap-4">
              {!isEditing ? (
                <>
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
                      <a href={shareWa(active)} target="_blank" rel="noreferrer" className="btn-gold !px-3 !py-1.5 text-[9px]">WhatsApp <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-1px' }}><path d="M4 11.5v7A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-7" /><path d="M14.5 9 21 2.5" /><path d="M15.5 2.5H21V8" /></svg></a>
                    </div>
                  </div>
                  <div className="sm:col-span-2"><Info label="Custom tags" value={<div className="flex gap-2 flex-wrap">{active.custom_tags?.length ? active.custom_tags.map((t) => <Tag key={t}>{t}</Tag>) : <span className="text-steel">—</span>}</div>} /></div>
                </>
              ) : (
                <>
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between mb-4">
                      <span className="label">Edit basic info</span>
                      <div className="flex gap-2">
                        <button onClick={() => { setEditForm({}); setIsEditing(false); }} className="btn-ghost !px-3 !py-1.5 text-[10px]">Cancel</button>
                        <button onClick={handleSave} className="btn-gold !px-3 !py-1.5 text-[10px]">Save</button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="label">Name</label>
                    <input className="input" value={editForm.name || active.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Mobile (unique - not editable)</label>
                    <input className="input bg-mist" value={active.mobile} readOnly />
                  </div>
                  <div>
                    <label className="label">Birthday (M-D)</label>
                    <input className="input" value={editForm.birthday || active.birthday || ''} onChange={(e) => setEditForm({ ...editForm, birthday: e.target.value })} placeholder="e.g. 8-15" />
                  </div>
                  <div>
                    <label className="label">Anniversary (M-D)</label>
                    <input className="input" value={editForm.anniversary || active.anniversary || ''} onChange={(e) => setEditForm({ ...editForm, anniversary: e.target.value })} placeholder="e.g. 12-25" />
                  </div>
                  <div>
                    <label className="label">Tier</label>
                    <select className="input" value={editForm.tier || active.tier} onChange={(e) => setEditForm({ ...editForm, tier: e.target.value })}>
                      <option value="silver">Silver</option>
                      <option value="gold">Gold</option>
                      <option value="platinum">Platinum</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">Custom tags (comma-separated)</label>
                    <input className="input" value={editForm.custom_tags ? editForm.custom_tags.join(', ') : (active.custom_tags || []).join(', ')} onChange={(e) => setEditForm({ ...editForm, custom_tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} placeholder="e.g. VIP, Saree Enthusiast" />
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'profiling' && (
            <div>
              {!isEditingProfiling ? (
                <>
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
                </>
              ) : (
                <>
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between mb-4">
                      <span className="label">Edit measurements</span>
                      <div className="flex gap-2">
                        <button onClick={() => { setEditMeasurements({}); setIsEditingProfiling(false); }} className="btn-ghost !px-3 !py-1.5 text-[10px]">Cancel</button>
                        <button onClick={handleSaveProfiling} className="btn-gold !px-3 !py-1.5 text-[10px]">Save</button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="label">Bust (cm)</label>
                    <input className="input" type="number" step="0.1" value={editMeasurements.bust || ''} onChange={(e) => setEditMeasurements({ ...editMeasurements, bust: e.target.value })} placeholder="e.g. 92" />
                  </div>
                  <div>
                    <label className="label">Waist (cm)</label>
                    <input className="input" type="number" step="0.1" value={editMeasurements.waist || ''} onChange={(e) => setEditMeasurements({ ...editMeasurements, waist: e.target.value })} placeholder="e.g. 74" />
                  </div>
                  <div>
                    <label className="label">Hips (cm)</label>
                    <input className="input" type="number" step="0.1" value={editMeasurements.hip || ''} onChange={(e) => setEditMeasurements({ ...editMeasurements, hip: e.target.value })} placeholder="e.g. 98" />
                  </div>
                  <div>
                    <label className="label">Height</label>
                    <input className="input" value={editMeasurements.height || ''} onChange={(e) => setEditMeasurements({ ...editMeasurements, height: e.target.value })} placeholder="e.g. 165cm" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">Blouse size</label>
                    <input className="input" value={editMeasurements.blouse_size || ''} onChange={(e) => setEditMeasurements({ ...editMeasurements, blouse_size: e.target.value })} placeholder="e.g. 36" />
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'notes' && <StaffNotes userId={active.id} />}

          {tab === 'ledger' && <Ledger userId={active.id} db={db} />}

          {tab === 'points' && <PointsTool userId={active.id} />}
        </Modal>
      )}

      {approveTarget && (
        <ApprovalModal
          target={approveTarget}
          templateConfig={templateConfig}
          waTemplates={waTemplates}
          onClose={() => setApproveTarget(null)}
          onSent={(customerId, occasion, channel) => {
            const occasionDate = occasion === 'birthday'
              ? approveTarget.customer.birthday
              : approveTarget.customer.anniversary;
            recordMessageAction(customerId, occasion, occasionDate, 'sent', channel)
              .then(() => markDecided(customerId, occasion, 'sent'))
              .catch((err) => {
                // Idempotency rejection (already decided) or offline — the
                // send itself already happened/attempted; just surface the
                // logging failure inline on the row rather than crashing.
                setCancelErrors((prev) => ({ ...prev, [decisionKey(customerId, occasion)]: err?.message || 'Could not log this send — try refreshing.' }));
              });
          }}
        />
      )}

      {pointsTarget && (
        <Modal open onClose={() => setPointsTarget(null)} title={`Give points — ${pointsTarget.name}`}>
          <PointsTool userId={pointsTarget.id} />
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

/**
 * "Approve & Send" modal for the Birthdays tomorrow / Anniversaries tomorrow
 * tabs. Mirrors Templates.jsx's MomentCard.send() guard/try/catch/fallback
 * shape exactly: no template configured for this occasion type → skip
 * straight to the wa.me fallback; template configured → try the Cloud API
 * send, and on ANY failure fall back to the same wa.me link-open, never a
 * silent dead end. The preview block shown here is for the merchant's own
 * reference only — the real outgoing Cloud API bodyParams stay `[name]`
 * only per the locked design decision, since discount/coupon/valid-days
 * position in the real approved template text isn't finalized yet.
 */
function ApprovalModal({ target, templateConfig, waTemplates, onClose, onSent }) {
  const { customer, occasion } = target;
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState('');
  const cfg = templateConfig[occasion] || { discountPercent: '', couponCode: '', validDays: '' };
  const waTemplate = waTemplates[occasion];
  const occasionLabel = occasion === 'birthday' ? 'Birthday' : 'Anniversary';
  const occasionDate = parseMD(occasion === 'birthday' ? customer.birthday : customer.anniversary);

  // Preview text — reference-only for the merchant, assembled from the
  // customer's name plus the configured discount/coupon/valid-days for this
  // occasion type. Anniversary has no partner-name field in the data model,
  // so both {{1}} and {{2}} slots use the customer's own name — made
  // explicit here rather than silently assumed (locked design decision).
  const previewLines = [
    `Happy ${occasionLabel.toLowerCase()}, ${customer.name}! With love, 85 Lansdowne.`,
    occasion === 'anniversary' ? `(Both name slots {{1}} and {{2}} use "${customer.name}" — no separate partner name on file.)` : null,
    cfg.discountPercent ? `Enjoy ${cfg.discountPercent}% off` + (cfg.couponCode ? ` with code ${cfg.couponCode}` : '') + (cfg.validDays ? `, valid for ${cfg.validDays} days.` : '.') : null,
  ].filter(Boolean);

  const previewText = previewLines.join('\n');

  const openWaLinkFallback = () => {
    window.open(`https://wa.me/${waDigits(customer.whatsapp || customer.mobile)}?text=${encodeURIComponent(previewText)}`, '_blank');
  };

  const approve = async () => {
    // Consent gate — never send to a customer who hasn't given WhatsApp
    // consent, even if the button is somehow triggered while disabled.
    if (!customer.whatsapp_consent) return;

    // No template configured for this occasion type yet → skip the Cloud
    // API attempt entirely, go straight to wa.me — same guard MomentCard.send()
    // uses, not an error state.
    if (!waTemplate) {
      openWaLinkFallback();
      setSendMsg('Sent via WhatsApp link');
      onSent?.(customer.id, occasion, 'wa_fallback');
      onClose();
      return;
    }

    // Template IS configured → try the Cloud API send first. bodyParams:
    // [name] only, no card image URL — identical shape to MomentCard.send().
    setSending(true);
    setSendMsg('Sending…');
    let channel = 'cloud_api';
    try {
      await sendWhatsAppTemplateMessage(customer.mobile, waTemplate.name, waTemplate.language, undefined, [customer.name.trim() || '{name}']);
      setSendMsg('Sent via WhatsApp');
    } catch (err) {
      // Any failure (Meta rejection, network error, etc.) → fall back to the
      // same wa.me link-open, using the preview text shown above.
      openWaLinkFallback();
      setSendMsg('Sent via WhatsApp link');
      channel = 'wa_fallback';
    } finally {
      setSending(false);
      onSent?.(customer.id, occasion, channel);
      onClose();
    }
  };

  return (
    <Modal open onClose={onClose} title={`Approve & Send — ${occasionLabel}`}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Info label="Client" value={customer.name} />
          <Info label="Occasion" value={occasionLabel} />
          <Info label={occasionLabel} value={occasionDate} />
          <Info label="Mobile" value={customer.mobile} />
        </div>
        <div>
          <div className="label">Preview (merchant reference only)</div>
          <div className="text-sm border border-line bg-mist px-3 py-2 whitespace-pre-line">{previewText}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-ghost !px-3 !py-1.5 text-[10px] flex-1">Cancel</button>
          <button onClick={approve} disabled={sending || !customer.whatsapp_consent} className="btn-gold !px-3 !py-1.5 text-[10px] flex-1">Approve &amp; Send</button>
        </div>
        {!customer.whatsapp_consent && (
          <div className="text-red-600 text-xs">This customer hasn't given WhatsApp consent yet — can't send.</div>
        )}
        {sendMsg && <div className="text-xs text-gold">{sendMsg}</div>}
      </div>
    </Modal>
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
  const [reasonType, setReasonType] = useState('normal');
  const [pointsError, setPointsError] = useState('');
  const user = db.users.find((u) => u.id === userId);
  const submit = (sign) => {
    const n = Number(delta);
    if (!n || !reason.trim()) return;
    setPointsError('');
    awardPoints(userId, sign * n, reasonType, reason.trim())
      .then(() => { setDelta(''); setReason(''); setReasonType('normal'); })
      .catch((err) => {
        setPointsError(err?.message || 'Could not save this adjustment — try again.');
      });
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
        <div>
          <label className="label">Reason type</label>
          <select className="input" value={reasonType} onChange={(e) => setReasonType(e.target.value)}>
            <option value="normal">Normal</option>
            <option value="birthday">Birthday</option>
            <option value="anniversary">Anniversary</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={() => submit(1)} className="btn-ink flex-1" disabled={!delta || !reason.trim()}>Add points</button>
        <button onClick={() => submit(-1)} className="btn-ghost flex-1" disabled={!delta || !reason.trim()}>Deduct points</button>
      </div>
      {pointsError && <div className="text-red-600 text-[10px] mt-1">{pointsError}</div>}
      <p className="text-[10px] tracking-wide2 uppercase text-steel mt-4">Every adjustment is logged with its reason in the audit ledger.</p>
    </div>
  );
}
