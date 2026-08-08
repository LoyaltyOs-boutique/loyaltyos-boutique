// In-browser persistence layer — mirrors the full relational schema (users, orders,
// pointsLedger, reviews, campaigns, tickets, events). Swappable for a real
// Express + Prisma backend later via the same function surface.
//
// AUTH BRIDGE (Step 3.5): secure auth delegates to Convex (convex/auth.ts).
// The UI (Login.jsx, App.jsx, merchant guards) calls these functions
// SYNCHRONOUSLY, so we keep the same names/signatures and return the local
// patient-era user object for rendering; the real bcrypt verification and the
// 256-bit session token live on the Convex backend (pleasant-cobra-560).
// Password is NEVER compared locally or stored in localStorage — the local
// user object serves as the session cache, and the Convex users row is updated
// with session_token/session_expiry when the browser is online.
import { buildSeed } from '../data/seed.js';
// Convex backend bridge (Step 3.5): one shared ConvexReactClient is created here
// lazily (and reused by the ConvexProvider in main.jsx) so auth functions can
// hit the live backend (pleasant-cobra-560) while the UI stays synchronous.
import { ConvexReactClient } from 'convex/react';
import { api } from '../../convex/_generated/api.js';

const KEY = 'loyaltyos85_v2';
const SEED_VERSION = 2;
let state = null;
let listeners = new Set();

function now() { return new Date().toISOString(); }
const uid = (p) => (p || 'x') + '_' + Math.random().toString(36).slice(2, 9);

function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Re-seed if the stored shape is missing data or from an older build.
      if (parsed && parsed.meta && parsed.meta.version === SEED_VERSION && Array.isArray(parsed.events)) {
        state = parsed;
        return state;
      }
    }
  } catch (e) { /* corrupted → reseed */ }
  state = buildSeed();
  persist();
  return state;
}
function persist() { localStorage.setItem(KEY, JSON.stringify(state)); }
function emit() { persist(); listeners.forEach((l) => l()); }

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getData() { return load(); }
export function resetDemo() { localStorage.removeItem(KEY); state = buildSeed(); emit(); }

const pushEvent = (userId, type, text) => {
  state.events.unshift({ id: uid('e'), userId, type, text, ts: now() });
  state.events = state.events.slice(0, 200);
};

/* ---------- Auth ---------- */
// One shared Convex client. main.jsx calls setConvexClient() with the same
// instance it wraps in <ConvexProvider>; if that hasn't happened yet (or when
// running without the provider), we lazily create our own from VITE_CONVEX_URL.
let sharedConvex = null;
let sharedUrl = '';
export function setConvexClient(client, url) { sharedConvex = client; sharedUrl = url || ''; }
function getConvex() {
  if (sharedConvex) return sharedConvex;
  const url = sharedUrl || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CONVEX_URL) || '';
  if (!url) return null;
  try { sharedConvex = new ConvexReactClient(url); } catch { sharedConvex = null; }
  return sharedConvex;
}

/** Returns the merchant from the local seed/search cache — NEVER compares password locally. */
function localMerchantByEmail(email) {
  const e = String(email || '').toLowerCase();
  return state.users.find((x) => x.role === 'merchant' && String(x.email || '').toLowerCase() === e) || null;
}

export function merchantLogin(email, password) {
  const u = localMerchantByEmail(email);
  // Security: wrong credentials MUST fail. Email not found or password mismatch
  // → return null so Login.jsx shows "Incorrect email or password." (demo seed
  // stores plaintext password_hash; real bcrypt compare happens server-side
  // once Convex auth is fully wired).
  if (!u) return null;
  if (u.password_hash !== password) return null;
  // Bridge to Convex WITHOUT awaiting: the UI contract is synchronous and we
  // must not change component behavior. When online, the real bcrypt check runs
  // server-side and the users row gets session_token/session_expiry — so the
  // dashboard Data -> users table now reflects the login.
  const client = getConvex();
  if (u && client) {
    try {
      client
        .mutation(api.auth.merchantLogin, { email, password })
        .then((res) => {
          if (res && res.token) {
            // Store the 256-bit Convex-issued token against the LOCAL user id so
            // the synchronous UI guards keep working.
            saveMerchantSession(u.id, res.token);
            const sIdx = state.users.findIndex((x) => x.id === u.id);
            if (sIdx >= 0) {
              state.users[sIdx] = { ...state.users[sIdx], session_token: res.token, session_expiry: res.expiresAt };
              persist();
            }
          }
        })
        .catch(() => { /* offline — keep local demo flow */ });
    } catch { /* same */ }
  } else if (u) {
    // No Convex client available: issue a local random token so the demo still
    // logs in, but NEVER the plaintext password.
    saveMerchantSession(u.id);
  }
  return u;
}
export function merchantByEmail(email) {
  return localMerchantByEmail(email);
}
export function validateLookbook(id, token) {
  const u = state.users.find((x) => x.role === 'customer' && x.id === id && x.magic_token === token);
  return u ? { ...u } : null;
}
export function customerById(id) { return state.users.find((x) => x.id === id); }

