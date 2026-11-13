// The curator's office: cloud sync, storage, backups and tags.

import { h, fromHTML, formatBytes, timeAgo, download } from '../util.js';
import { db, SYNCED } from '../db.js';
import { state, reload, renameTag, deleteTag, idx } from '../store.js';
import { icon } from '../ui/icons.js';
import { toast, confirmDialog, promptDialog } from '../ui/modal.js';
import { syncState, getSyncConfig, configureSync, forgetSyncConfig, signIn, signOut, syncNow, getUsage, FREE_LIMITS, retryLocalOnlyFiles } from '../sync.js';
import { indexStatus, enqueueMissing } from '../import/indexer.js';
import { fulltextCoverage } from '../search.js';
import { loadJSZip } from '../deps.js';

export function renderSettings() {
  const page = h('div', { class: 'settings-page' }, h('header', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'The Curator’s Office'), h('p', { class: 'page-sub' }, 'Sync, storage, backups and tags')));
  const syncBox = h('section', { class: 'office-card' });
  const deviceBox = h('section', { class: 'office-card' });
  page.append(syncBox, deviceBox, backupCard(), tagsCard(), aboutCard());
  drawSync(syncBox);
  drawDevice(deviceBox);
  return page;
}

async function drawSync(box) {
  const cfg = await getSyncConfig();
  const head = h('header', { class: 'office-head' }, h('span', { class: 'office-icon', html: icon('cloud') }), h('div', null, h('h2', null, 'Sync between your devices'), h('p', { class: 'muted' }, 'Free Supabase project · 1 GB of files · 500 MB database · no card, no paid tier')));
  if (!cfg) {
    const url = h('input', { class: 'field-input', type: 'url', placeholder: 'https://abcdefgh.supabase.co', autocomplete: 'off' });
    const key = h('textarea', { class: 'field-input mono', rows: 3, placeholder: 'eyJhbGciOi… (anon / public key)', autocomplete: 'off' });
    box.replaceChildren(
      head,
      h('p', null, 'Without sync, the library lives in this browser only. To read the same library on your PC and your iPhone, connect your free Supabase project. The README in the project folder describes each step.'),
      h('div', { class: 'form-grid' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Project URL'), url), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Anon public key'), key)),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onClick: async () => { try { await configureSync(url.value, key.value); } catch (e) { toast(e.message, { kind: 'error' }); } } }, 'Connect')),
    );
    return;
  }
  const status = {
    off: 'Not signed in',
    idle: `In step · last synced ${timeAgo(syncState.lastSync)}`,
    syncing: 'Syncing…',
    offline: 'Offline · changes wait and sync later',
    error: 'Sync stopped',
  }[syncState.status];

  if (!syncState.signedIn) {
    const email = h('input', { class: 'field-input', type: 'email', autocomplete: 'username', placeholder: 'you@example.com' });
    const pw = h('input', { class: 'field-input', type: 'password', autocomplete: 'current-password' });
    const go = async () => {
      try {
        await signIn(email.value, pw.value);
        toast('Signed in. The library is syncing.');
        drawSync(box);
      } catch (e) {
        toast(e.message, { kind: 'error' });
      }
    };
    pw.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    box.replaceChildren(
      head,
      h('p', null, `Connected to ${new URL(cfg.url).host}. Sign in with the library account you created in Supabase.`),
      h('div', { class: 'form-grid two' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Email'), email), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Password'), pw)),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onClick: go }, 'Sign in'), cfg.source === 'device' ? h('button', { type: 'button', class: 'btn btn-ghost', onClick: forgetSyncConfig }, 'Use another project') : null),
    );
    return;
  }

  let usage = syncState.usage;
  try {
    usage = await getUsage();
  } catch {
    /* offline */
  }
  const meter = (label, used, limit) => {
    const pct = Math.min(100, Math.round((used / limit) * 100));
    return h('div', { class: 'meter' }, h('div', { class: 'meter-label' }, h('span', null, label), h('span', null, `${formatBytes(used)} of ${formatBytes(limit)}`)), h('div', { class: `meter-bar ${pct > 85 ? 'warn' : ''}` }, h('span', { style: { width: `${pct}%` } })));
  };
  const localOnly = await db.files.filter((f) => !!f.localOnly).count();
  box.replaceChildren(
    head,
    h('p', { class: `sync-line s-${syncState.status}` }, h('span', { class: 'sync-dot' }), status, syncState.pending ? ` · ${syncState.pending} changes waiting` : ''),
    syncState.error ? h('p', { class: 'notice error' }, syncState.error) : null,
    syncState.warning ? h('p', { class: 'notice warn' }, syncState.warning) : null,
    h('p', { class: 'muted' }, `Signed in as ${syncState.email}`),
    usage ? meter('Files in the cloud', usage.files, FREE_LIMITS.storageBytes) : null,
    usage ? meter('Database', usage.database, FREE_LIMITS.dbBytes) : null,
    localOnly ? h('p', { class: 'muted small' }, `${localOnly} ${localOnly === 1 ? 'file is' : 'files are'} kept on this device only (too large or no room in the free tier). `, h('button', { type: 'button', class: 'link-btn', onClick: retryLocalOnlyFiles }, 'Try again')) : null,
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onClick: async () => { await syncNow(); drawSync(box); } }, fromHTML(icon('sync')), 'Sync now'),
      h('button', { type: 'button', class: 'btn btn-ghost', onClick: async () => { await signOut(); drawSync(box); } }, 'Sign out on this device'),
    ),
  );
}

