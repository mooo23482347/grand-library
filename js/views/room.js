// A shelf (data: department) or one of its collections: collections, search, sorting, a grid of books,
// and a selection mode for moving many books at once.

import { h, fromHTML, fold } from '../util.js';
import {
  idx, childCollections, docsUnder, colPath, sortDocs, SORTS, moveDocs, assignMany, removeFromScope, addTag,
  deleteDocuments, restoreAssignments, snapshotAssignments, scopeMatches,
} from '../store.js';
import { kindLabel } from '../kinds.js';
import { icon } from '../ui/icons.js';
import { pageHeader, navButton, searchField, group, cell, emptyState } from '../ui/controls.js';
import { showMenu, confirmDialog, promptDialog, toast } from '../ui/modal.js';
import { pickPlacements } from '../ui/picker.js';
import { bookEl } from './covers.js';
import { editRoomDialog, newCollectionDialog, editCollectionDialog, deleteCollectionDialog, relocateCollectionDialog } from './roomdialogs.js';
import { openAcquire } from '../import/acquire.js';

const ui = new Map();
function uiFor(key) {
  if (!ui.has(key)) {
    let sort = 'author';
    try {
      sort = localStorage.getItem('buecher.sort') || 'author';
    } catch {
      /* private mode */
    }
    ui.set(key, { q: '', sort, selecting: false, selection: new Set() });
  }
  return ui.get(key);
}

let rerender = () => {};
export function setRoomRerender(fn) {
  rerender = fn;
}

export function docMatcher(q) {
  const tokens = fold(q).split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  return (d) => {
    const hay = fold([d.title, d.author, kindLabel(d.kind), d.year, d.publisher, (idx.tagsByDoc.get(d.id) || []).map((t) => t.name).join(' ')].join(' '));
    return tokens.every((t) => hay.includes(t));
  };
}

const docsOf = (ids) => [...(ids || [])].map((id) => idx.doc.get(id)).filter(Boolean);
export const GENERAL = 'allgemein';

export function renderRoom([deptId, colId]) {
  const d = idx.dept.get(deptId);
  if (!d) return notFound('Dieses Regal gibt es nicht mehr.');
  const general = colId === GENERAL;
  const col = colId && !general ? idx.col.get(colId) : null;
  if (colId && !general && !col) return notFound('Diese Sammlung gibt es nicht mehr.', `#/room/${deptId}`);

  const key = `${deptId}/${colId || ''}`;
  const u = uiFor(key);
  const scope = general ? `dd:${d.id}` : col ? `c:${col.id}` : `d:${d.id}`;
  const title = general ? 'Allgemein' : col ? col.name : d.name;
  const parent = col ? (col.parentId ? { href: `#/room/${d.id}/${col.parentId}`, label: idx.col.get(col.parentId)?.name } : { href: `#/room/${d.id}`, label: d.name }) : general ? { href: `#/room/${d.id}`, label: d.name } : { href: '#/', label: 'Bücher' };

  const docs = sortDocs(docsOf(general ? idx.docsDirect.get(d.id) : col ? docsUnder(col.id) : idx.docsInDept.get(d.id)), u.sort);
  const matcher = docMatcher(u.q);
  for (const k of [...u.selection]) if (!idx.doc.has(k)) u.selection.delete(k);

  const actions = u.selecting
    ? [navButton('Fertig', () => { u.selecting = false; u.selection.clear(); rerender(); }, { strong: true })]
    : [
        navButton('Auswählen', () => { u.selecting = true; rerender(); }),
        navButton('Mehr', (e) => moreMenu(e.currentTarget, d, col, general, u), { icon: 'dots', aria: 'Mehr' }),
      ];

  const page = h('div', { class: `page room ${u.selecting ? 'selecting' : ''}`, style: { '--shelf-color': d.leather || 'var(--accent)' } }, pageHeader({ title, back: parent, actions, sub: col || general ? [d.name, ...(col ? colPath(col.id).slice(0, -1).map((c) => c.name) : [])].join(' › ') : null }));

  const grid = h('div', { class: 'book-grid' });
  const drawGrid = () => {
    const m = docMatcher(u.q);
    const shown = m ? docs.filter(m) : docs;
    grid.replaceChildren(...shown.map((x) => bookEl(x, { scope, selecting: u.selecting, selected: u.selection.has(x.id), showTitle: true, progress: true })));
    countEl.textContent = m ? `${shown.length} von ${docs.length}` : `${docs.length} ${docs.length === 1 ? 'Buch' : 'Bücher'}`;
  };
  const countEl = h('span', { class: 'count' });

  page.append(searchField({ placeholder: `In ${title} suchen`, value: u.q, fk: `room-${key}`, onInput: (v) => { u.q = v; drawGrid(); } }));

  // collections at this level
  if (!general) {
    const kids = childCollections(d.id, col?.id || null);
    const directCount = !col ? idx.docsDirect.get(d.id)?.size || 0 : 0;
    const rows = [];
    if (!col && (kids.length || directCount)) rows.push(cell({ title: 'Allgemein', sub: 'Direkt im Regal, ohne Sammlung', detail: String(directCount), href: `#/room/${d.id}/${GENERAL}`, icon: 'inbox', tint: 'var(--text-3)' }));
    for (const c of kids) rows.push(cell({ title: c.name, detail: String(docsUnder(c.id).size), href: `#/room/${d.id}/${c.id}`, icon: 'folder', tint: d.leather || 'var(--accent)' }));
    rows.push(cell({ title: col ? 'Neue Unter-Sammlung' : 'Neue Sammlung', accent: true, onClick: () => newCollectionDialog(d.id, col?.id || null) }));
    page.append(group({ head: 'Sammlungen', rows, icons: true }));
  }

  page.append(
    h('div', { class: 'grid-head' }, h('h2', { class: 'section-title' }, col || general ? 'Bücher' : 'Alle Bücher', ' ', countEl), h('button', { type: 'button', class: 'btn small', onClick: (e) => sortMenu(e.currentTarget, u) }, fromHTML(icon('sort')), SORTS[u.sort]?.label || 'Sortieren')),
  );
  if (docs.length) {
    page.append(grid);
    drawGrid();
  } else {
    page.append(emptyState({ icon: 'library', title: 'Noch keine Bücher', text: 'Füge ein Buch hinzu oder verschiebe Bücher aus anderen Regalen hierher.', action: h('button', { type: 'button', class: 'btn tinted', onClick: () => openAcquire({ targets: [{ deptId: d.id, colId: col?.id || null }] }) }, fromHTML(icon('plus')), 'Hinzufügen') }));
  }

  if (u.selecting) page.append(selectionBar(d, col, scope, u, docs));
  wire(page, u, scope);
  return page;
}

