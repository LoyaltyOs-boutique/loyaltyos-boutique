import { NavLink, useNavigate } from 'react-router-dom';
import {
  clearMerchantSession, getMerchantSession,
  hydrateNotifications, notifications, markAllSeenRemote, deleteNotificationRemote,
  subscribe,
} from '../../lib/db.js';
import { useEffect, useState } from 'react';
import { cls, timeAgo } from '../../lib/util.js';
import { BRAND } from '../../data/seed.js';

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
function NotificationBell() {
  const [, setV] = useState(0);
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [menuFor, setMenuFor] = useState(null); // notification _id whose kebab menu is open, or null

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
    // Part A finding: the "Birthdays tomorrow" / "Anniversaries tomorrow" TAB
    // BUTTONS themselves (Customers.jsx's filter-tab array, `setFilter(k)`)
    // use the real filter values 'birthday_tomorrow' / 'anniversary_tomorrow'
    // — a different mechanism from the Dashboard chips' `state.q` search-box
    // marker previously used here. Navigating with `state.tab` set to one of
    // these real values lands directly on that tab (Customers.jsx's
    // filter-initialization line reads `location.state?.tab`), same pattern
    // already used for the Reviews tab-jump.
    //
    // Trade-off (accepted): the target tab is computed from TODAY's date, not
    // this notification's stored occasion_date, so this only shows the
    // customer if their occasion is STILL literally tomorrow at click-time —
    // unlike the old `q`-marker approach, which matched the stored date
    // directly regardless of how old the notification was.
    setOpen(false);
    navigate('/merchant/customers', { state: { tab: n.occasion === 'birthday' ? 'birthday_tomorrow' : 'anniversary_tomorrow' } });
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
