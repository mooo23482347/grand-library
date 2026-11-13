// Book covers: the real one where it exists and is legible, otherwise a calm generated cover.

import { h, hash32 } from '../util.js';
import { bindingOf, COVER_COLORS, kindLabel } from '../kinds.js';
import { idx, coverURL } from '../store.js';
import { CHECK_BADGE, EMPTY_BADGE } from '../ui/icons.js';

const legibility = new Map(); // coverId -> Promise<boolean>

/** A cover is "illegible" when it is practically one flat colour (e.g. a blank PDF title page). */
function isLegible(url, id) {
  if (legibility.has(id)) return legibility.get(id);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 24;
        c.height = 36;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 24, 36);
        const d = ctx.getImageData(0, 0, 24, 36).data;
        let sum = 0;
        let sq = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          sum += l;
          sq += l * l;
        }
        const mean = sum / n;
        const sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
        resolve(sd > 7);
      } catch {
        resolve(true);
      }
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
  legibility.set(id, p);
  return p;
}

export function coverColor(doc) {
  if (doc.spineColor && COVER_COLORS.includes(doc.spineColor)) return doc.spineColor;
  return COVER_COLORS[hash32(doc.title || doc.id) % COVER_COLORS.length];
}

function shortAuthor(a) {
  return String(a || '').split(/;|\band\b|&/)[0].trim();
}

/** Generated cover, styled by kind: books in cloth colour, papers as journals, notes as notebooks. */
export function generatedCover(doc) {
  const b = bindingOf(doc.kind);
  const style = b === 'journal' ? 'journal' : b === 'binder' ? 'binder' : b === 'notebook' || b === 'manuscript' ? 'notebook' : 'book';
  const title = doc.title || 'Ohne Titel';
  return h(
    'div',
    { class: `gen-cover gc-${style} ${title.length > 48 ? 'long' : ''}`, style: { '--c': coverColor(doc) }, 'aria-hidden': 'true' },
    style === 'journal' ? h('span', { class: 'gc-band' }, kindLabel(doc.kind)) : null,
    h('span', { class: 'gc-title' }, title),
    h('span', { class: 'gc-rule' }),
    doc.author ? h('span', { class: 'gc-author' }, shortAuthor(doc.author)) : null,
  );
}

/** The cover box. Shows the generated cover at once and swaps in the real one when it is ready. */
export function coverEl(doc, cls = '') {
  const box = h('div', { class: `cover ${cls}` }, generatedCover(doc));
  if (doc.coverId) {
    coverURL(doc.coverId).then(async (u) => {
      if (!u || !(await isLegible(u, doc.coverId))) return;
      // Not lazy: a detached lazy image would never start loading.
      const img = h('img', { alt: '', decoding: 'async', draggable: 'false' });
      img.onload = () => {
        box.style.setProperty('--ar', `${img.naturalWidth} / ${img.naturalHeight}`);
        box.replaceChildren(img);
        box.classList.add('real');
      };
      img.src = u;
    });
  }
  return box;
}

/** A book as it stands on a shelf or in a grid. */
export function bookEl(doc, { scope = '', selecting = false, selected = false, showTitle = false, progress = false } = {}) {
  const prog = idx.progress.get(doc.id);
  const pct = prog?.percent || 0;
  return h(
    'button',
    {
      type: 'button',
      class: `book ${selected ? 'selected' : ''}`,
      'data-id': doc.id,
      'data-scope': scope,
      draggable: 'true',
      title: doc.author ? `${doc.title} – ${doc.author}` : doc.title,
      'aria-label': `${doc.title}${doc.author ? `, ${doc.author}` : ''}`,
      'aria-pressed': selecting ? (selected ? 'true' : 'false') : null,
    },
    h('span', { class: 'book-cover' }, coverEl(doc), selecting ? h('span', { class: 'book-check', html: selected ? CHECK_BADGE : EMPTY_BADGE }) : null),
    progress && pct > 0.005 ? h('span', { class: 'book-progress', style: { '--p': `${Math.round(pct * 100)}%` } }) : null,
    showTitle ? h('span', { class: 'book-title' }, doc.title) : null,
    showTitle && doc.author ? h('span', { class: 'book-author' }, shortAuthor(doc.author)) : null,
  );
}
