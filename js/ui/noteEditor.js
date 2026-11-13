// Writing one note: a summary, thought, theory, quotation or plain note, linked to a book, a chapter,
// a marked passage and a shelf, and to other notes through [[links]].

import { h, fold, renderMarkdown } from '../util.js';
import { idx, state, saveNote, deleteNote, placementLabel, noteTitle } from '../store.js';
import { NOTE_KINDS, kindLabel } from '../kinds.js';
import { openSheet, confirmDialog, toast } from './modal.js';
import { pickOne } from './picker.js';
import { group, cell, searchField } from './controls.js';

export function pickDocument({ title = 'Buch wählen' } = {}) {
  return new Promise((resolve) => {
    const list = h('div');
    const draw = (q = '') => {
      const f = fold(q.trim());
      const res = state.documents
        .filter((d) => !f || fold(`${d.title} ${d.author}`).includes(f))
        .sort((a, b) => a.title.localeCompare(b.title, 'de'))
        .slice(0, 60);
      list.replaceChildren(res.length ? group({ rows: res.map((d) => cell({ title: d.title, sub: [d.author, kindLabel(d.kind)].filter(Boolean).join(' · '), onClick: () => s.close(d.id) })) }) : h('p', { class: 'muted center-text' }, 'Kein Buch gefunden.'));
    };
    const s = openSheet({
      title,
      tall: true,
      left: { label: 'Abbrechen', onClick: (close) => close(null) },
      right: { label: 'Ohne Buch', onClick: (close) => close('') },
      body: h('div', null, searchField({ placeholder: 'Titel oder Autor', onInput: draw }), list),
      onClose: (r) => resolve(typeof r === 'string' ? r : null),
    });
    draw();
  });
}

