// Full-text index, built quietly in the background for every volume whose file is on this device.

import { db } from '../db.js';
import { idx, getFileBlob, getText } from '../store.js';
import { openEpub } from './epub.js';
import { extractPdfText } from './pdf.js';
import { chapterText } from '../reader/sanitize.js';

const queue = [];
let running = false;
const listeners = new Set();
export const indexStatus = { pending: 0, current: null, progress: 0 };

export function onIndexStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((fn) => fn(indexStatus));

const forced = new Set();

export function enqueueIndex(docId, { force = false } = {}) {
  if (!queue.includes(docId)) queue.push(docId);
  if (force) forced.add(docId);
  indexStatus.pending = queue.length;
  emit();
  run();
}

export async function enqueueMissing() {
  const have = new Set(await db.fulltext.toCollection().primaryKeys());
  const local = new Set(await db.files.toCollection().primaryKeys());
  for (const d of idx.doc.values()) {
    if (have.has(d.id)) continue;
    if (d.format === 'text' || ((d.format === 'epub' || d.format === 'pdf') && local.has(d.fileId))) enqueueIndex(d.id);
  }
}

async function run() {
  if (running) return;
  running = true;
  while (queue.length) {
    const docId = queue.shift();
    indexStatus.pending = queue.length;
    const doc = idx.doc.get(docId);
    if (!doc) continue;
    if (!forced.has(docId) && (await db.fulltext.get(docId))) continue;
    forced.delete(docId);
    indexStatus.current = doc.title;
    indexStatus.progress = 0;
    emit();
    try {
      const parts = await extractParts(doc, (p) => {
        indexStatus.progress = p;
        emit();
      });
      if (parts) await db.fulltext.put({ documentId: docId, parts, at: Date.now() });
    } catch (e) {
      console.warn('Indexing failed for', doc.title, e);
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  indexStatus.current = null;
  indexStatus.pending = 0;
  running = false;
  emit();
}

export async function extractParts(doc, onProgress) {
  if (doc.format === 'text') {
    const body = await getText(doc.id);
    return [{ label: doc.title, loc: { spine: 0 }, text: body }];
  }
  const blob = await getFileBlob(doc.fileId, { allowRemote: false });
  if (!blob) return null;
  if (doc.format === 'epub') {
    const book = await openEpub(blob);
    const parts = [];
    for (let i = 0; i < book.spine.length; i++) {
      const d = await book.chapterDocument(i);
      if (d) parts.push({ label: book.labelFor(i), loc: { spine: i }, text: chapterText(d) });
      onProgress?.((i + 1) / book.spine.length);
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
    return parts;
  }
  if (doc.format === 'pdf') return extractPdfText(blob, { onProgress });
  return null;
}

export async function getFulltext(docId) {
  return db.fulltext.get(docId);
}
