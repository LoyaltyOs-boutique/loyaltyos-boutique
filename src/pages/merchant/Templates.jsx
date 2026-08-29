import { useEffect, useRef, useState } from 'react';
import { getCustomers, uploadTemplateMedia, getTemplateCardUrls, setTemplateCardUrl, getWhatsAppTemplates, getWhatsAppTemplateConfig, setWhatsAppTemplateConfig, sendWhatsAppTemplateMessage, sendWhatsAppServiceMessage } from '../../lib/db.js';

// Templates — Phase 1 (structure only). Design spec:
// docs/superpowers/specs/2026-08-22-templates-section-phase1-design.md
// Phase 2 (static card-image send) design spec:
// docs/superpowers/specs/2026-08-22-templates-static-card-send-design.md
// Phase 3 (merchant-replaceable card images) design spec:
// docs/superpowers/specs/2026-08-22-templates-phase3-replaceable-cards-design.md

// Same-origin OG-preview paths (middleware.js) instead of the raw Blob URLs
// directly — WhatsApp's crawler does not reliably unfurl bare media URLs
// (same discovery as the PDF-lookbook case); these paths serve real OG tags
// to crawlers and redirect real browsers straight to the image. These do
// NOT need to change for Phase 3 — middleware.js now resolves them to the
// CURRENT live card URL at request time (settings.getTemplateCardUrls), so
// the stable same-origin path already always reflects a merchant's
// replacement without any change here.
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
 * Anniversary / Birthday card — identical structure per the spec, only the
 * eyebrow/title/placeholder template/card options differ between instances.
 *
 * Phase 3: cardType is hardcoded per call site ('anniversary' or
 * 'birthday' — never derived from shared/ambiguous state), so the
 * "Replace card" control structurally cannot cross-contaminate the two
 * types. currentImageUrl is the live active Blob URL (fetched once by the
 * parent), shown as a preview so the merchant can see what's actually
 * active — separate from cardOptions[].url, which stays the stable
 * same-origin /templates/card/... path used for the wa.me send (unchanged
 * by Phase 3 — middleware.js resolves it live).
 */
