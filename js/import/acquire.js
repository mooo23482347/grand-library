// Hinzufügen: upload files, fetch free books, enter a book by hand, or start your own text.
// Metadata is read from the files and stays editable. PDFs are prepared for reading afterwards.

import { h, fromHTML, sha256Hex, formatBytes, fold } from '../util.js';
import { idx, state, createDocument, storeFile, storeCover, assignMany, addTag, saveText, placementLabel } from '../store.js';
import { KINDS, KIND_GROUPS } from '../kinds.js';
import { openSheet, toast } from '../ui/modal.js';
import { pickPlacements } from '../ui/picker.js';
import { icon } from '../ui/icons.js';
import { group, cell, searchField } from '../ui/controls.js';
import { openEpub } from './epub.js';
import { inspectPdf } from './pdf.js';
import { enqueueIndex } from './indexer.js';
import { lookupDoi } from './lookup.js';
import { checkCloudCapacity } from '../sync.js';

const ACCEPT = '.epub,.pdf,.txt,.md,.markdown,.doc,.docx,.odt,.rtf,.ppt,.pptx,.odp,.key,application/epub+zip,application/pdf,text/plain,text/markdown';

function kindSelect(value, onChange) {
  const s = h('select', { 'aria-label': 'Art' }, KIND_GROUPS.map((g) => h('optgroup', { label: g }, KINDS.filter((k) => k.group === g).map((k) => h('option', { value: k.id, selected: k.id === value ? true : null }, k.label)))));
  if (onChange) s.addEventListener('change', () => onChange(s.value));
  return s;
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
    item.error = `Die Datei ließ sich nicht lesen (${e.message || e}). Sie kann trotzdem als Datei gespeichert werden.`;
    item.format = 'file';
    item.kind = 'other';
    item.meta = { title: titleFromName(file.name) };
  }
  return item;
}

function targetsLabel(targets) {
  if (!targets.length) return 'Ohne Regal';
  return targets.map((t) => (t.colId ? placementLabel({ departmentId: t.deptId, collectionId: t.colId }) : idx.dept.get(t.deptId)?.name)).join(', ');
}

function shelfRow(targets, onChange) {
  const row = cell({ title: 'Regal', detail: targetsLabel(targets), icon: 'library', tint: 'var(--accent)', chevron: true, onClick: async () => {
    const t = await pickPlacements({ title: 'In welches Regal?', selected: targets, confirm: 'Fertig' });
    if (t) {
      targets.splice(0, targets.length, ...t);
      row.querySelector('.cell-detail').textContent = targetsLabel(targets);
      onChange?.(targets);
    }
  } });
  return row;
}

// ---------------------------------------------------------------- entry point

export function openAcquire({ targets = [], files = null } = {}) {
  const chosen = targets.filter((t) => t?.deptId).map((t) => ({ deptId: t.deptId, colId: t.colId || null }));
  if (files?.length) return reviewFiles([...files], chosen);
  const input = h('input', { type: 'file', multiple: true, accept: ACCEPT, class: 'visually-hidden' });
  const s = openSheet({
    title: 'Hinzufügen',
    body: h(
      'div',
      null,
      group({ rows: [shelfRow(chosen)], icons: true }),
      group({
        icons: true,
        rows: [
          h('label', { class: 'cell' }, h('span', { class: 'cell-icon', style: { '--tint': '#a0552a' }, html: icon('fileUp') }), h('span', { class: 'cell-main' }, h('span', { class: 'cell-title' }, 'Datei hochladen'), h('span', { class: 'cell-sub' }, 'PDF, EPUB, Text – wird automatisch fürs Lesen aufbereitet')), fromHTML(icon('next', 'cell-chevron')), input),
          cell({ title: 'Kostenloses Buch aus dem Netz', sub: 'Gemeinfreie Bücher im Internet Archive finden', icon: 'globe', tint: '#3e5874', chevron: true, onClick: () => { s.close(); freeBooks(chosen); } }),
          cell({ title: 'Von Hand erfassen', sub: 'Ein Buch, das du auf Papier hast', icon: 'clipboard', tint: '#5e7a63', chevron: true, onClick: () => { s.close(); manualEntry(chosen); } }),
          cell({ title: 'Eigenen Text schreiben', sub: 'Manuskript, Gedanken, Zitatsammlung', icon: 'penLine', tint: '#6b4560', chevron: true, onClick: () => { s.close(); writeText(chosen); } }),
        ],
      }),
    ),
  });
  input.addEventListener('change', () => {
    const list = [...input.files];
    if (!list.length) return;
    s.close();
    reviewFiles(list, chosen);
  });
  return s;
}