async function drawDevice(box) {
  let est = null;
  try {
    est = await navigator.storage?.estimate?.();
  } catch {
    /* unsupported */
  }
  let persisted = false;
  try {
    persisted = await navigator.storage?.persisted?.();
  } catch {
    /* unsupported */
  }
  const files = await db.files.count();
  const cov = await fulltextCoverage();
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  box.replaceChildren(
    h('header', { class: 'office-head' }, h('span', { class: 'office-icon', html: icon('shelf') }), h('div', null, h('h2', null, 'This device'), h('p', { class: 'muted' }, 'What is stored in this browser'))),
    h('dl', { class: 'particulars' },
      h('dt', null, 'Volumes'), h('dd', null, String(state.documents.length)),
      h('dt', null, 'Files here'), h('dd', null, String(files)),
      h('dt', null, 'Full text indexed'), h('dd', null, `${cov.indexed} of ${cov.readable} readable volumes${indexStatus.current ? ` · now: ${indexStatus.current}` : ''}`),
      est ? [h('dt', null, 'Storage used'), h('dd', null, `${formatBytes(est.usage)}${est.quota ? ` of about ${formatBytes(est.quota)}` : ''}`)] : null,
      h('dt', null, 'Protected from clean-up'), h('dd', null, persisted ? 'Yes' : 'No — the browser may remove data when space runs low'),
    ),
    isIOS && !standalone ? h('p', { class: 'notice' }, 'On the iPhone, add the library to the home screen (Share → “Add to Home Screen”). Safari otherwise deletes website data after seven days without a visit.') : null,
    h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-ghost', onClick: async () => { await enqueueMissing(); toast('Indexing the volumes on this device in the background.'); } }, 'Index missing volumes')),
  );
}

function backupCard() {
  const withFiles = h('input', { type: 'checkbox' });
  return h(
    'section',
    { class: 'office-card' },
    h('header', { class: 'office-head' }, h('span', { class: 'office-icon', html: icon('download') }), h('div', null, h('h2', null, 'Backup'), h('p', { class: 'muted' }, 'A complete copy of the catalogue, notes and marks'))),
    h('label', { class: 'check-row' }, withFiles, ' Include the files themselves (larger)'),
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onClick: () => exportBackup(withFiles.checked) }, fromHTML(icon('download')), 'Export backup'),
      h('label', { class: 'btn btn-ghost' }, fromHTML(icon('upload')), 'Restore from backup', h('input', { type: 'file', accept: '.zip,.json,application/zip,application/json', class: 'visually-hidden', onChange: (e) => e.target.files[0] && importBackup(e.target.files[0]) })),
    ),
    h('p', { class: 'muted small' }, 'Restoring merges the backup into this library: newer entries win, nothing is deleted.'),
  );
}

async function exportBackup(includeFiles) {
  const t = toast('Preparing the backup…', { timeout: 0 });
  try {
    const data = { app: 'grand-library', version: 1, exportedAt: new Date().toISOString(), tables: {} };
    for (const tname of SYNCED) data.tables[tname] = await db.table(tname).toArray();
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    zip.file('library.json', JSON.stringify(data));
    const covers = await db.covers.toArray();
    for (const c of covers) zip.file(`covers/${c.id}`, c.blob);
    if (includeFiles) {
      const files = await db.files.toArray();
      for (const f of files) zip.file(`files/${f.id}`, f.blob);
      zip.file('files.json', JSON.stringify(files.map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size }))));
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    t();
    download(blob, `grand-library-${new Date().toISOString().slice(0, 10)}.zip`);
  } catch (e) {
    t();
    toast(`The backup failed: ${e.message}`, { kind: 'error' });
  }
}

