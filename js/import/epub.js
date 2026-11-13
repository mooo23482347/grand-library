// EPUB 2/3 reader: metadata, cover, spine and table of contents, straight from the zip.

import { loadJSZip } from '../deps.js';

const DC = 'http://purl.org/dc/elements/1.1/';

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    // Some books ship sloppy XML; HTML parsing is forgiving.
    return new DOMParser().parseFromString(text, 'text/html');
  }
  return doc;
}

export function resolvePath(base, rel) {
  if (!rel) return base;
  rel = rel.split('#')[0];
  try {
    rel = decodeURIComponent(rel);
  } catch {
    /* keep as is */
  }
  if (rel.startsWith('/')) return rel.slice(1);
  const parts = (base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '').split('/').filter(Boolean);
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

const textOf = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

export async function openEpub(blob) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(blob);
  const file = (p) => zip.file(p) || zip.file(decodeURI(p)) || Object.values(zip.files).find((f) => f.name.toLowerCase() === p.toLowerCase()) || null;

  const container = file('META-INF/container.xml');
  if (!container) throw new Error('This file is not a valid EPUB (container.xml is missing).');
  const cdoc = parseXml(await container.async('text'));
  const opfPath = cdoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath || !file(opfPath)) throw new Error('This EPUB has no package document.');
  const opf = parseXml(await file(opfPath).async('text'));

  const manifest = new Map();
  for (const it of opf.getElementsByTagName('item')) {
    manifest.set(it.getAttribute('id'), {
      id: it.getAttribute('id'),
      href: resolvePath(opfPath, it.getAttribute('href')),
      type: it.getAttribute('media-type') || '',
      props: it.getAttribute('properties') || '',
    });
  }
  const spineEl = opf.getElementsByTagName('spine')[0];
  const spine = [...opf.getElementsByTagName('itemref')]
    .map((ir) => manifest.get(ir.getAttribute('idref')))
    .filter((it) => it && /html|xml/.test(it.type));

  // ----- metadata
  const dc = (name) => [...opf.getElementsByTagNameNS(DC, name)];
  const dcFallback = (name) => (dc(name).length ? dc(name) : [...opf.getElementsByTagName(`dc:${name}`)]);
  const title = textOf(dcFallback('title')[0]);
  const authors = dcFallback('creator').map(textOf).filter(Boolean);
  const description = textOf(new DOMParser().parseFromString(textOf(dcFallback('description')[0]) || dcFallback('description')[0]?.textContent || '', 'text/html').body);
  const date = textOf(dcFallback('date')[0]);
  const ids = dcFallback('identifier').map(textOf);
  const isbn = (ids.find((x) => /97[89][\d-]{10,}|\b\d{9}[\dX]\b/i.test(x.replace(/-/g, ''))) || '').replace(/^urn:isbn:/i, '');
  const meta = {
    title,
    author: authors.join('; '),
    description,
    year: (date.match(/\d{4}/) || [''])[0],
    publisher: textOf(dcFallback('publisher')[0]),
    language: textOf(dcFallback('language')[0]),
    isbn,
    subjects: dcFallback('subject').map(textOf).filter(Boolean),
  };

  // ----- cover
  let coverHref = null;
  const coverItem = [...manifest.values()].find((m) => /cover-image/.test(m.props));
  if (coverItem) coverHref = coverItem.href;
  if (!coverHref) {
    const metaCover = [...opf.getElementsByTagName('meta')].find((m) => m.getAttribute('name') === 'cover');
    const it = metaCover && manifest.get(metaCover.getAttribute('content'));
    if (it && /image/.test(it.type)) coverHref = it.href;
  }
  if (!coverHref) {
    const it = [...manifest.values()].find((m) => /image/.test(m.type) && /cover/i.test(m.id + m.href));
    if (it) coverHref = it.href;
  }

  const spineIndexOf = (href) => {
    const path = resolvePath('', href.split('#')[0]);
    let i = spine.findIndex((s) => s.href === path);
    if (i < 0) i = spine.findIndex((s) => s.href.endsWith(path) || path.endsWith(s.href));
    return i;
  };

  // ----- table of contents (EPUB 3 nav, else EPUB 2 NCX)
  let toc = [];
  const navItem = [...manifest.values()].find((m) => /\bnav\b/.test(m.props));
  if (navItem && file(navItem.href)) {
    const nav = parseXml(await file(navItem.href).async('text'));
    const navs = [...nav.getElementsByTagName('nav')];
    const tocNav = navs.find((n) => /toc/.test(n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '')) || navs[0];
    const walk = (ol, depth) => {
      if (!ol) return;
      for (const li of ol.children) {
        if (li.localName !== 'li') continue;
        const a = [...li.children].find((c) => c.localName === 'a' || c.localName === 'span');
        const href = a?.getAttribute('href');
        if (a && href) {
          const full = resolvePath(navItem.href, href);
          const anchor = href.includes('#') ? href.split('#')[1] : null;
          const spineI = spineIndexOf(full);
          if (spineI >= 0) toc.push({ label: textOf(a) || `Section ${toc.length + 1}`, depth, loc: { spine: spineI, anchor } });
        }
        walk([...li.children].find((c) => c.localName === 'ol'), depth + 1);
      }
    };
    walk(tocNav && [...tocNav.children].find((c) => c.localName === 'ol'), 0);
  }
  if (!toc.length) {
    const ncxId = spineEl?.getAttribute('toc');
    const ncxItem = (ncxId && manifest.get(ncxId)) || [...manifest.values()].find((m) => /ncx/.test(m.type));
    if (ncxItem && file(ncxItem.href)) {
      const ncx = parseXml(await file(ncxItem.href).async('text'));
      const walk = (parent, depth) => {
        for (const np of parent.children) {
          if (np.localName !== 'navPoint') continue;
          const label = textOf([...np.children].find((c) => c.localName === 'navLabel'));
          const src = [...np.children].find((c) => c.localName === 'content')?.getAttribute('src');
          if (src) {
            const spineI = spineIndexOf(resolvePath(ncxItem.href, src));
            if (spineI >= 0) toc.push({ label: label || `Section ${toc.length + 1}`, depth, loc: { spine: spineI, anchor: src.includes('#') ? src.split('#')[1] : null } });
          }
          walk(np, depth + 1);
        }
      };
      const navMap = ncx.getElementsByTagName('navMap')[0];
      if (navMap) walk(navMap, 0);
    }
  }
  if (!toc.length) toc = spine.map((s, i) => ({ label: `Part ${i + 1}`, depth: 0, loc: { spine: i, anchor: null } }));

  return {
    zip,
    meta,
    spine,
    toc,
    coverHref,
    spineIndexOf,
    async text(path) {
      const f = file(path);
      return f ? f.async('text') : null;
    },
    async blob(path) {
      const f = file(path);
      if (!f) return null;
      const type = [...manifest.values()].find((m) => m.href === path)?.type || '';
      const b = await f.async('blob');
      return type ? new Blob([b], { type }) : b;
    },
    async chapterDocument(i) {
      const s = spine[i];
      if (!s) return null;
      const raw = await this.text(s.href);
      if (raw == null) return null;
      let d = new DOMParser().parseFromString(raw, 'application/xhtml+xml');
      if (d.querySelector('parsererror') || !d.body) d = new DOMParser().parseFromString(raw, 'text/html');
      return d;
    },
    async coverBlob() {
      return coverHref ? this.blob(coverHref) : null;
    },
    /** Label of the TOC entry a spine item belongs to. */
    labelFor(i) {
      let best = null;
      for (const t of toc) if (t.loc.spine <= i && (!best || t.loc.spine > best.loc.spine)) best = t;
      return best?.label || `Part ${i + 1}`;
    },
  };
}
