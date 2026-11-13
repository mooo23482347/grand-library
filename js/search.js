// One search across the whole library: volumes, rooms, collections, tags, notes, marginalia,
// and the full text of every volume stored on this device.

import { db } from './db.js';
import { idx, state, placementLabel, placementsOf, noteTitle, docsUnder, subtreeIds } from './store.js';
import { kindLabel, noteKindLabel } from './kinds.js';
import { fold, looseRegex, snippet } from './util.js';

let cache = { version: -1, docs: null };

function docFields(d) {
  return [
    [fold(d.title), 10],
    [fold(d.author), 7],
    [fold((idx.tagsByDoc.get(d.id) || []).map((t) => t.name).join(' ')), 6],
    [fold(placementsOf(d.id).map((p) => p.label).join(' ')), 3],
    [fold(`${kindLabel(d.kind)} ${d.year} ${d.publisher} ${d.isbn} ${d.doi} ${d.fileName}`), 2],
    [fold(d.remarks), 3],
    [fold(d.description), 2],
    [fold((d.toc || []).map((t) => t.label).join(' ')), 1],
  ];
}

function scoreFields(fields, tokens) {
  let score = 0;
  const why = new Set();
  for (const tok of tokens) {
    let best = 0;
    let bestIdx = -1;
    fields.forEach(([text, w], i) => {
      if (!text) return;
      const at = text.indexOf(tok);
      if (at < 0) return;
      let s = w;
      if (at === 0 || /\W/.test(text[at - 1])) s *= 1.6;
      if (s > best) {
        best = s;
        bestIdx = i;
      }
    });
    if (!best) return { score: 0 };
    score += best;
    why.add(bestIdx);
  }
  return { score, why };
}

const WHY = ['Titel', 'Autor', 'Tag', 'Regal', 'Details', 'Anmerkungen', 'Beschreibung', 'Kapitel'];

/** scope: {deptId} or {colId} to search a single room or collection. */
export function searchLibrary(q, scope = {}) {
  const tokens = fold(q).split(/\s+/).filter(Boolean);
  const res = { docs: [], places: [], tags: [], notes: [], marks: [] };
  if (!tokens.length) return res;

  if (cache.version !== idx.version) cache = { version: idx.version, docs: new Map() };
  let allowed = null;
  if (scope.colId) allowed = docsUnder(scope.colId);
  else if (scope.deptId) allowed = idx.docsInDept.get(scope.deptId) || new Set();

  for (const d of state.documents) {
    if (allowed && !allowed.has(d.id)) continue;
    let f = cache.docs.get(d.id);
    if (!f) cache.docs.set(d.id, (f = docFields(d)));
    const { score, why } = scoreFields(f, tokens);
    if (score) res.docs.push({ doc: d, score, why: [...why].map((i) => WHY[i]) });
  }
  res.docs.sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title));

  if (!scope.colId) {
    for (const d of state.departments) {
      if (scope.deptId && d.id !== scope.deptId) continue;
      const { score } = scoreFields([[fold(d.name), 10], [fold(d.subtitle), 3]], tokens);
      if (score) res.places.push({ type: 'room', id: d.id, label: d.name, sub: d.subtitle, href: `#/room/${d.id}`, score });
    }
  }
  const colAllowed = scope.colId ? new Set(subtreeIds(scope.colId)) : null;
  for (const c of state.collections) {
    if (scope.deptId && c.departmentId !== scope.deptId) continue;
    if (colAllowed && !colAllowed.has(c.id)) continue;
    const { score } = scoreFields([[fold(c.name), 10], [fold(c.description), 3], [fold(idx.dept.get(c.departmentId)?.name), 1]], tokens);
    if (score) res.places.push({ type: 'collection', id: c.id, label: placementLabel({ departmentId: c.departmentId, collectionId: c.id }), sub: c.description, href: `#/room/${c.departmentId}/${c.id}`, score });
  }
  res.places.sort((a, b) => b.score - a.score);

  for (const t of state.tags) {
    if (tokens.every((tok) => fold(t.name).includes(tok))) res.tags.push({ tag: t, count: idx.docsByTag.get(t.id)?.size || 0 });
  }

  for (const n of state.notes) {
    if (allowed && !(n.documentId && allowed.has(n.documentId)) && !(scope.deptId && n.departmentId === scope.deptId)) continue;
    const src = n.documentId ? idx.doc.get(n.documentId) : null;
    const { score } = scoreFields(
      [[fold(noteTitle(n)), 8], [fold(n.body), 3], [fold(n.quote), 4], [fold(`${noteKindLabel(n.kind)} ${n.chapter || ''}`), 2], [fold(src ? `${src.title} ${src.author}` : n.sourceTitle), 2]],
      tokens,
    );
    if (score) res.notes.push({ note: n, score });
  }
  res.notes.sort((a, b) => b.score - a.score);

  for (const x of state.highlights) {
    if (allowed && !allowed.has(x.documentId)) continue;
    const { score } = scoreFields([[fold(x.text), 4]], tokens);
    if (score) res.marks.push({ mark: x, score });
  }
  return res;
}

/**
 * Searches the stored full text, one volume at a time so the page stays responsive.
 * onHit({doc, part, pre, hit, post, loc}) is called as passages are found.
 */
export async function searchFullText(q, { docIds = null, onHit, onProgress, signal, perDoc = 3, limit = 80 } = {}) {
  const re = looseRegex(q);
  if (!re || q.trim().length < 2) return 0;
  let keys = await db.fulltext.toCollection().primaryKeys();
  if (docIds) keys = keys.filter((k) => docIds.has(k));
  let found = 0;
  for (let i = 0; i < keys.length; i++) {
    if (signal?.aborted) return found;
    const rec = await db.fulltext.get(keys[i]);
    const doc = rec && idx.doc.get(rec.documentId);
    onProgress?.((i + 1) / keys.length, keys.length);
    if (!doc) continue;
    let inDoc = 0;
    for (const part of rec.parts || []) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(part.text))) {
        const s = snippet(part.text, m.index, m[0].length);
        onHit?.({ doc, part, ...s, loc: { ...part.loc, find: m[0] } });
        found++;
        inDoc++;
        if (inDoc >= perDoc || found >= limit) break;
        if (m[0].length === 0) re.lastIndex++;
      }
      if (inDoc >= perDoc || found >= limit) break;
    }
    if (found >= limit) return found;
  }
  return found;
}

/** Full-text search inside one volume (for the reader). */
export async function searchInDocument(docId, q, max = 300) {
  const re = looseRegex(q);
  const rec = await db.fulltext.get(docId);
  if (!re || !rec) return null;
  const out = [];
  for (const part of rec.parts || []) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(part.text))) {
      out.push({ part, ...snippet(part.text, m.index, m[0].length, 60), loc: { ...part.loc, find: m[0] } });
      if (out.length >= max) return out;
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return out;
}

export async function fulltextCoverage() {
  const keys = new Set(await db.fulltext.toCollection().primaryKeys());
  const readable = state.documents.filter((d) => ['epub', 'pdf', 'text'].includes(d.format));
  return { indexed: readable.filter((d) => keys.has(d.id)).length, readable: readable.length };
}
