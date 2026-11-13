// The acquisitions desk: bring files into the library, catalogue a book by hand, or begin a
// manuscript. Metadata is read from the files; everything stays editable before shelving.

import { h, fromHTML, sha256Hex, formatBytes, fold } from '../util.js';
import {
  idx, state, createDocument, storeFile, storeCover, assignMany, addTag, saveText, placementLabel,
} from '../store.js';
import { KINDS, KIND_GROUPS, kindLabel } from '../kinds.js';
import { openModal, toast } from '../ui/modal.js';
import { pickPlacements } from '../ui/picker.js';
import { icon } from '../ui/icons.js';
import { openEpub } from './epub.js';
import { inspectPdf } from './pdf.js';
import { enqueueIndex } from './indexer.js';
import { lookupDoi } from './lookup.js';
import { checkCloudCapacity } from '../sync.js';

const ACCEPT = '.epub,.pdf,.txt,.md,.markdown,.doc,.docx,.odt,.rtf,.ppt,.pptx,.odp,.key,.xls,.xlsx,application/epub+zip,application/pdf,text/plain,text/markdown';

function kindSelect(value) {
  return h(
    'select',
    { class: 'field-input' },
    KIND_GROUPS.map((g) => h('optgroup', { label: g }, KINDS.filter((k) => k.group === g).map((k) => h('option', { value: k.id, selected: k.id === value ? true : null }, k.label)))),
  );
}

