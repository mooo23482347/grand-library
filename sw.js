// Service worker: keeps the library usable offline.
//  - The library's own files: network first (updates arrive at once), cache as fallback.
//  - Pinned libraries and fonts from the CDN: cache first (their versions never change).
//  - Supabase (sync) is never cached.

const VERSION = 'gl-2026-11-12';
const SHELL = [
  './',
  'index.html',
  'config.js',
  'manifest.webmanifest',
  'assets/icon.svg',
  'css/base.css',
  'css/hall.css',
  'css/room.css',
  'css/panels.css',
  'css/reader.css',
  'js/app.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'gl-cdn').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const CDN = /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

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
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())),
    );
  }
});
