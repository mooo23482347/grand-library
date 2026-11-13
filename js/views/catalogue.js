// The ledger: every volume in one ruled book, for sorting, filtering and tending many at once.

import { h, fromHTML, fold, formatDate } from '../util.js';
import {
  idx, state, placementsOf, docHref, assignMany, moveDocs, addTag, deleteDocuments, snapshotAssignments, restoreAssignments,
} from '../store.js';
import { KINDS, kindLabel, FORMATS } from '../kinds.js';
import { icon } from '../ui/icons.js';
import { confirmDialog, promptDialog, toast } from '../ui/modal.js';
import { pickPlacements } from '../ui/picker.js';

const ui = { sort: 'title', dir: 1, q: '', kind: '', room: '', tag: '', format: '', limit: 200, selected: new Set() };

const COLS = [
  { key: 'title', label: 'Title', get: (d) => d.title },
  { key: 'author', label: 'Author', get: (d) => d.author },
  { key: 'kind', label: 'Type', get: (d) => kindLabel(d.kind) },
  { key: 'year', label: 'Year', get: (d) => d.year },
  { key: 'place', label: 'Shelved in', get: (d) => placementsOf(d.id).map((p) => p.label).join(' · '), nosort: false },
  { key: 'added', label: 'Acquired', get: (d) => d.createdAt },
];

let rerender = () => {};
export function setCatalogueRerender(fn) {
  rerender = fn;
}

