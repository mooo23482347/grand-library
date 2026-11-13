// Local database (IndexedDB via Dexie) and its migrations.
//
// Schema rules:
//  - Never change a published version. Add db.version(n + 1) with an .upgrade() instead.
//  - A document exists exactly once (documents + files). Rooms and collections only point at it
//    through `assignments`, so one volume can stand in many places without being copied.
//  - Deleting a room or a collection only removes assignments, never documents.

import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4.0.8/+esm';
import { SEED_ROOMS, seedRecords } from './seed.js';

export const db = new Dexie('grand-library');

db.version(1).stores({
  departments: 'id, order',
  collections: 'id, departmentId, parentId',
  documents: 'id, kind, fileId, createdAt',
  assignments: 'id, documentId, departmentId, collectionId',
  tags: 'id',
  documentTags: 'id, documentId, tagId',
  notes: 'id, documentId, kind, updatedAt',
  highlights: 'id, documentId',
  bookmarks: 'id, documentId',
  progress: 'documentId',
  texts: 'documentId',
  files: 'id',
  covers: 'id',
  fulltext: 'documentId',
  outbox: '[tbl+id]',
  meta: 'key',
  settings: 'key',
});

// Example of a future migration:
// db.version(2).stores({ documents: 'id, kind, fileId, createdAt, series' })
//   .upgrade(tx => tx.table('documents').toCollection().modify(d => { d.series ??= ''; }));

/** Tables mirrored to the cloud. Files and covers travel separately (Supabase Storage). */
export const SYNCED = ['departments', 'collections', 'documents', 'assignments', 'tags', 'documentTags', 'notes', 'highlights', 'bookmarks', 'progress', 'texts'];

const PK = { progress: 'documentId', texts: 'documentId' };
export const pkOf = (tbl) => PK[tbl] || 'id';
export const keyOf = (tbl, obj) => obj[pkOf(tbl)];

/** Data migrations: run once per device, in order, after the schema is open. */
const DATA_MIGRATIONS = [
  {
    version: 1,
    name: 'Furnish the initial rooms',
    async run() {
      // Deterministic ids and updatedAt = 0: a second device seeds identical records, and any
      // edit made elsewhere (rename, delete) always wins during sync.
      const { departments, collections } = seedRecords(SEED_ROOMS);
      const existing = await db.departments.count();
      if (existing) return;
      await db.departments.bulkPut(departments);
      await db.collections.bulkPut(collections);
    },
  },
];

export async function openDb() {
  await db.open();
  const cur = (await db.meta.get('dataVersion'))?.value || 0;
  for (const m of DATA_MIGRATIONS) {
    if (m.version > cur) {
      await m.run();
      await db.meta.put({ key: 'dataVersion', value: m.version });
    }
  }
  // Ask the browser not to evict the library under storage pressure.
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported */
  }
}

export async function getMeta(key, fallback = null) {
  return (await db.meta.get(key))?.value ?? fallback;
}
export async function setMeta(key, value) {
  await db.meta.put({ key, value });
}
