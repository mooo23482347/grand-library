// A room of the library: its directory of collections, its bookcases and the tools to tend them.

import { h, fromHTML, fold, isTouch } from '../util.js';
import {
  idx, state, childCollections, docsUnder, colPath, sortDocs, SORTS, deptStats, moveDocs, assignMany,
  removeFromScope, addTag, deleteDocuments, moveCollectionOrder, scopeLabel, noteTitle, restoreAssignments,
  snapshotAssignments, scopeMatches,
} from '../store.js';
import { kindLabel, noteKindLabel } from '../kinds.js';
import { emblem, icon } from '../ui/icons.js';
import { showMenu, confirmDialog, promptDialog, toast } from '../ui/modal.js';
import { pickPlacements } from '../ui/picker.js';
import { bookcase } from './shelf.js';
import { roomMenu } from './hall.js';
import { newCollectionDialog, editCollectionDialog, deleteCollectionDialog, relocateCollectionDialog } from './roomdialogs.js';
import { openAcquire } from '../import/acquire.js';

// UI state that survives redraws (per room).
const ui = new Map();
function uiFor(deptId) {
  if (!ui.has(deptId)) {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(`gl.room.${deptId}`) || '{}');
    } catch {
      /* private mode */
    }
    ui.set(deptId, { sort: saved.sort || 'author', mode: saved.mode || 'shelf', filter: '', selecting: false, selection: new Set() });
  }
  return ui.get(deptId);
}
function persist(deptId) {
  const u = uiFor(deptId);
  try {
    localStorage.setItem(`gl.room.${deptId}`, JSON.stringify({ sort: u.sort, mode: u.mode }));
  } catch {
    /* ignore */
  }
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

export function renderRoom([deptId, colId]) {
  const d = idx.dept.get(deptId);
  if (!d) return h('div', { class: 'not-found' }, h('h1', null, 'This room does not exist'), h('p', null, h('a', { href: '#/' }, 'Return to the hall')));
  const col = colId ? idx.col.get(colId) : null;
  if (colId && !col) return h('div', { class: 'not-found' }, h('h1', null, 'This collection no longer exists'), h('p', null, h('a', { href: `#/room/${deptId}` }, `Return to ${d.name}`)));
  const u = uiFor(deptId);
  const matcher = docMatcher(u.filter);

  // ----- bookcases
  const cases = [];
  if (!col) {
    const direct = docsOf(idx.docsDirect.get(d.id));
    const tops = childCollections(d.id);
    if (direct.length || !tops.length) {
      cases.push({
        title: 'General shelf',
        scope: `dd:${d.id}`,
        dropTarget: `dd:${d.id}`,
        docs: sortDocs(direct, u.sort),
        wide: !tops.length,
        emptyText: tops.length ? '' : 'This room awaits its first volumes.',
      });
    }
    for (const c of tops) {
      cases.push({
        title: c.name,
        sub: c.description,
        href: `#/room/${d.id}/${c.id}`,
        scope: `c:${c.id}`,
        dropTarget: `c:${c.id}`,
        docs: sortDocs(docsOf(docsUnder(c.id)), u.sort),
        emptyText: '',
      });
    }
  } else {
    const kids = childCollections(d.id, col.id);
    cases.push({
      title: col.name,
      sub: col.description,
      scope: `cc:${col.id}`,
      dropTarget: `c:${col.id}`,
      docs: sortDocs(docsOf(idx.docsInCol.get(col.id)), u.sort),
      wide: true,
      emptyText: kids.length ? 'No volumes stand directly on this shelf.' : 'This shelf is empty.',
    });
    for (const k of kids) {
      cases.push({
        title: k.name,
        sub: k.description,
        href: `#/room/${d.id}/${k.id}`,
        scope: `c:${k.id}`,
        dropTarget: `c:${k.id}`,
        docs: sortDocs(docsOf(docsUnder(k.id)), u.sort),
        emptyText: '',
      });
    }
  }

  const visibleKeys = new Set();
  cases.forEach((c) => c.docs.forEach((x) => visibleKeys.add(`${x.id}::${c.scope}`)));
  for (const k of [...u.selection]) if (!visibleKeys.has(k)) u.selection.delete(k);

  const main = h(
    'div',
    { class: `room-main mode-${u.mode}` },
    cases.map((c) => bookcase({ ...c, selection: u.selecting ? u.selection : null, filterFn: matcher, mode: u.mode })),
  );

  const stats = deptStats(d.id);
  const here = col ? docsUnder(col.id).size : stats.volumes;
  const filterCount = matcher ? cases.reduce((n, c) => n + c.docs.filter(matcher).length, 0) : null;

  const root = h(
    'div',
    { class: `room ${u.selecting ? 'is-selecting' : ''}`, style: { '--leather': d.leather || '#4b2e1a' } },
    roomHeader(d, col, u, here, filterCount),
    aisle(d, col),
    h('div', { class: 'room-layout' }, directory(d, col), h('div', { class: 'room-content' }, main, roomKnowledge(d, col))),
    u.selecting ? selectionBar(d, col, u) : null,
  );

  wireShelfEvents(root, d, col, u);
  return root;
}

function crumbs(d, col) {
  const parts = [h('a', { href: '#/' }, 'The Hall'), h('span', { class: 'crumb-sep' }, '›')];
  if (!col) parts.push(h('span', { 'aria-current': 'page' }, d.name));
  else {
    parts.push(h('a', { href: `#/room/${d.id}` }, d.name));
    colPath(col.id).forEach((c, i, arr) => {
      parts.push(h('span', { class: 'crumb-sep' }, '›'));
      parts.push(i === arr.length - 1 ? h('span', { 'aria-current': 'page' }, c.name) : h('a', { href: `#/room/${d.id}/${c.id}` }, c.name));
    });
  }
  return h('nav', { class: 'crumbs', 'aria-label': 'You are here' }, parts);
}

function roomHeader(d, col, u, count, filterCount) {
  const filter = h('input', {
    class: 'room-filter',
    type: 'search',
    placeholder: col ? `Search in ${col.name}…` : `Search in ${d.name}…`,
    value: u.filter,
    'aria-label': 'Search this room',
    'data-fk': `room-filter-${d.id}`,
  });
  filter.addEventListener('input', () => {
    u.filter = filter.value;
    applyFilter(filter.closest('.room'), u);
  });
  filter.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && filter.value.trim()) location.hash = `#/search?q=${encodeURIComponent(filter.value.trim())}&room=${d.id}`;
  });

  const sort = h(
    'select',
    { class: 'room-sort', 'aria-label': 'Arrange volumes by' },
    Object.entries(SORTS).map(([k, s]) => h('option', { value: k, selected: k === u.sort ? true : null }, `By ${s.label.toLowerCase()}`)),
  );
  sort.addEventListener('change', () => {
    u.sort = sort.value;
    persist(d.id);
    rerender();
  });

  const modeBtn = h('button', {
    type: 'button',
    class: 'icon-btn tool',
    title: u.mode === 'shelf' ? 'Show as index cards' : 'Show as shelves',
    'aria-label': u.mode === 'shelf' ? 'Show as index cards' : 'Show as shelves',
    html: icon(u.mode === 'shelf' ? 'grid' : 'shelf'),
    onClick: () => {
      u.mode = u.mode === 'shelf' ? 'index' : 'shelf';
      persist(d.id);
      rerender();
    },
  });
  const selectBtn = h(
    'button',
    {
      type: 'button',
      class: `btn btn-ghost tool ${u.selecting ? 'on' : ''}`,
      'aria-pressed': u.selecting ? 'true' : 'false',
      onClick: () => {
        u.selecting = !u.selecting;
        u.selection.clear();
        rerender();
      },
    },
    fromHTML(icon('select')),
    h('span', { class: 'tool-label' }, u.selecting ? 'Done' : 'Select'),
  );
  const acquire = h(
    'button',
    { type: 'button', class: 'btn btn-brass tool', onClick: () => openAcquire({ targets: [{ deptId: d.id, colId: col?.id || null }] }) },
    fromHTML(icon('acquire')),
    h('span', { class: 'tool-label' }, 'Acquire here'),
  );
  const more = h('button', {
    type: 'button',
    class: 'icon-btn tool',
    'aria-label': col ? `Options for ${col.name}` : `Options for ${d.name}`,
    html: icon('dots'),
    onClick: (e) => (col ? collectionMenu(e.currentTarget, col) : roomMenu(e.currentTarget, d)),
  });

  return h(
    'header',
    { class: 'room-head' },
    crumbs(d, col),
    h(
      'div',
      { class: 'room-title-row' },
      h('span', { class: 'room-medallion', html: emblem(d.emblem) }),
      h(
        'div',
        { class: 'room-titles' },
        h('h1', { class: 'room-title' }, col ? col.name : d.name),
        h('p', { class: 'room-sub' }, col ? col.description || `A collection in ${d.name}` : d.subtitle || ''),
        h(
          'p',
          { class: 'room-stats' },
          `${count} ${count === 1 ? 'volume' : 'volumes'}`,
          filterCount != null ? h('span', { class: 'filter-count' }, ` · ${filterCount} match`) : null,
        ),
      ),
    ),
    h('div', { class: 'room-tools' }, h('div', { class: 'filter-wrap' }, fromHTML(icon('search')), filter), sort, modeBtn, selectBtn, acquire, more),
  );
}

