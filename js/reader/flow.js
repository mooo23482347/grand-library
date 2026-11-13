// The reading engine. One chapter at a time, set in the reader's own typography, either in pages
// (CSS columns, turned horizontally, two pages side by side on wide screens) or as one long scroll.
// Positions are character offsets inside the chapter, independent of page size and font.

import { h, renderMarkdown, markdownHeadings, clamp } from '../util.js';
import { idx, getFileBlob, getText } from '../store.js';
import { openEpub, resolvePath } from '../import/epub.js';
import { sanitizeChapter } from './sanitize.js';
import { wrapOffsets, unwrap, findOffsets, rectAt, rangeOffsets, offsetOf } from './textmarks.js';
import { getFulltext } from '../import/indexer.js';
import { chapterText, blockOffset, offsetToPage, REFLOW_VERSION } from './reflow.js';
import { chapterOrnament, pageDecor } from './ornaments.js';

// ---------------------------------------------------------------- sources

/** A drop cap only opens real prose: a long paragraph beginning with a capital letter. */
const dropCapWorthy = (t) => String(t || '').length > 220 && /^[A-ZÄÖÜ]/.test(String(t).trim());

export async function epubSource(doc) {
  const blob = await getFileBlob(doc.fileId);
  if (!blob) throw new Error('Die Datei dieses Buchs ist nicht auf diesem Gerät und konnte nicht geladen werden.');
  const book = await openEpub(blob);
  const urls = new Map();
  const ft = await getFulltext(doc.id);
  const lengths = ft?.parts?.length === book.spine.length ? ft.parts.map((p) => Math.max(1, p.text.length)) : null;
  return {
    kind: 'epub',
    count: book.spine.length,
    toc: book.toc,
    lang: book.meta.language || '',
    lengths,
    label: (i) => book.labelFor(i),
    async render(i) {
      const s = book.spine[i];
      const d = await book.chapterDocument(i);
      if (!d) return h('div', null, h('p', null, 'Dieser Teil des Buchs ließ sich nicht lesen.'));
      const srcs = new Set();
      d.querySelectorAll('img[src]').forEach((im) => srcs.add(im.getAttribute('src')));
      d.querySelectorAll('image').forEach((im) => {
        const v = im.getAttribute('href') || im.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (v) srcs.add(v);
      });
      for (const src of srcs) {
        const path = resolvePath(s.href, src);
        if (!urls.has(path)) {
          const b = await book.blob(path);
          urls.set(path, b ? URL.createObjectURL(b) : null);
        }
      }
      const { el } = sanitizeChapter(d, {
        prefix: `c${i}-`,
        resolveImage: (src) => urls.get(resolvePath(s.href, src)) || null,
        resolveHref: (href) => {
          if (href.startsWith('#')) return { spine: i, anchor: href.slice(1) };
          const spine = book.spineIndexOf(resolvePath(s.href, href));
          return spine >= 0 ? { spine, anchor: href.includes('#') ? href.split('#')[1] : null } : null;
        },
      });
      [...el.querySelectorAll('p')].find((x) => dropCapWorthy(x.textContent))?.classList.add('first');
      return el;
    },
    dispose() {
      for (const u of urls.values()) if (u) URL.revokeObjectURL(u);
    },
  };
}

