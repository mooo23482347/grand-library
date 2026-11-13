// Local database (IndexedDB via Dexie) and its migrations.
//
// Schema rules:
//  - Never change a published version. Add db.version(n + 1) with an .upgrade() instead.
//  - A document exists exactly once (documents + files). Shelves and collections only point at it
//    through `assignments`, so one volume can stand in many places without being copied.
//  - Deleting a shelf or a collection only removes assignments, never documents.

import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4.0.8/+esm';
import { SEED_ROOMS, seedRecords, germanRenames } from './seed.js';

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

// Version 2 (redesign):
//  reflow — reading text converted from PDFs (local cache only, rebuilt on each device on demand)
//  prefs  — preferences that follow the reader across devices (synced)
db.version(2).stores({
  reflow: 'documentId',
  prefs: 'id',
});

/** Tables mirrored to the cloud. Files and covers travel separately (Supabase Storage). */
export const SYNCED = ['departments', 'collections', 'documents', 'assignments', 'tags', 'documentTags', 'notes', 'highlights', 'bookmarks', 'progress', 'texts', 'prefs'];

const PK = { progress: 'documentId', texts: 'documentId' };
export const pkOf = (tbl) => PK[tbl] || 'id';
export const keyOf = (tbl, obj) => obj[pkOf(tbl)];

/** Data migrations: run once per device, in order, after the schema is open. */
const DATA_MIGRATIONS = [
  {
    version: 1,
    name: 'Furnish the initial shelves',
    async run() {
      // Deterministic ids and updatedAt = 0: a second device seeds identical records, and any
      // edit made elsewhere (rename, delete) always wins during sync.
      const { departments, collections } = seedRecords(SEED_ROOMS);
      if (await db.departments.count()) return;
      await db.departments.bulkPut(departments);
      await db.collections.bulkPut(collections);
    },
  },
  {
    version: 2,
    name: 'German names for the original shelves',
    async run() {
      // Only shelves and collections that still carry their original English name are renamed.
      // Names the user chose stay untouched. Changes go through the outbox so they sync.
      const { depts, cols } = germanRenames();
      const now = Date.now();
      await db.transaction('rw', db.departments, db.collections, db.outbox, async () => {
        for (const [id, r] of depts) {
          const d = await db.departments.get(id);
          if (d && d.name === r.from && r.from !== r.to) {
            await db.departments.put({ ...d, name: r.to, subtitle: '', leather: r.leather, updatedAt: now });
            await db.outbox.put({ tbl: 'departments', id, at: now });
          }
        }
        for (const [id, r] of cols) {
          const c = await db.collections.get(id);
          if (c && c.name === r.from && r.from !== r.to) {
            await db.collections.put({ ...c, name: r.to, updatedAt: now });
            await db.outbox.put({ tbl: 'collections', id, at: now });
          }
        }
      });
      // Older app versions skipped record types they did not know (e.g. prefs). Read everything
      // once more on the next sync; applying records is idempotent (newest edit wins).
      const keys = await db.settings.toCollection().primaryKeys();
      await db.settings.bulkDelete(keys.filter((k) => String(k).startsWith('sync.cursor.')));
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
