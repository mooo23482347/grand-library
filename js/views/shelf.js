// Turns documents into spines on shelves. Each kind of document has its own binding:
//   leather   books               journal   bound journals and papers
//   binder    lecture files       notebook  personal notebooks
//   manuscript loose parchment    cloth     anything else

import { h, hash32, clamp } from '../util.js';
import { KIND, PALETTE, kindLabel } from '../kinds.js';
import { idx, coverURL } from '../store.js';

export function spineSpec(doc) {
  const k = KIND[doc.kind] || KIND.other;
  const b = k.binding;
  const hs = hash32(doc.id);
  const p = Number(doc.pages) || 0;
  let w;
  let ht;
  switch (b) {
    case 'leather':
      w = p ? clamp(16 + p / 15, 18, 54) : 20 + (hs % 22);
      ht = 148 + ((hs >>> 3) % 44);
      break;
    case 'journal':
      w = p ? clamp(10 + p / 9, 12, 32) : 13 + (hs % 10);
      ht = 166 + ((hs >>> 4) % 3) * 4;
      break;
    case 'binder':
      w = 40 + (hs % 8);
      ht = 182;
      break;
    case 'notebook':
      w = p ? clamp(15 + p / 22, 16, 30) : 17 + (hs % 12);
      ht = 128 + ((hs >>> 5) % 28);
      break;
    case 'manuscript':
      w = 16 + (hs % 14);
      ht = 156 + ((hs >>> 2) % 22);
      break;
    default:
      w = 20 + (hs % 16);
      ht = 148 + ((hs >>> 3) % 30);
  }
  const pal = PALETTE[b] || PALETTE.cloth;
  const color = doc.spineColor || pal[(hs >>> 7) % pal.length];
  return { binding: b, w: Math.round(w), h: Math.round(ht), color, variant: (hs >>> 11) % 4 };
}

function shortAuthor(a) {
  const first = String(a || '').split(/[;&]| and /)[0].trim();
  if (!first) return '';
  if (first.includes(',')) return first.split(',')[0].trim();
  const parts = first.split(/\s+/);
  return parts[parts.length - 1];
}

export function spineEl(doc, { scope = '', selected = false, dim = false } = {}) {
  const s = spineSpec(doc);
  const prog = idx.progress.get(doc.id);
  const reading = prog && prog.percent > 0.005 && prog.percent < 0.985;
  const label = `${doc.title}${doc.author ? `, ${doc.author}` : ''} (${kindLabel(doc.kind)})`;
  const title = doc.title || 'Untitled';
  return h(
    'button',
    {
      type: 'button',
      class: `spine b-${s.binding} v${s.variant}${selected ? ' is-selected' : ''}${dim ? ' is-dim' : ''}${title.length > 34 ? ' long' : ''}`,
      style: { '--w': `${s.w}px`, '--hgt': `${s.h}px`, '--c': s.color },
      'data-id': doc.id,
      'data-scope': scope,
      draggable: 'true',
      title: label,
      'aria-label': label,
      'aria-pressed': selected ? 'true' : null,
    },
    h('span', { class: 'sp-cap' }),
    h('span', { class: 'sp-label' }, h('span', { class: 'sp-title' }, title)),
    s.binding !== 'binder' && s.binding !== 'journal' && doc.author ? h('span', { class: 'sp-author' }, h('span', null, shortAuthor(doc.author))) : null,
    s.binding === 'binder' ? h('span', { class: 'sp-ring' }) : null,
    s.binding === 'journal' && doc.year ? h('span', { class: 'sp-year' }, h('span', null, String(doc.year).slice(0, 4))) : null,
    reading ? h('span', { class: 'sp-ribbon', title: `${Math.round(prog.percent * 100)}% read` }) : null,
  );
}

const DECO = ['#3a2416', '#2b1d14', '#4a2a1c', '#1f2a24', '#2a2030', '#3b3022', '#22262c', '#4a3a26', '#5a2a22', '#1d2433'];