// Hyphenation needs the right lang attribute; PDFs rarely carry one, so guess from stop words.
const STOP = {
  de: ['der', 'die', 'und', 'nicht', 'das', 'ist', 'mit', 'auf', 'sich', 'auch', 'ein', 'eine', 'werden', 'wird', 'dass'],
  en: ['the', 'and', 'of', 'to', 'is', 'that', 'with', 'for', 'are', 'this', 'which', 'from', 'be', 'have', 'not'],
  fr: ['le', 'la', 'les', 'et', 'des', 'est', 'une', 'que', 'dans', 'pour', 'pas', 'qui', 'sur', 'avec', 'du'],
  es: ['el', 'la', 'los', 'y', 'que', 'en', 'es', 'una', 'por', 'con', 'para', 'las', 'del', 'como', 'se'],
  it: ['il', 'la', 'che', 'e', 'di', 'non', 'per', 'una', 'sono', 'con', 'del', 'della', 'gli', 'come', 'anche'],
};
export function guessLang(text) {
  const words = (text || '').slice(0, 20000).toLowerCase().match(/\p{L}+/gu) || [];
  if (words.length < 30) return '';
  let best = '', top = 0;
  for (const [lang, list] of Object.entries(STOP)) {
    const set = new Set(list);
    const n = words.reduce((a, w) => a + (set.has(w) ? 1 : 0), 0);
    if (n > top) [best, top] = [lang, n];
  }
  return top / words.length > 0.04 ? best : '';
}
const langOf = (doc, sample) => {
  const l = String(doc.language || '').trim().toLowerCase();
  if (/^[a-z]{2}(-|$)/.test(l)) return l.slice(0, 2);
  const named = { deutsch: 'de', german: 'de', englisch: 'en', english: 'en', französisch: 'fr', french: 'fr', spanisch: 'es', spanish: 'es', italienisch: 'it', italian: 'it' };
  return named[l] || guessLang(sample);
};

export async function textSource(doc) {
  let body = await getText(doc.id);
  const src = {
    kind: 'text',
    count: 1,
    lang: langOf(doc, body),
    get toc() {
      return markdownHeadings(body).map((x) => ({ label: x.label, depth: x.depth, loc: { spine: 0, anchor: x.anchor } }));
    },
    get lengths() {
      return [Math.max(1, body.length)];
    },
    label: () => doc.title,
    async render() {
      const el = h('div', { html: renderMarkdown(body, { headingIds: true }) });
      el.querySelectorAll('[id^="h-"]').forEach((x) => (x.id = `c0-${x.id}`));
      [...el.querySelectorAll('p')].find((x) => dropCapWorthy(x.textContent))?.classList.add('first');
      return el;
    },
    setText(t) {
      body = t;
    },
    dispose() {},
  };
  return src;
}

export function reflowSource(doc, rec) {
  const lengths = rec.chapters.map((ch) => Math.max(1, chapterText(ch).length));
  const toc = [];
  rec.chapters.forEach((ch, c) => {
    toc.push({ label: ch.title, depth: 0, loc: { spine: c, b: 0, page: ch.pg } });
    ch.blocks.forEach((b, k) => {
      if (b.t === 'h' && k > 0 && b.l <= 3 && b.x.length < 120) toc.push({ label: b.x, depth: 1, loc: { spine: c, b: k, page: b.pg } });
    });
  });
  return {
    kind: 'reflow',
    count: rec.chapters.length,
    toc,
    lang: langOf(doc, rec.chapters.slice(0, 3).map(chapterText).join(' ')),
    lengths,
    label: (i) => rec.chapters[i]?.title || '',
    blockOffset: (i, b) => blockOffset(rec.chapters[i], b),
    pageOf: (i, off) => offsetToPage(rec, i, off),
    async render(i) {
      const ch = rec.chapters[i];
      const box = document.createElement('div');
      if (ch.showTitle) {
        const t = document.createElement('h1');
        t.className = 'rd-ch-title';
        t.textContent = ch.title;
        box.append(t);
      }
      let first = true;
      ch.blocks.forEach((b, k) => {
        const el = document.createElement(b.t === 'h' ? (b.l <= 1 ? 'h2' : b.l === 2 ? 'h3' : 'h4') : 'p');
        if (b.t !== 'h' && first && dropCapWorthy(b.x)) {
          el.className = 'first';
          first = false;
        }
        el.dataset.b = k;
        el.textContent = b.x;
        box.append(el);
      });
      if (ch.notes.length) {
        const sec = document.createElement('section');
        sec.className = 'rd-notes';
        for (const n of ch.notes) {
          const p = document.createElement('p');
          p.textContent = n.x;
          sec.append(p);
        }
        box.append(sec);
      }
      return box;
    },
    dispose() {},
  };
}

// ---------------------------------------------------------------- engine