function notFound(text, href = '#/') {
  return h('div', { class: 'page' }, pageHeader({ title: 'Nicht gefunden', back: { href, label: 'Zurück' } }), emptyState({ icon: 'library', title: text }));
}

function sortMenu(anchor, u) {
  showMenu(anchor, Object.entries(SORTS).map(([k, s]) => ({ label: s.label, icon: k === u.sort ? 'check' : null, onClick: () => { u.sort = k; try { localStorage.setItem('buecher.sort', k); } catch { /* */ } rerender(); } })), { title: 'Sortieren nach' });
}

function moreMenu(anchor, d, col, general, u) {
  const items = [
    { label: 'Hinzufügen …', icon: 'plus', onClick: () => openAcquire({ targets: [{ deptId: d.id, colId: col?.id || null }] }) },
    { label: 'Sortieren …', icon: 'sort', onClick: () => sortMenu(anchor, u) },
    '-',
  ];
  if (col) {
    items.push(
      { label: 'Sammlung umbenennen', icon: 'pencil', onClick: () => editCollectionDialog(col) },
      { label: 'Neue Unter-Sammlung', icon: 'folderPlus', onClick: () => newCollectionDialog(d.id, col.id) },
      { label: 'Sammlung verschieben …', icon: 'move', onClick: () => relocateCollectionDialog(col) },
      { label: 'Sammlung entfernen', icon: 'trash', danger: true, onClick: () => deleteCollectionDialog(col) },
    );
  } else if (!general) {
    items.push({ label: 'Regal bearbeiten', icon: 'pencil', onClick: () => editRoomDialog(d) }, { label: 'Neue Sammlung', icon: 'folderPlus', onClick: () => newCollectionDialog(d.id, null) });
  }
  showMenu(anchor, items);
}

