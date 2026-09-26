import { useEffect, useRef, useState } from 'react';
import { getData, subscribe, allCatalogue, addCatalogueItem, updateCatalogueItem, removeCatalogueItem, getLookbooksForSelector, uploadPdfLookbook, createLookbook, getLookbookById, uploadTemplateMedia, hydrateCatalogue, deleteLookbook, friendlyError } from '../../lib/db.js';
import { classifyFile, addEntries, moveEntry, removeEntry, fromPiece, validateList } from '../../lib/mediaList.js';
import { BRAND } from '../../data/seed.js';
import { inr } from '../../lib/util.js';
import { SectionTitle, Empty, Modal } from '../../components/ui.jsx';

const useDb = () => {
  const [, setV] = useState(0);
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  return getData();
};

// Design spec: docs/superpowers/specs/2026-09-25-product-gallery-design.md
// (decision 3) — shared preview/reorder/remove editor for a gallery `list`,
// used by both Manual Entry (a not-yet-saved list) and the Edit photos modal
// (an existing piece's list). Pure controlled component: mediaList.js does
// every rule check, this just renders `list` and calls `onChange(nextList)`.
function MediaEditor({ list, onChange }) {
  const [err, setErr] = useState('');
  if (!list.length) return null;
  const apply = (result) => {
    if (result.error) { setErr(result.error); return; }
    setErr('');
    onChange(result.list);
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {list.map((m, i) => {
          const leftBlocked = i === 0 || !!moveEntry(list, i, 'left').error;
          const rightBlocked = i === list.length - 1 || !!moveEntry(list, i, 'right').error;
          return (
            <div key={`${m.url}-${i}`} className="relative">
              {m.type === 'video' ? (
                <video src={m.url} muted preload="metadata" className="h-20 w-16 object-cover border border-line" />
              ) : (
                <img src={m.url} alt="" className="h-20 w-16 object-cover border border-line" />
              )}
              {i === 0 && (
                <span className="absolute top-3 left-3 bg-white/90 border border-line px-1 text-[10px] tracking-wide2 uppercase text-steel">Cover</span>
              )}
              <div className="flex items-center justify-between mt-1">
                <button type="button" onClick={() => apply(moveEntry(list, i, 'left'))} disabled={leftBlocked} className="text-steel hover:text-ink text-xs leading-none disabled:opacity-40 cursor-pointer">‹</button>
                <button type="button" onClick={() => apply(removeEntry(list, i))} className="text-steel hover:text-ink text-xs leading-none cursor-pointer">×</button>
                <button type="button" onClick={() => apply(moveEntry(list, i, 'right'))} disabled={rightBlocked} className="text-steel hover:text-ink text-xs leading-none disabled:opacity-40 cursor-pointer">›</button>
              </div>
            </div>
          );
        })}
      </div>
      {err && <div className="text-xs text-gold mt-2">{err}</div>}
    </div>
  );
}

