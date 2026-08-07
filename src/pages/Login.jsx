import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { BRAND } from '../data/seed.js';
import { merchantLogin, merchantByEmail, saveMerchantSession, resetDemo } from '../lib/db.js';
import { cls } from '../lib/util.js';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState('login'); // login | forgot | sent
  const [fpEmail, setFpEmail] = useState('');
  const [resetLink, setResetLink] = useState('');

  const submit = (e) => {
    e.preventDefault();
    const u = merchantLogin(email, password);
    if (!u) { setError('Incorrect email or password.'); return; }
    saveMerchantSession(u.id);
    navigate(location.state?.from?.pathname || '/merchant/dashboard', { replace: true });
  };

  const sendReset = (e) => {
    e.preventDefault();
    const u = merchantByEmail(fpEmail);
    const link = `/reset?token=${Math.random().toString(36).slice(2, 12)}&email=${encodeURIComponent(fpEmail)}`;
    if (u) {
      setResetLink(link);
      setMode('sent');
      console.log(`🔐 [Mock] Password reset token for ${u.email}: ${link}`);
    } else {
      setResetLink(link); // don't leak account existence — still show sent
      setMode('sent');
    }
  };

  return (
    <div className="min-h-screen bg-paper flex">
      <div className="hidden lg:flex w-1/2 bg-ink text-white flex-col justify-between p-12">
        <img src={BRAND.logo} alt="85 Lansdowne" className="h-9 object-contain" />
        <div>
          <div className="eyebrow text-gold mb-4">Boutique Owner Portal</div>
          <h1 className="luxe-title text-4xl leading-tight">Every client, every fitting, every detail — in one calm desk.</h1>
          <div className="mt-10 space-y-4 text-sm text-white/60">
            <div className="flex gap-3"><span className="text-gold">◈</span>Delight Desk with daily client rituals</div>
            <div className="flex gap-3"><span className="text-gold">◐</span>Private profiling & staff notes</div>
            <div className="flex gap-3"><span className="text-gold">✆</span>Segmented WhatsApp campaigns</div>
            <div className="flex gap-3"><span className="text-gold">✦</span>Tier-based loyalty rules</div>
          </div>
        </div>
        <div className="text-[10px] tracking-wide2 uppercase text-white/30">85 Lansdowne · LoyaltyOS</div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm animate-fadeUp">
          <div className="lg:hidden mb-8 text-center">
            <img src={BRAND.logo} alt="85 Lansdowne" className="h-8 object-contain mx-auto" />
          </div>
          {mode === 'login' && (
            <>
              <div className="eyebrow mb-2">Merchant sign in</div>
              <h2 className="luxe-title text-3xl mb-8">Welcome back.</h2>
              <form onSubmit={submit} className="space-y-4">
                <div><label className="label">Email</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@boutique.in" required /></div>
                <div><label className="label">Password</label><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required /></div>
                {error && <div className="text-xs text-red-500">{error}</div>}
                <button className="btn-ink w-full">Sign in to your boutique</button>
              </form>
              <button onClick={() => { setMode('forgot'); setFpEmail(''); }} className="mt-5 text-xs tracking-wide2 uppercase text-steel hover:text-ink cursor-pointer">
                Forgot password?
              </button>
              <div className="mt-8 border border-dashed border-line p-4 text-xs text-steel">
                <div><span className="font-medium text-ink">Demo credentials</span> — owner@boutique.in / owner123</div>
                <button
                  type="button"
                  onClick={() => { if (confirm('Reset all demo data and reload? This clears this browser\'s local copies of customers, orders, and settings.')) { resetDemo(); window.location.reload(); } }}
                  className="mt-3 text-[10px] tracking-wide2 uppercase text-gold hover:text-ink cursor-pointer"
                >
                  ↺ Reset demo data
                </button>
              </div>
            </>
          )}

          {mode === 'forgot' && (
            <>
              <div className="eyebrow mb-2">Reset password</div>
              <h2 className="luxe-title text-3xl mb-8">No worries at all.</h2>
              <form onSubmit={sendReset} className="space-y-4">
                <div><label className="label">Boutique email</label><input className="input" type="email" value={fpEmail} onChange={(e) => setFpEmail(e.target.value)} placeholder="owner@boutique.in" required /></div>
                <button className="btn-ink w-full">Send recovery link</button>
              </form>
              <button onClick={() => setMode('login')} className="mt-5 text-xs tracking-wide2 uppercase text-steel hover:text-ink cursor-pointer">← Back to sign in</button>
            </>
          )}

          {mode === 'sent' && (
            <div className="text-center animate-fadeUp">
              <div className="text-4xl mb-4">✉️</div>
              <h2 className="luxe-title text-3xl mb-3">Check your inbox.</h2>
              <p className="text-sm text-steel mb-6">If <span className="text-ink">{fpEmail}</span> is registered, a secure recovery link has been sent. For this prototype, the tokenized link is below:</p>
              <div className="bg-mist border border-line p-3 text-xs break-all text-gold mb-6">{resetLink}</div>
              <button onClick={() => setMode('login')} className="btn-ink w-full">Back to sign in</button>
            </div>
          )}

          <div className="mt-10 text-center">
            <Link to="/lookbook" className="text-[10px] tracking-wide2 uppercase text-steel hover:text-ink">← Client lookbook portal</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
