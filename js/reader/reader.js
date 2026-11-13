// The reading room: chrome, panels, typography, marks and progress around the two engines.

import { h, fromHTML, debounce, isTouch } from '../util.js';
import {
  idx, saveProgress, saveHighlight, deleteHighlight, addBookmark, deleteBookmark, getSetting, setSetting,
  docHref, primaryPlacement, noteTitle, saveText, getText, subscribe,
} from '../store.js';
import { noteKindLabel } from '../kinds.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/modal.js';
import { openNoteEditor } from '../ui/noteEditor.js';
import { searchInDocument } from '../search.js';
import { enqueueIndex, extractParts } from '../import/indexer.js';
import { db } from '../db.js';
import { FlowEngine } from './flow.js';
import { PdfEngine } from './pdfview.js';

const layer = () => document.getElementById('layer-reader');
let active = null;
let backHash = null;

export const isReaderOpen = () => !!active;
export const readerDocId = () => active?.doc.id || null;
export function setReaderBack(hash) {
  backHash = hash || null;
}

const DEFAULT_PREFS = { theme: 'paper', font: 'EB Garamond', size: 20, leading: 1.6, measure: 34, align: 'auto' };
const FONTS = [
  { name: 'EB Garamond', css: "'EB Garamond', Georgia, serif" },
  { name: 'Cormorant Garamond', css: "'Cormorant Garamond', Georgia, serif" },
  { name: 'Libre Baskerville', css: "'Libre Baskerville', Georgia, serif" },
  { name: 'Literata', css: "'Literata', Georgia, serif" },
  { name: 'Crimson Pro', css: "'Crimson Pro', Georgia, serif" },
];
let extraFontsLoaded = false;
function loadReaderFonts() {
  if (extraFontsLoaded) return;
  extraFontsLoaded = true;
  document.head.append(
    h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,600;1,400&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&display=swap' }),
  );
}

export async function openReader(docId, query = {}) {
  const loc = parseLoc(query.loc);
  if (active && active.doc.id === docId) {
    if (loc) active.engine.go(loc);
    return;
  }
  closeReader();
  const doc = idx.doc.get(docId);
  if (!doc) {
    toast('This volume is not in the library.');
    location.hash = '#/';
    return;
  }
  if (!['epub', 'pdf', 'text'].includes(doc.format)) {
    toast('This volume has no readable file. Its catalogue card is open instead.');
    location.hash = docHref(docId);
    return;
  }
  loadReaderFonts();
  active = new Reader(doc, { loc, edit: query.edit === '1' });
  await active.mount();
}

export function closeReader() {
  if (!active) return;
  active.destroy();
  active = null;
  layer().replaceChildren();
  document.documentElement.classList.remove('reading');
}

