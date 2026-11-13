// Bücher — app shell: routes, the sidebar (desktop), the tab bar (phone).
// Routes are unchanged from earlier versions so bookmarks and the home-screen app keep working.

import { openDb } from './db.js';
import { loadAll, subscribe, idx, state, moveDocs, assignMany, snapshotAssignments, restoreAssignments } from './store.js';
import { h, fromHTML, isTouch } from './util.js';
import { icon } from './ui/icons.js';
import { showMenu, toast } from './ui/modal.js';
import { watchLargeTitles } from './ui/controls.js';
import { applyTheme } from './theme.js';
import { renderHome, setHomeRerender } from './views/home.js';
import { renderRoom, setRoomRerender } from './views/room.js';
import { renderSearch } from './views/searchview.js';
import { renderCatalogue, setCatalogueRerender } from './views/catalogue.js';
import { renderNotes, setNotesRerender } from './views/notes.js';
import { renderSettings, setSettingsRerender } from './views/settings.js';
import { renderUnshelved, renderTag } from './views/misc.js';
import { openDocPanel, closeDocPanel, refreshDocPanel } from './views/docpanel.js';
import { syncBadge } from './views/syncbadge.js';
import { openReader, closeReader, isReaderOpen, setReaderBack } from './reader/reader.js';
import { loadReaderPrefs } from './reader/prefs.js';
import { openAcquire } from './import/acquire.js';
import { enqueueMissing } from './import/indexer.js';
import { initSync, onSyncState } from './sync.js';

const ROUTES = [
  [/^\/?$/, 'home'],
  [/^\/room\/([^/]+)(?:\/([^/]+))?\/?$/, 'room'],
  [/^\/read\/([^/]+)\/?$/, 'read'],
  [/^\/search\/?$/, 'search'],
  [/^\/scriptorium(?:\/([^/]+))?\/?$/, 'notes'],
  [/^\/catalogue\/?$/, 'catalogue'],
  [/^\/unshelved\/?$/, 'unshelved'],
  [/^\/tag\/([^/]+)\/?$/, 'tag'],
  [/^\/settings\/?$/, 'settings'],
];
const VIEWS = { home: renderHome, room: renderRoom, search: renderSearch, catalogue: renderCatalogue, notes: renderNotes, settings: renderSettings, unshelved: renderUnshelved, tag: renderTag };
const TAB_OF = { home: 'home', room: 'home', unshelved: 'home', tag: 'search', search: 'search', notes: 'notes', catalogue: 'more', settings: 'more', read: 'home' };
const TITLES = { home: '', search: 'Suche', notes: 'Notizen', catalogue: 'Alle Bücher', settings: 'Einstellungen', unshelved: 'Ohne Regal' };

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
  return { name: 'home', params: [], query: {}, path: '/' };
}

function viewKey(r) {
  const q = { ...r.query };
  delete q.doc;
  delete q.in;
  delete q.q;
  const rest = new URLSearchParams(q).toString();
  return `${r.name}:${r.path}${rest ? `?${rest}` : ''}`;
}

function drawView(r) {
  const fn = VIEWS[r.name] || renderHome;
  const active = document.activeElement;
  const fk = active?.dataset?.fk;
  const sel = fk && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  let el;
  try {
    el = fn(r.params, r.query);
  } catch (e) {
    console.error(e);
    el = h('div', { class: 'page' }, h('h1', { class: 'large-title' }, 'Da ist etwas schiefgegangen'), h('p', null, String(e.message || e)), h('a', { class: 'btn tinted', href: '#/' }, 'Zur Bibliothek'));
  }
  viewEl().replaceChildren(el);
  document.body.dataset.view = r.name;
  watchLargeTitles(viewEl());
  if (fk) {
    const again = viewEl().querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (again) {
      again.focus({ preventScroll: true });
      if (sel) try { again.setSelectionRange(sel[0], sel[1]); } catch { /* not a text field */ }
    }
  }
  updateTitle(r);
  drawSidebar();
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
  document.title = t ? `${t} – Bücher` : 'Bücher';
}

