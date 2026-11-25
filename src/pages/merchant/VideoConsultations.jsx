import { useEffect, useRef, useState } from 'react';
import {
  fetchVideoCallRequestsByDate, searchVideoCallRequestsRemote, markVideoCallContactedRemote,
  friendlyError,
} from '../../lib/db.js';
import { first } from '../../lib/util.js';
import { Empty } from '../../components/ui.jsx';

// Design spec: docs/superpowers/specs/2026-11-25-video-consultations-design.md
// Structure and classNames copied from src/pages/merchant/Orders.jsx so this
// page reads as a sibling of the Orders tab.

const PAGE = 20; // date-mode page size, same as Orders.jsx
const KOLKATA = 'Asia/Kolkata';

// Today's calendar day in India time, as a "YYYY-MM-DD" string for the date
// input. en-CA gives that exact zero-padded shape.
function istTodayValue() {
  return new Date().toLocaleDateString('en-CA', { timeZone: KOLKATA });
}

// The India-time window [00:00:00.000, 23:59:59.999] for one "YYYY-MM-DD"
// value, as epoch ms. India is a steady +5:30 with no daylight-saving, so the
// day begins 5.5 hours before UTC midnight of that date.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istDayWindow(dateValue) {
  const [y, mo, d] = dateValue.split('-').map(Number);
  const startUtc = Date.UTC(y, mo - 1, d) - IST_OFFSET_MS;
  return { fromMs: startUtc, toMs: startUtc + 86_400_000 - 1 };
}