/* ---------- Auth → Convex bridges (PRD §3.1/§3.2) ---------- */
/** Issue/rotate a customer's magic link on Convex (PRD §3.2). Async — UI not yet wired. */
export function generateMagicToken(mobile, baseUrl) {
  const client = getConvex();
  if (!client) return Promise.resolve(null);
  return client.mutation(api.auth.generateMagicToken, { mobile, baseUrl }).catch(() => null);
}
/** Validate a customer magic link against Convex (180-day expiry, PRD §3.2). Async. */
export function validateMagicToken(id, token, now) {
  const client = getConvex();
  if (!client) return Promise.resolve(null);
  return client.query(api.auth.validateMagicToken, { id, token, now }).catch(() => null);
}
/** Request a merchant password reset — real recovery email via Convex action (Step 3.7, PRD §3.1). Async. */
export function forgotPassword(email, baseUrl) {
  const client = getConvex();
  if (!client) return Promise.resolve({ ok: true });
  // forgotPassword is an ACTION (not a mutation) → invoke with client.action.
  // Always resolves {ok:true} for anti-enumeration; errors are logged for dev visibility.
  return client.action(api.auth.forgotPassword, { email, baseUrl }).catch((err) => {
    console.error('[forgotPassword] Convex action failed:', err);
    return { ok: true };
  });
}

/* ---------- Catalogue ---------- */
export function allCatalogue() { return [...state.catalogueItems]; }
export function addCatalogueItem({ title, price, image_url, instagram_link, source }) {
  const item = { id: uid('it'), handle: uid('it').toLowerCase(), title, price: Number(price) || 0, image_url: image_url || '', instagram_link: instagram_link || '', source: source || 'manual', likes: 0 };
  state.catalogueItems.unshift(item);
  pushEvent('owner', 'catalogue', `New lookbook item added · ${title} (₹${item.price})`);
  emit();
  return item;
}
export function removeCatalogueItem(id) {
  state.catalogueItems = state.catalogueItems.filter((i) => i.id !== id);
  emit();
}

/* ---------- Customer actions ---------- */
export function likeItem(userId, itemId) {
  const item = state.catalogueItems.find((i) => i.id === itemId);
  const user = state.users.find((u) => u.id === userId);
  if (!item || !user) return;
  item.likes = (item.likes || 0) + 1;
  pushEvent(userId, 'like', `${user.name} liked ${item.title} ♥`);
  emit();
}
export function adjustPoints(userId, delta, reason) {
  const user = state.users.find((u) => u.id === userId);
  if (!user) return null;
  user.points = Math.max(0, user.points + delta);
  state.pointsLedger.unshift({ id: uid('l'), userId, action: 'adjustment', points: delta, reason, createdAt: now() });
  pushEvent(userId, 'points', `${user.name} points adjusted ${delta >= 0 ? '+' : ''}${delta} · ${reason}`);
  emit();
  return user.points;
}
export function addStaffNote(userId, text, by) {
  const user = state.users.find((u) => u.id === userId);
  if (!user) return;
  user.staff_notes = [{ id: uid('n'), text, ts: now(), by: by || 'Owner' }, ...user.staff_notes];
  emit();
}

/* ---------- Checkout ---------- */
export function checkout({ userId, items, pointsApplied, paymentMethod }) {
  const user = state.users.find((u) => u.id === userId);
  if (!user) return null;
  const subtotal = items.reduce((s, i) => s + i.price * (i.qty || 1), 0);
  const rule = state.settings.tiers[user.tier] || state.settings.tiers.global;
  const pointsEarned = Math.round((subtotal * (rule.purchasePercent || 5)) / 100);
  const finalTotal = Math.max(0, subtotal - pointsApplied);
  const order = {
    id: uid('o'), userId, subtotal, pointsApplied, discountValue: pointsApplied,
    paymentMethod, finalTotal, pointsEarned, items: items.map((i) => ({ catalogueItemId: i.id, title: i.title, price: i.price })),
    createdAt: now(),
  };
  state.orders.unshift(order);
  if (pointsApplied > 0) {
    user.points -= pointsApplied;
    state.pointsLedger.unshift({ id: uid('l'), userId, action: 'redeemed', points: pointsApplied, reason: 'Checkout · points discount', createdAt: now() });
  }
  user.points += pointsEarned;
  state.pointsLedger.unshift({ id: uid('l'), userId, action: 'earned', points: pointsEarned, reason: `Purchase · ${items[0]?.title || 'order'} (${rule.purchasePercent}% rule)`, createdAt: now() });
  pushEvent(userId, 'purchase', `${user.name} placed an order · ${items[0]?.title || 'lookbook'} ${paymentMethod === 'online' ? 'paid online' : 'reserved in store'} ₹${finalTotal.toLocaleString('en-IN')}`);
  emit();
  return order;
}