export function openNoteEditor(fields = {}) {
  const existing = fields.id ? idx.note.get(fields.id) : null;
  const n = { kind: 'note', title: '', body: '', quote: '', documentId: null, chapter: '', loc: null, highlightId: null, departmentId: null, collectionId: null, ...(existing || {}), ...fields };

  let kind = n.kind;
  const kinds = h('div', { class: 'chips scroll kind-chips', role: 'radiogroup', 'aria-label': 'Art' });
  const drawKinds = () =>
    kinds.replaceChildren(...NOTE_KINDS.map((k) => h('button', { type: 'button', class: `chip ${k.id === kind ? 'on' : ''}`, role: 'radio', 'aria-checked': k.id === kind ? 'true' : 'false', onClick: () => { kind = k.id; drawKinds(); syncQuote(); } }, k.label)));

  const title = h('input', { type: 'text', value: n.title || '', placeholder: 'Titel (optional)', 'aria-label': 'Titel' });
  const quote = h('textarea', { rows: 3, placeholder: 'Die zitierte Stelle', 'aria-label': 'Zitat', class: 'quote-input' }, n.quote || '');
  const body = h('textarea', { rows: 9, placeholder: 'Schreib hier. **fett**, *kursiv*, # Überschrift, - Liste, > Zitat, [[Titel einer Notiz oder eines Buchs]]', 'aria-label': 'Text', class: 'body-input' }, n.body || '');
  const preview = h('div', { class: 'note-preview prose', hidden: true });
  const quoteGroup = group({ head: 'Zitat', rows: [h('label', { class: 'cell stack' }, quote)] });
  const syncQuote = () => (quoteGroup.hidden = !(kind === 'quote' || quote.value.trim()));
  drawKinds();
  syncQuote();

  const previewBtn = h('button', {
    type: 'button',
    class: 'btn small',
    onClick: () => {
      const showing = !preview.hidden;
      preview.hidden = showing;
      body.hidden = !showing;
      previewBtn.textContent = showing ? 'Vorschau' : 'Bearbeiten';
      if (!showing) preview.innerHTML = renderMarkdown(body.value) || '<p class="muted">Noch nichts geschrieben.</p>';
    },
  }, 'Vorschau');

  const chapterInput = h('input', { type: 'text', placeholder: 'Kapitel (optional)', list: 'chapter-list', value: n.chapter || '', 'aria-label': 'Kapitel' });
  const chapterList = h('datalist', { id: 'chapter-list' });
  const links = h('div');
  const drawLinks = () => {
    const doc = n.documentId ? idx.doc.get(n.documentId) : null;
    chapterList.replaceChildren(...(doc?.toc || []).slice(0, 300).map((t) => h('option', { value: t.label })));
    const place = n.collectionId && idx.col.get(n.collectionId)
      ? placementLabel({ departmentId: idx.col.get(n.collectionId).departmentId, collectionId: n.collectionId })
      : n.departmentId && idx.dept.get(n.departmentId) ? idx.dept.get(n.departmentId).name : null;
    links.replaceChildren(
      group({
        head: 'Verknüpft mit',
        rows: [
          cell({ title: 'Buch', detail: doc ? doc.title : n.sourceTitle ? `${n.sourceTitle} (gelöscht)` : 'Keins', onClick: async () => {
            const id = await pickDocument({ title: 'Mit Buch verknüpfen' });
            if (id === null) return;
            n.documentId = id || null;
            if (!id) n.chapter = '';
            drawLinks();
          }, chevron: true }),
          doc ? h('label', { class: 'cell' }, h('span', { class: 'label' }, 'Kapitel'), chapterInput, chapterList) : null,
          cell({ title: 'Regal', detail: place || (doc ? 'wie das Buch' : 'Keins'), onClick: async () => {
            const t = await pickOne({ title: 'Mit Regal verknüpfen', confirm: 'Verknüpfen', rootLabel: 'Ganzes Regal', selected: n.departmentId ? [{ deptId: n.departmentId, colId: n.collectionId }] : [] });
            if (!t) return;
            n.departmentId = t.deptId;
            n.collectionId = t.colId;
            drawLinks();
          }, chevron: true }),
          place ? cell({ title: 'Regal-Verknüpfung lösen', accent: true, onClick: () => { n.departmentId = null; n.collectionId = null; drawLinks(); } }) : null,
        ],
      }),
    );
  };
  drawLinks();

  const backlinks = existing ? linksTo(existing) : [];

  const sheet = openSheet({
    title: existing ? 'Notiz bearbeiten' : 'Neue Notiz',
    tall: true,
    left: { label: 'Abbrechen' },
    right: {
      label: existing ? 'Sichern' : 'Hinzufügen',
      strong: true,
      onClick: async (close) => {
        if (!body.value.trim() && !quote.value.trim() && !title.value.trim()) {
          body.focus();
          toast('Erst etwas schreiben.');
          return false;
        }
        const chapter = n.documentId ? chapterInput.value.trim() : '';
        const tocHit = chapter && chapter !== n.chapter ? (idx.doc.get(n.documentId)?.toc || []).find((t) => t.label === chapter) : null;
        const saved = await saveNote({
          ...(existing ? { id: existing.id } : {}),
          kind,
          title: title.value.trim(),
          body: body.value,
          quote: quote.value.trim(),
          documentId: n.documentId || null,
          chapter,
          loc: tocHit ? tocHit.loc : n.documentId ? n.loc || null : null,
          highlightId: n.highlightId || null,
          departmentId: n.departmentId || null,
          collectionId: n.collectionId || null,
        });
        close(saved);
        if (!existing) toast('Notiz gespeichert', { action: { label: 'Öffnen', onClick: () => (location.hash = `#/scriptorium/${saved.id}`) } });
      },
    },
    body: h(
      'div',
      { class: 'note-editor' },
      kinds,
      group({ rows: [h('label', { class: 'cell' }, title)] }),
      quoteGroup,
      h('section', { class: 'group' }, h('h2', { class: 'group-head' }, h('span', null, 'Text'), previewBtn), h('div', { class: 'list' }, h('label', { class: 'cell stack' }, body, preview))),
      links,
      backlinks.length ? group({ head: 'Verweise von', rows: backlinks.map((b) => cell({ title: noteTitle(b), href: `#/scriptorium/${b.id}` })) }) : null,
      existing
        ? group({ rows: [cell({ title: 'Notiz löschen', danger: true, onClick: async () => {
            const ok = await confirmDialog({ title: 'Notiz löschen?', message: 'Das lässt sich nicht widerrufen.', confirm: 'Löschen', danger: true });
            if (!ok) return;
            await deleteNote(existing.id);
            sheet.close();
            if (location.hash.startsWith(`#/scriptorium/${existing.id}`)) location.hash = '#/scriptorium';
          } })] })
        : null,
    ),
  });
  return sheet;
}

/** Notes whose text mentions [[this note's title]]. */
export function linksTo(note) {
  const t = fold(noteTitle(note));
  if (!t) return [];
  return state.notes.filter((n) => n.id !== note.id && /\[\[/.test(n.body || '') && [...(n.body || '').matchAll(/\[\[([^\]]+)\]\]/g)].some((m) => fold(m[1]) === t));
}
