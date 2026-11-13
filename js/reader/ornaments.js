// Small, quiet details: chapter ornaments and the occasional surprise in a page margin.
// Everything here can be switched off under Einstellungen → Verzierungen.

import { hash32 } from '../util.js';

const F = [
  '<path d="M8 12h40M72 12h40"/><path d="M60 5l7 7-7 7-7-7z"/>',
  '<path d="M10 12h36M74 12h36"/><circle cx="51" cy="12" r="1.5" fill="currentColor"/><circle cx="60" cy="12" r="2.4" fill="currentColor"/><circle cx="69" cy="12" r="1.5" fill="currentColor"/>',
  '<path d="M14 12h30c5 0 7-5 11-5 3 0 5 2 5 5M106 12H76c-5 0-7 5-11 5-3 0-5-2-5-5"/>',
  '<path d="M16 12h88"/><path d="M60 12c-4-7-10-8-15-6 4 1 9 3 15 6zM60 12c4 7 10 8 15 6-4-1-9-3-15-6z" fill="currentColor" fill-opacity=".35"/>',
  '<path d="M60 4l1.2 2.8 2.8 1.2-2.8 1.2L60 12l-1.2-2.8L56 8l2.8-1.2zM51 13l1.2 2.8 2.8 1.2-2.8 1.2L51 21l-1.2-2.8L47 17l2.8-1.2zM69 13l1.2 2.8 2.8 1.2-2.8 1.2L69 21l-1.2-2.8L65 17l2.8-1.2z" fill="currentColor" stroke="none"/>',
  '<path d="M14 10h36M14 14h36M70 10h36M70 14h36"/><circle cx="60" cy="12" r="4"/>',
  '<path d="M12 12c8-6 16 6 24 0s16 6 24 0 16 6 24 0 16 6 24 0"/>',
  '<path d="M60 3c-3 4-3 8 0 12 3-4 3-8 0-12z" fill="currentColor" fill-opacity=".35"/><path d="M60 15c-5-1-9 0-12 3 5 1 9 0 12-3zM60 15c5-1 9 0 12 3-5 1-9 0-12-3z"/><path d="M20 12h22M78 12h22"/>',
];

/** One of eight ornaments, always the same for the same chapter. */
export function chapterOrnament(docId, chapter) {
  const i = hash32(`${docId}:${chapter}`) % F.length;
  const el = document.createElement('div');
  el.className = 'rd-orn';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<svg viewBox="0 0 120 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${F[i]}</svg>`;
  return el;
}

const DECOR = {
  tea: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="37" fill="none" stroke="rgba(122,78,34,.2)" stroke-width="4.5" stroke-dasharray="170 10 46 6"/><circle cx="50" cy="50" r="33.5" fill="none" stroke="rgba(122,78,34,.09)" stroke-width="2"/><path d="M20 62c4 6 9 9 15 11" stroke="rgba(122,78,34,.12)" stroke-width="3" fill="none"/></svg>',
  leaf: '<svg viewBox="0 0 80 120"><path d="M40 112C14 86 10 46 40 8c30 38 26 78 0 104z" fill="rgba(128,108,52,.2)" stroke="rgba(110,88,40,.32)" stroke-width="1.2"/><path d="M40 118V16M40 40l-12-10M40 40l12-10M40 60l-15-12M40 60l15-12M40 80l-13-10M40 80l13-10" stroke="rgba(110,88,40,.3)" stroke-width="1" fill="none"/></svg>',
  doodle: '<svg viewBox="0 0 60 60"><path d="M30 30c0-2 2-3 3-2s2 4-1 5-6-1-6-5 4-8 9-7 9 6 8 11-6 10-12 10-12-5-12-12 6-14 14-15" fill="none" stroke="rgba(70,70,80,.32)" stroke-width="1.1" stroke-linecap="round"/></svg>',
  star: '<svg viewBox="0 0 60 60"><path d="M30 8l5 16h17l-14 10 5 17-13-10-13 10 5-17L8 24h17z" fill="none" stroke="rgba(70,70,80,.3)" stroke-width="1.1" stroke-linejoin="round"/></svg>',
};

/**
 * Margin surprises for one page: rare, deterministic (the same page always looks the same).
 * Returns [{kind, html, place}].
 */
export function pageDecor(docId, spine, page, skin) {
  const out = [];
  const hs = hash32(`${docId}|${spine}|${page}`);
  const papery = ['cream', 'parchment', 'sepia', 'newsprint', 'sage'].includes(skin);
  if (papery && hs % 43 === 7) out.push({ kind: 'tea', html: DECOR.tea, place: hs % 2 ? 'br' : 'bl' });
  else if (papery && hs % 89 === 13) out.push({ kind: 'leaf', html: DECOR.leaf, place: 'mr' });
  else if (hs % 61 === 5) out.push({ kind: 'doodle', html: hs % 3 ? DECOR.doodle : DECOR.star, place: hs % 2 ? 'tr' : 'bl' });
  return out;
}

export const LAUREL = `<svg class="laurel" viewBox="0 0 160 120" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path class="draw" d="M80 108C46 96 28 70 30 30M80 108c34-12 52-38 50-78"/>
<path class="draw" d="M40 84c-9 1-15-3-18-10 8-1 14 3 18 10zM33 66c-9-1-13-7-14-14 8 1 12 6 14 14zM31 48c-8-3-10-9-10-16 7 3 10 8 10 16zM120 84c9 1 15-3 18-10-8-1-14 3-18 10zM127 66c9-1 13-7 14-14-8 1-12 6-14 14zM129 48c8-3 10-9 10-16-7 3-10 8-10 16z"/>
</svg>`;
