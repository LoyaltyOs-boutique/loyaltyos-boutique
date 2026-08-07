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
