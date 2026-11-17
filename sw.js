// 离线缓存：安装时预缓存全部静态资源，之后缓存优先。
// 发布新版本时请修改 VERSION，旧缓存会在激活时被清理。
const VERSION = 'v1.0.0';
const CACHE = `h5-game-${VERSION}`;

importScripts('js/games.js');

const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/common.css',
  'css/home.css',
  'js/games.js',
  'js/home.js',
  'js/pwa.js',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

function precacheList() {
  const urls = new Set(CORE);
  for (const game of self.H5_GAMES || []) {
    urls.add(game.path);
    if (game.icon) urls.add(game.icon);
    for (const f of game.files || []) urls.add(game.path + f);
  }
  return [...urls];
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(precacheList().map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('h5-game-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (err) {
        if (req.mode === 'navigate') {
          const fallback = await cache.match('./');
          if (fallback) return fallback;
        }
        throw err;
      }
    }),
  );
});
