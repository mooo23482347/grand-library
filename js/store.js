// The library's domain layer. Every change goes through here so that
//  - the in-memory state and its indices stay current,
//  - changes are recorded in the outbox for cloud sync,
//  - views are told to redraw.

import { db, SYNCED, keyOf, pkOf } from './db.js';
import { uid, slug, fold, sha256Hex } from './util.js';
import { kindLabel } from './kinds.js';

const MEM = ['departments', 'collections', 'documents', 'assignments', 'tags', 'documentTags', 'notes', 'highlights', 'bookmarks', 'progress', 'prefs'];

export const state = Object.fromEntries(MEM.map((t) => [t, []]));
export const idx = { version: 0 };

const subs = new Set();
let changed = new Set();
let queued = false;
let localChangeHook = () => {};

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
export function onLocalChange(fn) {
  localChangeHook = fn;
}

export function notify(...tables) {
  tables.flat().forEach((t) => changed.add(t));
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    const t = changed;
    changed = new Set();
    rebuild();
    for (const fn of subs) {
      try {
        fn(t);
      } catch (e) {
        console.error(e);
      }
    }
  });
}

export async function loadAll(tables = MEM) {
  await Promise.all(
    tables.filter((t) => MEM.includes(t)).map(async (t) => {
      state[t] = await db[t].toArray();
    }),
  );
  rebuild();
}

/** Reload tables after an external change (sync pull, backup import). */
export async function reload(tables = MEM) {
  await loadAll(tables);
  notify(tables);
}

// ---------------------------------------------------------------- indices

const push = (map, k, v) => {
  const a = map.get(k);
  if (a) a.push(v);
  else map.set(k, [v]);
};
const addSet = (map, k, v) => {
  const s = map.get(k);
  if (s) s.add(v);
  else map.set(k, new Set([v]));
};
const byKey = (arr, k = 'id') => new Map(arr.map((x) => [x[k], x]));
const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name);

function rebuild() {
  idx.version++;
  idx.dept = byKey(state.departments);
  idx.col = byKey(state.collections);
  idx.doc = byKey(state.documents);
  idx.tag = byKey(state.tags);
  idx.asg = byKey(state.assignments);
  idx.note = byKey(state.notes);
  idx.pref = byKey(state.prefs);
  idx.hl = byKey(state.highlights);
  idx.progress = byKey(state.progress, 'documentId');
  idx.depts = [...state.departments].sort(byOrder);

  idx.children = new Map();
  idx.colCount = new Map();
  for (const c of state.collections) {
    push(idx.children, c.parentId || `d:${c.departmentId}`, c);
    idx.colCount.set(c.departmentId, (idx.colCount.get(c.departmentId) || 0) + 1);
  }
  for (const arr of idx.children.values()) arr.sort(byOrder);

  idx.asgByDoc = new Map();
  idx.docsInCol = new Map();
  idx.docsInDept = new Map();
  idx.docsDirect = new Map();
  for (const a of state.assignments) {
    if (!idx.doc.has(a.documentId)) continue;
    push(idx.asgByDoc, a.documentId, a);
    addSet(idx.docsInDept, a.departmentId, a.documentId);
    if (a.collectionId) addSet(idx.docsInCol, a.collectionId, a.documentId);
    else addSet(idx.docsDirect, a.departmentId, a.documentId);
  }

  idx.tagsByDoc = new Map();
  idx.docsByTag = new Map();
  for (const dt of state.documentTags) {
    const t = idx.tag.get(dt.tagId);
    if (!t || !idx.doc.has(dt.documentId)) continue;
    push(idx.tagsByDoc, dt.documentId, t);
    addSet(idx.docsByTag, dt.tagId, dt.documentId);
  }
  for (const arr of idx.tagsByDoc.values()) arr.sort((a, b) => a.name.localeCompare(b.name));

  idx.notesByDoc = new Map();
  for (const n of state.notes) if (n.documentId) push(idx.notesByDoc, n.documentId, n);
  idx.hlByDoc = new Map();
  for (const x of state.highlights) push(idx.hlByDoc, x.documentId, x);
  idx.bmByDoc = new Map();
  for (const x of state.bookmarks) push(idx.bmByDoc, x.documentId, x);

  idx.unshelved = state.documents.filter((d) => !idx.asgByDoc.get(d.id)?.length);
}

