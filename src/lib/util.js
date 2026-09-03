export const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
export const inrFull = (n) => Number(n || 0).toLocaleString('en-IN');
export const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return '—'; }
};
export const fmtTime = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
};
export const tierLabel = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '—');
// Relative timestamp for feeds ("2 min ago", "3 hr ago") — Dashboard's grouped
// Recent Activity rows (Task: Recent Activity redesign) need a compact preview
// timestamp; falls back to fmtDate for anything older than a week so the label
// never grows unbounded.
export const timeAgo = (iso) => {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  return fmtDate(iso);
};
export const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};
export const first = (name) => (name || '').split(' ')[0];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const parseMD = (md) => {
  if (!md) return '';
  const [m, d] = md.split('-').map(Number);
  if (!m || !d) return md;
  return `${d} ${MONTHS[m - 1]}`;
};
export const cls = (...xs) => xs.filter(Boolean).join(' ');
