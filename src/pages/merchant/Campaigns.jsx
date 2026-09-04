import { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { getData, subscribe, customers, dispatchCampaign, getLookbooksForSelector, getEvents, createEvent, generateEventDraftRemote, dispatchEventRemote } from '../../lib/db.js';
import { cls, fmtDate, inr } from '../../lib/util.js';
import { Toggle, Tag, Empty } from '../../components/ui.jsx';

const useDb = () => {
  const [, setV] = useState(0);
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  return getData();
};

const FALLBACK_IMG = 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/s1.jpg?v=1721195709';

export default function Campaigns() {
  const db = useDb();
  const [title, setTitle] = useState('Festive Saree Edit');
  const [body, setBody] = useState('Namaste {client_name}, our new festive saree edit has arrived at 85 Lansdowne. We kept a few pieces aside for you. ✨');
  const [img, setImg] = useState(FALLBACK_IMG);
  const [tiers, setTiers] = useState({ silver: true, gold: true, platinum: true });
  const [minPoints, setMinPoints] = useState('');
  const [useMinPoints, setUseMinPoints] = useState(false);
  const [tags, setTags] = useState([]);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(null);
  const fileRef = useRef(null);

  // Event Setter (Phase 5, Feature C) — fully independent of the Creative
  // Flyer / Dispatch campaign state above: own fields, own dispatch state,
  // own handler. Nothing here is read or written by the campaign flow.
  const [eventTitle, setEventTitle] = useState('');
  const [eventDesigner, setEventDesigner] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [eventAudience, setEventAudience] = useState('all'); // 'all' | 'vvip'
  const [eventDescription, setEventDescription] = useState('');
  const [eventMessage, setEventMessage] = useState('');
  const [eventLookbookOptions, setEventLookbookOptions] = useState([]);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [eventSending, setEventSending] = useState(false);
  const [eventDone, setEventDone] = useState(null); // dispatch result summary or null
  const [eventCreateError, setEventCreateError] = useState('');
  const [events, setEvents] = useState([]);

  // Designer options — reuses Catalogue.jsx's exact getLookbooksForSelector()
  // pattern (thin {_id, name, kind} projection), filtered to non-PDF designer
  // lookbooks the same way Catalogue.jsx's designerLookbooks does.
  useEffect(() => {
    let mounted = true;
    getLookbooksForSelector().then((rows) => { if (mounted && Array.isArray(rows)) setEventLookbookOptions(rows); });
    return () => { mounted = false; };
  }, []);
  const eventDesignerLookbooks = eventLookbookOptions.filter((lb) => lb.kind !== 'pdf');

  const refreshEvents = () => { getEvents().then((rows) => { if (Array.isArray(rows)) setEvents(rows); }); };
  useEffect(() => { refreshEvents(); }, []);

  const eventFieldsMissing = !eventTitle.trim() || !eventDesigner || !eventDate || !eventTime;

  const generateDraft = async () => {
    setDraftBusy(true);
    setDraftError('');
    // Create (or reuse) the draft event first — generateEventDraft needs a
    // persisted eventId to read title/designer/description from.
    const eventDatetime = new Date(`${eventDate}T${eventTime}`).getTime();
    const res = await createEvent({
      designer_name: eventDesigner,
      event_datetime: Number.isFinite(eventDatetime) ? eventDatetime : Date.now(),
      vvip_only: eventAudience === 'vvip',
      description: eventDescription,
    });
    if (!res.ok || !res.event) {
      setDraftBusy(false);
      setDraftError("Couldn't generate a draft — try again or write your own.");
      return;
    }
    const draft = await generateEventDraftRemote(res.event._id || res.event.id, eventTitle);
    setDraftBusy(false);
    if (!draft) {
      setDraftError("Couldn't generate a draft — try again or write your own.");
      return;
    }
    setEventMessage(draft);
    refreshEvents();
  };

  const dispatchEventSetter = async () => {
    setEventSending(true);
    setEventCreateError('');
    const eventDatetime = new Date(`${eventDate}T${eventTime}`).getTime();
    const created = await createEvent({
      designer_name: eventDesigner,
      event_datetime: Number.isFinite(eventDatetime) ? eventDatetime : Date.now(),
      vvip_only: eventAudience === 'vvip',
      description: eventDescription,
      ...(eventMessage.trim() ? { draft_text: eventMessage.trim() } : {}),
    });
    if (!created.ok || !created.event) {
      setEventSending(false);
      setEventCreateError('Could not save the event — please try again.');
      return;
    }
    const eventId = created.event._id || created.event.id;
    const dispatchRes = await dispatchEventRemote(eventId);
    setEventSending(false);
    if (!dispatchRes.ok) {
      setEventCreateError(dispatchRes.error || 'Dispatch failed — please try again.');
      return;
    }
    setEventDone(dispatchRes);
    confetti({ particleCount: 140, spread: 100, origin: { y: 0.3 }, colors: ['#C5A880', '#111111', '#E9DFCF'] });
    refreshEvents();
  };

  const targets = customers().filter((c) => {
    if (!tiers[c.tier]) return false;
    if (useMinPoints && c.points < Number(minPoints || 0)) return false;
    if (tags.length && !tags.some((t) => (c.custom_tags || []).includes(t))) return false;
    return true;
  });

  const toggleTag = (t) => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]));
  const allTags = [...new Set(customers().flatMap((c) => c.custom_tags || []))];

  const onFile = (f) => {
    if (!f || !f.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => setImg(r.result);
    r.readAsDataURL(f);
  };

  const dispatch = () => {
    setSending(true);
    setTimeout(() => {
      dispatchCampaign({ title, creative_url: img, message_body: body, audience_segment: { tiers, minPoints: useMinPoints ? Number(minPoints) : null, tags }, targets });
      setSending(false);
      setDone(targets.length);
      confetti({ particleCount: 140, spread: 100, origin: { y: 0.3 }, colors: ['#C5A880', '#111111', '#E9DFCF'] });
    }, 1600);
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-1">WhatsApp broadcaster</div>
        <h1 className="luxe-title text-3xl">Campaigns</h1>
        <p className="text-sm text-steel mt-2">Compose once, preview it on the phone, dispatch to a precise segment.</p>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-8">
        {/* Left — configuration */}
        <div className="space-y-6">
          <section className="card p-6">
            <div className="eyebrow mb-4">0 · Event setter</div>
            <div>
              <label className="label">Event title</label>
              <input className="input" value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} placeholder="e.g. Autumn Preview Evening" />
            </div>
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              <div>
                <label className="label">Designer</label>
                <select className="input" value={eventDesigner} onChange={(e) => setEventDesigner(e.target.value)}>
                  <option value="">Select a designer…</option>
                  {eventDesignerLookbooks.map((lb) => <option key={lb._id} value={lb.name}>{lb.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Date</label>
                  <input type="date" className="input" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
                </div>
                <div>
                  <label className="label">Time</label>
                  <input type="time" className="input" value={eventTime} onChange={(e) => setEventTime(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="mt-3">
              <div className="label">Audience</div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEventAudience('all')} className={eventAudience === 'all' ? 'btn-gold' : 'btn-ghost'}>All customers</button>
                <button type="button" onClick={() => setEventAudience('vvip')} className={eventAudience === 'vvip' ? 'btn-gold' : 'btn-ghost'}>VVIP only</button>
              </div>
            </div>
            <div className="mt-3">
              <label className="label">Description</label>
              <textarea className="input min-h-[130px]" value={eventDescription} onChange={(e) => setEventDescription(e.target.value)} placeholder="What should clients know about this event?" />
            </div>
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <label className="label !mb-0">Message</label>
                <button type="button" onClick={generateDraft} disabled={draftBusy || eventFieldsMissing} className="btn-ghost !py-1.5 text-[10px] disabled:opacity-40">
                  {draftBusy ? 'Generating…' : 'Generate AI Draft'}
                </button>
              </div>
              <textarea className="input min-h-[130px] mt-1" value={eventMessage} onChange={(e) => setEventMessage(e.target.value)} placeholder="Invitation message sent to the audience above" />
              {draftError && <div className="text-xs text-steel mt-1">{draftError}</div>}
            </div>
            <div className="flex items-center justify-between gap-4 mt-4">
              <div className="text-xs text-steel">{eventAudience === 'vvip' ? 'Sent to consented VVIP customers only' : 'Sent to all consented customers'}</div>
              <button onClick={dispatchEventSetter} disabled={eventSending || eventFieldsMissing} className="btn-gold disabled:opacity-40">
                {eventSending ? <><span className="h-3 w-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Dispatching…</> : 'Dispatch Event'}
              </button>
            </div>
            {eventCreateError && <div className="text-xs text-red-600 mt-2">{eventCreateError}</div>}
            {eventDone !== null && (
              <div className="text-sm text-gold animate-fadeUp mt-2">✓ Event dispatched to {eventDone.sentCount ?? 0} of {eventDone.recipientCount ?? 0} recipients.</div>
            )}

            {/* Past/upcoming events — minimal list, reused getEvents() rows. */}
            <div className="mt-5 pt-4 border-t border-line">
              <div className="text-[10px] tracking-wide2 uppercase text-steel mb-2">Events</div>
              {events.length ? (
                <div className="space-y-1">
                  {events.map((ev) => (
                    <div key={ev.id} className="text-sm text-steel flex items-center justify-between gap-2">
                      <span>{ev.designer_name} · {new Date(ev.event_datetime).toLocaleString()}</span>
                      <span className="text-[10px] tracking-wide2 uppercase">{ev.status}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="text-sm text-steel">No events yet.</div>}
            </div>
          </section>

          <section className="card p-6">
            <div className="eyebrow mb-4">1 · Creative flyer</div>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-line hover:border-gold p-6 text-center cursor-pointer transition-colors"
            >
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              <div className="text-2xl mb-2">🖼</div>
              <div className="text-sm">Drag & drop a flyer, or click to browse</div>
              <div className="text-xs text-steel mt-1">PNG / JPG — shown at the top of the WhatsApp message</div>
              {img && <img src={img} alt="flyer preview" className="mt-4 h-28 object-cover border border-line mx-auto" />}
            </div>
            <div className="mt-3">
              <label className="label">Campaign title</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </section>

          <section className="card p-6">
            <div className="eyebrow mb-4">2 · Message copy</div>
            <label className="label">WhatsApp message</label>
            <textarea className="input min-h-[130px]" value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="text-xs text-steel mt-2">Variables — <code className="bg-mist px-1">{'{client_name}'}</code> is replaced with each client's first name.</div>
          </section>

          <section className="card p-6">
            <div className="eyebrow mb-4">3 · Audience segment</div>
            <div className="label">Tiers</div>
            <div className="flex gap-2 mb-4">
              {['silver', 'gold', 'platinum'].map((t) => (
                <button key={t} onClick={() => setTiers((x) => ({ ...x, [t]: !x[t] }))} className={cls('px-4 py-2 border text-[11px] tracking-wide2 uppercase transition-colors', tiers[t] ? 'border-ink bg-ink text-white' : 'border-line text-steel hover:border-ink')}>
                  {t}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between border border-line px-4 py-3 mb-4">
              <div className="text-sm">Only clients with more than <input className="input !w-20 inline-block !px-2 !py-1 mx-1" type="number" value={minPoints} onChange={(e) => setMinPoints(e.target.value)} placeholder="500" /> points</div>
              <Toggle on={useMinPoints} onChange={setUseMinPoints} />
            </div>
            <div className="label">Owner experience-tags</div>
            {allTags.length ? (
              <div className="flex gap-2 flex-wrap">
                {allTags.map((t) => (
                  <button key={t} onClick={() => toggleTag(t)} className={cls('px-3 py-1.5 border text-[11px] tracking-wide2 uppercase transition-colors', tags.includes(t) ? 'border-gold bg-gold-soft/40 text-ink' : 'border-line text-steel hover:border-gold')}>
                    {t}
                  </button>
                ))}
              </div>
            ) : <Empty>No custom tags yet — tag clients from their profile.</Empty>}
          </section>

          <div className="card p-6 flex items-center justify-between gap-4">
            <div>
              <div className="luxe-title text-2xl">{targets.length}</div>
              <div className="text-xs text-steel uppercase tracking-wide2">clients will receive this</div>
            </div>
            <button onClick={dispatch} disabled={sending || targets.length === 0} className="btn-gold disabled:opacity-40">
              {sending ? <><span className="h-3 w-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Dispatching…</> : 'Dispatch campaign'}
            </button>
          </div>
          {done !== null && (
            <div className="text-sm text-gold animate-fadeUp">✓ Campaign delivered to {done} clients — messages appended to their live chat histories.</div>
          )}
        </div>

        {/* Right — phone simulator */}
        <div className="hidden lg:block">
          <div className="sticky top-8 flex justify-center">
            <div className="w-[300px] rounded-[38px] border-[10px] border-ink bg-ink overflow-hidden shadow-card">
              <div className="bg-ink text-white text-center py-2 text-[10px] tracking-wide2 uppercase border-b border-white/10">WhatsApp · 85 Lansdowne</div>
              <div className="bg-[#E5DDD5] px-3 py-4 space-y-2 h-[560px] overflow-y-auto scroll-thin">
                <div className="text-center text-[10px] text-steel bg-white/60 w-max mx-auto px-2 py-0.5">TODAY</div>
                {img && <img src={img} alt="creative" className="max-h-52 w-full object-cover rounded-lg" />}
                <div className="bg-white rounded-lg px-3 py-2 max-w-[85%] shadow-sm">
                  <div className="text-[13px] leading-snug whitespace-pre-wrap">{body.replace(/\{client_name\}/g, 'Namaste')}</div>
                  <div className="text-right text-[9px] text-steel mt-1">now ✓✓</div>
                </div>
                {sending && (
                  <div className="bg-[#DCF8C6] rounded-lg px-3 py-2 max-w-[85%] shadow-sm animate-fadeUp">
                    <div className="text-[13px]">Sending to {targets.length} clients…</div>
                  </div>
                )}
                {done !== null && !sending && (
                  <div className="bg-[#DCF8C6] rounded-lg px-3 py-2 max-w-[85%] shadow-sm animate-fadeUp">
                    <div className="text-[13px]">Delivered to {done} clients ✓✓</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Past campaigns */}
      <section>
        <div className="eyebrow mb-1">History</div>
        <h2 className="luxe-title text-2xl mb-4">Sent campaigns</h2>
        {db.campaigns.length ? (
          <div className="card overflow-x-auto">
            <table className="tbl min-w-[560px]">
              <thead><tr><th>Campaign</th><th>Creative</th><th>Sent</th><th>Clicks</th><th>Date</th></tr></thead>
              <tbody>
                {db.campaigns.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium">{c.title}</td>
                    <td>{c.creative_url ? <img src={c.creative_url} alt="" className="h-10 w-8 object-cover border border-line" /> : '—'}</td>
                    <td>{c.sent_count}</td>
                    <td>{c.clicks_count}</td>
                    <td className="text-xs text-steel">{fmtDate(c.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No campaigns sent yet.</Empty>}
      </section>
    </div>
  );
}
