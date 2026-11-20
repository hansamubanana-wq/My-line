const CACHE_NAME = 'my-line-v6';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './icon.png',
  './manifest.json'
];

// インストール時に基本アセットをキャッシュ
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS.map(asset => new Request(asset, { cache: 'reload' })));
    }).then(() => self.skipWaiting())
  );
});

// 新しいSWがアクティブになったら古いキャッシュを削除
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key === 'chat-v1' || (key.startsWith('my-line-v') && key !== CACHE_NAME)) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ネットワーク優先のハイブリッド・キャッシュ戦略（リアルタイムWebアプリ向け）
self.addEventListener('fetch', (e) => {
  // 外部API（Firebase等）や非GETリクエストはキャッシュ処理から除外
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  const isAppAsset = ASSETS.some(asset => new URL(asset, self.registration.scope).href === e.request.url);
  if (!isAppAsset && e.request.mode !== 'navigate') {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(async (res) => {
        // 通信が成功したらキャッシュを更新
        if (res.ok && isAppAsset) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(e.request, res.clone()).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        // オフラインや接続失敗時はキャッシュから取得
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(e.request);
        if (cached) return cached;
        if (e.request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
        return Response.error();
      })
  );
});
