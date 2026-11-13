// The Grand Library — application shell: routes, the top bar, the phone's tab bar.

import { openDb } from './db.js';
import { loadAll, subscribe, idx, docHref, state } from './store.js';
import { h, fromHTML, debounce, isTouch } from './util.js';
import { icon } from './ui/icons.js';
import { showMenu, toast } from './ui/modal.js';
import { renderHall } from './views/hall.js';
import { renderRoom, setRoomRerender } from './views/room.js';
import { renderSearch } from './views/searchview.js';
import { renderCatalogue, setCatalogueRerender } from './views/catalogue.js';
import { renderScriptorium, setScriptoriumRerender } from './views/scriptorium.js';
import { renderSettings } from './views/settings.js';
import { renderUnshelved, renderTag } from './views/misc.js';
import { openDocPanel, closeDocPanel, refreshDocPanel } from './views/docpanel.js';
import { openReader, closeReader, isReaderOpen, setReaderBack } from './reader/reader.js';
import { openAcquire } from './import/acquire.js';
import { enqueueMissing } from './import/indexer.js';
import { searchLibrary } from './search.js';
import { kindLabel } from './kinds.js';
import { initSync, onSyncState } from './sync.js';

const ROUTES = [
  [/^\/?$/, 'hall'],
  [/^\/room\/([^/]+)(?:\/([^/]+))?\/?$/, 'room'],
  [/^\/read\/([^/]+)\/?$/, 'read'],
  [/^\/search\/?$/, 'search'],
  [/^\/scriptorium(?:\/([^/]+))?\/?$/, 'scriptorium'],
  [/^\/catalogue\/?$/, 'catalogue'],
  [/^\/unshelved\/?$/, 'unshelved'],
  [/^\/tag\/([^/]+)\/?$/, 'tag'],
  [/^\/settings\/?$/, 'settings'],
];
const VIEWS = {
  hall: renderHall,
  room: renderRoom,
  search: renderSearch,
  catalogue: renderCatalogue,
  scriptorium: renderScriptorium,
  settings: renderSettings,
  unshelved: renderUnshelved,
  tag: renderTag,
};
const NAV_OF = { hall: 'hall', room: 'hall', unshelved: 'hall', tag: 'hall', search: 'search', scriptorium: 'scriptorium', catalogue: 'catalogue', settings: 'settings', read: 'hall' };
const TITLES = { search: 'Card Catalogue', scriptorium: 'Scriptorium', catalogue: 'Ledger', settings: 'Curator’s Office', unshelved: 'Returns table' };

const viewEl = () => document.getElementById('view');
let current = { key: null, route: null };
let stale = false;
const scrollMemory = new Map();

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const qi = raw.indexOf('?');
  const path = qi >= 0 ? raw.slice(0, qi) : raw;
  const query = Object.fromEntries(new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : ''));
  for (const [re, name] of ROUTES) {
    const m = path.match(re);
    if (m) return { name, params: m.slice(1).map((x) => (x ? decodeURIComponent(x) : x)), query, path };
  }
  return { name: 'hall', params: [], query: {}, path: '/' };
}

function viewKey(r) {
  const q = { ...r.query };
  delete q.doc;
  delete q.in;
  const rest = new URLSearchParams(q).toString();
  return `${r.name}:${r.path}${rest ? `?${rest}` : ''}`;
}

function drawView(r) {
  const fn = VIEWS[r.name] || renderHall;
  const active = document.activeElement;
  const fk = active?.dataset?.fk;
  const sel = fk && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  let el;
  try {
    el = fn(r.params, r.query);
  } catch (e) {
    console.error(e);
    el = h('div', { class: 'not-found' }, h('h1', null, 'Something went wrong in this room'), h('p', null, String(e.message || e)), h('p', null, h('a', { href: '#/' }, 'Return to the hall')));
  }
  viewEl().replaceChildren(el);
  document.body.dataset.view = r.name;
  if (fk) {
    const again = viewEl().querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (again) {
      again.focus({ preventScroll: true });
      if (sel) try { again.setSelectionRange(sel[0], sel[1]); } catch { /* not a text field */ }
    }
  }
  updateTitle(r);
}

function updateTitle(r) {
  let t = TITLES[r.name] || '';
  if (r.name === 'room') {
    const d = idx.dept.get(r.params[0]);
    const c = r.params[1] ? idx.col.get(r.params[1]) : null;
    t = c ? `${c.name} · ${d?.name}` : d?.name || '';
  }
  if (r.name === 'tag') t = idx.tag.get(r.params[0])?.name || 'Tag';
  if (r.name === 'read') t = idx.doc.get(r.params[0])?.title || '';
  document.title = t ? `${t} — The Grand Library` : 'The Grand Library';
}

