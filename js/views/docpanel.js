// The catalogue card of one book: a sheet on the phone, an inspector panel on the desktop.

import { h, fromHTML, formatBytes, formatDate, debounce, download, isTouch } from '../util.js';
import {
  idx, state, placementsOf, unassign, assignMany, moveDocs, addTag, removeTag, updateDocument, deleteDocuments,
  getFileBlob, scopeLabel, noteTitle, deleteBookmark, snapshotAssignments, restoreAssignments,
} from '../store.js';
import { kindLabel, noteKind, FORMATS, KINDS, KIND_GROUPS, COVER_COLORS } from '../kinds.js';
import { icon } from '../ui/icons.js';
import { openSheet, confirmDialog, toast, showMenu, isDesktop } from '../ui/modal.js';
import { group, cell } from '../ui/controls.js';
import { pickPlacements } from '../ui/picker.js';
import { coverEl } from './covers.js';
import { openNoteEditor } from '../ui/noteEditor.js';
import { lookupDoi } from '../import/lookup.js';

let current = null; // { docId, scope, sheet }

export function isDocPanelOpen() {
  return !!current;
}

export function openDocPanel(docId, scope = '') {
  const doc = idx.doc.get(docId);
  if (!doc) {
    closeDocPanel();
    return false;
  }
  if (current?.docId === docId) {
    current.scope = scope;
    refreshDocPanel();
    return true;
  }
  closeDocPanel();
  const body = h('div', { class: 'card' });
  const sheet = openSheet({
    title: '',
    tall: !isDesktop(),
    panel: isDesktop(),
    className: 'card-sheet',
    right: null,
    body,
    onClose: () => {
      const wasCurrent = current?.sheet === sheet;
      current = null;
      if (wasCurrent && location.hash.includes('doc=')) location.hash = location.hash.split('?')[0] || '#/';
    },
  });
  current = { docId, scope, sheet, body };
  draw();
  return true;
}

export function refreshDocPanel() {
  if (!current) return;
  if (!idx.doc.has(current.docId)) return closeDocPanel();
  const scroller = current.sheet.body;
  const top = scroller.scrollTop;
  draw();
  scroller.scrollTop = top;
}

export function closeDocPanel() {
  if (!current) return;
  const s = current.sheet;
  current = null;
  s.close();
}

function draw() {
  const { docId, scope, body } = current;
  const doc = idx.doc.get(docId);
  body.replaceChildren(...card(doc, scope));
}

