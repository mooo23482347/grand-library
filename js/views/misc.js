// Smaller rooms: the returns table (volumes without a shelf) and the shelf of one tag.

import { h, fromHTML } from '../util.js';
import { idx, sortDocs } from '../store.js';
import { icon } from '../ui/icons.js';
import { bookcase } from './shelf.js';
import { openAcquire } from '../import/acquire.js';

function wireOpen(root) {
  root.addEventListener('click', (e) => {
    const el = e.target.closest('.spine[data-id], .index-card[data-id]');
    if (!el) return;
    const base = location.hash.split('?')[0];
    location.hash = `${base}?doc=${encodeURIComponent(el.dataset.id)}`;
  });
  return root;
}

export function renderUnshelved() {
  const docs = sortDocs(idx.unshelved, 'added');
  return wireOpen(
    h(
      'div',
      { class: 'room plain-room' },
      h('header', { class: 'room-head' },
        h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, 'The Hall'), h('span', { class: 'crumb-sep' }, '›'), h('span', null, 'The returns table')),
        h('div', { class: 'room-title-row' }, h('span', { class: 'room-medallion', html: icon('book') }), h('div', { class: 'room-titles' }, h('h1', { class: 'room-title' }, 'The returns table'), h('p', { class: 'room-sub' }, 'Volumes that stand on no shelf. Open one and choose “Also shelve in…” to give it a place.'))),
        h('div', { class: 'room-tools' }, h('button', { type: 'button', class: 'btn btn-brass tool', onClick: () => openAcquire({}) }, fromHTML(icon('acquire')), h('span', { class: 'tool-label' }, 'Acquire'))),
      ),
      h('div', { class: 'room-main solo' }, bookcase({ title: 'Awaiting a shelf', scope: '', docs, wide: true, emptyText: 'Nothing waits here. Every volume has its place.' })),
    ),
  );
}

export function renderTag([tagId]) {
  const t = idx.tag.get(tagId);
  if (!t) return h('div', { class: 'not-found' }, h('h1', null, 'This tag no longer exists'), h('p', null, h('a', { href: '#/' }, 'Return to the hall')));
  const docs = sortDocs([...(idx.docsByTag.get(tagId) || [])].map((id) => idx.doc.get(id)).filter(Boolean), 'author');
  return wireOpen(
    h(
      'div',
      { class: 'room plain-room' },
      h('header', { class: 'room-head' },
        h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, 'The Hall'), h('span', { class: 'crumb-sep' }, '›'), h('span', null, `Tag: ${t.name}`)),
        h('div', { class: 'room-title-row' }, h('span', { class: 'room-medallion', html: icon('tag') }), h('div', { class: 'room-titles' }, h('h1', { class: 'room-title' }, t.name), h('p', { class: 'room-sub' }, `${docs.length} ${docs.length === 1 ? 'volume carries' : 'volumes carry'} this tag, from every room.`))),
      ),
      h('div', { class: 'room-main solo' }, bookcase({ title: t.name, scope: '', docs, wide: true, emptyText: 'No volume carries this tag.' })),
    ),
  );
}
