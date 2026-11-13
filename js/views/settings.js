// Einstellungen in iOS inset-grouped style.

import { h, fromHTML, formatBytes, timeAgo, download } from '../util.js';
import { db, SYNCED } from '../db.js';
import { state, reload, renameTag, deleteTag, idx, readingStreak, getPref } from '../store.js';
import { icon } from '../ui/icons.js';
import { pageHeader, group, cell, switchCell, segmented } from '../ui/controls.js';
import { toast, confirmDialog, promptDialog, showMenu, openSheet } from '../ui/modal.js';
import { syncState, getSyncConfig, configureSync, forgetSyncConfig, signIn, signOut, syncNow, getUsage, FREE_LIMITS, retryLocalOnlyFiles } from '../sync.js';
import { enqueueMissing } from '../import/indexer.js';
import { fulltextCoverage } from '../search.js';
import { loadJSZip } from '../deps.js';
import { getTheme, setTheme } from '../theme.js';
import { SKINS, FONTS, loadReaderPrefs, readerPrefs, setReaderPrefs, skinOf } from '../reader/prefs.js';
import { SYNC_TEXT } from './syncbadge.js';
import { startEditingShelves } from './home.js';
import { openAcquire } from '../import/acquire.js';

let rerender = () => {};
export function setSettingsRerender(fn) {
  rerender = fn;
}

export function renderSettings() {
  const page = h('div', { class: 'page narrow settings' }, pageHeader({ title: 'Einstellungen' }));
  const body = h('div');
  page.append(body);
  const syncBox = h('div');
  const deviceBox = h('div');
  loadReaderPrefs().then(() => {
    body.replaceChildren(...sections(syncBox, deviceBox).filter(Boolean));
    drawSync(syncBox);
    drawDevice(deviceBox);
  });
  return page;
}

