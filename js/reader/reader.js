// The reader: text only while reading; a tap in the middle shows quiet bars with everything else.

import { h, fromHTML, debounce, isTouch, clamp } from '../util.js';
import {
  idx, saveProgress, saveHighlight, deleteHighlight, addBookmark, deleteBookmark, docHref, primaryPlacement,
  noteTitle, saveText, getText, subscribe, saveNote, logReadingDay, logFinished,
} from '../store.js';
import { db } from '../db.js';
import { noteKind } from '../kinds.js';
import { icon } from '../ui/icons.js';
import { toast, openSheet, isDesktop } from '../ui/modal.js';
import { group, cell, segmented, stepper, switchCell, searchField } from '../ui/controls.js';
import { openNoteEditor } from '../ui/noteEditor.js';
import { searchInDocument } from '../search.js';
import { enqueueIndex, extractParts, getFulltext } from '../import/indexer.js';
import { paintThemeColor } from '../theme.js';
import { FlowEngine, epubSource, textSource, reflowSource } from './flow.js';
import { PdfEngine } from './pdfview.js';
import { cachedReflow, getReflow, migrateLocs, pageToLoc, reflowParts, REFLOW_VERSION } from './reflow.js';
import { loadReaderPrefs, setReaderPrefs, SKINS, FONTS, fontCss, skinOf } from './prefs.js';
import { LAUREL } from './ornaments.js';

const layer = () => document.getElementById('layer-reader');
let active = null;
let backHash = null;

export const isReaderOpen = () => !!active;
export const readerDocId = () => active?.doc.id || null;
export function setReaderBack(hash) {
  backHash = hash || null;
}

const parseLoc = (s) => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

export async function openReader(docId, query = {}) {
  const loc = parseLoc(query.loc);
  if (active && active.doc.id === docId) {
    if (query.view && query.view !== active.view) await active.switchView(query.view);
    if (loc) active.goTo(loc);
    return;
  }
  closeReader();
  const doc = idx.doc.get(docId);
  if (!doc) {
    toast('Dieses Buch gibt es nicht mehr.');
    location.hash = '#/';
    return;
  }
  if (!['epub', 'pdf', 'text'].includes(doc.format)) {
    toast('Zu diesem Eintrag gibt es keine lesbare Datei.');
    location.hash = docHref(docId);
    return;
  }
  active = new Reader(doc, { loc, edit: query.edit === '1', view: query.view === 'original' ? 'original' : 'text' });
  await active.mount();
}

export function closeReader() {
  if (!active) return;
  active.destroy();
  active = null;
  layer().replaceChildren();
  document.documentElement.classList.remove('reading');
  paintThemeColor();
}

const PAPER_COLOR = { cream: '#fbf7ef', parchment: '#efe0bf', sepia: '#f1e3c9', sage: '#e4eadf', newsprint: '#e8e6e1', midnight: '#1d1814' };
const WEIGHTS = [
  { value: 350, label: 'Leicht' },
  { value: 400, label: 'Normal' },
  { value: 520, label: 'Kräftig' },
];

class Reader {
  constructor(doc, { loc, edit, view }) {
    this.doc = doc;
    this.initialLoc = loc;
    this.startEditing = edit && doc.format === 'text';
    this.view = doc.format === 'pdf' ? view : 'text';
    this.chrome = true;
    this.sheet = null;
    this.mountedAt = Date.now();
  }

  notesForDoc() {
    return idx.notesByDoc.get(this.doc.id) || [];
  }

  // ---------------------------------------------------------------- build

