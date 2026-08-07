// Seed database — real catalogue from 85lansdowne.com (Shopify CDN), demo customers.
export const BRAND = {
  name: '85 Lansdowne',
  tagline: 'Hand-crafted luxury fashion · Kolkata',
  logo: 'https://85lansdowne.com/cdn/shop/files/85LANSDOWNE_logo-e1562928167368_82b591f5-52b5-485a-85ba-9a0c06bdd149.png?v=1626525331',
  wa: '919836000000', // placeholder WhatsApp number for inquire buttons
}

export const COUNTRIES = [
  'India', 'United Arab Emirates', 'United States', 'United Kingdom', 'Singapore',
  'Australia', 'Qatar', 'Saudi Arabia', 'Kuwait', 'Oman', 'Canada', 'Germany', 'Netherlands',
  'France', 'Italy', 'Mauritius', 'South Africa', 'Nepal', 'Bangladesh', 'Other',
]

export const CATALOGUE = [
  ['koakh-paula-blouse', 'KOAKH · Paula Blouse', 4800, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/oo3.jpg?v=1721195914'],
  ['koakh-malta-pants', 'KOAKH · Malta Pants', 5900, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/ou3.jpg?v=1721195873'],
  ['koakh-starlet-pants', 'KOAKH · Starlet Pants', 5900, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/pi1.jpg?v=1721195837'],
  ['koakh-melo-dress', 'KOAKH · Melo Dress', 6500, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/s1.jpg?v=1721195709'],
  ['koakh-alice-dress', 'KOAKH · Alice Dress', 13000, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/a1.jpg?v=1721195664'],
  ['koakh-maya-top-pink', 'KOAKH · Maya Top — Pink', 5400, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/d4_2985d3ed-04f3-4178-9cbf-4817ddbba531.jpg?v=1721195121'],
  ['koakh-maya-coord-set-ombre-pink', 'KOAKH · Maya Coord Set — Ombré', 13900, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/d1_a66b33c0-f62d-4f7e-a28c-2ba8f53b9319.jpg?v=1721195074'],
  ['koakh-tamra-pants-beige', 'KOAKH · Tamra Pants — Beige', 7200, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/pp1.jpg?v=1721194699'],
  ['koakh-tamra-blouse-black', 'KOAKH · Tamra Blouse — Black', 5200, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/b3.jpg?v=1721194028'],
  ['koakh-tamra-blouse-red', 'KOAKH · Tamra Blouse — Red', 5200, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/co2_56ff5d2f-650c-4c77-b685-2e3623501856.jpg?v=1721194531'],
  ['koakh-tamra-coord-set-2', 'KOAKH · Tamra Coord Set', 11000, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/co1.jpg?v=1721194438'],
  ['koakh-valerie-pink-red', 'KOAKH · Valerie — Pink & Red', 5900, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/p2.jpg?v=1721193970'],
  ['koakh-tulip-dress', 'KOAKH · Tulip Dress', 12000, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/whitedress2.jpg?v=1721192986'],
  ['koakh-amber-dress', 'KOAKH · Amber Dress', 9000, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/bluedress2.jpg?v=1721192893'],
  ['koakh-gabrielle-dress', 'KOAKH · Gabrielle Dress', 7900, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/d7.jpg?v=1721192398'],
  ['koakh-sylvia-dress', 'KOAKH · Sylvia Dress', 9900, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/dresss2.jpg?v=1721192351'],
  ['koakh-bree-top-black', 'KOAKH · Bree Top — Black', 5500, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/TOP1.jpg?v=1721136148'],
  ['koakh-bella-top-black', 'KOAKH · Bella Top — Black', 5500, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/BLACK2.jpg?v=1721135857'],
  ['koakh-bree-skirt-black', 'KOAKH · Bree Skirt — Black', 6900, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/SKIRT1.jpg?v=1721136220'],
  ['koakh-lily-pants', 'KOAKH · Lily Pants', 6650, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/PANTT1.jpg?v=1721134975'],
  ['koakh-kate-dress', 'KOAKH · Kate Dress', 5900, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/LARA1.jpg?v=1721134704'],
  ['koakh-lara-shirt', 'KOAKH · Lara Shirt', 5300, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/SHIRT1.jpg?v=1721134646'],
  ['koakh-candy-blouse', 'KOAKH · Candy Blouse', 5600, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/CANDY2.jpg?v=1721134196'],
  ['tara-and-i-gold-high-neck-romper', 'Tara & I · Gold High-Neck Romper', 10500, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/TICQ23-PRO.jpg?v=1687333714'],
  ['tara-and-i-satin-pleated-skirt-lavender', 'Tara & I · Satin Pleated Skirt — Lavender', 8500, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/TICQ19-PRO.jpg?v=1687333553'],
  ['tara-and-i-pleated-lame-jumpsuit', 'Tara & I · Pleated Lamé Jumpsuit', 18000, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/TICQ15-PRO.jpg?v=1687333373'],
  ['tara-and-i-one-shoulder-lame-top', 'Tara & I · One-Shoulder Lamé Top', 6000, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/TICQ13-PRO.jpg?v=1687333306'],
  ['tara-and-i-satin-bolero-jacket', 'Tara & I · Satin Bolero Jacket', 8500, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/TICQ11-PRO.jpg?v=1687333223'],
  ['tara-and-i-satin-shirt-dress', 'Tara & I · Satin Shirt Dress', 8500, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/TICQ21-PRO.jpg?v=1687333628'],
  ['tara-and-i-lame-trench-dress', 'Tara & I · Lamé Trench Dress', 14500, 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/TICQ24-PRO.jpg?v=1687334892'],
].map(([handle, title, price, image_url], i) => ({
  id: String(i + 1),
  handle,
  title,
  price,
  image_url,
  source: 'manual',
  likes: 0,
}))

const ISO = (d) => d.toISOString();
const daysAgo = (n) => ISO(new Date(Date.now() - n * 864e5));
const todayMD = () => {
  const d = new Date();
  return { m: d.getMonth() + 1, d: d.getDate() };
};

export function buildSeed() {
  const { m, d } = todayMD();
  const customer = (u) => ({
    id: u.id,
    email: u.email ?? `${u.id}@client.in`,
    mobile: u.mobile,
    password_hash: null,
    magic_token: u.token,
    role: 'customer',
    name: u.name,
    points: u.points,
    birthday: u.birthday ?? `${m}-${d}`, // default "today" → Birthday chip
    anniversary: u.anniversary ?? null,
    tier: u.tier,
    custom_tags: u.tags ?? [],
    measurements: u.measurements ?? { bust: '—', waist: '—', hips: '—', size: '—', colours: [], fabrics: [] },
    staff_notes: u.notes ?? [],
    chat: u.chat ?? [],
  });

  const users = [
    {
      id: 'owner',
      email: 'owner@boutique.in',
      mobile: '9836000000',
      password_hash: 'owner123',
      magic_token: null,
      role: 'merchant',
      name: 'Akanksha — Boutique Owner',
      points: 0,
      birthday: null,
      anniversary: null,
      tier: null,
      custom_tags: [],
      measurements: {},
      staff_notes: [],
      chat: [],
    },
    customer({
      id: 'sarah-j', name: 'Sarah Jenkins', token: 'sarah123', mobile: '98200 11223', points: 850, tier: 'gold',
      birthday: `${m}-${d}`, tags: ['Custom Tailoring'],
      measurements: { bust: '36″', waist: '28″', hips: '38″', size: 'M · 8', colours: ['Ivory', 'Pastels', 'Champagne'], fabrics: ['Silk', 'Chiffon'] },
      notes: [
        { id: 'n1', text: 'Prefers ivory & blush. Loves a structured blouse with her sarees.', ts: daysAgo(48), by: 'Akanksha' },
        { id: 'n2', text: 'Anniversary gift — monogram silk. Budget band ₹25–30k.', ts: daysAgo(12), by: 'Akanksha' },
      ],
      chat: [
        { id: 'c1', from: '85 Lansdowne', text: 'Namaste Sarah! Your Alice Dress is ready for a final fitting this Friday at 11am. ✨', ts: daysAgo(2) },
      ],
    }),
    customer({
      id: 'meera-k', name: 'Meera Kapoor', token: 'meera123', mobile: '98300 44556', points: 2100, tier: 'platinum', birthday: '05-17',
      anniversary: `${m}-${d}`, tags: ['Saree Enthusiasts', 'VIP Walk-ins'],
      measurements: { bust: '34″', waist: '26″', hips: '36″', size: 'S · 6', colours: ['Emerald', 'Deep Maroon'], fabrics: ['Kanjivaram', 'Raw Silk'] },
      notes: [{ id: 'n3', text: 'VIP. Curates a personal Kanjivaram edit every festive season.', ts: daysAgo(90), by: 'Akanksha' }],
    }),
    customer({
      id: 'ananya-i', name: 'Ananya Iyer', token: 'ananya123', mobile: '99033 77889', points: 940, tier: 'gold', birthday: '11-02',
      tags: ['Custom Tailoring'],
      measurements: { bust: '38″', waist: '30″', hips: '40″', size: 'L · 12', colours: ['Blues', 'Teal'], fabrics: ['Crepe', 'Georgette'] },
      notes: [],
    }),
    customer({
      id: 'riya-m', name: 'Riya Mehta', token: 'riya123', mobile: '98300 66778', points: 320, tier: 'silver', birthday: '09-21',
      tags: [],
      measurements: { bust: '32″', waist: '24″', hips: '34″', size: 'XS · 4', colours: ['Black', 'White'], fabrics: ['Cotton', 'Linen'] },
      notes: [],
    }),
    customer({
      id: 'neha-s', name: 'Neha Sharma', token: 'neha123', mobile: '98310 22334', points: 410, tier: 'silver', birthday: '03-08',
      tags: ['Saree Enthusiasts'],
      measurements: { bust: '35″', waist: '27″', hips: '37″', size: 'M · 8', colours: ['Reds', 'Golds'], fabrics: ['Silk', 'Net'] },
      notes: [],
    }),
    customer({
      id: 'priya-b', name: 'Priya Banerjee', token: 'priya123', mobile: '98740 55667', points: 1750, tier: 'platinum', birthday: '01-30',
      tags: ['VIP Walk-ins'],
      measurements: { bust: '34″', waist: '26″', hips: '36″', size: 'S · 6', colours: ['Lavender', 'Champagne'], fabrics: ['Satin', 'Tulle'] },
      notes: [{ id: 'n4', text: 'Loves Tara & I collection — attends every preview night.', ts: daysAgo(20), by: 'Akanksha' }],
    }),
    customer({
      id: 'divya-r', name: 'Divya Rao', token: 'divya123', mobile: '90077 88990', points: 680, tier: 'gold', birthday: '07-12',
      tags: [],
      measurements: { bust: '37″', waist: '29″', hips: '39″', size: 'L · 12', colours: ['Blush', 'Navy'], fabrics: ['Velvet', 'Silk'] },
      notes: [],
    }),
  ];

  const items = CATALOGUE.slice(0, 8); // seed a few catalogue items for the boutique's own lookbook feed

  const orders = [
    { id: 'o1', userId: 'sarah-j', subtotal: 13000, pointsApplied: 500, discountValue: 500, paymentMethod: 'online', finalTotal: 12500, pointsEarned: 650, items: [{ catalogueItemId: '5', title: 'KOAKH · Alice Dress', price: 13000 }], createdAt: daysAgo(6) },
    { id: 'o2', userId: 'sarah-j', subtotal: 5900, pointsApplied: 0, discountValue: 0, paymentMethod: 'offline', finalTotal: 5900, pointsEarned: 295, items: [{ catalogueItemId: '12', title: 'KOAKH · Valerie — Pink & Red', price: 5900 }], createdAt: daysAgo(1) },
    { id: 'o3', userId: 'meera-k', subtotal: 18000, pointsApplied: 1000, discountValue: 1000, paymentMethod: 'online', finalTotal: 17000, pointsEarned: 900, items: [{ catalogueItemId: '26', title: 'Tara & I · Pleated Lamé Jumpsuit', price: 18000 }], createdAt: daysAgo(3) },
    { id: 'o4', userId: 'riya-m', subtotal: 5600, pointsApplied: 0, discountValue: 0, paymentMethod: 'offline', finalTotal: 5600, pointsEarned: 280, items: [{ catalogueItemId: '23', title: 'KOAKH · Candy Blouse', price: 5600 }], createdAt: daysAgo(2) },
  ];

  const ledger = [
    { id: 'l1', userId: 'sarah-j', action: 'earned', points: 650, reason: 'Purchase · Alice Dress (5% rule)', createdAt: daysAgo(6) },
    { id: 'l2', userId: 'sarah-j', action: 'redeemed', points: 500, reason: 'Checkout · points discount', createdAt: daysAgo(6) },
    { id: 'l3', userId: 'sarah-j', action: 'earned', points: 500, reason: 'Google Review bonus', createdAt: daysAgo(4) },
    { id: 'l4', userId: 'sarah-j', action: 'earned', points: 200, reason: 'Birthday bonus', createdAt: daysAgo(10) },
    { id: 'l5', userId: 'sarah-j', action: 'earned', points: 295, reason: 'Purchase · Valerie Pink & Red (5% rule)', createdAt: daysAgo(1) },
    { id: 'l6', userId: 'meera-k', action: 'earned', points: 900, reason: 'Purchase · Pleated Lamé Jumpsuit (5% rule)', createdAt: daysAgo(3) },
    { id: 'l7', userId: 'meera-k', action: 'redeemed', points: 1000, reason: 'Checkout · points discount', createdAt: daysAgo(3) },
    { id: 'l8', userId: 'riya-m', action: 'earned', points: 280, reason: 'Purchase · Candy Blouse (5% rule)', createdAt: daysAgo(2) },
    { id: 'l9', userId: 'sarah-j', action: 'earned', points: 150, reason: 'Product review · Valerie Pink & Red', createdAt: daysAgo(0) },
  ];

  const reviews = [
    { id: 'r1', userId: 'sarah-j', catalogueItemId: null, platform: 'gmb', stars: 5, review_text: 'Beautiful boutique — Akanksha styled me personally for my anniversary. The Alice dress is a dream.', status: 'pending', createdAt: daysAgo(1) },
    { id: 'r2', userId: 'meera-k', catalogueItemId: null, platform: 'gmb', stars: 5, review_text: 'Exceptional Kanjivaram curation. Truly one of a kind.', status: 'pending', createdAt: daysAgo(0) },
    { id: 'r3', userId: 'ananya-i', catalogueItemId: null, platform: 'gmb', stars: 4, review_text: 'Lovely tailoring, excellent finishing.', status: 'pending', createdAt: daysAgo(0) },
    { id: 'r4', userId: 'priya-b', catalogueItemId: null, platform: 'gmb', stars: 5, review_text: 'The preview night was gorgeous. My new favourite address.', status: 'approved', createdAt: daysAgo(5) },
    { id: 'r5', userId: 'sarah-j', catalogueItemId: '12', platform: 'in-app', stars: 5, review_text: 'Gorgeous colours, perfect fit for a wedding shaadi!', status: 'approved', createdAt: daysAgo(0) },
  ];

  const events = [
    { id: 'e1', userId: 'sarah-j', type: 'purchase', text: 'Sarah Jenkins placed an order · Valerie Pink & Red ₹5,900', ts: daysAgo(1) },
    { id: 'e2', userId: 'sarah-j', type: 'review', text: 'Sarah Jenkins posted a Google review (5★) — awaiting approval', ts: daysAgo(1) },
    { id: 'e3', userId: 'sarah-j', type: 'points', text: 'Sarah Jenkins earned 500 pts · Google Review bonus', ts: daysAgo(4) },
    { id: 'e4', userId: 'meera-k', type: 'purchase', text: 'Meera Kapoor placed an order · Pleated Lamé Jumpsuit ₹18,000', ts: daysAgo(3) },
    { id: 'e5', userId: 'riya-m', type: 'purchase', text: 'Riya Mehta placed an order · Candy Blouse ₹5,600', ts: daysAgo(2) },
    { id: 'e6', userId: 'sarah-j', type: 'like', text: 'Sarah Jenkins liked the Alice Dress ♥', ts: daysAgo(0) },
  ];

  return {
    meta: { seededAt: ISO(new Date()), version: 2 },
    users,
    catalogueItems: items,
    orders,
    pointsLedger: ledger,
    reviews,
    events,
    campaigns: [
      { id: 'cp1', title: 'Festive Saree Edit', creative_url: 'https://cdn.shopify.com/s/files/1/0583/9326/4293/files/s1.jpg?v=1721195709', message_body: 'Namaste {client_name}, our new festive saree edit has arrived at 85 Lansdowne. We kept a few pieces aside for you. ✨', audience_segment: { tiers: ['gold', 'platinum'] }, sent_count: 3, clicks_count: 1, sentAt: daysAgo(2) },
    ],
    tickets: [
      { id: 't1', ownerId: 'owner', category: 'Feature', priority: 'Low', message: 'Could we add a Festive Campaign template?', status: 'resolved', createdAt: daysAgo(8) },
    ],
    settings: {
      tiers: {
        global: { purchasePercent: 5, birthdayBonus: 200, gmbPoints: 500, productReviewPoints: 150 },
        silver: { purchasePercent: 4, birthdayBonus: 150, gmbPoints: 400, productReviewPoints: 100, on: true },
        gold: { purchasePercent: 5, birthdayBonus: 200, gmbPoints: 500, productReviewPoints: 150, on: true },
        platinum: { purchasePercent: 7, birthdayBonus: 350, gmbPoints: 750, productReviewPoints: 250, on: true },
      },
    },
  };
}
