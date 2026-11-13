// PDF reader: pages fitted to the width of the screen, drawn only when they come into view, with a
// selectable text layer for highlights, notes and search.

import { h, looseRegex } from '../util.js';
import { idx, getFileBlob } from '../store.js';
import { loadPdfjs } from '../deps.js';
import { openPdf } from '../import/pdf.js';

export class PdfEngine {
  constructor(doc, reader) {
    this.doc = doc;
    this.reader = reader;
    this.zoom = 1;
    this.rendered = new Map(); // page -> {canvas, text, hl, task}
    this.page = 1;
  }

  async init(scroll) {
    this.scroll = scroll;
    this.pdfjs = await loadPdfjs();
    const blob = await getFileBlob(this.doc.fileId);
    if (!blob) throw new Error('The file of this volume is not on this device, and it could not be fetched from the cloud.');
    this.pdf = await openPdf(blob);
    this.count = this.pdf.numPages;
    const p1 = await this.pdf.getPage(1);
    this.base = p1.getViewport({ scale: 1 });
    this.sizes = new Map([[1, { w: this.base.width, h: this.base.height }]]);
    this.wrap = h('div', { class: 'pdf-pages' });
    scroll.replaceChildren(this.wrap);
    scroll.addEventListener('scroll', () => this.reader.onMove(), { passive: true });
    this.toc = [];
    try {
      const outline = await this.pdf.getOutline();
      const walk = async (items, depth) => {
        for (const it of items || []) {
          if (this.toc.length > 800) return;
          let page = null;
          try {
            let dest = it.dest;
            if (typeof dest === 'string') dest = await this.pdf.getDestination(dest);
            if (Array.isArray(dest) && dest[0]) page = (await this.pdf.getPageIndex(dest[0])) + 1;
          } catch {
            /* unresolved */
          }
          if (page) this.toc.push({ label: String(it.title || '').trim() || `Seite ${page}`, depth, loc: { page } });
          if (it.items?.length) await walk(it.items, depth + 1);
        }
      };
      await walk(outline, 0);
    } catch {
      /* no outline */
    }
    if (!this.toc.length && this.doc.toc?.length) this.toc = this.doc.toc;
    this.layout();
    this.io = new IntersectionObserver((entries) => this.onIntersect(entries), { root: scroll, rootMargin: '150% 0px' });
    this.wrap.querySelectorAll('.pdf-page').forEach((el) => this.io.observe(el));
    this.onResize = () => {
      const w = this.scroll.clientWidth;
      if (Math.abs(w - (this.lastWidth || 0)) > 40) this.relayout();
    };
    window.addEventListener('resize', this.onResize);
  }

  computeScale() {
    const avail = Math.min(this.scroll.clientWidth - (this.scroll.clientWidth < 600 ? 12 : 48), 980);
    this.lastWidth = this.scroll.clientWidth;
    return (avail / this.base.width) * this.zoom;
  }

