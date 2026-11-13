// The catalogue card: everything about one volume, opened by pulling it from the shelf.

import { h, fromHTML, formatBytes, formatDate, debounce, download, isTouch } from '../util.js';
import {
  idx, state, placementsOf, unassign, assignMany, moveDocs, addTag, removeTag, updateDocument, deleteDocuments,
  getFileBlob, scopeLabel, noteTitle, deleteBookmark, snapshotAssignments, restoreAssignments,
} from '../store.js';
import { kindLabel, noteKindLabel, FORMATS, KINDS, KIND_GROUPS, ALL_SPINE_COLORS } from '../kinds.js';
import { icon } from '../ui/icons.js';
import { openModal, confirmDialog, toast, showMenu } from '../ui/modal.js';
import { pickPlacements } from '../ui/picker.js';
import { coverEl, spineSpec } from './shelf.js';
import { openNoteEditor } from '../ui/noteEditor.js';
import { lookupDoi } from '../import/lookup.js';

const layer = () => document.getElementById('layer-drawer');
let current = null; // {docId, scope}

export function isDocPanelOpen() {
  return !!current;
}

export function openDocPanel(docId, scope = '') {
  const doc = idx.doc.get(docId);
  if (!doc) {
    closeDocPanel();
    return false;
  }
  const same = current && current.docId === docId;
  current = { docId, scope };
  const scrollTop = same ? layer().querySelector('.drawer-body')?.scrollTop || 0 : 0;
  layer().replaceChildren(drawer(doc, scope));
  document.documentElement.classList.add('drawer-open');
  const body = layer().querySelector('.drawer-body');
  if (body) body.scrollTop = scrollTop;
  const el = layer().querySelector('.drawer');
  if (!same) {
    void el.offsetWidth; // commit the closed position so the slide-in transition runs
    el.classList.add('in');
  } else el.classList.add('in', 'no-anim');
  return true;
}

export function refreshDocPanel() {
  if (current) {
    if (!idx.doc.has(current.docId)) dismiss();
    else openDocPanel(current.docId, current.scope);
  }
}

export function closeDocPanel() {
  if (!current) return;
  current = null;
  const d = layer().querySelector('.drawer');
  document.documentElement.classList.remove('drawer-open');
  if (d) {
    d.classList.remove('in', 'no-anim');
    setTimeout(() => {
      if (!current) layer().replaceChildren();
    }, 260);
  } else layer().replaceChildren();
}

/** Close by navigating, so the browser's back button and the URL stay in step. */
function dismiss() {
  const [base] = location.hash.split('?');
  if (location.hash.includes('doc=')) location.hash = base || '#/';
  else closeDocPanel();
}

function section(title, ...kids) {
  return h('section', { class: 'card-section' }, h('h3', { class: 'card-h' }, title), ...kids);
}

