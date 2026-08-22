import { next } from '@vercel/functions';
import { ConvexHttpClient } from 'convex/browser';
import { api } from './convex/_generated/api.js';

// Gate 2 — WhatsApp/social link-preview cards (OG tags).
// Spec: docs/superpowers/specs/2026-08-22-og-preview-middleware-design.md
// Templates card-image extension spec:
// docs/superpowers/specs/2026-08-22-templates-og-middleware-extension-design.md
//
// This is a client-side-rendered Vite SPA, so social crawlers (which read
// only the initial static HTML and never execute JS) can never see dynamic
// per-lookbook/per-piece OG tags via any React-based approach. This
// middleware intercepts ONLY /lookbook/public/:id, /lookbook/piece/:pieceId,
// /templates/card/anniversary, and /templates/card/birthday (see `matcher`
// below — every other path never invokes this file at all) and, ONLY for a
// known crawler User-Agent, serves a small static HTML response with real
// OG tags. Every other (non-crawler) request on the /lookbook/* paths falls
// through to the normal SPA completely unchanged. The two /templates/card/*
// paths have no SPA route, so non-crawler requests there redirect straight
// to the real image instead (see the TEMPLATE_CARDS branch below).
export const config = {
  runtime: 'nodejs',
  matcher: [
    '/lookbook/public/:id',
    '/lookbook/piece/:pieceId',
    '/templates/card/anniversary',
    '/templates/card/birthday',
  ],
};

const CRAWLER_UA_PATTERN = /whatsapp|facebookexternalhit|twitterbot|linkedinbot|slackbot|telegrambot/i;

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

// Templates card-image paths — Gate 2 extension, Phase 3 (merchant-
// replaceable cards). Titles are fixed per type (not merchant-editable,
// per the design spec — only the image URL is). The Blob URL itself is
// now read live from Convex (settings.getTemplateCardUrls) at request
// time, so a merchant's card replacement takes effect immediately with
// no redeploy — mirrors the /lookbook/* branches' ConvexHttpClient
// pattern below.
const TEMPLATE_CARD_TYPE_BY_PATH = {
  '/templates/card/anniversary': 'anniversary',
  '/templates/card/birthday': 'birthday',
};

const TEMPLATE_CARD_TITLES = {
  anniversary: 'Happy Anniversary',
  birthday: 'Happiest Birthday',
};

// Fallback only — used if the live Convex query fails/times out/throws.
// Duplicated from convex/settings.ts's DEFAULT_TEMPLATE_CARDS (not
// imported — middleware.js runs in a separate deployment context) so
// this branch always has a real image to serve, never a broken link.
const TEMPLATE_CARD_FALLBACKS = {
  anniversary: 'https://kya9cip96sntdsv4.public.blob.vercel-storage.com/anniversary-card-v3-j8Wx0uuIVRtNeJ4HPnEgYzfBdoUWdi.png',
  birthday: 'https://kya9cip96sntdsv4.public.blob.vercel-storage.com/birthday-card-v3-ceGMUhD5Iwq0AP0f99yotycwhEBCJv.png',
};

function ogHtml({ title, description, image, url }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(url);
  const imageTag = image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : '';
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${t}</title>
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:url" content="${u}" />
${imageTag}
<meta http-equiv="refresh" content="0; url=${u}" />
</head>
<body></body>
</html>`;
}

export default async function middleware(request) {
  const ua = request.headers.get('user-agent') || '';

  // Templates card-image paths — handled entirely separately from the
  // /lookbook/* logic below (which is untouched). No SPA route exists for
  // these two paths, so non-crawler requests redirect straight to the real
  // image instead of the generic next() fail-open used for /lookbook/*.
  const cardUrl = new URL(request.url);
  const cardType = TEMPLATE_CARD_TYPE_BY_PATH[cardUrl.pathname];
  if (cardType) {
    try {
      // Start from the hardcoded fallback, then try to replace it with the
      // live setting. A Convex failure here must NOT fall through to
      // next() (unlike /lookbook/*) — there's no SPA route for these paths,
      // so we still need to return a valid response using the fallback.
      let image = TEMPLATE_CARD_FALLBACKS[cardType];
      const convexUrl = process.env.VITE_CONVEX_URL;
      if (convexUrl) {
        try {
          const client = new ConvexHttpClient(convexUrl);
          const urls = await client.query(api.settings.getTemplateCardUrls, {});
          if (urls && urls[cardType]) image = urls[cardType];
        } catch {
          // Live query failed — keep the fallback already assigned above.
        }
      }

      const title = TEMPLATE_CARD_TITLES[cardType];
      if (CRAWLER_UA_PATTERN.test(ua)) {
        const pageUrl = `${cardUrl.origin}${cardUrl.pathname}`;
        const html = ogHtml({ title, description: '85 Lansdowne', image, url: pageUrl });
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      return new Response(null, { status: 302, headers: { location: image } });
    } catch {
      // Never break — even though there's no SPA fallback for these paths,
      // erring toward "doesn't crash" over "doesn't redirect".
      return next();
    }
  }

  if (!CRAWLER_UA_PATTERN.test(ua)) {
    // Real browsers (and unrecognized bots) — untouched pass-through.
    return next();
  }

  try {
    const url = new URL(request.url);
    const convexUrl = process.env.VITE_CONVEX_URL;
    if (!convexUrl) return next(); // fail open — no Convex URL configured

    const client = new ConvexHttpClient(convexUrl);
    const pageUrl = `${url.origin}${url.pathname}`;

    const publicMatch = url.pathname.match(/^\/lookbook\/public\/([^/]+)$/);
    const pieceMatch = url.pathname.match(/^\/lookbook\/piece\/([^/]+)$/);

    if (publicMatch) {
      const lookbook = await client.query(api.lookbooks.getLookbookById, { id: publicMatch[1] });
      if (!lookbook) return next(); // fail open — not found
      const firstImage = Array.isArray(lookbook.items) && lookbook.items.length ? lookbook.items[0].image_url : null;
      const html = ogHtml({
        title: lookbook.title || '85 Lansdowne',
        description: `${lookbook.designer ? lookbook.designer + ' — ' : ''}Curated lookbook from 85 Lansdowne.`,
        image: firstImage,
        url: pageUrl,
      });
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    if (pieceMatch) {
      const item = await client.query(api.lookbooks.getCatalogueItemById, { id: pieceMatch[1] });
      if (!item) return next(); // fail open — not found
      const html = ogHtml({
        title: item.title || '85 Lansdowne',
        description: 'Shop this piece from 85 Lansdowne.',
        image: item.image_url || null,
        url: pageUrl,
      });
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    // Matcher scoped this middleware to only these two path shapes, so this
    // branch shouldn't be reachable — fail open regardless.
    return next();
  } catch {
    // Any Convex/network/parsing failure — never break the real page.
    return next();
  }
}
