// Alle Bücher: every book in one list, to sort, filter and tend many at once.

import { h, fromHTML, fold } from '../util.js';
import { idx, state, placementsOf, docHref, sortDocs, SORTS, assignMany, moveDocs, addTag, deleteDocuments, snapshotAssignments, restoreAssignments } from '../store.js';
import { KINDS, kindLabel, FORMATS } from '../kinds.js';
import { icon, CHECK_BADGE, EMPTY_BADGE } from '../ui/icons.js';
import { pageHeader, navButton, searchField, emptyState } from '../ui/controls.js';
import { confirmDialog, promptDialog, toast, showMenu } from '../ui/modal.js';
import { pickPlacements } from '../ui/picker.js';
import { coverEl } from './covers.js';

const ui = { sort: 'title', q: '', kind: '', room: '', tag: '', format: '', limit: 150, selecting: false, selected: new Set() };
let rerender = () => {};
export function setCatalogueRerender(fn) {
  rerender = fn;
}

function filterSelect(label, value, options, set) {
  const s = h('select', { class: 'filter-select', 'aria-label': label }, h('option', { value: '' }, label), options.map(([v, l]) => h('option', { value: v, selected: v === value ? true : null }, l)));
  s.addEventListener('change', () => {
    set(s.value);
    ui.limit = 150;
    rerender();
  });
  return s;
}

