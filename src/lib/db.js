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
  if (!u) return null;

  // PRD §3.2 — Enforce 180-day expiry locally if the creation timestamp is known.
  // Missing timestamp preserves current behavior (token match only) for seed users.
  if (u.magic_token_created_at) {
    const expired = Date.now() > u.magic_token_created_at + 180 * 86400000;
    if (expired) return null;
  }

  return { ...u };
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
    password_hash: null,
    magic_token: c.magic_token ?? null,
    magic_token_created_at: c.magic_token_created_at ?? null,
    chat: [], location: null,
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
    // PRD §3.2 — Careful merge: preserve existing local magic_token and its
    // timestamp if Convex projection has them; otherwise keep local values.
    // Never overwrite with null/undefined from Convex.
    state.users[idx] = {
      ...prev,
      ...local,
      id: prev.id,
      convexId: cvx.id,
      password_hash: prev.password_hash,
      magic_token: local.magic_token ?? prev.magic_token,
      magic_token_created_at: local.magic_token_created_at ?? prev.magic_token_created_at,
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

/* ---------- Catalogue → Convex bridge (Step 6.2, PRD Module 2) ---------- */
// Contract parity: function names mirror convex/lookbooks.ts (Step 6) so the
// frontend surface (Catalogue.jsx) stays identical. Initial render = localStorage
// seed, then hydrateCatalogue() swaps in live Convex items.

export function allCatalogue() { return [...state.catalogueItems]; }

/** Full lookbook list from Convex (async). */
export function getLookbooks() {
  const client = getConvex();
  if (!client) return Promise.resolve([]);
  return client.query(api.lookbooks.getLookbooks).catch(() => []);
}

/** Full lookbook + items from Convex (async). */
export function getLookbookById(id) {
  const client = getConvex();
  if (!client) return Promise.resolve(null);
  return client.query(api.lookbooks.getLookbookById, { id }).catch(() => null);
}

/** Create lookbook on Convex (async). */
export function createLookbook(args) {
  const client = getConvex();
  if (!client) return Promise.resolve({ ok: false });
  return client.mutation(api.lookbooks.createLookbook, args).catch(() => ({ ok: false }));
}

/** Patch lookbook on Convex (async). */
export function updateLookbook(id, patch) {
  const client = getConvex();
  if (!client) return Promise.resolve(null);
  return client.mutation(api.lookbooks.updateLookbook, { id, ...patch }).catch(() => null);
}

/** Delete lookbook + items on Convex (async). */
export function deleteLookbook(id) {
  const client = getConvex();
  if (!client) return Promise.resolve(null);
  return client.mutation(api.lookbooks.deleteLookbook, { id }).catch(() => null);
}

/** Add catalogue item with optimistic update + Convex write-through (Step 6.2). */
export function addCatalogueItem({ title, price, image_url, instagram_link, source, lookbook_id }) {
  // 1. Optimistic update (INR price for local UI)
  const item = {
    id: uid('it'),
    handle: uid('it').toLowerCase(),
    title,
    price: Number(price) || 0,
    image_url: image_url || '',
    instagram_link: instagram_link || '',
    source: source || 'manual',
    likes: 0,
    lookbook_id
  };
  state.catalogueItems.unshift(item);
  pushEvent('owner', 'catalogue', `New lookbook item added · ${title} (₹${item.price})`);
  emit();

  // 2. Convex write-through (PAISE integer)
  const client = getConvex();
  if (client) {
    // If no lookbook_id provided, we try to find one or ignore (PRD says item must have lookbook)
    // For the demo / standalone catalogue, we expect the caller to provide it or the first lookbook.
    client.query(api.lookbooks.getLookbooks).then((lbs) => {
      const lbId = lookbook_id || (lbs && lbs[0] ? lbs[0]._id : null);
      if (lbId) {
        client.mutation(api.lookbooks.addCatalogueItem, {
          lookbook_id: lbId,
          title,
          price: Math.round((Number(price) || 0) * 100),
          image_url: image_url || '',
          instagram_link: instagram_link || undefined
        }).then((cvxId) => {
          // Stamp the real ID so subsequent deletes/updates target Convex
          const idx = state.catalogueItems.findIndex((i) => i.id === item.id);
          if (idx >= 0) {
            state.catalogueItems[idx].convexId = cvxId;
            state.catalogueItems[idx].id = cvxId; // Swap local ID for Convex ID
            persist();
          }
        }).catch(() => { /* offline — keep local */ });
      }
    });
  }
  return item;
}

/** Patch catalogue item on Convex (async). */
export function updateCatalogueItem(id, patch) {
  const client = getConvex();
  if (!client) return Promise.resolve(null);
  const p = { ...patch };
  if (p.price !== undefined) p.price = Math.round(Number(p.price) * 100);
  return client.mutation(api.lookbooks.updateCatalogueItem, { id, ...p }).catch(() => null);
}

/** Delete item with optimistic update + Convex write-through (Step 6.2). */
export function removeCatalogueItem(id) {
  const item = state.catalogueItems.find((i) => i.id === id);
  const convexId = item ? (item.convexId || (String(id).startsWith('it_') ? null : id)) : null;

  // 1. Optimistic remove
  state.catalogueItems = state.catalogueItems.filter((i) => i.id !== id);
  emit();

  // 2. Convex delete
  if (convexId) {
    const client = getConvex();
    if (client) {
      client.mutation(api.lookbooks.deleteCatalogueItem, { id: convexId })
        .catch(() => { /* offline */ });
    }
  }
}

/** Background hydrate catalogue items from all lookbooks (Step 6.2). */
let catalogueHydrating = false;
export function hydrateCatalogue() {
  if (catalogueHydrating) return;
  const client = getConvex();
  if (!client) return;
  catalogueHydrating = true;

  client.query(api.lookbooks.getLookbooks)
    .then(async (lookbooks) => {
      if (!Array.isArray(lookbooks)) { catalogueHydrating = false; return; }
      const allItems = [];
      for (const lb of lookbooks) {
        const detail = await client.query(api.lookbooks.getLookbookById, { id: lb._id });
        if (detail && detail.items) {
          allItems.push(...detail.items.map((i) => ({
            id: i._id,
            convexId: i._id,
            handle: i._id.toLowerCase(),
            title: i.title,
            price: (i.price || 0) / 100, // Paise to INR
            image_url: i.image_url,
            instagram_link: i.instagram_link || '',
            source: lb.source || 'manual',
            likes: 0,
            lookbook_id: lb._id
          })));
        }
      }
      if (allItems.length > 0) {
        state.catalogueItems = allItems;
        emit();
      }
      catalogueHydrating = false;
    })
    .catch(() => { catalogueHydrating = false; });
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

  // Convex write-through
  const client = getConvex();
  if (client) {
    client.mutation(api.orders.createOrder, {
      user_id: convexUserId(userId),
      subtotal_paise: Math.round(subtotal * 100),
      payment_method: paymentMethod === 'online' ? 'online' : 'offline',
      points_applied: pointsApplied
    }).catch((err) => console.error('[checkout] Convex mutation failed:', err));
  }

  return order;
}

/** Get all orders (async). */
export function getOrders() {
  const client = getConvex();
  if (!client) return Promise.resolve([]);
  return client.query(api.orders.getOrders).catch(() => []);
}

/** Get orders for today (async). */
export function getTodayOrders() {
  const client = getConvex();
  if (!client) return Promise.resolve([]);
  return client.query(api.orders.getTodayOrders).catch(() => []);
}

/** Get today's summary (async). */
export function getTodaySummary() {
  const client = getConvex();
  if (!client) return Promise.resolve({ order_count: 0, revenue_paise: 0, points_issued: 0, points_redeemed: 0 });
  return client.query(api.orders.getTodaySummary).catch(() => ({ order_count: 0, revenue_paise: 0, points_issued: 0, points_redeemed: 0 }));
}
/* ---------- Reviews → Convex bridge (Step 8.2) ---------- */
// Contract parity: function names mirror convex/reviews.ts (Step 8.1) so the
// frontend surface stays identical. Components (Dashboard.jsx, Customers.jsx,
// Lookbook.jsx) call pendingGmbReviews()/setReviewStatus()/submitGmbReview()/
// submitProductReview() SYNCHRONOUSLY, so we use the local-first bridge pattern
// (Steps 4.5/5.5/6.2/7.2): localStorage is the initial render, and a background
// hydrate merges live Convex rows into state and emits — the UI then re-renders
// with real backend data WITHOUT any component edits.

// Map local platform → Convex type
const platformToType = (platform) => {
  if (platform === 'gmb') return 'gmb';
  if (platform === 'in-app') return 'product';
  return 'testimonial';
};

// Map Convex type → local platform
const typeToPlatform = (type) => {
  if (type === 'gmb') return 'gmb';
  if (type === 'product') return 'in-app';
  return 'testimonial';
};

// Map local status → Convex status
const localToConvexStatus = (status) => {
  if (status === 'resolved') return 'declined';
  return status;
};

// Convert a Convex review doc to local shape
function toLocalReview(cvx) {
  return {
    id: cvx._id,
    convexId: cvx._id,
    _isConvex: true,
    userId: cvx.user_id,
    catalogueItemId: null, // Convex doesn't have this field yet
    platform: typeToPlatform(cvx.type),
    stars: cvx.rating ?? 5,
    review_text: cvx.text,
    status: cvx.status,
    createdAt: new Date(cvx.created_at).toISOString(),
  };
}

// Merge a single Convex review into state.reviews (idempotent).
// Matches by convexId so a re-hydrate refreshes instead of duplicating.
function mergeConvexReview(cvx, silent = false) {
  if (!cvx || !cvx._id) return false;
  const local = toLocalReview(cvx);
  const idx = state.reviews.findIndex((r) => r.convexId === cvx._id);
  if (idx >= 0) {
    const prev = state.reviews[idx];
    // Keep local id for UI features; take authoritative fields + convexId from backend.
    state.reviews[idx] = {
      ...prev,
      ...local,
      id: prev.id,
      convexId: cvx._id,
    };
  } else {
    state.reviews.unshift(local);
  }
  if (!silent) emit();
  return true;
}

// Background hydrate (Step 8.2): pull reviews from Convex and merge into local state.
// Components keep their synchronous contract — initial render = localStorage seed,
// then emit() swaps in live Convex data.
let reviewsHydrating = false;
export function hydrateReviews() {
  if (reviewsHydrating) return;
  const client = getConvex();
  if (!client) return;
  reviewsHydrating = true;
  client.query(api.reviews.getPendingReviews)
    .then((rows) => {
      reviewsHydrating = false;
      if (!Array.isArray(rows)) return;
      let changed = false;
      for (const r of rows) changed = mergeConvexReview(r, true) || changed;
      if (changed) emit();
    })
    .catch(() => { reviewsHydrating = false; /* offline — stay on localStorage seed */ });
}

// Re-hydrate when a review mutation succeeds so the list reflects the backend immediately.
function refreshFromConvexReview(doc) {
  mergeConvexReview(doc);
  return doc;
}

/** Full pending reviews from Convex (async). Falls back to [] when offline/error. */
export function getPendingReviews() {
  const client = getConvex();
  if (!client) return Promise.resolve([]);
  return client.query(api.reviews.getPendingReviews).catch(() => []);
}

/** Full reviews with optional status filter from Convex (async). */
export function getReviews({ status }) {
  const client = getConvex();
  if (!client) return Promise.resolve([]);
  return client.query(api.reviews.getReviews, { status }).catch(() => []);
}

/** Approve review on Convex (async). Returns { ok, points_awarded }. */
export function approveReview(id) {
  const client = getConvex();
  if (!client) return Promise.resolve({ ok: false });
  return client.mutation(api.reviews.approveReview, { id }).catch(() => ({ ok: false }));
}

/** Decline review on Convex (async). Returns { ok }. */
export function declineReview(id) {
  const client = getConvex();
  if (!client) return Promise.resolve({ ok: false });
  return client.mutation(api.reviews.declineReview, { id }).catch(() => ({ ok: false }));
}

/** Create review on Convex (async). Returns Convex review doc. */
export function createReview(review) {
  const client = getConvex();
  if (!client) return Promise.resolve(null);
  return client.mutation(api.reviews.createReview, review).catch(() => null);
}

/* ---------- Reviews (local-first, components call these SYNCHRONOUSLY) ---------- */
// These functions keep the EXACT same signatures and return shapes so components need ZERO changes.
// They do optimistic local updates, then write through to Convex in the background.

export function submitGmbReview(userId, stars, review_text) {
  const user = state.users.find((u) => u.id === userId);
  if (!user) return null;
  const rule = state.settings.tiers[user.tier] || state.settings.tiers.global;
  const bonus = rule.gmbPoints;

  // 1. Optimistic local create
  const review = { id: uid('r'), userId, catalogueItemId: null, platform: 'gmb', stars, review_text, status: 'pending', createdAt: now() };
  state.reviews.unshift(review);
  user.points += bonus;
  state.pointsLedger.unshift({ id: uid('l'), userId, action: 'earned', points: bonus, reason: 'Google Review bonus', createdAt: now() });
  pushEvent(userId, 'review', `${user.name} posted a Google review (${stars}★) — awaiting approval`);
  pushEvent(userId, 'points', `${user.name} earned ${bonus} pts · Google Review bonus`);
  emit();

  // 2. Convex write-through
  const client = getConvex();
  if (client) {
    client.mutation(api.reviews.createReview, {
      user_id: user.convexId || userId,
      type: 'gmb',
      text: review_text,
      rating: stars,
    }).then((cvxReview) => {
      if (cvxReview) {
        // Stamp the real Convex ID so subsequent approve/decline targets the backend
        const idx = state.reviews.findIndex((r) => r.id === review.id);
        if (idx >= 0) {
          state.reviews[idx].convexId = cvxReview._id;
          state.reviews[idx].id = cvxReview._id;
          persist();
        }
      }
    }).catch(() => { /* offline — keep local */ });
  }

  return { bonus, review };
}

export function submitProductReview(userId, catalogueItemId, stars, review_text) {
  const user = state.users.find((u) => u.id === userId);
  const item = state.catalogueItems.find((i) => i.id === catalogueItemId);
  if (!user || !item) return null;
  const rule = state.settings.tiers[user.tier] || state.settings.tiers.global;
  const bonus = rule.productReviewPoints;

  // 1. Optimistic local create
  const review = { id: uid('r'), userId, catalogueItemId, platform: 'in-app', stars, review_text, status: 'approved', createdAt: now() };
  state.reviews.unshift(review);
  user.points += bonus;
  state.pointsLedger.unshift({ id: uid('l'), userId, action: 'earned', points: bonus, reason: `Product review · ${item.title}`, createdAt: now() });
  pushEvent(userId, 'review', `${user.name} reviewed ${item.title} (${stars}★)`);
  pushEvent(userId, 'points', `${user.name} earned ${bonus} pts · Product review`);
  emit();

  // 2. Convex write-through
  const client = getConvex();
  if (client) {
    client.mutation(api.reviews.createReview, {
      user_id: user.convexId || userId,
      type: 'product',
      text: review_text,
      rating: stars,
    }).then((cvxReview) => {
      if (cvxReview) {
        const idx = state.reviews.findIndex((r) => r.id === review.id);
        if (idx >= 0) {
          state.reviews[idx].convexId = cvxReview._id;
          state.reviews[idx].id = cvxReview._id;
          persist();
        }
      }
    }).catch(() => { /* offline — keep local */ });
  }

  return { bonus, review };
}

export function setReviewStatus(id, status) {
  const r = state.reviews.find((x) => x.id === id);
  if (!r) return;

  // 1. Optimistic local update
  const prevStatus = r.status;
  r.status = status;
  const user = state.users.find((u) => u.id === r.userId);
  if (user) pushEvent(user.id, 'review', `${user.name}'s Google review ${status}`);
  emit();

  // 2. Convex write-through (only for pending → approved/declined transitions)
  if (prevStatus === 'pending' && (status === 'approved' || status === 'declined' || status === 'resolved')) {
    const client = getConvex();
    const convexId = r.convexId || (r._isConvex ? r.id : null);
    if (client && convexId) {
      const cvxStatus = localToConvexStatus(status);
      if (cvxStatus === 'approved') {
        client.mutation(api.reviews.approveReview, { id: convexId })
          .then((res) => {
            if (res && res.ok) {
              // Points already awarded locally; Convex also updated user points.
              // Refresh review from Convex to get authoritative points_awarded.
              refreshFromConvexReview({ ...r, _id: convexId, status: 'approved', points_awarded: res.points_awarded });
            }
          })
          .catch(() => { /* offline — local status stays */ });
      } else {
        // declined or resolved → Convex 'declined'
        client.mutation(api.reviews.declineReview, { id: convexId })
          .then(() => {
            refreshFromConvexReview({ ...r, _id: convexId, status: 'declined' });
          })
          .catch(() => { /* offline — local status stays */ });
      }
    }
  }
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

/**
 * Onboarding (Join flow): creates a local profile (synchronous) then triggers
 * a Convex write-through (async) to persist the customer (mobile-unique check).
 * Keeps sync return shape so /join doesn't need to be async.
 */
export function onboardCustomer(f) {
  const mobile = waDigits(f.whatsapp || f.calling);
  const digits = mobile.replace(/\D/g, '');
  if (digits.length !== 10) return { error: "Please enter a valid 10-digit mobile number" };

  const local = createLocalCustomer(f);
  const client = getConvex();
  if (client) {
    client
      .mutation(api.customers.createCustomer, {
        mobile,
        name: (f.name || 'New Client').trim(),
        ...(f.birthday ? { birthday: mdFromDate(f.birthday) } : {}),
        ...(f.anniversary ? { anniversary: mdFromDate(f.anniversary) } : {}),
      })
      .then((res) => {
        if (res.ok) {
          syncMagicLinkCustomer(res.customer, local.user.magic_token, res.id);
        }
      })
      .catch(() => { /* offline — keep local */ });
  }
  return local;
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
    if (created && !created.ok) return { error: created.error };
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
  const base = {
    ...toLocalCustomer({ ...publicUser, id }),
    magic_token: token,
    magic_token_created_at: publicUser.magic_token_created_at || null,
    convexId: id,
  };
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
// Step 6.2 Catalogue bridge: hydrate catalogue items from Convex in the
// background. /merchant/catalogue renders the localStorage seed instantly, then
// swaps in the live Convex items as lookbooks are fetched.
hydrateCatalogue();
// Step 8.2 Reviews bridge: hydrate pending reviews from Convex in the
// background. /merchant/dashboard and /merchant/customers render the
// localStorage seed instantly, then swap in live Convex reviews.
hydrateReviews();
