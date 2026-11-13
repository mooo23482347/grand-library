// The great hall: every room of the library behind its own arched door.

import { h, fromHTML, prefersReducedMotion } from '../util.js';
import { idx, state, deptStats, moveDepartment, noteTitle } from '../store.js';
import { emblem, icon, ORNAMENT } from '../ui/icons.js';
import { showMenu } from '../ui/modal.js';
import { peekShelves, spineSpec } from './shelf.js';
import { editRoomDialog, deleteRoomDialog, newRoomDialog } from './roomdialogs.js';
import { openAcquire } from '../import/acquire.js';

export function renderHall() {
  const depts = idx.depts;
  const total = state.documents.length;
  const notes = state.notes.length;

  return h(
    'div',
    { class: 'hall' },
    h('div', { class: 'hall-glow', 'aria-hidden': 'true' }),
    h(
      'header',
      { class: 'hall-frieze' },
      h('p', { class: 'hall-overline' }, 'Ex libris'),
      h('h1', { class: 'hall-title' }, 'The Grand Library'),
      fromHTML(ORNAMENT),
      h(
        'p',
        { class: 'hall-motto' },
        `${total} ${total === 1 ? 'volume' : 'volumes'} in ${depts.length} ${depts.length === 1 ? 'room' : 'rooms'}`,
        notes ? ` · ${notes} ${notes === 1 ? 'entry' : 'entries'} in the Scriptorium` : '',
      ),
    ),
    total === 0 ? welcome() : readingDesk(),
    h('section', { class: 'gallery', 'aria-label': 'Rooms of the library' }, depts.map(door), newRoomArch()),
    h('div', { class: 'hall-floor', 'aria-hidden': 'true' }),
    h('section', { class: 'hall-furniture', 'aria-label': 'Furniture of the hall' }, scriptoriumDesk(), returnsTable()),
  );
}

function door(d) {
  const st = deptStats(d.id);
  const ids = idx.docsInDept.get(d.id) || new Set();
  const enter = (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    if (prefersReducedMotion()) return;
    e.preventDefault();
    const a = e.currentTarget;
    a.classList.add('entering');
    setTimeout(() => {
      location.hash = `#/room/${d.id}`;
    }, 420);
  };
  return h(
    'div',
    { class: 'door-wrap', style: { '--leather': d.leather || '#4b2e1a' } },
    h(
      'a',
      { class: 'door', href: `#/room/${d.id}`, onClick: enter, 'aria-label': `${d.name}: ${st.volumes} volumes, ${st.collections} collections` },
      h(
        'div',
        { class: 'door-frame' },
        h(
          'div',
          { class: 'door-opening' },
          h('div', { class: 'door-room' }, h('div', { class: 'door-lamp' }), peekShelves(d.id, ids)),
          h('div', { class: 'door-leaf left' }, h('span', { class: 'leaf-panel top' }), h('span', { class: 'leaf-panel bottom' }), h('span', { class: 'leaf-knob' })),
          h('div', { class: 'door-leaf right' }, h('span', { class: 'leaf-panel top' }), h('span', { class: 'leaf-panel bottom' }), h('span', { class: 'leaf-knob' })),
        ),
        h('div', { class: 'door-keystone', html: emblem(d.emblem) }),
      ),
      h(
        'div',
        { class: 'door-plaque' },
        h('span', { class: 'plaque-name' }, d.name),
        h('span', { class: 'plaque-sub' }, `${st.volumes} ${st.volumes === 1 ? 'volume' : 'volumes'} · ${st.collections} ${st.collections === 1 ? 'collection' : 'collections'}`),
      ),
    ),
    h('button', {
      type: 'button',
      class: 'door-menu icon-btn',
      'aria-label': `Options for ${d.name}`,
      html: icon('dots'),
      onClick: (e) => roomMenu(e.currentTarget, d),
    }),
  );
}