  async mount() {
    this.prefs = await loadReaderPrefs();
    document.documentElement.classList.add('reading');
    const doc = this.doc;
    const place = primaryPlacement(doc.id);
    const backLabel = place ? (place.collectionId ? idx.col.get(place.collectionId)?.name : idx.dept.get(place.departmentId)?.name) : 'Bücher';

    this.titleEl = h('div', { class: 'rd-title' }, doc.title);
    this.bmBtn = this.tool('bookmark', 'Lesezeichen', () => this.toggleBookmark());
    const tools = [
      this.tool('toc', 'Inhalt', () => this.openToc()),
      this.tool('search', 'Im Buch suchen', () => this.openSearch()),
      this.tool('penLine', 'Notizen', () => this.openNotes()),
      this.tool('type', 'Darstellung', () => this.openType()),
      this.bmBtn,
    ];
    if (doc.format === 'text') tools.unshift((this.editBtn = this.tool('pencil', 'Text bearbeiten', () => this.toggleEdit())));

    this.top = h('header', { class: 'rd-top' },
      h('button', { type: 'button', class: 'rd-back', 'aria-label': `Zurück zu ${backLabel}`, onClick: () => this.leave() }, fromHTML(icon('back')), h('span', null, backLabel)),
      this.titleEl,
      h('div', { class: 'rd-tools' }, tools),
    );
    this.chapterEl = h('div', { class: 'rd-ch' });
    this.metaEl = h('div', { class: 'rd-meta' });
    this.pctEl = h('span', { class: 'rd-pct' });
    this.slider = h('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'rd-slider', 'aria-label': 'Fortschritt im Buch' });
    this.slider.addEventListener('change', () => this.goToPercent(this.slider.value / 1000));
    this.bottom = h('footer', { class: 'rd-bottom' }, h('div', { class: 'rd-bottom-row' }, this.chapterEl, this.pctEl), this.slider, this.metaEl);
    this.stage = h('div', { class: 'rd-stage' });
    this.overlay = h('div', { class: 'rd-overlay', hidden: true });
    this.pop = h('div', { class: 'rd-pop', hidden: true, role: 'toolbar' });
    this.root = h('div', { class: 'reader chrome', role: 'region', 'aria-label': `Lesen: ${doc.title}` }, this.stage, this.top, this.bottom, this.overlay, this.pop);
    layer().replaceChildren(this.root);
    this.applyPrefs(false);

    await this.openEngine(this.view, this.initialLoc);
    if (active !== this) return;

    this.saveLater = debounce(() => this.persist(), 800);
    this.onKey = (e) => this.key(e);
    document.addEventListener('keydown', this.onKey);
    this.onSel = debounce(() => this.selectionChanged(), 200);
    document.addEventListener('selectionchange', this.onSel);
    this.stage.addEventListener('click', (e) => this.stageClick(e));
    this.onHide = () => document.visibilityState === 'hidden' && this.persist();
    document.addEventListener('visibilitychange', this.onHide);
    // The original PDF view handles its own resizing.
    this.onResize = debounce(() => {
      this.applyAlign();
      if (!(this.engine instanceof PdfEngine)) this.engine?.relayout?.();
    }, 180);
    window.addEventListener('resize', this.onResize);
    this.unsub = subscribe((t) => {
      if (this.editing || !(t.has('notes') || t.has('highlights') || t.has('bookmarks'))) return;
      if (window.getSelection()?.isCollapsed !== false) this.engine?.paintHighlights?.();
      this.refreshBookmark();
    });
    if (this.startEditing) this.toggleEdit(true);
    this.chromeTimer = setTimeout(() => this.setChrome(false), 2600);
  }

  tool(name, label, fn) {
    return h('button', { type: 'button', class: 'icon-btn rd-tool', 'aria-label': label, title: label, html: icon(name), onClick: (e) => { e.stopPropagation(); fn(e); } });
  }

  async openEngine(view, loc) {
    const doc = this.doc;
    this.view = view;
    this.root.classList.toggle('view-original', view === 'original');
    this.engine?.destroy?.();
    this.engine = null;
    let rec = null;
    try {
      if (doc.format === 'pdf' && view !== 'original') {
        rec = await cachedReflow(doc.id);
        if (!rec) rec = await this.convert();
        if (!rec) return;
        if (rec.status !== 'ok') {
          toast('Dieses PDF enthält keinen lesbaren Text (vermutlich ein Scan). Es wird im Original gezeigt.', { timeout: 7000 });
          return this.openEngine('original', loc);
        }
        this.rec = rec;
        await migrateLocs(doc, rec);
        this.upgradeIndex(rec);
      }
      if (doc.format === 'pdf' && view === 'original') {
        this.engine = new PdfEngine(doc, this);
        const scroller = h('div', { class: 'rd-pdf' });
        this.stage.replaceChildren(scroller);
        await this.engine.init(scroller);
      } else {
        const source = doc.format === 'epub' ? await epubSource(doc) : doc.format === 'text' ? await textSource(doc) : reflowSource(doc, rec);
        this.source = source;
        this.engine = new FlowEngine(doc, this, source);
        this.applyAlign(); // depends on the source's language
        this.engine.init(this.stage);
      }
    } catch (e) {
      console.error(e);
      this.showOverlay(h('div', { class: 'rd-card' }, h('h2', null, 'Das Buch lässt sich nicht öffnen'), h('p', null, e.message || String(e)), h('button', { type: 'button', class: 'btn filled', onClick: () => this.leave() }, 'Zurück')));
      return;
    }
    this.hideOverlay();

    const saved = idx.progress.get(doc.id);
    let start = loc || saved?.loc || null;
    if (this.engine instanceof PdfEngine) {
      start = start?.page ? { page: start.page, frac: start.spine == null ? start.frac : 0, find: start.find, rects: start.rects } : { page: 1 };
      await this.engine.go(start, { silent: true });
    } else {
      if (rec && start && start.page && (start.spine == null || start.rv !== REFLOW_VERSION)) start = { ...pageToLoc(rec, start.page, start.frac), find: start.find };
      start = start || { spine: 0 };
      await this.engine.show(start.spine || 0, start);
      if (!loc && saved?.loc && (saved.percent || 0) > 0.01) {
        this.engine.resume = { spine: this.engine.i, page: this.engine.page };
        this.engine.updatePageChrome();
        toast(`Weiter bei ${Math.round(saved.percent * 100)} %`, { timeout: 2200 });
      }
    }
    this.onMove();
  }

  /** Converting a PDF for reading, with a progress card. */
  async convert() {
    const bar = h('span', { style: { width: '0%' } });
    const pct = h('span', { class: 'rd-conv-pct' }, '0 %');
    this.showOverlay(
      h('div', { class: 'rd-card' },
        h('div', { class: 'rd-conv-icon', html: icon('bookOpen') }),
        h('h2', null, 'Wird für das Lesen aufbereitet'),
        h('p', null, `Der Text wird aus dem PDF gelöst und neu gesetzt${this.doc.pages ? ` – ${this.doc.pages} Seiten` : ''}. Das passiert einmal pro Gerät.`),
        h('div', { class: 'progress big' }, bar),
        pct,
        h('button', { type: 'button', class: 'btn', onClick: () => this.switchView('original') }, 'Solange das Original zeigen'),
      ),
    );
    try {
      const rec = await getReflow(this.doc, { onProgress: (p) => { bar.style.width = `${Math.round(p * 100)}%`; pct.textContent = `${Math.round(p * 100)} %`; } });
      if (this.view !== 'text' || active !== this) return null;
      return rec;
    } catch (e) {
      toast(`Aufbereitung nicht möglich: ${e.message}`, { timeout: 7000 });
      await this.openEngine('original');
      return null;
    }
  }

  async upgradeIndex(rec) {
    const ft = await getFulltext(this.doc.id);
    if (!ft || ft.parts?.[0]?.loc?.spine == null) await db.fulltext.put({ documentId: this.doc.id, parts: reflowParts(rec), at: Date.now() });
  }

  async switchView(view) {
    if (view === this.view || this.doc.format !== 'pdf') return;
    const loc = this.engine ? this.engine.currentLoc() : null;
    this.persist();
    const mapped = view === 'original' ? (loc?.page ? { page: loc.page } : null) : loc?.page ? { page: loc.page, frac: loc.frac } : null;
    await this.openEngine(view, mapped);
  }

  showOverlay(node) {
    this.overlay.replaceChildren(node);
    this.overlay.hidden = false;
  }
  hideOverlay() {
    this.overlay.hidden = true;
    this.overlay.replaceChildren();
  }

  leave() {
    this.persist();
    location.hash = backHash && !backHash.startsWith('#/read/') ? backHash : docHref(this.doc.id);
  }

  // ---------------------------------------------------------------- appearance

  applyPrefs(relayout = true) {
    const p = this.prefs;
    const r = this.root;
    SKINS.forEach((s) => r.classList.remove(`skin-${s.id}`));
    r.classList.add(`skin-${p.skin}`);
    r.classList.toggle('dark', skinOf(p.skin).dark);
    r.classList.toggle('ornaments', !!p.ornaments);
    r.style.setProperty('--rd-font', fontCss(p.font));
    r.style.setProperty('--rd-size', `${p.size}px`);
    r.style.setProperty('--rd-weight', p.weight);
    r.style.setProperty('--rd-leading', p.leading);
    r.style.setProperty('--rd-para', `${p.para}em`);
    r.style.setProperty('--rd-indent', p.para > 0 ? '0' : '1.3em');
    this.applyAlign();
    paintThemeColor(PAPER_COLOR[p.skin]);
    if (relayout && !(this.engine instanceof PdfEngine)) this.engine?.relayout?.();
  }

  // "Auto": justified where the browser can hyphenate (known language) or the column is wide;
  // ragged right on a narrow phone column without hyphenation, to avoid rivers of white space.
  applyAlign() {
    const p = this.prefs;
    const narrow = matchMedia('(max-width: 600px)').matches;
    const hyphenates = !!this.engine?.source?.lang;
    this.root.style.setProperty('--rd-align', p.align === 'auto' ? (narrow && !hyphenates ? 'left' : 'justify') : p.align);
  }

  async setPrefs(patch) {
    this.prefs = await setReaderPrefs(patch);
    this.applyPrefs();
  }

  setChrome(show) {
    clearTimeout(this.chromeTimer);
    this.chrome = show;
    this.root.classList.toggle('chrome', show);
  }

  // ---------------------------------------------------------------- progress

  onChapter() {
    this.chapterEl.textContent = this.engine?.chapterLabel?.() || '';
  }

  onMove() {
    // Throttled with a timer, not an animation frame: frames pause in background windows.
    if (this.moveTimer) return;
    this.moveTimer = setTimeout(() => {
      this.moveTimer = null;
      this.updateBottom();
      this.saveLater?.();
      if (!this.loggedDay && Date.now() - this.mountedAt > 20000) {
        this.loggedDay = true;
        logReadingDay();
      }
    }, 60);
  }

  updateBottom() {
    const e = this.engine;
    if (!e) return;
    try {
      if (e.currentLoc) e.lastOffset = e.currentLoc().offset;
    } catch {
      /* not laid out yet */
    }
    const p = e.percent();
    this.pctEl.textContent = `${Math.round(p * 100)} %`;
    if (document.activeElement !== this.slider) this.slider.value = Math.round(p * 1000);
    this.chapterEl.textContent = e.chapterLabel();
    const parts = [];
    const pi = e.pageInfo?.();
    if (pi) parts.push(`Seite ${pi.page} von ${pi.pages}`);
    if (e.minutesLeftInChapter) {
      const m = e.minutesLeftInChapter();
      parts.push(m > 0 ? `noch ${m} Min. im Kapitel` : 'Kapitelende');
    }
    this.metaEl.textContent = parts.join(' · ');
    this.refreshBookmark();
    if (e.updatePageChrome && e.pagesMode) e.updatePageChrome();
  }

  persist() {
    if (!this.engine || this.editing) return;
    try {
      const loc = this.engine.currentLoc();
      saveProgress(this.doc.id, loc, this.engine.percent());
    } catch {
      /* not ready */
    }
  }

  goToPercent(p) {
    const e = this.engine;
    if (e instanceof PdfEngine) return e.go({ page: Math.max(1, Math.round(p * e.count)) });
    const L = this.source?.lengths;
    if (!L) return e.go({ spine: Math.min(e.count - 1, Math.floor(p * e.count)), frac: (p * e.count) % 1 });
    const total = L.reduce((a, b) => a + b, 0);
    let target = p * total;
    for (let i = 0; i < L.length; i++) {
      if (target <= L[i] || i === L.length - 1) return e.go({ spine: i, offset: Math.max(0, Math.round(target)) });
      target -= L[i];
    }
  }

  goTo(loc) {
    if (!this.engine) return;
    if (this.engine instanceof PdfEngine) return this.engine.go(loc.page ? loc : { page: 1 });
    if (this.rec && loc.page && (loc.spine == null || loc.rv !== REFLOW_VERSION)) loc = { ...pageToLoc(this.rec, loc.page, loc.frac), find: loc.find };
    this.engine.go(loc);
  }

  async onBookEnd() {
    this.persist();
    saveProgress(this.doc.id, this.engine.currentLoc(), 1);
    const first = await logFinished(this.doc.id);
    this.showOverlay(
      h('div', { class: 'rd-card finished' },
        fromHTML(LAUREL),
        h('h2', null, first ? 'Ausgelesen' : 'Wieder ausgelesen'),
        h('p', { class: 'rd-fin-title' }, this.doc.title),
        h('div', { class: 'rd-fin-actions' },
          h('button', { type: 'button', class: 'btn filled', onClick: () => openNoteEditor({ kind: 'summary', documentId: this.doc.id, title: `Zusammenfassung: ${this.doc.title}` }) }, 'Zusammenfassung schreiben'),
          h('button', { type: 'button', class: 'btn tinted', onClick: () => this.leave() }, 'Zurück ins Regal'),
          h('button', { type: 'button', class: 'btn', onClick: () => this.hideOverlay() }, 'Weiterblättern'),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- input

  key(e) {
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('.sheet-wrap, .alert-wrap, .menu-wrap')) return;
    if (e.key === 'Escape') {
      if (!this.pop.hidden) return this.hidePop();
      if (!this.overlay.hidden && this.overlay.querySelector('.finished')) return this.hideOverlay();
      return this.leave();
    }
    const pages = this.engine?.pagesMode;
    if (e.key === 'ArrowRight' || (pages && (e.key === 'PageDown' || e.key === ' '))) {
      e.preventDefault();
      this.engine?.next();
    } else if (e.key === 'ArrowLeft' || (pages && e.key === 'PageUp')) {
      e.preventDefault();
      this.engine?.prev();
    }
  }

  stageClick(e) {
    if (this.suppressClick) return;
    const mark = e.target.closest('mark.hl');
    if (mark) {
      e.stopPropagation();
      return this.showHighlightPop(mark.dataset.hl, mark.getBoundingClientRect());
    }
    if (this.engine instanceof PdfEngine && window.getSelection()?.isCollapsed) {
      const x = this.engine.highlightAt?.(e.clientX, e.clientY);
      if (x) return this.showHighlightPop(x.id, { left: e.clientX - 10, right: e.clientX + 10, top: e.clientY - 10, bottom: e.clientY + 10 });
    }
    if (e.target.closest('a, button, textarea, input')) return;
    if (!this.pop.hidden) return this.hidePop();
    if (window.getSelection() && !window.getSelection().isCollapsed) return;
    const rx = e.clientX / innerWidth;
    if (this.engine?.pagesMode && !(this.engine instanceof PdfEngine)) {
      if (rx < 0.28) return this.engine.prev();
      if (rx > 0.72) return this.engine.next();
    }
    this.setChrome(!this.chrome);
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
    const color = (c, label) => h('button', { type: 'button', class: `pop-color c-${c}`, 'aria-label': `${label} markieren`, title: label, onClick: () => this.addHighlight(c) });
    this.showPop('select', [
      color('amber', 'Gelb'), color('rose', 'Rosa'), color('sage', 'Grün'), color('azure', 'Blau'),
      h('span', { class: 'pop-sep' }),
      h('button', { type: 'button', class: 'pop-btn', onClick: async () => {
        const s2 = this.sel;
        const hl = await this.addHighlight('amber', true);
        const n = await saveNote({ kind: 'quote', documentId: this.doc.id, chapter, loc: s2.loc, quote: s2.text, highlightId: hl?.id || null });
        toast('Zitat gespeichert', { action: { label: 'Öffnen', onClick: () => openNoteEditor({ id: n.id }) } });
      } }, fromHTML(icon('quote')), 'Zitat'),
      h('button', { type: 'button', class: 'pop-btn', onClick: async () => {
        const s2 = this.sel;
        const hl = await this.addHighlight('sage', true);
        openNoteEditor({ kind: 'thought', documentId: this.doc.id, chapter, loc: s2.loc, highlightId: hl?.id || null, quote: s2.text });
      } }, fromHTML(icon('bulb')), 'Gedanke'),
      h('button', { type: 'button', class: 'pop-btn', onClick: async () => { try { await navigator.clipboard.writeText(this.sel.text); toast('Kopiert'); } catch { toast('Kopieren ist hier nicht erlaubt.'); } this.hidePop(); } }, 'Kopieren'),
    ], s.rect);
  }

  async addHighlight(color, quiet = false) {
    const s = this.sel || this.engine.selectionLoc();
    if (!s) return null;
    const hl = await saveHighlight({ documentId: this.doc.id, loc: s.loc, text: s.text.slice(0, 2000), color, chapter: this.engine.chapterLabel() });
    window.getSelection()?.removeAllRanges();
    this.hidePop();
    this.engine.paintHighlights();
    if (!quiet) toast('Markiert', { timeout: 1600 });
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
    this.showPop('mark', [
      ...['amber', 'rose', 'sage', 'azure'].map((c) => h('button', { type: 'button', class: `pop-color c-${c} ${x.color === c ? 'on' : ''}`, 'aria-label': 'Farbe', onClick: recolor(c) })),
      h('span', { class: 'pop-sep' }),
      h('button', { type: 'button', class: 'pop-btn', onClick: () => { this.hidePop(); note ? openNoteEditor({ id: note.id }) : openNoteEditor({ kind: 'thought', documentId: this.doc.id, chapter: x.chapter, loc: x.loc, highlightId: x.id, quote: x.text }); } }, note ? 'Notiz öffnen' : 'Gedanke'),
      h('button', { type: 'button', class: 'pop-btn danger', onClick: async () => { await deleteHighlight(id); this.engine.paintHighlights(); this.hidePop(); } }, 'Entfernen'),
    ], rect);
  }

  showPop(mode, kids, rect) {
    this.pop.dataset.mode = mode;
    this.pop.replaceChildren(...kids);
    this.pop.hidden = false;
    const pw = this.pop.offsetWidth;
    const ph = this.pop.offsetHeight;
    let left = (rect.left + rect.right) / 2 - pw / 2;
    left = clamp(left, 8, innerWidth - pw - 8);
    // On phones the system menu sits above the selection, so ours goes below it.
    let top = isTouch() ? rect.bottom + 14 : rect.top - ph - 10;
    if (top < 54) top = rect.bottom + 10;
    if (top + ph > innerHeight - 8) top = Math.max(54, rect.top - ph - 10);
    this.pop.style.left = `${left}px`;
    this.pop.style.top = `${top}px`;
  }

  hidePop() {
    this.pop.hidden = true;
    this.pop.dataset.mode = '';
  }

  // ---------------------------------------------------------------- bookmarks

  bookmarkHere() {
    const e = this.engine;
    if (!e) return null;
    const list = idx.bmByDoc.get(this.doc.id) || [];
    if (e instanceof PdfEngine) {
      const n = e.currentPage();
      return list.find((b) => b.loc?.page === n && b.loc.spine == null) || list.find((b) => b.loc?.page === n) || null;
    }
    const off = e.lastOffset ?? 0;
    return list.find((b) => {
      if (b.loc?.spine !== e.i) return false;
      if (b.loc.offset == null) return Math.abs((b.loc.frac || 0) - e.fracInChapter()) < 0.03;
      if (e.pagesMode) return e.pageOfOffset(b.loc.offset) === e.page;
      return b.loc.offset >= off - 50 && b.loc.offset < off + 900;
    }) || null;
  }

  isBookmarkedPage() {
    return !!this.bookmarkHere();
  }

  refreshBookmark() {
    const on = !!this.bookmarkHere();
    this.bmBtn.innerHTML = icon(on ? 'bookmarkFill' : 'bookmark');
    this.bmBtn.classList.toggle('on', on);
    this.bmBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  async toggleBookmark() {
    const b = this.bookmarkHere();
    if (b) {
      await deleteBookmark(b.id);
      toast('Lesezeichen entfernt', { timeout: 1500 });
    } else {
      const loc = this.engine.currentLoc();
      await addBookmark({ documentId: this.doc.id, loc, label: `${this.engine.chapterLabel()} · ${Math.round(this.engine.percent() * 100)} %` });
      toast('Lesezeichen gesetzt', { timeout: 1500 });
    }
    this.refreshBookmark();
    this.engine.updatePageChrome?.();
  }

  // ---------------------------------------------------------------- sheets

  openPanel(title, body, opts = {}) {
    this.sheet?.close();
    this.sheet = openSheet({ title, body, panel: isDesktop(), tall: opts.tall, className: `reader-sheet ${opts.className || ''}`, onClose: () => (this.sheet = null) });
    return this.sheet;
  }

  openToc() {
    const items = this.engine.tocItems();
    if (!items.length) return toast('Dieses Buch hat kein Inhaltsverzeichnis.');
    const pdf = this.engine instanceof PdfEngine;
    const cur = pdf ? this.engine.currentPage() : this.engine.i;
    let currentIdx = -1;
    items.forEach((t, i) => {
      const v = pdf ? t.loc.page : t.loc.spine;
      if (v != null && v <= cur) currentIdx = i;
    });
    const list = h('ul', { class: 'list toc-list' }, items.map((t, i) => h('li', null, h('button', {
      type: 'button',
      class: `cell toc-item ${i === currentIdx ? 'current' : ''}`,
      style: { '--depth': t.depth || 0 },
      onClick: () => { this.sheet?.close(); this.goTo({ ...t.loc }); },
    }, h('span', { class: 'cell-main' }, h('span', { class: 'cell-title wrap' }, t.label)), t.loc.page && pdf ? h('span', { class: 'cell-detail' }, String(t.loc.page)) : null))));
    this.openPanel('Inhalt', list, { tall: true });
    requestAnimationFrame(() => list.querySelector('.current')?.scrollIntoView({ block: 'center' }));
  }

  openSearch() {
    const out = h('div');
    const run = debounce(async (q) => {
      q = q.trim();
      this.lastSearch = q;
      if (q.length < 2) return out.replaceChildren();
      let res = await searchInDocument(this.doc.id, q);
      if (res === null) {
        out.replaceChildren(h('p', { class: 'group-foot' }, 'Das Buch wird durchsuchbar gemacht …'));
        const parts = this.rec ? reflowParts(this.rec) : await extractParts(this.doc);
        if (parts) await db.fulltext.put({ documentId: this.doc.id, parts, at: Date.now() });
        res = (await searchInDocument(this.doc.id, q)) || [];
      }
      out.replaceChildren(
        h('p', { class: 'group-foot' }, res.length ? `${res.length}${res.length >= 300 ? '+' : ''} ${res.length === 1 ? 'Stelle' : 'Stellen'}` : 'Nicht gefunden.'),
        res.length ? h('ul', { class: 'list' }, res.map((r) => h('li', null, h('button', { type: 'button', class: 'cell stack passage', onClick: () => { this.sheet?.close(); this.goTo({ ...r.loc }); } }, h('span', { class: 'cell-sub' }, r.part.label), h('span', { class: 'passage-text' }, r.pre, h('mark', null, r.hit), r.post))))) : null,
      );
    }, 250);
    const field = searchField({ placeholder: 'Wort oder Satz im Buch', value: this.lastSearch || '', onInput: run });
    this.openPanel('Im Buch suchen', h('div', null, field, out), { tall: true });
    setTimeout(() => field.querySelector('input')?.focus(), 80);
    if (this.lastSearch) run(this.lastSearch);
  }

  openNotes() {
    const doc = this.doc;
    const e = this.engine;
    const chapter = e.chapterLabel();
    const hls = [...(idx.hlByDoc.get(doc.id) || [])];
    const bms = [...(idx.bmByDoc.get(doc.id) || [])];
    const notes = [...this.notesForDoc()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const here = e.currentLoc();
    const go = (loc) => { this.sheet?.close(); this.goTo({ ...loc }); };
    this.openPanel('Notizen', h('div', null,
      h('div', { class: 'note-quick' },
        h('button', { type: 'button', class: 'btn tinted', onClick: () => openNoteEditor({ kind: 'summary', documentId: doc.id, chapter, loc: here, title: `Zusammenfassung: ${chapter}` }) }, fromHTML(icon('fileText')), 'Kapitel zusammenfassen'),
        h('button', { type: 'button', class: 'btn tinted', onClick: () => openNoteEditor({ kind: 'thought', documentId: doc.id, chapter, loc: here }) }, fromHTML(icon('bulb')), 'Gedanke'),
        h('button', { type: 'button', class: 'btn tinted', onClick: () => openNoteEditor({ kind: 'quote', documentId: doc.id, chapter, loc: here }) }, fromHTML(icon('quote')), 'Zitat'),
      ),
      notes.length ? group({ head: 'Notizen', icons: true, rows: notes.map((n) => { const k = noteKind(n.kind); return cell({ title: noteTitle(n), sub: [k.label, n.chapter].filter(Boolean).join(' · '), icon: k.icon, tint: 'var(--accent)', onClick: () => openNoteEditor({ id: n.id }) }); }) }) : null,
      group({ head: 'Lesezeichen', rows: bms.length ? bms.map((b) => cell({ title: b.label || 'Lesezeichen', onClick: () => go(b.loc), chevron: true })) : [cell({ title: 'Noch keine Lesezeichen', sub: 'Das Bändchen oben rechts setzt eins.' })] }),
      group({ head: 'Markierungen', rows: hls.length ? hls.map((x) => cell({ title: `„${x.text.slice(0, 160)}${x.text.length > 160 ? '…' : ''}“`, sub: x.chapter || '', wrap: true, className: `mark-cell c-${x.color || 'amber'}`, onClick: () => go(x.loc) })) : [cell({ title: 'Noch keine Markierungen', sub: 'Text auswählen, um ihn zu markieren.' })] }),
    ), { tall: true });
  }

  openType() {
    const p = this.prefs;
    const preview = h('div', { class: `type-preview skin-${p.skin}`, style: { fontFamily: fontCss(p.font), fontWeight: p.weight, lineHeight: p.leading } }, h('p', null, 'Es war einmal ein Buch, das man lesen konnte, ohne je zu zoomen – ruhig, warm und genau so, wie man es mag.'));
    const set = async (patch) => {
      await this.setPrefs(patch);
      this.openType();
    };
    const isPdf = this.doc.format === 'pdf';
    const original = this.view === 'original';
    const skins = h('div', { class: 'skin-grid', role: 'radiogroup', 'aria-label': 'Papier' }, SKINS.map((s) => h('button', { type: 'button', class: `skin-chip skin-${s.id} ${p.skin === s.id ? 'on' : ''}`, role: 'radio', 'aria-checked': p.skin === s.id ? 'true' : 'false', onClick: () => set({ skin: s.id }) }, h('span', { class: 'skin-sample' }, 'Aa'), h('span', { class: 'skin-name' }, s.name))));
    const fonts = h('div', { class: 'font-grid', role: 'radiogroup', 'aria-label': 'Schrift' }, FONTS.map((f) => h('button', { type: 'button', class: `font-chip ${p.font === f.id ? 'on' : ''}`, role: 'radio', 'aria-checked': p.font === f.id ? 'true' : 'false', onClick: () => set({ font: f.id }) }, h('span', { class: 'font-sample', style: { fontFamily: f.css } }, 'Ag'), h('span', { class: 'font-name' }, f.name))));
    const row = (label, control) => h('div', { class: 'cell' }, h('span', { class: 'cell-main' }, h('span', { class: 'cell-title' }, label)), control);
    const body = h('div', { class: 'type-sheet' },
      original ? null : preview,
      isPdf ? group({ rows: [row('Ansicht', segmented([{ value: 'text', label: 'Text' }, { value: 'original', label: 'Original' }], this.view, (v) => { this.sheet?.close(); this.switchView(v); }))] }) : null,
      group({ head: 'Papier', rows: [h('div', { class: 'cell' }, skins)] }),
      original
        ? group({ head: 'Original', rows: [row('Zoom', stepper(this.engine.zoom || 1, { min: 0.5, max: 3, step: 0.15, format: (v) => `${Math.round(v * 100)} %`, label: 'Zoom' }, (v) => this.engine.setZoom(v)))] })
        : [
            group({ head: 'Schrift', rows: [h('div', { class: 'cell' }, fonts)] }),
            group({
              rows: [
                row('Größe', stepper(p.size, { min: 14, max: 32, step: 1, format: (v) => `${v} pt`, label: 'Schriftgröße' }, (v) => this.setPrefs({ size: v }))),
                row('Stärke', segmented(WEIGHTS, p.weight, (v) => this.setPrefs({ weight: v }))),
                row('Zeilenabstand', stepper(p.leading, { min: 1.2, max: 2.1, step: 0.05, format: (v) => v.toFixed(2).replace('.', ','), label: 'Zeilenabstand' }, (v) => this.setPrefs({ leading: v }))),
                row('Absätze', segmented([{ value: 0, label: 'Einzug' }, { value: 0.5, label: 'Klein' }, { value: 1, label: 'Groß' }], p.para, (v) => this.setPrefs({ para: v }))),
                row('Ränder', segmented([{ value: 's', label: 'Schmal' }, { value: 'm', label: 'Mittel' }, { value: 'l', label: 'Breit' }], p.margins, (v) => this.setPrefs({ margins: v }))),
                row('Ausrichtung', segmented([{ value: 'auto', label: 'Auto' }, { value: 'justify', label: 'Block' }, { value: 'left', label: 'Links' }], p.align, (v) => this.setPrefs({ align: v }))),
              ],
            }),
            group({
              rows: [
                row('Lesemodus', segmented([{ value: 'pages', label: 'Seiten' }, { value: 'scroll', label: 'Scrollen' }], p.mode, async (v) => { await this.setPrefs({ mode: v }); this.engine.show?.(this.engine.i, this.engine.currentLoc()); })),
                isDesktop() ? switchCell({ title: 'Doppelseite', checked: p.spread, onChange: (v) => this.setPrefs({ spread: v }) }) : null,
                switchCell({ title: 'Verzierungen', sub: 'Ornamente und kleine Überraschungen', checked: p.ornaments, onChange: async (v) => { await this.setPrefs({ ornaments: v }); this.engine.show?.(this.engine.i, this.engine.currentLoc()); } }),
              ],
            }),
          ],
    );
    // Re-render in place when already open, so tapping a skin or font does not re-animate the sheet.
    if (this.sheet?.el?.classList.contains('type')) {
      const keep = this.sheet.body.scrollTop;
      this.sheet.body.replaceChildren(body);
      this.sheet.body.scrollTop = keep;
      return;
    }
    this.setChrome(false);
    this.openPanel('Darstellung', body, { className: 'type' });
  }

  // ---------------------------------------------------------------- writing (own texts)

  async toggleEdit(force) {
    const on = force ?? !this.editing;
    if (on === !!this.editing) return;
    if (on) {
      this.editing = true;
      this.root.classList.add('editing');
      this.editBtn?.classList.add('on');
      const body = await getText(this.doc.id);
      const ta = h('textarea', { class: 'rd-editor', spellcheck: 'true', 'aria-label': 'Text' }, body);
      const status = h('span', { class: 'rd-edit-status' }, 'Gesichert');
      const save = debounce(async () => {
        await saveText(this.doc.id, ta.value);
        status.textContent = 'Gesichert';
      }, 700);
      ta.addEventListener('input', () => {
        status.textContent = 'Schreibe …';
        save();
      });
      this.flushEdit = async () => {
        save.cancel();
        await saveText(this.doc.id, ta.value);
        return ta.value;
      };
      this.showOverlay(h('div', { class: 'rd-edit' }, h('div', { class: 'rd-edit-bar' }, h('span', { class: 'muted small' }, '# Überschrift · **fett** · *kursiv* · > Zitat · - Liste'), status, h('button', { type: 'button', class: 'btn filled small', onClick: () => this.toggleEdit(false) }, 'Fertig')), ta));
      this.overlay.classList.add('edit');
      ta.focus();
    } else {
      const body = await this.flushEdit?.();
      this.editing = false;
      this.root.classList.remove('editing');
      this.editBtn?.classList.remove('on');
      this.overlay.classList.remove('edit');
      this.hideOverlay();
      this.source?.setText?.(body ?? (await getText(this.doc.id)));
      await this.engine.show(0, { offset: 0 });
      enqueueIndex(this.doc.id, { force: true });
      toast('Gesichert', { timeout: 1500 });
    }
  }

  destroy() {
    this.unsub?.();
    if (this.editing) this.flushEdit?.();
    this.persist();
    clearTimeout(this.chromeTimer);
    this.sheet?.close();
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('selectionchange', this.onSel);
    document.removeEventListener('visibilitychange', this.onHide);
    window.removeEventListener('resize', this.onResize);
    this.onSel?.cancel?.();
    this.engine?.destroy?.();
  }
}