// ---------------------------------------------------------------- queries

export function childCollections(deptId, parentId = null) {
  return idx.children.get(parentId || `d:${deptId}`) || [];
}

export function subtreeIds(colId) {
  const out = [colId];
  for (let i = 0; i < out.length; i++) for (const k of idx.children.get(out[i]) || []) out.push(k.id);
  return out;
}

export function docsUnder(colId) {
  const s = new Set();
  for (const id of subtreeIds(colId)) idx.docsInCol.get(id)?.forEach((d) => s.add(d));
  return s;
}

export function colPath(colId) {
  const p = [];
  let c = idx.col.get(colId);
  const seen = new Set();
  while (c && !seen.has(c.id)) {
    seen.add(c.id);
    p.unshift(c);
    c = c.parentId ? idx.col.get(c.parentId) : null;
  }
  return p;
}

export function placementLabel(a) {
  const d = idx.dept.get(a.departmentId);
  const parts = [d?.name || 'Unbekanntes Regal'];
  if (a.collectionId) colPath(a.collectionId).forEach((c) => parts.push(c.name));
  return parts.join(' › ');
}

export function placementsOf(docId) {
  return (idx.asgByDoc.get(docId) || [])
    .map((a) => ({ ...a, label: placementLabel(a) }))
    .sort((x, y) => x.label.localeCompare(y.label));
}

export function primaryPlacement(docId) {
  const list = [...(idx.asgByDoc.get(docId) || [])].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return list[0] || null;
}

/** Where to show a document: its first room and collection. */
export function docHref(docId, extra = '') {
  const a = primaryPlacement(docId);
  const q = `?doc=${encodeURIComponent(docId)}${extra}`;
  if (!a) return `#/unshelved${q}`;
  return a.collectionId ? `#/room/${a.departmentId}/${a.collectionId}${q}` : `#/room/${a.departmentId}${q}`;
}

// Scopes describe "where on the shelves" an action happens:
//   d:<dept>   the whole room        dd:<dept>  only the room's general shelf
//   c:<col>    a collection and everything nested in it
//   cc:<col>   exactly that collection
export function parseScope(scope) {
  if (!scope) return null;
  const i = scope.indexOf(':');
  return { kind: scope.slice(0, i), id: scope.slice(i + 1) };
}

export function scopeMatches(a, scope) {
  const s = parseScope(scope);
  if (!s) return true;
  if (s.kind === 'd') return a.departmentId === s.id;
  if (s.kind === 'dd') return a.departmentId === s.id && !a.collectionId;
  if (s.kind === 'cc') return a.collectionId === s.id;
  if (s.kind === 'c') return !!a.collectionId && subtreeIds(s.id).includes(a.collectionId);
  return false;
}

export function scopeLabel(scope) {
  const s = parseScope(scope);
  if (!s) return 'allen Regalen';
  if (s.kind === 'd') return idx.dept.get(s.id)?.name || 'diesem Regal';
  if (s.kind === 'dd') return `${idx.dept.get(s.id)?.name || 'Regal'} › Allgemein`;
  const c = idx.col.get(s.id);
  return c ? placementLabel({ departmentId: c.departmentId, collectionId: c.id }) : 'dieser Sammlung';
}

export function scopeTarget(scope) {
  const s = parseScope(scope);
  if (!s) return null;
  if (s.kind === 'd' || s.kind === 'dd') return { deptId: s.id, colId: null };
  const c = idx.col.get(s.id);
  return c ? { deptId: c.departmentId, colId: c.id } : null;
}

export function deptStats(deptId) {
  return {
    volumes: idx.docsInDept.get(deptId)?.size || 0,
    collections: idx.colCount.get(deptId) || 0,
  };
}

// ---------------------------------------------------------------- generic writes

