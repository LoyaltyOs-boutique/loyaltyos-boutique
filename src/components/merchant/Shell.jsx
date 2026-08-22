import { NavLink, useNavigate } from 'react-router-dom';
import { clearMerchantSession, getMerchantSession } from '../../lib/db.js';
import { useState } from 'react';
import { cls } from '../../lib/util.js';
import { BRAND } from '../../data/seed.js';

const NAV = [
  { to: '/merchant/dashboard', label: 'Delight Desk', icon: '◈' },
  { to: '/merchant/customers', label: 'Customer CRM', icon: '◐' },
  { to: '/merchant/onboarding', label: 'Client Onboarding', icon: '✍' },
  { to: '/merchant/campaigns', label: 'WhatsApp Campaigns', icon: '✆' },
  { to: '/merchant/catalogue', label: 'Lookbook Manager', icon: '❖' },
  { to: '/merchant/templates', label: 'Templates', icon: '▤' },
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
        <button onClick={() => setOpen(true)} className="btn-ink !px-3 !py-1.5 text-[10px]">☰ Menu</button>
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
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
