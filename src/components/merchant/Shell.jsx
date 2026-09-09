import { NavLink, useNavigate } from 'react-router-dom';
import {
  clearMerchantSession, getMerchantSession,
  hydrateNotifications, notifications, markAllSeenRemote, deleteNotificationRemote,
  subscribe, generateActivitySummaryRemote, getData,
} from '../../lib/db.js';
import { useEffect, useState } from 'react';
import { cls, timeAgo } from '../../lib/util.js';
import { BRAND } from '../../data/seed.js';
import { Modal } from '../ui.jsx';

const NAV = [
  { to: '/merchant/dashboard', label: 'Delight Desk', icon: '◈' },
  { to: '/merchant/customers', label: 'Customer CRM', icon: '◐' },
  { to: '/merchant/onboarding', label: 'Client Onboarding', icon: '✍' },
  { to: '/merchant/campaigns', label: 'WhatsApp Campaigns', icon: '✆' },
  { to: '/merchant/catalogue', label: 'Lookbook Manager', icon: '❖' },
  { to: '/merchant/templates', label: 'Templates', icon: '▤' },
  { to: '/merchant/points-ledger', label: 'Points Ledger', icon: '✪' },
  { to: '/merchant/settings', label: 'Settings & Support', icon: '✦' },
];

function NavList({ onNavigate }) {
  return (
    <>
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cls(
              'flex items-center gap-3 px-5 py-3 text-[11px] tracking-wide2 uppercase border-l-2 transition-colors',
              isActive ? 'border-ink text-ink bg-mist font-medium' : 'border-transparent text-steel hover:text-ink'
            )
          }
        >
          <span className="text-gold text-sm w-4 text-center">{n.icon}</span>
          {n.label}
        </NavLink>
      ))}
    </>
  );
}

/**
 * Dashboard Notifications bell — design spec:
 * docs/superpowers/specs/2026-09-04-dashboard-notifications-design.md
 *
 * Placement: lives here in Shell.jsx (not Dashboard.jsx) since this file
 * owns the shared header/top bar across every merchant page (§A1/A2 of the
 * design doc) — a new addition to the existing mobile top bar's flex row and
 * a new small top-right row above {children} on desktop, neither a
 * restructure of any existing element.
 *
 * Judgment call: bell glyph is the Unicode "🔔" character, matching this
 * file's existing convention of plain Unicode glyphs for icon-ish UI (the
 * ☰ Menu button, the NAV list's ◈/◐/✍/✆/❖/▤/✪/✦ glyphs) rather than an SVG —
 * no SVG icon set exists in this file to match instead. Sized/colored with
 * the same text-[10px]/btn-ghost convention already used for small icon
 * buttons elsewhere in this file (e.g. the ☰ Menu button).
 */
/**
 * IST fixed offset — same fixed +5:30 assumption already established
 * elsewhere in this codebase today (convex/customers.ts's IST_OFFSET_MS,
 * Customers.jsx's IST_OFFSET_MS/canonicalTomorrowOccasionDate) for 85
 * Lansdowne's real local calendar day. IST has no daylight-saving, so this
 * fixed offset is always correct.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * parseOccasionDate — parses a notification's stored `occasion_date` string
 * into a real Date (UTC midnight of that calendar day), so it can be
 * compared against "today" numerically rather than lexicographically.
 *
 * P2-3 fix (2026-09-09): birthday/anniversary notification rows store
 * `occasion_date` as the canonical "YYYY-M-D" key established by yesterday's
 * P0-1 fix (convex/crons.ts's generateDailyNotifications writes
 * findUpcomingInternal's `hit.occasion_date` straight through — confirmed by
 * reading both files, not assumed). NOTE: weekly_activity rows use a
 * DIFFERENT, year-less "M-D" format (crons.ts's generateWeeklyActivityNotifications
 * mondayDate) — this helper is only ever called from the birthday/anniversary
 * branch below (after the weekly_activity early-return), so that format is
 * never passed here.
 *
 * Returns null on anything unparseable (defensive — old-format pre-P0-1 rows
 * may still exist per that fix's own "no migration" note) so the caller can
 * fall back to today's existing tomorrow-tab behavior rather than crash.
 */
function parseOccasionDate(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((s || '').trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
}

/** Today's real IST calendar date, at UTC midnight (for date-only comparison). */
function istTodayDateOnly() {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()));
}

