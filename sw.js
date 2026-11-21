/* Editor Murillo's — service worker.
 * Guarda solo la cáscara de la app (HTML, JS, manifiesto, iconos) para
 * que abra sin conexión. El motor de video y los modelos (CDN) NO se
 * guardan aquí: el navegador los guarda solo, como siempre.
 */
const CACHE = 'editor-murillos-v1';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Solo la cáscara de la app (mismo origen). El CDN va directo a la red.
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request))
  );
});
