// Reflow pipeline for PDFs: extract positioned text (pdf.js parses in its own worker), analyse it in
// our reflow worker, cache the result locally. Not synced: 879-page books stay out of the free
// database; each device rebuilds on demand, deterministically, so positions match everywhere.
//
// Positions in reflowed books: { spine: chapter, offset | start/end | b (block), page, rv }.
// The PDF page is kept in every position, so the original PDF view and older versions still work.

import { db } from '../db.js';
import { idx, getFileBlob, putMany, saveProgress } from '../store.js';
import { loadPdfjs } from '../deps.js';
import { openPdf } from '../import/pdf.js';
import { looseRegex } from '../util.js';

export const REFLOW_VERSION = 3;
const building = new Map();

export async function cachedReflow(docId) {
  const r = await db.reflow.get(docId);
  return r && r.v === REFLOW_VERSION ? r : null;
}

/** Converted text for a PDF; builds it (with progress) if this device has none yet. */
export function getReflow(doc, { onProgress } = {}) {
  if (building.has(doc.id)) {
    const b = building.get(doc.id);
    if (onProgress) b.listeners.add(onProgress);
    return b.promise;
  }
  const listeners = new Set(onProgress ? [onProgress] : []);
  const promise = (async () => {
    const hit = await cachedReflow(doc.id);
    if (hit) return hit;
    const blob = await getFileBlob(doc.fileId);
    if (!blob) throw new Error('Die Datei dieses Buchs ist nicht auf diesem Gerät und konnte nicht geladen werden.');
    const rec = await buildReflow(blob, (p) => listeners.forEach((fn) => fn(p)));
    rec.documentId = doc.id;
    rec.at = Date.now();
    await db.reflow.put(rec);
    return rec;
  })();
  building.set(doc.id, { promise, listeners });
  promise.finally(() => building.delete(doc.id));
  return promise;
}

async function buildReflow(blob, onProgress) {
  const pdfjs = await loadPdfjs();
  const pdf = await openPdf(blob);
  const worker = new Worker(new URL('./reflow-worker.js', import.meta.url));
  try {
    const n = pdf.numPages;
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = [];
      for (const it of tc.items) {
        if (!('str' in it) || !it.str) continue;
        const t = pdfjs.Util.transform(vp.transform, it.transform);
        if (Math.abs(t[1]) > Math.abs(t[0]) * 0.1) continue; // rotated text (margins, stamps)
        const size = Math.hypot(t[2], t[3]) || Math.abs(t[0]);
        items.push([it.str, t[4], t[5], it.width * vp.scale, size]);
      }
      worker.postMessage({ type: 'page', n: i, w: vp.width, h: vp.height, items });
      page.cleanup();
      onProgress((i / n) * 0.94);
      if (i % 6 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    const outline = await resolveOutline(pdf);
    onProgress(0.96);
    return await new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        if (e.data.type === 'done') resolve(e.data.result);
        else if (e.data.type === 'error') reject(new Error(e.data.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'Aufbereitung fehlgeschlagen'));
      worker.postMessage({ type: 'finish', outline, pages: n });
    });
  } finally {
    worker.terminate();
    pdf.destroy();
  }
}

async function resolveOutline(pdf) {
  const out = [];
  try {
    const walk = async (items, depth) => {
      for (const it of items || []) {
        if (out.length > 1200) return;
        let page = null;
        try {
          let dest = it.dest;
          if (typeof dest === 'string') dest = await pdf.getDestination(dest);
          if (Array.isArray(dest) && dest[0]) page = (await pdf.getPageIndex(dest[0])) + 1;
        } catch {
          /* unresolved */
        }
        if (page) out.push({ title: String(it.title || '').trim(), depth, page });
        if (it.items?.length) await walk(it.items, depth + 1);
      }
    };
    await walk(await pdf.getOutline(), 0);
  } catch {
    /* no outline */
  }
  return out;
}

// ---------------------------------------------------------------- text and offsets
// The renderer emits exactly these strings in this order (title?, blocks, notes), with no extra
// whitespace nodes, so character offsets here equal offsets in the rendered chapter.

export function chapterParts(ch) {
  const parts = [];
  if (ch.showTitle) parts.push({ kind: 'title', x: ch.title });
  ch.blocks.forEach((b, i) => parts.push({ kind: 'block', b: i, x: b.x, pg: b.pg }));
  ch.notes.forEach((n) => parts.push({ kind: 'note', x: n.x, pg: n.pg }));
  return parts;
}

