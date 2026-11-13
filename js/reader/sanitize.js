// Rebuilds book chapters from an allow-list of elements and attributes. Scripts, styles, forms,
// frames and event handlers never reach the page.

const ALLOWED = new Set([
  'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'i', 'b', 'strong', 'u', 's', 'sub', 'sup', 'small', 'big', 'br', 'hr',
  'blockquote', 'q', 'cite', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'colgroup', 'col', 'figure', 'figcaption', 'img', 'a', 'pre', 'code', 'section', 'article', 'aside', 'header', 'footer', 'nav',
  'abbr', 'ruby', 'rt', 'rp', 'del', 'ins', 'mark', 'var', 'kbd', 'samp', 'tt', 'main', 'hgroup', 'address', 'time', 'bdi', 'bdo', 'wbr',
]);
const DROP = new Set(['script', 'style', 'link', 'meta', 'title', 'head', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'audio', 'video', 'canvas', 'noscript', 'template', 'math']);
const RENAME = { center: 'div', font: 'span', body: 'div', html: 'div' };

/**
 * @param {Document} srcDoc   parsed chapter
 * @param {object}   o
 *   prefix         id prefix so anchors stay unique across chapters
 *   resolveImage   (src) => url | null   (sync; images are fetched separately)
 *   resolveHref    (href) => {spine, anchor} | null
 * @returns {HTMLElement}
 */
export function sanitizeChapter(srcDoc, { prefix = 'c0-', resolveImage, resolveHref } = {}) {
  const out = document.createElement('div');
  const root = srcDoc.body || srcDoc.documentElement;
  const images = [];

  const visit = (node, parent) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        parent.append(document.createTextNode(child.data));
        continue;
      }
      if (child.nodeType !== 1) continue;
      let tag = child.localName?.toLowerCase();
      if (!tag || DROP.has(tag)) continue;

      if (tag === 'svg') {
        // Covers are often an <svg><image href=…>; keep only the picture.
        const img = child.querySelector('image');
        const href = img && (img.getAttribute('href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href'));
        if (href) {
          const el = document.createElement('img');
          el.alt = '';
          el.dataset.src = href;
          images.push(el);
          parent.append(el);
        }
        continue;
      }
      tag = RENAME[tag] || tag;
      if (!ALLOWED.has(tag)) {
        visit(child, parent); // unwrap unknown elements, keep their text
        continue;
      }
      const el = document.createElement(tag);
      const id = child.getAttribute('id') || child.getAttribute('name');
      if (id) el.id = prefix + id;
      const lang = child.getAttribute('lang') || child.getAttribute('xml:lang');
      if (lang) el.lang = lang;
      const dir = child.getAttribute('dir');
      if (dir === 'rtl' || dir === 'ltr') el.dir = dir;
      const etype = child.getAttribute('epub:type') || child.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type');
      if (etype) el.dataset.epubType = etype;
      for (const a of ['colspan', 'rowspan', 'title', 'alt']) {
        const v = child.getAttribute(a);
        if (v != null) el.setAttribute(a, v);
      }
      const align = (child.getAttribute('style') || '').match(/text-align\s*:\s*(center|right)/i) || (child.getAttribute('class') || '').match(/\b(center|right)\b/i);
      if (align) el.dataset.align = align[1].toLowerCase();
      if (tag === 'img') {
        const src = child.getAttribute('src');
        if (!src) continue;
        el.dataset.src = src;
        el.alt = child.getAttribute('alt') || '';
        el.loading = 'lazy';
        images.push(el);
      }
      if (tag === 'a') {
        const href = child.getAttribute('href');
        if (href) {
          if (/^https?:|^mailto:/i.test(href)) {
            el.href = href;
            el.target = '_blank';
            el.rel = 'noopener noreferrer';
          } else if (resolveHref) {
            const target = resolveHref(href);
            if (target) {
              el.href = '#';
              el.dataset.spine = target.spine;
              if (target.anchor) el.dataset.anchor = target.anchor;
            }
          }
        }
      }
      parent.append(el);
      visit(child, el);
    }
  };
  visit(root, out);

  if (resolveImage) {
    for (const img of images) {
      const url = resolveImage(img.dataset.src);
      if (url) img.src = url;
      else img.remove();
    }
  }
  return { el: out, images };
}

export function chapterText(srcDoc) {
  const { el } = sanitizeChapter(srcDoc);
  // Block elements become line breaks so words do not run together.
  el.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,br,tr,blockquote,section').forEach((n) => n.append('\n'));
  return el.textContent.replace(/\n{3,}/g, '\n\n').trim();
}