function drawer(doc, scope) {
  const prog = idx.progress.get(doc.id);
  const pct = Math.round((prog?.percent || 0) * 100);
  const readable = ['epub', 'pdf', 'text'].includes(doc.format);
  const tags = idx.tagsByDoc.get(doc.id) || [];
  const notes = (idx.notesByDoc.get(doc.id) || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const hls = idx.hlByDoc.get(doc.id) || [];
  const bms = (idx.bmByDoc.get(doc.id) || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const places = placementsOf(doc.id);
  const s = spineSpec(doc);

  // ----- actions
  const readBtn = readable
    ? h('a', { class: 'btn btn-primary card-read', href: `#/read/${doc.id}` }, fromHTML(icon('book')), pct > 0 && pct < 99 ? `Continue reading · ${pct}%` : pct >= 99 ? 'Read again' : 'Begin reading')
    : doc.format === 'file'
      ? h('button', { type: 'button', class: 'btn btn-primary card-read', onClick: () => openOriginal(doc) }, fromHTML(icon('download')), 'Open the original file')
      : null;

  const moreBtn = h('button', {
    type: 'button',
    class: 'icon-btn',
    'aria-label': 'More actions',
    html: icon('dots'),
    onClick: (e) =>
      showMenu(e.currentTarget, [
        { label: 'Edit catalogue entry', icon: 'pen', onClick: () => editDocumentDialog(doc) },
        doc.fileId ? { label: 'Download original file', icon: 'download', onClick: () => openOriginal(doc, true) } : null,
        doc.doi ? { label: 'Open DOI record', icon: 'link', onClick: () => window.open(`https://doi.org/${doc.doi}`, '_blank', 'noopener') } : null,
        '-',
        { label: 'Delete from the library…', icon: 'trash', danger: true, onClick: () => deleteDialog(doc) },
      ].filter(Boolean)),
  });

  // ----- shelves
  const placeRows = places.map((p) =>
    h(
      'li',
      { class: 'place-row' },
      h('a', { class: 'place-link', href: p.collectionId ? `#/room/${p.departmentId}/${p.collectionId}` : `#/room/${p.departmentId}` }, p.label),
      h('button', {
        type: 'button',
        class: 'icon-btn small',
        'aria-label': `Take off ${p.label}`,
        title: 'Take off this shelf (the volume stays in the library)',
        html: icon('close'),
        onClick: async () => {
          const snap = snapshotAssignments([doc.id]);
          await unassign(p.id);
          toast(places.length === 1 ? 'Taken off its last shelf. It now waits on the returns table.' : `Taken off ${p.label}.`, {
            action: { label: 'Undo', onClick: () => restoreAssignments([doc.id], snap) },
          });
        },
      }),
    ),
  );

  const shelveAlso = h('button', {
    type: 'button',
    class: 'btn btn-ghost small',
    onClick: async () => {
      const t = await pickPlacements({ title: `Also shelve “${doc.title}” in…`, confirm: 'Shelve also here', selected: [] });
      if (t) {
        await assignMany([doc.id], t);
        toast('Shelved. The volume itself was not copied.');
      }
    },
  }, fromHTML(icon('plus')), 'Also shelve in…');

  const moveBtn = h('button', {
    type: 'button',
    class: 'btn btn-ghost small',
    onClick: async () => {
      const from = scope && places.some((p) => p) ? scope : '';
      const t = await pickPlacements({
        title: `Move “${doc.title}” to…`,
        subtitle: from ? `It leaves ${scopeLabel(from)}. Its other shelves stay as they are.` : 'It leaves all its current shelves.',
        confirm: 'Move',
      });
      if (!t) return;
      const snap = snapshotAssignments([doc.id]);
      await moveDocs([doc.id], from, t);
      toast('Moved.', { action: { label: 'Undo', onClick: () => restoreAssignments([doc.id], snap) } });
    },
  }, fromHTML(icon('move')), scope ? 'Move from here…' : 'Move…');

  // ----- tags
  const tagInput = h('input', { class: 'tag-input', type: 'text', placeholder: 'Add a tag…', list: 'gl-tag-list', 'aria-label': 'Add a tag' });
  tagInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = tagInput.value.trim();
      if (v) await addTag([doc.id], v);
    }
  });
  const tagList = h('datalist', { id: 'gl-tag-list' }, state.tags.map((t) => h('option', { value: t.name })));

  // ----- remarks
  const remarks = h('textarea', { class: 'remarks', rows: 3, placeholder: 'Private remarks on this volume…', 'data-fk': `remarks-${doc.id}` }, doc.remarks || '');
  const saveRemarks = debounce((v) => updateDocument(doc.id, { remarks: v }), 700);
  remarks.addEventListener('input', () => saveRemarks(remarks.value));
  remarks.addEventListener('blur', () => saveRemarks.flush());

  // ----- table of contents
  const toc = (doc.toc || []).slice(0, 400);
  const tocEl = toc.length
    ? h(
        'details',
        { class: 'card-toc' },
        h('summary', null, `Contents · ${toc.length} ${toc.length === 1 ? 'entry' : 'entries'}`),
        h(
          'ol',
          { class: 'toc-list' },
          toc.map((t) =>
            h(
              'li',
              { class: 'toc-row', style: { '--depth': t.depth || 0 } },
              readable ? h('a', { href: `#/read/${doc.id}?loc=${encodeURIComponent(JSON.stringify(t.loc || {}))}` }, t.label) : h('span', null, t.label),
              h('button', {
                type: 'button',
                class: 'toc-sum',
                title: 'Write a summary of this chapter',
                'aria-label': `Summarise ${t.label}`,
                html: icon('quill'),
                onClick: () => openNoteEditor({ kind: 'summary', documentId: doc.id, chapter: t.label, loc: t.loc || null, title: `Summary: ${t.label}` }),
              }),
            ),
          ),
        ),
      )
    : null;

  const head = h(
    'header',
    { class: 'drawer-head' },
    h('span', { class: 'drawer-kicker' }, 'Catalogue card'),
    h('div', { class: 'drawer-head-actions' }, moreBtn, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', html: icon('close'), onClick: dismiss })),
  );

  const body = h(
    'div',
    { class: 'drawer-body' },
    h(
      'div',
      { class: 'card-top' },
      coverEl(doc, 'card-cover'),
      h(
        'div',
        { class: 'card-ident' },
        h('h2', { class: 'card-title' }, doc.title || 'Untitled'),
        doc.author ? h('p', { class: 'card-author' }, doc.author) : null,
        h('p', { class: 'card-meta' }, [kindLabel(doc.kind), doc.year, doc.pages ? `${doc.pages} pages` : null].filter(Boolean).join(' · ')),
        pct > 0 ? h('div', { class: 'card-progress', style: { '--p': `${pct}%` }, title: `${pct}% read` }) : null,
      ),
    ),
    h('div', { class: 'card-actions' }, readBtn, h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => editDocumentDialog(doc) }, fromHTML(icon('pen')), 'Edit')),
    section(
      'Shelved in',
      places.length ? h('ul', { class: 'place-list' }, placeRows) : h('p', { class: 'muted' }, 'Not on any shelf. It waits on the returns table.'),
      h('div', { class: 'row-actions' }, shelveAlso, places.length ? moveBtn : null),
    ),
    section(
      'Tags',
      h(
        'div',
        { class: 'tag-row' },
        tags.map((t) =>
          h(
            'span',
            { class: 'tag-chip' },
            h('a', { href: `#/tag/${t.id}` }, t.name),
            h('button', { type: 'button', class: 'tag-x', 'aria-label': `Remove tag ${t.name}`, onClick: () => removeTag([doc.id], t.id) }, '×'),
          ),
        ),
        tagInput,
        tagList,
      ),
    ),
    section(
      'Knowledge',
      notes.length
        ? h(
            'ul',
            { class: 'note-list' },
            notes.map((n) =>
              h(
                'li',
                null,
                h(
                  'a',
                  { class: 'note-link', href: `#/scriptorium/${n.id}` },
                  h('span', { class: `note-kind k-${n.kind}` }, noteKindLabel(n.kind)),
                  h('span', { class: 'note-title' }, noteTitle(n)),
                  n.chapter ? h('span', { class: 'note-chapter' }, n.chapter) : null,
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'No summaries, thoughts or quotations yet.'),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost small', onClick: () => openNoteEditor({ kind: 'summary', documentId: doc.id, title: `Summary of ${doc.title}` }) }, fromHTML(icon('quill')), 'Summary'),
        h('button', { type: 'button', class: 'btn btn-ghost small', onClick: () => openNoteEditor({ kind: 'thought', documentId: doc.id }) }, fromHTML(icon('lamp')), 'Own thought'),
        h('button', { type: 'button', class: 'btn btn-ghost small', onClick: () => openNoteEditor({ kind: 'quote', documentId: doc.id }) }, fromHTML(icon('scroll')), 'Quotation'),
      ),
      hls.length ? h('p', { class: 'muted small' }, `${hls.length} ${hls.length === 1 ? 'passage' : 'passages'} marked while reading. `, h('a', { href: `#/scriptorium?doc=${doc.id}&kind=marks` }, 'Show marginalia')) : null,
    ),
    bms.length
      ? section(
          'Bookmarks',
          h(
            'ul',
            { class: 'bm-list' },
            bms.map((b) =>
              h(
                'li',
                { class: 'bm-row' },
                h('a', { href: `#/read/${doc.id}?loc=${encodeURIComponent(JSON.stringify(b.loc))}` }, fromHTML(icon('ribbonFill')), b.label || 'Bookmark'),
                h('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Remove bookmark', html: icon('close'), onClick: () => deleteBookmark(b.id) }),
              ),
            ),
          ),
        )
      : null,
    tocEl,
    doc.description ? section('About this volume', h('p', { class: 'card-desc' }, doc.description)) : null,
    section('Remarks', remarks),
    section(
      'Particulars',
      h(
        'dl',
        { class: 'particulars' },
        row('Type', kindLabel(doc.kind)),
        row('Format', FORMATS[doc.format] || doc.format),
        row('Publisher', doc.publisher),
        row('Published', doc.year),
        row('Language', doc.language),
        row('ISBN', doc.isbn),
        row('DOI', doc.doi ? h('a', { href: `https://doi.org/${doc.doi}`, target: '_blank', rel: 'noopener' }, doc.doi) : null),
        row('Pages', doc.pages),
        row('File', doc.fileName ? `${doc.fileName} · ${formatBytes(doc.fileSize)}` : null),
        row('Acquired', formatDate(doc.createdAt)),
      ),
    ),
  );

  return h(
    'div',
    { class: 'drawer-wrap' },
    h('div', { class: 'drawer-scrim', onClick: dismiss }),
    h('aside', { class: 'drawer', style: { '--c': s.color }, role: 'dialog', 'aria-label': `Catalogue card: ${doc.title}` }, head, body),
  );
}