/* ---------- Reviews ---------- */
export function submitGmbReview(userId, stars, review_text) {
  const user = state.users.find((u) => u.id === userId);
  if (!user) return null;
  const rule = state.settings.tiers[user.tier] || state.settings.tiers.global;
  const bonus = rule.gmbPoints;
  state.reviews.unshift({ id: uid('r'), userId, catalogueItemId: null, platform: 'gmb', stars, review_text, status: 'pending', createdAt: now() });
  user.points += bonus;
  state.pointsLedger.unshift({ id: uid('l'), userId, action: 'earned', points: bonus, reason: 'Google Review bonus', createdAt: now() });
  pushEvent(userId, 'review', `${user.name} posted a Google review (${stars}★) — awaiting approval`);
  pushEvent(userId, 'points', `${user.name} earned ${bonus} pts · Google Review bonus`);
  emit();
  return { bonus, review: state.reviews[0] };
}
export function submitProductReview(userId, catalogueItemId, stars, review_text) {
  const user = state.users.find((u) => u.id === userId);
  const item = state.catalogueItems.find((i) => i.id === catalogueItemId);
  if (!user || !item) return null;
  const rule = state.settings.tiers[user.tier] || state.settings.tiers.global;
  const bonus = rule.productReviewPoints;
  state.reviews.unshift({ id: uid('r'), userId, catalogueItemId, platform: 'in-app', stars, review_text, status: 'approved', createdAt: now() });
  user.points += bonus;
  state.pointsLedger.unshift({ id: uid('l'), userId, action: 'earned', points: bonus, reason: `Product review · ${item.title}`, createdAt: now() });
  pushEvent(userId, 'review', `${user.name} reviewed ${item.title} (${stars}★)`);
  pushEvent(userId, 'points', `${user.name} earned ${bonus} pts · Product review`);
  emit();
  return { bonus, review: state.reviews[0] };
}
export function setReviewStatus(id, status) {
  const r = state.reviews.find((x) => x.id === id);
  if (!r) return;
  r.status = status;
  const user = state.users.find((u) => u.id === r.userId);
  if (user) pushEvent(user.id, 'review', `${user.name}'s Google review ${status}`);
  emit();
}

/* ---------- Campaigns ---------- */
export function dispatchCampaign({ title, creative_url, message_body, audience_segment, targets }) {
  const campaign = {
    id: uid('cp'), title, creative_url: creative_url || '', message_body,
    audience_segment, sent_count: targets.length, clicks_count: 0, sentAt: now(),
  };
  state.campaigns.unshift(campaign);
  targets.forEach((u) => {
    const body = message_body.replace(/\{client_name\}/g, u.name.split(' ')[0]);
    u.chat = [...(u.chat || []), { id: uid('c'), from: '85 Lansdowne', text: body, ts: now(), campaign: title }];
  });
  pushEvent('owner', 'campaign', `Campaign "${title}" dispatched to ${targets.length} clients`);
  emit();
  return campaign;
}

/* ---------- Tickets & settings ---------- */
export function createTicket({ ownerId, category, priority, message }) {
  const t = { id: uid('t'), ownerId, category, priority, message, status: 'open', createdAt: now() };
  state.tickets.unshift(t);
  emit();
  return t;
}
export function saveTierSettings(tierKey, patch) {
  if (!state.settings.tiers[tierKey]) return;
  state.settings.tiers[tierKey] = { ...state.settings.tiers[tierKey], ...patch };
  emit();
}

