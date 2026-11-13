// Cloud sync with a free Supabase project (no card, no paid tier).
//
//  - Every local change is written to the outbox; sync pushes it to one table, gl_records.
//  - Pull fetches records changed since the last cursor (server time). Newest edit wins.
//  - Files and covers go to a private Storage bucket, once each (keyed by SHA-256).
//  - The free tier's limits are respected: 1 GB of files, 50 MB per file, 500 MB database.
//    When a limit is reached the library says so and keeps the file on this device only.

import { db, SYNCED } from './db.js';
import { loadSupabase } from './deps.js';
import { state, reload, setRemoteFetcher, onLocalChange, getSetting, setSetting } from './store.js';

const TABLE = 'gl_records';
const BUCKET = 'library';
export const FREE_LIMITS = { storageBytes: 1024 ** 3, dbBytes: 500 * 1024 ** 2, fileBytes: 50 * 1024 ** 2 };

export const syncState = {
  configured: false,
  signedIn: false,
  email: null,
  status: 'off', // off | idle | syncing | offline | error
  lastSync: null,
  error: null,
  warning: null,
  usage: null,
  pending: 0,
};
const listeners = new Set();
export function onSyncState(fn) {
  listeners.add(fn);
  fn(syncState);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) {
    try {
      fn(syncState);
    } catch (e) {
      console.error(e);
    }
  }
}

let client = null;
let userId = null;
let timer = null;
let running = null;
let again = false;

export async function getSyncConfig() {
  const s = await getSetting('sync.config');
  if (s?.url && s?.anonKey) return { ...s, source: 'device' };
  const g = window.GRAND_LIBRARY_CONFIG || {};
  if (g.supabaseUrl && g.supabaseAnonKey) return { url: g.supabaseUrl, anonKey: g.supabaseAnonKey, source: 'config.js' };
  return null;
}

export async function initSync() {
  const cfg = await getSyncConfig();
  syncState.configured = !!cfg;
  syncState.lastSync = await getSetting('sync.lastSync');
  syncState.pending = await db.outbox.count();
  if (!cfg) {
    syncState.status = 'off';
    emit();
    return;
  }
  try {
    const { createClient } = await loadSupabase();
    client = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'grand-library-auth' } });
    const { data } = await client.auth.getSession();
    setSession(data.session);
    client.auth.onAuthStateChange((_e, session) => setSession(session));
  } catch (e) {
    syncState.status = navigator.onLine ? 'error' : 'offline';
    syncState.error = navigator.onLine ? `The sync service could not be loaded: ${e.message}` : null;
    emit();
  }
  setRemoteFetcher(fetchRemote);
  onLocalChange(() => scheduleSync(4000));
  window.addEventListener('online', () => scheduleSync(800));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(1200);
    else if (syncState.pending) syncNow();
  });
  setInterval(() => scheduleSync(0), 5 * 60 * 1000);
  if (syncState.signedIn) scheduleSync(600);
}

function setSession(session) {
  userId = session?.user?.id || null;
  syncState.signedIn = !!userId;
  syncState.email = session?.user?.email || null;
  if (syncState.status === 'off' || !userId) syncState.status = userId ? 'idle' : 'off';
  emit();
}

export async function configureSync(url, anonKey) {
  url = String(url || '').trim().replace(/\/+$/, '');
  anonKey = String(anonKey || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url)) throw new Error('The project URL looks like https://abcdefgh.supabase.co');
  if (anonKey.split('.').length !== 3 && !anonKey.startsWith('sb_publishable_')) throw new Error('Use the public key: “sb_publishable_…” or the legacy anon key that starts with “eyJ”.');
  await setSetting('sync.config', { url, anonKey });
  location.reload();
}

export async function forgetSyncConfig() {
  try {
    await client?.auth.signOut();
  } catch {
    /* ignore */
  }
  await setSetting('sync.config', null);
  location.reload();
}

export async function signIn(email, password) {
  if (!client) throw new Error('Sync is not set up on this device yet.');
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(/invalid/i.test(error.message) ? 'Email or password is not correct.' : error.message);
  setSession(data.session);
  await syncNow();
}

export async function signOut() {
  if (!client) return;
  await client.auth.signOut();
  setSession(null);
}

export function scheduleSync(delay = 3000) {
  clearTimeout(timer);
  if (!client || !userId) {
    db.outbox.count().then((n) => {
      syncState.pending = n;
      emit();
    });
    return;
  }
  timer = setTimeout(() => syncNow(), delay);
}

