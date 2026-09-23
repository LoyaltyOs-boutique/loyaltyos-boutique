// Pure CSV parsing + preview-building helpers for the Bulk Onboarding card
// (Onboarding.jsx). No React, no db.js, no browser-only APIs — every
// function here takes plain strings/arrays and returns plain data so it can
// be unit tested in plain Node (see /tmp/csv-tests/run.mjs) without a DOM.
//
// Design: docs/superpowers/specs/2026-09-23-csv-bulk-onboarding-design.md

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/* ---------- RFC 4180-ish CSV parser ---------- */

export function parseCsv(text) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // strip UTF-8 BOM

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = s.length;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  while (i < n) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { pushField(); i += 1; continue; }
    if (c === '\r') {
      if (s[i + 1] === '\n') i += 1;
      pushRow(); i += 1; continue;
    }
    if (c === '\n') { pushRow(); i += 1; continue; }
    field += c; i += 1;
  }
  // Trailing field/row (file may or may not end with a newline).
  if (field !== '' || row.length) pushRow();

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/* ---------- Mobile normalization ---------- */

export function normalizeMobile(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(-10);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(-10);
  return digits;
}

/* ---------- Date parsing → "M-D" (no zero padding) ---------- */

function isValidCalendarDate(day, month) {
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // Feb: leap allowed generically
  return day <= daysInMonth[month - 1];
}

export function parseDateToMD(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return { md: '', ok: true };

  // DD-MM-YYYY / DD/MM/YYYY / DD.MM.YYYY
  let m = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (isValidCalendarDate(day, month)) return { md: `${month}-${day}`, ok: true };
    return { md: '', ok: false };
  }

  // YYYY-MM-DD
  m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (isValidCalendarDate(day, month)) return { md: `${month}-${day}`, ok: true };
    return { md: '', ok: false };
  }

  // "D Mon" / "D Month" / "D Mon YYYY" / "D Month YYYY" (year optional)
  m = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/);
  if (m) {
    const day = Number(m[1]);
    const monthWord = m[2].toLowerCase();
    // Accept a real month name, or an unambiguous 3+ letter prefix of one.
    if (monthWord.length >= 3) {
      const monthIndex = MONTHS.findIndex((name) => name === monthWord || name.startsWith(monthWord));
      if (monthIndex !== -1) {
        const month = monthIndex + 1;
        if (isValidCalendarDate(day, month)) return { md: `${month}-${day}`, ok: true };
      }
    }
    return { md: '', ok: false };
  }

  return { md: '', ok: false };
}

/* ---------- Yes/No parsing ---------- */

export function parseYesNo(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'yes' || v === 'y' || v === 'true' || v === '1') return { value: true, ok: true };
  if (v === '' || v === 'no' || v === 'n' || v === 'false' || v === '0') return { value: false, ok: true };
  return { value: false, ok: false };
}

/* ---------- Text cleanup ---------- */

// Collapse a quoted multi-line/tabbed CSV cell into one clean line — spaces,
// tabs, CR, LF all become a single space, then trim. Applied to every cell in
// mapRows() before any other parsing sees the value (2026-09-23 amendment).
export function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/* ---------- Header detection + column mapping ---------- */

const HEADER_ALIASES = {
  name: ['name'],
  whatsapp: ['whatsapp', 'mobile', 'phone'],
  birthday: ['birthday'],
  anniversary: ['anniversary'],
  city: ['city'],
  country: ['country'],
  whatsapp_consent: ['consent'],
  vvip: ['vvip'],
};

function detectHeaderRow(firstRow) {
  if (!Array.isArray(firstRow)) return false;
  const cells = firstRow.map((c) => String(c ?? '').trim().toLowerCase());
  const hasName = cells.some((c) => c === 'name');
  const hasWa = cells.some((c) => HEADER_ALIASES.whatsapp.includes(c));
  return hasName && hasWa;
}

