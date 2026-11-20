const CACHE_NAME = 'my-line-v13';
const STICKER_PATH = new URL('./stickers/', self.registration.scope).pathname;
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
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const isAppAsset = ASSETS.some(asset => new URL(asset, self.registration.scope).href === e.request.url);
  const isSticker = url.pathname.startsWith(STICKER_PATH) && /^[^/]+\.webp$/.test(url.pathname.slice(STICKER_PATH.length));
  if (!isAppAsset && !isSticker && e.request.mode !== 'navigate') {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(async (res) => {
        // 通信が成功したらキャッシュを更新
        if (res.ok && (isAppAsset || isSticker)) {
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

function isAppWindow(client) {
  const url = new URL(client.url);
  url.search = '';
  url.hash = '';
  return url.href === self.registration.scope || url.href === new URL('./index.html', self.registration.scope).href;
}

function isRoomOpen(client, roomId) {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = open => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(open);
    };
    const timeout = setTimeout(() => finish(false), 500);
    channel.port1.onmessage = event => finish(event.data === true);
    client.postMessage({ type: 'is-room-open', roomId }, [channel.port2]);
  }).catch(() => false);
}

self.addEventListener('push', event => {
  let data;
  try {
    data = event.data?.json()?.data;
  } catch {
    return;
  }
  if (!data || typeof data.title !== 'string' || typeof data.body !== 'string' ||
      typeof data.roomId !== 'string' || data.tag !== data.roomId) return;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = windows.filter(client => isAppWindow(client) && client.visibilityState === 'visible');
    // Safari（iPhone・iPad・Mac）は通知を出さないプッシュが続くと購読を解除するため、抑制しない。
    const ua = self.navigator.userAgent;
    const isAppleWebKit = /iPhone|iPad|Macintosh/.test(ua) && !/Chrome|Chromium|Firefox|Edg/.test(ua);
    if (!isAppleWebKit &&
        (await Promise.all(visible.map(client => isRoomOpen(client, data.roomId)))).some(Boolean)) return;

    await self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: new URL('./icon.png', self.registration.scope).href,
      data: { roomId: data.roomId }
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const roomId = event.notification.data?.roomId;
  if (typeof roomId !== 'string' || !roomId) return;

  event.waitUntil((async () => {
    const url = new URL(self.registration.scope);
    url.searchParams.set('room', roomId);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(isAppWindow);
    if (client) {
      try {
        const opened = await client.navigate(url.href);
        if (opened) {
          await opened.focus();
          return;
        }
      } catch {
        // 閉じられたウィンドウは新しく開く。
      }
    }
    await self.clients.openWindow(url.href);
  })());
});
