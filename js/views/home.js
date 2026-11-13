// Start page: search, "Weiterlesen", and a wall of shelves that scrolls down.

import { h, fromHTML, debounce } from '../util.js';
import { idx, state, deptStats, sortDocs, setDepartmentOrder, docHref } from '../store.js';
import { icon, MINUS_BADGE } from '../ui/icons.js';
import { pageHeader, navButton, searchField, group, cell } from '../ui/controls.js';
import { makeReorderable } from '../ui/reorder.js';
import { bookEl, coverEl } from './covers.js';
import { newRoomDialog, editRoomDialog, deleteRoomDialog } from './roomdialogs.js';
import { openAcquire } from '../import/acquire.js';
import { searchLibrary } from '../search.js';
import { kindLabel } from '../kinds.js';
import { syncBadge } from './syncbadge.js';

export const homeUI = { editing: false, q: '' };
let rerender = () => {};
export function setHomeRerender(fn) {
  rerender = fn;
}
export function startEditingShelves() {
  homeUI.editing = true;
  if (location.hash === '#/' || location.hash === '' || location.hash === '#') rerender();
  else location.hash = '#/';
}

export function renderHome() {
  const editing = homeUI.editing;
  const actions = editing
    ? [navButton('Fertig', () => { homeUI.editing = false; rerender(); }, { strong: true })]
    : [navButton('Bearbeiten', () => { homeUI.editing = true; rerender(); }), navButton('Hinzufügen', () => openAcquire({}), { icon: 'plus' })];
  const page = h('div', { class: 'page home' }, pageHeader({ title: 'Bücher', left: [syncBadge()], actions }));
  if (editing) {
    page.append(editShelves());
    return page;
  }

  const results = h('div', { class: 'quick-results' });
  const shelves = h('div', { class: 'home-content' }, continueReading(), wall());
  const runSearch = debounce((q) => {
    homeUI.q = q;
    const has = q.trim().length > 0;
    shelves.hidden = has;
    results.hidden = !has;
    if (has) drawQuick(results, q.trim());
  }, 120);
  page.append(
    searchField({ placeholder: 'Titel, Autor, Notizen …', value: homeUI.q, fk: 'home-search', onInput: runSearch, onEnter: (v) => v.trim() && (location.hash = `#/search?q=${encodeURIComponent(v.trim())}`) }),
    results,
    shelves,
  );
  if (homeUI.q) runSearch(homeUI.q);
  else results.hidden = true;
  return page;
}

function drawQuick(box, q) {
  const r = searchLibrary(q);
  const rows = [];
  for (const p of r.places.slice(0, 4)) rows.push(cell({ title: p.label, sub: p.type === 'room' ? 'Regal' : 'Sammlung', href: p.href, icon: 'library', tint: 'var(--text-3)' }));
  for (const { doc } of r.docs.slice(0, 12)) {
    rows.push(h('a', { class: 'cell doc-cell', href: docHref(doc.id) }, coverEl(doc, 'mini'), h('span', { class: 'cell-main' }, h('span', { class: 'cell-title' }, doc.title), h('span', { class: 'cell-sub' }, [doc.author, kindLabel(doc.kind)].filter(Boolean).join(' · '))), fromHTML(icon('next', 'cell-chevron'))));
  }
  for (const { note } of r.notes.slice(0, 4)) rows.push(cell({ title: note.title || (note.quote || note.body || '').slice(0, 60), sub: 'Notiz', href: `#/scriptorium/${note.id}`, icon: 'notes', tint: 'var(--text-3)' }));
  box.replaceChildren(
    rows.length ? group({ rows }) : h('p', { class: 'muted center-text' }, 'Nichts gefunden.'),
    h('a', { class: 'btn block tinted', href: `#/search?q=${encodeURIComponent(q)}` }, fromHTML(icon('search')), 'Überall suchen, auch im Text der Bücher'),
  );
}