export function roomMenu(anchor, d) {
  const i = idx.depts.findIndex((x) => x.id === d.id);
  showMenu(anchor, [
    { label: 'Edit room', icon: 'pen', onClick: () => editRoomDialog(d) },
    { label: 'Move earlier in the hall', icon: 'back', disabled: i <= 0, onClick: () => moveDepartment(d.id, -1) },
    { label: 'Move later in the hall', icon: 'next', disabled: i >= idx.depts.length - 1, onClick: () => moveDepartment(d.id, 1) },
    '-',
    { label: 'Close this room…', icon: 'trash', danger: true, onClick: () => deleteRoomDialog(d) },
  ]);
}

function newRoomArch() {
  return h(
    'div',
    { class: 'door-wrap new-room' },
    h(
      'button',
      { type: 'button', class: 'door door-new', onClick: () => newRoomDialog() },
      h('div', { class: 'door-frame' }, h('div', { class: 'door-opening' }, h('div', { class: 'door-room bare' }, h('span', { class: 'new-room-sign', html: icon('plus') })))),
      h('div', { class: 'door-plaque blank' }, h('span', { class: 'plaque-name' }, 'Open a new room'), h('span', { class: 'plaque-sub' }, 'Add a wing to the library')),
    ),
  );
}

function readingDesk() {
  const recent = [...state.progress]
    .filter((p) => idx.doc.has(p.documentId) && p.openedAt)
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, 4);
  if (!recent.length) return null;
  return h(
    'section',
    { class: 'reading-desk', 'aria-label': 'On the reading desk' },
    h('h2', { class: 'desk-title' }, 'On the reading desk'),
    h(
      'div',
      { class: 'desk-items' },
      recent.map((p) => {
        const d = idx.doc.get(p.documentId);
        const s = spineSpec(d);
        const pct = Math.round((p.percent || 0) * 100);
        return h(
          'a',
          { class: 'desk-item', href: `#/read/${d.id}` },
          h('span', { class: `desk-book b-${s.binding}`, style: { '--c': s.color } }),
          h(
            'span',
            { class: 'desk-text' },
            h('span', { class: 'desk-book-title' }, d.title),
            h('span', { class: 'desk-book-author' }, d.author || ''),
            h('span', { class: 'desk-progress', style: { '--p': `${pct}%` } }, h('span', { class: 'desk-pct' }, pct >= 99 ? 'Finished' : `${pct}%`)),
          ),
        );
      }),
    ),
  );
}

function welcome() {
  return h(
    'section',
    { class: 'welcome' },
    h('h2', null, 'The shelves await their first volumes'),
    h('p', null, 'Bring in EPUB and PDF files, papers, lecture scripts and your own notes. Each room keeps its own shelves; one volume can stand in several rooms without being copied.'),
    h(
      'div',
      { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onClick: () => openAcquire({}) }, fromHTML(icon('acquire')), 'Acquire the first volumes'),
      h('a', { class: 'btn btn-ghost', href: '#/settings' }, fromHTML(icon('cloud')), 'Connect your iPhone'),
    ),
  );
}

function scriptoriumDesk() {
  const latest = [...state.notes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 3);
  return h(
    'a',
    { class: 'furniture writing-desk', href: '#/scriptorium' },
    h('span', { class: 'furniture-icon', html: icon('quill') }),
    h(
      'span',
      { class: 'furniture-text' },
      h('span', { class: 'furniture-title' }, 'The Scriptorium'),
      h('span', { class: 'furniture-sub' }, latest.length ? `Latest: ${latest.map((n) => noteTitle(n)).join(' · ')}` : 'Summaries, thoughts and quotations, bound to the books they belong to.'),
    ),
  );
}

function returnsTable() {
  const n = idx.unshelved.length;
  return h(
    'a',
    { class: `furniture returns-table ${n ? 'has-items' : ''}`, href: '#/unshelved' },
    h('span', { class: 'furniture-icon', html: icon('book') }),
    h(
      'span',
      { class: 'furniture-text' },
      h('span', { class: 'furniture-title' }, 'The returns table'),
      h('span', { class: 'furniture-sub' }, n ? `${n} ${n === 1 ? 'volume waits' : 'volumes wait'} to be shelved` : 'Volumes without a shelf rest here. It is empty.'),
    ),
  );
}
