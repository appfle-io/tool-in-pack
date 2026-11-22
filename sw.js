/* TIP app shell — precache the app shell and bump CACHE_VERSION on each deploy. */

const CACHE_VERSION = 'tip-v1.3.0';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './vendor/fonts/PretendardVariable.woff2',
  './js/app.js',
  './js/ui.js',
  './js/store.js',
  './modules/registry.js',
  './modules/doc-reader/module.js',
  './modules/doc-reader/renderers.js',
  './modules/doc-reader/pdf-viewer.js',
  './modules/doc-reader/hwp.js',
  './modules/doc-reader/hwpx.js',
  './modules/img-converter/module.js',
  './modules/img-converter/encoders.js',
  './vendor/heic2any.min.js',
  './vendor/pdfjs/pdf.min.js',
  './vendor/pdfjs/pdf.worker.min.js',
  './vendor/jszip/jszip.min.js',
  './vendor/hwpjs/hwp.esm.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
  './icons/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: network first (fresh shell on deploy), fall back to cache offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put('./index.html', copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Everything else: cache first, then network (and cache the result).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
