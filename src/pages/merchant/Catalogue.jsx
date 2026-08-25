import { useEffect, useRef, useState } from 'react';
import { getData, subscribe, allCatalogue, addCatalogueItem, removeCatalogueItem, getLookbooksForSelector, uploadPdfLookbook, createLookbook, getLookbookById, uploadTemplateMedia } from '../../lib/db.js';
import { BRAND } from '../../data/seed.js';
import { inr } from '../../lib/util.js';
import { SectionTitle, Empty } from '../../components/ui.jsx';

const useDb = () => {
  const [, setV] = useState(0);
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  return getData();
};

export default function Catalogue() {
  const db = useDb();
  const items = allCatalogue();
  const [manual, setManual] = useState({ title: '', price: '', image_url: '', instagram_link: '' });
  // Manual Entry — drag-drop media upload (mirrors Templates.jsx's MediaCard
  // onMediaFile pattern), auto-fills manual.image_url on success.
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaMsg, setMediaMsg] = useState('');
  const manualMediaRef = useRef(null);
  // Step C — Manual Entry "Add to" target: 'all' = Current catalogue (no lookbook_id),
  // '__new__' = create a new designer lookbook (name from newLookbookName), else an existing lookbook _id.
  const [addTo, setAddTo] = useState('all');
  const [newLookbookName, setNewLookbookName] = useState('');
  const [igImg, setIgImg] = useState('');
  const [igUrl, setIgUrl] = useState('');
  const [bulkMsg, setBulkMsg] = useState('');
    const [csvPreview, setCsvPreview] = useState(null);
    const [pdfUploading, setPdfUploading] = useState(false);
    const [pendingPdfFile, setPendingPdfFile] = useState(null);
    const [pdfNameInput, setPdfNameInput] = useState('');
    const [copiedId, setCopiedId] = useState(null);
    const [selected, setSelected] = useState('all'); // 'all' = Current catalogue, else lookbook _id
    const [lookbookOptions, setLookbookOptions] = useState([]);
    const [pdfUrl, setPdfUrl] = useState(null);
    const csvRef = useRef(null);
    const pdfRef = useRef(null);

    // Load lookbook/PDF options for the selector dropdown.
    useEffect(() => {
        let mounted = true;
        getLookbooksForSelector().then((rows) => { if (mounted && Array.isArray(rows)) setLookbookOptions(rows); });
        return () => { mounted = false; };
    }, []);

    // getLookbooksForSelector only returns a thin {_id, name, kind} projection
    // (no pdf_url) — fetch the full lookbook doc when a PDF is selected so the
    // inline preview below has a real URL to point at.
    useEffect(() => {
        let mounted = true;
        if (selected !== 'all') {
            getLookbookById(selected).then((data) => { if (mounted) setPdfUrl(data && data.pdf_url ? data.pdf_url : null); });
        } else {
            setPdfUrl(null);
        }
        return () => { mounted = false; };
    }, [selected]);

    // Per-piece share → routes to that single piece (/lookbook/piece/:pieceId).
    const copyPieceLink = (pieceId) => {
        const url = `${window.location.origin}/lookbook/piece/${pieceId}`;
        navigator.clipboard.writeText(url);
        setCopiedId(pieceId);
        setTimeout(() => setCopiedId(null), 1600);
    };
    const waPieceLink = (piece) => {
        const url = `${window.location.origin}/lookbook/piece/${piece.id}`;
        return `https://wa.me/?text=${encodeURIComponent(`Check out this ${piece.title}: ${url}`)}`;
    };

    // Lookbook-level share (existing correct route /lookbook/public/:lookbookId).
    const copyPublicLink = (lookbookId) => {
        const url = `${window.location.origin}/lookbook/public/${lookbookId}`;
        navigator.clipboard.writeText(url);
        setCopiedId(lookbookId);
        setTimeout(() => setCopiedId(null), 1600);
    };
    const waShareLink = (lookbookId) => {
        const url = `${window.location.origin}/lookbook/public/${lookbookId}`;
        return `https://wa.me/?text=${encodeURIComponent(`Check out this lookbook: ${url}`)}`;
    };

    // Per-piece WhatsApp inquiry (Improvement 5 pattern — real boutique number).
    const waInquireLink = (piece) =>
        `https://wa.me/${BRAND.wa}?text=${encodeURIComponent(`Hi! I'm interested in the ${piece.title} from 85 Lansdowne.`)}`;

    const designerLookbooks = lookbookOptions.filter((lb) => lb.kind !== 'pdf');
    const pdfLookbooks = lookbookOptions.filter((lb) => lb.kind === 'pdf');
    const selectedPdf = pdfLookbooks.find((lb) => lb._id === selected);
    const isLookbookSelected = selected !== 'all';
    // Grid items: all when on "Current catalogue", else filtered to the chosen lookbook.
    const shownItems = isLookbookSelected ? items.filter((i) => i.lookbook_id === selected) : items;

  const addManual = async () => {
    if (!manual.title || !manual.price) return;
    // Step C — resolve which lookbook the piece is assigned to:
    //  'all'      → Current catalogue (no lookbook_id, unchanged legacy behavior)
    //  '__new__'  → create a new designer lookbook first, then use its _id
    //  <_id>      → an existing designer lookbook
    let lookbook_id;
    if (addTo === '__new__') {
      const name = newLookbookName.trim();
      if (!name) return; // "+ New designer lookbook" chosen but no name typed — abort
      const res = await createLookbook({ title: name, designer: name, source: 'manual', kind: 'designer' });
      if (!res || !res.ok || !res.id) return; // creation failed — don't orphan the piece
      lookbook_id = res.id;
      // Refresh Step A selector so the new lookbook is immediately pickable elsewhere.
      getLookbooksForSelector().then((rows) => { if (Array.isArray(rows)) setLookbookOptions(rows); });
    } else if (addTo !== 'all') {
      lookbook_id = addTo;
    }
    addCatalogueItem({ ...manual, source: 'manual', ...(lookbook_id ? { lookbook_id } : {}) });
    setManual({ title: '', price: '', image_url: '', instagram_link: '' });
    setAddTo('all');
    setNewLookbookName('');
  };
  // Manual Entry — drag-drop upload handler, mirrors Templates.jsx MediaCard's
  // onMediaFile exactly (file-type check, try/catch/finally, uploading/msg
  // state), but auto-fills manual.image_url on success instead of a
  // separate mediaUrl state.
  const onManualMediaFile = async (f) => {
    if (!f) return;
    const isAllowed = f.type.startsWith('video/') || f.type.startsWith('image/') || f.type === 'application/pdf';
    if (!isAllowed) { setMediaMsg('Only video, image, or PDF files are supported.'); return; }
    setMediaUploading(true);
    setMediaMsg('Uploading…');
    try {
      const bytes = await f.arrayBuffer();
      const res = await uploadTemplateMedia(bytes, f.name, f.type);
      if (res && res.ok) {
        setManual((m) => ({ ...m, image_url: res.url }));
        setMediaMsg(`"${f.name}" uploaded.`);
      } else {
        setMediaMsg('Upload failed — please try again.');
      }
    } catch (err) {
      setMediaMsg(`Upload failed: ${err?.message || 'please try again.'}`);
    } finally {
      setMediaUploading(false);
    }
  };

  const addIg = () => {
    if (!igImg) return;
    addCatalogueItem({ title: 'Instagram Style Post', price: 0, image_url: igImg, instagram_link: igUrl || '#', source: 'instagram' });
    setIgImg(''); setIgUrl('');
  };
  const onCsvParse = (f) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const rows = String(r.result).split(/\r?\n/).map((l) => l.split(',')).filter((r2) => r2.length >= 3 && r2[1].trim());
      setCsvPreview(rows.slice(0, 5));
      let added = 0;
      rows.forEach(([title, price, url]) => {
        if (title && price && url && url.startsWith('http')) { addCatalogueItem({ title: title.trim(), price: Number(price), image_url: url.trim(), source: 'csv' }); added++; }
      });
      setBulkMsg(`Imported ${added} items from ${f.name}.`);
    };
    r.readAsText(f);
  };

  // Gate 2, Step B — PDF linesheet upload. Selecting/dropping a PDF stages it in
  // `pendingPdfFile` and shows an inline luxury-styled name field in the card
  // (see JSX below) instead of a native window.prompt(). Confirming there calls
  // this with the typed name, reads the file as raw bytes, then hands off to the
  // generatePdfUploadUrl Convex action via db.js — upload logic unchanged.
  const onPdfUpload = async (f, lookbookName) => {
    if (!f) return;
    if (!lookbookName || !lookbookName.trim()) return; // cancelled/empty — abort cleanly, no upload attempt
    setPdfUploading(true);
    setBulkMsg('Uploading PDF…');
    try {
      const bytes = await f.arrayBuffer();
      const res = await uploadPdfLookbook(bytes, f.name, lookbookName.trim());
      if (res && res.ok) {
        setBulkMsg(`"${lookbookName.trim()}" PDF lookbook uploaded successfully.`);
        // Refresh the Step A selector so the new PDF-lookbook is pickable right away.
        getLookbooksForSelector().then((rows) => { if (Array.isArray(rows)) setLookbookOptions(rows); });
      } else {
        setBulkMsg('PDF upload failed — please try again.');
      }
    } catch (err) {
      setBulkMsg(`PDF upload failed: ${err?.message || 'please try again.'}`);
    } finally {
      setPdfUploading(false);
      setPendingPdfFile(null);
      setPdfNameInput('');
    }
  };

  // File-type router for the CSV/PDF linesheet card — dispatches to the
  // unchanged CSV parser, or stages the PDF for inline name entry.
  const onBulkFile = (f) => {
    if (!f) return;
    if (f.name.toLowerCase().endsWith('.pdf')) { setPendingPdfFile(f); setPdfNameInput(''); return; }
    onCsvParse(f);
  };

  const confirmPdfUpload = () => { onPdfUpload(pendingPdfFile, pdfNameInput); };
  const cancelPdfUpload = () => { setPendingPdfFile(null); setPdfNameInput(''); };

  return (
    <div className="space-y-10">
      <div>
        <div className="eyebrow mb-1">Anti-Shopify · Lookbook manager</div>
        <h1 className="luxe-title text-3xl">Catalogue & lookbook</h1>
        <p className="text-sm text-steel mt-2">Upload a linesheet, a shoppable Instagram feed, or add pieces by hand.</p>
      </div>

      {/* Bulk loaders */}
      <div className="grid lg:grid-cols-3 gap-5">
        <section className="card p-6">
          <div className="eyebrow mb-1">CSV / PDF linesheet</div>
          <h3 className="luxe-title text-lg mb-3">Bulk loader</h3>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onBulkFile(e.dataTransfer.files?.[0]); }}
            onClick={() => csvRef.current?.click()}
            className="border-2 border-dashed border-line hover:border-gold p-6 text-center cursor-pointer transition-colors"
          >
            <input ref={csvRef} type="file" accept=".csv,.pdf,text/csv" className="hidden" onChange={(e) => onBulkFile(e.target.files?.[0])} />
            <div className="text-2xl mb-2">📄</div>
            <div className="text-sm">Drag & drop a CSV / PDF linesheet</div>
            <div className="text-xs text-steel mt-1">Columns: Title, Price, Image URL</div>
          </div>
          {csvPreview && (
            <div className="mt-3 text-xs">
              <div className="eyebrow mb-1">Preview</div>
              <table className="tbl">
                <tbody>{csvPreview.map((r, i) => <tr key={i}><td>{r[0]}</td><td>{r[1]}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {pendingPdfFile && (
            <div className="mt-3 space-y-2">
              <label className="label">Name this PDF lookbook (shown to clients)</label>
              <input
                className="input"
                placeholder="e.g. Sabyasachi · Spring Linesheet"
                value={pdfNameInput}
                onChange={(e) => setPdfNameInput(e.target.value)}
                autoFocus
              />
              <div className="text-[10px] text-steel truncate">Selected: {pendingPdfFile.name}</div>
              <div className="flex items-center gap-2">
                <button onClick={confirmPdfUpload} disabled={pdfUploading || !pdfNameInput.trim()} className="btn-ink flex-1">
                  {pdfUploading ? 'Uploading…' : 'Confirm & Upload'}
                </button>
                <button onClick={cancelPdfUpload} disabled={pdfUploading} className="btn-ghost flex-1">Cancel</button>
              </div>
            </div>
          )}
          {bulkMsg && <div className="text-xs text-gold mt-2">{bulkMsg}</div>}
          {!pendingPdfFile && (
            <button onClick={() => pdfRef.current?.click()} disabled={pdfUploading} className="btn-ghost w-full mt-3">{pdfUploading ? 'Uploading…' : 'Upload PDF linesheet'}</button>
          )}
          <input ref={pdfRef} type="file" accept=".pdf" className="hidden" onChange={(e) => { setPendingPdfFile(e.target.files?.[0] || null); setPdfNameInput(''); }} />
        </section>

        <section className="card p-6">
          <div className="eyebrow mb-1">Instagram style-feed</div>
          <h3 className="luxe-title text-lg mb-3">Shoppable post</h3>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f?.type.startsWith('image/')) { const r = new FileReader(); r.onload = () => setIgImg(r.result); r.readAsDataURL(f); } }}
            onClick={() => pdfRef.current && pdfRef.current.click()}
            className="border-2 border-dashed border-line hover:border-gold p-6 text-center cursor-pointer transition-colors"
          >
            <div className="text-2xl mb-2">📸</div>
            <div className="text-sm">Drag & drop an Instagram screenshot</div>
          </div>
          {igImg && <img src={igImg} alt="ig" className="mt-3 h-28 w-full object-cover border border-line" />}
          <label className="label mt-4">Instagram post URL</label>
          <input className="input mb-3" placeholder="https://instagram.com/p/…" value={igUrl} onChange={(e) => setIgUrl(e.target.value)} />
          <button onClick={addIg} className="btn-ink w-full" disabled={!igImg}>Add to lookbook feed</button>
        </section>

        <section className="card p-6">
          <div className="eyebrow mb-1">Manual entry</div>
          <h3 className="luxe-title text-lg mb-3">Add a piece</h3>
          <div className="space-y-3">
            <div><label className="label">Title</label><input className="input" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Price (INR)</label><input className="input" type="number" value={manual.price} onChange={(e) => setManual({ ...manual, price: e.target.value })} /></div>
              <div><label className="label">Source</label><input className="input" value="Manual" readOnly /></div>
            </div>
            <div><label className="label">Image URL</label><input className="input" value={manual.image_url} onChange={(e) => setManual({ ...manual, image_url: e.target.value })} /></div>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onManualMediaFile(e.dataTransfer.files?.[0]); }}
              onClick={() => manualMediaRef.current?.click()}
              className="border-2 border-dashed border-line hover:border-gold p-6 text-center cursor-pointer transition-colors"
            >
              <input ref={manualMediaRef} type="file" accept="video/*,image/*,.pdf" className="hidden" onChange={(e) => onManualMediaFile(e.target.files?.[0])} />
              <div className="text-2xl mb-2">📎</div>
              <div className="text-sm">Drag & drop a video, image, or PDF</div>
            </div>
            {mediaMsg && <div className="text-xs text-gold mt-2">{mediaMsg}</div>}
            <div><label className="label">Instagram link (optional)</label><input className="input" value={manual.instagram_link} onChange={(e) => setManual({ ...manual, instagram_link: e.target.value })} /></div>
            <div>
              <label className="label">Add to</label>
              <select className="input" value={addTo} onChange={(e) => setAddTo(e.target.value)}>
                <option value="all">Current catalogue</option>
                {designerLookbooks.map((lb) => <option key={lb._id} value={lb._id}>{lb.name}</option>)}
                <option value="__new__">+ New designer lookbook</option>
              </select>
            </div>
            {addTo === '__new__' && (
              <div><label className="label">New lookbook name</label><input className="input" value={newLookbookName} onChange={(e) => setNewLookbookName(e.target.value)} placeholder="e.g. Sabyasachi · Spring" /></div>
            )}
            <button onClick={addManual} className="btn-ink w-full" disabled={!manual.title || !manual.price || (addTo === '__new__' && !newLookbookName.trim())}>Add to catalogue</button>
          </div>
        </section>
      </div>

      {/* Catalogue grid */}
      <section>
        <SectionTitle
          eyebrow={`${(isLookbookSelected && !selectedPdf ? shownItems.length : items.length)} pieces live`}
          title="Current catalogue"
          right={
            <div className="flex items-center gap-3">
              <select
                className="input !w-auto !py-1.5 text-xs"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="all">Current catalogue</option>
                {designerLookbooks.map((lb) => <option key={lb._id} value={lb._id}>{lb.name}</option>)}
                {pdfLookbooks.map((lb) => <option key={lb._id} value={lb._id}>{lb.name} (PDF)</option>)}
              </select>
              {isLookbookSelected && (
                <div className="flex items-center gap-2">
                  <button onClick={() => copyPublicLink(selected)} className="btn-ghost !py-1 !px-2 text-[9px]">
                    {copiedId === selected ? '✓ Copied' : '🔗 Copy Link'}
                  </button>
                  <a href={waShareLink(selected)} target="_blank" rel="noreferrer" className="btn-gold !py-1 !px-2 text-[9px] flex items-center justify-center" aria-label="WhatsApp">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 11.5v7A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-7" /><path d="M14.5 9 21 2.5" /><path d="M15.5 2.5H21V8" /></svg>
                  </a>
                </div>
              )}
            </div>
          }
        />
        {selectedPdf ? (
          pdfUrl ? (
            <iframe src={pdfUrl} className="w-full h-[600px]" title="PDF preview" />
          ) : (
            <Empty>Loading PDF preview…</Empty>
          )
        ) : shownItems.length ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {shownItems.map((i) => (
              <div key={i.id} className="card overflow-hidden group">
                <div className="relative">
                  <img src={i.image_url} alt={i.title} className="aspect-[3/4] w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/80 to-transparent p-3 flex justify-between items-end">
                    <span className="text-[9px] tracking-wide2 uppercase text-white/80">{i.source} · {i.likes || 0} ♥</span>
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-sm font-medium truncate">{i.title}</div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm">{i.price ? inr(i.price) : 'IG · shoppable'}</span>
                    <button onClick={() => { if (confirm(`Remove "${i.title}" from the shared catalogue?`)) removeCatalogueItem(i.id); }} className="btn-ghost !py-1 !px-3 text-[9px]">
                      Remove
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={() => copyPieceLink(i.id)} className="btn-ghost !py-1 !px-2 text-[9px] flex-1">
                      {copiedId === i.id ? '✓ Copied' : '🔗 Copy Link'}
                    </button>
                    <a href={waPieceLink(i)} target="_blank" rel="noreferrer" className="btn-gold !py-1 !px-2 text-[9px] flex items-center justify-center" aria-label="WhatsApp">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 11.5v7A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-7" /><path d="M14.5 9 21 2.5" /><path d="M15.5 2.5H21V8" /></svg>
                    </a>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => alert('Coming soon')} className="btn-ink !py-1 !px-2 text-[9px] flex-1">
                      Buy Now
                    </button>
                    <a href={waInquireLink(i)} target="_blank" rel="noreferrer" className="btn-ghost !py-1 !px-2 text-[9px] flex-1 text-center">
                      Inquire
                    </a>
                  </div>
                  {i.instagram_link && i.instagram_link !== '#' && <a href={i.instagram_link} target="_blank" rel="noreferrer" className="text-[10px] text-gold tracking-wide2 uppercase mt-1 inline-block">View post ↗</a>}
                </div>
              </div>
            ))}
          </div>
        ) : <Empty>The catalogue is empty — add your first piece above.</Empty>}
      </section>
    </div>
  );
}