  layout() {
    this.scale = this.computeScale();
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= this.count; n++) {
      const sz = this.sizes.get(n) || this.sizes.get(1);
      const el = h('div', {
        class: 'pdf-page',
        'data-page': n,
        style: { width: `${Math.floor(sz.w * this.scale)}px`, height: `${Math.floor(sz.h * this.scale)}px`, '--scale-factor': this.scale, '--total-scale-factor': this.scale, '--user-unit': 1 },
      }, h('span', { class: 'pdf-num' }, String(n)));
      frag.append(el);
    }
    this.wrap.replaceChildren(frag);
  }

  relayout() {
    const loc = this.currentLoc();
    for (const [n] of this.rendered) this.unrender(n);
    this.io?.disconnect();
    this.layout();
    this.wrap.querySelectorAll('.pdf-page').forEach((el) => this.io.observe(el));
    this.go(loc, { silent: true });
  }

  setZoom(z) {
    this.zoom = Math.max(0.5, Math.min(3, z));
    this.relayout();
  }

  pageEl(n) {
    return this.wrap.querySelector(`.pdf-page[data-page="${n}"]`);
  }

  onIntersect(entries) {
    for (const e of entries) {
      const n = +e.target.dataset.page;
      if (e.isIntersecting) this.render(n);
    }
    // Free pages far from view.
    if (this.rendered.size > 14) {
      const cur = this.currentPage();
      for (const [n] of this.rendered) if (Math.abs(n - cur) > 6) this.unrender(n);
    }
  }

  async render(n) {
    if (this.rendered.has(n)) return;
    const el = this.pageEl(n);
    if (!el) return;
    const slot = { canvas: null, task: null };
    this.rendered.set(n, slot);
    try {
      const page = await this.pdf.getPage(n);
      const vp = page.getViewport({ scale: this.scale });
      if (!this.sizes.has(n)) {
        const v1 = page.getViewport({ scale: 1 });
        this.sizes.set(n, { w: v1.width, h: v1.height });
        el.style.width = `${Math.floor(vp.width)}px`;
        el.style.height = `${Math.floor(vp.height)}px`;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = h('canvas', { class: 'pdf-canvas' });
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      slot.canvas = canvas;
      const ctx = canvas.getContext('2d');
      slot.task = page.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
      el.append(canvas);
      await slot.task.promise;
      if (!this.rendered.has(n)) return;
      const tl = h('div', { class: 'textLayer' });
      const hl = h('div', { class: 'hl-layer' });
      el.append(hl, tl);
      slot.text = tl;
      slot.hl = hl;
      const layer = new this.pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp });
      await layer.render();
      tl.append(h('div', { class: 'endOfContent' }));
      this.paintHighlights(n);
      if (this.pendingFind && this.pendingFind.page === n) this.applyFind(n);
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') console.warn('PDF page', n, e);
    }
  }

  unrender(n) {
    const slot = this.rendered.get(n);
    if (!slot) return;
    try {
      slot.task?.cancel();
    } catch {
      /* ignore */
    }
    const el = this.pageEl(n);
    if (el) el.querySelectorAll('canvas, .textLayer, .hl-layer').forEach((x) => x.remove());
    if (slot.canvas) {
      slot.canvas.width = 0;
      slot.canvas.height = 0;
    }
    this.rendered.delete(n);
  }

  currentPage() {
    const sc = this.scroll.getBoundingClientRect();
    const mid = sc.top + sc.height * 0.35;
    const pages = this.wrap.children;
    let lo = 0;
    let hi = pages.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (pages[m].getBoundingClientRect().bottom < mid) lo = m + 1;
      else hi = m;
    }
    return lo + 1;
  }

  currentLoc() {
    const n = this.currentPage();
    const el = this.pageEl(n);
    const sc = this.scroll.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const frac = r.height ? Math.max(0, Math.min(1, (sc.top - r.top) / r.height)) : 0;
    return { page: n, frac: +frac.toFixed(4) };
  }

  percent() {
    const l = this.currentLoc();
    const max = this.scroll.scrollHeight - this.scroll.clientHeight;
    if (max > 0 && this.scroll.scrollTop >= max - 2) return 1;
    return Math.min(1, (l.page - 1 + l.frac) / this.count);
  }

  tocItems() {
    return this.toc;
  }

  pageInfo() {
    return { page: this.currentPage(), pages: this.count };
  }

  chapterLabel() {
    const n = this.currentPage();
    let best = null;
    for (const t of this.toc) if (t.loc.page <= n && (!best || t.loc.page >= best.loc.page)) best = t;
    return best ? `${best.label} · S. ${n}` : `Seite ${n} von ${this.count}`;
  }

  locLabel(loc) {
    return `Seite ${loc.page || 1}`;
  }

  async go(loc, { silent = false } = {}) {
    const n = Math.max(1, Math.min(this.count, loc.page || 1));
    const el = this.pageEl(n);
    if (!el) return;
    let y = el.offsetTop + (loc.frac || 0) * el.offsetHeight;
    if (loc.rects?.length) y = el.offsetTop + loc.rects[0].y * el.offsetHeight - this.scroll.clientHeight * 0.3;
    this.scroll.scrollTop = Math.max(0, y - 8);
    if (loc.find) {
      this.pendingFind = { page: n, find: loc.find };
      if (this.rendered.get(n)?.text) this.applyFind(n);
    }
    this.tick(n);
    if (!silent) this.reader.onMove();
  }

  /** Draw the page in view and its neighbours, even if the observer has not fired yet. */
  tick(n = this.currentPage()) {
    for (let k = n - 1; k <= n + 1; k++) if (k >= 1 && k <= this.count && !this.rendered.has(k)) this.render(k);
  }

  applyFind(n) {
    const slot = this.rendered.get(n);
    if (!slot?.text || !this.pendingFind) return;
    const re = looseRegex(this.pendingFind.find, 'iu');
    this.pendingFind = null;
    const spans = [...slot.text.querySelectorAll('span')].filter((s) => re.test(s.textContent));
    spans.forEach((s) => s.classList.add('find-hit'));
    if (spans[0]) {
      const r = spans[0].getBoundingClientRect();
      const sc = this.scroll.getBoundingClientRect();
      this.scroll.scrollTop += r.top - sc.top - sc.height * 0.35;
    }
    setTimeout(() => spans.forEach((s) => s.classList.remove('find-hit')), 6000);
  }

  hasPrev() {
    return this.currentPage() > 1;
  }
  hasNext() {
    return this.currentPage() < this.count;
  }
  prev() {
    this.go({ page: this.currentPage() - 1 });
  }
  next() {
    this.go({ page: this.currentPage() + 1 });
  }

  paintHighlights(only = null) {
    const list = idx.hlByDoc.get(this.doc.id) || [];
    const noted = new Set(this.reader.notesForDoc().map((n) => n.highlightId).filter(Boolean));
    for (const [n, slot] of this.rendered) {
      if (only && n !== only) continue;
      if (!slot.hl) continue;
      slot.hl.replaceChildren(
        ...list
          .filter((x) => x.loc?.page === n)
          .flatMap((x) =>
            (x.loc.rects || []).map((r) =>
              h('div', {
                class: `hl-rect c-${x.color || 'amber'}${noted.has(x.id) ? ' has-note' : ''}`,
                'data-hl': x.id,
                style: { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` },
              }),
            ),
          ),
      );
    }
  }

  /** Highlight under a click, if any. */
  highlightAt(clientX, clientY) {
    const el = document.elementsFromPoint(clientX, clientY).find((x) => x.classList?.contains('pdf-page'));
    if (!el) return null;
    const n = +el.dataset.page;
    const r = el.getBoundingClientRect();
    const fx = (clientX - r.left) / r.width;
    const fy = (clientY - r.top) / r.height;
    return (idx.hlByDoc.get(this.doc.id) || []).find((x) => x.loc?.page === n && x.loc.rects?.some((q) => fx >= q.x && fx <= q.x + q.w && fy >= q.y && fy <= q.y + q.h)) || null;
  }

  selectionLoc() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const startEl = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement)?.closest('.pdf-page');
    if (!startEl || !this.wrap.contains(startEl)) return null;
    const n = +startEl.dataset.page;
    const pr = startEl.getBoundingClientRect();
    const rects = [];
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      if (r.bottom < pr.top || r.top > pr.bottom) continue;
      const q = { x: (r.left - pr.left) / pr.width, y: (r.top - pr.top) / pr.height, w: r.width / pr.width, h: r.height / pr.height };
      const last = rects[rects.length - 1];
      if (last && Math.abs(last.y - q.y) < q.h * 0.5 && q.x <= last.x + last.w + 0.02) {
        const right = Math.max(last.x + last.w, q.x + q.w);
        last.x = Math.min(last.x, q.x);
        last.w = right - last.x;
        last.h = Math.max(last.h, q.h);
      } else rects.push(q);
    }
    const text = range.toString().replace(/\s+/g, ' ').trim();
    if (!rects.length || !text) return null;
    const round = (v) => +v.toFixed(5);
    return { loc: { page: n, rects: rects.map((q) => ({ x: round(q.x), y: round(q.y), w: round(q.w), h: round(q.h) })) }, text, rect: range.getBoundingClientRect() };
  }

  destroy() {
    window.removeEventListener('resize', this.onResize);
    this.io?.disconnect();
    for (const [n] of this.rendered) this.unrender(n);
    this.pdf?.destroy();
  }
}
