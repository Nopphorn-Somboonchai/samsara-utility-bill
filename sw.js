/**
 * ============================================================================
 * Samsara Utility Bill — Service Worker (sw.js)
 * Strategy:
 *   - Same-origin App Shell (HTML, CSS, JS, Icons, Manifest):
 *     Network-First with Cache Fallback (always fresh when online, resilient offline)
 *   - External APIs (Google Apps Script, Google Drive, CDNs):
 *     Bypass cache completely so billing/slip data is never stale
 * ============================================================================
 */

const CACHE_PREFIX = 'samsara-utility-shell-';
const CACHE_NAME = CACHE_PREFIX + 'v1';

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './web/css/style.css',
  './web/js/config.js',
  './web/js/api.js',
  './web/js/charts.js',
  './web/js/app.js',
  './web/js/pwa.js',
  './web/icons/favicon-32.png',
  './web/icons/app-logo-128.png',
  './web/icons/apple-touch-icon.png',
  './web/icons/icon-192.png',
  './web/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Only handle http/https requests from the same origin.
  // Never intercept or cache Google Apps Script, Google Drive, or external CDN calls.
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.ok && networkResponse.type === 'basic') {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) {
          return cached;
        }
        if (request.mode === 'navigate') {
          const fallbackPage = await caches.match('./index.html');
          if (fallbackPage) {
            return fallbackPage;
          }
        }
        return new Response('ไม่สามารถเชื่อมต่อเครือข่ายได้ในขณะนี้', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
  );
});
