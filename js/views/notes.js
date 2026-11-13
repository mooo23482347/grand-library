// Notizen: summaries, thoughts, theories, quotations and marked passages, grouped by book.

import { h, fromHTML, fold, renderMarkdown, formatDate, esc } from '../util.js';
import { idx, state, noteTitle, placementLabel, docsUnder, primaryPlacement, docHref } from '../store.js';
import { NOTE_KINDS, noteKind } from '../kinds.js';
import { icon } from '../ui/icons.js';
import { pageHeader, navButton, searchField, group, cell, emptyState } from '../ui/controls.js';
import { openNoteEditor, linksTo } from '../ui/noteEditor.js';

const ui = { q: '' };
let rerender = () => {};
export function setNotesRerender(fn) {
  rerender = fn;
}

function qs(query, patch) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...query, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

function notePlace(n) {
  if (n.collectionId && idx.col.get(n.collectionId)) return { label: placementLabel({ departmentId: idx.col.get(n.collectionId).departmentId, collectionId: n.collectionId }), href: `#/room/${idx.col.get(n.collectionId).departmentId}/${n.collectionId}` };
  if (n.departmentId && idx.dept.get(n.departmentId)) return { label: idx.dept.get(n.departmentId).name, href: `#/room/${n.departmentId}` };
  if (n.documentId) {
    const a = primaryPlacement(n.documentId);
    if (a) return { label: placementLabel(a), href: a.collectionId ? `#/room/${a.departmentId}/${a.collectionId}` : `#/room/${a.departmentId}` };
  }
  return null;
}