function continueReading() {
  const recent = [...state.progress]
    .filter((p) => idx.doc.has(p.documentId) && p.openedAt && (p.percent || 0) < 0.995)
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, 8);
  if (!recent.length) return null;
  return h(
    'section',
    { class: 'continue' },
    h('h2', { class: 'section-title' }, 'Weiterlesen'),
    h(
      'div',
      { class: 'continue-row' },
      recent.map((p) => {
        const d = idx.doc.get(p.documentId);
        const pct = Math.round((p.percent || 0) * 100);
        return h(
          'a',
          { class: 'continue-card', href: `#/read/${d.id}` },
          coverEl(d, 'small'),
          h(
            'span',
            { class: 'continue-text' },
            h('span', { class: 'continue-title' }, d.title),
            h('span', { class: 'continue-author' }, d.author || kindLabel(d.kind)),
            h('span', { class: 'continue-meta' }, h('span', { class: 'progress' }, h('span', { style: { width: `${pct}%` } })), h('span', { class: 'pct' }, `${pct} %`)),
          ),
        );
      }),
    ),
  );
}

function shelf({ id, name, color, href, docs, empty }) {
  const books = h('div', { class: 'shelf-books', role: 'list' }, docs.map((d) => bookEl(d, { scope: id ? `d:${id}` : '' })));
  return h(
    'section',
    { class: `shelf ${docs.length ? '' : 'is-empty'}`, style: { '--shelf-color': color || 'var(--accent)' }, 'aria-label': name },
    h('a', { class: 'shelf-head', href }, h('h2', { class: 'shelf-name' }, name), h('span', { class: 'shelf-count' }, String(docs.length)), fromHTML(icon('next', 'shelf-chev'))),
    h(
      'div',
      { class: 'shelf-unit' },
      docs.length ? books : h('div', { class: 'shelf-empty' }, h('span', null, 'Leer'), h('button', { type: 'button', class: 'btn small tinted', onClick: () => openAcquire({ targets: empty }) }, fromHTML(icon('plus')), 'Hinzufügen')),
      h('div', { class: 'shelf-board', 'aria-hidden': 'true' }),
    ),
  );
}

function wall() {
  const out = idx.depts.map((d) =>
    shelf({
      id: d.id,
      name: d.name,
      color: d.leather,
      href: `#/room/${d.id}`,
      docs: sortDocs([...(idx.docsInDept.get(d.id) || [])].map((x) => idx.doc.get(x)).filter(Boolean), 'added'),
      empty: [{ deptId: d.id, colId: null }],
    }),
  );
  if (idx.unshelved.length) out.push(shelf({ id: '', name: 'Ohne Regal', href: '#/unshelved', docs: sortDocs(idx.unshelved, 'added'), empty: [] }));
  if (!idx.depts.length) out.push(h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, 'Noch keine Regale'), h('button', { type: 'button', class: 'btn tinted', onClick: () => newRoomDialog() }, 'Regal anlegen')));
  return h('div', { class: 'wall' }, out);
}

function editShelves() {
  const list = h(
    'ul',
    { class: 'list edit-list' },
    idx.depts.map((d) => {
      const st = deptStats(d.id);
      return h(
        'li',
        { 'data-key': d.id },
        h(
          'div',
          { class: 'cell' },
          h('button', { type: 'button', class: 'del-btn', 'aria-label': `${d.name} löschen`, html: MINUS_BADGE, onClick: () => deleteRoomDialog(d) }),
          h('span', { class: 'shelf-dot', style: { '--shelf-color': d.leather } }),
          h('button', { type: 'button', class: 'cell-main link', onClick: () => editRoomDialog(d) }, h('span', { class: 'cell-title' }, d.name), h('span', { class: 'cell-sub' }, `${st.volumes} ${st.volumes === 1 ? 'Buch' : 'Bücher'} · ${st.collections} ${st.collections === 1 ? 'Sammlung' : 'Sammlungen'}`)),
          h('span', { class: 'grip', 'aria-label': 'Ziehen zum Umsortieren', html: icon('grip') }),
        ),
      );
    }),
    h('li', null, cell({ title: 'Neues Regal', accent: true, onClick: () => newRoomDialog() })),
  );
  makeReorderable(list, { onReorder: (keys) => setDepartmentOrder(keys) });
  return h(
    'div',
    { class: 'edit-shelves' },
    h('section', { class: 'group' }, h('h2', { class: 'group-head' }, h('span', null, 'Regale')), list, h('p', { class: 'group-foot' }, 'Ziehen (am Handy: gedrückt halten) zum Umsortieren. Antippen zum Umbenennen und für die Sammlungen. Beim Löschen eines Regals bleiben alle Bücher erhalten.')),
  );
}
