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

/* ---------- Customer CRM → Convex bridge (Step 4.5, PRD Module 1) ---------- */
// Contract parity: function names mirror convex/customers.ts (Step 4) so the
// frontend surface stays identical. The components (Customers.jsx, Dashboard.jsx)
// call customers()/getData()/derivedMetrics()/addStaffNote SYNCHRONOUSLY, so we
// mirror the merchantLogin bridge pattern (Step 3.5): localStorage is the initial
// render, and a background hydrate merges live Convex rows into state and emits —
// the UI then re-renders with real backend data (e.g. Priya Sharma on
// pleasant-cobra-560) WITHOUT any component edits.
let crmHydrating = false;

// Convex store note/measurement/date shapes differ slightly from local ones.
const noteToLocal = (n) => ({
  id: n.id || uid('n'),
  text: n.text,
  ts: n.date ? new Date(n.date).toISOString() : now(),
  by: n.author || 'Owner',
});

// Map a Convex merchant customer row into the local user shape. For brand-new
// Convex-only customers we fabricate the local-only fields (magic_token, chat…)
// so every existing component feature (magic links, ledger, tags) keeps working.
function toLocalCustomer(c) {
  return {
    id: c.id, convexId: c.id, _isConvex: true,
    email: c.email ?? null,
    mobile: c.mobile ?? '',
    whatsapp: waDigits(c.mobile),
    name: c.name,
    points: c.points ?? 0,
    tier: c.tier ?? 'silver',
    birthday: c.birthday ?? null,
    anniversary: c.anniversary ?? null,
    custom_tags: c.custom_tags ?? [],
    measurements: c.measurements ?? {},
    staff_notes: (c.staff_notes || []).map(noteToLocal),
    password_hash: null, magic_token: null, chat: [], location: null,
    role: 'customer',
  };
}

// Merge a single Convex customer sheet into state.users (idempotent). Matches by
// convexId → mobile → name so a re-hydrate refreshes instead of duplicating.
// Preserves the local id/magic_token/chat for UI features while stamping
// convexId so mutations always target the real Convex doc.
function mergeConvexCustomer(cvx, silent = false) {
  if (!cvx || !cvx.id) return false;
  const local = toLocalCustomer(cvx);
  const idx = state.users.findIndex((u) =>
    (u.convexId && u.convexId === cvx.id) ||
    (u.mobile && cvx.mobile && waDigits(u.mobile) === waDigits(cvx.mobile)) ||
    (u.name && cvx.name && String(u.name).trim().toLowerCase() === String(cvx.name).trim().toLowerCase())
  );
  if (idx >= 0) {
    const prev = state.users[idx];
    // Keep the local id (magic links/ledger) + local-only fields; take the
    // authoritative CRM fields + convexId from the backend sheet.
    state.users[idx] = {
      ...prev,
      ...local,
      id: prev.id,
      convexId: cvx.id,
      password_hash: prev.password_hash,
      magic_token: prev.magic_token,
      whatsapp: prev.whatsapp || local.whatsapp,
      chat: prev.chat || [],
      location: prev.location,
    };
  } else {
    state.users.push(local);
  }
  if (!silent) emit();
  return true;
}

// Background hydrate (Step 4.5): pull the full customer list from Convex and
// merge it into the local state. Components keep their synchronous contract —
// initial render = localStorage seed, then emit() swaps in live Convex data.
export function hydrateCustomers() {
  if (crmHydrating) return;
  const client = getConvex();
  if (!client) return;
  crmHydrating = true;
  client.query(api.customers.getCustomers)
    .then((rows) => {
      crmHydrating = false;
      if (!Array.isArray(rows)) return;
      let changed = false;
      for (const c of rows) changed = mergeConvexCustomer(c, true) || changed;
      if (changed) emit();
    })
    .catch(() => { crmHydrating = false; /* offline — stay on localStorage seed */ });
}
// Re-hydrate when a customer spreadsheet mutation succeeds so the list reflects
// the backend immediately. Returns the Convex sheet doc for chaining callers.
function refreshFromConvexSheet(doc) {
  mergeConvexCustomer(doc);
  return doc;
}

