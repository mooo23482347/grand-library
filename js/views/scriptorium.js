// The Scriptorium: notes, summaries, thoughts, theories and quotations, each bound to the volumes,
// chapters and rooms it belongs to, and to one another through [[links]].

import { h, fromHTML, fold, renderMarkdown, formatDate, esc } from '../util.js';
import { idx, state, noteTitle, placementLabel, docsUnder, primaryPlacement, docHref } from '../store.js';
import { NOTE_KINDS, noteKindLabel } from '../kinds.js';
import { icon } from '../ui/icons.js';
import { openNoteEditor, linksTo } from '../ui/noteEditor.js';

const ui = { q: '' };
const PLURAL = { note: 'Notes', summary: 'Summaries', thought: 'Thoughts', theory: 'Theories', quote: 'Quotations' };
let rerender = () => {};
export function setScriptoriumRerender(fn) {
  rerender = fn;
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

function filterNotes(query) {
  let notes = [...state.notes];
  if (query.doc) notes = notes.filter((n) => n.documentId === query.doc);
  if (query.room) {
    const docs = idx.docsInDept.get(query.room) || new Set();
    notes = notes.filter((n) => n.departmentId === query.room || (n.documentId && docs.has(n.documentId)) || (n.collectionId && idx.col.get(n.collectionId)?.departmentId === query.room));
  }
  if (query.col) {
    const docs = docsUnder(query.col);
    notes = notes.filter((n) => n.collectionId === query.col || (n.documentId && docs.has(n.documentId)));
  }
  if (query.kind && query.kind !== 'marks') notes = notes.filter((n) => n.kind === query.kind);
  const tokens = fold(ui.q).split(/\s+/).filter(Boolean);
  if (tokens.length) {
    notes = notes.filter((n) => {
      const d = n.documentId ? idx.doc.get(n.documentId) : null;
      const hay = fold(`${noteTitle(n)} ${n.body} ${n.quote} ${n.chapter} ${d?.title || n.sourceTitle || ''} ${d?.author || ''}`);
      return tokens.every((t) => hay.includes(t));
    });
  }
  return notes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function qs(query, patch) {
  const p = new URLSearchParams();
  const merged = { ...query, ...patch };
  for (const [k, v] of Object.entries(merged)) if (v && k !== 'doc_' ) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function renderScriptorium([noteId], query) {
  const isMarks = query.kind === 'marks';
  const notes = isMarks ? [] : filterNotes(query);
  let marks = [];
  if (isMarks) {
    marks = [...state.highlights];
    if (query.doc) marks = marks.filter((x) => x.documentId === query.doc);
    if (query.room) {
      const docs = idx.docsInDept.get(query.room) || new Set();
      marks = marks.filter((x) => docs.has(x.documentId));
    }
    const tokens = fold(ui.q).split(/\s+/).filter(Boolean);
    if (tokens.length) marks = marks.filter((x) => tokens.every((t) => fold(x.text).includes(t)));
    marks.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  const scopeBits = [];
  if (query.doc && idx.doc.get(query.doc)) scopeBits.push(`on “${idx.doc.get(query.doc).title}”`);
  if (query.room && idx.dept.get(query.room)) scopeBits.push(`in ${idx.dept.get(query.room).name}`);
  if (query.col && idx.col.get(query.col)) scopeBits.push(`in ${idx.col.get(query.col).name}`);

  const kinds = h(
    'nav',
    { class: 'kind-tabs', 'aria-label': 'Kinds of entries' },
    h('a', { class: `kind-tab ${!query.kind ? 'on' : ''}`, href: `#/scriptorium${qs(query, { kind: '' })}` }, 'All'),
    NOTE_KINDS.map((k) => h('a', { class: `kind-tab ${query.kind === k.id ? 'on' : ''}`, href: `#/scriptorium${qs(query, { kind: k.id })}` }, PLURAL[k.id])),
    h('a', { class: `kind-tab ${isMarks ? 'on' : ''}`, href: `#/scriptorium${qs(query, { kind: 'marks' })}` }, 'Marginalia'),
  );

  const filter = h('input', { type: 'search', class: 'room-filter', placeholder: 'Search the Scriptorium…', value: ui.q, 'data-fk': 'scr-q', 'aria-label': 'Search the Scriptorium' });
  filter.addEventListener('input', () => {
    ui.q = filter.value;
    rerender();
  });

  const list = h(
    'div',
    { class: 'scr-list' },
    isMarks
      ? marks.length
        ? marks.slice(0, 400).map((x) => {
            const d = idx.doc.get(x.documentId);
            const note = x.noteId ? idx.note.get(x.noteId) : null;
            return h(
              'a',
              { class: `scr-item mark c-${x.color || 'amber'}`, href: `#/read/${x.documentId}?loc=${encodeURIComponent(JSON.stringify(x.loc))}` },
              h('span', { class: 'scr-quote' }, `“${x.text.slice(0, 260)}${x.text.length > 260 ? '…' : ''}”`),
              h('span', { class: 'scr-src' }, [d?.title, x.chapter].filter(Boolean).join(' · ')),
              note ? h('span', { class: 'scr-snip' }, `Note: ${noteTitle(note)}`) : null,
            );
          })
        : h('p', { class: 'scr-empty' }, 'No passages marked yet. Select text while reading to mark it.')
      : notes.length
        ? notes.slice(0, 500).map((n) => {
            const d = n.documentId ? idx.doc.get(n.documentId) : null;
            return h(
              'a',
              { class: `scr-item ${n.id === noteId ? 'active' : ''}`, href: `#/scriptorium/${n.id}${qs(query, {})}` },
              h('span', { class: `note-kind k-${n.kind}` }, noteKindLabel(n.kind)),
              h('span', { class: 'scr-title' }, noteTitle(n)),
              h('span', { class: 'scr-src' }, d ? `${d.title}${n.chapter ? ` · ${n.chapter}` : ''}` : n.sourceTitle ? `${n.sourceTitle} (removed)` : notePlace(n)?.label || 'Free-standing'),
            );
          })
        : h('p', { class: 'scr-empty' }, ui.q || query.kind || scopeBits.length ? 'Nothing here matches.' : 'The Scriptorium is empty. Write a first thought, or summarise a chapter from any catalogue card.'),
  );

  const note = noteId ? idx.note.get(noteId) : null;
  const detail = note ? noteView(note, query) : noteId ? h('div', { class: 'scr-detail empty' }, h('p', null, 'This entry no longer exists.')) : intro();

  return h(
    'div',
    { class: `scriptorium ${noteId ? 'has-detail' : ''}` },
    h(
      'header',
      { class: 'page-head scr-head' },
      h('div', null, h('h1', { class: 'page-title' }, 'The Scriptorium'), h('p', { class: 'page-sub' }, scopeBits.length ? `Entries ${scopeBits.join(' ')}` : 'Your summaries, thoughts and quotations')),
      h('div', { class: 'scr-head-actions' },
        scopeBits.length ? h('a', { class: 'btn btn-ghost small', href: '#/scriptorium' }, 'Show all') : null,
        h('button', { type: 'button', class: 'btn btn-brass', onClick: () => openNoteEditor({ kind: query.kind && query.kind !== 'marks' ? query.kind : 'thought', documentId: query.doc || null, departmentId: query.room || null, collectionId: query.col || null }) }, fromHTML(icon('quill')), 'New entry'),
      ),
    ),
    h(
      'div',
      { class: 'scr-layout' },
      h('div', { class: 'scr-index' }, kinds, h('div', { class: 'filter-wrap' }, fromHTML(icon('search')), filter), list),
      detail,
    ),
  );
}

function intro() {
  const counts = NOTE_KINDS.map((k) => {
    const n = state.notes.filter((x) => x.kind === k.id).length;
    return [n === 1 ? k.label.toLowerCase() : PLURAL[k.id].toLowerCase(), n];
  });
  return h(
    'div',
    { class: 'scr-detail intro' },
    h('div', { class: 'parchment' },
      h('h2', null, 'A knowledge archive, not a pile of files'),
      h('p', null, 'Every entry here can be bound to a volume, to a chapter of it, to the passage you marked, and to a room or collection of the library. Summaries appear on the catalogue card of their book and in the room the book stands in.'),
      h('p', null, 'Link entries to one another by writing the title of another entry or volume in double brackets, like [[Meditations]].'),
      h('ul', { class: 'scr-counts' }, counts.map(([l, n]) => h('li', null, h('strong', null, String(n)), ` ${l}`)), h('li', null, h('strong', null, String(state.highlights.length)), state.highlights.length === 1 ? ' marked passage' : ' marked passages')),
    ),
  );
}

function resolveWiki(text) {
  const t = fold(text.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
  const n = state.notes.find((x) => fold(noteTitle(x)) === t);
  if (n) return `<a class="wikilink" href="#/scriptorium/${esc(n.id)}">${text}</a>`;
  const d = state.documents.find((x) => fold(x.title) === t);
  if (d) return `<a class="wikilink doc" href="${esc(docHref(d.id))}">${text}</a>`;
  return `<span class="wikilink missing" title="No entry or volume with this title yet">${text}</span>`;
}

function noteView(n, query) {
  const d = n.documentId ? idx.doc.get(n.documentId) : null;
  const place = notePlace(n);
  const back = linksTo(n);
  const siblings = d ? (idx.notesByDoc.get(d.id) || []).filter((x) => x.id !== n.id).slice(0, 8) : [];
  const hl = n.highlightId ? idx.hl.get(n.highlightId) : null;
  const loc = hl?.loc || n.loc;
  const body = h('div', { class: 'prose note-body', html: renderMarkdown(n.body, { resolveLink: resolveWiki }) });

  return h(
    'article',
    { class: 'scr-detail' },
    h(
      'div',
      { class: 'parchment' },
      h('a', { class: 'scr-back', href: `#/scriptorium${qs(query, {})}` }, fromHTML(icon('back')), 'All entries'),
      h('p', { class: `note-kind big k-${n.kind}` }, noteKindLabel(n.kind)),
      h('h2', { class: 'note-h' }, noteTitle(n)),
      h(
        'p',
        { class: 'note-binding' },
        d ? [h('span', null, 'On '), h('a', { href: docHref(d.id) }, d.title), n.chapter ? h('span', null, `, ${n.chapter}`) : null] : n.sourceTitle ? h('span', null, `On ${n.sourceTitle} (no longer in the library)`) : null,
        place ? [d || n.sourceTitle ? h('span', { class: 'sep' }, ' · ') : null, h('a', { href: place.href }, place.label)] : null,
      ),
      n.quote || hl ? h('blockquote', { class: 'note-quote' }, n.quote || hl.text) : null,
      n.body ? body : null,
      h(
        'div',
        { class: 'note-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', onClick: () => openNoteEditor({ id: n.id }) }, fromHTML(icon('pen')), 'Edit'),
        d && loc && ['epub', 'pdf', 'text'].includes(d.format) ? h('a', { class: 'btn btn-ghost', href: `#/read/${d.id}?loc=${encodeURIComponent(JSON.stringify(loc))}` }, fromHTML(icon('book')), 'Open the passage') : null,
        d && !loc && ['epub', 'pdf', 'text'].includes(d.format) ? h('a', { class: 'btn btn-ghost', href: `#/read/${d.id}` }, fromHTML(icon('book')), 'Open the volume') : null,
      ),
      h('p', { class: 'note-dates' }, `Written ${formatDate(n.createdAt)}${n.updatedAt && n.updatedAt - (n.createdAt || 0) > 60000 ? ` · revised ${formatDate(n.updatedAt)}` : ''}`),
      back.length ? h('section', { class: 'note-rel' }, h('h3', null, 'Referred to by'), h('ul', null, back.map((b) => h('li', null, h('a', { href: `#/scriptorium/${b.id}` }, noteTitle(b)))))) : null,
      siblings.length ? h('section', { class: 'note-rel' }, h('h3', null, `More on ${d.title}`), h('ul', null, siblings.map((b) => h('li', null, h('a', { href: `#/scriptorium/${b.id}` }, h('span', { class: `note-kind k-${b.kind}` }, noteKindLabel(b.kind)), ' ', noteTitle(b)))))) : null,
    ),
  );
}