function caretAt(x, y) {
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  const p = document.caretPositionFromPoint?.(x, y);
  return p ? { node: p.offsetNode, offset: p.offset } : null;
}

function waitForImages(root, timeout) {
  const imgs = [...root.querySelectorAll('img')].filter((i) => !i.complete);
  if (!imgs.length) return Promise.resolve();
  return Promise.race([Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))), new Promise((r) => setTimeout(r, timeout))]);
}

export class FlowEngine {
  constructor(doc, reader, source) {
    this.doc = doc;
    this.reader = reader;
    this.source = source;
    this.count = source.count;
    this.i = 0;
    this.page = 0;
    this.pages = 1;
    this.findMarks = [];
    this.loading = 0;
    this.resume = null;
  }

  get pagesMode() {
    return this.reader.prefs.mode === 'pages';
  }

  init(host) {
    this.host = host;
    this.flow = h('div', { class: 'rd-flow' });
    this.viewport = h('div', { class: 'rd-viewport' }, this.flow);
    this.decor = h('div', { class: 'rd-decor', 'aria-hidden': 'true' });
    this.folio = h('div', { class: 'rd-folio', 'aria-hidden': 'true' });
    this.paper = h('div', { class: 'rd-paper' }, this.viewport, this.decor, this.folio);
    host.replaceChildren(this.paper);
    this.viewport.addEventListener('scroll', () => {
      if (!this.pagesMode) this.reader.onMove();
    }, { passive: true });
    this.wireTouch();
    this.layout();
  }

  tocItems() {
    return this.source.toc || [];
  }
  chapterLabel(i = this.i) {
    return this.source.label(i);
  }

  // ---------------- layout

  layout() {
    const p = this.reader.prefs;
    const stage = this.host.getBoundingClientRect();
    const phone = stage.width < 700;
    const measure = Math.round(p.size * 31);
    const margin = { s: phone ? 18 : 40, m: phone ? 26 : 60, l: phone ? 36 : 88 }[p.margins] || 26;
    const pages = this.pagesMode;
    const spread = pages && p.spread && !phone && stage.width >= 1100 && stage.height >= 560;
    this.spread = spread;
    this.reader.root.classList.toggle('spread', spread);
    this.reader.root.classList.toggle('mode-pages', pages);
    this.reader.root.classList.toggle('mode-scroll', !pages);
    this.reader.root.classList.toggle('phone', phone);
    const cols = spread ? 2 : 1;
    let w;
    let hgt;
    if (phone) {
      w = stage.width;
      hgt = stage.height;
    } else if (pages) {
      w = Math.min(stage.width - 56, cols * (measure + 2 * margin));
      hgt = Math.min(stage.height - 40, Math.max(520, (w / cols) * 1.42));
    } else {
      w = Math.min(stage.width - 48, measure + 2 * margin);
      hgt = stage.height;
    }
    const s = this.paper.style;
    s.setProperty('--paper-w', `${Math.floor(w)}px`);
    s.setProperty('--paper-h', `${Math.floor(hgt)}px`);
    s.setProperty('--mx', `${margin}px`);
    this.margin = margin;
    const f = this.flow.style;
    if (pages) {
      const W = this.viewport.clientWidth;
      const H = this.viewport.clientHeight;
      const gap = spread ? margin * 2 : margin * 2;
      const colW = spread ? (W - gap) / 2 : W;
      this.stride = W + gap;
      this.W = W;
      f.height = `${H}px`;
      f.columnWidth = `${colW}px`;
      f.columnGap = `${gap}px`;
      f.columnFill = 'auto';
      f.setProperty('--page-h', `${H}px`);
      this.viewport.scrollTop = 0;
    } else {
      f.height = '';
      f.columnWidth = '';
      f.columnGap = '';
      f.columnFill = '';
      f.transform = '';
    }
  }

