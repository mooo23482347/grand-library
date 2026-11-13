// Service worker: keeps "Bücher" usable offline.
//  - The app's own files: network first (updates arrive at once), cache as fallback.
//  - Pinned libraries from the CDN: cache first (their versions never change).
//  - Supabase (sync) is never cached.

const VERSION = 'buecher-2026-11-13';
const SHELL = [
  './',
  'index.html',
  'config.js',
  'manifest.webmanifest',
  'assets/icon.svg',
  'assets/icon-180.png',
  'assets/icon-192.png',
  'assets/favicon-32.png',
  'assets/fonts/literata-wght-normal.woff2',
  'assets/fonts/literata-wght-italic.woff2',
  'assets/fonts/atkinson-400-normal.woff2',
  'assets/fonts/atkinson-400-italic.woff2',
  'assets/fonts/atkinson-700-normal.woff2',
  'css/tokens.css',
  'css/app.css',
  'css/library.css',
  'css/reader.css',
  'js/app.js',
  'js/db.js',
  'js/deps.js',
  'js/kinds.js',
  'js/search.js',
  'js/seed.js',
  'js/store.js',
  'js/sync.js',
  'js/theme.js',
  'js/util.js',
  'js/import/acquire.js',
  'js/import/epub.js',
  'js/import/indexer.js',
  'js/import/lookup.js',
  'js/import/pdf.js',
  'js/reader/flow.js',
  'js/reader/ornaments.js',
  'js/reader/pdfview.js',
  'js/reader/prefs.js',
  'js/reader/reader.js',
  'js/reader/reflow-worker.js',
  'js/reader/reflow.js',
  'js/reader/sanitize.js',
  'js/reader/textmarks.js',
  'js/ui/controls.js',
  'js/ui/icons.js',
  'js/ui/modal.js',
  'js/ui/noteEditor.js',
  'js/ui/picker.js',
  'js/ui/reorder.js',
  'js/views/catalogue.js',
  'js/views/covers.js',
  'js/views/docpanel.js',
  'js/views/home.js',
  'js/views/misc.js',
  'js/views/notes.js',
  'js/views/room.js',
  'js/views/roomdialogs.js',
  'js/views/searchview.js',
  'js/views/settings.js',
  'js/views/syncbadge.js',
];

self.addEventListener('install', (e) => {
  // One missing file must never block the update, so each file is cached on its own.
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'gl-cdn').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const CDN = /^https:\/\/cdn\.jsdelivr\.net\//;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/supabase\.(co|in)$/.test(url.hostname)) return;

  if (CDN.test(req.url)) {
    e.respondWith(
      caches.open('gl-cdn').then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok && !url.search) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())),
    );
  }
});
