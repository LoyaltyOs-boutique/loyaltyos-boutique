import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getData, subscribe, derivedMetrics, pendingGmbReviews, recentActivityByCustomer,
  getMerchantSession, setReviewStatus,
  hydrateCustomers, hydrateCatalogue, hydrateReviews,
} from '../../lib/db.js';
import { inr, greeting, first, fmtDate, timeAgo, cls } from '../../lib/util.js';
import { Stat, Stars, Modal } from '../../components/ui.jsx';
import { BRAND } from '../../data/seed.js';
// Recent Activity redesign: reuse the SAME Activity Ledger component/data
// source (customerLedger() + hydratePointsHistory()) already used by Customer
// CRM's per-customer detail modal, instead of building a second parallel
// implementation. Ledger is now exported from Customers.jsx for exactly this.
import { Ledger } from './Customers.jsx';

const useDb = () => {
  const [, setV] = useState(0);
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  return getData();
};

const ACTION = {
  purchase: { icon: '🛍', label: 'purchase' },
  review: { icon: '★', label: 'review' },
  points: { icon: '✦', label: 'points' },
  campaign: { icon: '✆', label: 'campaign' },
  like: { icon: '♥', label: 'like' },
  catalogue: { icon: '❖', label: 'catalogue' },
};

export default function Dashboard() {
  const db = useDb();
  const navigate = useNavigate();
  const [me] = useState(() => getMerchantSession());
  // Recent Activity redesign: which customer's row was clicked to open the
  // full-history modal — null when closed, matching Customers.jsx's own
  // `selected` (customer id) / Modal-open-when-truthy pattern.
  const [activityUserId, setActivityUserId] = useState(null);

  // hydrateCustomers()/hydrateCatalogue()/hydrateReviews() normally run once
  // at module load — but on a genuinely fresh browser session that one-shot
  // module-load-only hydrate races ahead of a fresh login's async session
  // being stored, silently finds no session, and no-ops, leaving this page
  // stuck on hardcoded seed customers/catalogue/reviews until a hard reload.
  // Re-running them on mount here re-queries Convex once the real session
  // exists and merges fresh rows into state, calling emit() when anything
  // changed, which useDb()'s subscribe() picks up to re-render.
  useEffect(() => { hydrateCustomers(); hydrateCatalogue(); hydrateReviews(); }, []);

  const m = derivedMetrics();
  const pending = pendingGmbReviews();
  // Grouped, one-row-per-customer feed (most-recent-activity-first) — see
  // recentActivityByCustomer()'s own doc comment in db.js for the grouping
  // rationale. activityUser resolves the clicked row's full customer record
  // (name, id) for the modal title + Ledger's userId prop.
  const feed = recentActivityByCustomer();
  const activityUser = activityUserId ? db.users.find((u) => u.id === activityUserId) : null;

  return (
    <div className="space-y-10">
      {/* Delight Banner */}
      <section className="card bg-ink text-white px-6 sm:px-8 py-8 relative overflow-hidden">
        <img src={BRAND.logo} alt="" className="absolute right-6 top-1/2 -translate-y-1/2 opacity-10 h-24 object-contain" />
        <button
          onClick={() => navigate('/merchant/onboarding')}
          className="absolute top-4 right-4 sm:top-5 sm:right-5 btn-gold !py-2 text-[10px]"
        >
          ＋ New client
        </button>
        <div className="eyebrow text-gold mb-3">Delight Desk</div>
        <h1 className="luxe-title text-3xl md:text-4xl">{greeting()}, {first((me && me.name) || 'Owner')}.</h1>
        <p className="text-white/60 text-sm mt-3 max-w-xl">
          Today's ritual: follow up on {m.pendingReviews} pending review{m.pendingReviews === 1 ? '' : 's'},
          wish {m.birthdaysToday} client{m.birthdaysToday === 1 ? '' : 's'} happy birthday, and prepare the weekly {inr(m.loyaltyRevenue)} loyalty pipeline.
        </p>
      </section>

      {/* Action chips */}
      <section>
        <div className="grid sm:grid-cols-3 gap-4">
          <button onClick={() => navigate('/merchant/customers', { state: { tab: 'reviews' } })} className="chip">
            <span className="luxe-title text-3xl text-ink">{m.pendingReviews}</span>
            <span className="text-xs text-steel uppercase tracking-wide2">Google reviews to approve</span>
            <span className="ml-auto text-gold">→</span>
          </button>
          <button onClick={() => navigate('/merchant/customers', { state: { q: todayList('b') } })} className="chip">
            <span className="luxe-title text-3xl">{m.birthdaysToday}</span>
            <span className="text-xs text-steel uppercase tracking-wide2">Birthdays today</span>
            <span className="ml-auto text-gold">→</span>
          </button>
          <button onClick={() => navigate('/merchant/customers', { state: { q: todayList('a') } })} className="chip">
            <span className="luxe-title text-3xl">{m.anniversariesToday}</span>
            <span className="text-xs text-steel uppercase tracking-wide2">Anniversaries pending</span>
            <span className="ml-auto text-gold">→</span>
          </button>
        </div>
      </section>

      {/* Metrics ribbon */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Total customers" value={m.totalCustomers} sub="across all tiers" />
        <Stat label="Loyalty revenue" value={inr(m.loyaltyRevenue)} sub="lifetime (INR)" />
        <Stat label="Points issued" value={m.pointsIssued.toLocaleString('en-IN')} sub="lifetime earned" />
        <Stat label="Pending testimonials" value={m.pendingReviews} sub="awaiting approval" />
      </section>

      {/* Pending review approval */}
      {pending.length > 0 && (
        <section>
          <div className="eyebrow mb-1">Approve & publish</div>
          <h2 className="luxe-title text-2xl mb-4">Google reviews to approve</h2>
          <div className="space-y-3">
            {pending.map((r) => (
              <div key={r.id} className="card px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Stars value={r.stars} size={16} />
                    <span className="text-xs text-steel">{db.users.find((u) => u.id === r.userId)?.name}</span>
                    <span className="text-[10px] text-steel/60">{fmtDate(r.createdAt)}</span>
                  </div>
                  <p className="text-sm text-ink/80">“{r.review_text}”</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setReviewStatus(r.id, 'approved')} className="btn-ink !py-1.5">Approve</button>
                  <button onClick={() => setReviewStatus(r.id, 'resolved')} className="btn-ghost !py-1.5">Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent activity — grouped one row per customer, most-recent-first.
          Clicking a row opens that customer's full history (Ledger, reused
          as-is from Customer CRM) in a modal below. */}
      <section>
        <div className="eyebrow mb-1">Live from your boutique</div>
        <h2 className="luxe-title text-2xl mb-4">Recent activity</h2>
        <div className="card overflow-x-auto">
          <table className="tbl min-w-[560px]">
            <thead>
              <tr><th>Client</th><th>Latest event</th><th>When</th></tr>
            </thead>
            <tbody>
              {feed.map((e) => {
                const a = ACTION[e.type] || ACTION.purchase;
                const name = db.users.find((u) => u.id === e.userId)?.name || 'Boutique';
                return (
                  <tr
                    key={e.userId}
                    onClick={() => setActivityUserId(e.userId)}
                    className="cursor-pointer hover:bg-mist"
                  >
                    <td>
                      <span className={cls('inline-flex h-8 w-8 items-center justify-center border border-line text-xs mr-3', e.type === 'like' && 'text-gold')}>{a.icon}</span>
                      <span className="font-medium text-sm">{name}</span>
                    </td>
                    <td className="text-sm text-ink/75">{e.text}</td>
                    <td className="text-xs text-steel whitespace-nowrap">{timeAgo(e.ts)}</td>
                  </tr>
                );
              })}
              {feed.length === 0 && (
                <tr><td colSpan={3} className="text-sm text-steel text-center py-6">No activity yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-customer full activity history modal — SAME Ledger component/data
          source (customerLedger() + hydratePointsHistory()) as Customer CRM's
          own "Activity ledger" tab; that existing tab is untouched. */}
      {activityUser && (
        <Modal open onClose={() => setActivityUserId(null)} title={`${activityUser.name} — activity history`} wide>
          <Ledger userId={activityUser.id} db={db} />
        </Modal>
      )}
    </div>
  );
}

function todayList(kind) {
  const d = new Date();
  const md = `${d.getMonth() + 1}-${d.getDate()}`;
  // Signals to Customers page via URL hash query — returns a marker string
  return kind === 'b' ? `b:${md}` : `a:${md}`;
}