function memPut(t, obj) {
  if (!MEM.includes(t)) return;
  const k = pkOf(t);
  const arr = state[t];
  const i = arr.findIndex((x) => x[k] === obj[k]);
  if (i >= 0) arr[i] = obj;
  else arr.push(obj);
}
function memDel(t, ids) {
  if (!MEM.includes(t)) return;
  const k = pkOf(t);
  const set = new Set(ids);
  state[t] = state[t].filter((x) => !set.has(x[k]));
}

export async function putMany(t, objs, { silent = false } = {}) {
  if (!objs.length) return objs;
  const now = Date.now();
  objs.forEach((o) => (o.updatedAt = now));
  const tracked = SYNCED.includes(t);
  await db.transaction('rw', db.table(t), db.outbox, async () => {
    await db.table(t).bulkPut(objs);
    if (tracked) await db.outbox.bulkPut(objs.map((o) => ({ tbl: t, id: keyOf(t, o), at: now })));
  });
  if (objs.length > 20 && MEM.includes(t)) {
    const k = pkOf(t);
    const pos = new Map(state[t].map((x, i) => [x[k], i]));
    for (const o of objs) {
      const i = pos.get(o[k]);
      if (i === undefined) {
        pos.set(o[k], state[t].length);
        state[t].push(o);
      } else state[t][i] = o;
    }
  } else objs.forEach((o) => memPut(t, o));
  if (!silent) notify(t);
  if (tracked) localChangeHook(t);
  return objs;
}

export async function put(t, obj, opts) {
  await putMany(t, [obj], opts);
  return obj;
}

export async function remove(t, ids, { silent = false } = {}) {
  ids = [...new Set([].concat(ids).filter((x) => x != null))];
  if (!ids.length) return;
  const tracked = SYNCED.includes(t);
  const now = Date.now();
  await db.transaction('rw', db.table(t), db.outbox, async () => {
    await db.table(t).bulkDelete(ids);
    if (tracked) await db.outbox.bulkPut(ids.map((id) => ({ tbl: t, id, at: now, deleted: true })));
  });
  memDel(t, ids);
  if (!silent) notify(t);
  if (tracked) localChangeHook(t);
}

async function queueStorageDelete(path) {
  await db.outbox.put({ tbl: 'storage', id: path, at: Date.now(), deleted: true });
  localChangeHook('storage');
}

// ---------------------------------------------------------------- rooms

export async function createDepartment({ name, subtitle = '', emblem = 'book', leather = '#4b2e1a' }) {
  const order = Math.max(0, ...state.departments.map((d) => d.order || 0)) + 1;
  return put('departments', { id: `dept-${uid()}`, name: name.trim(), subtitle, emblem, leather, order, createdAt: Date.now() });
}

export async function updateDepartment(id, patch) {
  const d = idx.dept.get(id);
  if (!d) return;
  return put('departments', { ...d, ...patch });
}