function parseLoc(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

class Reader {
  constructor(doc, { loc, edit }) {
    this.doc = doc;
    this.initialLoc = loc;
    this.startEditing = edit && doc.format === 'text';
    this.panel = null;
    this.chromeHidden = false;
  }

  notesForDoc() {
    return idx.notesByDoc.get(this.doc.id) || [];
  }

  async mount() {
    this.prefs = { ...DEFAULT_PREFS, ...((await getSetting('readerPrefs')) || {}) };
    document.documentElement.classList.add('reading');
    const doc = this.doc;
    const place = primaryPlacement(doc.id);
    const backLabel = place ? (place.collectionId ? idx.col.get(place.collectionId)?.name : idx.dept.get(place.departmentId)?.name) : 'Library';

    this.titleEl = h('span', { class: 'rd-title' }, doc.title);
    this.chapterEl = h('span', { class: 'rd-chap-label' }, '');
    this.bmBtn = this.tool('ribbon', 'Bookmark this place', () => this.toggleBookmark());
    this.scroll = h('div', { class: 'rd-scroll', tabindex: '0' }, h('div', { class: 'rd-loading' }, h('span', { class: 'acq-spinner' }), 'Opening the volume…'));
    this.bar = h('div', { class: 'rd-progress-bar' });
    this.pct = h('span', { class: 'rd-pct' }, '');
    this.prevBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': doc.format === 'pdf' ? 'Previous page' : 'Previous chapter', html: icon('back'), onClick: () => this.engine?.prev() });
    this.nextBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': doc.format === 'pdf' ? 'Next page' : 'Next chapter', html: icon('next'), onClick: () => this.engine?.next() });
    this.panelEl = h('aside', { class: 'rd-panel', 'aria-hidden': 'true' });
    this.pop = h('div', { class: 'rd-pop', hidden: true });

    const tools = [
      this.tool('toc', 'Contents', () => this.togglePanel('toc')),
      this.tool('search', 'Search in this volume', () => this.togglePanel('search')),
      this.tool('quill', 'Notes and marks', () => this.togglePanel('marks')),
      this.tool('type', 'Reading settings', () => this.togglePanel('type')),
      this.bmBtn,
    ];
    if (doc.format === 'text') tools.unshift((this.editBtn = this.tool('pen', 'Write in this manuscript', () => this.toggleEdit())));

    this.root = h(
      'div',
      { class: `reader theme-${this.prefs.theme} fmt-${doc.format}` },
      h(
        'header',
        { class: 'rd-bar' },
        h('button', { type: 'button', class: 'rd-back', onClick: () => this.leave(), 'aria-label': `Back to ${backLabel}` }, fromHTML(icon('back')), h('span', { class: 'rd-back-label' }, backLabel)),
        h('div', { class: 'rd-titles' }, this.titleEl, this.chapterEl),
        h('div', { class: 'rd-tools' }, tools),
      ),
      this.scroll,
      h('footer', { class: 'rd-foot' }, this.prevBtn, h('div', { class: 'rd-progress', role: 'progressbar', 'aria-label': 'Reading progress' }, this.bar), this.pct, this.nextBtn),
      this.panelEl,
      this.pop,
    );
    layer().replaceChildren(this.root);
    this.applyPrefs();

    this.engine = doc.format === 'pdf' ? new PdfEngine(doc, this) : new FlowEngine(doc, this);
    try {
      await this.engine.init(this.scroll);
    } catch (e) {
      this.scroll.replaceChildren(h('div', { class: 'rd-error' }, h('h2', null, 'The volume could not be opened'), h('p', null, e.message || String(e)), h('button', { type: 'button', class: 'btn btn-primary', onClick: () => this.leave() }, 'Back to the library')));
      return;
    }
    if (active !== this) return;

    const saved = idx.progress.get(doc.id);
    const start = this.initialLoc || saved?.loc || (doc.format === 'pdf' ? { page: 1 } : { spine: 0, frac: 0 });
    if (doc.format === 'pdf') await this.engine.go(start, { silent: true });
    else await this.engine.show(start.spine || 0, start);
    if (this.initialLoc == null && saved?.loc && (saved.percent || 0) > 0.01) toast(`Resumed where you stopped reading, at ${Math.round(saved.percent * 100)}%.`, { timeout: 2600 });

    this.onScroll = () => {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = null;
        this.updateProgress();
        this.autoHide();
      });
    };
    this.scroll.addEventListener('scroll', this.onScroll, { passive: true });
    this.saveLater = debounce(() => this.persistProgress(), 900);
    this.onKey = (e) => this.key(e);
    document.addEventListener('keydown', this.onKey);
    this.onSel = debounce(() => this.selectionChanged(), 180);
    document.addEventListener('selectionchange', this.onSel);
    this.scroll.addEventListener('click', (e) => this.contentClick(e));
    this.onHide = () => document.visibilityState === 'hidden' && this.persistProgress();
    document.addEventListener('visibilitychange', this.onHide);
    this.unsub = subscribe((tables) => {
      if (this.editing || !(tables.has('notes') || tables.has('highlights') || tables.has('bookmarks'))) return;
      if (window.getSelection()?.isCollapsed !== false) this.engine.paintHighlights?.();
      if (this.panel === 'marks') this.renderPanel();
      this.refreshBookmarkState();
    });
    this.updateProgress();
    this.persistProgress();
    if (this.startEditing) this.toggleEdit(true);
    this.scroll.focus({ preventScroll: true });
  }

  tool(name, label, fn) {
    return h('button', { type: 'button', class: 'icon-btn rd-tool', 'aria-label': label, title: label, html: icon(name), onClick: fn });
  }

  leave() {
    this.persistProgress();
    const target = backHash && !backHash.startsWith('#/read/') ? backHash : docHref(this.doc.id);
    location.hash = target;
  }

  // ---------------------------------------------------------------- progress

  updateProgress() {
    if (!this.engine?.percent) return;
    this.engine.tick?.();
    const p = this.engine.percent();
    this.bar.style.width = `${(p * 100).toFixed(1)}%`;
    this.pct.textContent = `${Math.round(p * 100)}%`;
    this.chapterEl.textContent = this.engine.chapterLabel();
    this.prevBtn.disabled = !this.engine.hasPrev();
    this.nextBtn.disabled = !this.engine.hasNext();
    this.refreshBookmarkState();
    this.saveLater?.();
  }

  persistProgress() {
    if (!this.engine?.currentLoc || this.editing) return;
    try {
      saveProgress(this.doc.id, this.engine.currentLoc(), this.engine.percent());
    } catch {
      /* engine not ready */
    }
  }

  onChapter() {
    this.chapterEl.textContent = this.engine.chapterLabel();
    if (this.panel === 'toc') this.renderPanel();
  }

  onMove() {
    this.updateProgress();
  }

  autoHide() {
    if (!isTouch()) return;
    const y = this.scroll.scrollTop;
    const dy = y - (this.lastY || 0);
    this.lastY = y;
    if (Math.abs(dy) < 6) return;
    this.setChrome(dy < 0 || y < 40);
  }

  setChrome(show) {
    this.chromeHidden = !show;
    this.root.classList.toggle('chrome-hidden', !show);
  }

  // ---------------------------------------------------------------- keys and clicks

  key(e) {
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'Escape') {
      if (!this.pop.hidden) return this.hidePop();
      if (this.panel) return this.togglePanel(null);
      return this.leave();
    }
    if (e.key === 'ArrowLeft' && !e.altKey) {
      e.preventDefault();
      this.engine.prev();
    }
    if (e.key === 'ArrowRight' && !e.altKey) {
      e.preventDefault();
      this.engine.next();
    }
  }

  contentClick(e) {
    const mark = e.target.closest('mark.hl');
    if (mark) {
      e.stopPropagation();
      this.showHighlightPop(mark.dataset.hl, mark.getBoundingClientRect());
      return;
    }
    if (this.doc.format === 'pdf' && window.getSelection()?.isCollapsed) {
      const x = this.engine.highlightAt?.(e.clientX, e.clientY);
      if (x) {
        this.showHighlightPop(x.id, { left: e.clientX - 10, right: e.clientX + 10, top: e.clientY - 10, bottom: e.clientY + 10, width: 20 });
        return;
      }
    }
    if (e.target.closest('a, button, textarea, input')) return;
    if (!this.pop.hidden) {
      this.hidePop();
      return;
    }
    if (isTouch() && window.getSelection()?.isCollapsed) this.setChrome(this.chromeHidden);
  }

  // ---------------------------------------------------------------- selection and highlights

  selectionChanged() {
    if (this.editing) return;
    const s = this.engine?.selectionLoc?.();
    if (!s) {
      if (this.pop.dataset.mode === 'select') this.hidePop();
      return;
    }
    this.sel = s;
    const chapter = this.engine.chapterLabel();
    const colorBtn = (c, label) =>
      h('button', { type: 'button', class: `pop-color c-${c}`, 'aria-label': `Mark in ${label}`, title: `Mark in ${label}`, onClick: () => this.addHighlight(c) });
    this.showPop(
      'select',
      [
        colorBtn('amber', 'amber'),
        colorBtn('rose', 'rose'),
        colorBtn('sage', 'sage'),
        colorBtn('azure', 'blue'),
        h('span', { class: 'pop-sep' }),
        h('button', { type: 'button', class: 'pop-btn', onClick: async () => { const hl = await this.addHighlight('amber', true); if (hl) openNoteEditor({ kind: 'note', documentId: this.doc.id, chapter, loc: hl.loc, highlightId: hl.id, quote: hl.text }); } }, 'Note'),
        h('button', { type: 'button', class: 'pop-btn', onClick: async () => { const s2 = this.sel; this.hidePop(); window.getSelection()?.removeAllRanges(); openNoteEditor({ kind: 'quote', documentId: this.doc.id, chapter, loc: s2.loc, quote: s2.text }); } }, 'Quote'),
        h('button', { type: 'button', class: 'pop-btn', onClick: async () => { try { await navigator.clipboard.writeText(this.sel.text); toast('Copied.'); } catch { toast('Copying is not allowed here.'); } this.hidePop(); } }, 'Copy'),
      ],
      s.rect,
    );
  }

  async addHighlight(color, keepSel = false) {
    const s = this.sel || this.engine.selectionLoc();
    if (!s) return null;
    const hl = await saveHighlight({ documentId: this.doc.id, loc: s.loc, text: s.text.slice(0, 2000), color, chapter: this.engine.chapterLabel() });
    window.getSelection()?.removeAllRanges();
    this.hidePop();
    this.engine.paintHighlights();
    if (this.panel === 'marks') this.renderPanel();
    if (!keepSel) toast('Marked. It appears among the marginalia in the Scriptorium.', { timeout: 2200 });
    return hl;
  }

  showHighlightPop(id, rect) {
    const x = idx.hl.get(id);
    if (!x) return;
    const note = this.notesForDoc().find((n) => n.highlightId === id);
    const recolor = (c) => async () => {
      await saveHighlight({ id, color: c });
      this.engine.paintHighlights();
      this.hidePop();
    };
    this.showPop(
      'mark',
      [
        ...['amber', 'rose', 'sage', 'azure'].map((c) => h('button', { type: 'button', class: `pop-color c-${c} ${x.color === c ? 'on' : ''}`, 'aria-label': `Colour ${c}`, onClick: recolor(c) })),
        h('span', { class: 'pop-sep' }),
        h('button', { type: 'button', class: 'pop-btn', onClick: () => { this.hidePop(); note ? openNoteEditor({ id: note.id }) : openNoteEditor({ kind: 'note', documentId: this.doc.id, chapter: x.chapter, loc: x.loc, highlightId: x.id, quote: x.text }); } }, note ? 'Open note' : 'Add note'),
        h('button', { type: 'button', class: 'pop-btn danger', onClick: async () => { await deleteHighlight(id); this.engine.paintHighlights(); this.hidePop(); if (this.panel === 'marks') this.renderPanel(); } }, 'Remove'),
      ],
      rect,
    );
  }

  showPop(mode, kids, rect) {
    this.pop.dataset.mode = mode;
    this.pop.replaceChildren(...kids);
    this.pop.hidden = false;
    const pw = this.pop.offsetWidth;
    const ph = this.pop.offsetHeight;
    const touch = isTouch();
    let left = (rect.left + rect.right) / 2 - pw / 2;
    left = Math.max(8, Math.min(left, innerWidth - pw - 8));
    // On phones the system menu sits above the selection, so ours goes below it.
    let top = touch ? rect.bottom + 12 : rect.top - ph - 10;
    if (top < 60) top = rect.bottom + 10;
    if (top + ph > innerHeight - 8) top = Math.max(60, rect.top - ph - 10);
    this.pop.style.left = `${left}px`;
    this.pop.style.top = `${top}px`;
  }

  hidePop() {
    this.pop.hidden = true;
    this.pop.dataset.mode = '';
  }

  // ---------------------------------------------------------------- bookmarks

  bookmarkHere() {
    const loc = this.engine.currentLoc();
    return (idx.bmByDoc.get(this.doc.id) || []).find((b) => (loc.page ? b.loc.page === loc.page : b.loc.spine === loc.spine && Math.abs((b.loc.frac || 0) - (loc.frac || 0)) < 0.04));
  }

  refreshBookmarkState() {
    const on = !!this.bookmarkHere();
    this.bmBtn.innerHTML = icon(on ? 'ribbonFill' : 'ribbon');
    this.bmBtn.classList.toggle('on', on);
    this.bmBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  async toggleBookmark() {
    const b = this.bookmarkHere();
    if (b) {
      await deleteBookmark(b.id);
      toast('Bookmark removed.', { timeout: 1800 });
    } else {
      const loc = this.engine.currentLoc();
      await addBookmark({ documentId: this.doc.id, loc, label: `${this.engine.chapterLabel()} · ${Math.round(this.engine.percent() * 100)}%` });
      toast('Bookmark laid in.', { timeout: 1800 });
    }
    this.refreshBookmarkState();
    if (this.panel === 'marks') this.renderPanel();
  }

  // ---------------------------------------------------------------- panels

  togglePanel(name) {
    this.panel = this.panel === name ? null : name;
    this.root.classList.toggle('panel-open', !!this.panel);
    this.panelEl.setAttribute('aria-hidden', this.panel ? 'false' : 'true');
    this.root.querySelectorAll('.rd-tool').forEach((b) => b.classList.remove('active'));
    if (this.panel) this.renderPanel();
  }

  renderPanel() {
    const titles = { toc: 'Contents', search: 'Search this volume', marks: 'Notes and marks', type: 'Reading settings' };
    const head = h('header', { class: 'rd-panel-head' }, h('h2', null, titles[this.panel]), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close panel', html: icon('close'), onClick: () => this.togglePanel(null) }));
    let body;
    if (this.panel === 'toc') body = this.tocPanel();
    else if (this.panel === 'search') body = this.searchPanel();
    else if (this.panel === 'marks') body = this.marksPanel();
    else body = this.typePanel();
    this.panelEl.replaceChildren(head, h('div', { class: 'rd-panel-body' }, body));
    if (this.panel === 'search') this.panelEl.querySelector('input')?.focus();
  }

  closePanelOnPhone() {
    if (matchMedia('(max-width: 760px)').matches) this.togglePanel(null);
  }

  tocPanel() {
    const items = this.engine.tocItems();
    if (!items.length) return h('p', { class: 'muted' }, 'This volume has no table of contents.');
    const cur = this.doc.format === 'pdf' ? this.engine.currentPage() : this.engine.i;
    let currentIdx = -1;
    items.forEach((t, i) => {
      const v = this.doc.format === 'pdf' ? t.loc.page : t.loc.spine;
      if (v <= cur) currentIdx = i;
    });
    const list = h(
      'ol',
      { class: 'rd-toc' },
      items.map((t, i) =>
        h('li', { style: { '--depth': t.depth || 0 } },
          h('button', { type: 'button', class: `rd-toc-item ${i === currentIdx ? 'current' : ''}`, onClick: () => { this.engine.go({ ...t.loc }); this.closePanelOnPhone(); } }, t.label),
          h('button', { type: 'button', class: 'icon-btn small toc-sum', title: 'Summarise this chapter', 'aria-label': `Summarise ${t.label}`, html: icon('quill'), onClick: () => openNoteEditor({ kind: 'summary', documentId: this.doc.id, chapter: t.label, loc: t.loc, title: `Summary: ${t.label}` }) }),
        ),
      ),
    );
    requestAnimationFrame(() => list.querySelector('.current')?.scrollIntoView({ block: 'center' }));
    return list;
  }

  searchPanel() {
    const input = h('input', { class: 'field-input', type: 'search', placeholder: 'A word or phrase…', value: this.lastSearch || '', 'aria-label': 'Search in this volume' });
    const out = h('div', { class: 'rd-search-results' });
    const run = debounce(async () => {
      const q = input.value.trim();
      this.lastSearch = q;
      if (q.length < 2) {
        out.replaceChildren();
        return;
      }
      let res = await searchInDocument(this.doc.id, q);
      if (res === null) {
        out.replaceChildren(h('p', { class: 'muted' }, 'Preparing the text of this volume for searching…'));
        const parts = await extractParts(this.doc);
        if (parts) await db.fulltext.put({ documentId: this.doc.id, parts, at: Date.now() });
        res = (await searchInDocument(this.doc.id, q)) || [];
      }
      out.replaceChildren(
        h('p', { class: 'muted small' }, res.length ? `${res.length}${res.length >= 300 ? '+' : ''} ${res.length === 1 ? 'passage' : 'passages'}` : 'Not found in this volume.'),
        ...res.map((r) =>
          h('button', { type: 'button', class: 'rd-hit', onClick: () => { this.engine.go({ ...r.loc }); this.closePanelOnPhone(); } },
            h('span', { class: 'rd-hit-where' }, r.part.label),
            h('span', { class: 'rd-hit-text' }, r.pre, h('mark', null, r.hit), r.post),
          ),
        ),
      );
    }, 260);
    input.addEventListener('input', run);
    if (this.lastSearch) run();
    return h('div', null, input, out);
  }

  marksPanel() {
    const isPdf = this.doc.format === 'pdf';
    const hls = [...(idx.hlByDoc.get(this.doc.id) || [])].sort((a, b) => (isPdf ? a.loc.page - b.loc.page || a.loc.rects[0].y - b.loc.rects[0].y : a.loc.spine - b.loc.spine || a.loc.start - b.loc.start));
    const bms = [...(idx.bmByDoc.get(this.doc.id) || [])];
    const notes = [...this.notesForDoc()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const chapter = this.engine.chapterLabel();
    const chapterLoc = isPdf ? { page: this.engine.currentPage() } : { spine: this.engine.i };
    return h(
      'div',
      { class: 'rd-marks' },
      h('div', { class: 'rd-mark-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost small', onClick: () => openNoteEditor({ kind: 'summary', documentId: this.doc.id, chapter: isPdf ? '' : chapter, loc: chapterLoc, title: isPdf ? '' : `Summary: ${chapter}` }) }, fromHTML(icon('quill')), isPdf ? 'Summary' : 'Summarise this chapter'),
        h('button', { type: 'button', class: 'btn btn-ghost small', onClick: () => openNoteEditor({ kind: 'thought', documentId: this.doc.id, chapter: isPdf ? '' : chapter, loc: this.engine.currentLoc() }) }, fromHTML(icon('lamp')), 'Own thought'),
      ),
      h('h3', { class: 'rd-sub' }, `Bookmarks · ${bms.length}`),
      bms.length
        ? h('ul', { class: 'rd-list' }, bms.map((b) => h('li', null, h('button', { type: 'button', class: 'rd-list-item', onClick: () => { this.engine.go({ ...b.loc }); this.closePanelOnPhone(); } }, fromHTML(icon('ribbonFill')), b.label || 'Bookmark'), h('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Remove bookmark', html: icon('close'), onClick: async () => { await deleteBookmark(b.id); this.renderPanel(); this.refreshBookmarkState(); } }))))
        : h('p', { class: 'muted small' }, 'Lay a bookmark with the ribbon in the bar above.'),
      h('h3', { class: 'rd-sub' }, `Notes and summaries · ${notes.length}`),
      notes.length
        ? h('ul', { class: 'rd-list' }, notes.map((n) => h('li', null, h('button', { type: 'button', class: 'rd-list-item', onClick: () => openNoteEditor({ id: n.id }) }, h('span', { class: `note-kind k-${n.kind}` }, noteKindLabel(n.kind)), h('span', null, noteTitle(n))))))
        : h('p', { class: 'muted small' }, 'Nothing written about this volume yet.'),
      h('h3', { class: 'rd-sub' }, `Marked passages · ${hls.length}`),
      hls.length
        ? h('ul', { class: 'rd-list' }, hls.map((x) => h('li', null, h('button', { type: 'button', class: `rd-list-item mark c-${x.color}`, onClick: () => { this.engine.go({ ...x.loc }); this.closePanelOnPhone(); } }, h('span', { class: 'rd-mark-text' }, `“${x.text.slice(0, 180)}${x.text.length > 180 ? '…' : ''}”`), h('span', { class: 'rd-mark-where' }, x.chapter || '')))))
        : h('p', { class: 'muted small' }, 'Select text to mark it, add a note or keep it as a quotation.'),
    );
  }

  typePanel() {
    const p = this.prefs;
    const set = async (patch) => {
      const loc = this.engine.currentLoc?.();
      Object.assign(this.prefs, patch);
      this.applyPrefs();
      await setSetting('readerPrefs', this.prefs);
      this.renderPanel();
      if (loc && this.doc.format !== 'pdf' && ('size' in patch || 'leading' in patch || 'measure' in patch || 'font' in patch)) requestAnimationFrame(() => this.engine.position(loc));
    };
    const themes = [
      ['paper', 'Paper', 'Bright paper'],
      ['warm', 'Warm', 'Warm lamplight'],
      ['night', 'Night', 'Dark, for the evening'],
    ];
    const stepper = (label, value, onMinus, onPlus, fmt) =>
      h('div', { class: 'rd-stepper' }, h('span', { class: 'rd-step-label' }, label), h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Less ${label.toLowerCase()}`, html: icon('minus'), onClick: onMinus }), h('span', { class: 'rd-step-value' }, fmt(value)), h('button', { type: 'button', class: 'icon-btn', 'aria-label': `More ${label.toLowerCase()}`, html: icon('plus'), onClick: onPlus }));
    const isPdf = this.doc.format === 'pdf';
    return h(
      'div',
      { class: 'rd-type' },
      h('div', { class: 'rd-themes', role: 'radiogroup', 'aria-label': 'Reading mode' }, themes.map(([k, l, t]) => h('button', { type: 'button', class: `rd-theme t-${k} ${p.theme === k ? 'on' : ''}`, role: 'radio', 'aria-checked': p.theme === k ? 'true' : 'false', title: t, onClick: () => set({ theme: k }) }, h('span', { class: 'rd-theme-swatch' }, 'Aa'), l))),
      isPdf
        ? [
            stepper('Zoom', this.engine.zoom, () => { this.engine.setZoom(this.engine.zoom - 0.15); this.renderPanel(); }, () => { this.engine.setZoom(this.engine.zoom + 0.15); this.renderPanel(); }, (v) => `${Math.round(v * 100)}%`),
            h('p', { class: 'muted small' }, 'PDF pages keep their own typesetting. Night and warm modes tint the page.'),
          ]
        : [
            h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Typeface'), (() => {
              const s = h('select', { class: 'field-input' }, FONTS.map((f) => h('option', { value: f.name, selected: f.name === p.font ? true : null, style: { fontFamily: f.css } }, f.name)));
              s.addEventListener('change', () => set({ font: s.value }));
              return s;
            })()),
            stepper('Size', p.size, () => set({ size: Math.max(13, p.size - 1) }), () => set({ size: Math.min(34, p.size + 1) }), (v) => `${v}px`),
            stepper('Leading', p.leading, () => set({ leading: Math.max(1.2, +(p.leading - 0.1).toFixed(1)) }), () => set({ leading: Math.min(2.2, +(p.leading + 0.1).toFixed(1)) }), (v) => v.toFixed(1)),
            stepper('Width', p.measure, () => set({ measure: Math.max(22, p.measure - 3) }), () => set({ measure: Math.min(52, p.measure + 3) }), (v) => `${v} em`),
            h('div', { class: 'rd-align' },
              h('button', { type: 'button', class: `btn btn-ghost small ${p.align === 'auto' ? 'on' : ''}`, title: 'Justified on large screens, ragged right on phones', onClick: () => set({ align: 'auto' }) }, 'Automatic'),
              h('button', { type: 'button', class: `btn btn-ghost small ${p.align === 'justify' ? 'on' : ''}`, onClick: () => set({ align: 'justify' }) }, 'Justified'),
              h('button', { type: 'button', class: `btn btn-ghost small ${p.align === 'left' ? 'on' : ''}`, onClick: () => set({ align: 'left' }) }, 'Ragged right'),
            ),
          ],
    );
  }

  applyPrefs() {
    const p = this.prefs;
    this.root.classList.remove('theme-paper', 'theme-warm', 'theme-night');
    this.root.classList.add(`theme-${p.theme}`);
    const f = FONTS.find((x) => x.name === p.font) || FONTS[0];
    this.root.style.setProperty('--rd-font', f.css);
    this.root.style.setProperty('--rd-size', `${p.size}px`);
    this.root.style.setProperty('--rd-leading', p.leading);
    this.root.style.setProperty('--rd-measure', `${p.measure}em`);
    const narrow = matchMedia('(max-width: 600px)').matches;
    this.root.style.setProperty('--rd-align', p.align === 'auto' ? (narrow ? 'left' : 'justify') : p.align);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.theme === 'night' ? '#14110e' : p.theme === 'warm' ? '#efe0c2' : '#f6efe0');
  }

  // ---------------------------------------------------------------- writing (manuscripts)

  async toggleEdit(force) {
    const on = force ?? !this.editing;
    if (on === !!this.editing) return;
    if (on) {
      this.editing = true;
      this.root.classList.add('editing');
      this.editBtn?.classList.add('on');
      const body = await getText(this.doc.id);
      const ta = h('textarea', { class: 'rd-editor', spellcheck: 'true', 'aria-label': 'Manuscript text' }, body);
      const status = h('span', { class: 'rd-edit-status' }, 'Saved');
      const save = debounce(async () => {
        await saveText(this.doc.id, ta.value);
        status.textContent = 'Saved';
      }, 700);
      ta.addEventListener('input', () => {
        status.textContent = 'Writing…';
        save();
      });
      this.flushEdit = async () => {
        save.flush();
        await saveText(this.doc.id, ta.value);
        return ta.value;
      };
      this.scroll.replaceChildren(
        h('div', { class: 'rd-edit-wrap' },
          h('div', { class: 'rd-edit-bar' }, h('span', { class: 'muted small' }, 'Markdown: # heading · **bold** · *italic* · > quotation · - list · [[link to a note or volume]]'), status, h('button', { type: 'button', class: 'btn btn-primary small', onClick: () => this.toggleEdit(false) }, 'Done')),
          ta,
        ),
      );
      ta.focus();
    } else {
      const body = await this.flushEdit?.();
      this.editing = false;
      this.root.classList.remove('editing');
      this.editBtn?.classList.remove('on');
      this.engine.setText(body ?? (await getText(this.doc.id)));
      this.scroll.replaceChildren(this.engine.page);
      await this.engine.show(0, { frac: 0 });
      enqueueIndex(this.doc.id, { force: true });
      toast('The manuscript is saved.', { timeout: 1800 });
    }
  }

  destroy() {
    this.unsub?.();
    if (this.editing) this.flushEdit?.();
    this.persistProgress();
    this.scroll?.removeEventListener('scroll', this.onScroll);
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('selectionchange', this.onSel);
    document.removeEventListener('visibilitychange', this.onHide);
    this.onSel?.cancel?.();
    this.engine?.destroy?.();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#1a120c');
  }
}