// ---------------------------------------------------------------- files

function reviewFiles(fileList, chosen) {
  const items = [];
  const listBox = h('div', { class: 'acq-items' });
  const more = h('input', { type: 'file', multiple: true, accept: ACCEPT, class: 'visually-hidden' });

  const add = async (files) => {
    for (const f of files) {
      const ph = h('div', { class: 'acq-loading' }, h('span', { class: 'spinner' }), h('span', null, `${f.name} wird gelesen …`));
      listBox.append(ph);
      const it = await inspectFile(f);
      it.tags = it.meta.tags || '';
      it.useExisting = !!it.duplicate;
      items.push(it);
      ph.replaceWith(itemCard(it));
      updateTitle();
    }
  };
  more.addEventListener('change', () => {
    add([...more.files]);
    more.value = '';
  });

  function itemCard(it) {
    const input = (key, label, attrs = {}) => {
      const el = h('input', { type: 'text', value: it.meta[key] || '', 'aria-label': label, placeholder: attrs.placeholder || '', inputmode: attrs.inputmode || null });
      el.addEventListener('input', () => (it.meta[key] = el.value));
      return h('label', { class: 'cell' }, h('span', { class: 'label' }, label), el);
    };
    const thumb = h('div', { class: 'acq-thumb' });
    if (it.cover) thumb.append(h('img', { src: URL.createObjectURL(it.cover), alt: '' }));
    else thumb.append(h('span', null, it.ext.toUpperCase()));
    const tags = h('input', { type: 'text', value: it.tags || '', placeholder: 'mit Komma getrennt', 'aria-label': 'Tags' });
    tags.addEventListener('input', () => (it.tags = tags.value));
    const card = h(
      'section',
      { class: 'group acq-card' },
      h('div', { class: 'acq-head' }, thumb, h('div', { class: 'acq-file' }, h('strong', null, it.name), h('span', { class: 'muted small' }, [formatBytes(it.size), it.pages ? `${it.pages} Seiten` : null, it.toc.length ? `${it.toc.length} Kapitel` : null].filter(Boolean).join(' · ')), it.format === 'pdf' ? h('span', { class: 'muted small' }, 'Wird nach dem Hinzufügen fürs Lesen aufbereitet.') : null),
        h('button', { type: 'button', class: 'icon-btn circle', 'aria-label': `${it.name} entfernen`, html: icon('close'), onClick: () => { items.splice(items.indexOf(it), 1); card.remove(); updateTitle(); } })),
      it.error ? h('p', { class: 'notice error' }, it.error) : null,
      it.duplicate
        ? h('label', { class: 'notice' }, h('input', { type: 'checkbox', class: 'switch', checked: true, onChange: (e) => (it.useExisting = e.target.checked) }), h('span', null, `Diese Datei ist schon da („${it.duplicate.title}“). Das vorhandene Buch zusätzlich einordnen statt es doppelt anzulegen.`))
        : null,
      h('ul', { class: 'list' },
        h('li', null, input('title', 'Titel')),
        h('li', null, input('author', 'Autor')),
        h('li', null, h('label', { class: 'cell' }, h('span', { class: 'label' }, 'Art'), kindSelect(it.kind, (v) => (it.kind = v)))),
        h('li', null, input('year', 'Jahr', { inputmode: 'numeric' })),
        h('li', null, h('label', { class: 'cell' }, h('span', { class: 'label' }, 'Tags'), tags)),
      ),
    );
    return card;
  }

  const sheet = openSheet({
    title: 'Hinzufügen',
    tall: true,
    left: { label: 'Abbrechen' },
    right: { label: 'Hinzufügen', strong: true, onClick: (close, btn) => save(close, btn) },
    body: h('div', null, group({ rows: [shelfRow(chosen)], icons: true }), listBox, group({ rows: [h('label', { class: 'cell accent' }, 'Weitere Dateien …', more)] })),
  });
  const updateTitle = () => sheet.setTitle(items.length > 1 ? `${items.length} Bücher hinzufügen` : 'Hinzufügen');
  add(fileList);

  async function save(close, btn) {
    if (!items.length) {
      toast('Erst eine Datei wählen.');
      return false;
    }
    const total = items.reduce((n, it) => n + (it.useExisting ? 0 : it.size), 0);
    const cap = await checkCloudCapacity(total).catch(() => null);
    if (cap?.warning) toast(cap.warning, { timeout: 8000 });
    const created = [];
    let i = 0;
    for (const it of items) {
      i++;
      btn.textContent = `${i} von ${items.length} …`;
      const tagNames = String(it.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (it.duplicate && it.useExisting) {
        await assignMany([it.duplicate.id], chosen);
        for (const t of tagNames) await addTag([it.duplicate.id], t);
        created.push(it.duplicate);
        continue;
      }
      const fileId = it.format !== 'text' ? (await storeFile(it.file, it.name)).id : null;
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
        chosen,
        tagNames,
      );
      if (it.format === 'text') await saveText(doc.id, it.text || '');
      enqueueIndex(doc.id);
      created.push(doc);
    }
    close();
    toast(created.length === 1 ? `„${created[0].title}“ hinzugefügt` : `${created.length} Bücher hinzugefügt`);
    if (created.length === 1) {
      const base = location.hash.split('?')[0] || '#/';
      location.hash = `${base}?doc=${created[0].id}`;
    }
  }
}