export async function syncNow() {
  if (!client || !userId) return;
  if (running) {
    again = true;
    return running;
  }
  if (!navigator.onLine) {
    syncState.status = 'offline';
    emit();
    return;
  }
  syncState.status = 'syncing';
  syncState.error = null;
  emit();
  running = (async () => {
    try {
      await push();
      await pull();
      await uploadBlobs();
      syncState.lastSync = Date.now();
      await setSetting('sync.lastSync', syncState.lastSync);
      syncState.status = 'idle';
    } catch (e) {
      console.warn('Sync failed', e);
      const msg = e?.message || String(e);
      if (!navigator.onLine) syncState.status = 'offline';
      else {
        syncState.status = 'error';
        syncState.error = /fetch|network|load failed/i.test(msg)
          ? 'The sync server cannot be reached. A free Supabase project is paused after a week without use: open supabase.com, choose the project and click “Restore”.'
          : /relation .* does not exist|gl_records/i.test(msg)
            ? 'The cloud tables are missing. Run supabase/schema.sql in the SQL editor of your Supabase project.'
            : msg;
      }
    } finally {
      syncState.pending = await db.outbox.count();
      emit();
      running = null;
      if (again) {
        again = false;
        scheduleSync(500);
      }
    }
  })();
  return running;
}

// ---------------------------------------------------------------- push

async function push() {
  const items = await db.outbox.toArray();
  if (!items.length) return;
  const rows = [];
  const removals = [];
  for (const it of items) {
    if (it.tbl === 'storage') {
      removals.push(it);
      continue;
    }
    if (!SYNCED.includes(it.tbl)) continue;
    const rid = `${it.tbl}:${it.id}`;
    const rec = it.deleted ? null : await db.table(it.tbl).get(it.id);
    if (!rec) rows.push({ user_id: userId, id: rid, tbl: it.tbl, data: null, deleted: true, client_updated_at: it.at });
    else rows.push({ user_id: userId, id: rid, tbl: it.tbl, data: rec, deleted: false, client_updated_at: rec.updatedAt || it.at });
  }
  for (let i = 0; i < rows.length; i += 250) {
    const { error } = await client.from(TABLE).upsert(rows.slice(i, i + 250), { onConflict: 'user_id,id' });
    if (error) throw new Error(error.message);
  }
  if (removals.length) {
    const paths = removals.map((r) => `${userId}/${r.id}`);
    const { error } = await client.storage.from(BUCKET).remove(paths);
    if (error) console.warn('Could not remove old files from the cloud', error);
  }
  // Drop only what has not changed again while we were pushing.
  await db.transaction('rw', db.outbox, async () => {
    for (const it of items) {
      const cur = await db.outbox.get([it.tbl, it.id]);
      if (cur && cur.at === it.at) await db.outbox.delete([it.tbl, it.id]);
    }
  });
}

// ---------------------------------------------------------------- pull

const cursorKey = () => `sync.cursor.${userId}`;

async function pull() {
  let cursor = (await getSetting(cursorKey())) || '1970-01-01T00:00:00.000Z';
  // Look back a minute: rows committed late by a slow device are not missed.
  let from = new Date(new Date(cursor).getTime() - 60000).toISOString();
  const changed = new Set();
  for (;;) {
    const { data, error } = await client.from(TABLE).select('id,tbl,data,deleted,client_updated_at,updated_at').gt('updated_at', from).order('updated_at', { ascending: true }).limit(1000);
    if (error) throw new Error(error.message);
    if (!data.length) break;
    await applyRemote(data, changed);
    from = data[data.length - 1].updated_at;
    if (from > cursor) cursor = from;
    await setSetting(cursorKey(), cursor);
    if (data.length < 1000) break;
  }
  if (changed.size) {
    await reload([...changed]);
    if (changed.has('documents')) await collectGarbage();
  }
}

async function applyRemote(rows, changed) {
  const tables = [...new Set(rows.map((r) => r.tbl).filter((t) => SYNCED.includes(t)))];
  if (!tables.length) return;
  await db.transaction('rw', [...tables.map((t) => db.table(t)), db.outbox], async () => {
    for (const r of rows) {
      if (!SYNCED.includes(r.tbl)) continue; // written by a newer version of the library
      const key = r.id.slice(r.tbl.length + 1);
      const t = db.table(r.tbl);
      const local = await t.get(key);
      const pending = await db.outbox.get([r.tbl, key]);
      const remoteAt = r.deleted ? Number(r.client_updated_at) : Number(r.data?.updatedAt ?? r.client_updated_at);
      const localAt = pending ? pending.at : Number(local?.updatedAt || 0);
      if (local && localAt > remoteAt) continue; // our newer edit will be pushed
      if (r.deleted) {
        if (local) await t.delete(key);
      } else {
        await t.put(r.data);
      }
      if (pending && pending.at <= remoteAt) await db.outbox.delete([r.tbl, key]);
      changed.add(r.tbl);
    }
  });
}