/** Educated guess at what kind of document this is. */
export function guessKind({ format, ext, pages, text = '', title = '', fileName = '', landscape }) {
  const t = fold(`${title} ${fileName} ${text.slice(0, 5000)}`);
  if (/^(ppt|pptx|odp|key)$/.test(ext) || (format === 'pdf' && landscape)) return 'slides';
  if (/\b(ubungsblatt|aufgabenblatt|assignment|exercise sheet|homework|hausaufgabe|problem set|aufgabe \d)\b/.test(t)) return 'assignment';
  if (/\b(vorlesung|lecture|skript|script|lehrveranstaltung|course notes|kursunterlagen|modul\w*)\b/.test(t)) return 'lecture';
  if (/\b(klausur|exam|prufungsvorbereitung|cheat ?sheet|lernzettel)\b/.test(t)) return 'exam';
  if (/\b(literature review|systematic review|meta-analysis|literaturubersicht)\b/.test(t)) return 'review';
  if (format === 'pdf' && (/\b10\.\d{4,9}\//.test(t) || /\babstract\b|\bzusammenfassung\b.*\bkeywords\b|\bjournal of\b|\bproceedings\b/.test(t)) && (pages || 0) <= 80) return 'paper';
  if (/\b(working paper|discussion paper|report|studie|study)\b/.test(t) && (pages || 0) <= 150 && format === 'pdf') return 'study';
  if (format === 'text') return 'notebook';
  if (/^(doc|docx|odt|rtf)$/.test(ext)) return 'material';
  if (format === 'file') return 'other';
  return 'book';
}

async function downscale(blob, width = 360) {
  if (!blob) return null;
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, width / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    return await new Promise((r) => c.toBlob((b) => r(b || blob), 'image/jpeg', 0.84));
  } catch {
    return blob;
  }
}

const titleFromName = (name) => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

async function inspectFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const item = { file, ext, name: file.name, size: file.size, meta: {}, cover: null, toc: [], pages: null, text: null, error: null };
  try {
    item.sha = await sha256Hex(await file.arrayBuffer());
    item.duplicate = state.documents.find((d) => d.fileId === item.sha) || null;
    if (ext === 'epub' || file.type === 'application/epub+zip') {
      item.format = 'epub';
      const book = await openEpub(file);
      item.meta = { ...book.meta };
      item.toc = book.toc;
      item.cover = await downscale(await book.coverBlob());
      item.kind = guessKind({ format: 'epub', ext, title: book.meta.title, fileName: file.name, text: `${book.meta.description} ${book.meta.subjects.join(' ')}` });
      if (book.meta.subjects?.length) item.meta.tags = book.meta.subjects.slice(0, 4).join(', ');
    } else if (ext === 'pdf' || file.type === 'application/pdf') {
      item.format = 'pdf';
      const info = await inspectPdf(file);
      item.meta = { ...info.meta };
      item.pages = info.pages;
      item.toc = info.toc;
      item.cover = info.cover;
      item.kind = guessKind({ format: 'pdf', ext, pages: info.pages, text: info.firstText, title: info.meta.title, fileName: file.name, landscape: info.landscape });
      if (info.meta.keywords) item.meta.tags = info.meta.keywords.split(/[;,]/).map((s) => s.trim()).filter(Boolean).slice(0, 5).join(', ');
    } else if (/^(txt|md|markdown)$/.test(ext) || /^text\//.test(file.type)) {
      item.format = 'text';
      item.text = await file.text();
      const head = item.text.match(/^#\s+(.+)$/m);
      item.meta = { title: head ? head[1].trim() : titleFromName(file.name) };
      item.kind = guessKind({ format: 'text', ext, text: item.text, fileName: file.name });
    } else {
      item.format = 'file';
      item.meta = { title: titleFromName(file.name) };
      item.kind = guessKind({ format: 'file', ext, fileName: file.name });
    }
    if (!item.meta.title) item.meta.title = titleFromName(file.name);
  } catch (e) {
    console.error(e);
    item.error = `Could not read this file (${e.message || e}). It can still be stored as a file.`;
    item.format = 'file';
    item.kind = 'other';
    item.meta = { title: titleFromName(file.name) };
  }
  return item;
}

// ---------------------------------------------------------------- placement control

function placementControl(targets, onChange) {
  const box = h('div', { class: 'placement' });
  const draw = () => {
    box.replaceChildren(
      h('span', { class: 'placement-k' }, 'Shelve in'),
      h(
        'span',
        { class: 'placement-v' },
        targets.length
          ? targets.map((t) => h('span', { class: 'place-chip' }, t.colId ? placementLabel({ departmentId: t.deptId, collectionId: t.colId }) : `${idx.dept.get(t.deptId)?.name} › General shelf`))
          : h('span', { class: 'muted' }, 'The returns table (no shelf yet)'),
      ),
      h('button', {
        type: 'button',
        class: 'btn btn-ghost small',
        onClick: async () => {
          const t = await pickPlacements({ selected: targets, confirm: 'Choose these shelves' });
          if (t) {
            targets.splice(0, targets.length, ...t);
            draw();
            onChange?.(targets);
          }
        },
      }, 'Choose…'),
    );
  };
  draw();
  return box;
}

// ---------------------------------------------------------------- dialog

export function openAcquire({ targets = [], files = null, tab = 'files' } = {}) {
  const batchTargets = targets.filter((t) => t?.deptId).map((t) => ({ deptId: t.deptId, colId: t.colId || null }));
  const items = [];
  let active = tab;

  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const panes = h('div', { class: 'tab-panes' });

  // ---- files pane
  const input = h('input', { type: 'file', multiple: true, accept: ACCEPT, class: 'visually-hidden', id: 'gl-file-input' });
  const drop = h(
    'label',
    { class: 'dropzone', for: 'gl-file-input' },
    h('span', { class: 'dz-icon', html: icon('acquire') }),
    h('span', { class: 'dz-title' }, 'Choose files or drop them here'),
    h('span', { class: 'dz-sub' }, 'EPUB and PDF are read in the library. Text and Markdown become editable manuscripts. Other files (Word, PowerPoint…) are kept and opened with their own app.'),
    input,
  );
  const list = h('div', { class: 'acq-list' });
  const batchPlacement = placementControl(batchTargets);
  const filesPane = h('div', { class: 'tab-pane', role: 'tabpanel' }, drop, h('div', { class: 'acq-batch' }, batchPlacement), list);

  const addFiles = async (fileList) => {
    const arr = [...fileList];
    if (!arr.length) return;
    for (const f of arr) {
      const placeholder = h('div', { class: 'acq-item loading' }, h('span', { class: 'acq-spinner' }), h('span', null, `Reading ${f.name}…`));
      list.append(placeholder);
      const it = await inspectFile(f);
      it.tags = it.meta.tags || '';
      items.push(it);
      placeholder.replaceWith(itemCard(it));
    }
    updateFooter();
  };
  input.addEventListener('change', () => {
    addFiles(input.files);
    input.value = '';
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    addFiles(e.dataTransfer.files);
  });

  function itemCard(it) {
    const f = {};
    const inp = (key, label, attrs = {}) => {
      const el = h('input', { class: 'field-input', type: 'text', value: it.meta[key] || '', ...attrs });
      el.addEventListener('input', () => (it.meta[key] = el.value));
      f[key] = el;
      return h('label', { class: `field ${attrs.wide ? 'wide' : ''}` }, h('span', { class: 'field-label' }, label), el);
    };
    const ks = kindSelect(it.kind);
    ks.addEventListener('change', () => (it.kind = ks.value));
    const tags = h('input', { class: 'field-input', type: 'text', value: it.tags || '', placeholder: 'Comma separated' });
    tags.addEventListener('input', () => (it.tags = tags.value));
    const desc = h('textarea', { class: 'field-input', rows: 3 }, it.meta.description || '');
    desc.addEventListener('input', () => (it.meta.description = desc.value));
    const thumb = h('div', { class: 'acq-thumb' });
    if (it.cover) thumb.append(h('img', { src: URL.createObjectURL(it.cover), alt: '' }));
    else thumb.append(h('span', { class: 'acq-ext' }, it.ext.toUpperCase()));

    it.useExisting = !!it.duplicate;
    const dupNote = it.duplicate
      ? h(
          'label',
          { class: 'dup-note' },
          h('input', { type: 'checkbox', checked: true, onChange: (e) => { it.useExisting = e.target.checked; card.classList.toggle('dup-on', it.useExisting); } }),
          h('span', null, `This exact file is already in the library as “${it.duplicate.title}”. Shelve that volume in the chosen places instead of adding it twice.`),
        )
      : null;

    it.ownTargets = null;
    const own = h('div', { class: 'acq-own', hidden: true });
    const ownToggle = h('button', {
      type: 'button',
      class: 'link-btn',
      onClick: () => {
        it.ownTargets = it.ownTargets ? null : [...batchTargets];
        own.hidden = !it.ownTargets;
        own.replaceChildren(it.ownTargets ? placementControl(it.ownTargets) : '');
        ownToggle.textContent = it.ownTargets ? 'Use the common shelves' : 'Shelve this one elsewhere';
      },
    }, 'Shelve this one elsewhere');

    const remove = h('button', {
      type: 'button',
      class: 'icon-btn small acq-remove',
      'aria-label': `Remove ${it.name} from this batch`,
      html: icon('close'),
      onClick: () => {
        items.splice(items.indexOf(it), 1);
        card.remove();
        updateFooter();
      },
    });

    const card = h(
      'article',
      { class: `acq-item ${it.duplicate ? 'dup-on' : ''}` },
      thumb,
      h(
        'div',
        { class: 'acq-fields' },
        h('p', { class: 'acq-file' }, `${it.name} · ${formatBytes(it.size)}${it.pages ? ` · ${it.pages} pages` : ''}${it.toc.length ? ` · ${it.toc.length} chapters` : ''}`),
        it.error ? h('p', { class: 'acq-error' }, it.error) : null,
        dupNote,
        h(
          'div',
          { class: 'form-grid two acq-form' },
          inp('title', 'Title', { wide: true }),
          inp('author', 'Author(s)'),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Type'), ks),
          inp('year', 'Year', { inputmode: 'numeric' }),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Tags'), tags),
          h('details', { class: 'field wide acq-more' }, h('summary', null, 'More details'), h('div', { class: 'form-grid two' }, inp('publisher', 'Publisher or journal'), inp('doi', 'DOI'), inp('isbn', 'ISBN'), inp('language', 'Language'), h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Description'), desc))),
        ),
        h('div', { class: 'acq-row' }, ownToggle),
        own,
      ),
      remove,
    );
    return card;
  }

  // ---- manual pane
  const man = { title: '', author: '', year: '', kind: 'book', publisher: '', isbn: '', doi: '', description: '', tags: '' };
  const manInput = (key, label, attrs = {}) => {
    const el = attrs.multiline ? h('textarea', { class: 'field-input', rows: 4 }) : h('input', { class: 'field-input', type: 'text', ...attrs });
    el.addEventListener('input', () => (man[key] = el.value));
    return { el, field: h('label', { class: `field ${attrs.wide ? 'wide' : ''}` }, h('span', { class: 'field-label' }, label), el) };
  };
  const mTitle = manInput('title', 'Title', { wide: true });
  const mAuthor = manInput('author', 'Author(s)');
  const mKind = kindSelect('book');
  mKind.addEventListener('change', () => (man.kind = mKind.value));
  const mYear = manInput('year', 'Year', { inputmode: 'numeric' });
  const mPub = manInput('publisher', 'Publisher or journal');
  const mIsbn = manInput('isbn', 'ISBN');
  const mDoi = manInput('doi', 'DOI');
  const mDesc = manInput('description', 'Description', { multiline: true, wide: true });
  const mTags = manInput('tags', 'Tags', { placeholder: 'Comma separated' });
  const doiBtn = h('button', {
    type: 'button',
    class: 'btn btn-ghost small',
    onClick: async () => {
      if (!man.doi.trim()) return toast('Enter a DOI first.');
      doiBtn.disabled = true;
      try {
        const m = await lookupDoi(man.doi);
        const set = (o, k) => { if (m[k]) { o.el.value = m[k]; man[k] = m[k]; } };
        set(mTitle, 'title'); set(mAuthor, 'author'); set(mYear, 'year'); set(mPub, 'publisher'); set(mDesc, 'description');
        if (m.kind) { mKind.value = m.kind; man.kind = m.kind; }
        toast('Filled in from the DOI record.');
      } catch (e) {
        toast(e.message, { kind: 'error' });
      }
      doiBtn.disabled = false;
    },
  }, 'Fill in from DOI');
  const manTargets = [...batchTargets];
  const manualPane = h(
    'div',
    { class: 'tab-pane', role: 'tabpanel' },
    h('p', { class: 'pane-intro' }, 'Record a volume you own on paper, or a paper you only want to cite. It stands on the shelf like any other.'),
    h('div', { class: 'form-grid two' }, mTitle.field, mAuthor.field, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Type'), mKind), mYear.field, mPub.field, mIsbn.field, h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'DOI'), h('div', { class: 'inline' }, mDoi.el, doiBtn)), mTags.field, mDesc.field),
    placementControl(manTargets),
  );

  // ---- write pane
  const wr = { title: '', kind: 'manuscript' };
  const wTitle = h('input', { class: 'field-input', type: 'text', placeholder: 'e.g. On the nature of time' });
  wTitle.addEventListener('input', () => (wr.title = wTitle.value));
  const wKind = h('select', { class: 'field-input' }, KINDS.filter((k) => k.group === 'Personal papers' || k.id === 'exam').map((k) => h('option', { value: k.id, selected: k.id === 'manuscript' ? true : null }, k.label)));
  wKind.addEventListener('change', () => (wr.kind = wKind.value));
  const personal = idx.depts.find((d) => /personal/i.test(d.name));
  const wTargets = batchTargets.length ? [...batchTargets] : personal ? [{ deptId: personal.id, colId: null }] : [];
  const writePane = h(
    'div',
    { class: 'tab-pane', role: 'tabpanel' },
    h('p', { class: 'pane-intro' }, 'Begin your own text: a manuscript, a notebook of thoughts, a collection of quotations. It is bound like a notebook and stands on the shelf.'),
    h('div', { class: 'form-grid two' }, h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Title'), wTitle), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Kind'), wKind)),
    placementControl(wTargets),
  );

  const paneFor = { files: filesPane, manual: manualPane, write: writePane };
  const labels = { files: 'From files', manual: 'Catalogue by hand', write: 'Write a manuscript' };
  const drawTabs = () => {
    tabs.replaceChildren(
      ...Object.keys(paneFor).map((k) =>
        h('button', { type: 'button', role: 'tab', class: `tab ${k === active ? 'on' : ''}`, 'aria-selected': k === active ? 'true' : 'false', onClick: () => { active = k; drawTabs(); updateFooter(); } }, labels[k]),
      ),
    );
    panes.replaceChildren(paneFor[active]);
  };

  let primaryBtn = null;
  const updateFooter = () => {
    if (!primaryBtn) primaryBtn = m.el.querySelector('.btn-primary');
    if (!primaryBtn) return;
    if (active === 'files') primaryBtn.textContent = items.length ? `Shelve ${items.length} ${items.length === 1 ? 'volume' : 'volumes'}` : 'Shelve';
    else if (active === 'manual') primaryBtn.textContent = 'Add to the catalogue';
    else primaryBtn.textContent = 'Begin writing';
  };

  const m = openModal({
    title: 'Acquisitions',
    subtitle: 'New volumes for the library',
    wide: true,
    className: 'acquire-modal',
    body: h('div', { class: 'acquire' }, tabs, panes),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Shelve',
        primary: true,
        onClick: async (close, btn) => {
          if (active === 'files') return saveFiles(close, btn);
          if (active === 'manual') return saveManual(close);
          return saveWrite(close);
        },
      },
    ],
  });
  drawTabs();
  updateFooter();
  if (files?.length) addFiles(files);

  async function saveFiles(close, btn) {
    if (!items.length) {
      toast('Choose a file first.');
      return false;
    }
    const total = items.reduce((n, it) => n + (it.useExisting ? 0 : it.size), 0);
    const cap = await checkCloudCapacity(total).catch(() => null);
    if (cap?.warning) toast(cap.warning, { kind: 'warn', timeout: 9000 });
    const created = [];
    let i = 0;
    for (const it of items) {
      i++;
      btn.textContent = `Shelving ${i} of ${items.length}…`;
      const targets = it.ownTargets || batchTargets;
      const tagNames = String(it.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (it.duplicate && it.useExisting) {
        await assignMany([it.duplicate.id], targets);
        for (const t of tagNames) await addTag([it.duplicate.id], t);
        created.push(it.duplicate);
        continue;
      }
      let fileId = null;
      if (it.format !== 'text') fileId = (await storeFile(it.file, it.name)).id;
      const coverId = it.cover ? await storeCover(it.cover) : null;
      const doc = await createDocument(
        {
          title: (it.meta.title || '').trim() || titleFromName(it.name),
          author: (it.meta.author || '').trim(),
          kind: it.kind,
          format: it.format,
          year: (it.meta.year || '').trim(),
          description: (it.meta.description || '').trim(),
          publisher: (it.meta.publisher || '').trim(),
          language: (it.meta.language || '').trim(),
          isbn: (it.meta.isbn || '').trim(),
          doi: (it.meta.doi || '').trim(),
          pages: it.pages,
          fileId,
          fileName: it.name,
          fileMime: it.file.type,
          fileSize: it.size,
          coverId,
          toc: it.toc || [],
        },
        targets,
        tagNames,
      );
      if (it.format === 'text') await saveText(doc.id, it.text || '');
      enqueueIndex(doc.id);
      created.push(doc);
    }
    close();
    const where = batchTargets.length ? ` in ${batchTargets.map((t) => (t.colId ? idx.col.get(t.colId)?.name : idx.dept.get(t.deptId)?.name)).join(', ')}` : ' on the returns table';
    toast(`${created.length} ${created.length === 1 ? 'volume' : 'volumes'} shelved${where}.`);
    if (created.length === 1) {
      const base = location.hash.split('?')[0] || '#/';
      location.hash = `${base}?doc=${created[0].id}`;
    }
  }

  async function saveManual(close) {
    if (!man.title.trim()) {
      mTitle.el.focus();
      toast('A title is needed.');
      return false;
    }
    const doc = await createDocument(
      { title: man.title.trim(), author: man.author.trim(), kind: man.kind, format: 'none', year: man.year.trim(), publisher: man.publisher.trim(), isbn: man.isbn.trim(), doi: man.doi.trim(), description: man.description.trim() },
      manTargets,
      man.tags.split(',').map((s) => s.trim()).filter(Boolean),
    );
    close();
    toast(`“${doc.title}” is in the catalogue.`);
    const base = location.hash.split('?')[0] || '#/';
    location.hash = `${base}?doc=${doc.id}`;
  }

  async function saveWrite(close) {
    const title = wr.title.trim();
    if (!title) {
      wTitle.focus();
      toast('Give your text a title.');
      return false;
    }
    const doc = await createDocument({ title, author: '', kind: wr.kind, format: 'text' }, wTargets);
    await saveText(doc.id, `# ${title}\n\n`);
    close();
    location.hash = `#/read/${doc.id}?edit=1`;
  }
}

export { kindLabel };
