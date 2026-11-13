// Reflowing reader for EPUB books and manuscripts written in the library. One chapter at a time,
// set in the reader's own typography, so text fits any screen without zooming.

import { h, renderMarkdown, markdownHeadings } from '../util.js';
import { idx, getFileBlob, getText } from '../store.js';
import { openEpub, resolvePath } from '../import/epub.js';
import { sanitizeChapter } from './sanitize.js';
import { wrapOffsets, unwrap, findOffsets, rectAt, rangeOffsets } from './textmarks.js';
import { getFulltext } from '../import/indexer.js';

export class FlowEngine {
  constructor(doc, reader) {
    this.doc = doc;
    this.reader = reader;
    this.kind = doc.format === 'text' ? 'text' : 'epub';
    this.i = 0;
    this.urls = new Map();
    this.weights = null;
    this.findMarks = [];
    this.loading = 0;
  }

  async init(scroll) {
    this.scroll = scroll;
    this.page = h('div', { class: 'rd-page' });
    scroll.replaceChildren(this.page);
    if (this.kind === 'epub') {
      const blob = await getFileBlob(this.doc.fileId);
      if (!blob) throw new Error('The file of this volume is not on this device, and it could not be fetched from the cloud.');
      this.book = await openEpub(blob);
      this.count = this.book.spine.length;
      this.toc = this.book.toc;
      this.lang = this.book.meta.language || '';
    } else {
      this.body = await getText(this.doc.id);
      this.count = 1;
      this.toc = markdownHeadings(this.body).map((x) => ({ label: x.label, depth: x.depth, loc: { spine: 0, anchor: x.anchor } }));
    }
    const ft = await getFulltext(this.doc.id);
    if (ft?.parts?.length === this.count) {
      const lens = ft.parts.map((p) => Math.max(1, p.text.length));
      const total = lens.reduce((a, b) => a + b, 0);
      let acc = 0;
      this.weights = lens.map((l) => {
        const w = { from: acc / total, size: l / total };
        acc += l;
        return w;
      });
    }
  }

  tocItems() {
    return this.toc || [];
  }

  chapterLabel(i = this.i) {
    if (this.kind === 'text') return this.doc.title;
    return this.book.labelFor(i);
  }

  async chapterContent(i) {
    if (this.kind === 'text') {
      const art = h('div', { html: renderMarkdown(this.body, { headingIds: true }) });
      art.querySelectorAll('[id^="h-"]').forEach((el) => (el.id = `c0-${el.id}`));
      return art;
    }
    const s = this.book.spine[i];
    const d = await this.book.chapterDocument(i);
    if (!d) return h('div', null, h('p', null, 'This part of the book could not be read.'));
    // Fetch the chapter's pictures first; the sanitizer only accepts ready URLs.
    const srcs = new Set();
    d.querySelectorAll('img[src]').forEach((im) => srcs.add(im.getAttribute('src')));
    d.querySelectorAll('image').forEach((im) => {
      const v = im.getAttribute('href') || im.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (v) srcs.add(v);
    });
    for (const src of srcs) {
      const path = resolvePath(s.href, src);
      if (!this.urls.has(path)) {
        const b = await this.book.blob(path);
        this.urls.set(path, b ? URL.createObjectURL(b) : null);
      }
    }
    const { el } = sanitizeChapter(d, {
      prefix: `c${i}-`,
      resolveImage: (src) => this.urls.get(resolvePath(s.href, src)) || null,
      resolveHref: (href) => {
        if (href.startsWith('#')) return { spine: i, anchor: href.slice(1) };
        const full = resolvePath(s.href, href);
        const spine = this.book.spineIndexOf(full);
        return spine >= 0 ? { spine, anchor: href.includes('#') ? href.split('#')[1] : null } : null;
      },
    });
    return el;
  }