export default function Catalogue() {
  const db = useDb();
  const items = allCatalogue();

  // hydrateCatalogue() normally runs once at module load — but on a genuinely
  // fresh browser session that one-shot module-load-only hydrate races ahead
  // of a fresh login's async session being stored, silently finds no session,
  // and no-ops, leaving this page stuck on hardcoded seed catalogue items
  // until a hard reload. Re-running it on mount here re-queries Convex once
  // the real session exists and merges fresh rows into state, calling emit()
  // when anything changed, which useDb()'s subscribe() picks up to re-render.
  useEffect(() => { hydrateCatalogue(); }, []);

  const [manual, setManual] = useState({ title: '', price: '', image_url: '', instagram_link: '' });
  // Manual Entry — drag-drop media upload (mirrors Templates.jsx's MediaCard
  // onMediaFile pattern), auto-fills manual.image_url on success.
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaMsg, setMediaMsg] = useState('');
  const manualMediaRef = useRef(null);
  // Product gallery (design spec: docs/superpowers/specs/2026-09-25-product-gallery-design.md)
  const [manualMedia, setManualMedia] = useState([]);
  const [editPieceId, setEditPieceId] = useState(null); // piece.id showing the Edit photos modal, or null
  const [editMedia, setEditMedia] = useState([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState('');
  // Edit photos modal — its own upload message/uploading/URL state, kept
  // separate from Manual Entry's so the two forms never cross-talk; all reset
  // in openEditPhotos/closeEditPhotos below.
  const [editMediaMsg, setEditMediaMsg] = useState('');
  const [editMediaUploading, setEditMediaUploading] = useState(false);
  const [editImageUrl, setEditImageUrl] = useState('');
  const editMediaRef = useRef(null);
  // Step C — Manual Entry "Add to" target: 'all' = Current catalogue (no lookbook_id),
  // '__new__' = create a new designer lookbook (name from newLookbookName), else an existing lookbook _id.
  const [addTo, setAddTo] = useState('all');
  const [newLookbookName, setNewLookbookName] = useState('');
  const [igImg, setIgImg] = useState('');
  const [igUrl, setIgUrl] = useState('');
  const [igMsg, setIgMsg] = useState('');
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

    // Lookbook delete (design spec: docs/superpowers/specs/2026-09-25-lookbook-delete-design.md)
    const [lbMenuOpen, setLbMenuOpen] = useState(false);
    const [deleteConfirmFor, setDeleteConfirmFor] = useState(null); // lookbook _id showing the inline confirm, or null
    const [deleting, setDeleting] = useState(false);
    const deletingRef = useRef(false); // extra guard so a second click can never fire a second request, even before the `deleting` re-render lands
    const [deleteMsg, setDeleteMsg] = useState('');
    const [deleteErr, setDeleteErr] = useState('');
    const [removingId, setRemovingId] = useState(null);
    const [removeErrId, setRemoveErrId] = useState(null);
    const [removeErrMsg, setRemoveErrMsg] = useState('');

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

    // Delete is offered ONLY for a real designer/PDF lookbook document — never
    // for "Current catalogue" (not a lookbook row at all — see addManual: a
    // piece added there gets no lookbook_id) and never for a legacy row whose
    // `kind` is "catalogue" or missing, even though designerLookbooks above
    // (used for grouping the dropdown, unchanged) lumps those in with real
    // designer lookbooks by only excluding kind "pdf".
    const selectedOption = lookbookOptions.find((lb) => lb._id === selected);
    const canDeleteSelected = !!selectedOption && (selectedOption.kind === 'designer' || selectedOption.kind === 'pdf');

    const selectLookbook = (value) => {
      setSelected(value);
      setLbMenuOpen(false);
      setDeleteConfirmFor(null);
      setDeleteErr('');
    };

    const confirmLookbook = lookbookOptions.find((lb) => lb._id === deleteConfirmFor);
    const confirmPieceCount = deleteConfirmFor ? items.filter((i) => i.lookbook_id === deleteConfirmFor).length : 0;
    const confirmText = !confirmLookbook ? '' : confirmLookbook.kind === 'pdf'
      ? `Delete PDF lookbook ${confirmLookbook.name}? It will be hidden everywhere.`
      : `Delete ${confirmLookbook.name} and its ${confirmPieceCount} ${confirmPieceCount === 1 ? 'piece' : 'pieces'}? They will be hidden everywhere.`;

    const cancelDeleteLookbook = () => { setDeleteConfirmFor(null); };

    const confirmDeleteLookbook = async () => {
      if (deletingRef.current) return;
      deletingRef.current = true;
      setDeleting(true);
      setDeleteErr('');
      const title = confirmLookbook ? confirmLookbook.name : 'Lookbook';
      try {
        await deleteLookbook(deleteConfirmFor);
        setDeleteConfirmFor(null);
        setSelected('all');
        setDeleteMsg(`${title} deleted.`);
        getLookbooksForSelector().then((rows) => { if (Array.isArray(rows)) setLookbookOptions(rows); });
      } catch (err) {
        setDeleteErr(friendlyError(err));
      } finally {
        deletingRef.current = false;
        setDeleting(false);
      }
    };

    const onRemove = async (item) => {
      if (!confirm(`Remove "${item.title}" from the shared catalogue?`)) return;
      setRemovingId(item.id);
      setRemoveErrId(null);
      try {
        await removeCatalogueItem(item.id);
      } catch (err) {
        setRemoveErrId(item.id);
        setRemoveErrMsg(friendlyError(err));
      } finally {
        setRemovingId(null);
      }
    };

    // Product gallery (design spec: docs/superpowers/specs/2026-09-25-product-gallery-design.md decision 3).
    const openEditPhotos = (item) => {
      setEditPieceId(item.id);
      setEditMedia(fromPiece(item));
      setEditErr('');
      setEditMediaMsg('');
      setEditMediaUploading(false);
      setEditImageUrl('');
    };
    const closeEditPhotos = () => {
      setEditPieceId(null);
      setEditMedia([]);
      setEditErr('');
      setEditMediaMsg('');
      setEditMediaUploading(false);
      setEditImageUrl('');
    };
    const saveEditPhotos = async () => {
      const validationError = validateList(editMedia);
      if (validationError) { setEditErr(validationError); return; }
      setEditSaving(true);
      setEditErr('');
      try {
        await updateCatalogueItem(editPieceId, { media: editMedia });
        closeEditPhotos();
      } catch (err) {
        setEditErr(friendlyError(err));
      } finally {
        setEditSaving(false);
      }
    };
    const editingItem = items.find((i) => i.id === editPieceId);

  const addManual = async () => {
    if (!manual.title || !manual.price) return;
    // Design spec: docs/superpowers/specs/2026-09-25-product-gallery-design.md —
    // a typed Image URL that was never explicitly "Add"-ed still joins the gallery here.
    let galleryList = manualMedia;
    const pendingUrl = manual.image_url.trim();
    if (pendingUrl && !galleryList.some((m) => m.url === pendingUrl)) {
      const added = addEntries(galleryList, [{ url: pendingUrl, type: 'image' }]);
      if (added.error) { setMediaMsg(added.error); return; }
      galleryList = added.list;
    }
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
    // A non-empty gallery sends media (+ its own cover); an empty gallery keeps
    // today's single-image_url behaviour exactly, including an empty image_url.
    const payload = galleryList.length > 0
      ? { title: manual.title, price: manual.price, instagram_link: manual.instagram_link, source: 'manual', media: galleryList, image_url: galleryList[0].url, ...(lookbook_id ? { lookbook_id } : {}) }
      : { ...manual, source: 'manual', ...(lookbook_id ? { lookbook_id } : {}) };
    const res = addCatalogueItem(payload);
    // Missing-session case: surface the error (via the Manual-entry mediaMsg line)
    // and do NOT clear the form / show success — the item was never saved.
    if (res && res.ok === false) { setMediaMsg(res.error); return; }
    setManual({ title: '', price: '', image_url: '', instagram_link: '' });
    setManualMedia([]);
    setAddTo('all');
    setNewLookbookName('');
  };
  // Shared drag-drop upload loop, mirrors Templates.jsx MediaCard's
  // onMediaFile (try/catch/finally, uploading/msg state). Design spec:
  // docs/superpowers/specs/2026-09-25-product-gallery-design.md (decision 3) —
  // takes a whole FileList and uploads one file at a time into whichever
  // gallery list/setter/message/uploading state the caller passes in, so
  // Manual Entry and the Edit photos modal share one upload path instead of
  // two copies of this loop.
  const uploadMediaFiles = async (fileList, currentList, setList, setMsg, setUploading) => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    setUploading(true);
    let list = currentList;
    for (let idx = 0; idx < files.length; idx++) {
      const f = files[idx];
      const kind = classifyFile(f);
      if (kind === 'pdf') { setMsg("PDFs can't be added as product photos — use the PDF linesheet uploader."); continue; }
      if (kind === 'other') { setMsg("This file type isn't supported."); continue; }
      setMsg(`Uploading ${idx + 1} of ${files.length}…`);
      try {
        const bytes = await f.arrayBuffer();
        const res = await uploadTemplateMedia(bytes, f.name, f.type);
        if (!res || !res.ok) { setMsg('Upload failed — please try again.'); continue; }
        const added = addEntries(list, [{ url: res.url, type: kind }]);
        if (added.error) { setMsg(added.error); continue; }
        list = added.list;
        setList(list);
        setMsg(`"${f.name}" uploaded.`);
      } catch (err) {
        setMsg(friendlyError(err));
      }
    }
    setUploading(false);
  };
  const onManualMediaFiles = (fileList) => uploadMediaFiles(fileList, manualMedia, setManualMedia, setMediaMsg, setMediaUploading);
  const onEditMediaFiles = (fileList) => uploadMediaFiles(fileList, editMedia, setEditMedia, setEditMediaMsg, setEditMediaUploading);

  const addIg = () => {
    if (!igImg) return;
    const res = addCatalogueItem({ title: 'Instagram Style Post', price: 0, image_url: igImg, instagram_link: igUrl || '#', source: 'instagram' });
    // Missing-session case: surface the error and don't clear the form / show success.
    if (res && res.ok === false) { setIgMsg(res.error); return; }
    setIgMsg('');
    setIgImg(''); setIgUrl('');
  };
  const onCsvParse = (f) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const rows = String(r.result).split(/\r?\n/).map((l) => l.split(',')).filter((r2) => r2.length >= 3 && r2[1].trim());
      setCsvPreview(rows.slice(0, 5));
      let added = 0;
      for (const [title, price, url] of rows) {
        if (title && price && url && url.startsWith('http')) {
          const res = addCatalogueItem({ title: title.trim(), price: Number(price), image_url: url.trim(), source: 'csv' });
          // Missing-session check is consistent for the whole batch — stop on the
          // first failure and surface the error instead of a false success count.
          if (res && res.ok === false) { setBulkMsg(res.error); return; }
          added++;
        }
      }
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
      setBulkMsg(friendlyError(err));
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
          {igMsg && <div className="text-xs text-gold mt-2">{igMsg}</div>}
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
            <div>
              <label className="label">Image URL</label>
              <div className="flex items-center gap-2">
                <input className="input" value={manual.image_url} onChange={(e) => setManual({ ...manual, image_url: e.target.value })} />
                <button
                  type="button"
                  onClick={() => {
                    const url = manual.image_url.trim();
                    if (!url) return;
                    const added = addEntries(manualMedia, [{ url, type: 'image' }]);
                    if (added.error) { setMediaMsg(added.error); return; }
                    setManualMedia(added.list);
                    setManual((m) => ({ ...m, image_url: '' }));
                  }}
                  disabled={!manual.image_url.trim()}
                  className="btn-ghost !py-1 !px-3 text-[9px]"
                >
                  Add
                </button>
              </div>
            </div>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onManualMediaFiles(e.dataTransfer.files); }}
              onClick={() => manualMediaRef.current?.click()}
              className="border-2 border-dashed border-line hover:border-gold p-6 text-center cursor-pointer transition-colors"
            >
              <input ref={manualMediaRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => onManualMediaFiles(e.target.files)} />
              <div className="text-2xl mb-2">📎</div>
              <div className="text-sm">Drag & drop photos or videos</div>
            </div>
            {mediaMsg && <div className="text-xs text-gold mt-2">{mediaMsg}</div>}
            <MediaEditor list={manualMedia} onChange={setManualMedia} />
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
                onChange={(e) => selectLookbook(e.target.value)}
              >
                <option value="all">Current catalogue</option>
                {designerLookbooks.map((lb) => <option key={lb._id} value={lb._id}>{lb.name}</option>)}
                {pdfLookbooks.map((lb) => <option key={lb._id} value={lb._id}>{lb.name} (PDF)</option>)}
              </select>
              {isLookbookSelected && !deleteConfirmFor && (
                <div className="flex items-center gap-2">
                  {canDeleteSelected && (
                    <div className="relative shrink-0">
                      <button
                        onClick={() => setLbMenuOpen((v) => !v)}
                        className="text-steel hover:text-ink px-1.5 leading-none text-sm"
                        aria-label="Lookbook options"
                      >
                        ⋮
                      </button>
                      {lbMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 w-28 bg-white border border-line shadow-lg z-50">
                          <button
                            onClick={() => { setLbMenuOpen(false); setDeleteConfirmFor(selected); }}
                            className="w-full text-left px-3 py-2 text-[11px] text-steel hover:text-ink hover:bg-mist"
                          >
                            Delete lookbook
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <button onClick={() => copyPublicLink(selected)} className="btn-ghost !py-1 !px-2 text-[9px]">
                    {copiedId === selected ? '✓ Copied' : '🔗 Copy Link'}
                  </button>
                  <a href={waShareLink(selected)} target="_blank" rel="noreferrer" className="btn-gold !py-1 !px-2 text-[9px] flex items-center justify-center" aria-label="WhatsApp">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 11.5v7A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-7" /><path d="M14.5 9 21 2.5" /><path d="M15.5 2.5H21V8" /></svg>
                  </a>
                </div>
              )}
              {deleteConfirmFor && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-steel">{confirmText}</span>
                  <button onClick={confirmDeleteLookbook} disabled={deleting} className="btn-ink !py-1 !px-2 text-[9px]">
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                  <button onClick={cancelDeleteLookbook} disabled={deleting} className="btn-ghost !py-1 !px-2 text-[9px]">Cancel</button>
                </div>
              )}
            </div>
          }
        />
        {deleteMsg && <div className="text-xs text-steel mt-2">{deleteMsg}</div>}
        {deleteErr && <div className="text-xs text-gold mt-2">{deleteErr}</div>}
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
                    {Array.isArray(i.media) && i.media.length > 1 && (
                      <span className="text-[9px] tracking-wide2 uppercase text-white/80">+{i.media.length - 1}</span>
                    )}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-sm font-medium truncate">{i.title}</div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm">{i.price ? inr(i.price) : 'IG · shoppable'}</span>
                    <button onClick={() => onRemove(i)} disabled={removingId === i.id} className="btn-ghost !py-1 !px-3 text-[9px]">
                      {removingId === i.id ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                  {removeErrId === i.id && <div className="text-xs text-gold mt-2">{removeErrMsg}</div>}
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={() => copyPieceLink(i.id)} className="btn-ghost !py-1 !px-2 text-[9px] flex-1">
                      {copiedId === i.id ? '✓ Copied' : '🔗 Copy Link'}
                    </button>
                    <a href={waPieceLink(i)} target="_blank" rel="noreferrer" className="btn-gold !py-1 !px-2 text-[9px] flex items-center justify-center" aria-label="WhatsApp">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 11.5v7A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-7" /><path d="M14.5 9 21 2.5" /><path d="M15.5 2.5H21V8" /></svg>
                    </a>
                  </div>
                  {i.convexId && (
                    <button onClick={() => openEditPhotos(i)} className="btn-ghost w-full mt-3">Edit photos</button>
                  )}
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
      {editPieceId && editingItem && (
        <Modal open onClose={closeEditPhotos} title={`Edit photos — ${editingItem.title}`}>
          <div className="space-y-3">
            <div>
              <label className="label">Image URL</label>
              <div className="flex items-center gap-2">
                <input className="input" value={editImageUrl} onChange={(e) => setEditImageUrl(e.target.value)} />
                <button
                  type="button"
                  onClick={() => {
                    const url = editImageUrl.trim();
                    if (!url) return;
                    const added = addEntries(editMedia, [{ url, type: 'image' }]);
                    if (added.error) { setEditMediaMsg(added.error); return; }
                    setEditMedia(added.list);
                    setEditImageUrl('');
                  }}
                  disabled={!editImageUrl.trim()}
                  className="btn-ghost !py-1 !px-3 text-[9px]"
                >
                  Add
                </button>
              </div>
            </div>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onEditMediaFiles(e.dataTransfer.files); }}
              onClick={() => editMediaRef.current?.click()}
              className="border-2 border-dashed border-line hover:border-gold p-6 text-center cursor-pointer transition-colors"
            >
              <input ref={editMediaRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => onEditMediaFiles(e.target.files)} />
              <div className="text-2xl mb-2">📎</div>
              <div className="text-sm">Drag & drop photos or videos</div>
            </div>
            {editMediaMsg && <div className="text-xs text-gold mt-2">{editMediaMsg}</div>}
            <MediaEditor list={editMedia} onChange={setEditMedia} />
            {editErr && <div className="text-xs text-gold mt-2">{editErr}</div>}
            <div className="flex items-center gap-2">
              <button onClick={saveEditPhotos} disabled={editSaving || editMediaUploading} className="btn-ink flex-1">{editSaving ? 'Saving…' : 'Save'}</button>
              <button onClick={closeEditPhotos} disabled={editSaving} className="btn-ghost flex-1">Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
