const CACHE_NAME = 'psycho-diary-shell-v3';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/firebase.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只處理 GET，且僅限同源請求（外部字型/CDN 交給瀏覽器預設行為）
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // API 資料：network-first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return res;
        })
        .catch(() =>
          caches.match(request).then((cached) =>
            cached || new Response(
              JSON.stringify({ error: '目前離線，且沒有可用的快取資料。' }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            )
          )
        )
    );
    return;
  }

  // App shell：cache-first
  event.respondWith(
    caches.match(request).then((cached) =>
      cached || fetch(request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return res;
      })
    )
  );
});