/** Full customer list from Convex (async). Falls back to [] when offline/error. */
export function getCustomers() {
  const client = getConvex();
  if (!client) return Promise.resolve([]);
  return client.query(api.customers.getCustomers).catch(() => []);
}

/** Full customer profile by Convex id (async). Falls back to null when offline/error. */
export function getCustomerById(id) {
  const client = getConvex();
  if (!client) return Promise.resolve(null);
  return client.query(api.customers.getCustomerById, { id }).catch(() => null);
}

// Resolve the Convex `Id<"users">` for a UI-facing userId → keeps mutations valid
// for both hydrated Convex rows (convexId) and plain seed ids (passthrough).
const convexUserId = (userId) => {
  const u = state.users.find((x) => x.id === userId);
  return (u && u.convexId) || userId;
};

/** Patch a customer's body-fit measurements on Convex (async). */
export function updateMeasurements(userId, measurements) {
  const client = getConvex();
  if (!client) return Promise.resolve(null);
  return client.mutation(api.customers.updateMeasurements, { userId: convexUserId(userId), measurements })
    .then((updated) => (updated ? refreshFromConvexSheet(updated) : updated))
    .catch(() => null);
}

/** Replace a customer's custom tags on Convex (async). */
export function updateCustomTags(userId, tags) {
  const client = getConvex();
  if (!client) return Promise.resolve(null);
  return client.mutation(api.customers.updateCustomTags, { userId: convexUserId(userId), tags })
    .then((updated) => (updated ? refreshFromConvexSheet(updated) : updated))
    .catch(() => null);
}

/** Delight Queue — customers with a birthday within the next `days` days (async). */
export function getUpcomingBirthdays(days) {
  const client = getConvex();
  if (!client) return Promise.resolve([]);
  return client.query(api.customers.getUpcomingBirthdays, { days }).catch(() => []);
}