function decoSpine(seed) {
  const hs = hash32(String(seed));
  const w = 12 + (hs % 18);
  const ht = 138 + ((hs >>> 4) % 50);
  return h('span', {
    class: `spine deco v${(hs >>> 9) % 4}`,
    style: { '--w': `${w}px`, '--hgt': `${ht}px`, '--c': DECO[(hs >>> 6) % DECO.length] },
    'aria-hidden': 'true',
  });
}

function bookStack(seed) {
  const hs = hash32(`stack${seed}`);
  const n = 2 + (hs % 3);
  return h(
    'span',
    { class: 'book-stack', 'aria-hidden': 'true' },
    Array.from({ length: n }, (_, i) =>
      h('span', { class: 'stack-book', style: { '--c': DECO[(hs >>> (i * 3)) % DECO.length], '--len': `${70 + ((hs >>> (i * 5)) % 40)}px`, '--off': `${((hs >>> (i * 2)) % 14) - 7}px` } }),
    ),
  );
}

function ornamentPiece(seed) {
  const kind = ['globe', 'hourglass', 'candle'][hash32(`orn${seed}`) % 3];
  return h('span', { class: `shelf-ornament orn-${kind}`, 'aria-hidden': 'true' });
}

/** Lays spines on shelves. Rows wrap by themselves, so the bookcase grows with its content. */
export function shelfRows(docs, { scope = '', selection, filterFn, seed = 'shelf', decorate = true, emptyText } = {}) {
  const rows = h('div', { class: 'shelf-rows' });
  const items = [];
  const n = docs.length;
  docs.forEach((d, i) => {
    const key = `${d.id}::${scope}`;
    items.push(spineEl(d, { scope, selected: selection?.has(key), dim: filterFn ? !filterFn(d) : false }));
    if (decorate) {
      const hs = hash32(`${seed}${d.id}`);
      if (hs % 11 === 0) items.push(decoSpine(`${seed}${i}`));
      if (n >= 6 && i === Math.floor(n * 0.55) && hs % 3 === 0) items.push(bookStack(seed));
    }
  });
  if (decorate) {
    const fill = n === 0 ? 3 : n < 5 ? 5 - n : 0;
    for (let i = 0; i < fill; i++) items.push(decoSpine(`${seed}fill${i}`));
    if (n === 0) items.push(ornamentPiece(seed));
    items.push(h('span', { class: 'bookend', 'aria-hidden': 'true' }));
  }
  rows.append(...items);
  if (n === 0 && emptyText) rows.append(h('span', { class: 'shelf-empty' }, emptyText));
  return rows;
}

/** A free-standing bookcase with a brass label on its crown. */
export function bookcase({ title, sub, href, scope, docs, selection, filterFn, wide, emptyText, dropTarget, actions, mode = 'shelf' }) {
  const count = docs.length;
  const label = href
    ? h('a', { class: 'bc-plate', href }, h('span', { class: 'bc-title' }, title), h('span', { class: 'bc-count' }, count === 1 ? '1 volume' : `${count} volumes`))
    : h('div', { class: 'bc-plate' }, h('span', { class: 'bc-title' }, title), h('span', { class: 'bc-count' }, count === 1 ? '1 volume' : `${count} volumes`));
  return h(
    'section',
    {
      class: `bookcase ${wide || count > 34 ? 'wide' : ''} ${mode === 'index' ? 'as-index' : ''}`,
      'data-scope': scope,
      'data-drop': dropTarget || null,
      'aria-label': `${title}, ${count} volumes`,
    },
    h('header', { class: 'bc-crown' }, label, actions || null),
    sub ? h('p', { class: 'bc-sub' }, sub) : null,
    h('div', { class: 'bc-body' }, mode === 'index' ? indexCards(docs, { scope, selection, filterFn, emptyText }) : shelfRows(docs, { scope, selection, filterFn, seed: scope || title, emptyText })),
    h('div', { class: 'bc-plinth' }),
  );
}