// Time and date of a row, shown in India time — same shape Orders.jsx uses.
function fmtWhen(ms) {
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-IN', { timeZone: KOLKATA, day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-IN', { timeZone: KOLKATA, hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

// Builds the wa.me number from a stored mobile: 10 digits gets the 91
// prefix; an already-12-digit number starting 91 is kept as-is.
function waNumber(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits;
}

export default function VideoConsultations() {
  const [dateValue, setDateValue] = useState(istTodayValue);
  const [q, setQ] = useState('');

  // Date mode: current page rows + a stack of earlier cursors so Prev can
  // step back. cursorStack[i] produces page i; isDone is Convex's flag for
  // the loaded page.
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(0);
  const [cursorStack, setCursorStack] = useState([null]);
  const [isDone, setIsDone] = useState(true);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // A search box with 2+ characters switches to search mode.
  const searching = q.trim().length >= 2;

  // Which row's WhatsApp-and-mark-contacted action is in flight.
  const [markingId, setMarkingId] = useState(null);

  // Counts every date-page load. A response is honoured only if its load is
  // still the latest one, so a slow reply from an earlier page or date never
  // overwrites what the user moved on to.
  const loadSeq = useRef(0);

  // Date mode: load the page at pageIndex using the cursor that produces it.
  // Changing the date resets to page 1 (handled by the date effect below
  // seeding a fresh stack).
  const loadDatePage = (cursor, pageIndex) => {
    const { fromMs, toMs } = istDayWindow(dateValue);
    const mySeq = loadSeq.current + 1;
    loadSeq.current = mySeq;
    setLoading(true);
    setErr('');
    fetchVideoCallRequestsByDate({ fromMs, toMs, cursor, numItems: PAGE })
      .then((res) => {
        if (loadSeq.current !== mySeq) return; // user already moved on
        setRows(res.page || []);
        setIsDone(res.isDone);
        setCursorStack((prev) => {
          // Keep positions 0..pageIndex. If more rows remain, record the cursor
          // for the page after this one; drop any later stale positions.
          const kept = prev.slice(0, pageIndex + 1);
          if (!res.isDone) kept[pageIndex + 1] = res.continueCursor;
          return kept;
        });
      })
      .catch((e) => {
        if (loadSeq.current !== mySeq) return;
        setRows([]); setErr(friendlyError(e));
      })
      .finally(() => { if (loadSeq.current === mySeq) setLoading(false); });
  };

  // Changing the date (while not searching) starts a fresh walk at page 1.
  useEffect(() => {
    if (searching) return;
    setPage(0);
    setCursorStack([null]);
    const { fromMs, toMs } = istDayWindow(dateValue);
    const mySeq = loadSeq.current + 1;
    loadSeq.current = mySeq;
    setLoading(true);
    setErr('');
    fetchVideoCallRequestsByDate({ fromMs, toMs, cursor: null, numItems: PAGE })
      .then((res) => {
        if (loadSeq.current !== mySeq) return; // a newer load started
        setRows(res.page || []);
        setIsDone(res.isDone);
        setCursorStack(res.isDone ? [null] : [null, res.continueCursor]);
      })
      .catch((e) => {
        if (loadSeq.current !== mySeq) return;
        setRows([]); setErr(friendlyError(e));
      })
      .finally(() => { if (loadSeq.current === mySeq) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateValue, searching]);

  // Search mode: wait 300 ms after typing stops, then query. A stale response
  // from an older keystroke is ignored via the live flag.
  useEffect(() => {
    if (!searching) return;
    let live = true;
    const t = setTimeout(() => {
      setLoading(true);
      setErr('');
      searchVideoCallRequestsRemote(q.trim())
        .then((res) => { if (live) setRows(res || []); })
        .catch((e) => { if (live) { setRows([]); setErr(friendlyError(e)); } })
        .finally(() => { if (live) setLoading(false); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q, searching]);

  const goPrev = () => { const p = page - 1; setPage(p); loadDatePage(cursorStack[p], p); };
  const goNext = () => { const p = page + 1; setPage(p); loadDatePage(cursorStack[p], p); };

  // Open the customer's WhatsApp chat with a gentle prefilled message about
  // this piece, then mark the request Contacted — both locally (so the row
  // flips immediately) and on the server.
  const doContactViaWhatsApp = (row) => {
    const message = `Hello ${first(row.customerName)}, thank you for your interest in the ${row.product_title} from 85 Lansdowne. We would love to show it to you on a video call. What time would suit you best?`;
    window.open(`https://wa.me/${waNumber(row.mobile)}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');

    setMarkingId(row._id);
    markVideoCallContactedRemote(row._id)
      .then(() => {
        setRows((prev) => prev.map((r) => (r._id === row._id ? { ...r, status: 'contacted' } : r)));
      })
      .catch((e) => setErr(friendlyError(e)))
      .finally(() => setMarkingId(null));
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow mb-1">Video consultations</div>
          <h1 className="luxe-title text-3xl">Video Consultations</h1>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <input type="date" className="input sm:max-w-xs" value={dateValue} onChange={(e) => setDateValue(e.target.value)} />
        <input className="input sm:max-w-xs" placeholder="Search by phone, name or product" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {err && <div className="text-red-600 text-[10px] mt-1">{err}</div>}

      <div className="card overflow-x-auto">
        <table className="tbl min-w-[680px]">
          <thead>
            <tr><th>Requested</th><th>Customer</th><th>Phone</th><th>Product</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="text-sm text-steel text-center py-6">Loading…</td></tr>}
            {!loading && rows.map((row) => (
              <tr key={row._id}>
                <td className="text-sm text-steel">{fmtWhen(row.created_at)}</td>
                <td className="font-medium">{row.customerName}</td>
                <td className="text-sm text-steel">{row.mobile}</td>
                <td className="text-sm">{row.product_title}</td>
                <td className="text-sm text-steel">{row.status === 'contacted' ? 'Contacted' : 'New'}</td>
                <td className="text-center whitespace-nowrap">
                  <button onClick={() => doContactViaWhatsApp(row)} disabled={markingId === row._id} className="btn-ghost !px-2 !py-1.5 text-[11px] disabled:opacity-40">
                    Video call via WhatsApp
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6}><Empty>{searching ? 'No video call requests match your search.' : 'No video call requests on this day.'}</Empty></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {!searching && (
        <div className="flex items-center justify-between text-xs text-steel">
          <span>Showing {rows.length}</span>
          <div className="flex gap-2">
            <button disabled={page === 0} onClick={goPrev} className="btn-ghost !py-1.5 disabled:opacity-40">← Prev</button>
            <span className="px-3 py-1.5">Page {page + 1}</span>
            <button disabled={isDone} onClick={goNext} className="btn-ghost !py-1.5 disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
