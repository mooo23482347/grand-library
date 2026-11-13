// Writing desk for one entry of the Scriptorium: a note, summary, thought, theory or quotation,
// bound to a volume, a chapter, a passage and a room.

import { h, fromHTML, fold, renderMarkdown } from '../util.js';
import { idx, state, saveNote, deleteNote, placementLabel, noteTitle } from '../store.js';
import { NOTE_KINDS, kindLabel } from '../kinds.js';
import { openModal, confirmDialog, toast } from './modal.js';
import { pickOne } from './picker.js';
import { icon } from './icons.js';

export function pickDocument({ title = 'Choose a volume' } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'field-input', type: 'search', placeholder: 'Title or author…', 'aria-label': 'Search volumes' });
    const list = h('div', { class: 'doc-pick-list' });
    const draw = () => {
      const q = fold(input.value.trim());
      const res = state.documents
        .filter((d) => !q || fold(`${d.title} ${d.author}`).includes(q))
        .sort((a, b) => a.title.localeCompare(b.title))
        .slice(0, 40);
      list.replaceChildren(
        ...res.map((d) =>
          h(
            'button',
            { type: 'button', class: 'doc-pick', onClick: () => m.close(d.id) },
            h('span', { class: 'dp-title' }, d.title),
            h('span', { class: 'dp-meta' }, [d.author, kindLabel(d.kind)].filter(Boolean).join(' · ')),
          ),
        ),
      );
      if (!res.length) list.append(h('p', { class: 'muted' }, 'No volume found.'));
    };
    input.addEventListener('input', draw);
    draw();
    const m = openModal({
      title,
      body: h('div', { class: 'doc-picker' }, input, list),
      actions: [{ label: 'No volume', onClick: (close) => close('') }, { label: 'Cancel', onClick: (close) => close(null) }],
      onClose: (r) => resolve(typeof r === 'string' ? r : null),
    });
  });
}