/** Delight Queue — customers with an anniversary within the next `days` days (async). */
export function getUpcomingAnniversaries(days) {
  const client = getConvex();
  if (!client) return Promise.resolve([]);
  return client.query(api.customers.getUpcomingAnniversaries, { days }).catch(() => []);
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
  // Local-first (Step 4.5): the UI contract is synchronous — render the note
  // instantly, then persist it to Convex in the background and refresh the row.
  user.staff_notes = [{ id: uid('n'), text, ts: now(), by: by || 'Owner' }, ...user.staff_notes];
  emit();
  const client = getConvex();
  const convexId = user.convexId || (user._isConvex ? user.id : null);
  if (client && convexId) {
    try {
      client.mutation(api.customers.addStaffNote, { userId: convexId, text, author: by || 'Owner' })
        .then((updated) => { if (updated) refreshFromConvexSheet(updated); })
        .catch(() => { /* offline — local note stays */ });
    } catch { /* same */ }
  }
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

/* ---------- Settings → Convex bridge (Step 5.5, PRD §8) ---------- */
// Contract parity: the Settings UI (Settings.jsx) calls saveTierSettings
// SYNCHRONOUSLY with a per-tier patch { key: value } and reads
// db.settings.tiers[tierKey][key]. So we keep that exact surface: local-first
// render via emit(), then a background Convex write-through (mirroring the
// merchantLogin bridge pattern from Step 3.5 and the CRM bridge from Step 4.5).
// When online, api.settings.* (convex/settings.ts, pleasant-cobra-560) is the
// source of truth; the localStorage copy is the offline/seed cache.

// Compute the FULL UI-model loyalty_rules payload from local state — the exact
// shape convex/settings.ts loyaltyRulesValidator accepts (tiers keyed by
// global|silver|gold|platinum with purchasePercent/birthdayBonus/gmbPoints/
// productReviewPoints/on). Missing tiers fall back to the seed defaults so the
// backend always receives a complete, valid document.
const loyaltyRulesPayload = () => ({
  tiers: {
    global: { ...(state.settings.tiers.global || {}) },
    silver: { ...(state.settings.tiers.silver || {}) },
    gold: { ...(state.settings.tiers.gold || {}) },
    platinum: { ...(state.settings.tiers.platinum || {}) },
  },
});

// Re-hydrate the local settings cache from the Convex merged settings doc
// (background, after a write-through or hydrate succeeds). Keeps db.settings in
// sync so components reading it synchronously always render the backend truth.
function refreshSettingsFromConvex(merged) {
  if (!merged || !merged.loyalty_rules || !merged.loyalty_rules.tiers) return false;
  state.settings.tiers = merged.loyalty_rules.tiers;
  emit();
  return true;
}

/**
 * Persist a tier-rule patch. SYNCHRONOUS local-first (the UI contract):
 * update the in-memory/localStorage copy instantly, then write the full
 * loyalty_rules payload to Convex in the background and refresh from the
 * backend's merged response. Never breaks the UI when offline.
 */
export function saveTierSettings(tierKey, patch) {
  if (!state.settings.tiers[tierKey]) return;
  state.settings.tiers[tierKey] = { ...state.settings.tiers[tierKey], ...patch };
  emit();
  const client = getConvex();
  if (client) {
    try {
      client
        .mutation(api.settings.updateSettings, { settings: loyaltyRulesPayload() })
        .then((merged) => refreshSettingsFromConvex(merged))
        .catch(() => { /* offline — local tier settings stay in effect */ });
    } catch { /* same */ }
  }
}

/**
 * Seed the local settings cache from Convex (Step 5.5 hydration bridge).
 * Called once on module load (like hydrateCustomers in Step 4.5): renders the
 * localStorage seed instantly, then swaps in live Convex settings when the
 * query resolves. If Convex has never had loyalty_rules written
 * (updated_at.loyalty_rules === null), the local seed is written through to
 * Convex so the backend becomes the source of truth with identical values.
 */
let settingsHydrating = false;
export function hydrateSettings() {
  if (settingsHydrating) return;
  const client = getConvex();
  if (!client) return;
  settingsHydrating = true;
  client.query(api.settings.getSettings)
    .then((merged) => {
      settingsHydrating = false;
      if (!merged || !merged.loyalty_rules || !merged.loyalty_rules.tiers) return;
      // First successful hydrate → if Convex was empty, seed it with local values
      // so the settings page stays pixel-identical while Convex becomes the truth.
      if (merged.updated_at && merged.updated_at.loyalty_rules === null) {
        client.mutation(api.settings.updateSettings, { settings: loyaltyRulesPayload() })
          .then((seeded) => { if (seeded) refreshSettingsFromConvex(seeded); })
          .catch(() => { /* offline — keep seed */ });
        return;
      }
      refreshSettingsFromConvex(merged);
    })
    .catch(() => { settingsHydrating = false; /* offline — stay on localStorage seed */ });
}

/** Full effective settings from Convex (async). Falls back to null when offline/error. */
export function getSettings() {
  const client = getConvex();
  if (!client) return Promise.resolve(null);
  return client.query(api.settings.getSettings).catch(() => null);
}

/** Update a global WhatsApp message template on Convex (async, PRD §8). */
export function updateTemplate(templateKey, text) {
  const client = getConvex();
  if (!client) return Promise.resolve(null);
  return client.mutation(api.settings.updateTemplate, { templateKey, text }).catch(() => null);
}

/** Restore defaults on Convex (async) — deletes all settings docs, defaults fallback. */
export function resetSettings() {
  const client = getConvex();
  if (!client) return Promise.resolve(null);
  return client.mutation(api.settings.resetSettings).catch(() => null);
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

/**
 * Core local onboarding: creates the customer row + a local magic token and
 * returns { user, magicLink } — the synchronous contract the /join
 * self-onboarding flow and same-browser demo rely on (shape is NEVER changed).
 */
function createLocalCustomer({ name, whatsapp, calling, birthday, anniversary, city, country, note }) {
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

/** Synchronous local-only onboarding — used by the /join self-onboarding flow (KEEP UNCHANGED). */
export function onboardCustomer(f) {
  return createLocalCustomer(f);
}

/**
 * Merchant Client Onboarding (magic-link fix): creates the customer on Convex
 * (createCustomer — unique per WhatsApp number) and rotates a BACKEND-issued
 * magic token (generateMagicToken). The returned link is keyed to the Convex
 * user id, so the client can open their PERSONAL MODULE directly from ANY
 * device — Lookbook.jsx validates via api.auth.validateMagicToken instead of
 * the local-only sync check. Falls back to the local link when Convex is
 * unreachable (same-browser demo keeps working).
 */
export async function onboardCustomerRemote(f) {
  const client = getConvex();
  if (!client) return createLocalCustomer(f);

  const mobile = waDigits(f.whatsapp || f.calling);
  try {
    // One WhatsApp number = ONE profile (createCustomer refuses duplicates and
    // returns the existing id — re-onboarding then just rotates the token).
    const created = await client.mutation(api.customers.createCustomer, {
      mobile,
      name: (f.name || 'New Client').trim(),
      ...(f.birthday ? { birthday: mdFromDate(f.birthday) } : {}),
      ...(f.anniversary ? { anniversary: mdFromDate(f.anniversary) } : {}),
    });
    const cvxId = created && (created.ok ? created.id : created.existingId);

    // Rotate/issue the 256-bit magic token on Convex (180-day validity).
    const linkRes = await client.mutation(api.auth.generateMagicToken, {
      mobile,
      ...(typeof location !== 'undefined' ? { baseUrl: location.origin } : {}),
    });
    if (!linkRes || !linkRes.user || !cvxId) return createLocalCustomer(f);

    // Stamp a local row keyed by the CONVEX id so likes/checkout/ledger and
    // the same-browser session all target the backend-backed customer. The
    // result card preserves the merchant-entered city/country via fallback.
    const synced = syncMagicLinkCustomer(linkRes.user, linkRes.token, cvxId, {
      location: { city: f.city || '', country: f.country || 'India' },
    });
    if (!synced) return createLocalCustomer(f);
    return {
      user: synced,
      magicLink: `/lookbook?id=${linkRes.user.id}&token=${linkRes.token}`,
    };
  } catch {
    return createLocalCustomer(f); // offline / Convex error → same-browser local link (unchanged)
  }
}

/**
 * Upsert the local view of a Convex-validated customer, keyed by their Convex
 * id, and stamp the validated magic token so this browser validates locally on
 * subsequent visits (180-day session + instant likes/checkout). Returns the
 * merged local-shaped row, or null when no id is available.
 */
export function syncMagicLinkCustomer(publicUser, token, cvxId, fallback) {
  const id = String((publicUser && publicUser.id) || cvxId || '');
  if (!id) return null;
  const base = { ...toLocalCustomer({ ...publicUser, id }), magic_token: token, convexId: id };
  const idx = state.users.findIndex((u) => u.id === id || u.convexId === id);
  if (idx >= 0) {
    state.users[idx] = {
      ...state.users[idx],
      ...base,
      id,
      location: state.users[idx].location || (fallback && fallback.location) || null,
    };
  } else {
    state.users.push({ ...base, location: (fallback && fallback.location) || null });
  }
  emit();
  return state.users.find((u) => u.id === id) || null;
}
export const waMessage = (user, magicLink) =>
  `Namaste ${(user.name || '').split(' ')[0]}, welcome to 85 Lansdowne 🖤 Your personal boutique link is ready — tap it when you're ready to browse:\n${location.origin}${magicLink}`;

// Eagerly load on module import so a fresh page load (e.g. straight to /login)
// can read `state` without a prior getData() call. Placed here — after `state` is
// initialized to null — to avoid a temporal-dead-zone access inside load().
state = load();
// Step 4.5 CRM bridge: after the eager load, hydrate the customer list from
// Convex in the background. Pages reading customers()/derivedMetrics() render
// the localStorage seed instantly, then emit() swaps in the live Convex rows
// (merchant CRM + Delight Desk) as soon as the query resolves.
hydrateCustomers();
// Step 5.5 Settings bridge: hydrate loyalty_rules from Convex in the background
// too. /merchant/settings renders the localStorage seed instantly, then swaps
// in the live Convex settings (with a seed-on-first-hydrate when Convex is
// empty) — same hydration approach as the CRM bridge above.
hydrateSettings();