export function renderCatalogue() {
  const tokens = fold(ui.q).split(/\s+/).filter(Boolean);
  let docs = state.documents.filter((d) => {
    if (ui.kind && d.kind !== ui.kind) return false;
    if (ui.format && d.format !== ui.format) return false;
    if (ui.room === '__none') {
      if (idx.asgByDoc.get(d.id)?.length) return false;
    } else if (ui.room && !idx.docsInDept.get(ui.room)?.has(d.id)) return false;
    if (ui.tag && !idx.docsByTag.get(ui.tag)?.has(d.id)) return false;
    if (tokens.length) {
      const hay = fold(`${d.title} ${d.author} ${d.year} ${d.publisher} ${(idx.tagsByDoc.get(d.id) || []).map((t) => t.name).join(' ')}`);
      if (!tokens.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  docs = sortDocs(docs, ui.sort);
  for (const id of [...ui.selected]) if (!idx.doc.has(id)) ui.selected.delete(id);
  const shown = docs.slice(0, ui.limit);

  const actions = ui.selecting
    ? [navButton('Fertig', () => { ui.selecting = false; ui.selected.clear(); rerender(); }, { strong: true })]
    : [navButton('Auswählen', () => { ui.selecting = true; rerender(); }), navButton('Sortieren', (e) => showMenu(e.currentTarget, Object.entries(SORTS).map(([k, s]) => ({ label: s.label, icon: k === ui.sort ? 'check' : null, onClick: () => { ui.sort = k; rerender(); } })), { title: 'Sortieren nach' }), { icon: 'sort', aria: 'Sortieren' })];

  const page = h(
    'div',
    { class: `page catalogue ${ui.selecting ? 'selecting' : ''}` },
    pageHeader({ title: 'Alle Bücher', sub: `${state.documents.length} ${state.documents.length === 1 ? 'Buch' : 'Bücher'}${docs.length !== state.documents.length ? ` · ${docs.length} gefiltert` : ''}`, actions }),
    searchField({ placeholder: 'Titel, Autor, Tag …', value: ui.q, fk: 'cat-q', onInput: (v) => { ui.q = v; ui.limit = 150; rerender(); } }),
    h('div', { class: 'filters' },
      filterSelect('Alle Regale', ui.room, [...idx.depts.map((d) => [d.id, d.name]), ['__none', 'Ohne Regal']], (v) => (ui.room = v)),
      filterSelect('Alle Arten', ui.kind, KINDS.map((k) => [k.id, k.label]), (v) => (ui.kind = v)),
      filterSelect('Alle Formate', ui.format, Object.entries(FORMATS), (v) => (ui.format = v)),
      filterSelect('Alle Tags', ui.tag, [...state.tags].sort((a, b) => a.name.localeCompare(b.name, 'de')).map((t) => [t.id, t.name]), (v) => (ui.tag = v)),
    ),
  );

  if (!docs.length) {
    page.append(emptyState({ icon: 'list', title: state.documents.length ? 'Nichts passt zum Filter' : 'Noch keine Bücher' }));
    return page;
  }

  const list = h('ul', { class: 'list catalogue-list' }, shown.map((d) => {
    const sel = ui.selected.has(d.id);
    return h('li', null, h(
      ui.selecting ? 'button' : 'a',
      ui.selecting
        ? { type: 'button', class: 'cell doc-cell', 'aria-pressed': sel ? 'true' : 'false', onClick: () => { sel ? ui.selected.delete(d.id) : ui.selected.add(d.id); rerender(); } }
        : { class: 'cell doc-cell', href: docHref(d.id) },
      ui.selecting ? h('span', { class: 'row-check', html: sel ? CHECK_BADGE : EMPTY_BADGE }) : null,
      coverEl(d, 'mini'),
      h('span', { class: 'cell-main' }, h('span', { class: 'cell-title' }, d.title), h('span', { class: 'cell-sub' }, [d.author, kindLabel(d.kind), d.year].filter(Boolean).join(' · ')), h('span', { class: 'cell-sub' }, placementsOf(d.id).map((p) => p.label).join(' · ') || 'Ohne Regal')),
      ui.selecting ? null : fromHTML(icon('next', 'cell-chevron')),
    ));
  }));
  page.append(list);
  if (docs.length > shown.length) page.append(h('button', { type: 'button', class: 'btn block gray more-btn', onClick: () => { ui.limit += 300; rerender(); } }, `${Math.min(300, docs.length - shown.length)} weitere zeigen`));
  if (ui.selecting) page.append(bulkBar());
  return page;
}

function bulkBar() {
  const n = ui.selected.size;
  const ids = () => [...ui.selected];
  const btn = (ic, label, fn, danger) => h('button', { type: 'button', class: `bar-btn ${danger ? 'danger' : ''}`, disabled: !n || null, onClick: fn }, fromHTML(icon(ic)), h('span', null, label));
  return h(
    'div',
    { class: 'select-bar', role: 'toolbar' },
    h('div', { class: 'select-info' }, h('span', null, n ? `${n} ausgewählt` : 'Bücher antippen')),
    h('div', { class: 'select-actions' },
      btn('move', 'Verschieben', async () => {
        const t = await pickPlacements({ title: 'Verschieben nach', subtitle: 'Die Bücher verlassen alle bisherigen Regale.', confirm: 'Verschieben' });
        if (!t) return;
        const sel = ids();
        const snap = snapshotAssignments(sel);
        await moveDocs(sel, '', t);
        toast('Verschoben', { action: { label: 'Widerrufen', onClick: () => restoreAssignments(sel, snap) } });
      }),
      btn('folderPlus', 'Auch einordnen', async () => {
        const t = await pickPlacements({ title: 'Auch einordnen in', confirm: 'Einordnen' });
        if (t) {
          await assignMany(ids(), t);
          toast('Eingeordnet – nichts wurde kopiert');
        }
      }),
      btn('tag', 'Tag', async () => {
        const name = await promptDialog({ title: `${n} ${n === 1 ? 'Buch' : 'Bücher'} taggen`, placeholder: 'Tag', confirm: 'Hinzufügen' });
        if (name) {
          for (const t of name.split(',')) await addTag(ids(), t);
          toast('Getaggt');
        }
      }),
      btn('trash', 'Löschen', async () => {
        const ok = await confirmDialog({ title: `${n} ${n === 1 ? 'Buch' : 'Bücher'} löschen?`, message: 'Mit Datei, Markierungen und Lesezeichen. Notizen bleiben erhalten. Das lässt sich nicht widerrufen.', confirm: 'Löschen', danger: true });
        if (ok) {
          await deleteDocuments(ids());
          ui.selected.clear();
          toast('Gelöscht');
        }
      }, true),
    ),
  );
}
