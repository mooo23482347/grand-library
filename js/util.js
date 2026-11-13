// Small DOM and data helpers shared by the whole library.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Hyperscript: h('div', {class: 'x', onClick: fn}, 'text', childNode, [more]) */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv == null) continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  appendKids(el, kids);
  return el;
}

function appendKids(el, kids) {
  for (const c of kids) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) appendKids(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export function frag(...kids) {
  const f = document.createDocumentFragment();
  appendKids(f, kids);
  return f;
}

/** Trusted static markup only (icons, ornaments). */
export function fromHTML(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Case- and accent-insensitive form for matching. */
export function fold(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss');
}

export function slug(s) {
  return fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function debounce(fn, ms) {
  let t = null;
  let lastArgs = null;
  const d = (...args) => {
    lastArgs = args;
    clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...lastArgs);
    }, ms);
  };
  d.flush = () => {
    if (t) {
      clearTimeout(t);
      t = null;
      fn(...lastArgs);
    }
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
}

export function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function timeAgo(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h ago`;
  return formatDate(ts);
}

export async function sha256Hex(buffer) {
  const d = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ACCENTS = {
  a: 'aàáâãäåāă', e: 'eèéêëēė', i: 'iìíîïī', o: 'oòóôõöøō', u: 'uùúûüū',
  c: 'cç', n: 'nñ', y: 'yýÿ', s: 'sś', z: 'zž',
};

/** Regex that finds the phrase regardless of case and accents (for full text). */
export function looseRegex(q, flags = 'giu') {
  const words = String(q || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const parts = words.map((w) =>
    [...w]
      .map((ch) => {
        const l = fold(ch);
        if (l.length === 1 && ACCENTS[l]) return `[${ACCENTS[l]}]`;
        return ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      })
      .join(''),
  );
  return new RegExp(parts.join('\\s+'), flags);
}

export function snippet(text, index, length, radius = 90) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  const pre = (start > 0 ? '… ' : '') + text.slice(start, index);
  const hit = text.slice(index, index + length);
  const post = text.slice(index + length, end) + (end < text.length ? ' …' : '');
  return { pre: pre.replace(/\s+/g, ' '), hit, post: post.replace(/\s+/g, ' ') };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isTouch() {
  return window.matchMedia('(hover: none)').matches;
}

/** Tiny, safe Markdown subset for notes and manuscripts. */
export function renderMarkdown(src, { resolveLink, headingIds = false } = {}) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null;
  let quote = [];
  let hCount = 0;

  const inline = (s) =>
    esc(s)
      .replace(/\[\[([^\]]+)\]\]/g, (m, t) => (resolveLink ? resolveLink(t) : `<span class="wikilink">${t}</span>`))
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.map((q) => `<p>${inline(q)}</p>`).join('')}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) {
      flushAll();
    } else if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flushAll();
      const lvl = m[1].length + 1;
      const id = headingIds ? ` id="h-${hCount++}"` : '';
      out.push(`<h${lvl}${id}>${inline(m[2])}</h${lvl}>`);
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushAll();
      out.push('<hr>');
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara();
      flushList();
      quote.push(m[1]);
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      flushPara();
      flushQuote();
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(m[1]);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      flushQuote();
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(m[1]);
    } else {
      flushList();
      flushQuote();
      para.push(line.trim());
    }
  }
  flushAll();
  return out.join('\n');
}

export function markdownHeadings(src) {
  const res = [];
  let i = 0;
  for (const line of String(src || '').split(/\r?\n/)) {
    const m = line.match(/^(#{1,4})\s+(.*)$/);
    if (m) res.push({ label: m[2].replace(/[*_[\]]/g, ''), depth: m[1].length - 1, anchor: `h-${i++}` });
  }
  return res;
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1500);
}