function row(k, v) {
  if (v == null || v === '') return null;
  return [h('dt', null, k), h('dd', null, v)];
}

async function openOriginal(doc, forceDownload = false) {
  const t = toast('Fetching the file…', { timeout: 0 });
  try {
    const blob = await getFileBlob(doc.fileId);
    t();
    if (!blob) {
      toast('The file is not on this device and could not be fetched from the cloud.', { kind: 'error' });
      return;
    }
    if (forceDownload || isTouch()) download(blob, doc.fileName || `${doc.title}`);
    else {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch (e) {
    t();
    toast(e.message, { kind: 'error' });
  }
}

async function deleteDialog(doc) {
  const notes = (idx.notesByDoc.get(doc.id) || []).length;
  const keep = h('input', { type: 'checkbox', checked: true });
  const ok = await confirmDialog({
    title: `Delete “${doc.title}”?`,
    message: h(
      'div',
      null,
      h('p', { class: 'modal-text' }, 'The volume is removed from every room, with its file, highlights, bookmarks and reading progress. This cannot be undone.'),
      notes ? h('label', { class: 'check-row' }, keep, ` Keep my ${notes} ${notes === 1 ? 'note' : 'notes'} about it in the Scriptorium`) : null,
    ),
    confirm: 'Delete for good',
    danger: true,
  });
  if (!ok) return;
  await deleteDocuments([doc.id], { keepNotes: keep.checked });
  dismiss();
  toast('Deleted.');
}

// ---------------------------------------------------------------- edit dialog

export function kindSelect(value) {
  return h(
    'select',
    { class: 'field-input' },
    KIND_GROUPS.map((g) => h('optgroup', { label: g }, KINDS.filter((k) => k.group === g).map((k) => h('option', { value: k.id, selected: k.id === value ? true : null }, k.label)))),
  );
}

export function editDocumentDialog(doc) {
  const f = {};
  const field = (key, label, attrs = {}, multiline = false) => {
    const el = multiline
      ? h('textarea', { class: 'field-input', rows: attrs.rows || 4, ...attrs }, doc[key] || '')
      : h('input', { class: 'field-input', type: 'text', value: doc[key] ?? '', ...attrs });
    f[key] = el;
    return h('label', { class: `field ${attrs.wide ? 'wide' : ''}` }, h('span', { class: 'field-label' }, label), el);
  };
  const kind = kindSelect(doc.kind);
  let color = doc.spineColor || null;
  const swatches = h('div', { class: 'swatch-row small' });
  const drawSw = () =>
    swatches.replaceChildren(
      h('button', { type: 'button', class: `swatch auto ${!color ? 'on' : ''}`, title: 'Chosen by the binder', 'aria-label': 'Automatic colour', onClick: () => { color = null; drawSw(); } }, 'auto'),
      ...ALL_SPINE_COLORS.map((c) => h('button', { type: 'button', class: `swatch ${c === color ? 'on' : ''}`, style: { '--c': c }, 'aria-label': c, onClick: () => { color = c; drawSw(); } })),
    );
  drawSw();

  const doiBtn = h('button', {
    type: 'button',
    class: 'btn btn-ghost small',
    onClick: async () => {
      const doi = f.doi.value.trim();
      if (!doi) return toast('Enter a DOI first.');
      doiBtn.disabled = true;
      try {
        const m = await lookupDoi(doi);
        for (const k of ['title', 'author', 'year', 'publisher', 'description']) if (m[k] && f[k] && !f[k].value.trim()) f[k].value = m[k];
        if (m.title) f.title.value = m.title;
        toast('Details filled in from the DOI record.');
      } catch (e) {
        toast(e.message, { kind: 'error' });
      }
      doiBtn.disabled = false;
    },
  }, 'Fill in from DOI');

  openModal({
    title: 'Edit catalogue entry',
    wide: true,
    body: h(
      'div',
      { class: 'form-grid two' },
      field('title', 'Title', { wide: true }),
      field('author', 'Author(s)', { placeholder: 'Separate several with “;”' }),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Type'), kind),
      field('year', 'Year', { inputmode: 'numeric' }),
      field('publisher', 'Publisher or journal'),
      field('language', 'Language'),
      field('pages', 'Pages', { inputmode: 'numeric' }),
      field('isbn', 'ISBN'),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'DOI'), h('div', { class: 'inline' }, (f.doi = h('input', { class: 'field-input', type: 'text', value: doc.doi || '' })), doiBtn)),
      field('description', 'Description', { wide: true, rows: 5 }, true),
      h('div', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Colour of the binding'), swatches),
    ),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save',
        primary: true,
        onClick: async (close) => {
          const patch = {};
          for (const [k, el] of Object.entries(f)) patch[k] = el.value.trim();
          patch.pages = patch.pages ? parseInt(patch.pages, 10) || null : null;
          patch.kind = kind.value;
          patch.spineColor = color;
          if (!patch.title) patch.title = 'Untitled';
          await updateDocument(doc.id, patch);
          close();
        },
      },
    ],
  });
}