function NotificationBell() {
  const [, setV] = useState(0);
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [menuFor, setMenuFor] = useState(null); // notification _id whose kebab menu is open, or null

  // Weekly-activity AI summary popup state (2026-09-09 addition) — separate
  // from the existing `open` (notification panel) state so the panel and the
  // summary popup can be independently open/closed. `summaryCustomer` holds
  // { id, name } for the customer the popup is currently showing (or null
  // when closed); `summaryText` is the resolved AI text, `null` while
  // loading is handled via `summaryLoading` and `null` after a genuine
  // Gemini failure is handled via the fallback copy at render time (see
  // FALLBACK_SUMMARY_TEXT below) — `summaryText === null` is ambiguous
  // between "still loading" and "resolved to no summary", which is why a
  // separate summaryLoading boolean exists rather than overloading null.
  const [summaryCustomer, setSummaryCustomer] = useState(null);
  const [summaryText, setSummaryText] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const rows = notifications();
  const unseenCount = rows.filter((n) => !n.seen).length;

  // Refresh-on-mount: same "fetch fresh data when the merchant lands on a
  // page/component" idiom already used across this codebase (e.g.
  // Customers.jsx's `useEffect(() => { hydrateCustomers(); hydrateReviews(); }, [])`)
  // — a light one-shot hydrate, not a polling loop.
  useEffect(() => { hydrateNotifications(); }, []);

  const togglePanel = () => {
    const next = !open;
    setOpen(next);
    setMenuFor(null);
    // "Calling markAllSeen should fire when the panel opens" (task spec) —
    // only on the open transition, not on close.
    if (next && unseenCount > 0) markAllSeenRemote();
  };

  const goToCustomer = (n) => {
    // Weekly-activity notifications (Customer Activity Intelligence Part 2/3,
    // occasion: 'weekly_activity') get their own real behavior — an on-demand
    // AI-summary popup, NOT the birthday/anniversary tab-jump below. Early
    // return so the existing ternary/navigate call for birthday/anniversary
    // is reached ONLY for those two occasion types, completely unchanged.
    if (n.occasion === 'weekly_activity') {
      openActivitySummary(n);
      return;
    }

    // Part A finding: the "Birthdays tomorrow" / "Anniversaries tomorrow" TAB
    // BUTTONS themselves (Customers.jsx's filter-tab array, `setFilter(k)`)
    // use the real filter values 'birthday_tomorrow' / 'anniversary_tomorrow'
    // — a different mechanism from the Dashboard chips' `state.q` search-box
    // marker previously used here. Navigating with `state.tab` set to one of
    // these real values lands directly on that tab (Customers.jsx's
    // filter-initialization line reads `location.state?.tab`), same pattern
    // already used for the Reviews tab-jump.
    //
    // P2-3 fix (2026-09-09): the OLD code below always computed the target
    // tab from TODAY's date via `n.occasion`'s TYPE alone (birthday vs
    // anniversary), never looking at the notification's own stored
    // occasion_date — so clicking an OLD notification after its occasion had
    // already passed landed on the tomorrow-tab as it stands TODAY (now
    // describing a DIFFERENT customer/occasion, or empty), not the one this
    // notification was originally about.
    //
    // Audited (Customers.jsx): the birthday_tomorrow/anniversary_tomorrow
    // tabs are strictly `days_until === 1` against a LIVE getUpcomingBirthdays/
    // getUpcomingAnniversaries(days:1) fetch — structurally "exactly
    // tomorrow, nothing else"; they cannot display a past occasion. So a
    // STALE notification (occasion_date already before today) can never be
    // shown correctly by that tab regardless of which occasion type it
    // encodes — the only correct fallback is to open the customer's CRM
    // record directly, reusing the SAME location.state.selectedCustomerId
    // mechanism the weekly-activity "View Full Profile" button already uses
    // (commit 6c4024b) rather than inventing a new path.
    setOpen(false);
    const occasionDate = parseOccasionDate(n.occasion_date);
    const isStale = occasionDate !== null && occasionDate.getTime() < istTodayDateOnly().getTime();
    if (isStale) {
      navigate('/merchant/customers', { state: { selectedCustomerId: n.customer_id } });
    } else {
      // Fresh notification (occasion still today/upcoming) — or occasion_date
      // was unparseable (defensive fallback) — unchanged existing behavior.
      navigate('/merchant/customers', { state: { tab: n.occasion === 'birthday' ? 'birthday_tomorrow' : 'anniversary_tomorrow' } });
    }
  };

  // Fallback copy shown in the summary popup when generation genuinely
  // resolves to null (a real Gemini failure, not a loading state) — calm,
  // non-alarming wording matching this bell panel's existing plain-string
  // tone (e.g. "No notifications yet.").
  const FALLBACK_SUMMARY_TEXT = 'No summary yet — check back later.';

  /**
   * Opens the AI-summary popup for a weekly_activity notification's customer
   * and kicks off the on-demand fetch (24h-cached server-side, see
   * convex/ai.ts's generateActivitySummaryPublic). The popup's customer name
   * uses the real stored name from the hydrated db.users dataset (getData(),
   * looked up by customer_id — same "full dataset, not a paginated/filtered
   * subset" pattern Customers.jsx's own `active` lookup already relies on),
   * NOT splitName(n.message): splitName only correctly extracts a name from
   * birthday/anniversary-shaped messages ("X's birthday is tomorrow!"), but
   * weekly_activity messages are shaped "X was highly active this week!" —
   * no "'s " substring — so splitName would return the whole message text.
   * splitName's result is kept only as a defensive fallback for the rare case
   * customerDoc isn't found (e.g. hydration timing).
   */
  const openActivitySummary = (n) => {
    const db = getData();
    const customerDoc = db?.users?.find((u) => u.id === n.customer_id);
    const name = customerDoc?.name || splitName(n.message)[0];
    const tier = customerDoc?.tier || 'silver';

    setSummaryCustomer({ id: n.customer_id, name });
    setSummaryText(null);
    setSummaryLoading(true);

    generateActivitySummaryRemote(n.customer_id, name, tier).then((text) => {
      setSummaryLoading(false);
      setSummaryText(text); // null on a genuine failure — rendered via FALLBACK_SUMMARY_TEXT
    });
  };

  const closeActivitySummary = () => {
    setSummaryCustomer(null);
    setSummaryText(null);
    setSummaryLoading(false);
  };

  /**
   * "View Full Profile" button inside the summary popup — navigates to
   * Customer CRM with `location.state.selectedCustomerId` set (the new,
   * additive state key Customers.jsx's `selected` initializer now also
   * checks), then closes BOTH the summary popup and the notification panel
   * so the merchant isn't left with two things open after navigating away.
   */
  const viewFullProfile = () => {
    const customerId = summaryCustomer?.id;
    closeActivitySummary();
    setOpen(false);
    if (customerId) {
      navigate('/merchant/customers', { state: { selectedCustomerId: customerId } });
    }
  };

  const handleDelete = (n) => {
    setMenuFor(null);
    deleteNotificationRemote(n._id);
  };

  // The notifications schema stores no separate `name` field (schema.ts —
  // only customer_id/occasion/occasion_date/message/created_at/seen), and
  // convex/ is out of scope for this task. The backend's message string has
  // a fixed, known template (crons.ts: `${hit.name}'s ${occasion} is
  // tomorrow!`), so the customer's name is the text before "'s " — reused
  // here purely for display/click-target splitting, not sent anywhere.
  const splitName = (message) => {
    const idx = message.indexOf("'s ");
    if (idx === -1) return [message, ''];
    return [message.slice(0, idx), message.slice(idx)];
  };

  return (
    <div className="relative">
      <button
        onClick={togglePanel}
        className="btn-ghost !px-3 !py-1.5 text-[10px] relative"
        aria-label="Notifications"
      >
        <span className="text-lg leading-none">🔔</span>
        {unseenCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" aria-hidden="true" />
        )}
      </button>
      {open && (
        <>
          {/* Backdrop click-to-close — same idiom as the mobile nav drawer below
              (`<div className="absolute inset-0 ..." onClick={close} />`),
              adapted to a small anchored panel instead of a full-screen overlay. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] bg-white border border-line shadow-lg z-50 max-h-96 overflow-y-auto scroll-thin">
            <div className="px-4 py-3 border-b border-line eyebrow">Notifications</div>
            {rows.length === 0 ? (
              <div className="px-4 py-6 text-sm text-steel text-center">No notifications yet.</div>
            ) : (
              rows.map((n) => {
                const [name, rest] = splitName(n.message);
                return (
                <div
                  key={n._id}
                  onClick={() => goToCustomer(n)}
                  className="px-4 py-3 border-b border-line last:border-b-0 flex items-start gap-2 cursor-pointer hover:bg-mist"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">
                      <span className="text-gold font-medium">{name}</span>
                      {rest}
                    </div>
                    <div className="text-[10px] text-steel mt-1">{timeAgo(n.created_at)}</div>
                  </div>
                  <div className="relative shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === n._id ? null : n._id); }}
                      className="text-steel hover:text-ink px-1.5 leading-none text-sm"
                      aria-label="Notification options"
                    >
                      ⋮
                    </button>
                    {menuFor === n._id && (
                      <div className="absolute right-0 top-full mt-1 w-28 bg-white border border-line shadow-lg z-50">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(n); }}
                          className="w-full text-left px-3 py-2 text-[11px] text-steel hover:text-ink hover:bg-mist"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                );
              })
            )}
          </div>
        </>
      )}
      {/* Weekly-activity AI-summary popup (2026-09-09 addition) — reuses the
          EXISTING Modal primitive from ui.jsx (same open/onClose/title/children
          props already used elsewhere in this codebase), not a new popup
          component. Rendered as a sibling here so it can be open independently
          of the notification panel above (`open` state). */}
      {summaryCustomer && (
        <Modal open onClose={closeActivitySummary} title={summaryCustomer.name}>
          <div className="space-y-4">
            <p className="text-sm text-ink leading-relaxed">
              {summaryLoading ? 'Generating summary…' : (summaryText || FALLBACK_SUMMARY_TEXT)}
            </p>
            <button
              onClick={viewFullProfile}
              className="btn-ink w-full justify-center !py-2"
            >
              View Full Profile
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function Shell({ children }) {
  const navigate = useNavigate();
  const [me] = useState(() => getMerchantSession());
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const signOut = () => { clearMerchantSession(); navigate('/login'); };

  return (
    <div className="min-h-screen bg-mist">
      {/* Mobile top bar */}
      <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between bg-white border-b border-line px-4 py-3">
        <img src={BRAND.logo} alt="85 Lansdowne" className="h-7 object-contain" />
        <div className="flex items-center gap-2">
          <NotificationBell />
          <button onClick={() => setOpen(true)} className="btn-ink !px-3 !py-1.5 text-[10px]">☰ Menu</button>
        </div>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 bg-white border-r border-line flex-col z-30">
        <div className="px-5 py-6 border-b border-line">
          <img src={BRAND.logo} alt="85 Lansdowne" className="h-8 object-contain" />
          <div className="eyebrow mt-3">LoyaltyOS · Boutique CRM</div>
        </div>
        <nav className="flex-1 py-4 overflow-y-auto scroll-thin">
          <NavList />
        </nav>
        <div className="px-5 py-5 border-t border-line">
          <div className="eyebrow mb-2">{me ? me.name : 'Owner'}</div>
          <button onClick={signOut} className="btn-ghost w-full justify-center !py-2">Sign out</button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={close} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white border-r border-line flex flex-col animate-fadeUp">
            <div className="px-5 py-5 border-b border-line flex items-center justify-between">
              <img src={BRAND.logo} alt="85 Lansdowne" className="h-7 object-contain" />
              <button onClick={close} className="text-2xl text-steel hover:text-ink leading-none cursor-pointer">×</button>
            </div>
            <nav className="flex-1 py-3 overflow-y-auto scroll-thin">
              <NavList onNavigate={close} />
            </nav>
            <div className="px-5 py-5 border-t border-line">
              <div className="eyebrow mb-2">{me ? me.name : 'Owner'}</div>
              <button onClick={signOut} className="btn-ghost w-full justify-center !py-2">Sign out</button>
            </div>
          </aside>
        </div>
      )}

      {/* Content */}
      <main className="lg:ml-60">
        {/* Desktop-only top-right row (no persistent desktop top strip existed
            before this — a pure addition, not a resize/restructure of the
            sidebar or any existing element). Same max-w-6xl mx-auto px-4
            sm:px-6 content-width wrapper as {children} below, so the bell
            aligns with existing page content instead of floating at an
            arbitrary width. */}
        <div className="hidden lg:flex max-w-6xl mx-auto px-4 sm:px-6 pt-6 justify-end">
          <NotificationBell />
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
