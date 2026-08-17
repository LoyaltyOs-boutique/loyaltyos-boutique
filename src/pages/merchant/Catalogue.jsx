import { useEffect, useRef, useState } from 'react';
import { getData, subscribe, allCatalogue, addCatalogueItem, removeCatalogueItem } from '../../lib/db.js';
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
  const [igImg, setIgImg] = useState('');
  const [igUrl, setIgUrl] = useState('');
  const [bulkMsg, setBulkMsg] = useState('');
    const [csvPreview, setCsvPreview] = useState(null);
    const [copiedId, setCopiedId] = useState(null);
    const csvRef = useRef(null);
    const pdfRef = useRef(null);
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

  const addManual = () => {
    if (!manual.title || !manual.price) return;
    addCatalogueItem({ ...manual, source: 'manual' });
    setManual({ title: '', price: '', image_url: '', instagram_link: '' });
  };
  const addIg = () => {
    if (!igImg) return;
    addCatalogueItem({ title: 'Instagram Style Post', price: 0, image_url: igImg, instagram_link: igUrl || '#', source: 'instagram' });
    setIgImg(''); setIgUrl('');
  };
  const onCsv = (f) => {
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
            onDrop={(e) => { e.preventDefault(); onCsv(e.dataTransfer.files?.[0]); }}
            onClick={() => csvRef.current?.click()}
            className="border-2 border-dashed border-line hover:border-gold p-6 text-center cursor-pointer transition-colors"
          >
            <input ref={csvRef} type="file" accept=".csv,.pdf,text/csv" className="hidden" onChange={(e) => onCsv(e.target.files?.[0])} />
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
          {bulkMsg && <div className="text-xs text-gold mt-2">{bulkMsg}</div>}
          <button onClick={() => pdfRef.current?.click()} className="btn-ghost w-full mt-3">Upload PDF linesheet</button>
          <input ref={pdfRef} type="file" accept=".pdf" className="hidden" onChange={() => setBulkMsg('PDF linesheet received — image URLs must be added from the Instagram flow for a shoppable feed.')} />
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
            <div><label className="label">Instagram link (optional)</label><input className="input" value={manual.instagram_link} onChange={(e) => setManual({ ...manual, instagram_link: e.target.value })} /></div>
            <button onClick={addManual} className="btn-ink w-full" disabled={!manual.title || !manual.price}>Add to catalogue</button>
          </div>
        </section>
      </div>

      {/* Catalogue grid */}
      <section>
        <SectionTitle eyebrow={`${items.length} pieces live`} title="Current catalogue" />
        {items.length ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {items.map((i) => (
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
                    <button onClick={() => copyPublicLink(i.lookbook_id)} className="btn-ghost !py-1 !px-2 text-[9px] flex-1">
                      {copiedId === i.lookbook_id ? '✓ Copied' : '🔗 Copy Link'}
                    </button>
                    <a href={waShareLink(i.lookbook_id)} target="_blank" rel="noreferrer" className="btn-gold !py-1 !px-2 text-[9px] flex items-center justify-center" aria-label="WhatsApp">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 11.5v7A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-7" /><path d="M14.5 9 21 2.5" /><path d="M15.5 2.5H21V8" /></svg>
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
