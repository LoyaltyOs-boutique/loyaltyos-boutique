// Pure gallery-list helpers for the merchant media editor.
// Design spec: docs/superpowers/specs/2026-09-25-product-gallery-design.md
// Mirrors convex/lookbooks.ts's validateMedia rule-for-rule (Backend section)
// so the merchant never gets an error only the backend would catch. No React,
// no db.js, no browser APIs — safe to unit test standalone.

export const MAX_ITEMS = 8;
export const MAX_VIDEOS = 2;

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.heic'];
const VIDEO_EXT = ['.mp4', '.mov', '.webm', '.avi', '.mkv'];

/** Classifies a File-like object ({ type, name }) as 'image' | 'video' | 'pdf' | 'other'. */
export function classifyFile({ type, name } = {}) {
  const t = String(type || '').toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t === 'application/pdf') return 'pdf';
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (IMAGE_EXT.some((ext) => n.endsWith(ext))) return 'image';
  if (VIDEO_EXT.some((ext) => n.endsWith(ext))) return 'video';
  return 'other';
}

/**
 * Validates a gallery list against the same rules as the backend's
 * validateMedia (convex/lookbooks.ts) — 1 to MAX_ITEMS entries, at most
 * MAX_VIDEOS videos, every url non-empty, and the first entry an image.
 * Returns an error string, or null when the list is valid.
 */
export function validateList(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_ITEMS) {
    return `A piece can have between 1 and ${MAX_ITEMS} photos or videos.`;
  }
  if (list.filter((m) => m.type === 'video').length > MAX_VIDEOS) {
    return `A piece can have at most ${MAX_VIDEOS} videos.`;
  }
  if (list.some((m) => !m.url || !String(m.url).trim())) {
    return 'Every photo or video needs a URL.';
  }
  if (list[0].type !== 'image') {
    return 'The first photo (the cover) must be an image, not a video.';
  }
  return null;
}

/**
 * Appends one or more { url, type } entries to a gallery list. On any
 * violation the ORIGINAL list is returned unchanged, alongside an error
 * string — the caller never has to roll back a partial add.
 */
export function addEntries(list, entries) {
  const incoming = Array.isArray(entries) ? entries : [];
  if (incoming.length === 0) return { list, error: null };
  const next = [...list, ...incoming];
  if (next[0] && next[0].type === 'video') {
    return { list, error: 'Add a photo first — the cover must be a photo.' };
  }
  const error = validateList(next);
  if (error) return { list, error };
  return { list: next, error: null };
}

/**
 * Swaps entry `index` one step toward `direction` ('left' | 'right').
 * Refuses (returns the original list + an error) any move that would put a
 * video first, or a move whose target index is out of range.
 */
export function moveEntry(list, index, direction) {
  const j = index + (direction === 'left' ? -1 : 1);
  if (index < 0 || index >= list.length || j < 0 || j >= list.length) {
    return { list, error: null };
  }
  const next = [...list];
  [next[index], next[j]] = [next[j], next[index]];
  if (next[0].type === 'video') {
    return { list, error: 'The cover must be a photo, not a video.' };
  }
  return { list: next, error: null };
}

/**
 * Removes entry `index`. Refuses (returns the original list + an error) a
 * removal that would leave the list empty, or leave a video first (which,
 * since every remaining entry after a video-first list is at best a video,
 * also covers "leave only videos").
 */
export function removeEntry(list, index) {
  if (index < 0 || index >= list.length) return { list, error: null };
  const next = list.filter((_, i) => i !== index);
  if (next.length === 0) {
    return { list, error: 'A piece needs at least one photo.' };
  }
  if (next[0].type === 'video') {
    return { list, error: 'A piece needs a photo as the cover — remove a different one first.' };
  }
  return { list: next, error: null };
}

/**
 * Builds the starting gallery list for the editor from a catalogue piece:
 * its real media array when present, otherwise a one-entry list from
 * image_url (legacy single-photo pieces), otherwise empty.
 */
export function fromPiece(piece) {
  if (!piece) return [];
  if (Array.isArray(piece.media) && piece.media.length > 0) return piece.media;
  if (piece.image_url) return [{ url: piece.image_url, type: 'image' }];
  return [];
}
