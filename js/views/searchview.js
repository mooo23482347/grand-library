// Suche: one field for the whole library, including the full text of the books.

import { h, fromHTML, debounce } from '../util.js';
import { idx, docHref, noteTitle, placementsOf } from '../store.js';
import { kindLabel, noteKind } from '../kinds.js';
import { searchLibrary, searchFullText, fulltextCoverage } from '../search.js';
import { icon } from '../ui/icons.js';
import { pageHeader, searchField, group, cell, emptyState } from '../ui/controls.js';
import { coverEl } from './covers.js';

let running = null;

export function renderSearch(params, query) {
  const results = h('div', { class: 'search-results' });
  const scopeSel = h('select', { class: 'scope-select', 'aria-label': 'Wo suchen' }, h('option', { value: '' }, 'Überall'), idx.depts.map((d) => h('option', { value: d.id, selected: d.id === query.room ? true : null }, d.name)));

  let q = query.q || '';
  const go = debounce(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (scopeSel.value) p.set('room', scopeSel.value);
    history.replaceState(null, '', `#/search${p.toString() ? `?${p}` : ''}`);
    draw(q.trim(), scopeSel.value);
  }, 200);
  scopeSel.addEventListener('change', go);

  function draw(v, room) {
    running?.abort();
    results.replaceChildren();
    if (!v) {
      results.append(emptyState({ icon: 'search', title: 'Bibliothek durchsuchen', text: 'Titel, Autoren, Regale, Tags, deine Notizen und Markierungen – und der Text aller Bücher auf diesem Gerät.' }));
      return;
    }
    const r = searchLibrary(v, room ? { deptId: room } : {});
    if (r.places.length || r.tags.length) {
      results.append(group({ head: 'Regale & Tags', icons: true, rows: [
        ...r.places.slice(0, 8).map((p) => cell({ title: p.label, sub: p.type === 'room' ? 'Regal' : 'Sammlung', href: p.href, icon: p.type === 'room' ? 'library' : 'folder', tint: 'var(--text-3)' })),
        ...r.tags.slice(0, 8).map((t) => cell({ title: t.tag.name, sub: `Tag · ${t.count}`, href: `#/tag/${t.tag.id}`, icon: 'tag', tint: 'var(--text-3)' })),
      ] }));
    }
    if (r.docs.length) {
      results.append(group({ head: `Bücher · ${r.docs.length}`, rows: r.docs.slice(0, 80).map(({ doc, why }) => h('a', { class: 'cell doc-cell', href: docHref(doc.id) }, coverEl(doc, 'mini'), h('span', { class: 'cell-main' }, h('span', { class: 'cell-title' }, doc.title), h('span', { class: 'cell-sub' }, [doc.author, kindLabel(doc.kind), doc.year].filter(Boolean).join(' · ')), h('span', { class: 'cell-sub' }, why.length && !why.includes('Titel') ? `Gefunden in: ${why.join(', ')}` : placementsOf(doc.id).map((p) => p.label).join(' · ') || 'Ohne Regal')), fromHTML(icon('next', 'cell-chevron')))) }));
    }
    if (r.notes.length || r.marks.length) {
      results.append(group({ head: `Notizen · ${r.notes.length + r.marks.length}`, icons: true, rows: [
        ...r.notes.slice(0, 40).map(({ note }) => { const k = noteKind(note.kind); const d = note.documentId ? idx.doc.get(note.documentId) : null; return cell({ title: noteTitle(note), sub: [k.label, d?.title].filter(Boolean).join(' · '), href: `#/scriptorium/${note.id}`, icon: k.icon, tint: 'var(--accent)' }); }),
        ...r.marks.slice(0, 30).map(({ mark }) => cell({ title: `„${mark.text.slice(0, 120)}“`, sub: idx.doc.get(mark.documentId)?.title || '', href: `#/read/${mark.documentId}?loc=${encodeURIComponent(JSON.stringify(mark.loc))}`, icon: 'highlighter', tint: 'var(--warn)', wrap: true })),
      ] }));
    }
    const full = h('section', { class: 'group' });
    results.append(full);
    fullText(full, v, room, !(r.docs.length || r.notes.length || r.places.length || r.marks.length));
  }

  async function fullText(box, v, room, nothingElse) {
    const head = h('h2', { class: 'group-head' }, h('span', null, 'Im Text der Bücher'));
    if (v.length < 3) {
      box.replaceChildren(head, h('p', { class: 'group-foot' }, 'Ab drei Buchstaben wird auch im Text gesucht.'));
      return;
    }
    const ctrl = new AbortController();
    running = ctrl;
    const status = h('p', { class: 'group-foot' }, 'Wird durchsucht …');
    const list = h('ul', { class: 'list' });
    const cov = await fulltextCoverage();
    box.replaceChildren(head, list, status);
    list.hidden = true;
    let n = 0;
    await searchFullText(v, {
      docIds: room ? idx.docsInDept.get(room) || new Set() : null,
      signal: ctrl.signal,
      onProgress: (p) => { if (!ctrl.signal.aborted) status.textContent = `Wird durchsucht … ${Math.round(p * 100)} %`; },
      onHit: (hit) => {
        if (ctrl.signal.aborted) return;
        n++;
        list.hidden = false;
        list.append(h('li', null, h('a', { class: 'cell stack passage', href: `#/read/${hit.doc.id}?loc=${encodeURIComponent(JSON.stringify(hit.loc))}` }, h('span', { class: 'cell-sub' }, `${hit.doc.title} · ${hit.part.label}`), h('span', { class: 'passage-text' }, hit.pre, h('mark', null, hit.hit), hit.post))));
      },
    });
    if (ctrl.signal.aborted) return;
    const coverage = cov.indexed < cov.readable ? ` ${cov.indexed} von ${cov.readable} Büchern sind auf diesem Gerät durchsuchbar.` : '';
    status.textContent = n ? `${n} ${n === 1 ? 'Stelle' : 'Stellen'}${n >= 80 ? ' (die ersten 80)' : ''}.${coverage}` : `${nothingElse ? 'Nichts gefunden.' : 'Keine Stelle im Text.'}${coverage}`;
  }

  const page = h(
    'div',
    { class: 'page search-page' },
    pageHeader({ title: 'Suche' }),
    h('div', { class: 'search-row' }, searchField({ placeholder: 'Titel, Autor, Zitat, Gedanke …', value: q, fk: 'search-page', onInput: (v) => { q = v; go(); } }), scopeSel),
    results,
  );
  draw(q.trim(), query.room || '');
  return page;
}