function applyFilter(root, u) {
  const m = docMatcher(u.filter);
  let n = 0;
  root.querySelectorAll('.spine[data-id], .index-card[data-id]').forEach((el) => {
    const d = idx.doc.get(el.dataset.id);
    const ok = !m || (d && m(d));
    el.classList.toggle('is-dim', !ok);
    if (ok && m) n++;
  });
  const fc = root.querySelector('.room-stats');
  if (fc) {
    fc.querySelector('.filter-count')?.remove();
    if (m) fc.append(h('span', { class: 'filter-count' }, ` · ${n} match`));
  }
}

function collectionMenu(anchor, c) {
  showMenu(anchor, [
    { label: 'Edit collection', icon: 'pen', onClick: () => editCollectionDialog(c) },
    { label: 'New sub-collection', icon: 'plus', onClick: () => newCollectionDialog(c.departmentId, c.id) },
    { label: 'Move collection to…', icon: 'move', onClick: () => relocateCollectionDialog(c) },
    { label: 'Move up in the directory', icon: 'folderUp', onClick: () => moveCollectionOrder(c.id, -1) },
    { label: 'Move down in the directory', icon: 'down', onClick: () => moveCollectionOrder(c.id, 1) },
    '-',
    { label: 'Remove collection…', icon: 'trash', danger: true, onClick: () => deleteCollectionDialog(c) },
  ]);
}