export function chapterText(ch) {
  return chapterParts(ch).map((p) => p.x).join('');
}

export function blockOffset(ch, b) {
  let off = ch.showTitle ? ch.title.length : 0;
  for (let i = 0; i < b && i < ch.blocks.length; i++) off += ch.blocks[i].x.length;
  return off;
}

/** Chapter, block and offset where a PDF page begins. */
export function pageToLoc(rec, page, frac = 0) {
  const chs = rec.chapters;
  for (let c = 0; c < chs.length; c++) {
    const bl = chs[c].blocks;
    if (!bl.length || (bl[bl.length - 1].pg < page && c < chs.length - 1)) continue;
    let b = bl.findIndex((x) => x.pg >= page);
    if (b < 0) b = bl.length - 1;
    // frac within the page: step forward through that page's blocks
    const onPage = bl.map((x, i) => [x, i]).filter(([x]) => x.pg === page);
    if (frac > 0 && onPage.length > 1) b = onPage[Math.min(onPage.length - 1, Math.floor(frac * onPage.length))][1];
    return { spine: c, b, offset: blockOffset(chs[c], b), page, rv: REFLOW_VERSION };
  }
  return { spine: 0, b: 0, offset: 0, page, rv: REFLOW_VERSION };
}

/** Where in the chapter is the character offset? Returns the PDF page for that spot. */
export function offsetToPage(rec, spine, offset) {
  const ch = rec.chapters[spine];
  if (!ch) return 1;
  let off = ch.showTitle ? ch.title.length : 0;
  for (const b of ch.blocks) {
    off += b.x.length;
    if (off > offset) return b.pg;
  }
  return ch.pgEnd || ch.pg || 1;
}

/** Find a passage (e.g. an old PDF highlight) near a page. */
export function findText(rec, text, page) {
  const re = looseRegex(String(text || '').replace(/\s+/g, ' ').slice(0, 160));
  if (!re) return null;
  const order = rec.chapters.map((ch, c) => [c, Math.abs((ch.pg || 0) - page)]).sort((a, b) => a[1] - b[1]).map(([c]) => c);
  for (const c of order.slice(0, 4)) {
    const t = chapterText(rec.chapters[c]);
    re.lastIndex = 0;
    const m = re.exec(t);
    if (m) return { spine: c, start: m.index, end: m.index + m[0].length, page, rv: REFLOW_VERSION };
  }
  return null;
}

/** Give old page-based positions of a PDF their place in the reflowed text. Keeps the page. */
export async function migrateLocs(doc, rec) {
  if (!rec || rec.status !== 'ok') return 0;
  const needs = (loc) => loc && loc.page && (loc.spine == null || loc.rv !== REFLOW_VERSION);
  let n = 0;
  const hls = (idx.hlByDoc.get(doc.id) || []).filter((x) => needs(x.loc));
  const hlOut = [];
  for (const x of hls) {
    const found = findText(rec, x.text, x.loc.page);
    if (found) hlOut.push({ ...x, loc: { ...x.loc, ...found } });
  }
  if (hlOut.length) await putMany('highlights', hlOut);
  n += hlOut.length;

  const bms = (idx.bmByDoc.get(doc.id) || []).filter((x) => needs(x.loc));
  if (bms.length) await putMany('bookmarks', bms.map((b) => ({ ...b, loc: { ...b.loc, ...pageToLoc(rec, b.loc.page, b.loc.frac) } })));
  n += bms.length;

  const notes = (idx.notesByDoc.get(doc.id) || []).filter((x) => needs(x.loc));
  if (notes.length) await putMany('notes', notes.map((x) => ({ ...x, loc: { ...x.loc, ...pageToLoc(rec, x.loc.page, x.loc.frac) } })));
  n += notes.length;

  const prog = idx.progress.get(doc.id);
  if (prog && needs(prog.loc)) {
    await saveProgress(doc.id, { ...prog.loc, ...pageToLoc(rec, prog.loc.page, prog.loc.frac) }, prog.percent);
    n++;
  }
  // The table of contents now points into the text as well.
  return n;
}

/** Text parts for the full-text index, addressed by chapter. */
export function reflowParts(rec) {
  return rec.chapters.map((ch, i) => ({ label: ch.title, loc: { spine: i, page: ch.pg }, text: chapterText(ch) }));
}