export function renderNotes([noteId], query) {
  if (noteId) return noteDetail(noteId, query);
  const isMarks = query.kind === 'marks';
  const tokens = fold(ui.q).split(/\s+/).filter(Boolean);
  const hit = (txt) => tokens.every((t) => fold(txt).includes(t));

  const chips = h(
    'div',
    { class: 'chips scroll', role: 'tablist', 'aria-label': 'Filter' },
    h('a', { class: `chip ${!query.kind ? 'on' : ''}`, href: `#/scriptorium${qs(query, { kind: '' })}` }, 'Alle'),
    NOTE_KINDS.map((k) => h('a', { class: `chip ${query.kind === k.id ? 'on' : ''}`, href: `#/scriptorium${qs(query, { kind: k.id })}` }, k.plural)),
    h('a', { class: `chip ${isMarks ? 'on' : ''}`, href: `#/scriptorium${qs(query, { kind: 'marks' })}` }, 'Markierungen'),
  );

  let scopeDocs = null;
  if (query.room) scopeDocs = idx.docsInDept.get(query.room) || new Set();
  if (query.col) scopeDocs = docsUnder(query.col);
  const scopeName = query.doc ? idx.doc.get(query.doc)?.title : query.room ? idx.dept.get(query.room)?.name : query.col ? idx.col.get(query.col)?.name : null;

  const page = h(
    'div',
    { class: 'page notes' },
    pageHeader({
      title: 'Notizen',
      sub: scopeName ? `Zu „${scopeName}“` : null,
      actions: [scopeName ? h('a', { class: 'btn', href: '#/scriptorium' }, 'Alle') : null, navButton('Neue Notiz', () => openNoteEditor({ kind: query.kind && query.kind !== 'marks' ? query.kind : 'thought', documentId: query.doc || null, departmentId: query.room || null, collectionId: query.col || null }), { icon: 'penLine' })],
    }),
    searchField({ placeholder: 'Notizen durchsuchen', value: ui.q, fk: 'notes-q', onInput: (v) => { ui.q = v; rerender(); } }),
    chips,
  );

  // collect and group by book
  const groups = new Map(); // key → {title, href, items: []}
  const add = (key, titleTxt, href, item) => {
    if (!groups.has(key)) groups.set(key, { title: titleTxt, href, items: [] });
    groups.get(key).items.push(item);
  };

  if (isMarks) {
    for (const x of state.highlights) {
      if (query.doc && x.documentId !== query.doc) continue;
      if (scopeDocs && !scopeDocs.has(x.documentId)) continue;
      if (tokens.length && !hit(x.text)) continue;
      const d = idx.doc.get(x.documentId);
      add(x.documentId, d?.title || 'Gelöschtes Buch', d ? docHref(d.id) : null, cell({ title: `„${x.text.slice(0, 140)}${x.text.length > 140 ? '…' : ''}“`, sub: x.chapter || '', href: `#/read/${x.documentId}?loc=${encodeURIComponent(JSON.stringify(x.loc))}`, wrap: true, className: `mark-cell c-${x.color || 'amber'}` }));
    }
  } else {
    const notes = [...state.notes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const n of notes) {
      if (query.kind && n.kind !== query.kind) continue;
      if (query.doc && n.documentId !== query.doc) continue;
      if (scopeDocs && !(n.documentId && scopeDocs.has(n.documentId)) && n.departmentId !== query.room && n.collectionId !== query.col) continue;
      const d = n.documentId ? idx.doc.get(n.documentId) : null;
      if (tokens.length && !hit(`${noteTitle(n)} ${n.body} ${n.quote} ${n.chapter} ${d?.title || n.sourceTitle || ''}`)) continue;
      const k = noteKind(n.kind);
      const preview = (n.quote || n.body || '').replace(/[#>*[\]_]/g, '').trim();
      add(d ? d.id : n.sourceTitle ? `src:${n.sourceTitle}` : 'free', d ? d.title : n.sourceTitle ? `${n.sourceTitle} (gelöscht)` : 'Ohne Buch', d ? docHref(d.id) : null, cell({ title: noteTitle(n), sub: [k.label, n.chapter, preview && preview !== noteTitle(n) ? preview.slice(0, 80) : ''].filter(Boolean).join(' · '), href: `#/scriptorium/${n.id}${qs(query, {})}`, icon: k.icon, tint: 'var(--accent)' }));
    }
  }

  if (!groups.size) {
    page.append(
      emptyState({
        icon: isMarks ? 'highlighter' : 'notes',
        title: tokens.length || query.kind ? 'Nichts gefunden' : isMarks ? 'Noch keine Markierungen' : 'Noch keine Notizen',
        text: isMarks ? 'Markiere beim Lesen eine Textstelle, um sie hier zu sammeln.' : 'Schreib beim Lesen einen Gedanken, ein Zitat oder eine Zusammenfassung – oder hier eine freie Notiz.',
        action: isMarks ? null : h('button', { type: 'button', class: 'btn tinted', onClick: () => openNoteEditor({ kind: 'thought' }) }, fromHTML(icon('penLine')), 'Neue Notiz'),
      }),
    );
    return page;
  }
  for (const g of groups.values()) {
    page.append(group({ head: g.title, headAction: g.href ? h('a', { class: 'btn', href: g.href }, 'Buch') : null, rows: g.items, icons: !isMarks }));
  }
  return page;
}

function resolveWiki(text) {
  const t = fold(text.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
  const n = state.notes.find((x) => fold(noteTitle(x)) === t);
  if (n) return `<a class="wikilink" href="#/scriptorium/${esc(n.id)}">${text}</a>`;
  const d = state.documents.find((x) => fold(x.title) === t);
  if (d) return `<a class="wikilink" href="${esc(docHref(d.id))}">${text}</a>`;
  return `<span class="wikilink missing" title="Noch keine Notiz und kein Buch mit diesem Titel">${text}</span>`;
}

function noteDetail(id, query) {
  const n = idx.note.get(id);
  const back = { href: `#/scriptorium${qs(query, {})}`, label: 'Notizen' };
  if (!n) return h('div', { class: 'page' }, pageHeader({ title: 'Notiz', back }), emptyState({ icon: 'notes', title: 'Diese Notiz gibt es nicht mehr.' }));
  const d = n.documentId ? idx.doc.get(n.documentId) : null;
  const k = noteKind(n.kind);
  const place = notePlace(n);
  const hl = n.highlightId ? idx.hl.get(n.highlightId) : null;
  const loc = hl?.loc || n.loc;
  const readable = d && ['epub', 'pdf', 'text'].includes(d.format);
  const back2 = linksTo(n);
  const siblings = d ? (idx.notesByDoc.get(d.id) || []).filter((x) => x.id !== n.id).slice(0, 8) : [];

  return h(
    'div',
    { class: 'page narrow note-page' },
    pageHeader({ title: noteTitle(n), back, actions: [navButton('Bearbeiten', () => openNoteEditor({ id: n.id }))] }),
    h('p', { class: 'note-kind-line' }, fromHTML(icon(k.icon)), k.label, n.chapter ? ` · ${n.chapter}` : ''),
    n.quote || hl ? h('blockquote', { class: 'note-quote' }, n.quote || hl.text) : null,
    n.body ? h('div', { class: 'prose note-body', html: renderMarkdown(n.body, { resolveLink: resolveWiki }) }) : null,
    group({
      head: 'Verknüpft',
      rows: [
        d ? cell({ title: d.title, sub: d.author, href: docHref(d.id), icon: 'book', tint: 'var(--accent)' }) : n.sourceTitle ? cell({ title: `${n.sourceTitle}`, sub: 'Buch gelöscht', icon: 'book', tint: 'var(--text-3)' }) : null,
        readable ? cell({ title: loc ? 'Stelle im Buch öffnen' : 'Buch lesen', href: `#/read/${d.id}${loc ? `?loc=${encodeURIComponent(JSON.stringify(loc))}` : ''}`, icon: 'bookOpen', tint: 'var(--success)' }) : null,
        place ? cell({ title: place.label, sub: 'Regal', href: place.href, icon: 'library', tint: 'var(--text-3)' }) : null,
      ],
      icons: true,
    }),
    back2.length ? group({ head: 'Verweise von', rows: back2.map((b) => cell({ title: noteTitle(b), href: `#/scriptorium/${b.id}` })) }) : null,
    siblings.length ? group({ head: `Mehr zu ${d.title}`, rows: siblings.map((b) => cell({ title: noteTitle(b), sub: noteKind(b.kind).label, href: `#/scriptorium/${b.id}` })) }) : null,
    h('p', { class: 'faint small center-text' }, `Geschrieben am ${formatDate(n.createdAt)}${n.updatedAt && n.updatedAt - (n.createdAt || 0) > 60000 ? ` · geändert am ${formatDate(n.updatedAt)}` : ''}`),
  );
}