function selectionBar(d, col, scope, u, docs) {
  const ids = () => [...u.selection];
  const n = u.selection.size;
  const withUndo = async (msg, fn) => {
    const sel = ids();
    const snap = snapshotAssignments(sel);
    await fn(sel);
    u.selection.clear();
    toast(msg, { action: { label: 'Widerrufen', onClick: () => restoreAssignments(sel, snap) } });
  };
  const btn = (ic, label, fn, danger = false) => h('button', { type: 'button', class: `bar-btn ${danger ? 'danger' : ''}`, disabled: !n || null, onClick: fn }, fromHTML(icon(ic)), h('span', null, label));
  const all = h('button', { type: 'button', class: 'btn small', onClick: () => { if (u.selection.size === docs.length) u.selection.clear(); else docs.forEach((x) => u.selection.add(x.id)); rerender(); } }, u.selection.size === docs.length && docs.length ? 'Keine' : 'Alle');
  return h(
    'div',
    { class: 'select-bar', role: 'toolbar', 'aria-label': 'Ausgewählte Bücher' },
    h('div', { class: 'select-info' }, all, h('span', null, n ? `${n} ausgewählt` : 'Bücher antippen')),
    h(
      'div',
      { class: 'select-actions' },
      btn('move', 'Verschieben', async () => {
        const t = await pickPlacements({ title: 'Verschieben nach', confirm: 'Verschieben' });
        if (t) await withUndo(`${n} ${n === 1 ? 'Buch' : 'Bücher'} verschoben`, (sel) => moveDocs(sel, scope, t));
      }),
      btn('folderPlus', 'Auch einordnen', async () => {
        const t = await pickPlacements({ title: 'Auch einordnen in', confirm: 'Einordnen' });
        if (t) await withUndo('Zusätzlich eingeordnet – nichts wurde kopiert', (sel) => assignMany(sel, t));
      }),
      btn('minus', 'Entfernen', async () => {
        const orphaned = ids().filter((id) => (idx.asgByDoc.get(id) || []).every((a) => scopeMatches(a, scope))).length;
        await withUndo(orphaned ? `Entfernt – ${orphaned} jetzt „Ohne Regal“` : 'Aus diesem Regal entfernt', (sel) => removeFromScope(sel, scope));
      }),
      btn('tag', 'Tag', async () => {
        const name = await promptDialog({ title: `${n} ${n === 1 ? 'Buch' : 'Bücher'} taggen`, placeholder: 'z. B. Stoa, Prüfung', confirm: 'Hinzufügen' });
        if (!name) return;
        for (const t of name.split(',')) await addTag(ids(), t);
        toast('Getaggt');
      }),
      btn('trash', 'Löschen', async () => {
        const ok = await confirmDialog({ title: `${n} ${n === 1 ? 'Buch' : 'Bücher'} löschen?`, message: 'Sie verschwinden aus allen Regalen, mit Datei, Markierungen und Lesezeichen. Deine Notizen bleiben erhalten. Das lässt sich nicht widerrufen.', confirm: 'Löschen', danger: true });
        if (!ok) return;
        await deleteDocuments(ids());
        u.selection.clear();
        toast('Gelöscht');
      }, true),
    ),
  );
}

function wire(page, u, scope) {
  page.addEventListener('click', (e) => {
    const b = e.target.closest('.book[data-id]');
    if (!b || !page.contains(b)) return;
    e.preventDefault();
    if (u.selecting) {
      if (u.selection.has(b.dataset.id)) u.selection.delete(b.dataset.id);
      else u.selection.add(b.dataset.id);
      rerender();
      return;
    }
    openBook(b.dataset.id, scope);
  });
  // Long press starts selecting.
  let timer = null;
  page.addEventListener('touchstart', (e) => {
    const b = e.target.closest('.book[data-id]');
    if (!b || u.selecting) return;
    timer = setTimeout(() => {
      u.selecting = true;
      u.selection.add(b.dataset.id);
      navigator.vibrate?.(10);
      rerender();
    }, 520);
  }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach((t) => page.addEventListener(t, () => clearTimeout(timer), { passive: true }));
  page.addEventListener('dragstart', (e) => {
    const b = e.target.closest('.book[data-id]');
    if (!b) return;
    const ids = u.selecting && u.selection.has(b.dataset.id) ? [...u.selection] : [b.dataset.id];
    e.dataTransfer.setData('application/x-buecher', JSON.stringify({ ids, scope }));
    e.dataTransfer.effectAllowed = 'copyMove';
  });
}

export function openBook(id, scope = '') {
  const base = location.hash.split('?')[0] || '#/';
  location.hash = `${base}?doc=${encodeURIComponent(id)}${scope ? `&in=${encodeURIComponent(scope)}` : ''}`;
}
