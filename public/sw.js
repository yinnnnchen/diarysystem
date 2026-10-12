const CACHE_NAME = 'psycho-diary-shell-v7';

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
      .then(async (cache) => {
        // 使用 Promise.allSettled 容錯快取：避免單一 icon 遺失導致整個 Service Worker 安裝失敗
        await Promise.allSettled(
          SHELL_ASSETS.map((asset) =>
            cache.add(asset).catch((err) => {
              console.warn(`[SW] 快取 ${asset} 失敗:`, err);
            })
          )
        );
      })
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

  // 只處理 GET，且僅限同源請求
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // API 資料：一律走網路，絕不快取（保護敏感個資）
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: '目前離線，無法取得日記資料。' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const home = await caches.match('/');
          if (home) return home;
        }
        return Response.error();
      })
  );
});