function sections(syncBox, deviceBox) {
  const p = readerPrefs();
  const streak = readingStreak();
  const finished = (getPref('activity', {})?.finished || []).length;
  return [
    group({
      head: 'Darstellung',
      icons: true,
      rows: [
        h('div', { class: 'cell' }, h('span', { class: 'cell-icon', style: { '--tint': '#7a6a5a' }, html: icon('sun') }), h('span', { class: 'cell-main' }, h('span', { class: 'cell-title' }, 'Design')), segmented([{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Hell' }, { value: 'dark', label: 'Dunkel' }], getTheme(), (v) => setTheme(v), { label: 'Erscheinungsbild' })),
        cell({ title: 'Papier', detail: skinOf(p.skin).name, icon: 'file', tint: '#b08a5a', chevron: true, onClick: () => choose('Papier', SKINS.map((s) => ({ value: s.id, label: s.name })), p.skin, (v) => setReaderPrefs({ skin: v }).then(rerender)) }),
      ],
    }),
    group({
      head: 'Lesen',
      icons: true,
      foot: 'Papier, Schrift und Abstände gelten auf allen Geräten. Schriftgröße, Ränder und Lesemodus stellt jedes Gerät selbst ein – Handy und PC brauchen meist unterschiedliche Größen.',
      rows: [
        h('div', { class: 'cell' }, h('span', { class: 'cell-icon', style: { '--tint': '#5e7a63' }, html: icon('bookOpen') }), h('span', { class: 'cell-main' }, h('span', { class: 'cell-title' }, 'Lesemodus')), segmented([{ value: 'pages', label: 'Seiten' }, { value: 'scroll', label: 'Scrollen' }], p.mode, (v) => setReaderPrefs({ mode: v }), { label: 'Lesemodus' })),
        cell({ title: 'Schrift', detail: FONTS.find((f) => f.id === p.font)?.name, icon: 'type', tint: '#6b5d8a', chevron: true, onClick: () => choose('Schrift', FONTS.map((f) => ({ value: f.id, label: f.name, style: { fontFamily: f.css } })), p.font, (v) => setReaderPrefs({ font: v }).then(rerender)) }),
        switchCell({ title: 'Verzierungen', sub: 'Ornamente, Lesebändchen und kleine Überraschungen', checked: p.ornaments, icon: 'sparkles', tint: '#c08a3e', onChange: (v) => setReaderPrefs({ ornaments: v }) }),
        // a device setting: only offered where a double page can actually appear
        matchMedia('(min-width: 900px)').matches ? switchCell({ title: 'Doppelseite', sub: 'Zwei Seiten nebeneinander, wenn genug Platz ist', checked: p.spread, icon: 'spread', tint: '#4f6f8a', onChange: (v) => setReaderPrefs({ spread: v }) }) : null,
      ],
    }),
    group({
      head: 'Lesestatistik',
      icons: true,
      rows: [
        cell({ title: 'Lese-Serie', detail: streak ? `${streak} ${streak === 1 ? 'Tag' : 'Tage'} in Folge` : 'Heute noch nicht gelesen', icon: 'flame', tint: '#d0703a' }),
        cell({ title: 'Ausgelesen', detail: `${finished} ${finished === 1 ? 'Buch' : 'Bücher'}`, icon: 'checkCircle', tint: '#4f8a5b' }),
      ],
    }),
    group({
      head: 'Regale',
      icons: true,
      rows: [
        cell({ title: 'Regale bearbeiten', icon: 'library', tint: '#a0552a', chevron: true, onClick: () => startEditingShelves() }),
        cell({ title: 'Alle Bücher', detail: String(state.documents.length), icon: 'list', tint: '#7a6a5a', href: '#/catalogue' }),
        cell({ title: 'Ohne Regal', detail: String(idx.unshelved.length), icon: 'inbox', tint: '#7a6a5a', href: '#/unshelved' }),
      ],
    }),
    group({
      head: 'Import & Sicherung',
      icons: true,
      rows: [
        cell({ title: 'Buch hinzufügen …', icon: 'plus', tint: '#a0552a', onClick: () => openAcquire({}) }),
        cell({ title: 'Sicherung exportieren', icon: 'download', tint: '#4f6f8a', onClick: () => exportDialog() }),
        h('label', { class: 'cell' }, h('span', { class: 'cell-icon', style: { '--tint': '#4f6f8a' }, html: icon('upload') }), h('span', { class: 'cell-main' }, h('span', { class: 'cell-title' }, 'Sicherung wiederherstellen')), h('input', { type: 'file', accept: '.zip,.json,application/zip,application/json', class: 'visually-hidden', onChange: (e) => e.target.files[0] && importBackup(e.target.files[0]) })),
      ],
    }),
    syncBox,
    deviceBox,
    tagsGroup(),
    group({
      head: 'Info',
      rows: [cell({ title: 'Bücher', detail: 'Version 2' }), h('div', { class: 'cell stack' }, h('p', { class: 'muted small' }, 'Jedes Buch ist nur einmal gespeichert. Regale und Sammlungen verweisen nur darauf – ein Paper kann in „Wissenschaft“ und in „Uni & Studium › Marketing“ stehen, ohne kopiert zu werden. Ein Regal zu löschen löscht nie ein Buch.'))],
    }),
  ];
}

function choose(title, options, value, onPick) {
  const s = openSheet({
    title,
    body: group({ rows: options.map((o) => h('button', { type: 'button', class: 'cell', onClick: () => { onPick(o.value); s.close(); } }, h('span', { class: 'cell-main' }, h('span', { class: 'cell-title', style: o.style || null }, o.label)), o.value === value ? h('span', { class: 'pick-check', html: icon('check') }) : null)) }),
  });
}

async function drawSync(box) {
  const cfg = await getSyncConfig();
  if (!cfg) {
    const url = h('input', { type: 'url', placeholder: 'https://abcdefgh.supabase.co', autocomplete: 'off', 'aria-label': 'Projektadresse' });
    const key = h('input', { type: 'text', placeholder: 'sb_publishable_…', autocomplete: 'off', 'aria-label': 'Öffentlicher Schlüssel' });
    box.replaceChildren(group({ head: 'Synchronisierung', foot: 'Ohne Synchronisierung lebt die Bibliothek nur in diesem Browser.', rows: [h('label', { class: 'cell' }, h('span', { class: 'label' }, 'Adresse'), url), h('label', { class: 'cell' }, h('span', { class: 'label' }, 'Schlüssel'), key), cell({ title: 'Verbinden', accent: true, onClick: async () => { try { await configureSync(url.value, key.value); } catch (e) { toast(e.message); } } })] }));
    return;
  }
  if (!syncState.signedIn) {
    const email = h('input', { type: 'email', autocomplete: 'username', placeholder: 'name@beispiel.de', 'aria-label': 'E-Mail' });
    const pw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Passwort', 'aria-label': 'Passwort' });
    const go = async () => {
      try {
        await signIn(email.value, pw.value);
        toast('Angemeldet – die Bibliothek wird synchronisiert');
        drawSync(box);
      } catch (e) {
        toast(e.message);
      }
    };
    pw.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    box.replaceChildren(group({ head: 'Synchronisierung', foot: 'Melde dich an, um dieselbe Bibliothek auf Handy und PC zu haben.', rows: [h('label', { class: 'cell' }, h('span', { class: 'label' }, 'E-Mail'), email), h('label', { class: 'cell' }, h('span', { class: 'label' }, 'Passwort'), pw), cell({ title: 'Anmelden', accent: true, onClick: go }), cfg.source === 'device' ? cell({ title: 'Anderes Projekt verwenden', accent: true, onClick: forgetSyncConfig }) : null] }));
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
    return h('div', { class: 'cell stack' }, h('div', { class: 'meter-label' }, h('span', null, label), h('span', { class: 'muted' }, `${formatBytes(used)} von ${formatBytes(limit)}`)), h('div', { class: `progress ${pct > 85 ? 'warn' : ''}` }, h('span', { style: { width: `${pct}%` } })));
  };
  const localOnly = await db.files.filter((f) => !!f.localOnly).count();
  const statusText = syncState.status === 'idle' ? `Synchronisiert · ${timeAgo(syncState.lastSync)}` : SYNC_TEXT[syncState.status];
  box.replaceChildren(
    group({
      head: 'Synchronisierung',
      icons: true,
      foot: syncState.error || syncState.warning || (syncState.pending ? `${syncState.pending} Änderungen warten.` : 'Kostenloser Tarif: 1 GB Dateien, 500 MB Datenbank. Es wird nie ein bezahlter Tarif aktiviert.'),
      rows: [
        cell({ title: statusText, icon: syncState.status === 'error' ? 'alert' : syncState.status === 'syncing' ? 'sync' : 'cloudCheck', tint: syncState.status === 'error' ? 'var(--danger)' : '#4f8a5b' }),
        cell({ title: 'Konto', detail: syncState.email || '', icon: 'user', tint: '#7a6a5a' }),
        usage ? meter('Dateien in der Cloud', usage.files, FREE_LIMITS.storageBytes) : null,
        usage ? meter('Datenbank', usage.database, FREE_LIMITS.dbBytes) : null,
        localOnly ? cell({ title: `${localOnly} ${localOnly === 1 ? 'Datei' : 'Dateien'} nur auf diesem Gerät`, sub: 'Zu groß oder kein Platz im Gratis-Tarif', accent: false, onClick: retryLocalOnlyFiles }) : null,
        cell({ title: 'Jetzt synchronisieren', accent: true, onClick: async () => { await syncNow(); drawSync(box); } }),
        cell({ title: 'Auf diesem Gerät abmelden', danger: true, onClick: async () => { if (await confirmDialog({ title: 'Abmelden?', message: 'Deine Bücher bleiben auf diesem Gerät, werden aber nicht mehr abgeglichen.', confirm: 'Abmelden', danger: true })) { await signOut(); drawSync(box); } } }),
      ],
    }),
  );
}

async function drawDevice(box) {
  let est = null;
  try {
    est = await navigator.storage?.estimate?.();
  } catch {
    /* unsupported */
  }
  const cov = await fulltextCoverage();
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  box.replaceChildren(
    group({
      head: 'Dieses Gerät',
      foot: isIOS && !standalone ? 'Tipp: Über „Teilen → Zum Home-Bildschirm“ wird Bücher zur App. Safari löscht sonst Daten nach sieben Tagen ohne Besuch.' : null,
      rows: [
        est ? cell({ title: 'Speicher belegt', detail: formatBytes(est.usage) }) : null,
        cell({ title: 'Im Text durchsuchbar', detail: `${cov.indexed} von ${cov.readable}` }),
        cov.indexed < cov.readable ? cell({ title: 'Fehlende Bücher durchsuchbar machen', accent: true, onClick: async () => { await enqueueMissing(); toast('Läuft im Hintergrund'); } }) : null,
      ],
    }),
  );
}

function tagsGroup() {
  const tags = [...state.tags].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  if (!tags.length) return null;
  return group({
    head: 'Tags',
    rows: tags.map((t) =>
      cell({
        title: t.name,
        detail: String(idx.docsByTag.get(t.id)?.size || 0),
        chevron: true,
        onClick: (e) => showMenu(e.currentTarget, [
          { label: 'Bücher zeigen', icon: 'library', onClick: () => (location.hash = `#/tag/${t.id}`) },
          { label: 'Umbenennen', icon: 'pencil', onClick: async () => { const n = await promptDialog({ title: 'Tag umbenennen', value: t.name }); if (n) renameTag(t.id, n); } },
          { label: 'Löschen', icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog({ title: `Tag „${t.name}“ löschen?`, message: 'Er wird von allen Büchern entfernt. Die Bücher bleiben.', confirm: 'Löschen', danger: true })) deleteTag(t.id); } },
        ], { title: t.name }),
      }),
    ),
  });
}

async function exportDialog() {
  const r = await confirmDialog({ title: 'Sicherung exportieren', message: 'Regale, Bücherdaten, Notizen, Markierungen und Cover als ZIP-Datei.', confirm: 'Exportieren', check: { label: 'Auch die Buchdateien (größer)', checked: false } });
  if (r.ok) exportBackup(r.checked);
}

async function exportBackup(includeFiles) {
  const t = toast('Sicherung wird erstellt …', { timeout: 0 });
  try {
    const data = { app: 'grand-library', version: 2, exportedAt: new Date().toISOString(), tables: {} };
    for (const tname of SYNCED) data.tables[tname] = await db.table(tname).toArray();
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    zip.file('library.json', JSON.stringify(data));
    for (const c of await db.covers.toArray()) zip.file(`covers/${c.id}`, c.blob);
    if (includeFiles) {
      const files = await db.files.toArray();
      for (const f of files) zip.file(`files/${f.id}`, f.blob);
      zip.file('files.json', JSON.stringify(files.map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size }))));
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    t();
    download(blob, `buecher-sicherung-${new Date().toISOString().slice(0, 10)}.zip`);
  } catch (e) {
    t();
    toast(`Die Sicherung ist fehlgeschlagen: ${e.message}`);
  }
}

async function importBackup(file) {
  const ok = await confirmDialog({ title: 'Sicherung wiederherstellen?', message: 'Die Einträge werden mit der Bibliothek zusammengeführt. Bei gleichen Einträgen gewinnt der neuere. Nichts wird gelöscht.', confirm: 'Wiederherstellen' });
  if (!ok) return;
  const t = toast('Wird wiederhergestellt …', { timeout: 0 });
  try {
    let data;
    let zip = null;
    if (/\.json$/i.test(file.name)) data = JSON.parse(await file.text());
    else {
      const JSZip = await loadJSZip();
      zip = await JSZip.loadAsync(file);
      data = JSON.parse(await zip.file('library.json').async('text'));
    }
    if (data.app !== 'grand-library') throw new Error('Das ist keine Sicherung dieser Bibliothek.');
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
    toast(`${n} Einträge wiederhergestellt`);
  } catch (e) {
    t();
    toast(`Wiederherstellen fehlgeschlagen: ${e.message}`);
  }
}

export const settingsIcon = () => fromHTML(icon('settings'));