export function renderCatalogue() {
  const coll = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const tokens = fold(ui.q).split(/\s+/).filter(Boolean);
  let docs = state.documents.filter((d) => {
    if (ui.kind && d.kind !== ui.kind) return false;
    if (ui.format && d.format !== ui.format) return false;
    if (ui.room === '__none') { if (idx.asgByDoc.get(d.id)?.length) return false; }
    else if (ui.room && !idx.docsInDept.get(ui.room)?.has(d.id)) return false;
    if (ui.tag && !idx.docsByTag.get(ui.tag)?.has(d.id)) return false;
    if (tokens.length) {
      const hay = fold(`${d.title} ${d.author} ${d.year} ${d.publisher} ${(idx.tagsByDoc.get(d.id) || []).map((t) => t.name).join(' ')}`);
      if (!tokens.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  const col = COLS.find((c) => c.key === ui.sort) || COLS[0];
  docs.sort((a, b) => {
    const x = col.get(a);
    const y = col.get(b);
    if (typeof x === 'number' || typeof y === 'number') return ((x || 0) - (y || 0)) * ui.dir;
    return coll.compare(x || '￿', y || '￿') * ui.dir;
  });
  for (const id of [...ui.selected]) if (!idx.doc.has(id)) ui.selected.delete(id);
  const shown = docs.slice(0, ui.limit);

  const filters = h(
    'div',
    { class: 'ledger-filters' },
    h('div', { class: 'filter-wrap' }, fromHTML(icon('search')), (() => {
      const i = h('input', { type: 'search', class: 'room-filter', placeholder: 'Filter the ledger…', value: ui.q, 'data-fk': 'ledger-q', 'aria-label': 'Filter the ledger' });
      i.addEventListener('input', () => { ui.q = i.value; ui.limit = 200; rerender(); });
      return i;
    })()),
    select('Every room', ui.room, [...idx.depts.map((d) => [d.id, d.name]), ['__none', 'On the returns table']], (v) => (ui.room = v)),
    select('Every type', ui.kind, KINDS.map((k) => [k.id, k.label]), (v) => (ui.kind = v)),
    select('Every format', ui.format, Object.entries(FORMATS), (v) => (ui.format = v)),
    select('Every tag', ui.tag, [...state.tags].sort((a, b) => a.name.localeCompare(b.name)).map((t) => [t.id, t.name]), (v) => (ui.tag = v)),
  );

  const allShownSelected = shown.length && shown.every((d) => ui.selected.has(d.id));
  const head = h(
    'tr',
    null,
    h('th', { class: 'col-check' }, h('input', { type: 'checkbox', 'aria-label': 'Select all shown', checked: allShownSelected, onChange: (e) => { shown.forEach((d) => (e.target.checked ? ui.selected.add(d.id) : ui.selected.delete(d.id))); rerender(); } })),
    COLS.map((c) =>
      h('th', { class: `col-${c.key}`, 'aria-sort': ui.sort === c.key ? (ui.dir > 0 ? 'ascending' : 'descending') : null },
        h('button', { type: 'button', class: 'th-sort', onClick: () => { if (ui.sort === c.key) ui.dir *= -1; else { ui.sort = c.key; ui.dir = 1; } rerender(); } }, c.label, ui.sort === c.key ? (ui.dir > 0 ? ' ↑' : ' ↓') : '')),
    ),
  );

  const rows = shown.map((d) =>
    h(
      'tr',
      { class: ui.selected.has(d.id) ? 'sel' : '' },
      h('td', { class: 'col-check' }, h('input', { type: 'checkbox', 'aria-label': `Select ${d.title}`, checked: ui.selected.has(d.id), onChange: (e) => { e.target.checked ? ui.selected.add(d.id) : ui.selected.delete(d.id); rerender(); } })),
      h('td', { class: 'col-title' }, h('a', { href: docHref(d.id) }, d.title || 'Untitled')),
      h('td', { class: 'col-author' }, d.author || '—'),
      h('td', { class: 'col-kind' }, kindLabel(d.kind)),
      h('td', { class: 'col-year' }, d.year || ''),
      h('td', { class: 'col-place' }, placementsOf(d.id).map((p) => p.label).join(' · ') || h('em', { class: 'muted' }, 'returns table')),
      h('td', { class: 'col-added' }, formatDate(d.createdAt)),
    ),
  );

  const n = ui.selected.size;
  const ids = () => [...ui.selected];
  const bulk = h(
    'div',
    { class: `ledger-bulk ${n ? 'on' : ''}` },
    h('span', { class: 'sel-count' }, n ? `${n} chosen` : 'Choose volumes with the boxes'),
    h('button', { type: 'button', class: 'btn btn-ghost small', disabled: !n, onClick: async () => {
      const t = await pickPlacements({ title: `Move ${n} ${n === 1 ? 'volume' : 'volumes'} to…`, subtitle: 'They leave all their current shelves.', confirm: 'Move' });
      if (!t) return;
      const sel = ids();
      const snap = snapshotAssignments(sel);
      await moveDocs(sel, '', t);
      toast('Moved.', { action: { label: 'Undo', onClick: () => restoreAssignments(sel, snap) } });
    } }, 'Move to…'),
    h('button', { type: 'button', class: 'btn btn-ghost small', disabled: !n, onClick: async () => {
      const t = await pickPlacements({ title: `Also shelve ${n} ${n === 1 ? 'volume' : 'volumes'} in…`, confirm: 'Shelve also here' });
      if (t) { await assignMany(ids(), t); toast('Shelved. Nothing was copied.'); }
    } }, 'Also shelve in…'),
    h('button', { type: 'button', class: 'btn btn-ghost small', disabled: !n, onClick: async () => {
      const name = await promptDialog({ title: `Tag ${n} ${n === 1 ? 'volume' : 'volumes'}`, label: 'Tag', confirm: 'Add tag' });
      if (name) { for (const t of name.split(',')) await addTag(ids(), t); toast('Tagged.'); }
    } }, 'Tag…'),
    h('button', { type: 'button', class: 'btn btn-ghost small danger', disabled: !n, onClick: async () => {
      const ok = await confirmDialog({ title: `Delete ${n} ${n === 1 ? 'volume' : 'volumes'}?`, message: 'They are removed from every room with their files, highlights and bookmarks. Notes about them stay in the Scriptorium. This cannot be undone.', confirm: 'Delete for good', danger: true });
      if (ok) { await deleteDocuments(ids()); ui.selected.clear(); toast('Deleted.'); }
    } }, 'Delete…'),
    n ? h('button', { type: 'button', class: 'link-btn', onClick: () => { ui.selected.clear(); rerender(); } }, 'Clear') : null,
  );

  return h(
    'div',
    { class: 'ledger-page' },
    h('header', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'The Ledger'), h('p', { class: 'page-sub' }, `${state.documents.length} volumes catalogued${docs.length !== state.documents.length ? ` · ${docs.length} shown by the filter` : ''}`)),
    filters,
    bulk,
    h(
      'div',
      { class: 'ledger-book' },
      docs.length
        ? h('table', { class: 'ledger' }, h('thead', null, head), h('tbody', null, rows))
        : h('p', { class: 'ledger-empty' }, state.documents.length ? 'No entry matches the filter.' : 'The ledger is empty. Acquire your first volumes.'),
      docs.length > shown.length
        ? h('button', { type: 'button', class: 'btn btn-ghost ledger-more', onClick: () => { ui.limit += 300; rerender(); } }, `Show ${Math.min(300, docs.length - shown.length)} more of ${docs.length - shown.length}`)
        : null,
    ),
  );
}

function select(allLabel, value, options, set) {
  const s = h('select', { class: 'ledger-select' }, h('option', { value: '' }, allLabel), options.map(([v, l]) => h('option', { value: v, selected: v === value ? true : null }, l)));
  s.addEventListener('change', () => {
    set(s.value);
    ui.limit = 200;
    rerender();
  });
  return s;
}
