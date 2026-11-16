/* SyncPod service worker
 * - Uygulama kabuğu (index, manifest, ikonlar) önbelleğe alınır → çevrimdışı açılır.
 * - Google Fonts ve Firebase CDN dosyaları: stale-while-revalidate.
 * - Çeviri/sözlük API'leri ve Firebase veritabanı trafiği hiç önbelleğe alınmaz.
 * Uygulamada değişiklik yaptığında CACHE_VERSION değerini artır.
 */
const CACHE_VERSION = 'v3';
const SHELL_CACHE = 'syncpod-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'syncpod-runtime-' + CACHE_VERSION;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

// Çapraz kaynaklı, önbelleğe alınmasında sakınca olmayan statik kaynaklar
const CACHEABLE_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'www.gstatic.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('syncpod-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Sayfa gezintileri: önce ağ (güncel sürüm), olmazsa önbellek
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Aynı kaynaktan statik dosyalar: önce önbellek, arkada güncelle
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }

  // Yazı tipleri ve CDN betikleri
  if (CACHEABLE_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  // Geri kalan her şey (çeviri, sözlük, Firebase DB…) doğrudan ağa gider
});

function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
}
