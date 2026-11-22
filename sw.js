/* TIP app shell — precache the app shell and bump CACHE_VERSION on each deploy. */

const CACHE_VERSION = 'tip-v1.9.0';
const APP_SHELL = [
  './',
  './index.html',
  './radial.html',
  './manifest.json',
  './css/app.css',
  './css/radial.css',
  './vendor/fonts/PretendardVariable.woff2',
  './js/app.js',
  './js/ui.js',
  './js/store.js',
  './js/quickbar.js',
  './js/radial.js',
  './modules/registry.js',
  './modules/doc-reader/module.js',
  './modules/doc-reader/renderers.js',
  './modules/doc-reader/pdf-viewer.js',
  './modules/doc-reader/hwp.js',
  './modules/doc-reader/hwpx.js',
  './modules/img-converter/module.js',
  './modules/img-converter/encoders.js',
  './modules/pdf-tools/module.js',
  './modules/photo-privacy/module.js',
  './modules/photo-privacy/exif.js',
  './modules/qr-gen/module.js',
  './modules/video-gif/module.js',
  './modules/dev-tools/module.js',
  './modules/text-diff/module.js',
  './modules/regex-tester/module.js',
  './modules/color-tools/module.js',
  './modules/icon-gen/module.js',
  './modules/ocr-reader/module.js',
  './modules/file-compress/module.js',
  './modules/video-mosaic/module.js',
  './modules/md-editor/module.js',
  './modules/unit-converter/module.js',
  './modules/currency-calc/module.js',
  './vendor/heic2any.min.js',
  './vendor/pdfjs/pdf.min.js',
  './vendor/pdfjs/pdf.worker.min.js',
  './vendor/jszip/jszip.min.js',
  './vendor/hwpjs/hwp.esm.js',
  './vendor/pdf-lib/pdf-lib.min.js',
  './vendor/qrcode/qrcode.mjs',
  './vendor/marked/marked.esm.js',
  './vendor/dompurify/purify.min.js',
  './vendor/gifenc/gifenc.esm.js',
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
  './icons/favicon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

/* OCR 언어 데이터 캐시는 버전과 무관하게 남긴다(다시 받지 않게). */
const KEPT_CACHES = /^tip-ocr-lang-/;

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_VERSION && !KEPT_CACHES.test(key)).map((key) => caches.delete(key))
      ))
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

  // OCR 언어 데이터(.traineddata.gz)는 용량이 커서 프리캐시에 넣지 않는다.
  // ocr-reader 모듈이 최초 OCR 실행 때 CacheStorage('tip-ocr-lang-v1')에 직접 넣고,
  // 아래 caches.match()가 그 캐시까지 함께 찾으므로 이후 워커의 fetch도 오프라인에서 해결된다.
  const isOcrLang = /\/vendor\/tesseract\/lang\/[^/]+\.traineddata\.gz$/.test(url.pathname);

  // Everything else: cache first, then network (and cache the result).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && !isOcrLang) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
