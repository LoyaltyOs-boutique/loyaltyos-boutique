// Dynamic shell — permanent CDN-staleness fix for customer-facing routes.
// Spec: docs/superpowers/specs/2026-09-19-lookbook-staleness-permanent-fix-design.md
//
// WHY THIS FILE EXISTS (read before touching):
// Vercel's CDN cannot be told to stop caching a STATIC file by any header
// tweak — confirmed live: even with Vercel-CDN-Cache-Control: no-store set
// on the static HTML route in vercel.json, the CDN kept returning
// `x-vercel-cache: HIT` with a climbing `Age` for 15+ minutes. Vercel's own
// docs: "Vercel doesn't allow bypassing the cache for static files by
// design." Headers on static files are simply not consulted by the
// static-file cache layer.
//
// The fix: serve certain customer-facing routes through an actual Vercel
// Function instead of the static index.html. A Function's OWN
// Cache-Control response header IS honored (unlike a static file's), so a
// real Node.js Function here can force no-store and guarantee every
// customer request gets the live index.html shell (which then loads the
// hashed JS/CSS bundles and fetches live Convex data client-side, same as
// before — this file changes ONLY how the HTML shell is served, nothing
// about the React app itself).
//
// Scope: rewired in vercel.json's rewrites (BEFORE the catch-all) for
// customer-facing dynamic routes only — /lookbook, /join,
// /lookbook/public/:id, /lookbook/piece/:id. Merchant routes (/login,
// /merchant/*) are explicitly OUT of scope — see the design doc — and keep
// the existing static-file + catch-all rewrite behavior untouched.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Declared in vercel.json via functions["api/dynamic-shell.js"].includeFiles
// so the built dist/index.html ships inside this Function's own deployment
// bundle. process.cwd() resolves to the Function's bundle root at runtime;
// includeFiles preserves the declared path relative to the project root —
// so the file lands at <bundle-root>/dist/index.html, matching the source
// project layout (Vercel KB: "How can I use files in Vercel Functions?").
const INDEX_HTML_PATH = path.join(process.cwd(), 'dist', 'index.html');

// Read once per warm instance, not once per request — the file is static
// build output (content-hashed asset filenames baked in at build time), so
// there is nothing to gain from re-reading it on every invocation. A cold
// instance simply re-reads on its first request.
let cachedHtml = null;

export default async function handler(req, res) {
  try {
    if (cachedHtml === null) {
      cachedHtml = await readFile(INDEX_HTML_PATH, 'utf-8');
    }

    // The load-bearing line: Cache-Control set BY THIS FUNCTION's own
    // response. Function-set headers are honored by Vercel's CDN (unlike
    // static-file headers), so this is what actually stops the CDN from
    // ever serving a stale copy of the HTML shell to a real customer.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(cachedHtml);
  } catch (err) {
    // Fail loudly rather than silently — a broken shell read should never
    // masquerade as a normal page. 500 here is visible in Vercel logs and
    // in the browser, unlike the old static-caching failure mode which was
    // invisible (stale data, zero error).
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).send('Could not load the application shell. Please try again.');
  }
}
