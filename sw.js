// Service Worker：一度開いたら、通信がなくても遊べるようにする
//
// ゲームを直して公開するときは、下の VERSION の数字を1つ上げる。
// 上げると、次に開いたときに新しい版を丸ごと取り直し、古い版のキャッシュは消える。

const VERSION = 1;
const CACHE = `pocket-soccer-v${VERSION}`;

// ゲームのファイル（この sw.js からの相対パス）
const LOCAL_FILES = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './js/main.js',
  './js/scene.js',
  './js/field.js',
  './js/ball.js',
  './js/player.js',
  './js/cpu.js',
  './js/input.js',
  './js/screens.js',
  './js/storage.js',
  './js/sound.js',
  './js/effects.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// CDN から読み込んでいるもの（index.html と同じ版を書く。版を上げたらここも直す）
const CDN_FILES = [
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/es-module-shims@1.8.3/dist/es-module-shims.js',
];

// 入れたとき：全部のファイルを取ってキャッシュに入れる
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 新しい版を確実に取るため、ブラウザが覚えている古いファイルは使わない
    await cache.addAll(LOCAL_FILES.map((url) => new Request(url, { cache: 'reload' })));
    await cache.addAll(CDN_FILES.map((url) => new Request(url, { mode: 'cors' })));
    // 待たずに、すぐ新しい版に切り替える
    await self.skipWaiting();
  })());
});

// 切り替わったとき：古い版のキャッシュを消す
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('pocket-soccer-') && name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

// ファイルを読むとき：キャッシュにあればそれを使い、なければ通信で取る（取れたらキャッシュにも入れる）。
// ページそのもの（?debug などが付いていても）は、キャッシュの index.html を使う
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (request.mode === 'navigate') {
      const page = await cache.match('./index.html');
      if (page) return page;
    }
    const cached = await cache.match(request, { ignoreSearch: new URL(request.url).origin === self.location.origin });
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && (request.url.startsWith(self.location.origin) || request.url.startsWith('https://cdn.jsdelivr.net/'))) {
      cache.put(request, response.clone());
    }
    return response;
  })());
});