/** Files and covers no volume refers to any more. */
async function collectGarbage() {
  const used = new Set(state.documents.map((d) => d.fileId).filter(Boolean));
  const covers = new Set(state.documents.map((d) => d.coverId).filter(Boolean));
  const fileKeys = await db.files.toCollection().primaryKeys();
  await db.files.bulkDelete(fileKeys.filter((k) => !used.has(k)));
  const coverKeys = await db.covers.toCollection().primaryKeys();
  await db.covers.bulkDelete(coverKeys.filter((k) => !covers.has(k)));
  const ftKeys = await db.fulltext.toCollection().primaryKeys();
  const docs = new Set(state.documents.map((d) => d.id));
  await db.fulltext.bulkDelete(ftKeys.filter((k) => !docs.has(k)));
}

// ---------------------------------------------------------------- files

export async function getUsage(force = false) {
  if (!client || !userId) return null;
  if (!force && syncState.usage && Date.now() - syncState.usage.at < 60000) return syncState.usage;
  const { data, error } = await client.rpc('gl_usage');
  if (error) throw new Error(error.message);
  syncState.usage = { files: Number(data?.files || 0), database: Number(data?.database || 0), at: Date.now() };
  emit();
  return syncState.usage;
}

async function uploadBlobs() {
  const usedFiles = new Set(state.documents.map((d) => d.fileId).filter(Boolean));
  const usedCovers = new Set(state.documents.map((d) => d.coverId).filter(Boolean));
  const files = (await db.files.filter((f) => !f.remote && !f.localOnly).toArray()).filter((f) => usedFiles.has(f.id));
  const covers = (await db.covers.filter((c) => !c.remote).toArray()).filter((c) => usedCovers.has(c.id));
  if (!files.length && !covers.length) return;
  let usage;
  try {
    usage = { ...(await getUsage(true)) };
  } catch (e) {
    // Fall back to what this device knows it has uploaded; never let the meter stop syncing.
    console.warn('Usage unavailable', e);
    const up = await db.files.filter((f) => !!f.remote).toArray();
    usage = { files: up.reduce((n, f) => n + (f.size || 0), 0), database: 0 };
  }
  syncState.warning = null;
  for (const c of covers) {
    const { error } = await client.storage.from(BUCKET).upload(`${userId}/covers/${c.id}`, c.blob, { upsert: true, contentType: c.blob.type || 'image/jpeg' });
    if (error && !/exists/i.test(error.message)) throw new Error(error.message);
    await db.covers.update(c.id, { remote: true });
    usage.files += c.blob.size || 0;
  }
  for (const f of files) {
    if (f.size > FREE_LIMITS.fileBytes) {
      await db.files.update(f.id, { localOnly: 'too-large' });
      syncState.warning = `“${f.name}” is larger than 50 MB, the limit of a free Supabase project. It stays on this device only.`;
      continue;
    }
    if (usage.files + f.size > FREE_LIMITS.storageBytes * 0.98) {
      syncState.warning = 'The cloud shelf is full (1 GB, the free limit). New files stay on this device only. No paid plan is switched on.';
      break;
    }
    const { error } = await client.storage.from(BUCKET).upload(`${userId}/files/${f.id}`, f.blob, { upsert: true, contentType: f.mime || 'application/octet-stream' });
    if (error && !/exists|duplicate/i.test(error.message)) {
      if (/size|large|quota|exceed/i.test(error.message)) {
        await db.files.update(f.id, { localOnly: 'rejected' });
        syncState.warning = `The cloud refused “${f.name}” (${error.message}). It stays on this device only.`;
        continue;
      }
      throw new Error(error.message);
    }
    await db.files.update(f.id, { remote: true });
    usage.files += f.size;
  }
  emit();
}

async function fetchRemote(path) {
  if (!client || !userId || !navigator.onLine) return null;
  const { data, error } = await client.storage.from(BUCKET).download(`${userId}/${path}`);
  if (error) return null;
  return data;
}

/** Before an import: will these bytes still fit into the free cloud storage? */
export async function checkCloudCapacity(bytes) {
  if (!client || !userId) return null;
  const u = await getUsage(true).catch(() => null);
  if (!u) return null;
  const after = u.files + bytes;
  if (after > FREE_LIMITS.storageBytes * 0.98) return { warning: 'These files would exceed the 1 GB of free cloud storage. They are kept on this device; volumes that do not fit are not synced.' };
  if (after > FREE_LIMITS.storageBytes * 0.85) return { warning: `The cloud shelf is ${Math.round((after / FREE_LIMITS.storageBytes) * 100)}% full after this import (free limit 1 GB).` };
  return null;
}

export async function retryLocalOnlyFiles() {
  await db.files.toCollection().modify((f) => {
    if (f.localOnly === 'rejected') delete f.localOnly;
  });
  scheduleSync(0);
}
