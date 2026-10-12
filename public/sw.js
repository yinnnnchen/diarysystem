const CACHE_NAME = 'psycho-diary-shell-v5';

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

  // App shell：cache-first（增加 status 200 檢查，防止快取毒化）
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        // 僅快取成功 (status === 200) 的同源回應，不快取 404/500 等錯誤狀態
        if (!res || res.status !== 200 || res.type !== 'basic') {
          return res;
        }
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return res;
      });
    })
  );
});