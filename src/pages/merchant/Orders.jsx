import { useEffect, useRef, useState } from 'react';
import {
  fetchOrderRequestsByDate, searchOrderRequestsRemote, cancelOrderRequestRemote,
  friendlyError,
} from '../../lib/db.js';
import { inr } from '../../lib/util.js';
import { Empty } from '../../components/ui.jsx';

// Build Step 4.
// Design spec: docs/superpowers/specs/2026-11-15-customer-orders-design.md
// Every className here is copied from an existing page (Customer CRM,
// Campaigns, Dashboard) so this page reads as a sibling of Customer CRM.

const PAGE = 20; // date-mode page size (spec Step 4c)
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

// Time and date of a row, shown in India time.
function fmtWhen(ms) {
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-IN', { timeZone: KOLKATA, day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-IN', { timeZone: KOLKATA, hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

// One line of text per item, e.g. "Saree · Size M · Qty 2". FREE reads
// "Free size", ONE reads "One size", CUSTOM reads "Custom size", NONE shows
// no size text (legacy).
function lineText(line) {
  const parts = [line.title];
  if (line.size === 'FREE') parts.push('Free size');
  else if (line.size === 'ONE') parts.push('One size');
  else if (line.size === 'CUSTOM') parts.push('Custom size');
  else if (line.size !== 'NONE') parts.push(`Size ${line.size}`);
  parts.push(`Qty ${line.qty}`);
  return parts.join(' · ');
}

// Every saved measurement value that exists, as readable label pairs.
function measurementPairs(m) {
  const want = [
    ['Bust', m.bust], ['Waist', m.waist], ['Hip', m.hip], ['Shoulder', m.shoulder],
    ['Length', m.top_length], ['Sleeve length', m.sleeve_length], ['Armhole', m.armhole],
    ['Bottom length', m.bottom_length], ['Height', m.height], ['Notes', m.notes],
  ];
  return want.filter(([, v]) => v !== undefined && v !== null && v !== '');
}

export default function Orders() {
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

  // Which custom line's measurements are expanded, keyed `${row._id}:${i}`.
  const [openMeasure, setOpenMeasure] = useState(null);
  // Which row is in its cancel-confirm step, plus whether a cancel is running.
  const [confirmId, setConfirmId] = useState(null);
  const [cancelling, setCancelling] = useState(false);

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
    fetchOrderRequestsByDate({ fromMs, toMs, cursor, numItems: PAGE })
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
    setConfirmId(null);
    setOpenMeasure(null);
    const { fromMs, toMs } = istDayWindow(dateValue);
    const mySeq = loadSeq.current + 1;
    loadSeq.current = mySeq;
    setLoading(true);
    setErr('');
    fetchOrderRequestsByDate({ fromMs, toMs, cursor: null, numItems: PAGE })
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
      setConfirmId(null);
      setOpenMeasure(null);
      searchOrderRequestsRemote(q.trim())
        .then((res) => { if (live) setRows(res || []); })
        .catch((e) => { if (live) { setRows([]); setErr(friendlyError(e)); } })
        .finally(() => { if (live) setLoading(false); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q, searching]);

  const goPrev = () => { const p = page - 1; setPage(p); setConfirmId(null); loadDatePage(cursorStack[p], p); };
  const goNext = () => { const p = page + 1; setPage(p); setConfirmId(null); loadDatePage(cursorStack[p], p); };

  // Reload the view currently on screen after a cancel resolves.
  const reloadCurrent = () => {
    if (searching) {
      setLoading(true);
      searchOrderRequestsRemote(q.trim())
        .then((res) => setRows(res || []))
        .catch((e) => { setRows([]); setErr(friendlyError(e)); })
        .finally(() => setLoading(false));
    } else {
      loadDatePage(cursorStack[page], page);
    }
  };

  const doCancel = (row) => {
    setCancelling(true);
    setErr('');
    cancelOrderRequestRemote(row._id)
      .then(() => { setConfirmId(null); reloadCurrent(); })
      .catch((e) => setErr(friendlyError(e)))
      .finally(() => setCancelling(false));
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow mb-1">Customer orders</div>
          <h1 className="luxe-title text-3xl">Orders</h1>
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
            <tr><th>Time</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="text-sm text-steel text-center py-6">Loading…</td></tr>}
            {!loading && rows.map((row) => (
              <tr key={row._id}>
                <td className="text-sm text-steel">{fmtWhen(row.created_at)}</td>
                <td>
                  <div className="font-medium">{row.customerName}</div>
                  <div className="text-xs text-steel">{row.customerMobile}</div>
                </td>
                <td>
                  {row.items.map((line, i) => (
                    <div key={i}>
                      <div className="text-sm">{lineText(line)}</div>
                      {line.size === 'CUSTOM' && line.measurements && (
                        <>
                          <button onClick={() => setOpenMeasure(openMeasure === `${row._id}:${i}` ? null : `${row._id}:${i}`)} className="btn-ghost !px-2 !py-1.5 text-[11px]">
                            View measurements
                          </button>
                          {openMeasure === `${row._id}:${i}` && (
                            <div className="text-xs text-steel">
                              {line.measurements.unit}
                              {measurementPairs(line.measurements).map(([label, value]) => ` · ${label} ${value}`).join('')}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </td>
                <td className="font-medium">{inr(row.subtotal_paise / 100)}</td>
                <td>
                  <div className="text-sm">{row.payment_preference === 'online' ? 'Online' : 'In store'}</div>
                  <div className="text-xs text-steel">Payment not collected</div>
                </td>
                <td className="text-sm text-steel">{row.status === 'cancelled' ? 'Cancelled' : 'Placed'}</td>
                <td className="text-center whitespace-nowrap">
                  {row.status === 'placed' && (
                    confirmId === row._id ? (
                      <div className="inline-flex gap-1.5 items-center">
                        <span className="text-xs text-steel">Cancel this order? Stock goes back.</span>
                        <button onClick={() => doCancel(row)} disabled={cancelling} className="btn-gold !px-2 !py-1.5 text-[11px] disabled:opacity-40">Confirm</button>
                        <button onClick={() => setConfirmId(null)} disabled={cancelling} className="btn-ghost !px-2 !py-1.5 text-[11px] disabled:opacity-40">Keep</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmId(row._id)} className="btn-ghost !px-2 !py-1.5 text-[11px]">Cancel</button>
                    )
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7}><Empty>{searching ? 'No orders match your search.' : 'No orders on this day.'}</Empty></td></tr>
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