function directory(d, col) {
  const activeId = col?.id || null;
  const openPath = new Set(col ? colPath(col.id).map((c) => c.id) : []);
  const items = [];
  const walk = (parentId, depth) => {
    for (const c of childCollections(d.id, parentId)) {
      const n = docsUnder(c.id).size;
      const kids = childCollections(d.id, c.id);
      items.push(
        h(
          'a',
          {
            class: `dir-item ${c.id === activeId ? 'active' : ''}`,
            href: `#/room/${d.id}/${c.id}`,
            style: { '--depth': depth },
            'data-drop': `c:${c.id}`,
            'aria-current': c.id === activeId ? 'page' : null,
          },
          h('span', { class: 'dir-name' }, c.name),
          kids.length ? h('span', { class: 'dir-kids', title: `${kids.length} sub-collections` }, '❧') : null,
          h('span', { class: 'dir-count' }, String(n)),
        ),
      );
      if (depth < 1 || openPath.has(c.id)) walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  const total = deptStats(d.id).volumes;
  return h(
    'aside',
    { class: 'directory', 'aria-label': `Directory of ${d.name}` },
    h('h2', { class: 'dir-head' }, 'Directory'),
    h(
      'a',
      { class: `dir-item root ${!col ? 'active' : ''}`, href: `#/room/${d.id}`, 'data-drop': `dd:${d.id}`, 'aria-current': !col ? 'page' : null },
      h('span', { class: 'dir-name' }, `All of ${d.name}`),
      h('span', { class: 'dir-count' }, String(total)),
    ),
    items,
    h(
      'button',
      { type: 'button', class: 'dir-new', onClick: () => newCollectionDialog(d.id, col?.id || null) },
      fromHTML(icon('plus')),
      col ? `New collection in ${col.name}` : 'New collection',
    ),
    h('p', { class: 'dir-hint' }, isTouch() ? '' : 'Drag volumes onto a collection to move them. Hold Ctrl to shelve them in both places.'),
  );
}

/** The phone version of the directory: a row of aisle signs. */
function aisle(d, col) {
  const kids = childCollections(d.id, col?.id || null);
  const chips = [];
  if (col) {
    const up = col.parentId ? `#/room/${d.id}/${col.parentId}` : `#/room/${d.id}`;
    chips.push(h('a', { class: 'aisle-chip up', href: up }, fromHTML(icon('back')), col.parentId ? idx.col.get(col.parentId)?.name : d.name));
  }
  kids.forEach((c) => chips.push(h('a', { class: 'aisle-chip', href: `#/room/${d.id}/${c.id}` }, c.name, h('span', { class: 'aisle-count' }, String(docsUnder(c.id).size)))));
  chips.push(h('button', { type: 'button', class: 'aisle-chip new', onClick: () => newCollectionDialog(d.id, col?.id || null) }, fromHTML(icon('plus')), 'Collection'));
  return h('nav', { class: 'aisle', 'aria-label': 'Collections' }, chips);
}

function roomKnowledge(d, col) {
  const docIds = col ? docsUnder(col.id) : idx.docsInDept.get(d.id) || new Set();
  const colIds = col ? new Set([col.id]) : null;
  const notes = state.notes
    .filter((n) => (n.documentId && docIds.has(n.documentId)) || (col ? colIds.has(n.collectionId) : n.departmentId === d.id))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const q = col ? `col=${col.id}` : `room=${d.id}`;
  return h(
    'section',
    { class: 'room-knowledge' },
    h(
      'header',
      { class: 'rk-head' },
      h('h2', null, 'From the Scriptorium'),
      h('a', { class: 'rk-all', href: `#/scriptorium?${q}` }, notes.length ? `All ${notes.length} entries` : 'Open the Scriptorium'),
    ),
    notes.length
      ? h(
          'div',
          { class: 'rk-list' },
          notes.slice(0, 6).map((n) =>
            h(
              'a',
              { class: 'rk-note', href: `#/scriptorium/${n.id}` },
              h('span', { class: 'rk-kind' }, noteKindLabel(n.kind)),
              h('span', { class: 'rk-title' }, noteTitle(n)),
              n.documentId && idx.doc.get(n.documentId) ? h('span', { class: 'rk-src' }, `on ${idx.doc.get(n.documentId).title}`) : null,
            ),
          ),
        )
      : h('p', { class: 'rk-empty' }, `No summaries or thoughts belong to ${col ? col.name : d.name} yet. Write one from any volume’s catalogue card or while reading.`),
  );
}

// ---------------------------------------------------------------- selection

function selectedPairs(u) {
  return [...u.selection].map((k) => {
    const [docId, scope] = k.split('::');
    return { docId, scope };
  });
}

function groupByScope(pairs) {
  const m = new Map();
  for (const p of pairs) {
    if (!m.has(p.scope)) m.set(p.scope, []);
    m.get(p.scope).push(p.docId);
  }
  return m;
}

function selectionBar(d, col, u) {
  const pairs = selectedPairs(u);
  const n = new Set(pairs.map((p) => p.docId)).size;
  const docIds = [...new Set(pairs.map((p) => p.docId))];
  const disabled = n === 0;

  const withUndo = async (label, fn) => {
    const snap = snapshotAssignments(docIds);
    await fn();
    u.selection.clear();
    toast(label, { action: { label: 'Undo', onClick: () => restoreAssignments(docIds, snap) } });
  };

  return h(
    'div',
    { class: 'selection-bar', role: 'toolbar', 'aria-label': 'Selected volumes' },
    h('span', { class: 'sel-count' }, n ? `${n} ${n === 1 ? 'volume' : 'volumes'} chosen` : 'Tap volumes to choose them'),
    h('div', { class: 'sel-actions' },
      h('button', {
        type: 'button', class: 'btn btn-ghost', disabled,
        onClick: async () => {
          const t = await pickPlacements({ title: `Move ${n} ${n === 1 ? 'volume' : 'volumes'} to…`, subtitle: 'They leave their current shelf here and stand in the places you choose.', confirm: 'Move' });
          if (!t) return;
          await withUndo(`${n} ${n === 1 ? 'volume' : 'volumes'} moved.`, async () => {
            for (const [scope, ids] of groupByScope(pairs)) await moveDocs(ids, scope, t);
          });
        },
      }, fromHTML(icon('move')), h('span', null, 'Move to…')),
      h('button', {
        type: 'button', class: 'btn btn-ghost', disabled,
        onClick: async () => {
          const t = await pickPlacements({ title: `Also shelve ${n} ${n === 1 ? 'volume' : 'volumes'} in…`, confirm: 'Shelve also here' });
          if (!t) return;
          await withUndo('Shelved in the additional places. Nothing was copied.', () => assignMany(docIds, t));
        },
      }, fromHTML(icon('copy')), h('span', null, 'Also shelve in…')),
      h('button', {
        type: 'button', class: 'btn btn-ghost', disabled,
        onClick: async () => {
          const orphaned = docIds.filter((id) => (idx.asgByDoc.get(id) || []).every((a) => pairs.some((p) => p.docId === id && scopeMatches(a, p.scope))));
          await withUndo(
            orphaned.length ? `Taken off the shelf. ${orphaned.length} now wait on the returns table.` : 'Taken off this shelf. They still stand elsewhere.',
            async () => {
              for (const [scope, ids] of groupByScope(pairs)) await removeFromScope(ids, scope);
            },
          );
        },
      }, fromHTML(icon('minus')), h('span', null, 'Take off this shelf')),
      h('button', {
        type: 'button', class: 'btn btn-ghost', disabled,
        onClick: async () => {
          const name = await promptDialog({ title: `Tag ${n} ${n === 1 ? 'volume' : 'volumes'}`, label: 'Tag', placeholder: 'e.g. Stoicism, exam, to read', confirm: 'Add tag' });
          if (!name) return;
          for (const t of name.split(',')) await addTag(docIds, t);
          toast('Tagged.');
        },
      }, fromHTML(icon('tag')), h('span', null, 'Tag…')),
      h('button', {
        type: 'button', class: 'btn btn-ghost danger', disabled,
        onClick: async () => {
          const ok = await confirmDialog({
            title: `Delete ${n} ${n === 1 ? 'volume' : 'volumes'} from the library?`,
            message: 'They are removed from every room, together with their files, highlights and bookmarks. Your notes about them stay in the Scriptorium. This cannot be undone.',
            confirm: 'Delete for good',
            danger: true,
          });
          if (!ok) return;
          await deleteDocuments(docIds);
          u.selection.clear();
          toast(`${n} ${n === 1 ? 'volume' : 'volumes'} deleted.`);
        },
      }, fromHTML(icon('trash')), h('span', null, 'Delete…')),
    ),
    h('button', { type: 'button', class: 'btn btn-primary sel-done', onClick: () => { u.selecting = false; u.selection.clear(); rerender(); } }, 'Done'),
  );
}

// ---------------------------------------------------------------- events

let rerender = () => {};
export function setRoomRerender(fn) {
  rerender = fn;
}

function targetFromDrop(spec) {
  if (!spec) return null;
  if (spec.startsWith('dd:')) return { deptId: spec.slice(3), colId: null };
  if (spec.startsWith('c:')) {
    const c = idx.col.get(spec.slice(2));
    return c ? { deptId: c.departmentId, colId: c.id } : null;
  }
  return null;
}

function wireShelfEvents(root, d, col, u) {
  root.addEventListener('click', (e) => {
    const el = e.target.closest('.spine[data-id], .index-card[data-id]');
    if (!el || !root.contains(el)) return;
    e.preventDefault();
    const key = `${el.dataset.id}::${el.dataset.scope}`;
    if (u.selecting) {
      if (u.selection.has(key)) u.selection.delete(key);
      else u.selection.add(key);
      rerender();
      return;
    }
    const base = location.hash.split('?')[0];
    location.hash = `${base}?doc=${encodeURIComponent(el.dataset.id)}&in=${encodeURIComponent(el.dataset.scope)}`;
  });

  // Long-press on touch starts selecting.
  let pressTimer = null;
  root.addEventListener('touchstart', (e) => {
    const el = e.target.closest('.spine[data-id], .index-card[data-id]');
    if (!el || u.selecting) return;
    pressTimer = setTimeout(() => {
      u.selecting = true;
      u.selection.add(`${el.dataset.id}::${el.dataset.scope}`);
      navigator.vibrate?.(12);
      rerender();
    }, 550);
  }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach((t) => root.addEventListener(t, () => clearTimeout(pressTimer), { passive: true }));

  // Drag volumes onto the directory or another bookcase.
  root.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.spine[data-id], .index-card[data-id]');
    if (!el) return;
    const key = `${el.dataset.id}::${el.dataset.scope}`;
    const pairs = u.selecting && u.selection.has(key) ? selectedPairs(u) : [{ docId: el.dataset.id, scope: el.dataset.scope }];
    e.dataTransfer.setData('application/x-grand-library', JSON.stringify(pairs));
    e.dataTransfer.setData('text/plain', pairs.map((p) => idx.doc.get(p.docId)?.title).join('\n'));
    e.dataTransfer.effectAllowed = 'copyMove';
    root.classList.add('is-dragging');
  });
  root.addEventListener('dragend', () => {
    root.classList.remove('is-dragging');
    root.querySelectorAll('.drop-over').forEach((x) => x.classList.remove('drop-over'));
  });
  root.addEventListener('dragover', (e) => {
    const t = e.target.closest('[data-drop]');
    if (!t || !e.dataTransfer.types.includes('application/x-grand-library')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.ctrlKey || e.altKey ? 'copy' : 'move';
    root.querySelectorAll('.drop-over').forEach((x) => x !== t && x.classList.remove('drop-over'));
    t.classList.add('drop-over');
  });
  root.addEventListener('dragleave', (e) => {
    const t = e.target.closest('[data-drop]');
    if (t && !t.contains(e.relatedTarget)) t.classList.remove('drop-over');
  });
  root.addEventListener('drop', async (e) => {
    const t = e.target.closest('[data-drop]');
    const raw = e.dataTransfer.getData('application/x-grand-library');
    if (!t || !raw) return;
    e.preventDefault();
    t.classList.remove('drop-over');
    const target = targetFromDrop(t.dataset.drop);
    if (!target) return;
    const pairs = JSON.parse(raw);
    const docIds = [...new Set(pairs.map((p) => p.docId))];
    const snap = snapshotAssignments(docIds);
    const copy = e.ctrlKey || e.altKey;
    if (copy) await assignMany(docIds, [target]);
    else for (const [scope, ids] of groupByScope(pairs)) await moveDocs(ids, scope, [target]);
    u.selection.clear();
    const where = scopeLabel(target.colId ? `cc:${target.colId}` : `dd:${target.deptId}`);
    toast(`${docIds.length} ${docIds.length === 1 ? 'volume' : 'volumes'} ${copy ? 'also shelved in' : 'moved to'} ${where}.`, {
      action: { label: 'Undo', onClick: () => restoreAssignments(docIds, snap) },
    });
  });
}
