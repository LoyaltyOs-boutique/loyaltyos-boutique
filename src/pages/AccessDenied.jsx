import { BRAND } from '../data/seed.js';

export default function AccessDenied() {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-5">
      <div className="w-full max-w-md text-center animate-fadeUp">
        <img src={BRAND.logo} alt="85 Lansdowne" className="h-10 object-contain mx-auto mb-8" />
        <div className="h-px w-16 bg-gold mx-auto mb-8" />
        <div className="eyebrow mb-3">Private client access</div>
        <h1 className="luxe-title text-3xl mb-4">This lookbook is by invitation.</h1>
        <p className="text-steel text-sm leading-relaxed mb-8">
          Every 85 Lansdowne client receives a personal, secure link from our boutique.
          If you believe you should have access, please reach out to us and we'll welcome
          you within moments.
        </p>
        <div className="flex flex-col gap-2 mb-8">
          <a href={`https://wa.me/${BRAND.wa}?text=${encodeURIComponent('Namaste! I would like access to the 85 Lansdowne client lookbook.')}`} target="_blank" rel="noreferrer" className="btn-gold w-full">Request access on WhatsApp</a>
          <a href="mailto:care@85lansdowne.com" className="btn-ghost w-full">Email the boutique</a>
        </div>
        <div className="text-[10px] tracking-wide2 uppercase text-steel">85 Lansdowne · {BRAND.tagline}</div>
      </div>
    </div>
  );
}