export async function moveDepartment(id, dir) {
  const list = [...idx.depts];
  const i = list.findIndex((d) => d.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await putMany('departments', list.map((d, n) => ({ ...d, order: n + 1 })));
}

/** Removes the room and its collections. Volumes stay in the library; those that were only
 *  shelved here move to the returns table (unshelved). */
export async function deleteDepartment(id) {
  const cols = state.collections.filter((c) => c.departmentId === id).map((c) => c.id);
  const colSet = new Set(cols);
  await remove('assignments', state.assignments.filter((a) => a.departmentId === id).map((a) => a.id));
  const notes = state.notes.filter((n) => n.departmentId === id || colSet.has(n.collectionId));
  if (notes.length) await putMany('notes', notes.map((n) => ({ ...n, departmentId: null, collectionId: null })));
  await remove('collections', cols);
  await remove('departments', [id]);
}

// ---------------------------------------------------------------- collections

export async function createCollection({ departmentId, parentId = null, name, description = '' }) {
  const siblings = childCollections(departmentId, parentId);
  const order = Math.max(0, ...siblings.map((c) => c.order || 0)) + 1;
  return put('collections', { id: `col-${uid()}`, departmentId, parentId, name: name.trim(), description, order, createdAt: Date.now() });
}

export async function updateCollection(id, patch) {
  const c = idx.col.get(id);
  if (!c) return;
  return put('collections', { ...c, ...patch });
}

export async function moveCollectionOrder(id, dir) {
  const c = idx.col.get(id);
  if (!c) return;
  const list = [...childCollections(c.departmentId, c.parentId)];
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await putMany('collections', list.map((x, n) => ({ ...x, order: n + 1 })));
}

/** Re-hang a collection (with everything inside it) under another parent or room. */
export async function relocateCollection(id, { departmentId, parentId = null }) {
  const c = idx.col.get(id);
  if (!c) return;
  const sub = subtreeIds(id);
  if (parentId && sub.includes(parentId)) throw new Error('A collection cannot be placed inside itself.');
  const siblings = childCollections(departmentId, parentId);
  const order = Math.max(0, ...siblings.map((x) => x.order || 0)) + 1;
  const moved = sub.map((cid) => {
    const x = idx.col.get(cid);
    return cid === id ? { ...x, departmentId, parentId, order } : { ...x, departmentId };
  });
  await putMany('collections', moved);
  if (departmentId !== c.departmentId) {
    const subSet = new Set(sub);
    const asg = state.assignments.filter((a) => subSet.has(a.collectionId));
    await putMany('assignments', asg.map((a) => ({ ...a, departmentId })));
  }
}

/** Deletes a collection. Its volumes and sub-collections move up one level; nothing is lost. */
export async function deleteCollection(id) {
  const c = idx.col.get(id);
  if (!c) return;
  const kids = childCollections(c.departmentId, id);
  if (kids.length) await putMany('collections', kids.map((k) => ({ ...k, parentId: c.parentId })));
  const asg = state.assignments.filter((a) => a.collectionId === id);
  const docIds = asg.map((a) => a.documentId);
  await remove('assignments', asg.map((a) => a.id));
  await assignMany(docIds, [{ deptId: c.departmentId, colId: c.parentId }]);
  const notes = state.notes.filter((n) => n.collectionId === id);
  if (notes.length) await putMany('notes', notes.map((n) => ({ ...n, collectionId: c.parentId })));
  await remove('collections', [id]);
}

// ---------------------------------------------------------------- shelving (assignments)

export const asgId = (docId, deptId, colId) => (colId ? `${docId}|c:${colId}` : `${docId}|d:${deptId}`);

/** Shelve documents in additional places. Never duplicates the document itself. */
export async function assignMany(docIds, targets) {
  const add = new Map();
  const drop = [];
  const now = Date.now();
  for (const docId of docIds) {
    for (const t of targets) {
      if (!t?.deptId) continue;
      const id = asgId(docId, t.deptId, t.colId);
      if (!idx.asg.has(id) && !add.has(id)) add.set(id, { id, documentId: docId, departmentId: t.deptId, collectionId: t.colId || null, createdAt: now });
      if (t.colId) {
        // A volume in a collection no longer also needs a spot on that room's general shelf.
        const direct = asgId(docId, t.deptId, null);
        if (idx.asg.has(direct)) drop.push(direct);
      }
    }
  }
  await putMany('assignments', [...add.values()]);
  await remove('assignments', drop);
}

export async function removeFromScope(docIds, scope) {
  const ids = [];
  for (const d of docIds) for (const a of idx.asgByDoc.get(d) || []) if (scopeMatches(a, scope)) ids.push(a.id);
  await remove('assignments', ids);
}

/** Move = take off the shelves in `scope` (or all shelves if no scope), then shelve in `targets`. */
export async function moveDocs(docIds, scope, targets) {
  await removeFromScope(docIds, scope);
  await assignMany(docIds, targets);
}

export async function unassign(assignmentId) {
  await remove('assignments', [assignmentId]);
}

/** For undo: remember where volumes stood, and put them back exactly there. */
export function snapshotAssignments(docIds) {
  const set = new Set(docIds);
  return state.assignments.filter((a) => set.has(a.documentId)).map((a) => ({ ...a }));
}
export async function restoreAssignments(docIds, snapshot) {
  const set = new Set(docIds);
  const keep = new Set(snapshot.map((a) => a.id));
  await remove('assignments', state.assignments.filter((a) => set.has(a.documentId) && !keep.has(a.id)).map((a) => a.id));
  await putMany('assignments', snapshot.filter((a) => idx.dept.has(a.departmentId) && (!a.collectionId || idx.col.has(a.collectionId))).map((a) => ({ ...a })));
}

// ---------------------------------------------------------------- documents

export function newDocument(fields = {}) {
  return {
    id: `doc-${uid()}`,
    title: 'Ohne Titel',
    author: '',
    kind: 'book',
    format: 'none',
    year: '',
    description: '',
    publisher: '',
    language: '',
    isbn: '',
    doi: '',
    pages: null,
    fileId: null,
    fileName: '',
    fileMime: '',
    fileSize: 0,
    coverId: null,
    toc: [],
    remarks: '',
    spineColor: null,
    createdAt: Date.now(),
    ...fields,
  };
}

export async function createDocument(fields, targets = [], tagNames = []) {
  const doc = newDocument(fields);
  await put('documents', doc);
  if (targets.length) await assignMany([doc.id], targets);
  for (const n of tagNames) await addTag([doc.id], n);
  return doc;
}

export async function updateDocument(id, patch) {
  const d = idx.doc.get(id);
  if (!d) return;
  return put('documents', { ...d, ...patch });
}

/** Deletes volumes for good. Notes written about them stay in the Scriptorium (unless asked). */
export async function deleteDocuments(ids, { keepNotes = true } = {}) {
  const set = new Set(ids);
  const docs = ids.map((id) => idx.doc.get(id)).filter(Boolean);
  await remove('assignments', state.assignments.filter((a) => set.has(a.documentId)).map((a) => a.id));
  await remove('documentTags', state.documentTags.filter((x) => set.has(x.documentId)).map((x) => x.id));
  await remove('highlights', state.highlights.filter((x) => set.has(x.documentId)).map((x) => x.id));
  await remove('bookmarks', state.bookmarks.filter((x) => set.has(x.documentId)).map((x) => x.id));
  await remove('progress', ids.filter((id) => idx.progress.has(id)));
  const textIds = docs.filter((d) => d.format === 'text').map((d) => d.id);
  await remove('texts', textIds);
  const notes = state.notes.filter((n) => set.has(n.documentId));
  if (keepNotes) {
    await putMany('notes', notes.map((n) => ({ ...n, documentId: null, highlightId: null, sourceTitle: idx.doc.get(n.documentId)?.title || n.sourceTitle || '' })));
  } else {
    await remove('notes', notes.map((n) => n.id));
  }
  await remove('documents', ids);
  await db.fulltext.bulkDelete(ids);
  for (const d of docs) {
    if (d.fileId && !state.documents.some((x) => x.fileId === d.fileId)) {
      await db.files.delete(d.fileId);
      await queueStorageDelete(`files/${d.fileId}`);
    }
    if (d.coverId && !state.documents.some((x) => x.coverId === d.coverId)) {
      await db.covers.delete(d.coverId);
      dropCoverURL(d.coverId);
      await queueStorageDelete(`covers/${d.coverId}`);
    }
  }
}

// ---------------------------------------------------------------- tags

export const tagIdFor = (name) => `tag-${slug(name)}`;

export function findTagByName(name) {
  const f = fold(name.trim());
  return state.tags.find((t) => fold(t.name) === f) || null;
}

export async function addTag(docIds, name) {
  name = String(name || '').trim().replace(/^#/, '');
  if (!name) return null;
  let tag = findTagByName(name);
  if (!tag) tag = await put('tags', { id: tagIdFor(name), name, createdAt: Date.now() });
  const links = docIds
    .map((d) => ({ id: `${d}|${tag.id}`, documentId: d, tagId: tag.id }))
    .filter((x) => !state.documentTags.some((dt) => dt.id === x.id));
  await putMany('documentTags', links);
  return tag;
}

export async function removeTag(docIds, tagId) {
  const set = new Set(docIds);
  await remove('documentTags', state.documentTags.filter((x) => x.tagId === tagId && set.has(x.documentId)).map((x) => x.id));
}

export async function renameTag(tagId, name) {
  const t = idx.tag.get(tagId);
  if (!t || !name.trim()) return;
  await put('tags', { ...t, name: name.trim() });
}

export async function deleteTag(tagId) {
  await remove('documentTags', state.documentTags.filter((x) => x.tagId === tagId).map((x) => x.id));
  await remove('tags', [tagId]);
}

// ---------------------------------------------------------------- knowledge archive

export async function saveNote(fields) {
  const existing = fields.id ? idx.note.get(fields.id) : null;
  const note = existing
    ? { ...existing, ...fields }
    : {
        id: `note-${uid()}`,
        kind: 'note',
        title: '',
        body: '',
        quote: '',
        documentId: null,
        chapter: null,
        loc: null,
        highlightId: null,
        departmentId: null,
        collectionId: null,
        createdAt: Date.now(),
        ...fields,
      };
  return put('notes', note);
}

export async function deleteNote(id) {
  const hl = state.highlights.filter((x) => x.noteId === id);
  if (hl.length) await putMany('highlights', hl.map((x) => ({ ...x, noteId: null })));
  await remove('notes', [id]);
}

export function noteTitle(n) {
  if (n.title) return n.title;
  const src = (n.quote || n.body || '').replace(/[#>*[\]]/g, '').trim();
  return src ? src.slice(0, 70) + (src.length > 70 ? '…' : '') : 'Ohne Titel';
}

export async function saveHighlight(fields) {
  const existing = fields.id ? idx.hl.get(fields.id) : null;
  const hl = existing ? { ...existing, ...fields } : { id: `hl-${uid()}`, color: 'amber', noteId: null, createdAt: Date.now(), ...fields };
  return put('highlights', hl);
}

export async function deleteHighlight(id) {
  const notes = state.notes.filter((n) => n.highlightId === id);
  if (notes.length) await putMany('notes', notes.map((n) => ({ ...n, highlightId: null })));
  await remove('highlights', [id]);
}

export async function addBookmark(fields) {
  return put('bookmarks', { id: `bm-${uid()}`, createdAt: Date.now(), ...fields });
}
export async function deleteBookmark(id) {
  await remove('bookmarks', [id]);
}

export async function saveProgress(documentId, loc, percent) {
  return put('progress', { documentId, loc, percent: Math.max(0, Math.min(1, percent || 0)), openedAt: Date.now() }, { silent: true });
}

export async function getText(documentId) {
  return (await db.texts.get(documentId))?.body || '';
}
export async function saveText(documentId, body) {
  await put('texts', { documentId, body }, { silent: true });
}

// ---------------------------------------------------------------- files and covers

/** Stores a file once, keyed by its SHA-256. Returns the id and whether it already existed. */
export async function storeFile(blob, name) {
  const buf = await blob.arrayBuffer();
  const id = await sha256Hex(buf);
  const existing = await db.files.get(id);
  if (!existing) await db.files.put({ id, blob, name, mime: blob.type, size: blob.size, remote: false, addedAt: Date.now() });
  return { id, existed: !!existing };
}

export function documentsWithFile(fileId) {
  return state.documents.filter((d) => d.fileId === fileId);
}

let remoteFetcher = null;
export function setRemoteFetcher(fn) {
  remoteFetcher = fn;
}

export async function hasLocalFile(fileId) {
  return !!(fileId && (await db.files.get(fileId)));
}

export async function getFileBlob(fileId, { allowRemote = true } = {}) {
  if (!fileId) return null;
  const f = await db.files.get(fileId);
  if (f) return f.blob;
  if (allowRemote && remoteFetcher) {
    const blob = await remoteFetcher(`files/${fileId}`);
    if (blob) {
      await db.files.put({ id: fileId, blob, mime: blob.type, size: blob.size, remote: true, addedAt: Date.now() });
      return blob;
    }
  }
  return null;
}

export async function storeCover(blob) {
  const id = `cov-${uid()}`;
  await db.covers.put({ id, blob, remote: false });
  return id;
}

const coverURLs = new Map();
const coverMisses = new Set();
export async function coverURL(coverId) {
  if (!coverId) return null;
  if (coverURLs.has(coverId)) return coverURLs.get(coverId);
  let rec = await db.covers.get(coverId);
  if (!rec && remoteFetcher && !coverMisses.has(coverId)) {
    const blob = await remoteFetcher(`covers/${coverId}`).catch(() => null);
    if (blob) {
      rec = { id: coverId, blob, remote: true };
      await db.covers.put(rec);
    } else coverMisses.add(coverId);
  }
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  coverURLs.set(coverId, url);
  return url;
}
function dropCoverURL(id) {
  const u = coverURLs.get(id);
  if (u) URL.revokeObjectURL(u);
  coverURLs.delete(id);
}

// ---------------------------------------------------------------- settings (device-local)

export async function getSetting(key, fallback = null) {
  return (await db.settings.get(key))?.value ?? fallback;
}
export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}

// ---------------------------------------------------------------- sorting

export const SORTS = {
  author: { label: 'Autor', fn: (a, b) => cmp(sortAuthor(a.author), sortAuthor(b.author)) || cmp(a.title, b.title) },
  title: { label: 'Titel', fn: (a, b) => cmp(stripArticle(a.title), stripArticle(b.title)) },
  year: { label: 'Jahr', fn: (a, b) => (parseInt(a.year) || 9999) - (parseInt(b.year) || 9999) || cmp(a.title, b.title) },
  kind: { label: 'Art', fn: (a, b) => cmp(kindLabel(a.kind), kindLabel(b.kind)) || cmp(sortAuthor(a.author), sortAuthor(b.author)) },
  added: { label: 'Zuletzt hinzugefügt', fn: (a, b) => (b.createdAt || 0) - (a.createdAt || 0) },
};

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const cmp = (a, b) => collator.compare(a || '￿', b || '￿');
const stripArticle = (t) => String(t || '').replace(/^(the|a|an|der|die|das|ein|eine)\s+/i, '');
function sortAuthor(a) {
  const first = String(a || '').split(/[;&]| and /)[0].trim();
  if (!first) return '';
  if (first.includes(',')) return first;
  const parts = first.split(/\s+/);
  return parts.length > 1 ? `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}` : first;
}

export function sortDocs(docs, key = 'author') {
  return [...docs].sort((SORTS[key] || SORTS.author).fn);
}

// ---------------------------------------------------------------- shelf order (drag & drop)

export async function setDepartmentOrder(ids) {
  const list = ids.map((id, n) => ({ ...idx.dept.get(id), order: n + 1 })).filter((d) => d.id);
  await putMany('departments', list);
}

export async function setCollectionOrder(ids) {
  const list = ids.map((id, n) => ({ ...idx.col.get(id), order: n + 1 })).filter((c) => c.id);
  await putMany('collections', list);
}

// ---------------------------------------------------------------- synced preferences

/** Preferences that follow the user to every device (stored in the synced `prefs` table). */
export function getPref(id, fallback = null) {
  return idx.pref?.get(id)?.data ?? fallback;
}
export async function setPref(id, data) {
  await put('prefs', { id, data });
}

// ---------------------------------------------------------------- reading streak

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Remember that something was read today (once per day, synced). */
export async function logReadingDay() {
  const today = dayKey();
  const act = getPref('activity', { days: [], finished: [] });
  if (act.days.includes(today)) return;
  const days = [...act.days, today].sort().slice(-400);
  await setPref('activity', { ...act, days });
}

export async function logFinished(documentId) {
  const act = getPref('activity', { days: [], finished: [] });
  if ((act.finished || []).some((f) => f.id === documentId)) return false;
  await setPref('activity', { ...act, finished: [...(act.finished || []), { id: documentId, at: Date.now() }].slice(-500) });
  return true;
}

/** Days read in a row, ending today or yesterday. */
export function readingStreak() {
  const days = new Set(getPref('activity', { days: [] }).days || []);
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