/** fields: an existing note, or the start of a new one ({kind, documentId, chapter, loc, quote, ...}). */
export function openNoteEditor(fields = {}) {
  const existing = fields.id ? idx.note.get(fields.id) : null;
  const n = { kind: 'note', title: '', body: '', quote: '', documentId: null, chapter: '', loc: null, highlightId: null, departmentId: null, collectionId: null, ...(existing || {}), ...fields };

  const kind = h('select', { class: 'field-input', 'aria-label': 'Kind of entry' }, NOTE_KINDS.map((k) => h('option', { value: k.id, selected: k.id === n.kind ? true : null }, k.label)));
  const title = h('input', { class: 'field-input', type: 'text', value: n.title || '', placeholder: 'Title (optional)' });
  const quote = h('textarea', { class: 'field-input quote-input', rows: 3, placeholder: 'The quoted passage' }, n.quote || '');
  const body = h('textarea', { class: 'field-input body-input', rows: 10, placeholder: 'Write here. **bold**, *italic*, # heading, - list, > quote, [[Title of another note or volume]]' }, n.body || '');
  const preview = h('div', { class: 'note-preview prose', hidden: true });
  const quoteField = h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Quotation'), quote);
  const syncQuote = () => {
    quoteField.hidden = !(kind.value === 'quote' || quote.value.trim());
  };
  kind.addEventListener('change', syncQuote);
  syncQuote();

  const togglePreview = h('button', {
    type: 'button',
    class: 'btn btn-ghost small',
    onClick: () => {
      const showing = !preview.hidden;
      preview.hidden = showing;
      body.hidden = !showing;
      togglePreview.textContent = showing ? 'Preview' : 'Write';
      if (!showing) preview.innerHTML = renderMarkdown(body.value) || '<p class="muted">Nothing written yet.</p>';
    },
  }, 'Preview');

  // ----- bindings
  const bindings = h('div', { class: 'bindings' });
  const chapterInput = h('input', { class: 'field-input', type: 'text', placeholder: 'Chapter or section (optional)', list: 'gl-chapter-list', value: n.chapter || '' });
  const chapterList = h('datalist', { id: 'gl-chapter-list' });
  const drawBindings = () => {
    const doc = n.documentId ? idx.doc.get(n.documentId) : null;
    chapterList.replaceChildren(...(doc?.toc || []).slice(0, 300).map((t) => h('option', { value: t.label })));
    const place = n.collectionId && idx.col.get(n.collectionId)
      ? placementLabel({ departmentId: idx.col.get(n.collectionId).departmentId, collectionId: n.collectionId })
      : n.departmentId && idx.dept.get(n.departmentId) ? idx.dept.get(n.departmentId).name : null;
    bindings.replaceChildren(
      h(
        'div',
        { class: 'binding-row' },
        h('span', { class: 'binding-k' }, 'Volume'),
        h('span', { class: 'binding-v' }, doc ? doc.title : n.sourceTitle ? `${n.sourceTitle} (removed from the library)` : 'None'),
        h('button', {
          type: 'button',
          class: 'btn btn-ghost small',
          onClick: async () => {
            const id = await pickDocument({ title: 'Bind this entry to a volume' });
            if (id === null) return;
            n.documentId = id || null;
            if (!id) n.chapter = '';
            drawBindings();
          },
        }, doc ? 'Change' : 'Choose…'),
      ),
      doc ? h('div', { class: 'binding-row' }, h('span', { class: 'binding-k' }, 'Chapter'), chapterInput, chapterList) : null,
      h(
        'div',
        { class: 'binding-row' },
        h('span', { class: 'binding-k' }, 'Room'),
        h('span', { class: 'binding-v' }, place || (doc ? 'Wherever the volume stands' : 'None')),
        h('button', {
          type: 'button',
          class: 'btn btn-ghost small',
          onClick: async () => {
            const t = await pickOne({ title: 'Bind this entry to a room or collection', confirm: 'Bind', rootLabel: 'The room as a whole', selected: n.departmentId ? [{ deptId: n.departmentId, colId: n.collectionId }] : [] });
            if (!t) return;
            n.departmentId = t.deptId;
            n.collectionId = t.colId;
            drawBindings();
          },
        }, place ? 'Change' : 'Choose…'),
        place ? h('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Unbind room', html: icon('close'), onClick: () => { n.departmentId = null; n.collectionId = null; drawBindings(); } }) : null,
      ),
    );
  };
  drawBindings();

  const backlinks = existing ? linksTo(existing) : [];

  const actions = [];
  if (existing) {
    actions.push({
      label: 'Delete',
      danger: true,
      className: 'btn-left',
      onClick: async (close) => {
        const ok = await confirmDialog({ title: 'Delete this entry?', message: 'It is removed from the Scriptorium. This cannot be undone.', confirm: 'Delete', danger: true });
        if (!ok) return false;
        await deleteNote(existing.id);
        close();
        if (location.hash.startsWith(`#/scriptorium/${existing.id}`)) location.hash = '#/scriptorium';
      },
    });
  }
  actions.push({ label: 'Cancel' });
  actions.push({
    label: existing ? 'Save' : 'Add to the Scriptorium',
    primary: true,
    onClick: async (close) => {
      if (!body.value.trim() && !quote.value.trim() && !title.value.trim()) {
        body.focus();
        toast('Write something first.');
        return false;
      }
      const chapter = n.documentId ? chapterInput.value.trim() : '';
      const tocHit = chapter && chapter !== n.chapter ? (idx.doc.get(n.documentId)?.toc || []).find((t) => t.label === chapter) : null;
      const saved = await saveNote({
        ...(existing ? { id: existing.id } : {}),
        kind: kind.value,
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
      if (!existing) toast('Written into the Scriptorium.', { action: { label: 'Open', onClick: () => (location.hash = `#/scriptorium/${saved.id}`) } });
    },
  });

  return openModal({
    title: existing ? 'Edit entry' : 'New entry for the Scriptorium',
    wide: true,
    className: 'note-modal',
    body: h(
      'div',
      { class: 'form-grid two' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Kind'), kind),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Title'), title),
      quoteField,
      h('div', { class: 'field wide' }, h('div', { class: 'field-label-row' }, h('span', { class: 'field-label' }, 'Text'), togglePreview), body, preview),
      h('div', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Bound to'), bindings),
      backlinks.length
        ? h('div', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Referred to by'), h('ul', { class: 'backlinks' }, backlinks.map((b) => h('li', null, h('a', { href: `#/scriptorium/${b.id}` }, noteTitle(b))))))
        : null,
    ),
    actions,
  });
}

/** Entries whose text mentions [[this entry's title]]. */
export function linksTo(note) {
  const t = fold(noteTitle(note));
  if (!t) return [];
  return state.notes.filter((n) => n.id !== note.id && /\[\[/.test(n.body || '') && [...(n.body || '').matchAll(/\[\[([^\]]+)\]\]/g)].some((m) => fold(m[1]) === t));
}

export const quillIcon = () => fromHTML(icon('quill'));
