import { ImageResponse } from '@vercel/og';
import { readFile } from 'fs/promises';
import path from 'path';

/**
 * Templates Phase 2 — Branded Anniversary/Birthday card image generation.
 * Design spec: docs/superpowers/specs/2026-08-22-templates-card-image-generation-design.md
 *
 * Vercel Function (NOT a Convex action — @vercel/og's ImageResponse is
 * built for the Vercel Functions Node.js runtime; default runtime, no
 * export const config needed here, unlike middleware.js's edge-default
 * file convention). Not reachable via `npm run dev` (Vite has no /api
 * server) — only testable on a real Vercel preview/prod deploy.
 *
 * This function only renders the card image from whatever `message` text
 * is passed in — it has no opinion on where that text came from (Phase 1's
 * hardcoded-default-or-merchant-edited logic lives entirely in
 * Templates.jsx, not here).
 */

const COPY = {
  anniversary: {
    heading: 'HAPPY ANNIVERSARY',
    subline: 'Celebrate your love. May this special day be as wonderful as you are.',
    closing: 'With love from, 85 Lansdowne',
    wreathColor: '#5B6E4F', // dark green, per the Anniversary reference
  },
  birthday: {
    heading: 'HAPPIEST BIRTHDAY',
    subline: 'Warm wishes for a wonderful year ahead.',
    closing: 'Warmest Regards, 85 Lansdowne',
    wreathColor: '#7C8B5E', // eucalyptus-style, slightly lighter, per the Birthday reference
  },
};

const GOLD = '#C5A880';
const INK = '#111111';
const CREAM = '#FBF8F2';

async function loadFonts() {
  const dir = path.join(process.cwd(), 'api', 'fonts');
  const [pfRegular, pfBold, pfItalic, msRegular, msSemiBold, msItalic] = await Promise.all([
    readFile(path.join(dir, 'PlayfairDisplay-Regular.woff')),
    readFile(path.join(dir, 'PlayfairDisplay-Bold.woff')),
    readFile(path.join(dir, 'PlayfairDisplay-Italic.woff')),
    readFile(path.join(dir, 'Montserrat-Regular.woff')),
    readFile(path.join(dir, 'Montserrat-SemiBold.woff')),
    readFile(path.join(dir, 'Montserrat-Italic.woff')),
  ]);
  return [
    { name: 'Playfair Display', data: pfRegular, weight: 400, style: 'normal' },
    { name: 'Playfair Display', data: pfBold, weight: 700, style: 'normal' },
    { name: 'Playfair Display', data: pfItalic, weight: 400, style: 'italic' },
    { name: 'Montserrat', data: msRegular, weight: 400, style: 'normal' },
    { name: 'Montserrat', data: msSemiBold, weight: 600, style: 'normal' },
    { name: 'Montserrat', data: msItalic, weight: 400, style: 'italic' },
  ];
}

// Simple corner-wreath approximation (leaf-like curved marks fanning from
// the corner) — structure/placement over pixel-perfect art per the task.
function CornerWreath({ color, corner }) {
  const flip = corner === 'top-right' || corner === 'bottom-right';
  const flipV = corner === 'bottom-left' || corner === 'bottom-right';
  return (
    <div
      style={{
        display: 'flex',
        position: 'absolute',
        [corner.includes('top') ? 'top' : 'bottom']: 24,
        [corner.includes('left') ? 'left' : 'right']: 24,
        transform: `scaleX(${flip ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
      }}
    >
      <svg width="90" height="90" viewBox="0 0 90 90">
        <path d="M6 6 Q40 6 40 40 Q40 20 60 14 Q46 30 60 45" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M6 6 Q6 40 40 40 Q20 40 14 60 Q30 46 45 60" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" />
        <circle cx="6" cy="6" r="4" fill={GOLD} />
      </svg>
    </div>
  );
}

export default async function handler(request) {
  const { searchParams } = new URL(request.url);
  const rawType = searchParams.get('type');
  const type = rawType === 'birthday' ? 'birthday' : 'anniversary'; // default anniversary if missing/unrecognized
  const message = searchParams.get('message') || '';
  const copy = COPY[type];

  const fonts = await loadFonts();

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: CREAM,
          position: 'relative',
          border: `2px solid ${GOLD}`,
          fontFamily: 'Montserrat',
        }}
      >
        {/* Inner gold frame line */}
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            right: 16,
            bottom: 16,
            border: `1px solid ${GOLD}`,
            display: 'flex',
          }}
        />

        <CornerWreath color={copy.wreathColor} corner="top-left" />
        <CornerWreath color={copy.wreathColor} corner="top-right" />
        <CornerWreath color={copy.wreathColor} corner="bottom-left" />
        <CornerWreath color={copy.wreathColor} corner="bottom-right" />

        {/* Heading */}
        <div
          style={{
            fontFamily: 'Playfair Display',
            fontWeight: 700,
            fontSize: 52,
            color: INK,
            letterSpacing: 4,
            display: 'flex',
          }}
        >
          {copy.heading}
        </div>

        {/* Ornamental divider */}
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 20, marginBottom: 20 }}>
          <div style={{ width: 80, height: 1, background: GOLD, display: 'flex' }} />
          <div style={{ width: 8, height: 8, background: GOLD, borderRadius: 4, margin: '0 12px', display: 'flex' }} />
          <div style={{ width: 80, height: 1, background: GOLD, display: 'flex' }} />
        </div>

        {/* Merchant message */}
        <div
          style={{
            fontFamily: 'Montserrat',
            fontWeight: 400,
            fontSize: 26,
            color: INK,
            textAlign: 'center',
            maxWidth: 760,
            display: 'flex',
            padding: '0 40px',
          }}
        >
          {message}
        </div>

        {/* Gold italic sub-line */}
        <div
          style={{
            fontFamily: 'Playfair Display',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 20,
            color: GOLD,
            marginTop: 24,
            textAlign: 'center',
            maxWidth: 640,
            display: 'flex',
          }}
        >
          {copy.subline}
        </div>

        {/* "85" wreath emblem */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 84,
            height: 84,
            borderRadius: 42,
            border: `1.5px solid ${GOLD}`,
            marginTop: 28,
            fontFamily: 'Playfair Display',
            fontWeight: 700,
            fontSize: 28,
            color: INK,
          }}
        >
          85
        </div>

        {/* Closing line */}
        <div
          style={{
            fontFamily: 'Montserrat',
            fontWeight: 600,
            fontSize: 16,
            letterSpacing: 2,
            color: INK,
            marginTop: 20,
            textTransform: 'uppercase',
            display: 'flex',
          }}
        >
          {copy.closing}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts,
    },
  );
}