function MomentCard({ eyebrow, title, template, customers, cardOptions, cardType, currentImageUrl, waTemplate, templateConfig }) {
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState('');

  // Merchant-configured promo copy (Discount%, Coupon Code, Valid Days) —
  // local controlled state synced from the parent-fetched templateConfig
  // prop, saved when a field loses focus (not per keystroke — see design
  // spec's locked "field save timing" decision: avoids a Convex
  // read-merge-write mutation firing per character and avoids two
  // overlapping writes racing and dropping a character).
  const [discountPercent, setDiscountPercent] = useState(templateConfig?.discountPercent || '');
  const [couponCode, setCouponCode] = useState(templateConfig?.couponCode || '');
  const [validDays, setValidDays] = useState(templateConfig?.validDays || '');
  useEffect(() => {
    setDiscountPercent(templateConfig?.discountPercent || '');
    setCouponCode(templateConfig?.couponCode || '');
    setValidDays(templateConfig?.validDays || '');
  }, [templateConfig]);

  // Fires once per field-exit, sending the FULL three-field object every
  // time (setWhatsAppTemplateConfig's config arg replaces the whole shape,
  // not a partial patch) — reads current local state via the closure at
  // field-exit time, so all three fields share one handler.
  const saveTemplateConfig = () => {
    setWhatsAppTemplateConfig(cardType, { discountPercent, couponCode, validDays }).catch(() => {});
  };

  // Local optimistic copy of the active image — initialized from the
  // parent's fetched value, updated immediately after a successful replace.
  const [activeImageUrl, setActiveImageUrl] = useState(currentImageUrl || '');
  useEffect(() => { setActiveImageUrl(currentImageUrl || ''); }, [currentImageUrl]);

  const [replacing, setReplacing] = useState(false);
  const [replaceMsg, setReplaceMsg] = useState('');
  const replaceRef = useRef(null);

  const onReplaceFile = async (f) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { setReplaceMsg('Only image files are supported.'); return; }
    if (f.size > 5 * 1024 * 1024) { setReplaceMsg('Image is too large (over 5MB) — please use a smaller file.'); return; }
    setReplacing(true);
    setReplaceMsg('Uploading…');
    try {
      const bytes = await f.arrayBuffer();
      const res = await uploadTemplateMedia(bytes, f.name, f.type);
      if (res && res.ok) {
        await setTemplateCardUrl(cardType, res.url); // cardType hardcoded per instance — never the other type
        setActiveImageUrl(res.url); // optimistic — next send already uses the live-resolved same-origin path
        setReplaceMsg('Card replaced.');
      } else {
        setReplaceMsg('Upload failed — please try again.');
      }
    } catch (err) {
      setReplaceMsg(`Upload failed: ${err?.message || 'please try again.'}`);
    } finally {
      setReplacing(false);
    }
  };

  // Auto-fills the message textarea from the hardcoded Phase-1 placeholder
  // whenever name/nickname changes; merchant can still hand-edit it before
  // sending (plain controlled textarea, not locked).
  useEffect(() => {
    const who = nickname.trim() || name.trim() || '{name}';
    setMessage(template.replace('{name}', who));
  }, [name, nickname, template]);

  // Card-image URL — same-origin OG-preview path (middleware.js resolves it
  // to the current live card at request time), unchanged by this task.
  const cardUrl = cardOptions[0]?.url;

  // wa.me fallback — EXACTLY today's behavior, unchanged. Used both when no
  // Cloud API template is configured yet (skip straight here) and when the
  // Cloud API attempt fails for any reason (missing secrets, Meta rejection,
  // network error).
  const openWaLinkFallback = () => {
    const finalMessage = cardUrl ? `${message}\n${cardUrl}` : message;
    window.open(buildWaLink(phone, finalMessage), '_blank');
  };

  const send = async () => {
    if (!phone.trim() || !message.trim()) return;

    // No template configured for this card type yet → skip the Cloud API
    // attempt entirely, go straight to wa.me (expected state until
    // Ma'am/Saidul approve real templates in WhatsApp Manager — not an error).
    if (!waTemplate) {
      openWaLinkFallback();
      return;
    }

    // Template IS configured → try the Cloud API send first.
    // bodyParams: [name] only — a single fixed positional param is safer
    // than [name, nickname] until real approved templates exist (nickname
    // is often empty). Follow-up: revisit bodyParams shape once real
    // templates are created/approved in WhatsApp Manager.
    setSending(true);
    setSendMsg('Sending…');
    try {
      await sendWhatsAppTemplateMessage(phone, waTemplate.name, waTemplate.language, cardUrl, [name.trim() || '{name}']);
      setSendMsg('Sent via WhatsApp');
    } catch (err) {
      // Any failure (Meta rejection, network error, etc.) → fall back to the
      // exact same wa.me link-open as today. Subtle note, not an alarm.
      openWaLinkFallback();
      setSendMsg('Sent via WhatsApp link');
    } finally {
      setSending(false);
    }
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
        <div>
          <label className="label">Discount %</label>
          <input className="input" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} onBlur={saveTemplateConfig} />
        </div>
        <div>
          <label className="label">Coupon code</label>
          <input className="input" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} onBlur={saveTemplateConfig} />
        </div>
        <div>
          <label className="label">Valid for (days)</label>
          <input className="input" value={validDays} onChange={(e) => setValidDays(e.target.value)} onBlur={saveTemplateConfig} />
        </div>
        <div>
          <label className="label">Replace card</label>
          {activeImageUrl && <img src={activeImageUrl} alt="Current card" className="mt-1 mb-2 h-28 w-full object-cover border border-line" />}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onReplaceFile(e.dataTransfer.files?.[0]); }}
            onClick={() => replaceRef.current?.click()}
            className="border-2 border-dashed border-line hover:border-gold p-6 text-center cursor-pointer transition-colors"
          >
            <input ref={replaceRef} type="file" accept="image/*" className="hidden" onChange={(e) => onReplaceFile(e.target.files?.[0])} />
            <div className="text-2xl mb-2">📎</div>
            <div className="text-sm">Drag & drop a new card image</div>
          </div>
          {replaceMsg && <div className="text-xs text-gold mt-2">{replaceMsg}</div>}
        </div>
        <button onClick={send} disabled={!phone.trim() || !message.trim() || replacing || sending} className="btn-ink w-full">Send via WhatsApp</button>
        {sendMsg && <div className="text-xs text-gold mt-2">{sendMsg}</div>}
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
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState('');
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

  const buildMediaText = () =>
    name.trim() ? `Hi ${name.trim()}! Sharing this with you from 85 Lansdowne: ${mediaUrl}` : `Sharing this with you from 85 Lansdowne: ${mediaUrl}`;

  // wa.me fallback — EXACTLY today's behavior, unchanged.
  const openWaLinkFallback = () => {
    window.open(buildWaLink(phone, buildMediaText()), '_blank');
  };

  const send = async () => {
    if (!phone.trim() || !mediaUrl) return;
    // Always attempt the Cloud API service message first (Decision 1: no
    // template-configured check needed — service messages don't require a
    // pre-approved template, only an open 24h customer service window).
    setSending(true);
    setSendMsg('Sending…');
    try {
      await sendWhatsAppServiceMessage(phone, 'text', buildMediaText());
      setSendMsg('Sent via WhatsApp');
    } catch (err) {
      // ANY failure (including the expected "no open 24h service window"
      // Meta rejection) → fall back to the existing wa.me link-open exactly
      // as today. Subtle note, not an alarm.
      openWaLinkFallback();
      setSendMsg("Sent via WhatsApp link instead — customer hasn't messaged recently");
    } finally {
      setSending(false);
    }
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
        <button onClick={send} disabled={uploading || sending || !phone.trim() || !mediaUrl} className="btn-ink w-full">Send via WhatsApp</button>
        {sendMsg && <div className="text-xs text-gold mt-2">{sendMsg}</div>}
      </div>
    </section>
  );
}