function markNav(r) {
  const tab = TAB_OF[r.name];
  document.querySelectorAll('.tab[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  const key = r.name === 'room' ? `room:${r.params[0]}` : r.name;
  document.querySelectorAll('.side-link[data-nav]').forEach((a) => {
    const on = a.dataset.nav === key;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

async function route() {
  const r = parseHash();
  if (r.name === 'read') {
    closeDocPanel();
    if (!current.key) {
      const bg = parseHash('#/');
      drawView(bg);
      current = { key: viewKey(bg), route: bg };
    }
    markNav(r);
    updateTitle(r);
    await openReader(r.params[0], r.query);
    return;
  }
  if (isReaderOpen()) closeReader();
  setReaderBack(location.hash);
  updateTitle(r); // also when the view itself is reused (leaving the reader)
  const key = viewKey(r);
  if (key !== current.key || stale) {
    if (current.key) scrollMemory.set(current.key, window.scrollY);
    const same = key === current.key;
    const y = same ? window.scrollY : scrollMemory.get(key) || 0;
    current = { key, route: r };
    stale = false;
    drawView(r);
    window.scrollTo(0, y);
    if (!same) viewEl().focus({ preventScroll: true });
  } else current.route = r;
  markNav(r);
  if (r.query.doc) {
    if (!openDocPanel(r.query.doc, r.query.in || '')) {
      toast('Dieses Buch gibt es nicht mehr.');
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
  markNav(current.route);
}

// ---------------------------------------------------------------- shell

const contextTargets = () => {
  const r = current.route;
  if (r?.name === 'room' && idx.dept.has(r.params[0])) return [{ deptId: r.params[0], colId: r.params[1] && idx.col.has(r.params[1]) ? r.params[1] : null }];
  return [];
};

function sideLink(nav, href, ic, label, badge) {
  return h('a', { class: 'side-link', href, 'data-nav': nav }, fromHTML(icon(ic)), h('span', null, label), badge ? h('span', { class: 'badge' }, String(badge)) : null);
}

function drawSidebar() {
  const side = document.querySelector('.sidebar');
  if (!side) return;
  const shelves = idx.depts.map((d) =>
    h('a', { class: 'side-link side-shelf', href: `#/room/${d.id}`, 'data-nav': `room:${d.id}`, 'data-drop': `dd:${d.id}`, style: { '--shelf-color': d.leather } }, h('span', { class: 'dot' }), h('span', null, d.name), h('span', { class: 'badge' }, String(idx.docsInDept.get(d.id)?.size || 0))),
  );
  const parts = [
    h('div', { class: 'side-brand' }, h('img', { src: 'assets/icon-192.png', alt: '' }), h('span', { class: 'side-brand-name' }, 'Bücher'), syncBadge()),
    sideLink('home', '#/', 'library', 'Bibliothek'),
    sideLink('search', '#/search', 'search', 'Suche'),
    sideLink('notes', '#/scriptorium', 'notes', 'Notizen', state.notes.length || null),
    sideLink('catalogue', '#/catalogue', 'list', 'Alle Bücher', state.documents.length || null),
    idx.unshelved.length ? sideLink('unshelved', '#/unshelved', 'inbox', 'Ohne Regal', idx.unshelved.length) : null,
    h('div', { class: 'side-section' }, h('span', null, 'Regale'), h('button', { type: 'button', onClick: () => import('./views/home.js').then((m) => m.startEditingShelves()) }, 'Bearbeiten')),
    ...shelves,
    h('div', { class: 'side-foot' },
      h('button', { type: 'button', class: 'side-link', onClick: () => openAcquire({ targets: contextTargets() }) }, fromHTML(icon('plusCircle')), h('span', null, 'Hinzufügen')),
      sideLink('settings', '#/settings', 'settings', 'Einstellungen'),
    ),
  ];
  side.replaceChildren(...parts.filter(Boolean));
  if (current.route) {
    const key = current.route.name === 'room' ? `room:${current.route.params[0]}` : current.route.name;
    side.querySelector(`[data-nav="${CSS.escape(key)}"]`)?.classList.add('on');
  }
}

function buildShell() {
  const app = document.getElementById('app');
  const side = h('nav', { class: 'sidebar', 'aria-label': 'Navigation' });
  const tab = (key, href, ic, label) => h('a', { class: 'tab', href, 'data-tab': key }, fromHTML(icon(ic)), h('span', null, label));
  const tabbar = h(
    'nav',
    { class: 'tabbar', 'aria-label': 'Navigation' },
    tab('home', '#/', 'library', 'Bibliothek'),
    tab('search', '#/search', 'search', 'Suche'),
    h('button', { type: 'button', class: 'tab', onClick: () => openAcquire({ targets: contextTargets() }) }, fromHTML(icon('plusCircle')), h('span', null, 'Hinzufügen')),
    tab('notes', '#/scriptorium', 'notes', 'Notizen'),
    h('button', {
      type: 'button',
      class: 'tab',
      'data-tab': 'more',
      onClick: (e) => showMenu(e.currentTarget, [
        { label: 'Alle Bücher', icon: 'list', onClick: () => (location.hash = '#/catalogue') },
        { label: 'Ohne Regal', icon: 'inbox', hint: idx.unshelved.length ? String(idx.unshelved.length) : '', onClick: () => (location.hash = '#/unshelved') },
        { label: 'Regale bearbeiten', icon: 'library', onClick: () => import('./views/home.js').then((m) => m.startEditingShelves()) },
        { label: 'Einstellungen', icon: 'settings', onClick: () => (location.hash = '#/settings') },
      ]),
    }, fromHTML(icon('more')), h('span', null, 'Mehr')),
  );
  app.prepend(side);
  app.append(tabbar);

  // Drop books onto a shelf in the sidebar (desktop).
  side.addEventListener('dragover', (e) => {
    const t = e.target.closest('[data-drop]');
    if (!t || !e.dataTransfer.types.includes('application/x-buecher')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.altKey || e.ctrlKey ? 'copy' : 'move';
    side.querySelectorAll('.drop-over').forEach((x) => x !== t && x.classList.remove('drop-over'));
    t.classList.add('drop-over');
  });
  side.addEventListener('dragleave', (e) => e.target.closest?.('[data-drop]')?.classList.remove('drop-over'));
  side.addEventListener('drop', async (e) => {
    const t = e.target.closest('[data-drop]');
    const raw = e.dataTransfer.getData('application/x-buecher');
    if (!t || !raw) return;
    e.preventDefault();
    t.classList.remove('drop-over');
    const { ids, scope } = JSON.parse(raw);
    const target = { deptId: t.dataset.drop.slice(3), colId: null };
    const snap = snapshotAssignments(ids);
    const copy = e.altKey || e.ctrlKey;
    if (copy) await assignMany(ids, [target]);
    else await moveDocs(ids, scope, [target]);
    toast(`${ids.length} ${ids.length === 1 ? 'Buch' : 'Bücher'} ${copy ? 'auch in' : 'nach'} ${idx.dept.get(target.deptId)?.name}`, { action: { label: 'Widerrufen', onClick: () => restoreAssignments(ids, snap) } });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]') && !isReaderOpen() && !document.querySelector('.sheet-wrap, .alert-wrap')) {
      e.preventDefault();
      if (location.hash.startsWith('#/search')) document.querySelector('.search-page input[type=search]')?.focus();
      else {
        location.hash = '#/search';
        setTimeout(() => document.querySelector('.search-page input[type=search]')?.focus(), 60);
      }
    }
  });

  // Drop files anywhere to add them.
  let depth = 0;
  const overlay = h('div', { class: 'drop-overlay', hidden: true }, h('div', { class: 'drop-card' }, fromHTML(icon('fileUp')), 'Loslassen zum Hinzufügen'));
  document.body.append(overlay);
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; overlay.hidden = false; } });
  window.addEventListener('dragleave', (e) => { if (hasFiles(e)) { depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; } });
  window.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    depth = 0;
    overlay.hidden = true;
    e.preventDefault();
    if (e.dataTransfer.files.length) openAcquire({ files: e.dataTransfer.files, targets: contextTargets() });
  });

  // Pinch zoom stays off; reading text reflows instead.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
}