function markNav(name) {
  const key = NAV_OF[name];
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === key;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

async function route() {
  const r = parseHash();
  markNav(r.name);
  if (r.name === 'read') {
    closeDocPanel();
    if (!current.key) {
      const bg = parseHash('#/');
      drawView(bg);
      current = { key: viewKey(bg), route: bg };
    }
    updateTitle(r);
    await openReader(r.params[0], r.query);
    return;
  }
  if (isReaderOpen()) closeReader();
  setReaderBack(location.hash);
  const key = viewKey(r);
  if (key !== current.key || stale) {
    if (current.key) scrollMemory.set(current.key, window.scrollY);
    const sameView = key === current.key;
    const y = sameView ? window.scrollY : scrollMemory.get(key) || 0;
    current = { key, route: r };
    stale = false;
    drawView(r);
    window.scrollTo(0, y);
    if (!sameView) viewEl().focus({ preventScroll: true });
  } else current.route = r;
  if (r.query.doc) {
    if (!openDocPanel(r.query.doc, r.query.in || '')) {
      toast('This volume is no longer in the library.');
      history.replaceState(null, '', location.hash.split('?')[0]);
    }
  } else closeDocPanel();
}

function redraw() {
  if (!current.route) return;
  if (isReaderOpen()) {
    stale = true;
    return;
  }
  const y = window.scrollY;
  drawView(current.route);
  window.scrollTo(0, y);
}

// ---------------------------------------------------------------- shell

function contextTargets() {
  const r = current.route;
  if (r?.name === 'room' && idx.dept.has(r.params[0])) return [{ deptId: r.params[0], colId: r.params[1] && idx.col.has(r.params[1]) ? r.params[1] : null }];
  return [];
}

function buildShell() {
  const quick = h('div', { class: 'quick', hidden: true, role: 'listbox' });
  const input = h('input', { type: 'search', class: 'top-search', placeholder: 'Search the whole library…', 'aria-label': 'Search the whole library', autocomplete: 'off' });
  const closeQuick = () => (quick.hidden = true);
  const showQuick = debounce(() => {
    const q = input.value.trim();
    if (!q) return closeQuick();
    const r = searchLibrary(q);
    quick.replaceChildren(
      ...r.places.slice(0, 3).map((p) => h('a', { class: 'quick-item place', href: p.href, onClick: done }, h('span', { class: 'quick-kind' }, p.type === 'room' ? 'Room' : 'Collection'), h('span', { class: 'quick-title' }, p.label))),
      ...r.docs.slice(0, 7).map(({ doc }) => h('a', { class: 'quick-item', href: docHref(doc.id), onClick: done }, h('span', { class: 'quick-kind' }, kindLabel(doc.kind)), h('span', { class: 'quick-title' }, doc.title), doc.author ? h('span', { class: 'quick-sub' }, doc.author) : null)),
      ...r.notes.slice(0, 2).map(({ note }) => h('a', { class: 'quick-item', href: `#/scriptorium/${note.id}`, onClick: done }, h('span', { class: 'quick-kind' }, 'Scriptorium'), h('span', { class: 'quick-title' }, note.title || (note.body || note.quote || '').slice(0, 60)))),
      h('a', { class: 'quick-all', href: `#/search?q=${encodeURIComponent(q)}`, onClick: done }, `Search everything, including the full text, for “${q}”`),
    );
    quick.hidden = false;
  }, 120);
  function done() {
    input.value = '';
    closeQuick();
    input.blur();
  }
  input.addEventListener('input', showQuick);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      location.hash = `#/search?q=${encodeURIComponent(input.value.trim())}`;
      done();
    } else if (e.key === 'Escape') {
      done();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      quick.querySelector('a')?.focus();
    }
  });
  quick.addEventListener('keydown', (e) => {
    const items = [...quick.querySelectorAll('a')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) input.focus(); else items[i - 1].focus(); }
    if (e.key === 'Escape') done();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!quick.hidden && !e.target.closest('.top-search-wrap')) closeQuick();
  });

  const syncInd = h('a', { class: 'sync-ind', href: '#/settings', title: 'Sync', hidden: true }, h('span', { class: 'sync-dot' }), h('span', { class: 'sync-text' }, ''));
  onSyncState((s) => {
    syncInd.hidden = !s.configured;
    syncInd.className = `sync-ind s-${s.status}`;
    const text = { off: 'Not signed in', idle: 'Synced', syncing: 'Syncing', offline: 'Offline', error: 'Sync paused' }[s.status] || '';
    syncInd.querySelector('.sync-text').textContent = text;
    syncInd.title = s.error || s.warning || text;
  });

  const top = h(
    'header',
    { class: 'topbar' },
    h('a', { class: 'brand', href: '#/', 'aria-label': 'The Grand Library, to the hall' }, h('span', { class: 'brand-mark', html: icon('arch') }), h('span', { class: 'brand-name' }, 'The Grand Library')),
    h('nav', { class: 'mainnav', 'aria-label': 'Main' },
      h('a', { href: '#/', 'data-nav': 'hall' }, 'Hall'),
      h('a', { href: '#/scriptorium', 'data-nav': 'scriptorium' }, 'Scriptorium'),
      h('a', { href: '#/catalogue', 'data-nav': 'catalogue' }, 'Ledger'),
    ),
    h('div', { class: 'top-search-wrap' }, h('span', { class: 'top-search-icon', html: icon('search') }), input, h('kbd', { class: 'kbd-hint' }, '/'), quick),
    h('button', { type: 'button', class: 'btn btn-brass top-acquire', onClick: () => openAcquire({ targets: contextTargets() }) }, fromHTML(icon('acquire')), h('span', null, 'Acquire')),
    syncInd,
    h('a', { class: 'icon-btn top-office', href: '#/settings', 'data-nav': 'settings', 'aria-label': 'Curator’s office: sync, backup, tags', title: 'Curator’s office', html: icon('key') }),
  );

  const tab = (nav, href, ic, label) => h('a', { class: 'tab-item', href, 'data-nav': nav }, h('span', { class: 'tab-icon', html: icon(ic) }), h('span', { class: 'tab-label' }, label));
  const tabbar = h(
    'nav',
    { class: 'tabbar', 'aria-label': 'Main' },
    tab('hall', '#/', 'arch', 'Hall'),
    tab('search', '#/search', 'search', 'Search'),
    h('button', { type: 'button', class: 'tab-item tab-acquire', onClick: () => openAcquire({ targets: contextTargets() }) }, h('span', { class: 'tab-icon', html: icon('plus') }), h('span', { class: 'tab-label' }, 'Acquire')),
    tab('scriptorium', '#/scriptorium', 'quill', 'Scriptorium'),
    h('button', {
      type: 'button',
      class: 'tab-item',
      'data-nav': 'more',
      onClick: (e) =>
        showMenu(e.currentTarget, [
          { label: 'The Ledger', icon: 'ledger', onClick: () => (location.hash = '#/catalogue') },
          { label: 'The returns table', icon: 'book', hint: idx.unshelved.length ? String(idx.unshelved.length) : '', onClick: () => (location.hash = '#/unshelved') },
          { label: 'Curator’s office', icon: 'key', onClick: () => (location.hash = '#/settings') },
        ]),
    }, h('span', { class: 'tab-icon', html: icon('dots') }), h('span', { class: 'tab-label' }, 'More')),
  );

  const app = document.getElementById('app');
  app.prepend(top);
  app.append(tabbar);

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]') && !isReaderOpen()) {
      e.preventDefault();
      if (isTouch() || innerWidth < 760) location.hash = '#/search';
      else input.focus();
    }
    if (e.key === 'Escape' && !isReaderOpen() && location.hash.includes('doc=') && !document.querySelector('.modal-wrap, .menu')) {
      location.hash = location.hash.split('?')[0];
    }
  });

  // Drop files anywhere to acquire them.
  let depth = 0;
  const overlay = h('div', { class: 'drop-overlay', hidden: true }, h('div', { class: 'drop-card' }, h('span', { html: icon('acquire') }), h('p', null, 'Let go to bring these files into the library')));
  document.body.append(overlay);
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || document.querySelector('.acquire-modal')) return;
    depth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.hidden = true;
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    depth = 0;
    overlay.hidden = true;
    if (e.target.closest('.acquire-modal')) return;
    e.preventDefault();
    if (e.dataTransfer.files.length) openAcquire({ files: e.dataTransfer.files, targets: contextTargets() });
  });
}

// ---------------------------------------------------------------- start

async function start() {
  try {
    await openDb();
  } catch (e) {
    viewEl().replaceChildren(h('div', { class: 'not-found' }, h('h1', null, 'The library could not be opened'), h('p', null, 'This browser does not allow the library to store its data here (private mode?).'), h('p', { class: 'muted' }, String(e.message || e))));
    return;
  }
  await loadAll();
  buildShell();
  setRoomRerender(redraw);
  setCatalogueRerender(redraw);
  setScriptoriumRerender(redraw);
  subscribe((tables) => {
    const t = [...tables];
    if (t.length && t.every((x) => x === 'progress') && current.route?.name !== 'hall') return;
    redraw();
    refreshDocPanel();
  });
  window.addEventListener('hashchange', route);
  await route();
  document.documentElement.classList.add('ready');
  initSync();
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => enqueueMissing());

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker', e));
  }
  window.__gl = { state, idx };
}

start();