async function importBackup(file) {
  const ok = await confirmDialog({ title: 'Restore from this backup?', message: 'Its entries are merged into the library. Where both have the same entry, the newer one is kept. Nothing is deleted.', confirm: 'Restore' });
  if (!ok) return;
  const t = toast('Restoring…', { timeout: 0 });
  try {
    let data;
    let zip = null;
    if (/\.json$/i.test(file.name)) data = JSON.parse(await file.text());
    else {
      const JSZip = await loadJSZip();
      zip = await JSZip.loadAsync(file);
      data = JSON.parse(await zip.file('library.json').async('text'));
    }
    if (data.app !== 'grand-library') throw new Error('This is not a backup of the Grand Library.');
    let n = 0;
    for (const [tname, rows] of Object.entries(data.tables || {})) {
      if (!SYNCED.includes(tname)) continue;
      const tbl = db.table(tname);
      const pk = tbl.schema.primKey.keyPath;
      for (const r of rows) {
        const cur = await tbl.get(r[pk]);
        if (!cur || (cur.updatedAt || 0) <= (r.updatedAt || 0)) {
          await tbl.put(r);
          await db.outbox.put({ tbl: tname, id: r[pk], at: r.updatedAt || Date.now() });
          n++;
        }
      }
    }
    if (zip) {
      const meta = zip.file('files.json') ? JSON.parse(await zip.file('files.json').async('text')) : [];
      for (const m of meta) {
        if (await db.files.get(m.id)) continue;
        const b = await zip.file(`files/${m.id}`)?.async('blob');
        if (b) await db.files.put({ id: m.id, blob: new Blob([b], { type: m.mime || '' }), name: m.name, mime: m.mime, size: m.size, remote: false, addedAt: Date.now() });
      }
      for (const f of Object.values(zip.files)) {
        const m = f.name.match(/^covers\/(.+)$/);
        if (m && !(await db.covers.get(m[1]))) await db.covers.put({ id: m[1], blob: await f.async('blob'), remote: false });
      }
    }
    await reload();
    t();
    toast(`Restored ${n} entries.`);
  } catch (e) {
    t();
    toast(`The backup could not be restored: ${e.message}`, { kind: 'error' });
  }
}

function tagsCard() {
  const tags = [...state.tags].sort((a, b) => a.name.localeCompare(b.name));
  return h(
    'section',
    { class: 'office-card' },
    h('header', { class: 'office-head' }, h('span', { class: 'office-icon', html: icon('tag') }), h('div', null, h('h2', null, 'Tags'), h('p', { class: 'muted' }, `${tags.length} ${tags.length === 1 ? 'tag' : 'tags'} in use`))),
    tags.length
      ? h('ul', { class: 'tag-admin' }, tags.map((t) =>
          h('li', null,
            h('a', { href: `#/tag/${t.id}` }, t.name),
            h('span', { class: 'muted small' }, `${idx.docsByTag.get(t.id)?.size || 0}`),
            h('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Rename ${t.name}`, html: icon('pen'), onClick: async () => { const n = await promptDialog({ title: 'Rename tag', value: t.name, label: 'Name' }); if (n) renameTag(t.id, n); } }),
            h('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Delete ${t.name}`, html: icon('trash'), onClick: async () => { if (await confirmDialog({ title: `Delete the tag “${t.name}”?`, message: 'It is removed from all volumes. The volumes stay.', confirm: 'Delete tag', danger: true })) deleteTag(t.id); } }),
          )))
      : h('p', { class: 'muted' }, 'Tags you give volumes appear here.'),
  );
}

function aboutCard() {
  return h(
    'section',
    { class: 'office-card' },
    h('header', { class: 'office-head' }, h('span', { class: 'office-icon', html: icon('info') }), h('div', null, h('h2', null, 'About the library'))),
    h('p', null, 'Every volume is kept once. Rooms and collections only point at it, so a paper can stand in “Science & Knowledge” and in “University & Studies › Marketing” without being copied. Closing a room or removing a collection never deletes a volume.'),
    h('p', { class: 'muted small' }, 'Keyboard: “/” searches, Esc closes, ← → turn chapters or pages while reading.'),
  );
}