/** Catalogue-card view: practical on phones and with very large collections. */
export function indexCards(docs, { scope = '', selection, filterFn, emptyText } = {}) {
  const wrap = h('div', { class: 'index-cards' });
  if (!docs.length) {
    wrap.append(h('p', { class: 'shelf-empty static' }, emptyText || 'No volumes here yet.'));
    return wrap;
  }
  for (const d of docs) {
    const key = `${d.id}::${scope}`;
    const prog = idx.progress.get(d.id);
    const s = spineSpec(d);
    const thumb = h('span', { class: `ic-thumb b-${s.binding}`, style: { '--c': s.color } });
    if (d.coverId) {
      coverURL(d.coverId).then((u) => {
        if (u) thumb.append(h('img', { src: u, alt: '', loading: 'lazy' }));
      });
    }
    wrap.append(
      h(
        'button',
        {
          type: 'button',
          class: `index-card ${selection?.has(key) ? 'is-selected' : ''} ${filterFn && !filterFn(d) ? 'is-dim' : ''}`,
          'data-id': d.id,
          'data-scope': scope,
          draggable: 'true',
        },
        thumb,
        h(
          'span',
          { class: 'ic-text' },
          h('span', { class: 'ic-title' }, d.title || 'Untitled'),
          h('span', { class: 'ic-author' }, d.author || '—'),
          h('span', { class: 'ic-meta' }, [kindLabel(d.kind), d.year].filter(Boolean).join(' · ')),
          prog?.percent > 0.005 ? h('span', { class: 'ic-progress', style: { '--p': `${Math.round(prog.percent * 100)}%` } }) : null,
        ),
        selection ? h('span', { class: 'ic-check', html: selection.has(key) ? '✓' : '' }) : null,
      ),
    );
  }
  return wrap;
}

/** Miniature shelves seen through a doorway in the hall. */
export function peekShelves(deptId, docIds, rows = 3, perRow = 15) {
  const docs = [...docIds].map((id) => idx.doc.get(id)).filter(Boolean);
  const out = [];
  let k = 0;
  for (let r = 0; r < rows; r++) {
    const row = h('div', { class: 'peek-row' });
    const realHere = Math.min(perRow, Math.max(0, docs.length - k));
    const fillTo = docs.length ? perRow : 3 + (hash32(deptId + r) % 4);
    for (let i = 0; i < fillTo; i++) {
      let color;
      let ht;
      let w;
      if (i < realHere) {
        const s = spineSpec(docs[k++]);
        color = s.color;
        ht = s.h;
        w = s.w;
      } else {
        const hs = hash32(`${deptId}${r}${i}`);
        color = DECO[hs % DECO.length];
        ht = 140 + (hs % 50);
        w = 14 + ((hs >>> 3) % 20);
      }
      row.append(h('span', { class: 'peek-book', style: { '--c': color, '--ph': `${Math.round(ht / 5.6)}px`, '--pw': `${Math.max(3, Math.round(w / 4.2))}px` } }));
    }
    out.push(row);
  }
  return out;
}

export function fauxCover(doc) {
  const s = spineSpec(doc);
  return h(
    'div',
    { class: `faux-cover b-${s.binding}`, style: { '--c': s.color } },
    h('span', { class: 'fc-frame' }),
    h('span', { class: 'fc-title' }, doc.title || 'Untitled'),
    doc.author ? h('span', { class: 'fc-author' }, doc.author) : null,
  );
}

export function coverEl(doc, cls = 'cover') {
  const box = h('div', { class: cls });
  box.append(fauxCover(doc));
  if (doc.coverId) {
    coverURL(doc.coverId).then((u) => {
      if (u) box.replaceChildren(h('img', { src: u, alt: `Cover of ${doc.title}` }));
    });
  }
  return box;
}