// ---------------------------------------------------------------- free books (Internet Archive)

async function fetchFile(url, name) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const blob = await r.blob();
  const type = /\.epub$/i.test(name) ? 'application/epub+zip' : /\.pdf$/i.test(name) ? 'application/pdf' : blob.type;
  return new File([blob], name, { type });
}

const LANG_NAMES = { eng: 'Englisch', en: 'Englisch', english: 'Englisch', ger: 'Deutsch', deu: 'Deutsch', de: 'Deutsch', german: 'Deutsch', fre: 'Französisch', fra: 'Französisch', french: 'Französisch', spa: 'Spanisch', spanish: 'Spanisch', ita: 'Italienisch', italian: 'Italienisch', lat: 'Latein', latin: 'Latein', grc: 'Altgriechisch', gre: 'Griechisch', rus: 'Russisch', dut: 'Niederländisch', nld: 'Niederländisch' };
const langName = (l) => (l ? LANG_NAMES[String(l).toLowerCase()] || l : '');

function freeBooks(chosen) {
  const results = h('div');
  let timer = null;
  const search = async (q) => {
    clearTimeout(timer);
    if (q.trim().length < 3) {
      results.replaceChildren(h('p', { class: 'group-foot' }, 'Titel oder Autor eingeben, z. B. „Kapital Marx“ oder „Meditations“.'));
      return;
    }
    timer = setTimeout(async () => {
      results.replaceChildren(h('div', { class: 'acq-loading' }, h('span', { class: 'spinner' }), 'Wird gesucht …'));
      try {
        const query = `(${q}) AND mediatype:texts AND (format:EPUB OR format:"Text PDF") AND NOT collection:inlibrary AND NOT collection:printdisabled`;
        const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&fl[]=language&rows=30&output=json`;
        const data = await fetch(url, { signal: AbortSignal.timeout(12000) }).then((r) => r.json());
        const docs = data.response?.docs || [];
        results.replaceChildren(
          docs.length
            ? group({ head: `${docs.length} Treffer im Internet Archive`, rows: docs.map((d) => cell({ title: [].concat(d.title)[0], sub: [[].concat(d.creator || [])[0], d.year, langName([].concat(d.language || [])[0])].filter(Boolean).join(' · '), chevron: true, onClick: () => archiveItem(d, chosen) })) })
            : h('p', { class: 'group-foot' }, 'Nichts gefunden.'),
        );
      } catch {
        results.replaceChildren(h('p', { class: 'notice error' }, 'Das Internet Archive ist gerade nicht erreichbar.'));
      }
    }, 350);
  };
  const link = h('input', { type: 'url', placeholder: 'https://… .pdf oder .epub', 'aria-label': 'Link zu einer Buchdatei' });
  const s = openSheet({
    title: 'Kostenlose Bücher',
    tall: true,
    left: { label: 'Zurück', onClick: (close) => { close(); openAcquire({ targets: chosen }); } },
    body: h(
      'div',
      null,
      searchField({ placeholder: 'Titel oder Autor', onInput: search }),
      results,
      group({ head: 'Oder ein direkter Link', foot: 'Funktioniert, wenn der Server den Download erlaubt. Sonst wird der Link geöffnet und du fügst die geladene Datei über „Datei hochladen“ hinzu.', rows: [h('label', { class: 'cell' }, link), cell({ title: 'Laden', accent: true, onClick: async () => {
        const u = link.value.trim();
        if (!/^https?:\/\//.test(u)) return toast('Bitte einen vollständigen Link eingeben.');
        const name = decodeURIComponent(u.split('?')[0].split('/').pop() || 'buch.pdf');
        try {
          const f = await fetchFile(u, name);
          s.close();
          reviewFiles([f], chosen);
        } catch {
          window.open(u, '_blank', 'noopener');
          toast('Der Server erlaubt keinen direkten Import. Der Link ist geöffnet – die geladene Datei dann über „Datei hochladen“ hinzufügen.', { timeout: 9000 });
        }
      } })] }),
      group({ rows: [cell({ title: 'Projekt Gutenberg öffnen', sub: 'Über 70.000 freie E-Books', href: 'https://www.gutenberg.org/ebooks/', attrs: { target: '_blank', rel: 'noopener' }, icon: 'globe', tint: '#5e7a63' })], icons: true }),
    ),
  });
  search('');
}

async function archiveItem(d, chosen) {
  const id = d.identifier;
  const body = h('div', null, h('div', { class: 'acq-loading' }, h('span', { class: 'spinner' }), 'Dateien werden abgefragt …'));
  const s = openSheet({ title: [].concat(d.title)[0], body });
  try {
    const meta = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(12000) }).then((r) => r.json());
    if (meta.metadata?.['access-restricted-item'] === 'true') throw new Error('restricted');
    const files = (meta.files || []).filter((f) => /\.(epub|pdf)$/i.test(f.name) && !/_encrypted|_lcp/i.test(f.name)).sort((a, b) => (/\.epub$/i.test(a.name) ? -1 : 1) - (/\.epub$/i.test(b.name) ? -1 : 1));
    if (!files.length) throw new Error('none');
    body.replaceChildren(
      group({
        head: 'Dateien',
        foot: 'Direkter Import, wenn das Archiv es erlaubt. Sonst lädt dein Browser die Datei herunter; füge sie danach über „Datei hochladen“ hinzu.',
        rows: files.slice(0, 6).map((f) =>
          cell({
            title: f.name.split('.').pop().toUpperCase(),
            sub: `${f.format || ''} · ${formatBytes(+f.size || 0)}`,
            chevron: true,
            onClick: async () => {
              const url = `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(f.name)}`;
              const t = toast('Wird geladen …', { timeout: 0 });
              try {
                const file = await fetchFile(url, f.name);
                t();
                s.close();
                reviewFiles([file], chosen);
              } catch {
                t();
                window.open(url, '_blank', 'noopener');
                toast('Download im Browser gestartet. Danach über „Datei hochladen“ hinzufügen.', { timeout: 9000 });
              }
            },
          }),
        ),
      }),
      group({ rows: [cell({ title: 'Seite im Internet Archive öffnen', href: `https://archive.org/details/${encodeURIComponent(id)}`, attrs: { target: '_blank', rel: 'noopener' } })] }),
    );
  } catch {
    body.replaceChildren(h('p', { class: 'notice' }, 'Für dieses Werk gibt es keine frei herunterladbare Datei.'));
  }
}

// ---------------------------------------------------------------- by hand

function manualEntry(chosen) {
  const m = { title: '', author: '', year: '', kind: 'book', publisher: '', isbn: '', doi: '', description: '', tags: '' };
  const f = {};
  const row = (key, label, attrs = {}) => {
    const el = h('input', { type: 'text', 'aria-label': label, placeholder: attrs.placeholder || '', inputmode: attrs.inputmode || null });
    el.addEventListener('input', () => (m[key] = el.value));
    f[key] = el;
    return h('label', { class: 'cell' }, h('span', { class: 'label' }, label), el);
  };
  const desc = h('textarea', { rows: 4, 'aria-label': 'Beschreibung' });
  desc.addEventListener('input', () => (m.description = desc.value));
  openSheet({
    title: 'Von Hand erfassen',
    tall: true,
    left: { label: 'Abbrechen' },
    right: {
      label: 'Hinzufügen',
      strong: true,
      onClick: async (close) => {
        if (!m.title.trim()) {
          f.title.focus();
          return false;
        }
        const doc = await createDocument({ title: m.title.trim(), author: m.author.trim(), kind: m.kind, format: 'none', year: m.year.trim(), publisher: m.publisher.trim(), isbn: m.isbn.trim(), doi: m.doi.trim(), description: m.description.trim() }, chosen, m.tags.split(',').map((s) => s.trim()).filter(Boolean));
        close();
        toast(`„${doc.title}“ ist im Katalog`);
      },
    },
    body: h(
      'div',
      null,
      group({ rows: [shelfRow(chosen)], icons: true }),
      group({ rows: [row('title', 'Titel'), row('author', 'Autor'), h('label', { class: 'cell' }, h('span', { class: 'label' }, 'Art'), kindSelect('book', (v) => (m.kind = v))), row('year', 'Jahr', { inputmode: 'numeric' }), row('tags', 'Tags', { placeholder: 'mit Komma getrennt' })] }),
      group({ rows: [row('publisher', 'Verlag'), row('isbn', 'ISBN'), row('doi', 'DOI'), cell({ title: 'Angaben per DOI abrufen', accent: true, onClick: async () => {
        if (!m.doi.trim()) return toast('Erst eine DOI eingeben.');
        try {
          const r = await lookupDoi(m.doi);
          for (const k of ['title', 'author', 'year', 'publisher']) if (r[k]) { f[k].value = r[k]; m[k] = r[k]; }
          if (r.description) { desc.value = r.description; m.description = r.description; }
          toast('Übernommen');
        } catch (e) {
          toast(e.message);
        }
      } })] }),
      group({ head: 'Beschreibung', rows: [h('label', { class: 'cell stack' }, desc)] }),
    ),
  });
}

// ---------------------------------------------------------------- own text

function writeText(chosen) {
  const personal = idx.depts.find((d) => /persönlich|personal/i.test(d.name));
  const targets = chosen.length ? chosen : personal ? [{ deptId: personal.id, colId: null }] : [];
  let kind = 'manuscript';
  const title = h('input', { type: 'text', placeholder: 'z. B. Über die Zeit', 'aria-label': 'Titel', autofocus: true });
  openSheet({
    title: 'Eigener Text',
    left: { label: 'Abbrechen' },
    right: {
      label: 'Schreiben',
      strong: true,
      onClick: async (close) => {
        const t = title.value.trim();
        if (!t) {
          title.focus();
          return false;
        }
        const doc = await createDocument({ title: t, author: '', kind, format: 'text' }, targets);
        await saveText(doc.id, `# ${t}\n\n`);
        close();
        location.hash = `#/read/${doc.id}?edit=1`;
      },
    },
    body: h(
      'div',
      null,
      group({ rows: [h('label', { class: 'cell' }, h('span', { class: 'label' }, 'Titel'), title), h('label', { class: 'cell' }, h('span', { class: 'label' }, 'Art'), h('select', { 'aria-label': 'Art', onChange: (e) => (kind = e.target.value) }, KINDS.filter((k) => k.group === 'Persönliches').map((k) => h('option', { value: k.id, selected: k.id === 'manuscript' ? true : null }, k.label))))] }),
      group({ rows: [shelfRow(targets)], icons: true }),
    ),
  });
}
