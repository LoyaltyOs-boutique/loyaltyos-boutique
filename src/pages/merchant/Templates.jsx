import { useEffect, useRef, useState } from 'react';
import { getCustomers, uploadTemplateMedia } from '../../lib/db.js';

// Templates — Phase 1 (structure only). Design spec:
// docs/superpowers/specs/2026-08-22-templates-section-phase1-design.md
// Phase 2 (static card-image send) design spec:
// docs/superpowers/specs/2026-08-22-templates-static-card-send-design.md

// One-time Vercel Blob uploads of Ma'am's real card designs (see Phase 2
// spec) — stable public URLs, hardcoded since the images don't change
// per-customer.
// Same-origin OG-preview paths (middleware.js) instead of the raw Blob URLs
// directly — WhatsApp's crawler does not reliably unfurl bare media URLs
// (same discovery as the PDF-lookbook case); these paths serve real OG tags
// to crawlers and redirect real browsers straight to the image.
const ANNIVERSARY_CARD_URL = `${window.location.origin}/templates/card/anniversary`;
const BIRTHDAY_CARD_URL = `${window.location.origin}/templates/card/birthday`;
//
// wa.me requires the full international number (no '+'); customer.mobile is
// stored as bare 10 digits (no country code) — per the spec's resolution,
// prepend '91' here if not already present, same assumption BRAND.wa already
// hardcodes elsewhere in this codebase.
const toWaPhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.startsWith('91') ? digits : `91${digits}`;
};

// Same URL-encoding approach as Catalogue.jsx's waShareLink/waInquireLink —
// https://wa.me/<phone>?text=<encoded message> — reused as-is, not reinvented.
const buildWaLink = (phone, message) =>
  `https://wa.me/${toWaPhone(phone)}?text=${encodeURIComponent(message)}`;

/**
 * Customer-select toggle, shared by all three cards: "Existing customer"
 * (populated from the existing getCustomers query, auto-fills name + mobile)
 * or "New / manual" (merchant types both by hand). Nickname is always a
 * manual field in both modes — no nickname field exists on the customer
 * record (confirmed via audit), so it's never auto-filled or persisted.
 */
function CustomerSelect({ customers, name, setName, phone, setPhone }) {
  const [mode, setMode] = useState('existing'); // 'existing' | 'manual'
  const [selectedId, setSelectedId] = useState('');

  const onSelectExisting = (id) => {
    setSelectedId(id);
    const c = customers.find((x) => x._id === id || x.id === id);
    if (c) {
      setName(c.name || '');
      setPhone(c.mobile || '');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMode('existing')}
          className={mode === 'existing' ? 'btn-ink !py-1 !px-2 text-[9px] flex-1' : 'btn-ghost !py-1 !px-2 text-[9px] flex-1'}
        >
          Existing customer
        </button>
        <button
          type="button"
          onClick={() => setMode('manual')}
          className={mode === 'manual' ? 'btn-ink !py-1 !px-2 text-[9px] flex-1' : 'btn-ghost !py-1 !px-2 text-[9px] flex-1'}
        >
          New / manual
        </button>
      </div>

      {mode === 'existing' ? (
        <div>
          <label className="label">Select customer</label>
          <select className="input" value={selectedId} onChange={(e) => onSelectExisting(e.target.value)}>
            <option value="">Choose…</option>
            {customers.map((c) => (
              <option key={c._id || c.id} value={c._id || c.id}>{c.name} · {c.mobile}</option>
            ))}
          </select>
        </div>
      ) : null}

      <div>
        <label className="label">Full Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label">Phone number</label>
        <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" readOnly={mode === 'existing' && !!selectedId} />
      </div>
    </div>
  );
}

/**
 * Card-image selector — Phase 2 shows exactly one option per card type
 * (Ma'am's real design), structured as an array so more options can be
 * added later without restructuring. Same toggle-button visual pattern as
 * CustomerSelect's Existing/Manual toggle above (verbatim class reuse).
 */