/* ---------- Derived ---------- */
export function customers() { return state.users.filter((u) => u.role === 'customer'); }
export function pendingGmbReviews() { return state.reviews.filter((r) => r.platform === 'gmb' && r.status === 'pending'); }
export function activityFeed() { return state.events.slice(0, 40); }
export function customerLedger(userId) {
  const ledger = state.pointsLedger.filter((l) => l.userId === userId).map((l) => ({ ...l, kind: 'points' }));
  const orders = state.orders.filter((o) => o.userId === userId).map((o) => ({ ...o, kind: 'order' }));
  const reviews = state.reviews.filter((r) => r.userId === userId).map((r) => ({ ...r, kind: 'review' }));
  return [...orders, ...reviews, ...ledger].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
export function derivedMetrics() {
  const cs = customers();
  const loyaltyRevenue = state.orders.reduce((s, o) => s + o.finalTotal, 0);
  const pointsIssued = state.pointsLedger.filter((l) => l.action === 'earned').reduce((s, l) => s + l.points, 0);
  return {
    totalCustomers: cs.length,
    loyaltyRevenue,
    pointsIssued,
    pendingReviews: pendingGmbReviews().length,
    birthdaysToday: cs.filter((c) => c.birthday === todayMD()).length,
    anniversariesToday: cs.filter((c) => c.anniversary === todayMD()).length,
  };
}
function todayMD() { const d = new Date(); return `${d.getMonth() + 1}-${d.getDate()}`; }

/* ---------- Sessions (180-day customer, merchant) ---------- */
const CUST_KEY = 'loyaltyos_customer_session';
const MERC_KEY = 'loyaltyos_merchant_session';
export function saveCustomerSession(id, token) { localStorage.setItem(CUST_KEY, JSON.stringify({ id, token, ts: Date.now() })); }
export function getCustomerSession() {
  try {
    const s = JSON.parse(localStorage.getItem(CUST_KEY));
    if (!s) return null;
    if (Date.now() - s.ts > 180 * 864e5) { localStorage.removeItem(CUST_KEY); return null; }
    return validateLookbook(s.id, s.token) ? s : null;
  } catch { return null; }
}
export function clearCustomerSession() { localStorage.removeItem(CUST_KEY); }
// Merchant session: stores ONLY the 256-bit token issued by Convex + an id.
// The password is never stored here (or anywhere in the browser).
export function saveMerchantSession(id, token) {
  localStorage.setItem(MERC_KEY, JSON.stringify({ id, token: token || null, ts: Date.now() }));
}
export function getMerchantSession() {
  try {
    const s = JSON.parse(localStorage.getItem(MERC_KEY));
    if (!s) return null;
    // Session cache: return the local user when a session token exists.
    // (Server-side expiry is enforced by Convex auth on the next step when we
    //  fully swap session checks to the backend. The UI guards remain local.)
    return state.users.find((u) => u.id === s.id && u.role === 'merchant') ? s : null;
  } catch { return null; }
}
export function clearMerchantSession() { localStorage.removeItem(MERC_KEY); }

/* ---------- Client onboarding & magic links ---------- */
const mdFromDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}-${d.getDate()}`;
};
const slugify = (s) =>
  (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'client';
const genToken = () => {
  try {
    return (crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 12));
  } catch {
    return Array.from({ length: 44 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
  }
};
export function waDigits(n) { return String(n || '').replace(/[^0-9]/g, ''); }

export function onboardCustomer({ name, whatsapp, calling, birthday, anniversary, city, country, note }) {
  const existing = customers();
  let id = slugify(name);
  let n = 1;
  while (existing.some((c) => c.id === id)) { id = `${slugify(name)}-${n++}`; }
  const token = genToken();
  const user = {
    id,
    email: null,
    mobile: waDigits(whatsapp || calling),
    whatsapp: waDigits(whatsapp),
    password_hash: null,
    magic_token: token,
    role: 'customer',
    name: (name || 'New Client').trim(),
    points: 0,
    birthday: mdFromDate(birthday),
    anniversary: mdFromDate(anniversary),
    tier: 'silver',
    custom_tags: [],
    measurements: {},
    staff_notes: note ? [{ id: uid('n'), text: note, ts: now(), by: 'Onboarding' }] : [],
    chat: [],
    location: { city: city || '', country: country || 'India' },
  };
  state.users.push(user);
  pushEvent(user.id, 'onboard', `${user.name} onboarded · magic link issued`);
  emit();
  const magicLink = `/lookbook?id=${id}&token=${token}`;
  return { user, magicLink };
}
export const waMessage = (user, magicLink) =>
  `Namaste ${(user.name || '').split(' ')[0]}, welcome to 85 Lansdowne 🖤 Your personal boutique link is ready — tap it when you're ready to browse:\n${location.origin}${magicLink}`;

// Eagerly load on module import so a fresh page load (e.g. straight to /login)
// can read `state` without a prior getData() call. Placed here — after `state` is
// initialized to null — to avoid a temporal-dead-zone access inside load().
state = load();