function card(doc, scope) {
  const prog = idx.progress.get(doc.id);
  const pct = Math.round((prog?.percent || 0) * 100);
  const readable = ['epub', 'pdf', 'text'].includes(doc.format);
  const tags = idx.tagsByDoc.get(doc.id) || [];
  const notes = [...(idx.notesByDoc.get(doc.id) || [])].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const hls = idx.hlByDoc.get(doc.id) || [];
  const bms = [...(idx.bmByDoc.get(doc.id) || [])].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const places = placementsOf(doc.id);

  const meta = [doc.year, doc.pages ? `${doc.pages} Seiten` : null, FORMATS[doc.format]].filter(Boolean).join(' · ');
  const readLabel = pct > 0 && pct < 99 ? `Weiterlesen · ${pct} %` : pct >= 99 ? 'Noch einmal lesen' : 'Lesen';

  const top = h(
    'div',
    { class: 'card-top' },
    coverEl(doc, 'card-cover'),
    h('h2', { class: 'card-title' }, doc.title || 'Ohne Titel'),
    doc.author ? h('p', { class: 'card-author' }, doc.author) : null,
    h('p', { class: 'card-meta' }, [kindLabel(doc.kind), meta].filter(Boolean).join(' · ')),
    readable
      ? h('a', { class: 'btn filled block', href: `#/read/${doc.id}` }, fromHTML(icon('bookOpen')), readLabel)
      : doc.format === 'file'
        ? h('button', { type: 'button', class: 'btn filled block', onClick: () => openOriginal(doc) }, fromHTML(icon('download')), 'Datei öffnen')
        : null,
    pct > 0 ? h('div', { class: 'card-progress' }, h('span', { class: 'progress' }, h('span', { style: { width: `${pct}%` } })), h('span', null, `${pct} % gelesen`)) : null,
    h('div', { class: 'card-quick' },
      quick('pencil', 'Bearbeiten', () => editDocumentDialog(doc)),
      quick('bulb', 'Gedanke', () => openNoteEditor({ kind: 'thought', documentId: doc.id })),
      quick('quote', 'Zitat', () => openNoteEditor({ kind: 'quote', documentId: doc.id })),
      quick('dots', 'Mehr', (e) => moreMenu(e.currentTarget, doc)),
    ),
  );

  // shelves
  const placeRows = places.map((p) =>
    h(
      'div',
      { class: 'cell' },
      h('a', { class: 'cell-main', href: p.collectionId ? `#/room/${p.departmentId}/${p.collectionId}` : `#/room/${p.departmentId}` }, h('span', { class: 'cell-title' }, p.label)),
      h('button', {
        type: 'button',
        class: 'icon-btn circle',
        'aria-label': `Aus ${p.label} entfernen`,
        title: 'Aus diesem Regal entfernen (das Buch bleibt erhalten)',
        html: icon('minus'),
        onClick: async () => {
          const snap = snapshotAssignments([doc.id]);
          await unassign(p.id);
          toast(places.length === 1 ? 'Jetzt „Ohne Regal“' : `Aus ${p.label} entfernt`, { action: { label: 'Widerrufen', onClick: () => restoreAssignments([doc.id], snap) } });
        },
      }),
    ),
  );
  if (!places.length) placeRows.push(cell({ title: 'In keinem Regal', sub: 'Steht unter „Ohne Regal“' }));
  placeRows.push(
    cell({ title: 'Auch einordnen in …', accent: true, onClick: async () => {
      const t = await pickPlacements({ title: 'Auch einordnen in', confirm: 'Einordnen' });
      if (t) {
        await assignMany([doc.id], t);
        toast('Eingeordnet – das Buch wurde nicht kopiert');
      }
    } }),
  );
  if (places.length) {
    placeRows.push(
      cell({ title: scope ? 'Verschieben …' : 'Verschieben …', accent: true, onClick: async () => {
        const t = await pickPlacements({ title: 'Verschieben nach', subtitle: scope ? `Es verlässt ${scopeLabel(scope)}; andere Regale bleiben.` : 'Es verlässt alle bisherigen Regale.', confirm: 'Verschieben' });
        if (!t) return;
        const snap = snapshotAssignments([doc.id]);
        await moveDocs([doc.id], scope, t);
        toast('Verschoben', { action: { label: 'Widerrufen', onClick: () => restoreAssignments([doc.id], snap) } });
      } }),
    );
  }

  // tags
  const tagInput = h('input', { type: 'text', class: 'tag-input', placeholder: 'Tag hinzufügen', list: 'tag-suggestions', 'aria-label': 'Tag hinzufügen', enterkeyhint: 'done' });
  tagInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = tagInput.value.trim();
      if (v) await addTag([doc.id], v);
    }
  });
  const tagRow = h(
    'div',
    { class: 'cell stack' },
    h('div', { class: 'chips' },
      tags.map((t) => h('span', { class: 'chip' }, h('a', { href: `#/tag/${t.id}` }, t.name), h('button', { type: 'button', class: 'x', 'aria-label': `Tag ${t.name} entfernen`, html: icon('close'), onClick: () => removeTag([doc.id], t.id) }))),
    ),
    tagInput,
    h('datalist', { id: 'tag-suggestions' }, state.tags.map((t) => h('option', { value: t.name }))),
  );

  // notes
  const noteRows = notes.map((n) => {
    const k = noteKind(n.kind);
    return cell({ title: noteTitle(n), sub: [k.label, n.chapter].filter(Boolean).join(' · '), href: `#/scriptorium/${n.id}`, icon: k.icon, tint: 'var(--accent)' });
  });
  noteRows.push(
    h('div', { class: 'cell note-actions' },
      h('button', { type: 'button', class: 'btn small tinted', onClick: () => openNoteEditor({ kind: 'summary', documentId: doc.id, title: `Zusammenfassung: ${doc.title}` }) }, 'Zusammenfassung'),
      h('button', { type: 'button', class: 'btn small tinted', onClick: () => openNoteEditor({ kind: 'thought', documentId: doc.id }) }, 'Gedanke'),
      h('button', { type: 'button', class: 'btn small tinted', onClick: () => openNoteEditor({ kind: 'quote', documentId: doc.id }) }, 'Zitat'),
    ),
  );
  if (hls.length) noteRows.push(cell({ title: `${hls.length} ${hls.length === 1 ? 'Markierung' : 'Markierungen'}`, href: `#/scriptorium?doc=${doc.id}&kind=marks`, icon: 'highlighter', tint: 'var(--warn)' }));

  // remarks
  const remarks = h('textarea', { rows: 3, placeholder: 'Eigene Anmerkungen zu diesem Buch …', 'data-fk': `remarks-${doc.id}`, 'aria-label': 'Anmerkungen' }, doc.remarks || '');
  const saveRemarks = debounce((v) => updateDocument(doc.id, { remarks: v }), 700);
  remarks.addEventListener('input', () => saveRemarks(remarks.value));
  remarks.addEventListener('blur', () => saveRemarks.flush());

  const toc = (doc.toc || []).slice(0, 300);
  const details = [
    ['Art', kindLabel(doc.kind)],
    ['Format', FORMATS[doc.format] || doc.format],
    ['Verlag', doc.publisher],
    ['Jahr', doc.year],
    ['Sprache', doc.language],
    ['Seiten', doc.pages],
    ['ISBN', doc.isbn],
    ['DOI', doc.doi],
    ['Datei', doc.fileName ? `${doc.fileName} · ${formatBytes(doc.fileSize)}` : null],
    ['Hinzugefügt', formatDate(doc.createdAt)],
  ].filter(([, v]) => v != null && v !== '');

  return [
    top,
    group({ head: 'Regale', rows: placeRows }),
    group({ head: 'Tags', rows: [tagRow] }),
    group({ head: 'Notizen', rows: noteRows, icons: true }),
    bms.length
      ? group({ head: 'Lesezeichen', rows: bms.map((b) => h('div', { class: 'cell' }, h('a', { class: 'cell-main', href: `#/read/${doc.id}?loc=${encodeURIComponent(JSON.stringify(b.loc))}` }, h('span', { class: 'cell-title' }, b.label || 'Lesezeichen')), h('button', { type: 'button', class: 'icon-btn circle', 'aria-label': 'Lesezeichen entfernen', html: icon('minus'), onClick: () => deleteBookmark(b.id) }))) })
      : null,
    toc.length
      ? h('details', { class: 'group card-toc' }, h('summary', { class: 'group-head' }, h('span', null, `Inhalt · ${toc.length}`), fromHTML(icon('down'))), h('ul', { class: 'list' }, toc.map((t) => h('li', null, h('div', { class: 'cell toc-cell', style: { '--depth': t.depth || 0 } },
          readable ? h('a', { class: 'cell-main', href: `#/read/${doc.id}?loc=${encodeURIComponent(JSON.stringify(t.loc || {}))}` }, h('span', { class: 'cell-title' }, t.label)) : h('span', { class: 'cell-main' }, h('span', { class: 'cell-title' }, t.label)),
          h('button', { type: 'button', class: 'icon-btn plain', 'aria-label': `${t.label} zusammenfassen`, title: 'Kapitel zusammenfassen', html: icon('fileText'), onClick: () => openNoteEditor({ kind: 'summary', documentId: doc.id, chapter: t.label, loc: t.loc || null, title: `Zusammenfassung: ${t.label}` }) }),
        ))))) : null,
    doc.description ? group({ head: 'Beschreibung', rows: [h('div', { class: 'cell stack' }, h('p', { class: 'card-desc' }, doc.description))] }) : null,
    group({ head: 'Anmerkungen', rows: [h('label', { class: 'cell stack' }, remarks)] }),
    group({ head: 'Details', rows: details.map(([k, v]) => cell({ title: k, detail: String(v) })) }),
  ];
}

