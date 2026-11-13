// The card catalogue: one search field for the whole library.

import { h, fromHTML, debounce } from '../util.js';
import { idx, docHref, noteTitle, placementsOf } from '../store.js';
import { kindLabel, noteKindLabel } from '../kinds.js';
import { searchLibrary, searchFullText, fulltextCoverage } from '../search.js';
import { icon } from '../ui/icons.js';
import { spineSpec } from './shelf.js';

let running = null;

export function renderSearch(params, query) {
  const q = query.q || '';
  const roomId = query.room || '';
  const input = h('input', {
    class: 'search-big',
    type: 'search',
    value: q,
    placeholder: 'Title, author, tag, room, a phrase from a book…',
    'aria-label': 'Search the library',
    'data-fk': 'search-page',
    autocomplete: 'off',
  });
  const scopeSel = h(
    'select',
    { class: 'search-scope', 'aria-label': 'Where to search' },
    h('option', { value: '' }, 'The whole library'),
    idx.depts.map((d) => h('option', { value: d.id, selected: d.id === roomId ? true : null }, d.name)),
  );
  const results = h('div', { class: 'search-results' });
  const fullWrap = h('section', { class: 'sr-group sr-fulltext' });

  const go = debounce(() => {
    const v = input.value.trim();
    const params = new URLSearchParams();
    if (v) params.set('q', v);
    if (scopeSel.value) params.set('room', scopeSel.value);
    history.replaceState(null, '', `#/search${params.toString() ? `?${params}` : ''}`);
    draw(v, scopeSel.value);
  }, 220);
  input.addEventListener('input', go);
  scopeSel.addEventListener('change', go);

  function draw(v, room) {
    running?.abort();
    results.replaceChildren();
    fullWrap.replaceChildren();
    if (!v) {
      results.append(h('p', { class: 'search-hint' }, 'Search titles, authors, descriptions, tags, rooms and collections, your notes and summaries, the passages you marked, and the full text of every volume on this device.'));
      return;
    }
    const r = searchLibrary(v, room ? { deptId: room } : {});
    const total = r.docs.length + r.places.length + r.notes.length + r.marks.length + r.tags.length;

    if (r.places.length || r.tags.length) {
      results.append(
        h(
          'section',
          { class: 'sr-group' },
          h('h2', { class: 'sr-h' }, 'Rooms, collections and tags'),
          h(
            'div',
            { class: 'sr-places' },
            r.places.slice(0, 12).map((p) => h('a', { class: `sr-place ${p.type}`, href: p.href }, h('span', { class: 'sr-place-kind' }, p.type === 'room' ? 'Room' : 'Collection'), h('span', null, p.label))),
            r.tags.slice(0, 12).map((t) => h('a', { class: 'sr-place tag', href: `#/tag/${t.tag.id}` }, h('span', { class: 'sr-place-kind' }, 'Tag'), h('span', null, `${t.tag.name} (${t.count})`))),
          ),
        ),
      );
    }

    if (r.docs.length) {
      results.append(
        h(
          'section',
          { class: 'sr-group' },
          h('h2', { class: 'sr-h' }, `Volumes · ${r.docs.length}`),
          h(
            'ol',
            { class: 'sr-docs' },
            r.docs.slice(0, 120).map(({ doc, why }) => {
              const s = spineSpec(doc);
              const where = placementsOf(doc.id).map((p) => p.label);
              return h(
                'li',
                null,
                h(
                  'a',
                  { class: 'sr-doc', href: docHref(doc.id) },
                  h('span', { class: `sr-spine b-${s.binding}`, style: { '--c': s.color } }),
                  h(
                    'span',
                    { class: 'sr-doc-text' },
                    h('span', { class: 'sr-title' }, doc.title),
                    h('span', { class: 'sr-meta' }, [doc.author, kindLabel(doc.kind), doc.year].filter(Boolean).join(' · ')),
                    h('span', { class: 'sr-where' }, where.length ? where.join('  ·  ') : 'On the returns table'),
                    why.length && !why.includes('title') ? h('span', { class: 'sr-why' }, `Found in: ${why.join(', ')}`) : null,
                  ),
                ),
              );
            }),
          ),
        ),
      );
    }

    if (r.notes.length || r.marks.length) {
      results.append(
        h(
          'section',
          { class: 'sr-group' },
          h('h2', { class: 'sr-h' }, `From the Scriptorium · ${r.notes.length + r.marks.length}`),
          h(
            'ul',
            { class: 'sr-notes' },
            r.notes.slice(0, 60).map(({ note }) => {
              const d = note.documentId ? idx.doc.get(note.documentId) : null;
              return h('li', null, h('a', { class: 'sr-note', href: `#/scriptorium/${note.id}` }, h('span', { class: 'sr-note-kind' }, noteKindLabel(note.kind)), h('span', { class: 'sr-title' }, noteTitle(note)), d ? h('span', { class: 'sr-meta' }, `on ${d.title}${note.chapter ? ` · ${note.chapter}` : ''}`) : null));
            }),
            r.marks.slice(0, 40).map(({ mark }) => {
              const d = idx.doc.get(mark.documentId);
              return h('li', null, h('a', { class: 'sr-note mark', href: `#/read/${mark.documentId}?loc=${encodeURIComponent(JSON.stringify(mark.loc))}` }, h('span', { class: 'sr-note-kind' }, 'Marked passage'), h('span', { class: 'sr-quote' }, `“${mark.text.slice(0, 220)}${mark.text.length > 220 ? '…' : ''}”`), d ? h('span', { class: 'sr-meta' }, d.title) : null));
            }),
          ),
        ),
      );
    }

    if (!total) results.append(h('p', { class: 'search-none' }, 'Nothing in the catalogue matches. The full text is being searched below.'));
    results.append(fullWrap);
    runFullText(v, room);
  }

  async function runFullText(v, room) {
    if (v.length < 3) {
      fullWrap.append(h('h2', { class: 'sr-h' }, 'In the text of the volumes'), h('p', { class: 'muted' }, 'Type at least three letters to search inside the books.'));
      return;
    }
    const ctrl = new AbortController();
    running = ctrl;
    const status = h('p', { class: 'sr-status' }, 'Leafing through the volumes…');
    const list = h('ol', { class: 'sr-passages' });
    const cov = await fulltextCoverage();
    fullWrap.replaceChildren(
      h('h2', { class: 'sr-h' }, 'In the text of the volumes'),
      status,
      list,
      cov.indexed < cov.readable ? h('p', { class: 'muted small' }, `${cov.indexed} of ${cov.readable} readable volumes are indexed on this device. The rest are indexed once their file is here.`) : null,
    );
    let n = 0;
    const docIds = room ? idx.docsInDept.get(room) || new Set() : null;
    await searchFullText(v, {
      docIds,
      signal: ctrl.signal,
      onProgress: (p, count) => {
        if (!ctrl.signal.aborted) status.textContent = `Leafing through ${count} volumes… ${Math.round(p * 100)}%`;
      },
      onHit: (hit) => {
        if (ctrl.signal.aborted) return;
        n++;
        list.append(
          h(
            'li',
            null,
            h(
              'a',
              { class: 'sr-passage', href: `#/read/${hit.doc.id}?loc=${encodeURIComponent(JSON.stringify(hit.loc))}` },
              h('span', { class: 'sr-passage-src' }, `${hit.doc.title} · ${hit.part.label}`),
              h('span', { class: 'sr-passage-text' }, hit.pre, h('mark', null, hit.hit), hit.post),
            ),
          ),
        );
      },
    });
    if (!ctrl.signal.aborted) status.textContent = n ? `${n} ${n === 1 ? 'passage' : 'passages'} found${n >= 80 ? ' (showing the first 80)' : ''}.` : 'No passage contains this phrase.';
  }

  const page = h(
    'div',
    { class: 'search-page' },
    h(
      'header',
      { class: 'search-head' },
      h('h1', { class: 'page-title' }, 'The Card Catalogue'),
      h('div', { class: 'search-bar' }, h('span', { class: 'search-icon', html: icon('search') }), input, scopeSel),
    ),
    results,
  );
  draw(q, roomId);
  return page;
}

export const searchIcon = () => fromHTML(icon('search'));
