import { next } from '@vercel/functions';
import { ConvexHttpClient } from 'convex/browser';
import { api } from './convex/_generated/api.js';

// Gate 2 — WhatsApp/social link-preview cards (OG tags).
// Spec: docs/superpowers/specs/2026-08-22-og-preview-middleware-design.md
//
// This is a client-side-rendered Vite SPA, so social crawlers (which read
// only the initial static HTML and never execute JS) can never see dynamic
// per-lookbook/per-piece OG tags via any React-based approach. This
// middleware intercepts ONLY /lookbook/public/:id and /lookbook/piece/:pieceId
// (see `matcher` below — every other path never invokes this file at all)
// and, ONLY for a known crawler User-Agent, serves a small static HTML
// response with real OG tags. Every other request — including non-crawler
// traffic on these same two paths — must fall through to the normal SPA
// completely unchanged.
export const config = {
  runtime: 'nodejs',
  matcher: ['/lookbook/public/:id', '/lookbook/piece/:pieceId'],
};

const CRAWLER_UA_PATTERN = /whatsapp|facebookexternalhit|twitterbot|linkedinbot|slackbot|telegrambot/i;

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

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