  measure() {
    if (!this.pagesMode || !this.article) {
      this.pages = 1;
      return;
    }
    // Client rects include the current transform; measuring against the flow's own rect cancels it.
    const fr = this.flow.getBoundingClientRect();
    let right = 0;
    for (const r of this.article.getClientRects()) right = Math.max(right, r.right - fr.left);
    const last = this.article.lastElementChild;
    if (last) for (const r of last.getClientRects()) right = Math.max(right, r.right - fr.left);
    const per = this.spread ? 2 : 1;
    const colStride = this.spread ? this.stride / 2 : this.stride;
    const columns = Math.max(1, Math.ceil((right - 2) / colStride));
    this.pages = Math.max(1, Math.ceil(columns / per));
  }

  relayout() {
    const loc = this.article ? this.currentLoc() : null;
    this.layout();
    this.measure();
    if (loc) this.position(loc, { silent: true });
  }

  // ---------------- chapters

  async show(i, loc = {}) {
    i = clamp(i | 0, 0, this.count - 1);
    const token = ++this.loading;
    const content = await this.source.render(i);
    if (token !== this.loading) return;
    this.i = i;
    this.findMarks = [];
    const art = h('article', { class: 'rd-chapter', lang: this.source.lang || null });
    const firstEl = content.firstElementChild;
    if (this.reader.prefs.ornaments && firstEl && /^H[1-4]$/.test(firstEl.tagName)) art.append(chapterOrnament(this.doc.id, i));
    while (content.firstChild) art.append(content.firstChild);
    this.article = art;
    const nav = !this.pagesMode
      ? h('nav', { class: 'rd-chapter-nav' },
          i > 0 ? h('button', { type: 'button', class: 'btn', onClick: () => this.show(i - 1, { end: true }) }, '‹ ', this.chapterLabel(i - 1)) : h('span'),
          i < this.count - 1 ? h('button', { type: 'button', class: 'btn tinted', onClick: () => this.show(i + 1, {}) }, 'Weiter: ', this.chapterLabel(i + 1), ' ›') : h('button', { type: 'button', class: 'btn tinted', onClick: () => this.reader.onBookEnd() }, 'Buch beenden'))
      : null;
    this.flow.replaceChildren(art, nav || '');
    art.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-spine]');
      if (a) {
        e.preventDefault();
        e.stopPropagation();
        this.go({ spine: +a.dataset.spine, anchor: a.dataset.anchor || null });
      }
    });
    this.paintHighlights();
    await waitForImages(art, 700);
    if (token !== this.loading) return;
    this.layout();
    this.page = 0;
    this.flow.style.transition = 'none';
    this.flow.style.transform = '';
    this.measure();
    this.position(loc, { silent: true });
    this.reader.onChapter(i);
    this.reader.onMove();
  }

  /** Character offset to a position, by any of the ways a location can be given. */
  offsetFor(loc) {
    if (loc.find) {
      const off = findOffsets(this.article, loc.find, loc.start || 0);
      if (off) {
        this.findMarks = wrapOffsets(this.article, off.start, off.end, () => h('mark', { class: 'find-hit' }));
        setTimeout(() => this.clearFind(), 6000);
        return off.start;
      }
    }
    if (loc.start != null) return loc.start;
    if (loc.offset != null) return loc.offset;
    if (loc.b != null && this.source.blockOffset) return this.source.blockOffset(this.i, loc.b);
    if (loc.anchor) {
      const el = this.article.querySelector(`#${CSS.escape(`c${this.i}-${loc.anchor}`)}`);
      if (el) {
        const r = document.createRange();
        r.selectNodeContents(this.article);
        r.setEnd(el, 0);
        return r.toString().length;
      }
    }
    return null;
  }

  position(loc = {}, { silent = false } = {}) {
    const off = this.offsetFor(loc);
    if (this.pagesMode) {
      let page = 0;
      if (off != null) page = this.pageOfOffset(off);
      else if (loc.end) page = this.pages - 1;
      else if (loc.frac != null) page = Math.round(loc.frac * (this.pages - 1));
      this.setPage(page, false, silent);
    } else {
      const vp = this.viewport;
      if (off != null) {
        const r = rectAt(this.article, off);
        if (r) vp.scrollTop += r.top - vp.getBoundingClientRect().top - vp.clientHeight * 0.18;
      } else if (loc.end) vp.scrollTop = vp.scrollHeight;
      else vp.scrollTop = (loc.frac || 0) * Math.max(0, vp.scrollHeight - vp.clientHeight);
      if (!silent) this.reader.onMove();
    }
  }

  pageOfOffset(off) {
    const r = rectAt(this.article, Math.max(0, off));
    if (!r) return this.pages - 1;
    const fr = this.flow.getBoundingClientRect();
    return clamp(Math.floor((r.left - fr.left + 2) / this.stride), 0, this.pages - 1);
  }

  async go(loc) {
    const spine = loc.spine ?? this.i;
    if (spine === this.i && this.article) this.position(loc);
    else await this.show(spine, loc);
  }

  clearFind() {
    if (this.findMarks.length) unwrap(this.findMarks);
    this.findMarks = [];
  }

  // ---------------- pages

  setPage(n, animate = true, silent = false) {
    this.page = clamp(n, 0, this.pages - 1);
    const f = this.flow.style;
    f.transition = animate ? 'transform .36s var(--ease-out)' : 'none';
    f.transform = `translate3d(${-this.page * this.stride}px,0,0)`;
    this.updatePageChrome();
    if (!silent) this.reader.onMove();
  }

  async next() {
    if (this.pagesMode) {
      if (this.page < this.pages - 1) return this.setPage(this.page + 1);
    }
    if (this.i < this.count - 1) {
      await this.show(this.i + 1, {});
      this.slideIn(1);
    } else this.reader.onBookEnd();
  }

  async prev() {
    if (this.pagesMode && this.page > 0) return this.setPage(this.page - 1);
    if (this.i > 0) {
      await this.show(this.i - 1, { end: this.pagesMode });
      this.slideIn(-1);
    }
  }

  slideIn(dir) {
    if (!this.pagesMode || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.viewport.animate([{ transform: `translateX(${dir * 40}px)`, opacity: 0.2 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  hasPrev() {
    return this.i > 0 || (this.pagesMode && this.page > 0);
  }
  hasNext() {
    return true;
  }

  updatePageChrome() {
    if (!this.pagesMode) {
      this.folio.textContent = '';
      this.decor.replaceChildren();
      return;
    }
    const first = this.page * (this.spread ? 2 : 1) + 1;
    this.folio.replaceChildren(...(this.spread ? [h('span', null, String(first)), h('span', null, String(first + 1))] : [h('span', null, String(first))]));
    const p = this.reader.prefs;
    const items = [];
    if (p.ornaments) {
      for (const d of pageDecor(this.doc.id, this.i, this.page, p.skin)) items.push(h('div', { class: `decor decor-${d.kind} at-${d.place}`, html: d.html }));
      if (this.resume && this.resume.spine === this.i && this.resume.page === this.page) items.push(h('div', { class: 'decor decor-dogear' }));
    }
    if (this.reader.isBookmarkedPage()) items.push(h('div', { class: 'decor decor-ribbon' }));
    this.decor.replaceChildren(...items);
  }

  // ---------------- where am I

  visibleOffset() {
    if (!this.article) return 0;
    const vr = this.viewport.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(this.article).lineHeight) || 24;
    for (let dy = lh * 0.5; dy < vr.height * 0.6; dy += Math.max(10, lh * 0.5)) {
      for (const dx of [2, 24, 60]) {
        const pos = caretAt(vr.left + dx, vr.top + dy);
        if (pos && this.article.contains(pos.node)) return offsetOf(this.article, pos.node, pos.offset);
      }
    }
    return this.lastOffset ?? 0;
  }

  fracInChapter() {
    if (this.pagesMode) return this.pages > 1 ? this.page / (this.pages - 1) : 0;
    const vp = this.viewport;
    const max = vp.scrollHeight - vp.clientHeight;
    return max > 0 ? clamp(vp.scrollTop / max, 0, 1) : 0;
  }

  currentLoc() {
    const offset = this.visibleOffset();
    this.lastOffset = offset;
    const loc = { spine: this.i, offset, frac: +this.fracInChapter().toFixed(4) };
    if (this.source.kind === 'reflow') {
      loc.page = this.source.pageOf(this.i, offset);
      loc.rv = REFLOW_VERSION;
    }
    return loc;
  }

  percent() {
    const L = this.source.lengths;
    if (!L) return (this.i + this.fracInChapter()) / this.count;
    const total = L.reduce((a, b) => a + b, 0);
    let before = 0;
    for (let k = 0; k < this.i; k++) before += L[k];
    const atEnd = this.i === this.count - 1 && (this.pagesMode ? this.page >= this.pages - 1 : this.fracInChapter() > 0.995);
    if (atEnd) return 1;
    return clamp((before + Math.min(L[this.i], this.lastOffset ?? this.visibleOffset())) / total, 0, 1);
  }

  minutesLeftInChapter() {
    const L = this.source.lengths;
    const len = L ? L[this.i] : this.article?.textContent.length || 0;
    const left = Math.max(0, len - (this.lastOffset ?? 0));
    return Math.ceil(left / 1000);
  }

  pageInfo() {
    return this.pagesMode ? { page: this.page + 1, pages: this.pages } : null;
  }

  // ---------------- marks and selection

  paintHighlights() {
    if (!this.article) return;
    unwrap([...this.article.querySelectorAll('mark.hl')]);
    const list = (idx.hlByDoc.get(this.doc.id) || []).filter((x) => x.loc?.spine === this.i && x.loc.start != null).sort((a, b) => a.loc.start - b.loc.start);
    const noted = new Set(this.reader.notesForDoc().map((n) => n.highlightId).filter(Boolean));
    for (const x of list) wrapOffsets(this.article, x.loc.start, x.loc.end, () => h('mark', { class: `hl c-${x.color || 'amber'}${noted.has(x.id) ? ' has-note' : ''}`, 'data-hl': x.id }));
  }

  selectionLoc() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !this.article) return null;
    const range = sel.getRangeAt(0);
    if (!this.article.contains(range.commonAncestorContainer)) return null;
    const off = rangeOffsets(this.article, range);
    if (!off) return null;
    const text = range.toString().replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const loc = { spine: this.i, start: off.start, end: off.end };
    if (this.source.kind === 'reflow') {
      loc.page = this.source.pageOf(this.i, off.start);
      loc.rv = REFLOW_VERSION;
    }
    return { loc, text, rect: range.getBoundingClientRect() };
  }

  // ---------------- touch: swipe to turn pages

  wireTouch() {
    let start = null;
    let dragging = false;
    this.viewport.addEventListener('touchstart', (e) => {
      if (!this.pagesMode || e.touches.length !== 1) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, t: performance.now() };
      dragging = false;
    }, { passive: true });
    this.viewport.addEventListener('touchmove', (e) => {
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) dragging = true;
      if (!dragging) return;
      e.preventDefault();
      const edge = (dx > 0 && this.page === 0 && this.i === 0) || (dx < 0 && this.page === this.pages - 1 && this.i === this.count - 1);
      this.flow.style.transition = 'none';
      this.flow.style.transform = `translate3d(${-this.page * this.stride + (edge ? dx * 0.3 : dx)}px,0,0)`;
      start.dx = dx;
    }, { passive: false });
    const end = () => {
      if (!start) return;
      const s = start;
      start = null;
      if (!dragging) return;
      dragging = false;
      this.reader.suppressClick = true;
      setTimeout(() => (this.reader.suppressClick = false), 60);
      const dx = s.dx || 0;
      const v = Math.abs(dx) / Math.max(1, performance.now() - s.t);
      if (dx < -this.W * 0.16 || (dx < -24 && v > 0.45)) this.next();
      else if (dx > this.W * 0.16 || (dx > 24 && v > 0.45)) this.prev();
      else this.setPage(this.page);
    };
    this.viewport.addEventListener('touchend', end);
    this.viewport.addEventListener('touchcancel', end);
  }

  destroy() {
    this.source.dispose?.();
  }
}
