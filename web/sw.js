// Service Worker：缓存应用外壳，断网也能用；有新版本时自动更新
const CACHE = 'picsnap-v1';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/main.js',
  './js/canvas.js',
  './js/models.js',
  './js/renderer.js',
  './js/templates.js',
  './js/settings.js',
  './js/store.js',
  './js/library.js',
  './js/groups.js',
  './js/importer.js',
  './js/exporter.js',
  './js/dnd.js',
  './js/ui.js',
  './js/blur.js',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  // 导航请求：优先网络，失败回落缓存
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return r;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match('./index.html'))),
    );
    return;
  }

  e.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((r) => {
        if (r.ok && new URL(request.url).origin === location.origin) {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return r;
      });
    }),
  );
});