function CardSelect({ options, selectedIdx, onSelect }) {
  return (
    <div>
      <label className="label">Choose a card</label>
      <div className="flex items-center gap-2">
        {options.map((opt, i) => (
          <button
            key={opt.url}
            type="button"
            onClick={() => onSelect(i)}
            className={i === selectedIdx ? 'btn-ink !py-1 !px-2 text-[9px] flex-1' : 'btn-ghost !py-1 !px-2 text-[9px] flex-1'}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Anniversary / Birthday card — identical structure per the spec, only the
 * eyebrow/title/placeholder template/card options differ between instances.
 */
function MomentCard({ eyebrow, title, template, customers, cardOptions }) {
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [selectedCardIdx, setSelectedCardIdx] = useState(0);

  // Auto-fills the message textarea from the hardcoded Phase-1 placeholder
  // whenever name/nickname changes; merchant can still hand-edit it before
  // sending (plain controlled textarea, not locked).
  useEffect(() => {
    const who = nickname.trim() || name.trim() || '{name}';
    setMessage(template.replace('{name}', who));
  }, [name, nickname, template]);

  const send = () => {
    if (!phone.trim() || !message.trim()) return;
    // Card-image URL appended as a new line so WhatsApp unfurls it as a
    // rich preview alongside the merchant's message (Phase 2 spec).
    const cardUrl = cardOptions[selectedCardIdx]?.url;
    const finalMessage = cardUrl ? `${message}\n${cardUrl}` : message;
    window.open(buildWaLink(phone, finalMessage), '_blank');
  };

  return (
    <section className="card p-6">
      <div className="eyebrow mb-1">{eyebrow}</div>
      <h3 className="luxe-title text-lg mb-3">{title}</h3>
      <div className="space-y-3">
        <CustomerSelect customers={customers} name={name} setName={setName} phone={phone} setPhone={setPhone} />
        <div>
          <label className="label">Nickname</label>
          <input className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Optional — used in the message" />
        </div>
        <div>
          <label className="label">Message</label>
          <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        <CardSelect options={cardOptions} selectedIdx={selectedCardIdx} onSelect={setSelectedCardIdx} />
        <button onClick={send} disabled={!phone.trim() || !message.trim()} className="btn-ink w-full">Send via WhatsApp</button>
      </div>
    </section>
  );
}

/** Card 3 — Video/Image/PDF Send, drag-drop + Vercel Blob upload. */
function MediaCard({ customers }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [uploading, setUploading] = useState(false);
  const [mediaUrl, setMediaUrl] = useState('');
  const [msg, setMsg] = useState('');
  const mediaRef = useRef(null);

  const onMediaFile = async (f) => {
    if (!f) return;
    const isAllowed = f.type.startsWith('video/') || f.type.startsWith('image/') || f.type === 'application/pdf';
    if (!isAllowed) { setMsg('Only video, image, or PDF files are supported.'); return; }
    setUploading(true);
    setMsg('Uploading…');
    try {
      const bytes = await f.arrayBuffer();
      const res = await uploadTemplateMedia(bytes, f.name, f.type);
      if (res && res.ok) {
        setMediaUrl(res.url);
        setMsg(`"${f.name}" uploaded.`);
      } else {
        setMsg('Upload failed — please try again.');
      }
    } catch (err) {
      setMsg(`Upload failed: ${err?.message || 'please try again.'}`);
    } finally {
      setUploading(false);
    }
  };

  const send = () => {
    if (!phone.trim() || !mediaUrl) return;
    const text = name.trim() ? `Hi ${name.trim()}! Sharing this with you from 85 Lansdowne: ${mediaUrl}` : `Sharing this with you from 85 Lansdowne: ${mediaUrl}`;
    window.open(buildWaLink(phone, text), '_blank');
  };

  return (
    <section className="card p-6">
      <div className="eyebrow mb-1">Share media</div>
      <h3 className="luxe-title text-lg mb-3">Send media</h3>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onMediaFile(e.dataTransfer.files?.[0]); }}
        onClick={() => mediaRef.current?.click()}
        className="border-2 border-dashed border-line hover:border-gold p-6 text-center cursor-pointer transition-colors"
      >
        <input ref={mediaRef} type="file" accept="video/*,image/*,.pdf" className="hidden" onChange={(e) => onMediaFile(e.target.files?.[0])} />
        <div className="text-2xl mb-2">📎</div>
        <div className="text-sm">Drag & drop a video, image, or PDF</div>
      </div>
      {msg && <div className="text-xs text-gold mt-2">{msg}</div>}
      <div className="space-y-3 mt-4">
        <CustomerSelect customers={customers} name={name} setName={setName} phone={phone} setPhone={setPhone} />
        <button onClick={send} disabled={uploading || !phone.trim() || !mediaUrl} className="btn-ink w-full">Send via WhatsApp</button>
      </div>
    </section>
  );
}

export default function Templates() {
  const [customers, setCustomers] = useState([]);

  useEffect(() => {
    let mounted = true;
    getCustomers().then((rows) => { if (mounted && Array.isArray(rows)) setCustomers(rows); });
    return () => { mounted = false; };
  }, []);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="luxe-title text-3xl">Templates</h1>
        <p className="text-sm text-steel mt-2">Send personal moments and media to your customers on WhatsApp.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <MomentCard
          eyebrow="Personal moment"
          title="Anniversary"
          template="Happy anniversary, {name}! With love, 85 Lansdowne."
          customers={customers}
          cardOptions={[{ label: 'Anniversary card', url: ANNIVERSARY_CARD_URL }]}
        />
        <MomentCard
          eyebrow="Personal moment"
          title="Birthday"
          template="Happy birthday, {name}! With love, 85 Lansdowne."
          customers={customers}
          cardOptions={[{ label: 'Birthday card', url: BIRTHDAY_CARD_URL }]}
        />
        <MediaCard customers={customers} />
      </div>
    </div>
  );
}