  async show(i, loc = {}) {
    i = Math.max(0, Math.min(this.count - 1, i | 0));
    const token = ++this.loading;
    const content = await this.chapterContent(i);
    if (token !== this.loading) return;
    this.i = i;
    this.findMarks = [];
    this.article = h('article', { class: 'rd-chapter', lang: this.lang || null }, content);
    const nav = h(
      'nav',
      { class: 'rd-chapter-nav' },
      i > 0 ? h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => this.go({ spine: i - 1, frac: 0.999 }) }, '‹ ', this.chapterLabel(i - 1)) : h('span'),
      i < this.count - 1 ? h('button', { type: 'button', class: 'btn btn-ghost next', onClick: () => this.go({ spine: i + 1, frac: 0 }) }, this.chapterLabel(i + 1), ' ›') : h('span', { class: 'rd-end' }, 'Finis'),
    );
    this.page.replaceChildren(this.article, nav);
    this.article.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-spine]');
      if (a) {
        e.preventDefault();
        this.go({ spine: +a.dataset.spine, anchor: a.dataset.anchor || null });
      }
    });
    this.paintHighlights();
    this.reader.onChapter(i);
    await waitForImages(this.article, 700);
    this.position(loc);
  }

  position(loc) {
    const sc = this.scroll;
    if (loc.anchor) {
      const el = this.article.querySelector(`#${CSS.escape(`c${this.i}-${loc.anchor}`)}`);
      if (el) {
        sc.scrollTop = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 24;
        return;
      }
    }
    if (loc.find) {
      const near = loc.start || 0;
      const off = findOffsets(this.article, loc.find, near);
      if (off) {
        this.findMarks = wrapOffsets(this.article, off.start, off.end, () => h('mark', { class: 'find-hit' }));
        this.findMarks[0]?.scrollIntoView({ block: 'center' });
        setTimeout(() => this.clearFind(), 5000);
        return;
      }
    }
    if (loc.start != null) {
      const r = rectAt(this.article, loc.start, loc.end);
      if (r) {
        sc.scrollTop += r.top - sc.getBoundingClientRect().top - sc.clientHeight * 0.3;
        return;
      }
    }
    const max = sc.scrollHeight - sc.clientHeight;
    sc.scrollTop = Math.max(0, (loc.frac || 0) * max);
  }

  clearFind() {
    if (this.findMarks.length) unwrap(this.findMarks);
    this.findMarks = [];
  }

  async go(loc) {
    if (loc.spine == null) loc.spine = this.i;
    if (loc.spine === this.i && this.article) this.position(loc);
    else await this.show(loc.spine, loc);
    this.reader.onMove();
  }

  frac() {
    const sc = this.scroll;
    const max = sc.scrollHeight - sc.clientHeight;
    return max > 0 ? Math.min(1, Math.max(0, sc.scrollTop / max)) : 1;
  }

  currentLoc() {
    return { spine: this.i, frac: +this.frac().toFixed(4) };
  }

  percent() {
    const f = this.frac();
    if (this.weights) {
      const w = this.weights[this.i];
      return w.from + w.size * f;
    }
    return (this.i + f) / this.count;
  }

  locLabel(loc) {
    return this.chapterLabel(loc.spine ?? this.i);
  }

  hasPrev() {
    return this.i > 0;
  }
  hasNext() {
    return this.i < this.count - 1;
  }
  prev() {
    if (this.hasPrev()) this.go({ spine: this.i - 1, frac: 0 });
  }
  next() {
    if (this.hasNext()) this.go({ spine: this.i + 1, frac: 0 });
  }

  paintHighlights() {
    if (!this.article) return;
    unwrap([...this.article.querySelectorAll('mark.hl')]);
    const list = (idx.hlByDoc.get(this.doc.id) || []).filter((x) => x.loc?.spine === this.i).sort((a, b) => a.loc.start - b.loc.start);
    const noted = new Set(this.reader.notesForDoc().map((n) => n.highlightId).filter(Boolean));
    for (const x of list) {
      wrapOffsets(this.article, x.loc.start, x.loc.end, () => h('mark', { class: `hl c-${x.color || 'amber'}${noted.has(x.id) ? ' has-note' : ''}`, 'data-hl': x.id }));
    }
  }

  /** Current selection as a highlight address, if it lies in the chapter. */
  selectionLoc() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !this.article) return null;
    const range = sel.getRangeAt(0);
    if (!this.article.contains(range.commonAncestorContainer)) return null;
    const off = rangeOffsets(this.article, range);
    if (!off) return null;
    const text = range.toString().replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return { loc: { spine: this.i, start: off.start, end: off.end }, text, rect: range.getBoundingClientRect() };
  }

  setText(body) {
    this.body = body;
    this.toc = markdownHeadings(body).map((x) => ({ label: x.label, depth: x.depth, loc: { spine: 0, anchor: x.anchor } }));
  }

  destroy() {
    for (const u of this.urls.values()) if (u) URL.revokeObjectURL(u);
    this.urls.clear();
  }
}

function waitForImages(root, timeout) {
  const imgs = [...root.querySelectorAll('img')].filter((i) => !i.complete);
  if (!imgs.length) return Promise.resolve();
  return Promise.race([Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))), new Promise((r) => setTimeout(r, timeout))]);
}
