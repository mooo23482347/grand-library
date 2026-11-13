// Ohne Regal (books on no shelf) and the books of one tag.

import { h, fromHTML } from '../util.js';
import { idx, sortDocs } from '../store.js';
import { icon } from '../ui/icons.js';
import { pageHeader, emptyState } from '../ui/controls.js';
import { bookEl } from './covers.js';
import { openBook } from './room.js';

function grid(docs) {
  const g = h('div', { class: 'book-grid' }, docs.map((d) => bookEl(d, { showTitle: true, progress: true })));
  g.addEventListener('click', (e) => {
    const b = e.target.closest('.book[data-id]');
    if (b) openBook(b.dataset.id);
  });
  return g;
}

export function renderUnshelved() {
  const docs = sortDocs(idx.unshelved, 'added');
  return h(
    'div',
    { class: 'page' },
    pageHeader({ title: 'Ohne Regal', back: { href: '#/', label: 'Bücher' }, sub: 'Bücher, die in keinem Regal stehen. Öffne eins und wähle „Auch einordnen in …“.' }),
    docs.length ? grid(docs) : emptyState({ icon: 'inbox', title: 'Alles eingeordnet', text: 'Jedes Buch steht in mindestens einem Regal.' }),
  );
}

export function renderTag([tagId]) {
  const t = idx.tag.get(tagId);
  if (!t) return h('div', { class: 'page' }, pageHeader({ title: 'Tag', back: { href: '#/', label: 'Bücher' } }), emptyState({ icon: 'tag', title: 'Diesen Tag gibt es nicht mehr.' }));
  const docs = sortDocs([...(idx.docsByTag.get(tagId) || [])].map((id) => idx.doc.get(id)).filter(Boolean), 'author');
  return h('div', { class: 'page' }, pageHeader({ title: t.name, back: { href: '#/search', label: 'Suche' }, sub: `Tag · ${docs.length} ${docs.length === 1 ? 'Buch' : 'Bücher'}` }), docs.length ? grid(docs) : emptyState({ icon: 'tag', title: 'Kein Buch trägt diesen Tag.' }));
}

export const tagIcon = () => fromHTML(icon('tag'));