export function mapRows(table) {
  if (!Array.isArray(table) || table.length === 0) return [];

  const hasHeader = detectHeaderRow(table[0]);
  const dataRows = hasHeader ? table.slice(1) : table;

  let colIndex = null;
  if (hasHeader) {
    const cells = table[0].map((c) => String(c ?? '').trim().toLowerCase());
    colIndex = {};
    for (const key of Object.keys(HEADER_ALIASES)) {
      const idx = cells.findIndex((c) => HEADER_ALIASES[key].includes(c));
      colIndex[key] = idx;
    }
  }

  const mapped = dataRows.map((cells) => {
    const get = (key, posIdx) => {
      const idx = hasHeader ? colIndex[key] : posIdx;
      if (idx == null || idx < 0) return '';
      return cleanText(cells[idx]);
    };
    return {
      name: get('name', 0),
      whatsapp: get('whatsapp', 1),
      birthday: get('birthday', 2),
      anniversary: get('anniversary', 3),
      city: get('city', 4),
      country: get('country', 5),
      whatsapp_consent: get('whatsapp_consent', 6),
      vvip: get('vvip', 7),
    };
  });

  return mapped.filter((r) => r.name || r.whatsapp);
}

/* ---------- Valid mobile extraction ---------- */

// Given mapRows()'s output, return the unique 10-digit normalized mobiles,
// in the sequence they first appear — the set to send to checkMobilesStatus.
export function validMobiles(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const m = normalizeMobile(row.whatsapp);
    if (m.length === 10 && !seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

/* ---------- Preview building ---------- */

// mobileStatus = { active: Set, deleted: Set } — real-time authoritative
// mobile status from checkMobilesStatus (2026-09-23 amendment), replacing
// the old existingMobiles-from-local-cache signature.
export function buildPreview(table, mobileStatus) {
  const active = mobileStatus?.active instanceof Set ? mobileStatus.active : new Set(mobileStatus?.active || []);
  const deleted = mobileStatus?.deleted instanceof Set ? mobileStatus.deleted : new Set(mobileStatus?.deleted || []);
  const rows = mapRows(table);
  const seenInFile = new Set();

  return rows.map((row, i) => {
    const warnings = [];
    const name = row.name;
    const whatsapp = normalizeMobile(row.whatsapp);

    const bDate = parseDateToMD(row.birthday);
    if (row.birthday && !bDate.ok) warnings.push('Birthday not understood');
    const aDate = parseDateToMD(row.anniversary);
    if (row.anniversary && !aDate.ok) warnings.push('Anniversary not understood');

    const consent = parseYesNo(row.whatsapp_consent);
    if (!consent.ok) warnings.push('Consent value not understood, treated as No');
    const vvip = parseYesNo(row.vvip);
    if (!vvip.ok) warnings.push('VVIP value not understood, treated as No');

    // Precedence: invalid, THEN duplicate_in_file, THEN existing (active),
    // THEN reactivate (deleted), otherwise new. duplicate_in_file always wins
    // over the active/deleted lookup — only the first occurrence is actionable.
    let status;
    if (!name) {
      status = 'invalid';
      warnings.push('Missing name');
    } else if (whatsapp.length !== 10) {
      status = 'invalid';
      warnings.push('Invalid mobile');
    } else if (seenInFile.has(whatsapp)) {
      status = 'duplicate_in_file';
    } else if (active.has(whatsapp)) {
      status = 'existing';
    } else if (deleted.has(whatsapp)) {
      status = 'reactivate';
    } else {
      status = 'new';
    }
    if (status !== 'invalid') seenInFile.add(whatsapp);

    return {
      rowNumber: i + 1,
      name,
      whatsapp,
      birthday: bDate.md,
      anniversary: aDate.md,
      city: row.city,
      country: row.country || 'India',
      whatsapp_consent: consent.value,
      vvip: vvip.value,
      status,
      warnings,
    };
  });
}

/* ---------- Chunking ---------- */

export function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

/* ---------- Sample CSV ---------- */

export const SAMPLE_CSV = [
  'Name,WhatsApp,Birthday,Anniversary,City,Country,Consent,VVIP',
  'Priya Sharma,9876543210,04-05-1995,12-12-2020,Kolkata,India,Yes,No',
  '"Rao, Anjali",+91 98300 12345,21/11/1988,,Kolkata,India,No,Yes',
].join('\n');