function quick(ic, label, onClick) {
  return h('button', { type: 'button', class: 'quick', onClick }, h('span', { class: 'quick-icon', html: icon(ic) }), h('span', null, label));
}

function moreMenu(anchor, doc) {
  showMenu(anchor, [
    { label: 'Angaben bearbeiten', icon: 'pencil', onClick: () => editDocumentDialog(doc) },
    doc.fileId ? { label: 'Originaldatei laden', icon: 'download', onClick: () => openOriginal(doc, true) } : null,
    doc.format === 'pdf' ? { label: 'Original-PDF ansehen', icon: 'file', onClick: () => (location.hash = `#/read/${doc.id}?view=original`) } : null,
    doc.doi ? { label: 'DOI-Eintrag öffnen', icon: 'link', onClick: () => window.open(`https://doi.org/${doc.doi}`, '_blank', 'noopener') } : null,
    '-',
    { label: 'Aus der Bibliothek löschen', icon: 'trash', danger: true, onClick: () => deleteDialog(doc) },
  ]);
}

async function openOriginal(doc, forceDownload = false) {
  const t = toast('Datei wird geladen …', { timeout: 0 });
  try {
    const blob = await getFileBlob(doc.fileId);
    t();
    if (!blob) return toast('Die Datei ist auf diesem Gerät nicht vorhanden und konnte nicht geladen werden.');
    if (forceDownload || isTouch()) download(blob, doc.fileName || doc.title);
    else {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch (e) {
    t();
    toast(e.message);
  }
}

async function deleteDialog(doc) {
  const notes = (idx.notesByDoc.get(doc.id) || []).length;
  const r = await confirmDialog({
    title: `„${doc.title}“ löschen?`,
    message: 'Das Buch verschwindet aus allen Regalen, mit Datei, Markierungen, Lesezeichen und Lesefortschritt. Das lässt sich nicht widerrufen.',
    confirm: 'Löschen',
    danger: true,
    check: notes ? { label: `${notes} ${notes === 1 ? 'Notiz' : 'Notizen'} behalten`, checked: true } : undefined,
  });
  const ok = notes ? r.ok : r;
  if (!ok) return;
  await deleteDocuments([doc.id], { keepNotes: notes ? r.checked : true });
  closeDocPanel();
  toast('Gelöscht');
}

// ---------------------------------------------------------------- edit

export function kindSelect(value) {
  return h('select', { 'aria-label': 'Art' }, KIND_GROUPS.map((g) => h('optgroup', { label: g }, KINDS.filter((k) => k.group === g).map((k) => h('option', { value: k.id, selected: k.id === value ? true : null }, k.label)))));
}

export function editDocumentDialog(doc) {
  const f = {};
  const row = (key, label, attrs = {}) => {
    const el = attrs.multiline ? h('textarea', { rows: 5, 'aria-label': label }, doc[key] || '') : h('input', { type: 'text', value: doc[key] ?? '', 'aria-label': label, inputmode: attrs.inputmode || null });
    f[key] = el;
    return h('label', { class: `cell ${attrs.multiline ? 'stack' : ''}` }, h('span', { class: 'label' }, label), el);
  };
  const kind = kindSelect(doc.kind);
  let color = doc.spineColor && COVER_COLORS.includes(doc.spineColor) ? doc.spineColor : null;
  const swatches = h('div', { class: 'swatches' });
  const drawSw = () =>
    swatches.replaceChildren(
      h('button', { type: 'button', class: `swatch auto ${!color ? 'on' : ''}`, 'aria-label': 'Automatisch', onClick: () => { color = null; drawSw(); } }, 'A'),
      ...COVER_COLORS.map((c) => h('button', { type: 'button', class: `swatch ${c === color ? 'on' : ''}`, style: { '--c': c }, 'aria-label': c, onClick: () => { color = c; drawSw(); } })),
    );
  drawSw();

  const doiBtn = h('button', {
    type: 'button',
    class: 'btn small',
    onClick: async () => {
      const doi = f.doi.value.trim();
      if (!doi) return toast('Erst eine DOI eingeben.');
      try {
        const m = await lookupDoi(doi);
        for (const k of ['title', 'author', 'year', 'publisher', 'description']) if (m[k] && f[k]) f[k].value = m[k];
        toast('Angaben aus dem DOI-Eintrag übernommen');
      } catch (e) {
        toast(e.message);
      }
    },
  }, 'Abrufen');

  openSheet({
    title: 'Angaben bearbeiten',
    tall: true,
    left: { label: 'Abbrechen' },
    right: {
      label: 'Sichern',
      strong: true,
      onClick: async (close) => {
        const patch = {};
        for (const [k, el] of Object.entries(f)) patch[k] = el.value.trim();
        patch.pages = patch.pages ? parseInt(patch.pages, 10) || null : null;
        patch.kind = kind.value;
        patch.spineColor = color;
        if (!patch.title) patch.title = 'Ohne Titel';
        await updateDocument(doc.id, patch);
        close();
      },
    },
    body: h(
      'div',
      null,
      group({ rows: [row('title', 'Titel'), row('author', 'Autor'), h('label', { class: 'cell' }, h('span', { class: 'label' }, 'Art'), kind), row('year', 'Jahr', { inputmode: 'numeric' }), row('pages', 'Seiten', { inputmode: 'numeric' })] }),
      group({ rows: [row('publisher', 'Verlag'), row('language', 'Sprache'), row('isbn', 'ISBN'), h('label', { class: 'cell' }, h('span', { class: 'label' }, 'DOI'), (f.doi = h('input', { type: 'text', value: doc.doi || '', 'aria-label': 'DOI' })), doiBtn)] }),
      group({ head: 'Beschreibung', rows: [h('label', { class: 'cell stack' }, (f.description = h('textarea', { rows: 5, 'aria-label': 'Beschreibung' }, doc.description || '')))] }),
      group({ head: 'Farbe des Covers (wenn kein Bild)', rows: [h('div', { class: 'cell' }, swatches)] }),
    ),
  });
}