export default function Templates() {
  const [customers, setCustomers] = useState([]);
  const [cardUrls, setCardUrls] = useState({ anniversary: '', birthday: '' });
  const [waTemplates, setWaTemplates] = useState({ anniversary: null, birthday: null });
  const [templateConfig, setTemplateConfigState] = useState({
    anniversary: { discountPercent: '', couponCode: '', validDays: '' },
    birthday: { discountPercent: '', couponCode: '', validDays: '' },
  });

  useEffect(() => {
    let mounted = true;
    getCustomers().then((rows) => { if (mounted && Array.isArray(rows)) setCustomers(rows); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    getTemplateCardUrls().then((urls) => { if (mounted && urls) setCardUrls(urls); });
    return () => { mounted = false; };
  }, []);

  // WhatsApp Cloud API: fetch which (if any) template is configured for each
  // moment type. null = not configured yet (expected state) — MomentCard uses
  // this to decide whether to attempt the Cloud API send or skip straight to
  // the wa.me fallback. Same fetch-on-mount pattern as getTemplateCardUrls above.
  useEffect(() => {
    let mounted = true;
    getWhatsAppTemplates().then((tpls) => { if (mounted && tpls) setWaTemplates(tpls); });
    return () => { mounted = false; };
  }, []);

  // Merchant-configured promo copy (Discount%, Coupon Code, Valid Days) for
  // Anniversary/Birthday — fetched once on mount, same pattern as
  // getTemplateCardUrls/getWhatsAppTemplates above.
  useEffect(() => {
    let mounted = true;
    getWhatsAppTemplateConfig().then((cfg) => { if (mounted && cfg) setTemplateConfigState(cfg); });
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
          cardType="anniversary"
          currentImageUrl={cardUrls.anniversary}
          waTemplate={waTemplates.anniversary}
          templateConfig={templateConfig.anniversary}
        />
        <MomentCard
          eyebrow="Personal moment"
          title="Birthday"
          template="Happy birthday, {name}! With love, 85 Lansdowne."
          customers={customers}
          cardOptions={[{ label: 'Birthday card', url: BIRTHDAY_CARD_URL }]}
          cardType="birthday"
          currentImageUrl={cardUrls.birthday}
          waTemplate={waTemplates.birthday}
          templateConfig={templateConfig.birthday}
        />
        <MediaCard customers={customers} />
      </div>
    </div>
  );
}