// ---------------------------------------------------------------- start

async function start() {
  applyTheme();
  try {
    await openDb();
  } catch (e) {
    viewEl().replaceChildren(h('div', { class: 'page' }, h('h1', { class: 'large-title' }, 'Bücher lässt sich nicht öffnen'), h('p', null, 'Dieser Browser erlaubt hier keinen Speicher (privater Modus?).'), h('p', { class: 'muted' }, String(e.message || e))));
    return;
  }
  await loadAll();
  await loadReaderPrefs();
  buildShell();
  const rerender = () => redraw();
  setHomeRerender(rerender);
  setRoomRerender(rerender);
  setCatalogueRerender(rerender);
  setNotesRerender(rerender);
  setSettingsRerender(rerender);
  subscribe((tables) => {
    const t = [...tables];
    if (t.length && t.every((x) => x === 'progress' || x === 'prefs') && current.route?.name !== 'home' && current.route?.name !== 'settings') return;
    redraw();
    refreshDocPanel();
  });
  onSyncState((s) => document.documentElement.setAttribute('data-sync', s.status));
  window.addEventListener('hashchange', route);
  await route();
  document.documentElement.classList.add('ready');
  initSync();
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => enqueueMissing());
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker', e));
  }
  window.__gl = { state, idx, isTouch };
}

start();
